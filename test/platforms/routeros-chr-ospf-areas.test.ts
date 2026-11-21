// Three RouterOS CHRs, which the devices workflow boots, the first linked to the other two. r-01, the border router of r-02's area, sums it into ranges, and priority picks the DR on its link to r-02. Then r-01's links are NBMA and point-to-multipoint, each with its neighbor written out. The tests run in order on the same routers. Skipped without the three CHRs.

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
const folder = realpathSync(mkdtempSync(join(tmpdir(), "circuit-chr-ospf-areas-")));

/** A test applies to three routers, and waits for OSPF. */
const TEST_MS = 600_000;

/** How long OSPF has to come up, or a route to arrive or leave. An NBMA neighbor that starts down is polled every 2 minutes (TRAPS.md). */
const WAIT_MS = 300_000;

const POLL_MS = 5000;

const ROUTERS = ["r-01", "r-02", "r-03"] as const;
type Router = (typeof ROUTERS)[number];

/** Each router's loopback addresses: its router ID and its IPv6 one first. r-02's others are in the ranges r-01 sums. */
const LOOPBACK: Record<Router, string[]> = {
    "r-01": ["192.0.2.101/32", "2001:db8:ffff::1/128"],
    "r-02": [
        "192.0.2.102/32",
        "2001:db8:ffff::2/128",
        "198.51.100.1/32",
        "198.51.100.129/32",
        "2001:db8:100::1/128",
        "2001:db8:100:1::1/128",
    ],
    "r-03": ["192.0.2.103/32", "2001:db8:ffff::3/128"],
};

/** r-02's networks behind r-01, and the ranges r-01 sums them into. */
const RANGES = { v4: "198.51.100.0/24", v6: "2001:db8:100::/48" };
const SPECIFICS = { v4: "198.51.100.1/32", v6: "2001:db8:100::1/128" };

/** r-01's link to r-02, then its link to r-03, each with r-01's addresses and the far router's. */
const LINK = {
    "r-02": { middle: ["192.0.2.17/30", "2001:db8:0:12::1/64"], far: ["192.0.2.18/30", "2001:db8:0:12::2/64"] },
    "r-03": { middle: ["192.0.2.21/30", "2001:db8:0:13::1/64"], far: ["192.0.2.22/30", "2001:db8:0:13::2/64"] },
};

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

/** A router of the lab, with its links and loopback, and `ospf` in `routing` when given. */
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
        router_id: "${LOOPBACK[name][0]!.split("/")[0]}",
        ${ospf ? `ospf: ${ospf},` : ""}
    },
});
`
    );
}

/** The three routers, each with its OSPF when given. */
function writeLab(ospf: Partial<Record<Router, string>>): void {
    writeRouter("r-01", middleChr!, "10.0.0", { "virtual-2": LINK["r-02"].middle, "virtual-3": LINK["r-03"].middle }, ospf["r-01"]);
    writeRouter("r-02", secondChr!, "10.0.1", { "virtual-2": LINK["r-02"].far }, ospf["r-02"]);
    writeRouter("r-03", thirdChr!, "10.0.2", { "virtual-2": LINK["r-03"].far }, ospf["r-03"]);
}

/**
 * r-01 is the border router: area 0.0.0.1 toward r-02, whose loopbacks it sums into one range for each family, and the backbone toward r-03. On the link to r-02, r-01 has `middlePriority` and r-02 `farPriority`.
 */
function rangesLab(advertise: boolean, middlePriority: number, farPriority: number): Partial<Record<Router, string>> {
    const families = `address_families: ["ipv4", "ipv6"]`;
    return {
        "r-01": `{
            ${families},
            areas: {
                "0.0.0.0": { interfaces: { "virtual-3": { network: "point-to-point" }, loopback: { passive: true } } },
                "0.0.0.1": {
                    ranges: [{ prefix: "${RANGES.v4}", advertise: ${advertise} }, { prefix: "${RANGES.v6}", advertise: ${advertise} }],
                    interfaces: { "virtual-2": { priority: ${middlePriority} } },
                },
            },
        }`,
        "r-02": `{ ${families}, areas: { "0.0.0.1": { interfaces: { "virtual-2": { priority: ${farPriority} }, loopback: { passive: true } } } } }`,
        "r-03": `{ ${families}, areas: { "0.0.0.0": { interfaces: { "virtual-2": { network: "point-to-point" }, loopback: { passive: true } } } } }`,
    };
}

/** r-01's link to r-02 is NBMA, where r-02 alone may be the DR, and its link to r-03 point-to-multipoint. Each end writes the other as its neighbor. */
const UNICAST_LAB: Partial<Record<Router, string>> = {
    "r-01": `{
        areas: {
            "0.0.0.0": {
                interfaces: {
                    "virtual-2": { network: "non-broadcast", priority: 0, neighbors: ["192.0.2.18"] },
                    "virtual-3": { network: "point-to-multipoint", neighbors: ["192.0.2.22"] },
                    loopback: { passive: true },
                },
            },
        },
    }`,
    "r-02": `{ areas: { "0.0.0.0": { interfaces: { "virtual-2": { network: "non-broadcast", priority: 1, neighbors: ["192.0.2.17"] }, loopback: { passive: true } } } } }`,
    "r-03": `{ areas: { "0.0.0.0": { interfaces: { "virtual-2": { network: "point-to-multipoint", neighbors: ["192.0.2.21"] }, loopback: { passive: true } } } } }`,
};

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

/** How many of the device's OSPF interfaces on ether2, one for each OSPF version, are in `state`: `dr`, `dr-other`, `bdr`, or `ptp`. */
function onEther2(device: string, state: string): number {
    return count(device, "/routing ospf interface", `interface="ether2" and state="${state}"`);
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

describe.skipIf(!middleChr || !secondChr || !thirdChr)(
    "OSPF ranges, priority, and NBMA and point-to-multipoint links between three CHRs",
    () => {
        beforeAll(() => {
            write("circuit.ts", `export const lab = circuit({ sites: { lab: { description: "Three CHRs, linked port to port." } } });\n`);
        });

        afterAll(() => rmSync(folder, { recursive: true, force: true }));

        test(
            "r-03 sees each range in place of r-02's loopbacks, and r-02 is the DR, as r-01's priority is 0",
            () => {
                writeLab(rangesLab(true, 0, 1));
                applyAll();

                const summed = eventually(
                    () =>
                        routes("r-03", RANGES.v4) === 1 &&
                        routes("r-03", RANGES.v6) === 1 &&
                        routes("r-03", SPECIFICS.v4) === 0 &&
                        routes("r-03", SPECIFICS.v6) === 0
                );
                const elected = eventually(() => onEther2("r-02", "dr") === 2 && onEther2("r-01", "dr-other") === 2);
                logOspf();
                expect(summed).toBe(true);
                expect(elected).toBe(true);

                // OSPF's own state, which an export leaves out, changes nothing to plan.
                for (const device of ROUTERS) expect(circuit("diff", device).status).toBe(0);
            },
            TEST_MS
        );

        test(
            "with advertise false, r-03 sees neither the ranges nor what is in them, and with the priorities swapped r-01 is the DR",
            () => {
                writeLab(rangesLab(false, 1, 0));
                applyAll();

                const hidden = eventually(
                    () =>
                        routes("r-03", RANGES.v4) === 0 &&
                        routes("r-03", RANGES.v6) === 0 &&
                        routes("r-03", SPECIFICS.v4) === 0 &&
                        routes("r-03", SPECIFICS.v6) === 0
                );
                const elected = eventually(() => onEther2("r-01", "dr") === 2 && onEther2("r-02", "dr-other") === 2);
                logOspf();
                expect(hidden).toBe(true);
                expect(elected).toBe(true);
                // r-02's router ID is outside the ranges, so r-03 still reaches area 0.0.0.1.
                expect(routes("r-03", "192.0.2.102/32")).toBe(1);
            },
            TEST_MS
        );

        test(
            "over NBMA and point-to-multipoint links with their neighbors written, r-01 forms both adjacencies, and r-02 reaches r-03 through it",
            () => {
                writeLab(UNICAST_LAB);
                applyAll();

                const full = eventually(() => count("r-01", "/routing ospf neighbor", `state="Full"`) === 2);
                // A point-to-multipoint link is announced as each router's own address, a /32, not as its network (RFC 2328, section 12.4.1).
                const routed = eventually(
                    () =>
                        routes("r-02", "192.0.2.103/32") === 1 &&
                        routes("r-02", "192.0.2.21/32") === 1 &&
                        routes("r-02", "192.0.2.22/32") === 1
                );
                logOspf();
                expect(full).toBe(true);
                expect(routed).toBe(true);
                expect(onEther2("r-02", "dr")).toBe(1);
                expect(onEther2("r-01", "dr-other")).toBe(1);

                const ping = exec("r-02", "/ping 192.0.2.103 src-address=192.0.2.102 count=3");
                expect(ping).toMatch(/received=[1-9]/);

                for (const device of ROUTERS) expect(circuit("diff", device).status).toBe(0);
            },
            TEST_MS
        );

        test(
            "without OSPF in the config, each apply removes it, and diff then finds nothing to change",
            () => {
                writeLab({});
                applyAll();
                for (const device of ROUTERS) expect(exec(device, "/routing ospf export")).not.toMatch(/^add /m);
            },
            TEST_MS
        );
    }
);
