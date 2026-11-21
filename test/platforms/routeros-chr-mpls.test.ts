// Three RouterOS CHRs, which the devices workflow boots, the first linked to the other two. OSPF carries each router's loopback, and LDP runs between the loopbacks over both links: traffic from pe-01 to pe-02 crosses p-01 by its label (RFC 3031, RFC 5036). Then policies limit LDP's labels, the PEs hold a targeted session, and pe-01 has policies per neighbor. The tests run in order.

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

const ROUTERS = ["p-01", "pe-01", "pe-02"] as const;
type Router = (typeof ROUTERS)[number];

/** Each router's LSR ID, by its name. */
const LSR_ID: Record<Router, string> = { "p-01": LOOPBACK.p, "pe-01": LOOPBACK.firstPe, "pe-02": LOOPBACK.secondPe };

/** p-01's address on its link to each PE, and the PE's. */
const FIRST_LINK = { p: "192.0.2.17", pe: "192.0.2.18" };
const SECOND_LINK = { p: "192.0.2.21", pe: "192.0.2.22" };

/** The prefixes LDP's policies tell apart: one holds the three loopbacks, the other both links. */
const PREFIXES = { loopbacks: "192.0.2.96/27", links: "192.0.2.16/28" };

/** Each PE's link to p-01, and pe-01's management network, as `/mpls ldp remote-mapping` prints them. */
const FIRST_LINK_PREFIX = "192.0.2.16/30";
const SECOND_LINK_PREFIX = "192.0.2.20/30";
const FIRST_MANAGEMENT = "10.0.1.0/24";

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

/** A policy LDP uses: which of LDP's policies it is, and its one rule for the prefixes of `PREFIXES`, before the rule for every other label. */
type LdpPolicy = { way: "import_policy" | "export_policy"; prefixes: keyof typeof PREFIXES; then: "accept" | "reject" };

/** What LDP runs with on a router of the lab, beside its links. `targets` are LSR IDs, and `neighbors` puts `NEIGHBOR_POLICIES` in. */
type Ldp = { policy?: LdpPolicy; targets?: string[]; neighbors?: boolean };

/** pe-01's policies per neighbor: it takes only pe-02's loopback's label from pe-02, and gives p-01 none for its management network. */
const NEIGHBOR_POLICIES = {
    neighbors: `neighbors: { "${LOOPBACK.secondPe}": { import_policy: "pe-02-loopback" }, "${LOOPBACK.p}": { export_policy: "no-management" } }`,
    policies: `"pe-02-loopback": [{ if: { prefix: "${LOOPBACK.secondPe}/32" }, then: "accept" }, { then: "reject" }],
            "no-management": [{ if: { prefix_set: "management" }, then: "reject" }, { then: "accept" }],`,
    prefixSets: `management: { prefixes: ["${FIRST_MANAGEMENT}"] },`,
};

/** A router of the lab: its loopback and links in OSPF, and LDP on its links when `ldp` is given. */
function writeRouter(name: string, chr: string, management: string, loopback: string, links: Record<string, string>, ldp?: Ldp): void {
    const [host, port] = chr.split(":");
    const ports = Object.entries(links)
        .map(([link, address]) => `"${link}": { description: "lab link", addresses: ["${address}/30"] },`)
        .join("\n            ");
    const ospf = Object.keys(links)
        .map((link) => `"${link}": { network: "point-to-point" },`)
        .join(" ");
    const policy = ldp?.policy;
    const other = policy?.then === "accept" ? "reject" : "accept";
    const perNeighbor = ldp?.neighbors ? NEIGHBOR_POLICIES : { neighbors: "", policies: "", prefixSets: "" };
    const prefixSets = policy ? `${policy.prefixes}: { prefixes: ["${PREFIXES[policy.prefixes]}"] },` : "";
    const labels = policy ? `labels: [{ if: { prefix_set: "${policy.prefixes}" }, then: "${policy.then}" }, { then: "${other}" }],` : "";
    const policies =
        policy || ldp?.neighbors
            ? `prefix_sets: { ${prefixSets} ${perNeighbor.prefixSets} },
        policies: { ${labels} ${perNeighbor.policies} },`
            : "";
    const settings = [
        ldp?.targets ? `targets: ${JSON.stringify(ldp.targets)}` : "",
        policy ? `${policy.way}: "labels"` : "",
        perNeighbor.neighbors,
    ].filter((setting) => setting !== "");
    const mpls = ldp
        ? `mpls: { ldp: { lsr_id: "${loopback}", interfaces: ${JSON.stringify(Object.keys(links))}${settings.map((setting) => `, ${setting}`).join("")} } },
        ${policies}`
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
        loopback: { loopback: { addresses: ["${loopback}/32"] } },
    },
    routing: {
        router_id: "${loopback}",
        ospf: { areas: { "0.0.0.0": { interfaces: { loopback: { passive: true }, ${ospf} } } } },
        ${mpls}
    },
});
`
    );
}

/** What the lab runs beside LDP on its links. With `policies`, pe-01 gives labels for the loopbacks only, and p-01 takes none for the links. `targets` are the routers that hold a targeted session with each other. With `neighbors`, pe-01 has `NEIGHBOR_POLICIES`. */
type Lab = { policies?: boolean; targets?: Router[]; neighbors?: boolean };

/** The three routers, with LDP or without. */
function writeLab(mpls: boolean, { policies = false, targets = [], neighbors = false }: Lab = {}): void {
    const pPolicy: LdpPolicy = { way: "import_policy", prefixes: "links", then: "reject" };
    const pePolicy: LdpPolicy = { way: "export_policy", prefixes: "loopbacks", then: "accept" };
    /** LDP on a router: the LSR IDs of the other routers in `targets`, when it is one of them. */
    const ldp = (router: Router, policy?: LdpPolicy): Ldp | undefined => {
        if (!mpls) return undefined;
        const others = targets.includes(router) ? targets.filter((other) => other !== router).map((other) => LSR_ID[other]) : [];
        return {
            policy: policies ? policy : undefined,
            targets: others.length ? others : undefined,
            neighbors: neighbors && router === "pe-01",
        };
    };
    writeRouter("p-01", pChr!, "10.0.0", LOOPBACK.p, { "virtual-2": FIRST_LINK.p, "virtual-3": SECOND_LINK.p }, ldp("p-01", pPolicy));
    writeRouter("pe-01", firstPeChr!, "10.0.1", LOOPBACK.firstPe, { "virtual-2": FIRST_LINK.pe }, ldp("pe-01", pePolicy));
    writeRouter("pe-02", secondPeChr!, "10.0.2", LOOPBACK.secondPe, { "virtual-2": SECOND_LINK.pe }, ldp("pe-02"));
}

/** What `exec` printed for `commands` on `device`. */
function exec(device: string, ...commands: string[]): string {
    const { status, output } = circuit("exec", device, ...commands);
    expect(status).toBe(0);
    return output;
}

/** The LSR IDs of a router's LDP neighbors whose sessions are up, flagged `O` (operational) in `/mpls ldp neighbor print`, each with its flags. */
function neighbors(router: Router): Record<string, string> {
    return Object.fromEntries(
        exec(router, "/mpls ldp neighbor print without-paging")
            .split("\n")
            .flatMap((line) => {
                const row = /^\s*\d+\s+([A-Za-z]+)\s+\S+\s+\S+\s+(\d+\.\d+\.\d+\.\d+):0\b/.exec(line);
                return row && row[1]!.includes("O") ? [[row[2]!, row[1]!]] : [];
            })
    );
}

/** The LSR IDs of p-01's LDP neighbors whose sessions are up. */
const operationalNeighbors = () => Object.keys(neighbors("p-01")).sort();

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

/** The prefixes a router holds a label for from one LDP neighbor, by its LSR ID, as `/mpls ldp remote-mapping` prints them: a host route without its length. */
function labelsFrom(lsrId: string, router: Router = "p-01"): string[] {
    return exec(router, "/mpls ldp remote-mapping print without-paging")
        .split("\n")
        .flatMap((line) => {
            const row = /\bmain\s+(\S+)\s.*\s(\d+\.\d+\.\d+\.\d+):0\s*$/.exec(line);
            return row && row[2] === lsrId ? [row[1]!] : [];
        });
}

/** What each router holds of MPLS, for the job's log. */
function logMpls(): void {
    for (const device of ROUTERS)
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
            for (const device of ROUTERS) {
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
            for (const device of ROUTERS) expect(circuit("diff", device).status).toBe(0);
        },
        TEST_MS
    );

    test(
        "LDP's policies: pe-01 gives labels for the loopbacks only, p-01 takes none for the links, and labels still lead from loopback to loopback",
        () => {
            const fromFirst = () => labelsFrom(LOOPBACK.firstPe);
            const fromSecond = () => labelsFrom(LOOPBACK.secondPe);

            writeLab(true, { policies: true });
            for (const device of ["p-01", "pe-01"]) {
                expect(circuit("apply", device, "--confirm").status).toBe(0);
                expect(circuit("diff", device).status).toBe(0);
            }
            const filtered = eventually(() => {
                const first = fromFirst();
                const second = fromSecond();
                return (
                    first.includes(LOOPBACK.firstPe) &&
                    !first.includes(FIRST_LINK_PREFIX) &&
                    !first.includes(FIRST_MANAGEMENT) &&
                    second.includes(LOOPBACK.secondPe) &&
                    !second.includes(SECOND_LINK_PREFIX)
                );
            });
            logMpls();
            expect(filtered).toBe(true);
            expect(eventually(() => tracedLabels()[FIRST_LINK.p] !== undefined)).toBe(true);

            // Without the policies, LDP gives and takes every label again.
            writeLab(true);
            for (const device of ["p-01", "pe-01"]) {
                expect(circuit("apply", device, "--confirm").status).toBe(0);
                expect(circuit("diff", device).status).toBe(0);
            }
            expect(eventually(() => fromFirst().includes(FIRST_MANAGEMENT) && fromSecond().includes(SECOND_LINK_PREFIX))).toBe(true);
        },
        TEST_MS
    );

    test(
        "targeted LDP: pe-01 and pe-02, which are no neighbors, hold a session across p-01 and take each other's labels over it, one to p-01 as well, and none once the targets go",
        () => {
            const targeted = (router: Router, lsrId: string) => neighbors(router)[lsrId]?.includes("t") ?? false;

            writeLab(true, { targets: ["pe-01", "pe-02"] });
            for (const device of ["pe-01", "pe-02"]) {
                expect(circuit("apply", device, "--confirm").status).toBe(0);
                expect(circuit("diff", device).status).toBe(0);
            }
            const up = eventually(
                () =>
                    targeted("pe-01", LOOPBACK.secondPe) &&
                    targeted("pe-02", LOOPBACK.firstPe) &&
                    labelsFrom(LOOPBACK.secondPe, "pe-01").includes(LOOPBACK.secondPe)
            );
            logMpls();
            expect(up).toBe(true);
            // The session's own state, which the export leaves out, changes nothing to plan.
            for (const device of ["pe-01", "pe-02"]) expect(circuit("diff", device).status).toBe(0);

            // A target that is a direct neighbor takes the place of the session LDP found on the link, which stays up.
            writeLab(true, { targets: ["p-01", "pe-01", "pe-02"] });
            for (const device of ROUTERS) {
                expect(circuit("apply", device, "--confirm").status).toBe(0);
                expect(circuit("diff", device).status).toBe(0);
            }
            expect(eventually(() => targeted("p-01", LOOPBACK.firstPe) && targeted("pe-01", LOOPBACK.p))).toBe(true);
            expect(eventually(() => tracedLabels()[FIRST_LINK.p] !== undefined)).toBe(true);

            // Without targets, the session between the PEs goes, and LDP finds the one on the link again.
            writeLab(true);
            for (const device of ROUTERS) {
                expect(circuit("apply", device, "--confirm").status).toBe(0);
                expect(circuit("diff", device).status).toBe(0);
            }
            const gone = eventually(
                () =>
                    neighbors("pe-01")[LOOPBACK.secondPe] === undefined &&
                    !(neighbors("pe-01")[LOOPBACK.p]?.includes("t") ?? true) &&
                    operationalNeighbors().join() === [LOOPBACK.firstPe, LOOPBACK.secondPe].join()
            );
            logMpls();
            expect(gone).toBe(true);
        },
        TEST_MS
    );

    test(
        "label policies per neighbor: pe-01 takes only pe-02's loopback's label from pe-02 over their targeted session, and gives p-01 no label for its management network, while pe-02 still gets one",
        () => {
            writeLab(true, { targets: ["pe-01", "pe-02"], neighbors: true });
            for (const device of ["pe-01", "pe-02"]) {
                expect(circuit("apply", device, "--confirm").status).toBe(0);
                expect(circuit("diff", device).status).toBe(0);
            }
            const filtered = eventually(() => {
                const fromSecond = labelsFrom(LOOPBACK.secondPe, "pe-01");
                const atP = labelsFrom(LOOPBACK.firstPe);
                return (
                    fromSecond.join() === LOOPBACK.secondPe &&
                    labelsFrom(LOOPBACK.p, "pe-01").includes(SECOND_LINK_PREFIX) &&
                    atP.includes(LOOPBACK.firstPe) &&
                    !atP.includes(FIRST_MANAGEMENT) &&
                    labelsFrom(LOOPBACK.firstPe, "pe-02").includes(FIRST_MANAGEMENT)
                );
            });
            logMpls();
            expect(filtered).toBe(true);
            expect(eventually(() => tracedLabels()[FIRST_LINK.p] !== undefined)).toBe(true);

            // Without them, and without the targets, LDP gives and takes every label on the links again.
            writeLab(true);
            for (const device of ["pe-01", "pe-02"]) {
                expect(circuit("apply", device, "--confirm").status).toBe(0);
                expect(circuit("diff", device).status).toBe(0);
            }
            expect(eventually(() => labelsFrom(LOOPBACK.firstPe).includes(FIRST_MANAGEMENT))).toBe(true);
        },
        TEST_MS
    );

    test(
        "without MPLS in the config, each apply removes it, and diff then finds nothing to change",
        () => {
            writeLab(false);
            for (const device of ROUTERS) {
                expect(circuit("apply", device, "--confirm").status).toBe(0);
                expect(circuit("diff", device).status).toBe(0);
            }
            expect(exec("p-01", "/mpls export")).not.toMatch(/^add /m);
        },
        TEST_MS
    );
});
