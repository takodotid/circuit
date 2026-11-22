// LDP for IPv6 (RFC 7552) and vpnv6 (RFC 4659) on the three CHRs, the first linked to the other two. OSPF carries the IPv4 and IPv6 loopbacks, and the link to the third has link-local IPv6 addresses alone. LDP runs for IPv4, for both families, with policies, and over IPv4 with targets. The PEs carry a VRF as vpnv4 and vpnv6, then LDP runs for IPv4 again. Skipped without the three CHRs.

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
const folder = realpathSync(mkdtempSync(join(tmpdir(), "circuit-chr-mpls-ipv6-")));

/** A test applies to three routers, and waits for OSPF and LDP. */
const TEST_MS = 300_000;

/** How long OSPF and LDP have to come up, or labels to go. */
const WAIT_MS = 90_000;

const POLL_MS = 3000;

const ROUTERS = ["p-01", "pe-01", "pe-02"] as const;
type Router = (typeof ROUTERS)[number];

/** Each router's loopback addresses: its LSR ID and its IPv6 transport address. */
const LOOPBACK: Record<Router, { v4: string; v6: string }> = {
    "p-01": { v4: "192.0.2.101", v6: "2001:db8:ffff::101" },
    "pe-01": { v4: "192.0.2.102", v6: "2001:db8:ffff::102" },
    "pe-02": { v4: "192.0.2.103", v6: "2001:db8:ffff::103" },
};

/** Each router's links, by port, with their addresses. */
const LINKS: Record<Router, Record<string, string[]>> = {
    "p-01": { "virtual-2": ["192.0.2.17/30", "2001:db8:0:12::1/64"], "virtual-3": ["192.0.2.21/30"] },
    "pe-01": { "virtual-2": ["192.0.2.18/30", "2001:db8:0:12::2/64"] },
    "pe-02": { "virtual-2": ["192.0.2.22/30"] },
};

const MANAGEMENT: Record<Router, string> = { "p-01": "10.0.0", "pe-01": "10.0.1", "pe-02": "10.0.2" };

type Pe = "pe-01" | "pe-02";

/** Each PE's addresses in the VRF bank, on a loopback there. */
const BANK: Record<Pe, { v4: string; v6: string }> = {
    "pe-01": { v4: "198.51.100.1", v6: "2001:db8:101::1" },
    "pe-02": { v4: "198.51.100.2", v6: "2001:db8:101::2" },
};

/** The VRF's route distinguisher and its one route target. */
const BANK_TARGET = "64500:101";

/** p-01's IPv6 address on its link to pe-01, the first hop from pe-01. */
const FIRST_HOP = "2001:db8:0:12::1";

/** The prefixes LDP's policies tell apart, in both families: the loopbacks, and the links. */
const PREFIXES = {
    loopbacks: ["192.0.2.96/27", "2001:db8:ffff::/64"],
    links: ["192.0.2.16/28", "2001:db8:0:12::/64"],
};

/** pe-01's link to p-01, IPv4 and IPv6, as `/mpls ldp remote-mapping` prints them. pe-02 gives a label for each too. */
const FIRST_LINK_V4 = "192.0.2.16/30";
const FIRST_LINK_V6 = "2001:db8:0:12::/64";

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

/** What LDP runs with: `ipv6` for both families, and `policies` for p-01 to take no label for a link, and pe-01 to give labels for the loopbacks only. With `targets`, every router holds its sessions over IPv4, and the PEs target each other's LSR ID. With `l3vpn`, the PEs carry the VRF bank's routes to each other: vpnv4 between their LSR IDs, vpnv6 between their IPv6 addresses. */
type Lab = { ipv6: boolean; policies?: boolean; targets?: boolean; l3vpn?: boolean };

/** A router of the lab: its loopback and links in OSPF for both families, and LDP on its links. */
function writeRouter(name: Router, chr: string, { ipv6, policies = false, targets = false, l3vpn = false }: Lab): void {
    const [host, port] = chr.split(":");
    const ports = Object.entries(LINKS[name])
        .map(([link, addresses]) => `"${link}": { description: "lab link", addresses: ${JSON.stringify(addresses)} },`)
        .join("\n            ");
    const ospf = Object.keys(LINKS[name])
        .map((link) => `"${link}": { network: "point-to-point" },`)
        .join(" ");
    const families = ipv6 ? `address_families: ["ipv4", "ipv6"], ipv6_transport_address: "${LOOPBACK[name].v6}", ` : "";
    const target = { "pe-01": LOOPBACK["pe-02"].v4, "pe-02": LOOPBACK["pe-01"].v4 }[name as "pe-01" | "pe-02"];
    const targeted = targets ? `prefer_ipv4_transport: true, ${target ? `targets: ["${target}"], ` : ""}` : "";
    const policy = {
        "p-01": { way: "import_policy", set: "links", then: "reject" },
        "pe-01": { way: "export_policy", set: "loopbacks", then: "accept" },
    }[name as "p-01" | "pe-01"] as { way: string; set: keyof typeof PREFIXES; then: "accept" | "reject" } | undefined;
    const labels = policies && policy ? `${policy.way}: "labels", ` : "";
    const other = policy?.then === "accept" ? "reject" : "accept";
    const policyBlocks =
        policies && policy
            ? `prefix_sets: { ${policy.set}: { prefixes: ${JSON.stringify(PREFIXES[policy.set])} } },
        policies: { labels: [{ if: { prefix_set: "${policy.set}" }, then: "${policy.then}" }, { then: "${other}" }] },`
            : "";
    const peer = { "pe-01": "pe-02", "pe-02": "pe-01" }[name as Pe] as Pe | undefined;
    const bank = l3vpn && peer ? BANK[name as Pe] : undefined;
    const bankLoopback = bank ? `"bank-lo": { addresses: ["${bank.v4}/32", "${bank.v6}/128"], vrf: "bank" },` : "";
    const vpn =
        bank && peer
            ? `vrfs: { bank: { route_distinguisher: "${BANK_TARGET}", route_targets: { import: ["${BANK_TARGET}"], export: ["${BANK_TARGET}"] } } },
        bgp: {
            neighbors: {
                "${peer}": { address: "${LOOPBACK[peer].v4}", remote_as: 64500, local_address: "${LOOPBACK[name].v4}", address_families: ["vpnv4"] },
                "${peer}-v6": { address: "${LOOPBACK[peer].v6}", remote_as: 64500, local_address: "${LOOPBACK[name].v6}", address_families: ["vpnv6"] },
            },
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
    management: { allow: ["${MANAGEMENT[name]}.0/24"], ssh: {} },
    interfaces: {
        ethernet: {
            "virtual-1": { description: "Management", addresses: ["${MANAGEMENT[name]}.1/24"] },
            ${ports}
        },
        loopback: { loopback: { addresses: ["${LOOPBACK[name].v4}/32", "${LOOPBACK[name].v6}/128"] }, ${bankLoopback} },
    },
    routing: {
        router_id: "${LOOPBACK[name].v4}",
        ospf: { address_families: ["ipv4", "ipv6"], areas: { "0.0.0.0": { interfaces: { loopback: { passive: true }, ${ospf} } } } },
        mpls: { ldp: { lsr_id: "${LOOPBACK[name].v4}", ${families}${targeted}${labels}interfaces: ${JSON.stringify(Object.keys(LINKS[name]))} } },
        ${policyBlocks}
        ${vpn}
    },
});
`
    );
}

/** The three routers. */
function writeLab(lab: Lab): void {
    writeRouter("p-01", pChr!, lab);
    writeRouter("pe-01", firstPeChr!, lab);
    writeRouter("pe-02", secondPeChr!, lab);
}

/** What `exec` printed for `commands` on `device`. */
function exec(device: string, ...commands: string[]): string {
    const { status, output } = circuit("exec", device, ...commands);
    expect(status).toBe(0);
    return output;
}

/** Applies to each router, and finds nothing to change after. */
function applyAll(routers: readonly Router[] = ROUTERS): void {
    for (const device of routers) {
        expect(circuit("apply", device, "--confirm").status).toBe(0);
        expect(circuit("diff", device).status).toBe(0);
    }
}

/** A router's LDP sessions that are up, flagged `O`, each with its flags and the transport address it runs to, by the neighbor's LSR ID. */
function sessions(router: Router): Record<string, { flags: string; transport: string }> {
    return Object.fromEntries(
        exec(router, "/mpls ldp neighbor print detail without-paging")
            .split("\n")
            .flatMap((line) => {
                const row = /^\s*\d+\s+([A-Za-z ]*?)\s*transport=(\S+).*?\bpeer=(\d+\.\d+\.\d+\.\d+):0/.exec(line);
                return row && row[1]!.includes("O") ? [[row[3]!, { flags: row[1]!, transport: row[2]! }]] : [];
            })
    );
}

/** The prefixes p-01 holds a label for from one PE, by its LSR ID, as `/mpls ldp remote-mapping` prints them: a host route without its length. */
function labelsFrom(lsrId: string): string[] {
    return exec("p-01", "/mpls ldp remote-mapping print without-paging")
        .split("\n")
        .flatMap((line) => {
            const row = /\bmain\s+(\S+)\s.*\s(\d+\.\d+\.\d+\.\d+):0\s*$/.exec(line);
            return row && row[2] === lsrId ? [row[1]!] : [];
        });
}

/** The label p-01 put on a traceroute's probe from pe-01's IPv6 loopback to pe-02's, or nothing while it puts none. */
function tracedLabel(): number | undefined {
    const output = exec("pe-01", `/tool traceroute ${LOOPBACK["pe-02"].v6} src-address=${LOOPBACK["pe-01"].v6} count=3`);
    const hop = output.split("\n").find((line) => line.includes(FIRST_HOP) && line.includes("MPLS:L="));
    const label = hop && /MPLS:L=(\d+)/.exec(hop);
    return label ? Number(label[1]) : undefined;
}

/** The label a PE's VRF bank uses for the other PE's address there, of one family, or nothing while it has no such route. */
function bankLabel(pe: Pe, family: "v4" | "v6"): number | undefined {
    const other: Pe = pe === "pe-01" ? "pe-02" : "pe-01";
    const length = family === "v4" ? 32 : 128;
    const output = exec(pe, `/routing route print detail where routing-table=bank and dst-address=${BANK[other][family]}/${length}`);
    const label = /\blabel=(\d+)/.exec(output);
    return label ? Number(label[1]) : undefined;
}

/** Whether a PE reaches the other PE's address in the VRF bank, of one family, from its own. */
function bankPings(pe: Pe, family: "v4" | "v6"): boolean {
    const other: Pe = pe === "pe-01" ? "pe-02" : "pe-01";
    const output = exec(pe, `/ping ${BANK[other][family]} src-address=${BANK[pe][family]} vrf=bank count=3`);
    return /received=[1-9]/.test(output);
}

/** What each PE holds of the L3VPN, for the job's log. */
function logL3vpn(): void {
    for (const device of ["pe-01", "pe-02"])
        exec(
            device,
            "/routing bgp export",
            "/routing bgp session print detail",
            "/routing route print detail where routing-table=bank",
            "/mpls forwarding-table print detail"
        );
}

/** What each router holds of LDP, for the job's log. */
function logLdp(): void {
    for (const device of ROUTERS)
        exec(
            device,
            "/mpls ldp export verbose",
            "/mpls ldp neighbor print detail without-paging",
            "/mpls ldp remote-mapping print without-paging",
            "/mpls forwarding-table print without-paging"
        );
}

describe.skipIf(!pChr || !firstPeChr || !secondPeChr)("LDP for IPv6 between three CHRs", () => {
    beforeAll(() => {
        write(
            "circuit.ts",
            `export const lab = circuit({ asn: 64500, sites: { lab: { description: "Three CHRs, linked port to port." } } });\n`
        );
        writeLab({ ipv6: false });
    });

    afterAll(() => rmSync(folder, { recursive: true, force: true }));

    test(
        "with LDP for IPv4 alone, each apply converges, and p-01 holds IPv4 labels only",
        () => {
            for (const device of ROUTERS) {
                // A diff first: the first export after a boot leaves out what the apply's read would then miss (TRAPS.md).
                circuit("diff", device);
                expect(circuit("apply", device, "--confirm").status).toBe(0);
                expect(circuit("diff", device).status).toBe(0);
            }
            const up = eventually(() => labelsFrom(LOOPBACK["pe-01"].v4).includes(LOOPBACK["pe-01"].v4));
            logLdp();
            expect(up).toBe(true);
            expect(labelsFrom(LOOPBACK["pe-01"].v4)).not.toContain(LOOPBACK["pe-01"].v6);
        },
        TEST_MS
    );

    test(
        "LDP for both families: each apply converges, IPv6 routes get labels, and traffic between the PEs' IPv6 loopbacks crosses p-01 by label",
        () => {
            writeLab({ ipv6: true });
            applyAll();

            const labeled = eventually(
                () =>
                    labelsFrom(LOOPBACK["pe-01"].v4).includes(LOOPBACK["pe-01"].v6) &&
                    labelsFrom(LOOPBACK["pe-02"].v4).includes(LOOPBACK["pe-02"].v6)
            );
            logLdp();
            expect(labeled).toBe(true);
            // IPv4 keeps its labels, and the one session with each PE runs between the IPv6 addresses.
            expect(labelsFrom(LOOPBACK["pe-01"].v4)).toContain(LOOPBACK["pe-01"].v4);
            expect(sessions("p-01")[LOOPBACK["pe-01"].v4]?.transport).toBe(LOOPBACK["pe-01"].v6);

            let label: number | undefined;
            expect(
                eventually(() => {
                    label = tracedLabel();
                    return label !== undefined;
                })
            ).toBe(true);
            expect(label).toBeGreaterThanOrEqual(FIRST_DYNAMIC_LABEL);

            // LDP's own state, which an export leaves out, changes nothing to plan.
            for (const device of ROUTERS) expect(circuit("diff", device).status).toBe(0);
        },
        TEST_MS
    );

    test(
        "LDP's policies hold for both families: p-01 takes no label for a link, IPv4 or IPv6, and pe-01 gives labels for its loopbacks only",
        () => {
            writeLab({ ipv6: true, policies: true });
            applyAll(["p-01", "pe-01"]);
            const filtered = eventually(() => {
                const first = labelsFrom(LOOPBACK["pe-01"].v4);
                const second = labelsFrom(LOOPBACK["pe-02"].v4);
                return (
                    first.includes(LOOPBACK["pe-01"].v6) &&
                    first.includes(LOOPBACK["pe-01"].v4) &&
                    !first.includes(FIRST_LINK_V6) &&
                    !first.includes(`${MANAGEMENT["pe-01"]}.0/24`) &&
                    second.includes(LOOPBACK["pe-02"].v6) &&
                    !second.includes(FIRST_LINK_V4) &&
                    !second.includes(FIRST_LINK_V6)
                );
            });
            logLdp();
            expect(filtered).toBe(true);
            expect(eventually(() => tracedLabel() !== undefined)).toBe(true);

            // Without them, LDP gives and takes every label again.
            writeLab({ ipv6: true });
            applyAll(["p-01", "pe-01"]);
            expect(eventually(() => labelsFrom(LOOPBACK["pe-02"].v4).includes(FIRST_LINK_V6))).toBe(true);
        },
        TEST_MS
    );

    test(
        "sessions over IPv4: each apply converges, the PEs hold a targeted session between their LSR IDs, and IPv6 routes keep their labels, until the sessions run over IPv6 again",
        () => {
            writeLab({ ipv6: true, targets: true });
            applyAll();
            const up = eventually(() => {
                const targeted = sessions("pe-01")[LOOPBACK["pe-02"].v4];
                return (
                    targeted?.transport === LOOPBACK["pe-02"].v4 &&
                    targeted.flags.includes("t") &&
                    sessions("p-01")[LOOPBACK["pe-01"].v4]?.transport === LOOPBACK["pe-01"].v4 &&
                    labelsFrom(LOOPBACK["pe-01"].v4).includes(LOOPBACK["pe-01"].v6)
                );
            });
            logLdp();
            expect(up).toBe(true);
            expect(eventually(() => tracedLabel() !== undefined)).toBe(true);
            for (const device of ROUTERS) expect(circuit("diff", device).status).toBe(0);

            // Without the preference and the targets, the sessions run over IPv6 again.
            writeLab({ ipv6: true });
            applyAll();
            const back = eventually(
                () =>
                    sessions("p-01")[LOOPBACK["pe-01"].v4]?.transport === LOOPBACK["pe-01"].v6 &&
                    sessions("pe-01")[LOOPBACK["pe-02"].v4] === undefined
            );
            logLdp();
            expect(back).toBe(true);
        },
        TEST_MS
    );

    test(
        "vpnv6: each apply converges, each VRF takes the other's IPv4 and IPv6 routes with a label, and the two VRFs reach each other in both families, both ways",
        () => {
            writeLab({ ipv6: true, l3vpn: true });
            applyAll(["pe-01", "pe-02"]);

            const arrived = eventually(() =>
                (["pe-01", "pe-02"] as const).every((pe) => bankLabel(pe, "v4") !== undefined && bankLabel(pe, "v6") !== undefined)
            );
            logL3vpn();
            expect(arrived).toBe(true);
            expect(bankLabel("pe-02", "v6")).toBeGreaterThanOrEqual(FIRST_DYNAMIC_LABEL);
            for (const pe of ["pe-01", "pe-02"] as const)
                for (const family of ["v6", "v4"] as const) expect(eventually(() => bankPings(pe, family))).toBe(true);

            // BGP's and LDP's own state, which an export leaves out, changes nothing to plan.
            for (const device of ROUTERS) expect(circuit("diff", device).status).toBe(0);

            // Without the L3VPN, each apply converges, and the PEs hold no VRF and no BGP.
            writeLab({ ipv6: true });
            applyAll(["pe-01", "pe-02"]);
            for (const device of ["pe-01", "pe-02"]) expect(exec(device, "/routing bgp export", "/ip vrf export")).not.toMatch(/^add /m);
        },
        TEST_MS
    );

    test(
        "back to LDP for IPv4 alone: each apply converges, and the IPv6 labels go",
        () => {
            writeLab({ ipv6: false });
            applyAll();
            const gone = eventually(
                () =>
                    !labelsFrom(LOOPBACK["pe-01"].v4).includes(LOOPBACK["pe-01"].v6) &&
                    labelsFrom(LOOPBACK["pe-01"].v4).includes(LOOPBACK["pe-01"].v4)
            );
            logLdp();
            expect(gone).toBe(true);
        },
        TEST_MS
    );
});
