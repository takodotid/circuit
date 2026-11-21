// Classes and schedulers (RFC 2475, RFC 4594). RouterOS is applied on CHRs in CI, and edge-01 counts what each queue sends under load (routeros-chr-queues.test.ts).

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

const queues = (found: string[]) => found.filter((field) => /qos\.|scheduler/.test(field));

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
    const marks = [
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

test("RouterOS refuses a scheduler it can't build, or whose packets would skip the queues", () => {
    const sample = device("routeros", "CCR2216-1G-12XS-2XQ", "25g-1", {
        system: { users: {}, hardware_offload: true },
        switching: { vlans: { customers: { id: 20 } } },
        interfaces: {
            ethernet: { "25g-1": { trunk_vlans: ["customers"], scheduler: "uplink" } },
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
        "interfaces.ethernet.25g-1.scheduler on a switched port or LAG, whose routed packets leave through a VLAN interface: write it there",
        "interfaces.ethernet.25g-1.scheduler beside a fast_path rule, whose flows skip the mangle table and the queues: take fast_path off",
        "interfaces.ethernet.25g-1.scheduler while system.hardware_offload is on, whose routed traffic skips the queues: schedule a VLAN interface with hardware_offload: false",
        "interfaces.vlan_interface.customers.scheduler beside a fast_path rule, whose flows skip the mangle table and the queues: take fast_path off",
        "interfaces.vlan_interface.office.scheduler beside a fast_path rule, whose flows skip the mangle table and the queues: take fast_path off",
        "interfaces.vlan_interface.office.scheduler while system.hardware_offload is on, whose routed traffic skips the queues: schedule a VLAN interface with hardware_offload: false",
    ]);
});

test("every other platform refuses classes and schedulers, which it does not build", () => {
    for (const [platform, model, port] of [
        ["junos", "QFX5100-48S-6Q", "10g-1"],
        ["fortios", "FG-3700D", "10g-1"],
        ["vrp", "CE6855-48S6Q-HI", "10g-1"],
        ["raisecom-ros", "RAX721-C-6C48", "1g-1"],
    ] as const)
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
            classes: { ...CLASSES, voice: { dscp: ["ef", "cs6"] }, empty: { dscp: [] } },
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
        "qos.classes without default_class: write the class of every DSCP no class lists, one of network, voice, video, best-effort, bulk, empty",
        "qos.classes.voice.dscp: cs6 is in qos.classes.network too. A DSCP is in one class at most",
        'qos.classes.empty.dscp lists no DSCP: write at least one, such as ["ef"]',
        "qos.schedulers.uplink.rate fast is not a rate above 0, such as 200M, 1.5G, or 64k",
        'qos.schedulers.uplink.queues[1].priority "first" is not one: write "strict", or a share instead',
        "qos.schedulers.uplink.queues[2].class voice has a queue already: write one queue for each class",
        "qos.schedulers.uplink.queues[3].share 40.5 is not a whole percent from 1 to 100",
        'qos.schedulers.uplink.queues[4] is neither strict nor weighted: write priority: "strict", or a share',
        "qos.schedulers.uplink.queues has no queue for best-effort, empty: write one for each class, so none is left out",
        "qos.schedulers.uplink.queues: the shares add up to 40. Make them add up to 100",
        "qos.schedulers.small.queues has no queue for voice, video, best-effort, empty: write one for each class, so none is left out",
        "qos.schedulers.small: the strict queues' max add up to the rate, 1M, or more, which leaves the weighted queues nothing. Lower a max, or raise the rate",
        "interfaces.ethernet.virtual-2.scheduler beside shaping, which also shapes what leaves: write the scheduler's rate, and leave shaping out",
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
    ]);
});
