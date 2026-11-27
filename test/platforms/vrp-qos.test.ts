// Classes and schedulers on VRP, tried on a CE6855 on V200R005C00SPC800 with `commit trial` on spare port 10GE1/0/48. The marking policy was on that port, in place of the whole switch. The next plan differed only by that and the owner's ports. A change and the removal went into a candidate. `PRINTED` is what the switch printed.

import { expect, test } from "bun:test";
import type { Device, QosTrust } from "../../src/model";

type Qos = NonNullable<Device["qos"]>;
import { Vrp } from "../../src/platforms/vrp/index";
import { Fixtures } from "../fixtures";

const vrp = new Vrp();
const options = { secrets: false, rollback: 10 };
const base = Fixtures.device("single-site--switch");
const sent = (desired: string, current: string) => vrp.plan(desired, current, options).steps.flatMap((step) => step.send);

const marking: Qos["marking"] = [
    { if: { src: "192.0.2.0/28", protocol: "udp", dst_port: 5060 }, then: { dscp: "cs5" } },
    { if: { src: "192.0.2.0/28", dscp: "af11" }, then: { dscp: "voice-admit", class: "best-effort" } },
    { if: { src: "192.0.2.0/28" }, then: { class: "bulk" } },
    { if: { dst: "198.51.100.0/28" }, then: { dscp: "ef", class: "video" } },
];

const byDscp: Qos = {
    marking,
    classes: {
        "best-effort": { dscp: ["cs0"] },
        network: { dscp: ["cs6", "cs7"] },
        voice: { dscp: ["ef"] },
        video: { dscp: ["af41", "af42", "af43"] },
        bulk: { dscp: ["cs1", "le"] },
    },
    default_class: "best-effort",
    schedulers: {
        uplink: {
            rate: "95M",
            queues: [
                { class: "voice", priority: "strict", max: "20M" },
                { class: "network", share: 10 },
                { class: "video", share: 40 },
                { class: "best-effort", share: 40 },
                { class: "bulk", share: 10 },
            ],
        },
    },
};

const byPcp: Qos = {
    ...byDscp,
    classes: { "best-effort": { pcp: [0] }, network: { pcp: [6, 7] }, voice: { pcp: [5] }, video: { pcp: [4] }, bulk: { pcp: [1] } },
};

/** The single-site switch with one port, the spare one, which trusts what it is told, and these classes. */
function queued(qos: Qos | undefined, trust: readonly QosTrust[] = ["dscp", "pcp"]): Device {
    return {
        ...base,
        interfaces: {
            ...base.interfaces,
            ethernet: { "10g-48": { access_vlan: "home", scheduler: qos ? "uplink" : undefined, qos_trust: trust } },
        },
        qos,
    };
}

/** The port, the domain, and the behaviors of `byPcp` as the switch printed them: some lines end with spaces, and rates carry their unit. */
const PRINTED = `diffserv domain circuit
 8021p-inbound 1 phb af4 green
 8021p-inbound 2 phb be green
 8021p-inbound 3 phb be green
 8021p-inbound 4 phb af3 green
 8021p-inbound 5 phb af2 green
 8021p-inbound 6 phb af1 green
 8021p-inbound 7 phb af1 green
#
traffic behavior circuit-dscp-cs5
 remark dscp cs5
#
traffic behavior circuit-marking-2
 remark dscp 44
 remark local-precedence be
#
traffic behavior circuit-marking-3
 remark local-precedence af4
#
traffic behavior circuit-marking-4
 remark dscp ef
 remark local-precedence af3
#
interface 10GE1/0/48
 port default vlan 20
 trust upstream circuit
 qos lr cir 95000 kbps outbound
 qos phb marking 8021p disable
 qos queue 2 shaping cir 20000 kbps pir 20000 kbps
 qos drr 0 to 1 3 to 4
 qos queue 0 drr weight 40
 qos queue 1 drr weight 10
 qos queue 3 drr weight 40
 qos queue 4 drr weight 10
#
`;

/** The render with the domain, the behaviors, and the port as the switch printed them. */
const printed = (render: string) =>
    `${render
        .replace(/^diffserv domain circuit\n[\s\S]*?^#\n/m, "")
        .replace(/^traffic behavior [\s\S]*?^#\n(?=traffic policy)/m, "")
        .replace(/^interface 10GE1\/0\/48\n[\s\S]*?^#\n/m, "")}${PRINTED}`;

test("VRP sorts classes by PCP in a domain of its own, queues them on the port, and plans nothing against how the switch prints them", () => {
    const desired = vrp.render(queued(byPcp));

    // The default class takes queue 0, and the others queue 1 on, in the order they are written. PCP 0 is in queue 0 already.
    expect(desired).not.toContain("8021p-inbound 0 ");
    expect(desired).not.toContain("trust dscp");
    expect(vrp.plan(desired, printed(desired), options).steps).toEqual([]);
    expect(vrp.unsupported(queued(byPcp))).toEqual([]);
    expect(vrp.experimental(queued(byPcp))).toEqual([
        "qos.marking",
        "qos.classes",
        "qos.schedulers.uplink",
        "qos.marking[1].then.class",
        "qos.marking[2].then.class",
        "qos.marking[3].then.class",
        "interfaces.ethernet.10g-48.qos_trust",
    ]);
});

test("VRP sorts classes by DSCP, and a packet without one, or with a DSCP no class lists, takes the default class's queue", () => {
    const desired = vrp.render(queued(byDscp));

    expect(desired).toContain(" trust dscp\n trust upstream circuit\n qos phb marking 8021p disable\n");
    // EF is voice's, in queue 2. AF43 keeps the color the switch gives it. CS5 is no class's, and goes to queue 0 with the rest.
    expect(desired).toContain(" ip-dscp-inbound 46 phb af2 green\n");
    expect(desired).toContain(" ip-dscp-inbound 38 phb af3 red\n");
    expect(desired).toContain(" ip-dscp-inbound 40 phb be green\n");
    expect(desired).toContain(" 8021p-inbound 7 phb be green\n");
    // A rule that writes a DSCP also sets the queue of its class, as the switch sorted the packet by the DSCP it arrived with.
    expect(desired).toContain("traffic behavior circuit-dscp-cs5\n remark dscp cs5\n remark local-precedence be\n#");
    expect(vrp.unsupported(queued(byDscp))).toEqual([]);
});

test("VRP sends every weight again after a new list of weighted queues, and removes the domain once no port trusts it", () => {
    const current = vrp.render(queued(byDscp));
    const changed: Qos = {
        ...byDscp,
        marking: marking.map((rule, index) => (index === 2 ? { ...rule, then: { class: "voice" } } : rule)),
        classes: { ...byDscp.classes, video: { dscp: ["af41", "af42"] } },
        schedulers: {
            uplink: {
                rate: "90M",
                queues: [
                    { class: "voice", share: 10 },
                    { class: "network", priority: "strict", max: "5M" },
                    { class: "video", share: 40 },
                    { class: "best-effort", share: 30 },
                    { class: "bulk", share: 20 },
                ],
            },
        },
    };

    // `undo qos drr` takes the weights of its queues with it.
    expect(sent(vrp.render(queued(changed)), current)).toEqual([
        "traffic behavior circuit-marking-3",
        "remark local-precedence af2",
        "quit",
        "diffserv domain circuit",
        "undo ip-dscp-inbound 38",
        "ip-dscp-inbound 38 phb be red",
        "quit",
        "interface 10GE1/0/48",
        "undo qos lr outbound",
        "undo qos queue 2 shaping",
        "undo qos drr 0 to 1 3 to 4",
        "qos drr 0 2 to 4",
        "qos queue 1 shaping cir 5000 kbps pir 5000 kbps",
        "qos lr cir 90000 kbps outbound",
        "qos queue 0 drr weight 30",
        "qos queue 2 drr weight 10",
        "qos queue 3 drr weight 40",
        "qos queue 4 drr weight 20",
        "quit",
    ]);

    const removal = vrp.plan(vrp.render(queued(undefined)), current, options).steps;
    expect(removal.at(-1)).toEqual({
        title: "DiffServ domains no longer used",
        show: ["- diffserv domain circuit"],
        send: ["undo diffserv domain circuit"],
    });
    expect(removal.find((step) => step.title === "interface 10GE1/0/48")?.send).toEqual([
        "interface 10GE1/0/48",
        "undo qos lr outbound",
        "undo qos queue 2 shaping",
        "undo qos drr 0 to 1 3 to 4",
        "undo qos phb marking 8021p disable",
        "undo trust upstream",
        "undo trust",
        "quit",
    ]);
});

test("a VRP port that doesn't trust what the classes sort by takes a domain that puts every PCP in the default class's queue", () => {
    for (const [qos, trust] of [
        [byDscp, ["pcp"]],
        [byPcp, ["dscp"]],
        [byPcp, []],
    ] as const) {
        const desired = vrp.render(queued(qos, trust));
        const untrusted = Array.from({ length: 7 }, (_, at) => ` 8021p-inbound ${at + 1} phb be green`);
        expect(desired).toContain(["diffserv domain circuit-untrusted", ...untrusted, "#"].join("\n"));
        expect(desired).toContain(
            "interface 10GE1/0/48\n port default vlan 20\n trust upstream circuit-untrusted\n qos phb marking 8021p disable\n"
        );
        expect(desired).not.toContain("trust dscp");
    }

    // A port that trusts takes Circuit's domain, and no port needs the other.
    expect(vrp.render(queued(byDscp, ["dscp"]))).not.toContain("circuit-untrusted");

    const removal = vrp.plan(vrp.render(queued(undefined)), vrp.render(queued(byDscp, [])), options).steps;
    expect(removal.at(-1)?.send).toEqual(["undo diffserv domain circuit-untrusted", "undo diffserv domain circuit"]);
});

test("VRP refuses trust on a VLAN interface, which the switch sorts on its ports", () => {
    const sample: Device = {
        ...queued(byDscp),
        interfaces: {
            ...queued(byDscp).interfaces,
            vlan_interface: {
                ...base.interfaces?.vlan_interface,
                home: { vlan: "home", addresses: ["198.51.100.1/24"], qos_trust: ["dscp"] },
            },
        },
    };
    expect(vrp.unsupported(sample).filter((gap) => gap.includes("qos_trust"))).toEqual([
        "interfaces.vlan_interface.home.qos_trust on a VLAN interface: the switch sorts a packet on the port it arrives on. Write it on the VLAN's ports",
    ]);
});

test("VRP refuses what its 8 queues can't hold, and what V200R005 has no setting for", () => {
    const nine = Object.fromEntries(["a", "b", "c", "d", "e", "f", "g", "h", "i"].map((name, at) => [name, { pcp: [at % 8] }]));
    const refused: Qos = {
        classes: { ...nine, voice: { dscp: ["ef"] } },
        default_class: "a",
        schedulers: {
            uplink: {
                rate: "95500500",
                queues: [
                    { class: "voice", priority: "strict", max: "32k" },
                    { class: "a", priority: "strict" },
                    { class: "b", share: 100, depth_packets: 100, red: { min_threshold_percent: 20, max_threshold_percent: 50 } },
                ],
            },
        },
    } as unknown as Qos;
    const device: Device = {
        ...queued(refused),
        interfaces: {
            ...queued(refused).interfaces,
            lag: { uplink: { mode: "lacp", scheduler: "uplink" } },
            vlan_interface: {
                mgmt: {
                    ...base.interfaces!.vlan_interface!.mgmt!,
                    scheduler: "uplink",
                    rate_limit: { per_prefix: { ipv4: 32, ipv6: 64, input: "5M" } },
                },
            },
        },
    } as unknown as Device;

    expect(vrp.unsupported(device)).toEqual(
        expect.arrayContaining([
            "qos.classes, 10 of them: a port has 8 queues",
            "qos.classes by DSCP and by PCP at once: a port sorts its packets by their DSCP or by their PCP, not by the DSCP and then the PCP",
            "qos.classes beside a LAG, not built yet: no Eth-Trunk has taken the trust settings",
            "qos.schedulers.uplink, 2 strict queues: the switch sends the higher queue first, where Circuit's take turns",
            "qos.schedulers.uplink.queues[0].max, whole kbit/s from 64k to 100G",
            "qos.schedulers.uplink.queues[2].depth_packets, V200R005 sets no depth in packets",
            "qos.schedulers.uplink.queues[2].red, which needs depth_packets",
            "interfaces.lag.uplink.scheduler, on a LAG, not built yet",
            "interfaces.vlan_interface.mgmt.scheduler, on a VLAN interface: the switch queues on its ports",
            "interfaces.vlan_interface.mgmt.rate_limit.per_prefix, the CE6855 has no rate for each address: its CAR polices a port or a traffic class as a whole",
        ])
    );
});
