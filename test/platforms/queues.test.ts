// Classes and schedulers (RFC 2475, RFC 4594), a queue's depth and RED (RFC 2309, RFC 7567), and a marking rule's class. RouterOS is applied on CHRs in CI, and edge-01 counts what each queue sends under load (routeros-chr-queues.test.ts).

import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Checks } from "../../src/checks";
import type { Device } from "../../src/model";
import { Platforms } from "../../src/platforms";
import { Project, ProjectError } from "../../src/project";

const options = { secrets: false, rollback: 10 };

/** RFC 4594's classes, as the owner's sample has them. */
const CLASSES = {
    network: { dscp: ["cs6", "cs7"] },
    voice: { dscp: ["ef"] },
    video: { dscp: ["af41", "af42", "af43"] },
    "best-effort": { dscp: ["cs0"] },
    bulk: { dscp: ["cs1", "le"] },
};

const QUEUES = [
    { class: "network", priority: "strict", max: "60k" },
    { class: "voice", priority: "strict", max: "100k" },
    { class: "video", share: 40 },
    { class: "best-effort", share: 50 },
    { class: "bulk", share: 10 },
];

/** A router of `platform` whose port `uplink` takes the scheduler `uplink`, with these groups. */
function device(platform: string, model: string, port: string, more: object = {}): Device {
    const written = {
        name: "edge-01",
        site: "lab",
        platform,
        model,
        connection: { host: "192.0.2.10", user: "netops" },
        system: { users: { netops: { role: "admin", password: { secret: "NETOPS" } } } },
        interfaces: { ethernet: { [port]: { addresses: ["198.51.100.1/30"], scheduler: "uplink" } } },
        qos: { classes: CLASSES, default_class: "best-effort", schedulers: { uplink: { rate: "400k", queues: QUEUES } } },
        ...more,
    };
    return written as Device;
}

const queues = (found: string[]) => found.filter((field) => /qos[._]|scheduler/.test(field));

/** The lines of `menu` in a render. */
function menu(text: string, name: string): string[] {
    const start = text.indexOf(`${name}\n`);
    return text
        .slice(start, text.indexOf("\n/", start + 1))
        .split("\n")
        .slice(1);
}

test("RouterOS marks each class as it leaves the port, and queues it under the scheduler's rate", () => {
    const sample = device("routeros", "CHR", "virtual-2");
    const adapter = Platforms.get("routeros");

    expect(queues(adapter.unsupported(sample))).toEqual([]);
    const text = adapter.render(sample);
    expect(adapter.plan(text, text, options).steps).toEqual([]);

    const mark = (dscp: string, queue: string) =>
        `add action=mark-packet chain=postrouting ${dscp}new-packet-mark=ether2-uplink-${queue} out-interface=ether2 passthrough=no`;
    // No port trusts the DSCP, so each routed packet is marked as trusting nothing, and takes the default class.
    const marks = [
        "add action=mark-packet chain=forward new-packet-mark=qos-trust-none packet-mark=no-mark",
        mark("", "best-effort").replace("passthrough", "packet-mark=qos-trust-none passthrough"),
        mark("dscp=48 ", "network"),
        mark("dscp=56 ", "network"),
        mark("dscp=46 ", "voice"),
        mark("dscp=34 ", "video"),
        mark("dscp=36 ", "video"),
        mark("dscp=38 ", "video"),
        mark("dscp=8 ", "bulk"),
        mark("dscp=1 ", "bulk"),
        mark("", "best-effort"),
    ];
    expect(menu(text, "/ip firewall mangle")).toEqual(marks);
    expect(menu(text, "/ipv6 firewall mangle")).toEqual(marks);

    // The strict queues keep their max, 160k, and the weighted ones share the other 240k: 40, 50, and 10 percent.
    const leaf = (queue: string, rest: string) =>
        `add ${rest.replace("NAME", `name=ether2-uplink-${queue} packet-mark=ether2-uplink-${queue} parent=ether2-uplink`)}`;
    expect(menu(text, "/queue tree")).toEqual([
        "add max-limit=400k name=ether2-uplink parent=global",
        leaf("network", "limit-at=60k max-limit=60k NAME priority=1"),
        leaf("voice", "limit-at=100k max-limit=100k NAME priority=1"),
        leaf("video", "limit-at=96k max-limit=400k NAME"),
        leaf("best-effort", "limit-at=120k max-limit=400k NAME"),
        leaf("bulk", "limit-at=24k max-limit=400k NAME"),
    ]);
});

test("RouterOS marks a class by the PCP a packet arrives with after every DSCP, and the default class's lists need no rule", () => {
    const sample = device("routeros", "CHR", "virtual-2", {
        qos: {
            classes: {
                ...CLASSES,
                voice: { dscp: ["ef"], pcp: [5] },
                video: { pcp: [4, 0] },
                "best-effort": { dscp: ["cs0"], pcp: [1] },
            },
            default_class: "best-effort",
            schedulers: { uplink: { rate: "400k", queues: QUEUES } },
        },
    });
    const adapter = Platforms.get("routeros");

    expect(queues(adapter.unsupported(sample))).toEqual([]);
    const text = adapter.render(sample);
    expect(adapter.plan(text, text, options).steps).toEqual([]);

    const mark = (match: string, queue: string, trust = "") =>
        `add action=mark-packet chain=postrouting ${match}new-packet-mark=ether2-uplink-${queue} out-interface=ether2 ${trust}passthrough=no`;
    const marks = [
        "add action=mark-packet chain=forward new-packet-mark=qos-trust-none packet-mark=no-mark",
        mark("", "best-effort", "packet-mark=qos-trust-none "),
        mark("dscp=48 ", "network"),
        mark("dscp=56 ", "network"),
        mark("dscp=46 ", "voice"),
        mark("dscp=8 ", "bulk"),
        mark("dscp=1 ", "bulk"),
        mark("ingress-priority=5 ", "voice"),
        mark("ingress-priority=4 ", "video"),
        mark("ingress-priority=0 ", "video"),
        mark("", "best-effort"),
    ];
    expect(menu(text, "/ip firewall mangle")).toEqual(marks);
    expect(menu(text, "/ipv6 firewall mangle")).toEqual(marks);
});

test("RouterOS marks in the forward chain what each in-interface trusts, and sorts by DSCP or PCP only what arrived where it is trusted", () => {
    const sample = device("routeros", "CHR", "virtual-2", {
        interfaces: {
            ethernet: {
                "virtual-2": { addresses: ["198.51.100.1/30"], scheduler: "uplink" },
                "virtual-3": { addresses: ["192.0.2.1/30"], qos_trust: ["dscp"] },
                "virtual-4": { addresses: ["192.0.2.5/30"], qos_trust: ["pcp"] },
                "virtual-5": { addresses: ["192.0.2.9/30"], qos_trust: ["pcp", "dscp"] },
                "virtual-6": { addresses: ["192.0.2.13/30"], qos_trust: [] },
            },
        },
        qos: {
            marking: [
                { if: { in_interface: "virtual-6", protocol: "udp", dst_port: 5060 }, then: { dscp: "ef" } },
                { if: { in_interface: "virtual-6", protocol: "udp" }, then: { dscp: "cs3" } },
                { if: { in_interface: "virtual-6" }, then: { pcp: 5 } },
            ],
            classes: { voice: { dscp: ["ef"], pcp: [5] }, "best-effort": { dscp: ["cs0"] } },
            default_class: "best-effort",
            schedulers: {
                uplink: {
                    rate: "400k",
                    queues: [
                        { class: "voice", priority: "strict", max: "100k" },
                        { class: "best-effort", share: 100 },
                    ],
                },
            },
        },
    });
    const adapter = Platforms.get("routeros");

    expect(queues(adapter.unsupported(sample))).toEqual([]);
    const text = adapter.render(sample);
    expect(adapter.plan(text, text, options).steps).toEqual([]);

    const mark = (match: string, queue: string, trust = "") =>
        `add action=mark-packet chain=postrouting ${match}new-packet-mark=ether2-uplink-${queue} out-interface=ether2 ${trust}passthrough=no`;
    const mangle = menu(text, "/ip firewall mangle");
    // A rule that writes a DSCP a class lists gives its class. One that writes another DSCP, or only a PCP, leaves what the port trusts.
    expect(mangle).toEqual([
        "add action=mark-packet chain=forward in-interface=ether3 new-packet-mark=qos-trust-dscp",
        "add action=mark-packet chain=forward in-interface=ether4 new-packet-mark=qos-trust-pcp",
        "add action=mark-packet chain=forward in-interface=ether5 new-packet-mark=qos-trust-dscp-pcp",
        "add action=mark-packet chain=forward new-packet-mark=qos-trust-none packet-mark=no-mark",
        "add action=mark-packet chain=postrouting new-packet-mark=ether2-uplink-voice out-interface=ether2 packet-mark=voice passthrough=no",
        "add action=mark-packet chain=postrouting new-packet-mark=ether2-uplink-best-effort out-interface=ether2 packet-mark=qos-trust-none passthrough=no",
        mark("dscp=46 ", "voice", 'packet-mark="!qos-trust-pcp" '),
        mark("ingress-priority=5 ", "voice", 'packet-mark="!qos-trust-dscp" '),
        mark("", "best-effort"),
        "add action=mark-packet chain=forward dst-port=5060 in-interface=ether6 new-packet-mark=voice protocol=udp",
        "add action=change-dscp chain=forward dst-port=5060 in-interface=ether6 new-dscp=46 passthrough=no protocol=udp",
        "add action=change-dscp chain=forward in-interface=ether6 new-dscp=24 passthrough=no protocol=udp",
        "add action=set-priority chain=forward in-interface=ether6 new-priority=5 passthrough=no",
    ]);
});

test("RouterOS schedules a LAG and a VLAN interface by their own names", () => {
    const sample = device("routeros", "CCR2216-1G-12XS-2XQ", "25g-1", {
        switching: { vlans: { customers: { id: 20 } } },
        interfaces: {
            ethernet: { "25g-1": { in_lag: "core" }, "25g-2": { trunk_vlans: ["customers"] } },
            lag: { core: { addresses: ["198.51.100.1/30"], scheduler: "uplink" } },
            vlan_interface: { customers: { vlan: "customers", addresses: ["192.0.2.1/26"], scheduler: "uplink" } },
        },
    });
    const adapter = Platforms.get("routeros");

    expect(queues(adapter.unsupported(sample))).toEqual([]);
    const tree = menu(adapter.render(sample), "/queue tree");
    expect(tree.filter((line) => line.includes("parent=global"))).toEqual([
        "add max-limit=400k name=core-uplink parent=global",
        "add max-limit=400k name=customers-uplink parent=global",
    ]);
});

test("RouterOS gives a queue with a depth a queue type of its own: a FIFO, or RED in whole packets", () => {
    const sample = device("routeros", "CHR", "virtual-2", {
        qos: {
            classes: CLASSES,
            default_class: "best-effort",
            schedulers: {
                uplink: {
                    rate: "400k",
                    queues: [
                        ...QUEUES.slice(0, 2),
                        { class: "video", share: 40, depth_packets: 50 },
                        {
                            class: "best-effort",
                            share: 50,
                            depth_packets: 200,
                            red: { min_threshold_percent: 30, max_threshold_percent: 90 },
                        },
                        { class: "bulk", share: 10, depth_packets: 99, red: { min_threshold_percent: 20, max_threshold_percent: 50 } },
                    ],
                },
            },
        },
    });
    const adapter = Platforms.get("routeros");

    expect(queues(adapter.unsupported(sample))).toEqual([]);
    const text = adapter.render(sample);
    // A packet is 1500 bytes, the thresholds are rounded down, and the burst is the lower threshold twice and the upper one once, over 3.
    expect(menu(text, "/queue type")).toEqual([
        "add kind=pfifo name=ether2-uplink-video pfifo-limit=50",
        "add kind=red name=ether2-uplink-best-effort red-avg-packet=1500 red-burst=100 red-limit=200 red-max-threshold=180 red-min-threshold=60",
        "add kind=red name=ether2-uplink-bulk red-avg-packet=1500 red-burst=29 red-limit=99 red-max-threshold=49 red-min-threshold=19",
    ]);
    expect(menu(text, "/queue tree").map((line) => /queue=(\S+)/.exec(line)?.[1])).toEqual([
        undefined,
        undefined,
        undefined,
        "ether2-uplink-video",
        "ether2-uplink-best-effort",
        "ether2-uplink-bulk",
    ]);

    // The device's export leaves out what a queue type holds as it is made: 50 packets in a FIFO.
    const exported = text.replace("pfifo-limit=50", "");
    expect(adapter.plan(text, exported, options).steps).toEqual([]);
});

test("RouterOS refuses RED whose thresholds come to the same whole packets", () => {
    const sample = device("routeros", "CHR", "virtual-2", {
        qos: {
            classes: CLASSES,
            default_class: "best-effort",
            schedulers: {
                uplink: {
                    rate: "400k",
                    queues: [
                        ...QUEUES.slice(0, 4),
                        { class: "bulk", share: 10, depth_packets: 10, red: { min_threshold_percent: 20, max_threshold_percent: 25 } },
                    ],
                },
            },
        },
    });
    expect(queues(Platforms.get("routeros").unsupported(sample))).toEqual([
        "qos.schedulers.uplink.queues[4].red: of 10 packets, both thresholds come to 2 whole packets, and RouterOS needs the lower one below the other. Set them further apart, or deepen the queue",
    ]);
});

test("RouterOS gives a packet a marking rule's class: a mark of the class's name, which each scheduler takes before any DSCP", () => {
    const sample = device("routeros", "CHR", "virtual-2", {
        qos: {
            marking: [
                { if: { protocol: "udp", dst_port: 5060 }, then: { class: "voice" } },
                { if: { dst: "203.0.113.0/24" }, then: { dscp: "cs1", class: "bulk" } },
            ],
            classes: CLASSES,
            default_class: "best-effort",
            schedulers: { uplink: { rate: "400k", queues: QUEUES } },
        },
    });
    const adapter = Platforms.get("routeros");

    expect(queues(adapter.unsupported(sample))).toEqual([]);
    const text = adapter.render(sample);
    expect(adapter.plan(text, text, options).steps).toEqual([]);

    const mangle = menu(text, "/ip firewall mangle");
    expect(mangle.slice(1, 4)).toEqual([
        "add action=mark-packet chain=postrouting new-packet-mark=ether2-uplink-voice out-interface=ether2 packet-mark=voice passthrough=no",
        "add action=mark-packet chain=postrouting new-packet-mark=ether2-uplink-bulk out-interface=ether2 packet-mark=bulk passthrough=no",
        "add action=mark-packet chain=postrouting new-packet-mark=ether2-uplink-best-effort out-interface=ether2 packet-mark=qos-trust-none passthrough=no",
    ]);
    expect(mangle.filter((line) => line.includes("chain=forward"))).toEqual([
        "add action=mark-packet chain=forward new-packet-mark=qos-trust-none packet-mark=no-mark",
        "add action=mark-packet chain=forward dst-port=5060 new-packet-mark=voice passthrough=no protocol=udp",
        "add action=mark-packet chain=forward dst-address=203.0.113.0/24 new-packet-mark=bulk",
        "add action=change-dscp chain=forward dst-address=203.0.113.0/24 new-dscp=8 passthrough=no",
    ]);
    expect(menu(text, "/ipv6 firewall mangle")).toContain(
        "add action=mark-packet chain=postrouting new-packet-mark=ether2-uplink-voice out-interface=ether2 packet-mark=voice passthrough=no"
    );
});

test("RouterOS refuses a scheduler it can't build, or whose packets would skip the queues", () => {
    const sample = device("routeros", "CCR2216-1G-12XS-2XQ", "25g-1", {
        system: { users: {}, hardware_offload: true },
        switching: { vlans: { customers: { id: 20 } } },
        interfaces: {
            ethernet: { "25g-1": { trunk_vlans: ["customers"], scheduler: "uplink", qos_trust: ["dscp"] } },
            vlan_interface: {
                customers: { vlan: "customers", addresses: ["192.0.2.1/26"], hardware_offload: false, scheduler: "uplink" },
                office: { vlan: "customers", addresses: ["192.0.2.65/26"], scheduler: "uplink" },
            },
        },
        firewall: { filter: { forward: { rules: [{ then: "accept", fast_path: true }] } } },
        qos: {
            classes: CLASSES,
            default_class: "best-effort",
            schedulers: { uplink: { queues: [{ class: "network", priority: "strict" }, ...QUEUES.slice(1)] } },
        },
    });

    expect(queues(Platforms.get("routeros").unsupported(sample))).toEqual([
        "qos.schedulers.uplink without rate: RouterOS holds packets in the queues only when more comes than a rate. Write rate, a little below the speed of each interface that takes it",
        "qos.schedulers.uplink.queues[0] strict without max: RouterOS sends a queue first only up to a rate it keeps for it. Write max, the most the class may send",
        "interfaces.ethernet.25g-1.qos_trust on a switched port or LAG, whose routed packets arrive through a VLAN interface: write it there",
        "interfaces.ethernet.25g-1.scheduler on a switched port or LAG, whose routed packets leave through a VLAN interface: write it there",
        "interfaces.ethernet.25g-1.scheduler beside a fast_path rule, whose flows skip the mangle table and the queues: take fast_path off",
        "interfaces.ethernet.25g-1.scheduler while system.hardware_offload is on, whose routed traffic skips the queues: schedule a VLAN interface with hardware_offload: false",
        "interfaces.vlan_interface.customers.scheduler beside a fast_path rule, whose flows skip the mangle table and the queues: take fast_path off",
        "interfaces.vlan_interface.office.scheduler beside a fast_path rule, whose flows skip the mangle table and the queues: take fast_path off",
        "interfaces.vlan_interface.office.scheduler while system.hardware_offload is on, whose routed traffic skips the queues: schedule a VLAN interface with hardware_offload: false",
    ]);
});

test("every other platform refuses classes and schedulers, which it does not build", () => {
    for (const [platform, model, port] of [["raisecom-ros", "RAX721-C-6C48", "1g-1"]] as const)
        expect(queues(Platforms.get(platform).unsupported(device(platform, model, port)))).toEqual([
            "qos.classes, which the platform does not build",
            "qos.default_class, which the platform does not build",
            "qos.schedulers, which the platform does not build",
            `interfaces.ethernet.${port}.scheduler, which the platform does not build`,
        ]);
});

test("validate says what is wrong in classes and schedulers", () => {
    const sample = device("routeros", "CHR", "virtual-2", {
        interfaces: {
            ethernet: { "virtual-2": { addresses: ["198.51.100.1/30"], scheduler: "uplink", shaping: { algorithm: "cake", mbps: 1 } } },
        },
        qos: {
            classes: {
                ...CLASSES,
                voice: { dscp: ["ef", "cs6"], pcp: [5] },
                video: { dscp: ["af41"], pcp: [5, 9] },
                empty: { dscp: [] },
                none: {},
            },
            schedulers: {
                uplink: {
                    rate: "fast",
                    queues: [
                        { class: "network", priority: "strict", max: "2M" },
                        { class: "voice", priority: "first" },
                        { class: "voice", share: 40 },
                        { class: "video", share: 40.5 },
                        { class: "bulk" },
                    ],
                },
                small: {
                    rate: "1M",
                    queues: [
                        { class: "network", priority: "strict", max: "1M" },
                        { class: "bulk", share: 100 },
                    ],
                },
            },
        },
    });

    const messages = Checks.run([sample], undefined).map((finding) => finding.message);
    expect(messages.filter((message) => /qos\.|scheduler/.test(message))).toEqual([
        "qos.classes without default_class: write the class of every packet no other class takes, one of network, voice, video, best-effort, bulk, empty, none",
        "qos.classes.voice.dscp: cs6 is in qos.classes.network too. A DSCP is in one class at most",
        "qos.classes.video.pcp: 5 is in qos.classes.voice too. A PCP is in one class at most",
        "qos.classes.video.pcp 9 is not a whole number from 0 to 7",
        'qos.classes.empty.dscp lists no DSCP: write at least one, such as ["ef"], or leave it out',
        'qos.classes.none lists no DSCP and no PCP: write at least one, such as dscp: ["ef"]',
        "qos.schedulers.uplink.rate fast is not a rate above 0, such as 200M, 1.5G, or 64k",
        'qos.schedulers.uplink.queues[1].priority "first" is not one: write "strict", or a share instead',
        "qos.schedulers.uplink.queues[2].class voice has a queue already: write one queue for each class",
        "qos.schedulers.uplink.queues[3].share 40.5 is not a whole percent from 1 to 100",
        'qos.schedulers.uplink.queues[4] is neither strict nor weighted: write priority: "strict", or a share',
        "qos.schedulers.uplink.queues has no queue for best-effort, empty, none: write one for each class, so none is left out",
        "qos.schedulers.uplink.queues: the shares add up to 40. Make them add up to 100",
        "qos.schedulers.small.queues has no queue for voice, video, best-effort, empty, none: write one for each class, so none is left out",
        "qos.schedulers.small: the strict queues' max add up to the rate, 1M, or more, which leaves the weighted queues nothing. Lower a max, or raise the rate",
        "interfaces.ethernet.virtual-2.scheduler beside shaping, which also shapes what leaves: write the scheduler's rate, and leave shaping out",
        'qos.classes: no port or interface trusts the DSCP, so a packet that arrives takes network, voice, video, best-effort, bulk only through a marking rule. Write qos_trust: ["dscp"] on each port whose DSCP you trust',
        'qos.classes: no port or interface trusts the PCP, so a packet that arrives takes voice, video only through a marking rule. Write qos_trust: ["pcp"] on each port whose PCP you trust',
    ]);
});

test("validate says what is wrong in a queue's depth and RED", () => {
    const sample = device("routeros", "CHR", "virtual-2", {
        qos: {
            classes: CLASSES,
            default_class: "best-effort",
            schedulers: {
                uplink: {
                    rate: "400k",
                    queues: [
                        { class: "network", priority: "strict", max: "60k", depth_packets: 0 },
                        { class: "voice", priority: "strict", max: "100k", depth_packets: 2.5 },
                        { class: "video", share: 40, red: { min_threshold_percent: 20, max_threshold_percent: 80 } },
                        {
                            class: "best-effort",
                            share: 50,
                            depth_packets: 100,
                            red: { min_threshold_percent: 80, max_threshold_percent: 20 },
                        },
                        { class: "bulk", share: 10, depth_packets: 100, red: { min_threshold_percent: -1, max_threshold_percent: 100.5 } },
                    ],
                },
            },
        },
    });

    const messages = Checks.run([sample], undefined).map((finding) => finding.message);
    expect(messages.filter((message) => /qos\.|scheduler/.test(message))).toEqual([
        "qos.schedulers.uplink.queues[0].depth_packets 0 is not a whole number of packets above 0",
        "qos.schedulers.uplink.queues[1].depth_packets 2.5 is not a whole number of packets above 0",
        "qos.schedulers.uplink.queues[2].red without depth_packets: write the queue's depth, which the thresholds are percents of",
        "qos.schedulers.uplink.queues[3].red.min_threshold_percent 80 is not below max_threshold_percent, 20: lower it, or raise the other",
        "qos.schedulers.uplink.queues[4].red.min_threshold_percent -1 is not a whole percent from 0 to 100",
        "qos.schedulers.uplink.queues[4].red.max_threshold_percent 100.5 is not a whole percent from 0 to 100",
        'qos.classes: no port or interface trusts the DSCP, so a packet that arrives takes network, voice, video, bulk only through a marking rule. Write qos_trust: ["dscp"] on each port whose DSCP you trust',
    ]);
});

const folder = mkdtempSync(join(tmpdir(), "circuit-queues-"));
afterAll(() => rmSync(folder, { recursive: true, force: true }));

test("a scheduler and a class are names the device declares", async () => {
    const router = device("routeros", "CHR", "virtual-2", {
        interfaces: { ethernet: { "virtual-2": { addresses: ["198.51.100.1/30"], scheduler: "uplnk" } } },
        qos: {
            classes: CLASSES,
            default_class: "best-effort",
            schedulers: { uplink: { rate: "400k", queues: [...QUEUES.slice(0, -1), { class: "bulky", share: 10 }] } },
            marking: [{ then: { class: "voise" } }],
        },
    });
    writeFileSync(join(folder, "circuit.ts"), `export const net = circuit({ asn: 64500, sites: { lab: { description: "lab" } } });\n`);
    mkdirSync(join(folder, "sites", "lab"), { recursive: true });
    writeFileSync(
        join(folder, "sites", "lab", "edge-01.ts"),
        `import { net } from "../../circuit";\n\nexport default net.device(${JSON.stringify(router, null, 4)});\n`
    );

    const lines = await Project.read(folder).then(
        () => [],
        (error: unknown) => (error instanceof ProjectError ? error.lines : [String(error)])
    );
    expect(lines.map((line) => line.replace(/^.*?edge-01: /, ""))).toEqual([
        "interfaces.ethernet.virtual-2.scheduler: no scheduler uplnk. Did you mean uplink?",
        "qos.schedulers.uplink.queues[4].class: no class bulky. Did you mean bulk?",
        "qos.marking[0].then.class: no class voise. Did you mean voice?",
    ]);
});
