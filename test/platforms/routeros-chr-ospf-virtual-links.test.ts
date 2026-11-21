// Three RouterOS CHRs, which the devices workflow boots, the first linked to the other two. r-02 is in the backbone and in area 0.0.0.1 with r-01, the border router of r-03's area 0.0.0.2. r-01 has no link into the backbone, so a virtual link to r-02 across area 0.0.0.1 joins it, for OSPFv2, then OSPFv3. The tests run in order on the same routers. Skipped without the three CHRs.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Family } from "../../src/model";

/** Each CHR's SSH, as `host:port`. Each has the user `operator`, with the password in CIRCUIT_TEST_CHR_PASSWORD. */
const middleChr = process.env.CIRCUIT_TEST_CHR;
const secondChr = process.env.CIRCUIT_TEST_CHR_B;
const thirdChr = process.env.CIRCUIT_TEST_CHR_C;
const password = process.env.CIRCUIT_TEST_CHR_PASSWORD ?? "";

const repo = join(import.meta.dir, "..", "..");
const folder = realpathSync(mkdtempSync(join(tmpdir(), "circuit-chr-ospf-virtual-links-")));

/** A test applies to three routers, and waits for OSPF. */
const TEST_MS = 600_000;

/** How long OSPF has to come up, or a route to arrive or leave. */
const WAIT_MS = 300_000;

const POLL_MS = 5000;

/** How long a cut-off area stays without the routes a virtual link would bring, once the adjacencies are full. */
const SETTLE_MS = 30_000;

const ROUTERS = ["r-01", "r-02", "r-03"] as const;
type Router = (typeof ROUTERS)[number];

/** Each router's loopback: its router ID, then its IPv6 address. r-01's is in area 0.0.0.1, r-02's in the backbone, and r-03's in area 0.0.0.2. */
const LOOPBACK: Record<Router, [string, string]> = {
    "r-01": ["192.0.2.101/32", "2001:db8:ffff::1/128"],
    "r-02": ["192.0.2.102/32", "2001:db8:ffff::2/128"],
    "r-03": ["192.0.2.103/32", "2001:db8:ffff::3/128"],
};

/** r-01's link to r-02, then its link to r-03, each with r-01's addresses and the far router's. */
const LINK = {
    "r-02": { middle: ["192.0.2.17/30", "2001:db8:0:12::1/64"], far: ["192.0.2.18/30", "2001:db8:0:12::2/64"] },
    "r-03": { middle: ["192.0.2.21/30", "2001:db8:0:13::1/64"], far: ["192.0.2.22/30", "2001:db8:0:13::2/64"] },
};

const routerId = (router: Router) => LOOPBACK[router][0].split("/")[0]!;

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

/** A router of the lab, with its links, its loopback, and `ospf` in `routing` when given. */
function writeRouter(name: Router, chr: string, management: string, links: Record<string, readonly string[]>, ospf?: string): void {
    const [host, port] = chr.split(":");
    const ports = Object.entries(links)
        .map(([link, addresses]) => `"${link}": { description: "lab link", addresses: ${JSON.stringify(addresses)} },`)
        .join("\n            ");
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
        loopback: { loopback: { addresses: ${JSON.stringify(LOOPBACK[name])} } },
    },
    routing: {
        router_id: "${routerId(name)}",
        ${ospf ? `ospf: ${ospf},` : ""}
    },
});
`
    );
}

/** The lab's OSPF for one family, as RouterOS runs virtual links for one OSPF version at a time (TRAPS.md). With `linked`, r-01 and r-02 each have a virtual link to the other across area 0.0.0.1. */
function writeLab(family: Family | undefined, linked = false): void {
    const ospf = family !== undefined;
    const families = `address_families: ["${family}"]`;
    const virtualLink = (far: Router) => (linked ? `virtual_links: [{ transit_area_id: "0.0.0.1", router_id: "${routerId(far)}" }],` : "");
    const ptp = `{ network: "point-to-point" }`;
    const backbone = linked ? `"0.0.0.0": { ${virtualLink("r-02")} interfaces: {} },` : "";

    writeRouter(
        "r-01",
        middleChr!,
        "10.0.0",
        { "virtual-2": LINK["r-02"].middle, "virtual-3": LINK["r-03"].middle },
        ospf
            ? `{ ${families}, areas: { ${backbone} "0.0.0.1": { interfaces: { "virtual-2": ${ptp}, loopback: { passive: true } } }, "0.0.0.2": { interfaces: { "virtual-3": ${ptp} } } } }`
            : undefined
    );
    writeRouter(
        "r-02",
        secondChr!,
        "10.0.1",
        { "virtual-2": LINK["r-02"].far },
        ospf
            ? `{ ${families}, areas: { "0.0.0.0": { ${virtualLink("r-01")} interfaces: { loopback: { passive: true } } }, "0.0.0.1": { interfaces: { "virtual-2": ${ptp} } } } }`
            : undefined
    );
    writeRouter(
        "r-03",
        thirdChr!,
        "10.0.2",
        { "virtual-2": LINK["r-03"].far },
        ospf ? `{ ${families}, areas: { "0.0.0.2": { interfaces: { "virtual-2": ${ptp}, loopback: { passive: true } } } } }` : undefined
    );
}

/** What `exec` printed for `commands` on `device`. */
function exec(device: string, ...commands: string[]): string {
    const { status, output } = circuit("exec", device, ...commands);
    expect(status).toBe(0);
    return output;
}

/** How many entries of `menu` on `device` match `where`. */
function count(device: string, menu: string, where: string): number {
    const found = exec(device, `:put [:len [${menu} find where ${where}]]`)
        .split("\n")
        .map((line) => line.trim())
        .findLast((line) => /^\d+$/.test(line));
    if (found === undefined) throw new Error(`circuit exec ${device} printed no count`);
    return Number(found);
}

/** How many active routes to `prefix` the device has, in the table of its family. */
function routes(device: string, prefix: string): number {
    return count(device, prefix.includes(":") ? "/ipv6 route" : "/ip route", `dst-address="${prefix}" and active`);
}

/** How many routes of `family` there are each way between r-02 in the backbone and r-03 in area 0.0.0.2. */
function across(family: Family): number[] {
    const index = family === "ipv4" ? 0 : 1;
    return [routes("r-02", LOOPBACK["r-03"][index]), routes("r-03", LOOPBACK["r-02"][index])];
}

/** Each apply converges: a diff after it finds nothing to change. */
function applyAll(): void {
    for (const device of ROUTERS) {
        // A diff first: the first export after a boot leaves out what the apply's read would then miss (TRAPS.md).
        circuit("diff", device);
        expect(circuit("apply", device, "--confirm").status).toBe(0);
        expect(circuit("diff", device).status).toBe(0);
    }
}

/** What each router holds of OSPF, for the job's log. */
function logOspf(): void {
    for (const device of ROUTERS)
        exec(
            device,
            "/routing ospf export verbose",
            "/routing ospf interface print detail without-paging",
            "/routing ospf neighbor print detail without-paging",
            "/routing route print detail without-paging where ospf"
        );
}

describe.skipIf(!middleChr || !secondChr || !thirdChr)("OSPF virtual links between three CHRs", () => {
    beforeAll(() => {
        write("circuit.ts", `export const lab = circuit({ sites: { lab: { description: "Three CHRs, linked port to port." } } });\n`);
    });

    afterAll(() => rmSync(folder, { recursive: true, force: true }));

    test(
        "without a virtual link, area 0.0.0.2 is cut off: r-02, in the backbone, has no route to r-03, nor r-03 to r-02",
        () => {
            writeLab("ipv4");
            applyAll();

            const full = eventually(() => count("r-01", "/routing ospf neighbor", `state="Full"`) === 2);
            Bun.sleepSync(SETTLE_MS);
            logOspf();
            expect(full).toBe(true);
            expect(across("ipv4")).toEqual([0, 0]);
        },
        TEST_MS
    );

    test(
        "with an OSPFv2 virtual link at both ends across area 0.0.0.1, r-02 and r-03 reach each other, and a diff finds nothing to change",
        () => {
            writeLab("ipv4", true);
            applyAll();

            const joined = eventually(() => across("ipv4").every((found) => found === 1));
            logOspf();
            expect(joined).toBe(true);

            const ping = exec("r-02", `/ping ${routerId("r-03")} src-address=${routerId("r-02")} count=3`);
            expect(ping).toMatch(/received=[1-9]/);

            // OSPF's own state, which an export leaves out, changes nothing to plan.
            for (const device of ROUTERS) expect(circuit("diff", device).status).toBe(0);
        },
        TEST_MS
    );

    test(
        "with OSPFv3 in its place, each apply swaps the virtual link for an OSPFv3 one, and r-02 and r-03 reach each other over IPv6",
        () => {
            writeLab("ipv6", true);
            applyAll();

            const joined = eventually(() => across("ipv6").every((found) => found === 1));
            logOspf();
            expect(joined).toBe(true);
            expect(across("ipv4")).toEqual([0, 0]);

            for (const device of ROUTERS) expect(circuit("diff", device).status).toBe(0);
        },
        TEST_MS
    );

    test(
        "without the virtual links again, each apply removes them and r-03's area is cut off once more",
        () => {
            writeLab("ipv6");
            applyAll();

            const cut = eventually(() => across("ipv6").every((found) => found === 0));
            logOspf();
            expect(cut).toBe(true);
            for (const device of ["r-01", "r-02"]) expect(count(device, "/routing ospf interface", "!dynamic")).toBe(0);
        },
        TEST_MS
    );

    test(
        "without OSPF in the config, each apply removes it, and diff then finds nothing to change",
        () => {
            writeLab(undefined);
            applyAll();
            for (const device of ROUTERS) expect(exec(device, "/routing ospf export")).not.toMatch(/^add /m);
        },
        TEST_MS
    );
});
