// Three RouterOS CHRs, which the devices workflow boots, the first linked to the other two. IS-IS carries each router's IPv4 and IPv6 loopbacks in one topology (RFC 5308): r-02 reaches r-03 through r-01 over both. The tests run in order on the same three routers. Skipped without the three CHRs.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** Each CHR's SSH, as `host:port`. Each has the user `operator`, with the password in CIRCUIT_TEST_CHR_PASSWORD. */
const middleChr = process.env.CIRCUIT_TEST_CHR;
const secondChr = process.env.CIRCUIT_TEST_CHR_B;
const thirdChr = process.env.CIRCUIT_TEST_CHR_C;
const password = process.env.CIRCUIT_TEST_CHR_PASSWORD ?? "";

const repo = join(import.meta.dir, "..", "..");
const folder = realpathSync(mkdtempSync(join(tmpdir(), "circuit-chr-isis-")));

/** A test applies to three routers, and waits for IS-IS. */
const TEST_MS = 300_000;

/** How long IS-IS has to come up, or its routes to go. */
const WAIT_MS = 90_000;

const POLL_MS = 3000;

/** Each router's loopbacks: its IPv4 one, also its router ID, and its IPv6 one. */
const LOOPBACK = {
    "r-01": { v4: "192.0.2.101", v6: "2001:db8:ffff::1" },
    "r-02": { v4: "192.0.2.102", v6: "2001:db8:ffff::2" },
    "r-03": { v4: "192.0.2.103", v6: "2001:db8:ffff::3" },
};

/** r-01's addresses on its link to each other router, and the other router's. */
const LINK = {
    "r-02": { middle: ["192.0.2.17/30", "2001:db8:0:12::1/64"], far: ["192.0.2.18/30", "2001:db8:0:12::2/64"] },
    "r-03": { middle: ["192.0.2.21/30", "2001:db8:0:13::1/64"], far: ["192.0.2.22/30", "2001:db8:0:13::2/64"] },
};

const ROUTERS = ["r-01", "r-02", "r-03"] as const;

/** Runs Circuit from the sources in the lab project, and prints what it printed, so the job's log shows each plan. */
function circuit(...args: string[]): { status: number | null; output: string } {
    const run = spawnSync("bun", [join(repo, "src", "cli", "index.ts"), ...args], {
        cwd: folder,
        encoding: "utf8",
        env: { ...process.env, OPERATOR_PASSWORD: password },
    });
    const output = `${run.stdout}${run.stderr}`;
    console.log(`$ circuit ${args.join(" ")}\n${output}`);
    return { status: run.status, output };
}

/** Whether `check` holds within `WAIT_MS`, asking every `POLL_MS`. */
function eventually(check: () => boolean): boolean {
    const deadline = Date.now() + WAIT_MS;
    while (!check()) {
        if (Date.now() > deadline) return false;
        Bun.sleepSync(POLL_MS);
    }
    return true;
}

/** A file of the lab project. */
function write(path: string, text: string): void {
    mkdirSync(dirname(join(folder, path)), { recursive: true });
    writeFileSync(join(folder, path), text);
}

/** A router of the lab, with IS-IS for both families on its loopback and links when `isis`. Its system ID ends in its number. */
function writeRouter(
    name: (typeof ROUTERS)[number],
    chr: string,
    management: string,
    links: Record<string, readonly string[]>,
    isis: boolean
): void {
    const [host, port] = chr.split(":");
    const ports = Object.entries(links)
        .map(([link, addresses]) => `"${link}": { description: "lab link", addresses: ${JSON.stringify(addresses)} },`)
        .join("\n            ");
    const isisLinks = Object.keys(links)
        .map((link) => `"${link}": { network: "point-to-point" },`)
        .join(" ");
    const routing = isis
        ? `isis: {
            net: "49.0001.1920.0000.21${name.slice(-2)}.00",
            level_capability: "level-2",
            address_families: ["ipv4", "ipv6"],
            interfaces: { loopback: { passive: true }, ${isisLinks} },
        },`
        : "";
    write(
        `sites/lab/${name}.ts`,
        `import { lab } from "../../circuit";

export default lab.device({
    name: "${name}",
    site: "lab",
    platform: "routeros",
    model: "CHR",
    connection: { host: "${host}", port: ${port}, user: "operator" },
    system: { users: { operator: { role: "admin", password: secret("OPERATOR_PASSWORD") } } },
    management: { allow: ["${management}.0/24"], ssh: {} },
    interfaces: {
        ethernet: {
            "virtual-1": { description: "Management", addresses: ["${management}.1/24"] },
            ${ports}
        },
        loopback: { loopback: { addresses: ["${LOOPBACK[name].v4}/32", "${LOOPBACK[name].v6}/128"] } },
    },
    routing: {
        router_id: "${LOOPBACK[name].v4}",
        ${routing}
    },
});
`
    );
}

/** The three routers, with IS-IS or without. */
function writeLab(isis: boolean): void {
    writeRouter("r-01", middleChr!, "10.0.0", { "virtual-2": LINK["r-02"].middle, "virtual-3": LINK["r-03"].middle }, isis);
    writeRouter("r-02", secondChr!, "10.0.1", { "virtual-2": LINK["r-02"].far }, isis);
    writeRouter("r-03", thirdChr!, "10.0.2", { "virtual-2": LINK["r-03"].far }, isis);
}

/** What `exec` printed for `commands` on `device`. */
function exec(device: string, ...commands: string[]): string {
    const { status, output } = circuit("exec", device, ...commands);
    expect(status).toBe(0);
    return output;
}

/** How many of the device's IS-IS adjacencies are up. */
function adjacenciesUp(device: string): number {
    return (exec(device, "/routing isis neighbor print detail without-paging").match(/\bstate=up\b/g) ?? []).length;
}

/** How many active routes the device has to `prefix`, in `menu`: `/ip route` or `/ipv6 route`. A route to another router's loopback can only come from IS-IS here. */
function activeRoutes(device: string, menu: "/ip route" | "/ipv6 route", prefix: string): number {
    const count = exec(device, `:put [:len [${menu} find where dst-address="${prefix}" and active]]`)
        .split("\n")
        .map((line) => line.trim())
        .findLast((line) => /^\d+$/.test(line));
    if (count === undefined) throw new Error(`circuit exec ${device} printed no count`);
    return Number(count);
}

/** What each router holds of IS-IS, for the job's log. */
function logIsis(): void {
    for (const device of ROUTERS)
        exec(
            device,
            "/routing isis export verbose",
            "/routing isis neighbor print detail without-paging",
            "/routing route print detail without-paging where is-is"
        );
}

describe.skipIf(!middleChr || !secondChr || !thirdChr)("IS-IS for IPv4 and IPv6 between three CHRs", () => {
    beforeAll(() => {
        write("circuit.ts", `export const lab = circuit({ sites: { lab: { description: "Three CHRs, linked port to port." } } });\n`);
        writeLab(true);
    });

    afterAll(() => rmSync(folder, { recursive: true, force: true }));

    test(
        "each apply converges, r-01 forms an adjacency with each other router, and r-02 reaches r-03's loopbacks through it over IPv4 and IPv6",
        () => {
            for (const device of ROUTERS) {
                // A diff first: the first export after a boot leaves out what the apply's read would then miss (TRAPS.md).
                circuit("diff", device);
                expect(circuit("apply", device, "--confirm").status).toBe(0);
                expect(circuit("diff", device).status).toBe(0);
            }

            const up = eventually(() => adjacenciesUp("r-01") === 2);
            const routed = eventually(
                () =>
                    activeRoutes("r-02", "/ipv6 route", `${LOOPBACK["r-03"].v6}/128`) === 1 &&
                    activeRoutes("r-02", "/ip route", `${LOOPBACK["r-03"].v4}/32`) === 1 &&
                    activeRoutes("r-03", "/ipv6 route", `${LOOPBACK["r-02"].v6}/128`) === 1
            );
            logIsis();
            expect(up).toBe(true);
            expect(routed).toBe(true);

            // IPv6 crosses r-01, from one loopback to the other.
            const ping = exec("r-02", `/ping ${LOOPBACK["r-03"].v6} src-address=${LOOPBACK["r-02"].v6} count=3`);
            expect(ping).toMatch(/received=[1-9]/);

            // IS-IS's own state, which an export leaves out, changes nothing to plan.
            for (const device of ROUTERS) expect(circuit("diff", device).status).toBe(0);
        },
        TEST_MS
    );

    test(
        "without IS-IS in the config, each apply removes it, its routes go, and diff then finds nothing to change",
        () => {
            writeLab(false);
            for (const device of ROUTERS) {
                expect(circuit("apply", device, "--confirm").status).toBe(0);
                expect(circuit("diff", device).status).toBe(0);
            }
            expect(exec("r-01", "/routing isis export")).not.toMatch(/^add /m);
            expect(eventually(() => activeRoutes("r-02", "/ipv6 route", `${LOOPBACK["r-03"].v6}/128`) === 0)).toBe(true);
        },
        TEST_MS
    );
});
