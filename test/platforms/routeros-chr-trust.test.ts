// Three RouterOS CHRs, which the devices workflow boots. edge-01 routes from cpe-01 to host-01, and sorts what leaves toward host-01 into classes by what its link to cpe-01 trusts: a VLAN interface, a routed port, or a LAG. cpe-01 tags its own pings with a PCP and a DSCP, and edge-01's queue counters show which class each took. Skipped without the CHRs.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Ssh } from "../../src/transport/ssh";

/** Each CHR's SSH, as `host:port`. Each has the user `operator`, with the password in CIRCUIT_TEST_CHR_PASSWORD. */
const edgeChr = process.env.CIRCUIT_TEST_CHR;
const cpeChr = process.env.CIRCUIT_TEST_CHR_B;
const hostChr = process.env.CIRCUIT_TEST_CHR_C;
const password = process.env.CIRCUIT_TEST_CHR_PASSWORD ?? "";

const repo = join(import.meta.dir, "..", "..");
const folder = realpathSync(mkdtempSync(join(tmpdir(), "circuit-chr-trust-")));

/** A test applies to a router, and pings. */
const TEST_MS = 300_000;

/** host-01's addresses in each family, and each family's firewall menu and ICMP. */
const FAMILIES = [
    { host: "198.51.100.2", menu: "/ip firewall mangle", icmp: "icmp" },
    { host: "2001:db8:3::2", menu: "/ipv6 firewall mangle", icmp: "icmpv6" },
] as const;

/** The pings cpe-01 sends in each family, and how many of them must reach their queue: the first may wait for the neighbor. */
const PINGS = 5;
const ARRIVED = 4;

/** The DSCPs and PCPs the pings carry. */
const EF = 46;
const AF41 = 34;
const VOICE_PCP = 5;

/** The classes, and the queue each takes on edge-01's port to host-01. */
type ClassName = "voice" | "video" | "best-effort";
const CLASSES: readonly ClassName[] = ["voice", "video", "best-effort"];

/** How edge-01 reaches cpe-01: over VLAN 20, on a routed port, or on a LAG of one port. */
type Link = "vlan" | "port" | "lag";

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

/** Runs a command on a CHR over SSH, for what `circuit exec` refuses: a ping, a rule that marks it, or a count. */
async function onChr(chr: string, command: string): Promise<string> {
    const [host, port] = chr.split(":");
    const client = await Ssh.connect({ host: host!, port: Number(port), user: "operator+ct", password: () => password });
    try {
        const output = await Ssh.exec(client, command);
        console.log(`$ ${chr} ${command}\n${output}`);
        return output;
    } finally {
        client.end();
    }
}

/** A file of the lab project. */
function write(path: string, text: string): void {
    mkdirSync(dirname(join(folder, path)), { recursive: true });
    writeFileSync(join(folder, path), text);
}

/** A device of the lab project on `chr`, with these groups. */
function writeDevice(name: string, chr: string, groups: string): void {
    const [host, port] = chr.split(":");
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
    ${groups}
});
`
    );
}

/** edge-01, its link to cpe-01 trusting `trust`, with these marking rules. Its port to host-01 takes the scheduler. */
function writeEdge(link: Link, trust: string, marking = "[]"): void {
    const addresses = `addresses: ["192.0.2.1/30", "2001:db8:2::1/64"], qos_trust: ${trust}`;
    const port = {
        vlan: `{ description: "cpe-01", trunk_vlans: ["cpe"] }`,
        port: `{ description: "cpe-01", ${addresses} }`,
        lag: `{ description: "cpe-01", in_lag: "cpe" }`,
    }[link];
    const other = {
        vlan: `vlan_interface: { cpe: { vlan: "cpe", ${addresses} } },`,
        port: "",
        lag: `lag: { cpe: { mode: "static", ${addresses} } },`,
    }[link];
    writeDevice(
        "edge-01",
        edgeChr!,
        `management: { allow: ["10.0.0.0/24"], ssh: {} },
    interfaces: {
        ethernet: {
            "virtual-1": { description: "Management", addresses: ["10.0.0.1/24"] },
            "virtual-2": ${port},
            "virtual-3": { description: "host-01", addresses: ["198.51.100.1/30", "2001:db8:3::1/64"], scheduler: "uplink" },
        },
        ${other}
    },
    switching: { vlans: { cpe: { id: 20 } } },
    qos: {
        marking: ${marking},
        classes: { voice: { dscp: ["ef"], pcp: [5] }, video: { dscp: ["af41"] }, "best-effort": { dscp: ["cs0"] } },
        default_class: "best-effort",
        schedulers: {
            uplink: {
                rate: "900k",
                queues: [
                    { class: "voice", priority: "strict", max: "200k" },
                    { class: "video", share: 50 },
                    { class: "best-effort", share: 50 },
                ],
            },
        },
    },`
    );
}

/** cpe-01, its link to edge-01 tagged with VLAN 20 or not. */
function writeCpe(tagged: boolean): void {
    const addresses = `addresses: ["192.0.2.2/30", "2001:db8:2::2/64"]`;
    writeDevice(
        "cpe-01",
        cpeChr!,
        `management: { allow: ["10.0.1.0/24"], ssh: {} },
    interfaces: {
        ethernet: {
            "virtual-1": { description: "Management", addresses: ["10.0.1.1/24"] },
            "virtual-2": ${tagged ? `{ description: "edge-01", trunk_vlans: ["edge"] }` : `{ description: "edge-01", ${addresses} }`},
        },
        ${tagged ? `vlan_interface: { edge: { vlan: "edge", ${addresses} } },` : ""}
    },
    switching: { vlans: { edge: { id: 20 } } },
    routing: {
        static_routes: [
            { prefix: "198.51.100.0/30", next_hop: "192.0.2.1" },
            { prefix: "2001:db8:3::/64", next_hop: "2001:db8:2::1" },
        ],
    },`
    );
}

/** How many packets each queue on edge-01's port to host-01 has sent. */
async function packets(): Promise<Record<ClassName, number>> {
    const counts = await Promise.all(
        CLASSES.map(async (name) => Number(await onChr(edgeChr!, `:put [/queue tree get [find name=ether3-uplink-${name}] packets]`)))
    );
    return Object.fromEntries(CLASSES.map((name, index) => [name, counts[index]])) as Record<ClassName, number>;
}

/** cpe-01 pings host-01 in both families with this PCP and DSCP, which it sets on its own pings, and returns how many more packets each queue sent. */
async function ping(pcp: number, dscp: number): Promise<Record<ClassName, number>> {
    for (const { menu, icmp } of FAMILIES) {
        await onChr(cpeChr!, `${menu} add chain=output protocol=${icmp} action=set-priority new-priority=${pcp} comment=pcp`);
        await onChr(cpeChr!, `${menu} add chain=output protocol=${icmp} action=change-dscp new-dscp=${dscp} comment=dscp`);
    }
    const before = await packets();
    for (const { host } of FAMILIES) await onChr(cpeChr!, `/ping ${host} count=${PINGS} interval=200ms`);
    const after = await packets();
    for (const { menu } of FAMILIES)
        for (const comment of ["pcp", "dscp"]) await onChr(cpeChr!, `${menu} remove [find comment=${comment}]`);

    const sent = Object.fromEntries(CLASSES.map((name) => [name, after[name] - before[name]])) as Record<ClassName, number>;
    console.log(`PCP ${pcp}, DSCP ${dscp}: ${JSON.stringify(sent)}`);
    return sent;
}

/** Applies `device`, and checks that `diff` then finds nothing to change. */
function apply(device = "edge-01"): void {
    circuit("diff", device);
    expect(circuit("apply", device, "--confirm").status).toBe(0);
    expect(circuit("diff", device).status).toBe(0);
}

describe.skipIf(!edgeChr || !cpeChr || !hostChr)("a CHR sorts by the DSCP and PCP only what arrives where they are trusted", () => {
    beforeAll(() => {
        write("circuit.ts", `export const lab = circuit({ sites: { lab: { description: "Three CHRs, linked port to port." } } });\n`);

        writeEdge("vlan", "[]");
        writeCpe(true);
        writeDevice(
            "host-01",
            hostChr!,
            `management: { allow: ["10.0.2.0/24"], ssh: {} },
    interfaces: {
        ethernet: {
            "virtual-1": { description: "Management", addresses: ["10.0.2.1/24"] },
            "virtual-2": { description: "edge-01", addresses: ["198.51.100.2/30", "2001:db8:3::2/64"] },
        },
    },
    routing: {
        static_routes: [
            { prefix: "192.0.2.0/30", next_hop: "198.51.100.1" },
            { prefix: "2001:db8:2::/64", next_hop: "2001:db8:3::1" },
        ],
    },`
        );
    });

    afterAll(() => rmSync(folder, { recursive: true, force: true }));

    test(
        "the trust marks and the queues are set, and diff then finds nothing to change",
        () => {
            for (const device of ["cpe-01", "host-01"]) apply(device);
            apply();
            circuit("exec", "edge-01", "/ip firewall mangle print detail");
        },
        TEST_MS
    );

    test(
        "where nothing is trusted, a ping marked EF with PCP 5 takes the default class, in both families",
        async () => {
            const sent = await ping(VOICE_PCP, EF);
            expect(sent["best-effort"]).toBeGreaterThanOrEqual(ARRIVED * FAMILIES.length);
            expect(sent.voice).toBeLessThan(ARRIVED);
        },
        TEST_MS
    );

    test(
        "a ping the router sends itself, marked EF, takes the voice queue",
        async () => {
            const before = await packets();
            await onChr(edgeChr!, `/ping 198.51.100.2 count=${PINGS} interval=200ms dscp=${EF}`);
            expect((await packets()).voice - before.voice).toBeGreaterThanOrEqual(ARRIVED);
        },
        TEST_MS
    );

    test(
        "where nothing is trusted, a marking rule that writes EF gives the voice class",
        async () => {
            writeEdge("vlan", "[]", `[{ if: { in_interface: "cpe" }, then: { dscp: "ef" } }]`);
            apply();
            const sent = await ping(0, 0);
            expect(sent.voice).toBeGreaterThanOrEqual(ARRIVED * FAMILIES.length);
            expect(sent["best-effort"]).toBeLessThan(ARRIVED);
        },
        TEST_MS
    );

    test(
        "trusting the DSCP, EF takes the voice queue and PCP 5 alone the default class",
        async () => {
            writeEdge("vlan", `["dscp"]`);
            apply();
            expect((await ping(0, EF)).voice).toBeGreaterThanOrEqual(ARRIVED * FAMILIES.length);
            expect((await ping(VOICE_PCP, 0))["best-effort"]).toBeGreaterThanOrEqual(ARRIVED * FAMILIES.length);
        },
        TEST_MS
    );

    test(
        "trusting the PCP, PCP 5 takes the voice queue and AF41 alone the default class, and a marking rule that writes a DSCP no class lists changes neither",
        async () => {
            writeEdge("vlan", `["pcp"]`, `[{ if: { in_interface: "cpe" }, then: { dscp: "cs3" } }]`);
            apply();
            expect((await ping(VOICE_PCP, 0)).voice).toBeGreaterThanOrEqual(ARRIVED * FAMILIES.length);
            expect((await ping(0, AF41))["best-effort"]).toBeGreaterThanOrEqual(ARRIVED * FAMILIES.length);
        },
        TEST_MS
    );

    test(
        "a routed port and a LAG trust the DSCP as a VLAN interface does",
        async () => {
            writeEdge("port", `["dscp"]`);
            writeCpe(false);
            apply();
            apply("cpe-01");
            expect((await ping(0, EF)).voice).toBeGreaterThanOrEqual(ARRIVED * FAMILIES.length);

            writeEdge("port", "[]");
            apply();
            expect((await ping(0, EF))["best-effort"]).toBeGreaterThanOrEqual(ARRIVED * FAMILIES.length);

            writeEdge("lag", `["dscp"]`);
            apply();
            expect((await ping(0, EF)).voice).toBeGreaterThanOrEqual(ARRIVED * FAMILIES.length);
            expect(await onChr(edgeChr!, "/ip firewall mangle export")).toContain("in-interface=cpe");
        },
        TEST_MS
    );
});
