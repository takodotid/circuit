// Three RouterOS CHRs, which the devices workflow boots. edge-01 routes from cpe-01, over a VLAN, to host-01, and sorts what leaves toward host-01 into classes by DSCP and by the PCP each packet arrives with. cpe-01 tags its own pings with a PCP, and edge-01's queue counters show which class each took. Skipped without the CHRs.

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
const folder = realpathSync(mkdtempSync(join(tmpdir(), "circuit-chr-pcp-")));

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

/** The classes, and the queue each takes on edge-01's port to host-01. */
type ClassName = "voice" | "video" | "best-effort";
const CLASSES: readonly ClassName[] = ["voice", "video", "best-effort"];

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

/** edge-01, with these classes. Its link to cpe-01 is VLAN 20, and its port to host-01 takes the scheduler. */
function writeEdge(classes: string): void {
    writeDevice(
        "edge-01",
        edgeChr!,
        `management: { allow: ["10.0.0.0/24"], ssh: {} },
    interfaces: {
        ethernet: {
            "virtual-1": { description: "Management", addresses: ["10.0.0.1/24"] },
            "virtual-2": { description: "cpe-01", trunk_vlans: ["cpe"] },
            "virtual-3": { description: "host-01", addresses: ["198.51.100.1/30", "2001:db8:3::1/64"], scheduler: "uplink" },
        },
        vlan_interface: { cpe: { vlan: "cpe", addresses: ["192.0.2.1/30", "2001:db8:2::1/64"] } },
    },
    switching: { vlans: { cpe: { id: 20 } } },
    qos: {
        classes: ${classes},
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

/** Calls by EF or by PCP 5, video by AF41, and the rest best effort. */
const PCP_VOICE = `{ voice: { dscp: ["ef"], pcp: [5] }, video: { dscp: ["af41"] }, "best-effort": { dscp: ["cs0"] } }`;

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

/** Applies edge-01, and checks that `diff` then finds nothing to change. */
function apply(): void {
    circuit("diff", "edge-01");
    expect(circuit("apply", "edge-01", "--confirm").status).toBe(0);
    expect(circuit("diff", "edge-01").status).toBe(0);
}

describe.skipIf(!edgeChr || !cpeChr || !hostChr)("a CHR sorts what it routes into classes by the PCP it arrives with", () => {
    beforeAll(() => {
        write("circuit.ts", `export const lab = circuit({ sites: { lab: { description: "Three CHRs, linked port to port." } } });\n`);

        writeEdge(PCP_VOICE);
        writeDevice(
            "cpe-01",
            cpeChr!,
            `management: { allow: ["10.0.1.0/24"], ssh: {} },
    interfaces: {
        ethernet: {
            "virtual-1": { description: "Management", addresses: ["10.0.1.1/24"] },
            "virtual-2": { description: "edge-01", trunk_vlans: ["edge"] },
        },
        vlan_interface: { edge: { vlan: "edge", addresses: ["192.0.2.2/30", "2001:db8:2::2/64"] } },
    },
    switching: { vlans: { edge: { id: 20 } } },
    routing: {
        static_routes: [
            { prefix: "198.51.100.0/30", next_hop: "192.0.2.1" },
            { prefix: "2001:db8:3::/64", next_hop: "2001:db8:2::1" },
        ],
    },`
        );
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
        "the classes and their queues are set, and diff then finds nothing to change",
        () => {
            for (const device of ["cpe-01", "host-01"]) {
                expect(circuit("apply", device, "--confirm").status).toBe(0);
                expect(circuit("diff", device).status).toBe(0);
            }
            apply();
            circuit("exec", "edge-01", "/ip firewall mangle print detail");
        },
        TEST_MS
    );

    test(
        "a ping tagged with PCP 5 takes the voice queue, in both families",
        async () => {
            const sent = await ping(5, 0);
            expect(sent.voice).toBeGreaterThanOrEqual(ARRIVED * FAMILIES.length);
            expect(sent["best-effort"]).toBeLessThan(ARRIVED);
        },
        TEST_MS
    );

    test(
        "a DSCP that a class lists goes first: PCP 5 with AF41 takes the video queue",
        async () => {
            const sent = await ping(5, 34);
            expect(sent.video).toBeGreaterThanOrEqual(ARRIVED * FAMILIES.length);
            expect(sent.voice).toBeLessThan(ARRIVED);
        },
        TEST_MS
    );

    test(
        "a ping tagged with PCP 0 takes the default class",
        async () => {
            const sent = await ping(0, 0);
            expect(sent["best-effort"]).toBeGreaterThanOrEqual(ARRIVED * FAMILIES.length);
            expect(sent.voice).toBeLessThan(ARRIVED);
        },
        TEST_MS
    );

    test(
        "a PCP moved to another class takes that class's queue, PCP 0 too, and without them the default class's",
        async () => {
            // PCP 0 too, which RouterOS's export must print to leave an empty plan.
            writeEdge(`{ voice: { dscp: ["ef"] }, video: { dscp: ["af41"], pcp: [0, 5] }, "best-effort": { dscp: ["cs0"] } }`);
            apply();
            expect((await ping(5, 0)).video).toBeGreaterThanOrEqual(ARRIVED * FAMILIES.length);
            expect((await ping(0, 0)).video).toBeGreaterThanOrEqual(ARRIVED * FAMILIES.length);

            writeEdge(`{ voice: { dscp: ["ef"] }, video: { dscp: ["af41"] }, "best-effort": { dscp: ["cs0"] } }`);
            apply();
            for (const { menu } of FAMILIES) expect(await onChr(edgeChr!, `${menu} export`)).not.toContain("ingress-priority");
            expect((await ping(5, 0))["best-effort"]).toBeGreaterThanOrEqual(ARRIVED * FAMILIES.length);
        },
        TEST_MS
    );
});
