// Three RouterOS CHRs, which the devices workflow boots, the first linked to the other two. OSPF carries each router's loopback, and LDP runs between the loopbacks over both links: traffic from pe-01 to pe-02 crosses p-01 by its label (RFC 3031, RFC 5036). The tests run in order on the same three routers. Skipped without the three CHRs.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** Each CHR's SSH, as `host:port`. Each has the user `operator`, with the password in CIRCUIT_TEST_CHR_PASSWORD. */
const pChr = process.env.CIRCUIT_TEST_CHR;
const firstPeChr = process.env.CIRCUIT_TEST_CHR_B;
const secondPeChr = process.env.CIRCUIT_TEST_CHR_C;
const password = process.env.CIRCUIT_TEST_CHR_PASSWORD ?? "";

const repo = join(import.meta.dir, "..", "..");
const folder = realpathSync(mkdtempSync(join(tmpdir(), "circuit-chr-mpls-")));

/** A test applies to three routers, and waits for OSPF and LDP. */
const TEST_MS = 300_000;

/** How long OSPF and LDP have to come up, or LDP to go. */
const WAIT_MS = 90_000;

const POLL_MS = 3000;

/** Each router's loopback, its LSR ID. */
const LOOPBACK = { p: "192.0.2.101", firstPe: "192.0.2.102", secondPe: "192.0.2.103" };

/** p-01's address on its link to each PE, and the PE's. */
const FIRST_LINK = { p: "192.0.2.17", pe: "192.0.2.18" };
const SECOND_LINK = { p: "192.0.2.21", pe: "192.0.2.22" };

/** The lowest label LDP gives: 0 to 15 are reserved (RFC 3032). */
const FIRST_DYNAMIC_LABEL = 16;

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

/** A router of the lab: its loopback and links in OSPF, and LDP on its links when `mpls`. */
function writeRouter(name: string, chr: string, management: string, loopback: string, links: Record<string, string>, mpls: boolean): void {
    const [host, port] = chr.split(":");
    const ports = Object.entries(links)
        .map(([link, address]) => `"${link}": { description: "lab link", addresses: ["${address}/30"] },`)
        .join("\n            ");
    const ospf = Object.keys(links)
        .map((link) => `"${link}": { network: "point-to-point" },`)
        .join(" ");
    const ldp = mpls ? `mpls: { ldp: { lsr_id: "${loopback}", interfaces: ${JSON.stringify(Object.keys(links))} } },` : "";
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
        loopback: { loopback: { addresses: ["${loopback}/32"] } },
    },
    routing: {
        router_id: "${loopback}",
        ospf: { areas: { "0.0.0.0": { interfaces: { loopback: { passive: true }, ${ospf} } } } },
        ${ldp}
    },
});
`
    );
}

/** The three routers, with LDP or without. */
function writeLab(mpls: boolean): void {
    writeRouter("p-01", pChr!, "10.0.0", LOOPBACK.p, { "virtual-2": FIRST_LINK.p, "virtual-3": SECOND_LINK.p }, mpls);
    writeRouter("pe-01", firstPeChr!, "10.0.1", LOOPBACK.firstPe, { "virtual-2": FIRST_LINK.pe }, mpls);
    writeRouter("pe-02", secondPeChr!, "10.0.2", LOOPBACK.secondPe, { "virtual-2": SECOND_LINK.pe }, mpls);
}

/** What `exec` printed for `commands` on `device`. */
function exec(device: string, ...commands: string[]): string {
    const { status, output } = circuit("exec", device, ...commands);
    expect(status).toBe(0);
    return output;
}

/** The LSR IDs of p-01's LDP neighbors whose sessions are up, flagged `O` (operational) in `/mpls ldp neighbor print`. */
function operationalNeighbors(): string[] {
    return exec("p-01", "/mpls ldp neighbor print without-paging")
        .split("\n")
        .flatMap((line) => {
            const row = /^\s*\d+\s+([A-Za-z]+)\s+\S+\s+\S+\s+(\d+\.\d+\.\d+\.\d+):0\b/.exec(line);
            return row && row[1]!.includes("O") ? [row[2]!] : [];
        })
        .sort();
}

/** The label each hop of a traceroute from pe-01's loopback to pe-02's saw on the probe, by the hop's address. */
function tracedLabels(): Record<string, number> {
    const output = exec("pe-01", `/tool traceroute ${LOOPBACK.secondPe} src-address=${LOOPBACK.firstPe} count=3`);
    return Object.fromEntries(
        output.split("\n").flatMap((line) => {
            const hop = /^\s*\d+\s+(\d+\.\d+\.\d+\.\d+)\s.*MPLS:L=(\d+)/.exec(line);
            return hop ? [[hop[1]!, Number(hop[2])]] : [];
        })
    );
}

/** What each router holds of MPLS, for the job's log. */
function logMpls(): void {
    for (const device of ["p-01", "pe-01", "pe-02"])
        exec(
            device,
            "/mpls export verbose",
            "/mpls ldp neighbor print without-paging",
            "/mpls ldp local-mapping print without-paging",
            "/mpls ldp remote-mapping print without-paging",
            "/mpls forwarding-table print without-paging"
        );
}

describe.skipIf(!pChr || !firstPeChr || !secondPeChr)("LDP between three CHRs", () => {
    beforeAll(() => {
        write("circuit.ts", `export const lab = circuit({ sites: { lab: { description: "Three CHRs, linked port to port." } } });\n`);
        writeLab(true);
    });

    afterAll(() => rmSync(folder, { recursive: true, force: true }));

    test(
        "each apply converges, LDP comes up between the loopbacks, and pe-01 reaches pe-02 by a label through p-01",
        () => {
            for (const device of ["p-01", "pe-01", "pe-02"]) {
                // A diff first: the first export after a boot leaves out what the apply's read would then miss (TRAPS.md).
                circuit("diff", device);
                expect(circuit("apply", device, "--confirm").status).toBe(0);
                expect(circuit("diff", device).status).toBe(0);
            }

            const up = eventually(() => operationalNeighbors().join() === [LOOPBACK.firstPe, LOOPBACK.secondPe].join());
            logMpls();
            expect(up).toBe(true);

            let labels: Record<string, number> = {};
            expect(
                eventually(() => {
                    labels = tracedLabels();
                    return labels[FIRST_LINK.p] !== undefined;
                })
            ).toBe(true);
            expect(labels[FIRST_LINK.p]).toBeGreaterThanOrEqual(FIRST_DYNAMIC_LABEL);

            // LDP's own state, which an export leaves out, changes nothing to plan.
            for (const device of ["p-01", "pe-01", "pe-02"]) expect(circuit("diff", device).status).toBe(0);
        },
        TEST_MS
    );

    test(
        "without MPLS in the config, each apply removes it, and diff then finds nothing to change",
        () => {
            writeLab(false);
            for (const device of ["p-01", "pe-01", "pe-02"]) {
                expect(circuit("apply", device, "--confirm").status).toBe(0);
                expect(circuit("diff", device).status).toBe(0);
            }
            expect(exec("p-01", "/mpls export")).not.toMatch(/^add /m);
        },
        TEST_MS
    );
});
