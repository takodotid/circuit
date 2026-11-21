// Three CHRs, which the devices workflow boots. edge-01 routes from cpe-01 to host-01, marks a DSCP by the address each packet goes to, and schedules what leaves toward host-01. cpe-01 sends to every address at once, over the rate, and edge-01's queue counters show what each class got. An unlicensed CHR sends at most 1 Mbit/s from each interface. Skipped without the CHRs.

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
const folder = realpathSync(mkdtempSync(join(tmpdir(), "circuit-chr-queues-")));

/** A test applies to a router, and sends traffic for a while. */
const TEST_MS = 300_000;

/** host-01's end of its link to edge-01. */
const HOST = "198.51.100.2";

/** Each class: the address of host-01 that cpe-01 sends it to, the DSCP edge-01 marks it with, and the rate cpe-01 sends it at, in kbit/s. */
const CLASSES = {
    network: { address: "203.0.113.1", dscp: "cs6", kbps: 40 },
    voice: { address: "203.0.113.2", dscp: "ef", kbps: 80 },
    video: { address: "203.0.113.3", dscp: "af41", kbps: 256 },
    "best-effort": { address: "203.0.113.4", dscp: "cs0", kbps: 256 },
    bulk: { address: "203.0.113.5", dscp: "cs1", kbps: 200 },
} as const;
type ClassName = keyof typeof CLASSES;

/** The scheduler's rate, and the most each strict queue sends, in kbit/s. */
const RATE = 400;
const MAX = { network: 60, voice: 100 } as const;
/** Each weighted queue's share of what the strict queues leave, in percent. */
const SHARES = { video: 40, "best-effort": 50, bulk: 10 } as const;

/** How long cpe-01 sends, and how long it sends before edge-01 counts: until the queues are full. */
const SEND_SECONDS = 30;
const FILL_MS = 8000;
/** How long edge-01 counts what each queue sends. */
const COUNT_SECONDS = 10;
const KBIT = 1000;
const BITS_PER_BYTE = 8;
const PERCENT = 100;

/** How far a measured rate may be from what HTB gives it. A queue counted 9 in 10 of what a bandwidth test sent it, as the two count other headers. */
const MARGIN = 0.25;

/** A port's link to host-01 holds its address. The other ways put it on a LAG or a VLAN interface. */
type Link = "port" | "lag" | "vlan";

/** edge-01's queues, by their names on the device. */
const queue = (iface: string, name?: ClassName) => (name ? `${iface}-uplink-${name}` : `${iface}-uplink`);

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

/** Runs a command on a CHR over SSH, for what `circuit exec` refuses: a bandwidth test, a ping, or a count. */
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

/** edge-01, with its link to host-01 on `link`, scheduled or not. Its marking gives each address of host-01 its class's DSCP, as cpe-01 sends unmarked. */
function writeEdge(link: Link, scheduled: boolean): void {
    const scheduler = scheduled ? `, scheduler: "uplink"` : "";
    const addresses = `addresses: ["198.51.100.1/30", "2001:db8:3::1/64"]`;
    const port = {
        port: `{ description: "host-01", ${addresses}${scheduler} }`,
        lag: `{ description: "host-01", in_lag: "host" }`,
        vlan: `{ description: "host-01", access_vlan: "hosts" }`,
    }[link];
    const other = {
        port: "",
        lag: `lag: { host: { mode: "static", ${addresses}${scheduler} } },`,
        vlan: `vlan_interface: { hosts: { vlan: "hosts", ${addresses}${scheduler} } },`,
    }[link];
    const marking = Object.values(CLASSES)
        .filter(({ dscp }) => dscp !== "cs0")
        .map(({ address, dscp }) => `{ if: { dst: "${address}" }, then: { dscp: "${dscp}" } }`);
    const queues = `classes: {
            network: { dscp: ["cs6", "cs7"] },
            voice: { dscp: ["ef"] },
            video: { dscp: ["af41", "af42", "af43"] },
            "best-effort": { dscp: ["cs0"] },
            bulk: { dscp: ["cs1", "le"] },
        },
        default_class: "best-effort",
        schedulers: {
            uplink: {
                rate: "${RATE}k",
                queues: [
                    { class: "network", priority: "strict", max: "${MAX.network}k" },
                    { class: "voice", priority: "strict", max: "${MAX.voice}k" },
                    { class: "video", share: ${SHARES.video} },
                    { class: "best-effort", share: ${SHARES["best-effort"]} },
                    { class: "bulk", share: ${SHARES.bulk} },
                ],
            },
        },`;

    writeDevice(
        "edge-01",
        edgeChr!,
        `management: { allow: ["10.0.0.0/24"], ssh: {} },
    interfaces: {
        ethernet: {
            "virtual-1": { description: "Management", addresses: ["10.0.0.1/24"] },
            "virtual-2": { description: "cpe-01", addresses: ["192.0.2.1/30", "2001:db8:2::1/64"] },
            "virtual-3": ${port},
        },
        ${other}
    },
    switching: { vlans: { hosts: { id: 10 } } },
    routing: { static_routes: [{ prefix: "203.0.113.0/29", next_hop: "${HOST}" }] },
    qos: {
        marking: [${marking.join(", ")}],
        ${scheduled ? queues : ""}
    },`
    );
}

/** What each of `iface`'s queues sent, in kbit/s, and dropped, in packets, over `COUNT_SECONDS`. */
type Counted = Record<ClassName, { kbps: number; dropped: number }>;

/**
 * cpe-01 sends each class to its address at its rate, `kbps` where given. Once the queues are full, edge-01 counts what each queue of `iface` sends while cpe-01 pings host-01 with EF and with CS0. It returns the counts and each ping's average round trip, in milliseconds.
 */
async function load(iface: string, kbps: Partial<Record<ClassName, number>> = {}): Promise<{ counted: Counted; ef: number; cs0: number }> {
    const names = Object.keys(CLASSES) as ClassName[];
    const sending = names.map((name) =>
        onChr(
            cpeChr!,
            `/tool bandwidth-test address=${CLASSES[name].address} direction=transmit protocol=udp local-tx-speed=${kbps[name] ?? CLASSES[name].kbps}k duration=${SEND_SECONDS}s`
        )
    );
    await Bun.sleep(FILL_MS);

    const get = (name: ClassName, field: string) => `[/queue tree get [find name=${queue(iface, name)}] ${field}]`;
    const before = names.map((name) => `:local b${names.indexOf(name)} ${get(name, "bytes")}`).join("; ");
    const after = names
        .map((name, index) => `:put ("${name} " . (${get(name, "bytes")} - $b${index}) . " " . ${get(name, "dropped")})`)
        .join("; ");
    const [printed, ef, cs0] = await Promise.all([
        onChr(edgeChr!, `${before}; :delay ${COUNT_SECONDS}s; ${after}`),
        onChr(cpeChr!, `/ping ${HOST} count=10 interval=500ms dscp=46`),
        onChr(cpeChr!, `/ping ${HOST} count=10 interval=500ms dscp=0`),
    ]);
    await Promise.all(sending);

    const counted = Object.fromEntries(
        [...printed.matchAll(/^(\S+) (\d+) (\d+)$/gm)].map(([, name, bytes, dropped]) => [
            name,
            { kbps: (Number(bytes) * BITS_PER_BYTE) / COUNT_SECONDS / KBIT, dropped: Number(dropped) },
        ])
    ) as Counted;
    console.log(`counted on ${iface}: ${JSON.stringify(counted)}`);
    return { counted, ef: milliseconds(ef), cs0: milliseconds(cs0) };
}

/** A ping's average round trip in milliseconds, from RouterOS's `avg-rtt=1ms48us`. Without a reply, it prints none, and the round trip has no end. */
function milliseconds(output: string): number {
    const rtt = /avg-rtt=(?:(\d+)ms)?(?:(\d+)us)?/.exec(output);
    if (!rtt) return Number.POSITIVE_INFINITY;
    return Number(rtt[1] ?? 0) + Number(rtt[2] ?? 0) / KBIT;
}

/** Applies edge-01, and checks that `diff` then finds nothing to change. */
function apply(): void {
    circuit("diff", "edge-01");
    expect(circuit("apply", "edge-01", "--confirm").status).toBe(0);
    expect(circuit("diff", "edge-01").status).toBe(0);
}

describe.skipIf(!edgeChr || !cpeChr || !hostChr)("a CHR schedules what leaves an interface by class", () => {
    beforeAll(() => {
        write("circuit.ts", `export const lab = circuit({ sites: { lab: { description: "Three CHRs, linked port to port." } } });\n`);

        writeEdge("port", true);
        writeDevice(
            "cpe-01",
            cpeChr!,
            `management: { allow: ["10.0.1.0/24"], ssh: {} },
    interfaces: {
        ethernet: {
            "virtual-1": { description: "Management", addresses: ["10.0.1.1/24"] },
            "virtual-2": { description: "edge-01", addresses: ["192.0.2.2/30", "2001:db8:2::2/64"] },
        },
    },
    routing: {
        static_routes: [
            { prefix: "198.51.100.0/30", next_hop: "192.0.2.1" },
            { prefix: "203.0.113.0/29", next_hop: "192.0.2.1" },
            { prefix: "2001:db8:3::/64", next_hop: "2001:db8:2::1" },
        ],
    },`
        );
        // Each class's address is on a loopback, as RouterOS's own interface is named lo.
        writeDevice(
            "host-01",
            hostChr!,
            `management: { allow: ["10.0.2.0/24"], ssh: {} },
    interfaces: {
        ethernet: {
            "virtual-1": { description: "Management", addresses: ["10.0.2.1/24"] },
            "virtual-2": { description: "edge-01", addresses: ["${HOST}/30", "2001:db8:3::2/64"] },
        },
        loopback: { loopback: { addresses: ${JSON.stringify(Object.values(CLASSES).map(({ address }) => `${address}/32`))} } },
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
        "the marks and the queues are set, and diff then finds nothing to change",
        async () => {
            for (const device of ["cpe-01", "host-01"]) {
                expect(circuit("apply", device, "--confirm").status).toBe(0);
                expect(circuit("diff", device).status).toBe(0);
            }
            apply();
            circuit("exec", "edge-01", "/queue tree print detail");
            circuit("exec", "edge-01", "/ip firewall mangle print detail");

            // A bandwidth test needs its server, which Circuit turns off.
            await onChr(hostChr!, "/tool bandwidth-server set enabled=yes authenticate=no");
        },
        TEST_MS
    );

    test(
        "over the rate, each class is in its own queue: the strict ones are sent first, and the weighted ones share the rest",
        async () => {
            const { counted, ef, cs0 } = await load("ether3");
            for (const name of Object.keys(CLASSES) as ClassName[]) expect(counted[name].kbps).toBeGreaterThan(0);

            // Each strict queue sends all it gets, below its max.
            for (const name of ["network", "voice"] as const) expect(counted[name].kbps).toBeGreaterThan(CLASSES[name].kbps * (1 - MARGIN));

            // Each weighted queue gets at least its share of what the strict queues' max leave, the larger share more, and drops the rest. HTB lends what the strict queues leave unused to the weighted ones alike, not by share.
            const left = RATE - MAX.network - MAX.voice;
            for (const name of ["video", "best-effort", "bulk"] as const) {
                expect(counted[name].kbps).toBeGreaterThan((left * SHARES[name] * (1 - MARGIN)) / PERCENT);
                expect(counted[name].dropped).toBeGreaterThan(0);
            }
            expect(counted["best-effort"].kbps).toBeGreaterThan(counted.video.kbps);
            expect(counted.video.kbps).toBeGreaterThan(counted.bulk.kbps);

            // Together they send the rate, and no more.
            const sent = Object.values(counted).reduce((sum, { kbps }) => sum + kbps, 0);
            expect(sent).toBeGreaterThan(RATE * (1 - MARGIN));
            expect(sent).toBeLessThan(RATE * (1 + MARGIN));

            // A call waits behind no other queue, while what is sent best effort waits behind its own full queue, or is dropped.
            expect(ef).toBeLessThan(cs0);
        },
        TEST_MS
    );

    test(
        "a strict queue sends at most its max, and drops the rest",
        async () => {
            const { counted } = await load("ether3", { voice: 2 * MAX.voice });
            expect(counted.voice.kbps).toBeLessThan(MAX.voice * (1 + MARGIN));
            expect(counted.voice.kbps).toBeGreaterThan(MAX.voice * (1 - MARGIN));
            expect(counted.voice.dropped).toBeGreaterThan(0);
        },
        TEST_MS
    );

    test(
        "an IPv6 packet, and one the router sends itself, go into their class's queue",
        async () => {
            const packets = async (name: ClassName) =>
                Number(await onChr(edgeChr!, `:put [/queue tree get [find name=${queue("ether3", name)}] packets]`));
            const video = await packets("video");
            const voice = await packets("voice");

            // cpe-01 marks its own IPv6 pings AF41, as `/ping dscp=` marks no IPv6 ping (TRAPS.md).
            await onChr(cpeChr!, "/ipv6 firewall mangle add chain=output protocol=icmpv6 action=change-dscp new-dscp=34 comment=af41");
            await onChr(cpeChr!, "/ping 2001:db8:3::2 count=6");
            await onChr(cpeChr!, "/ipv6 firewall mangle remove [find comment=af41]");
            await onChr(edgeChr!, `/ping ${HOST} count=6 dscp=46`);

            expect(await packets("video")).toBeGreaterThanOrEqual(video + 4);
            expect(await packets("voice")).toBeGreaterThanOrEqual(voice + 4);
        },
        TEST_MS
    );

    test(
        "a LAG takes a scheduler as a port does",
        async () => {
            writeEdge("lag", true);
            apply();
            await onChr(cpeChr!, `/ping ${HOST} count=2`);

            const { counted } = await load("host");
            for (const name of Object.keys(CLASSES) as ClassName[]) expect(counted[name].kbps).toBeGreaterThan(0);
            expect(counted.voice.kbps).toBeGreaterThan(CLASSES.voice.kbps * (1 - MARGIN));
        },
        TEST_MS
    );

    test(
        "without the scheduler, the queues and the marks for them are removed",
        async () => {
            writeEdge("port", false);
            const planned = circuit("diff", "edge-01");
            expect(planned.status).toBe(1);
            expect(planned.output).toContain("/queue tree");
            apply();
            expect((await onChr(edgeChr!, ":put [:len [/queue tree find]]")).trim()).toBe("0");
            for (const menu of ["/ip firewall mangle", "/ipv6 firewall mangle"])
                expect((await onChr(edgeChr!, `:put [:len [${menu} find chain=postrouting]]`)).trim()).toBe("0");
        },
        TEST_MS
    );

    test(
        "a VLAN interface takes a scheduler, and loses it again",
        async () => {
            writeEdge("vlan", true);
            apply();
            await onChr(cpeChr!, `/ping ${HOST} count=2`);

            const { counted } = await load("hosts");
            for (const name of Object.keys(CLASSES) as ClassName[]) expect(counted[name].kbps).toBeGreaterThan(0);
            expect(counted.voice.kbps).toBeGreaterThan(CLASSES.voice.kbps * (1 - MARGIN));

            writeEdge("vlan", false);
            apply();
            expect((await onChr(edgeChr!, ":put [:len [/queue tree find]]")).trim()).toBe("0");
        },
        TEST_MS
    );
});
