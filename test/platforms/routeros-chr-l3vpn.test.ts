// An L3VPN (RFC 4364) on the three CHRs of the devices workflow. OSPF carries the loopbacks and LDP labels them, as in routeros-chr-mpls.test.ts. The second and third are PEs with a VRF bank each. iBGP between their loopbacks carries the VRFs' routes, which the VRFs' policies then pick, and some ipv4 routes. The tests run in order. Skipped without the three CHRs.

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
const folder = realpathSync(mkdtempSync(join(tmpdir(), "circuit-chr-l3vpn-")));

/** A test applies to three routers, and waits for OSPF, LDP, and BGP. */
const TEST_MS = 300_000;

/** How long the routes have to arrive, or go. */
const WAIT_MS = 90_000;

const POLL_MS = 3000;

/** Each router's loopback, its LSR ID. */
const LOOPBACK = { p: "192.0.2.101", firstPe: "192.0.2.102", secondPe: "192.0.2.103" };

/** p-01's address on its link to each PE, and the PE's. */
const FIRST_LINK = { p: "192.0.2.17", pe: "192.0.2.18" };
const SECOND_LINK = { p: "192.0.2.21", pe: "192.0.2.22" };

/** Each PE's address in the VRF bank, on a loopback there. */
const BANK = { firstPe: "198.51.100.1", secondPe: "198.51.100.2" };

/** pe-01's second address in the VRF bank, which the VRFs' policies tell apart from its first. */
const FIRST_PE_OTHER = "198.51.100.129";

/** The prefix sets the VRFs' policies accept: one holds `BANK.firstPe`, the other `FIRST_PE_OTHER`. */
const BANK_HALVES = { low: "198.51.100.0/26", high: "198.51.100.128/26" };

/** The ipv4 prefix each PE announces over the same session, from a blackhole route. */
const ANNOUNCED = { firstPe: "203.0.113.64/26", secondPe: "203.0.113.128/26" };

/** The VRF's route distinguisher and its one route target. */
const BANK_TARGET = "64500:101";

/** The lowest label LDP or BGP gives: 0 to 15 are reserved (RFC 3032). */
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

/** What a PE adds: its VRF bank with a loopback in it, and the session to the other PE, which carries VPN routes and `ANNOUNCED`. The VRF's policies, when written, accept one half of `BANK_HALVES`. */
type Pe = {
    bank: string[];
    announced: string;
    peer: { name: string; address: string; announced: string };
    exported: boolean;
    policies?: { import_policy?: keyof typeof BANK_HALVES; export_policy?: keyof typeof BANK_HALVES };
};

/** A router of the lab: its loopback and links in OSPF, LDP on its links, and the L3VPN when it is a PE in one. */
function writeRouter(name: string, chr: string, management: string, loopback: string, links: Record<string, string>, pe?: Pe): void {
    const [host, port] = chr.split(":");
    const ports = Object.entries(links)
        .map(([link, address]) => `"${link}": { description: "lab link", addresses: ["${address}/30"] },`)
        .join("\n            ");
    const ospf = Object.keys(links)
        .map((link) => `"${link}": { network: "point-to-point" },`)
        .join(" ");
    const exported = pe?.exported ? `, export: ["${BANK_TARGET}"]` : "";
    const halves = [...new Set(Object.values(pe?.policies ?? {}))];
    const vrfPolicies = Object.entries(pe?.policies ?? {})
        .map(([way, half]) => `, ${way}: "bank-${half}"`)
        .join("");
    const prefixSets = halves.map((half) => `"bank-${half}": { prefixes: ["${BANK_HALVES[half]}"] }`).join(", ");
    const vpn = pe
        ? `vrfs: { bank: { route_distinguisher: "${BANK_TARGET}", route_targets: { import: ["${BANK_TARGET}"]${exported} }${vrfPolicies} } },
        ${halves.length ? `prefix_sets: { ${prefixSets} },` : ""}
        static_routes: [{ prefix: "${pe.announced}", blackhole: true }],
        bgp: {
            originated_prefixes: ["${pe.announced}"],
            neighbors: {
                "${pe.peer.name}": {
                    address: "${pe.peer.address}",
                    remote_as: 64500,
                    local_address: "${loopback}",
                    address_families: ["ipv4", "vpnv4"],
                    import_policy: "from-pe",
                    export_policy: "to-pe",
                },
            },
        },
        policies: {
            "from-pe": [{ if: { prefix: "${pe.peer.announced}" }, then: "accept" }, { then: "reject" }],
            "to-pe": [{ if: { prefix: "${pe.announced}" }, then: "accept" }, { then: "reject" }],
            ${halves.map((half) => `"bank-${half}": [{ if: { prefix_set: "bank-${half}" }, then: "accept" }, { then: "reject" }],`).join(" ")}
        },`
        : "";
    const bankLoopback = pe ? `"bank-lo": { addresses: ${JSON.stringify(pe.bank.map((address) => `${address}/32`))}, vrf: "bank" },` : "";
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
        loopback: { loopback: { addresses: ["${loopback}/32"] }, ${bankLoopback} },
    },
    routing: {
        router_id: "${loopback}",
        ospf: { areas: { "0.0.0.0": { interfaces: { loopback: { passive: true }, ${ospf} } } } },
        mpls: { ldp: { lsr_id: "${loopback}", interfaces: ${JSON.stringify(Object.keys(links))} } },
        ${vpn}
    },
});
`
    );
}

/** The three routers: the PEs with the L3VPN or without, the first PE exporting its VRF's routes or not. The first PE's export policy and the second's import policy, when given, accept one half of `BANK_HALVES`. */
function writeLab(
    l3vpn: boolean,
    firstExports = true,
    policies: { firstExports?: "low" | "high"; secondImports?: "low" | "high" } = {}
): void {
    writeRouter("p-01", pChr!, "10.0.0", LOOPBACK.p, { "virtual-2": FIRST_LINK.p, "virtual-3": SECOND_LINK.p });
    writeRouter(
        "pe-01",
        firstPeChr!,
        "10.0.1",
        LOOPBACK.firstPe,
        { "virtual-2": FIRST_LINK.pe },
        l3vpn
            ? {
                  bank: [BANK.firstPe, FIRST_PE_OTHER],
                  announced: ANNOUNCED.firstPe,
                  peer: { name: "pe-02", address: LOOPBACK.secondPe, announced: ANNOUNCED.secondPe },
                  exported: firstExports,
                  policies: policies.firstExports ? { export_policy: policies.firstExports } : undefined,
              }
            : undefined
    );
    writeRouter(
        "pe-02",
        secondPeChr!,
        "10.0.2",
        LOOPBACK.secondPe,
        { "virtual-2": SECOND_LINK.pe },
        l3vpn
            ? {
                  bank: [BANK.secondPe],
                  announced: ANNOUNCED.secondPe,
                  peer: { name: "pe-01", address: LOOPBACK.firstPe, announced: ANNOUNCED.firstPe },
                  exported: true,
                  policies: policies.secondImports ? { import_policy: policies.secondImports } : undefined,
              }
            : undefined
    );
}

/** What `exec` printed for `commands` on `device`. */
function exec(device: string, ...commands: string[]): string {
    const { status, output } = circuit("exec", device, ...commands);
    expect(status).toBe(0);
    return output;
}

/** The label pe-02's VRF bank uses for pe-01's address there, or nothing while it has no such route. */
function bankLabel(): number | undefined {
    const output = exec("pe-02", `/routing route print detail where routing-table=bank and dst-address=${BANK.firstPe}/32`);
    const label = /\blabel=(\d+)/.exec(output);
    return label ? Number(label[1]) : undefined;
}

/** Whether pe-02's VRF bank holds a route to one of pe-01's addresses there. */
function secondBankHas(address: string): boolean {
    const count = exec("pe-02", `/ip route print count-only where dst-address=${address}/32 and routing-table=bank`);
    return count.trim().split("\n").at(-1)!.trim() !== "0";
}

/** Whether pe-01 reaches pe-02's address in the VRF bank, from its own. */
function bankPings(): boolean {
    const output = exec("pe-01", `/ping ${BANK.secondPe} src-address=${BANK.firstPe} vrf=bank count=3`);
    return /received=[1-9]/.test(output);
}

/** What each PE holds of the L3VPN, for the job's log. */
function logL3vpn(): void {
    for (const device of ["pe-01", "pe-02"])
        exec(
            device,
            "/routing bgp export",
            "/routing bgp session print detail",
            "/routing bgp advertisements print",
            "/routing route print detail where routing-table=bank",
            "/routing route print detail where afi=vpnv4"
        );
}

describe.skipIf(!pChr || !firstPeChr || !secondPeChr)("an L3VPN between two CHRs, across a third", () => {
    beforeAll(() => {
        write(
            "circuit.ts",
            `export const lab = circuit({ asn: 64500, sites: { lab: { description: "Three CHRs, linked port to port." } } });\n`
        );
        writeLab(true);
    });

    afterAll(() => rmSync(folder, { recursive: true, force: true }));

    test(
        "each apply converges, each VRF takes the other's routes with a label, the two VRFs reach each other, and the ipv4 routes go by their policies",
        () => {
            for (const device of ["p-01", "pe-01", "pe-02"]) {
                // A diff first: the first export after a boot leaves out what the apply's read would then miss (TRAPS.md).
                circuit("diff", device);
                expect(circuit("apply", device, "--confirm").status).toBe(0);
                expect(circuit("diff", device).status).toBe(0);
            }

            let label: number | undefined;
            const arrived = eventually(() => {
                label = bankLabel();
                return label !== undefined;
            });
            logL3vpn();
            expect(arrived).toBe(true);
            expect(label).toBeGreaterThanOrEqual(FIRST_DYNAMIC_LABEL);
            expect(eventually(bankPings)).toBe(true);

            // The session's ipv4 routes went by the policies, and no VPN route reached the main table.
            expect(exec("pe-02", `/ip route print detail where dst-address=${ANNOUNCED.firstPe} and routing-table=main`)).toContain(
                `gateway=${LOOPBACK.firstPe}`
            );
            const leaked = exec("pe-02", `/ip route print count-only where dst-address=${BANK.firstPe}/32 and routing-table=main`);
            expect(leaked.trim().split("\n").at(-1)!.trim()).toBe("0");

            // BGP's and LDP's own state, which an export leaves out, changes nothing to plan.
            for (const device of ["p-01", "pe-01", "pe-02"]) expect(circuit("diff", device).status).toBe(0);
        },
        TEST_MS
    );

    test(
        "a VRF's import policy takes only some of the VPN routes with its target, and its export policy sends only some of its routes",
        () => {
            const both = () => [secondBankHas(BANK.firstPe), secondBankHas(FIRST_PE_OTHER)].join();

            // pe-02 takes the half with pe-01's first address.
            writeLab(true, true, { secondImports: "low" });
            expect(circuit("apply", "pe-02", "--confirm").status).toBe(0);
            expect(circuit("diff", "pe-02").status).toBe(0);
            const imported = eventually(() => both() === "true,false");
            logL3vpn();
            expect(imported).toBe(true);

            // pe-01 sends the other half, and pe-02 takes all it gets.
            writeLab(true, true, { firstExports: "high" });
            for (const device of ["pe-01", "pe-02"]) {
                expect(circuit("apply", device, "--confirm").status).toBe(0);
                expect(circuit("diff", device).status).toBe(0);
            }
            const exported = eventually(() => both() === "false,true");
            logL3vpn();
            expect(exported).toBe(true);

            // Without its policy, pe-01 sends both again.
            writeLab(true);
            expect(circuit("apply", "pe-01", "--confirm").status).toBe(0);
            expect(circuit("diff", "pe-01").status).toBe(0);
            expect(eventually(() => both() === "true,true")).toBe(true);
        },
        TEST_MS
    );

    test(
        "a VRF that stops exporting converges, and the far VRF loses its routes",
        () => {
            writeLab(true, false);
            expect(circuit("apply", "pe-01", "--confirm").status).toBe(0);
            expect(circuit("diff", "pe-01").status).toBe(0);
            expect(eventually(() => bankLabel() === undefined)).toBe(true);
        },
        TEST_MS
    );

    test(
        "without the L3VPN in the config, each apply removes it, and diff then finds nothing to change",
        () => {
            writeLab(false);
            for (const device of ["p-01", "pe-01", "pe-02"]) {
                expect(circuit("apply", device, "--confirm").status).toBe(0);
                expect(circuit("diff", device).status).toBe(0);
            }
            for (const device of ["pe-01", "pe-02"]) expect(exec(device, "/routing bgp export", "/ip vrf export")).not.toMatch(/^add /m);
        },
        TEST_MS
    );
});
