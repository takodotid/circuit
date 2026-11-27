// Classes, schedulers, and marking on Junos. A QFX5100-48S-6Q on 21.4R3-S8.5 took each render in a private candidate, where `commit check` passed. `show | display set` printed the lines below, and the next plan was empty. Change and removal each left an empty plan too. Nothing was committed.

import { expect, test } from "bun:test";
import type { Device } from "../../src/model";
import { Platforms } from "../../src/platforms";

const options = { secrets: false, rollback: 10 };
const platform = Platforms.get("junos");

const CLASSES = {
    voice: { dscp: ["ef"] },
    video: { dscp: ["af41", "af42", "af43"] },
    "best-effort": { dscp: ["cs0"] },
};

const QUEUES = [
    { class: "voice", priority: "strict", max: "100M" },
    { class: "video", share: 60 },
    { class: "best-effort", share: 40 },
];

/** A switch with a trunk, an access port, a routed port, each trusting the DSCP and the PCP, and a VLAN interface, and these groups. */
function device(more: object = {}, qos: object = {}): Device {
    const written = {
        name: "tor-01",
        site: "lab",
        platform: "junos",
        model: "QFX5100-48S-6Q",
        connection: { host: "192.0.2.10", user: "netops" },
        system: {
            users: {
                root: { role: "admin", password: { secret: "ROOT" } },
                netops: { role: "admin", password: { secret: "NETOPS" } },
            },
        },
        switching: { vlans: { hosts: { id: 10 } } },
        interfaces: {
            ethernet: {
                "10g-1": { trunk_vlans: ["hosts"], scheduler: "uplink", qos_trust: ["dscp", "pcp"] },
                "10g-2": { access_vlan: "hosts", qos_trust: ["dscp", "pcp"] },
                "10g-3": { addresses: ["203.0.113.1/24", "2001:db8:3::1/64"], qos_trust: ["dscp", "pcp"] },
            },
            vlan_interface: { hosts: { vlan: "hosts", addresses: ["198.51.100.1/24", "2001:db8:10::1/64"] } },
        },
        qos: { classes: CLASSES, default_class: "best-effort", schedulers: { uplink: { queues: QUEUES } }, ...qos },
        ...more,
    };
    return written as Device;
}

const qosLines = (text: string) => text.split("\n").filter((line) => /class-of-service|marking/.test(line));

test("Junos writes a forwarding class for each class, classifiers where packets arrive, and a scheduler map, as a QFX5100 printed them", () => {
    const sample = device();
    expect(platform.unsupported(sample)).toEqual([]);

    const lines = qosLines(platform.render(sample));
    const classified = lines.filter((line) => line.includes("classifiers dscp circuit forwarding-class"));
    expect(classified).toHaveLength(64);
    expect(lines.filter((line) => line.includes("classifiers ieee-802.1 circuit forwarding-class best-effort"))).toHaveLength(8);
    for (const line of [
        "set class-of-service forwarding-classes class voice queue-num 0",
        "set class-of-service forwarding-classes class video queue-num 1",
        "set class-of-service forwarding-classes class best-effort queue-num 2",
        "set class-of-service classifiers dscp circuit forwarding-class voice loss-priority low code-points 101110",
        "set class-of-service classifiers dscp circuit forwarding-class video loss-priority low code-points 100010",
        "set class-of-service classifiers dscp circuit forwarding-class best-effort loss-priority low code-points 000000",
        "set class-of-service classifiers dscp circuit forwarding-class best-effort loss-priority low code-points 000001",
        "set class-of-service interfaces xe-0/0/0 unit 0 classifiers dscp circuit",
        "set class-of-service interfaces xe-0/0/0 unit 0 classifiers ieee-802.1 circuit",
        "set class-of-service interfaces xe-0/0/1 unit 0 classifiers dscp circuit",
        "set class-of-service interfaces xe-0/0/2 classifiers dscp circuit",
        "set class-of-service interfaces xe-0/0/2 classifiers ieee-802.1 circuit",
        "set class-of-service schedulers uplink-voice priority strict-high",
        "set class-of-service schedulers uplink-voice shaping-rate 100m",
        "set class-of-service schedulers uplink-video transmit-rate percent 60",
        "set class-of-service schedulers uplink-best-effort transmit-rate percent 40",
        "set class-of-service scheduler-maps uplink forwarding-class voice scheduler uplink-voice",
        "set class-of-service scheduler-maps uplink forwarding-class video scheduler uplink-video",
        "set class-of-service scheduler-maps uplink forwarding-class best-effort scheduler uplink-best-effort",
        "set class-of-service interfaces xe-0/0/0 scheduler-map uplink",
    ])
        expect(lines).toContain(line);
});

test("Junos sorts by the PCP a packet arrives with, and a port without tags by PCP 0", () => {
    const sample = device({}, { classes: { voice: { pcp: [5] }, video: { pcp: [4] }, "best-effort": { dscp: ["cs0"], pcp: [0] } } });
    expect(platform.unsupported(sample)).toEqual([]);

    const lines = qosLines(platform.render(sample));
    expect(lines).toContain("set class-of-service classifiers ieee-802.1 circuit forwarding-class voice loss-priority low code-points 101");
    expect(lines).toContain("set class-of-service classifiers ieee-802.1 circuit forwarding-class video loss-priority low code-points 100");
    expect(lines.filter((line) => line.includes("classifiers dscp circuit forwarding-class best-effort"))).toHaveLength(64);
    // A trunk sorts IP by the PCP too, so it takes no DSCP classifier. An access port and a routed port carry no tag.
    expect(lines).not.toContain("set class-of-service interfaces xe-0/0/0 unit 0 classifiers dscp circuit");
    expect(lines).toContain("set class-of-service interfaces xe-0/0/1 unit 0 classifiers dscp circuit");
    expect(lines).toContain("set class-of-service interfaces xe-0/0/2 classifiers dscp circuit");
});

test("a Junos port that doesn't trust what the classes sort by takes classifiers that put every code point in the default class", () => {
    const ports = (dscp: readonly string[], pcp: readonly string[]) => ({
        interfaces: {
            ethernet: {
                "10g-1": { trunk_vlans: ["hosts"], qos_trust: dscp },
                "10g-2": { access_vlan: "hosts", qos_trust: pcp },
                "10g-3": { addresses: ["203.0.113.1/24"] },
            },
        },
    });
    const byDscp = qosLines(platform.render(device(ports(["dscp"], ["pcp"]), { schedulers: undefined })));
    expect(byDscp.filter((line) => line.includes("classifiers dscp circuit-untrusted forwarding-class best-effort"))).toHaveLength(64);
    expect(byDscp.filter((line) => line.includes("classifiers ieee-802.1 circuit-untrusted forwarding-class best-effort"))).toHaveLength(8);
    expect(byDscp.filter((line) => line.startsWith("set class-of-service interfaces"))).toEqual([
        "set class-of-service interfaces xe-0/0/0 unit 0 classifiers dscp circuit",
        "set class-of-service interfaces xe-0/0/0 unit 0 classifiers ieee-802.1 circuit",
        "set class-of-service interfaces xe-0/0/1 unit 0 classifiers dscp circuit-untrusted",
        "set class-of-service interfaces xe-0/0/1 unit 0 classifiers ieee-802.1 circuit-untrusted",
        "set class-of-service interfaces xe-0/0/2 classifiers dscp circuit-untrusted",
        "set class-of-service interfaces xe-0/0/2 classifiers ieee-802.1 circuit-untrusted",
    ]);

    const byPcp = qosLines(
        platform.render(
            device(ports(["dscp"], ["pcp"]), { schedulers: undefined, classes: { voice: { pcp: [5] }, "best-effort": { dscp: ["cs0"] } } })
        )
    );
    expect(byPcp.filter((line) => line.startsWith("set class-of-service interfaces"))).toEqual([
        "set class-of-service interfaces xe-0/0/0 unit 0 classifiers dscp circuit-untrusted",
        "set class-of-service interfaces xe-0/0/0 unit 0 classifiers ieee-802.1 circuit-untrusted",
        "set class-of-service interfaces xe-0/0/1 unit 0 classifiers dscp circuit",
        "set class-of-service interfaces xe-0/0/1 unit 0 classifiers ieee-802.1 circuit",
        "set class-of-service interfaces xe-0/0/2 classifiers dscp circuit-untrusted",
        "set class-of-service interfaces xe-0/0/2 classifiers ieee-802.1 circuit-untrusted",
    ]);

    // Every port trusts the DSCP: no classifier puts all in the default class.
    expect(qosLines(platform.render(device())).some((line) => line.includes("circuit-untrusted"))).toBe(false);
});

test("Junos refuses trust on a VLAN interface, and names trust experimental", () => {
    const sample = device({
        interfaces: {
            ethernet: { "10g-1": { trunk_vlans: ["hosts"], qos_trust: ["dscp"] } },
            vlan_interface: { hosts: { vlan: "hosts", addresses: ["198.51.100.1/24"], qos_trust: ["dscp"] } },
        },
    });
    expect(platform.unsupported(sample).filter((field) => field.includes("qos_trust"))).toEqual([
        "interfaces.vlan_interface.hosts.qos_trust on a VLAN interface: a QFX5100 sorts a packet on the port it arrives on, and an IRB interface takes no classifier. Write it on the VLAN's ports",
    ]);
    expect(platform.experimental?.(sample)).toContain("interfaces.ethernet.10g-1.qos_trust");
});

test("Junos refuses what a QFX5100 can't do with classes and schedulers", () => {
    const many = Object.fromEntries(Array.from({ length: 9 }, (_, index) => [`class-${index}`, { dscp: [`cs${index % 8}`] }]));
    const sample = device(
        {
            switching: { vlans: { hosts: { id: 10 }, carrier: { id: 20 } } },
            interfaces: {
                ethernet: { "10g-1": { in_lag: "uplink" }, "10g-2": { in_lag: "uplink" }, "10g-4": { qinq_vlan: "carrier" } },
                lag: { uplink: { trunk_vlans: ["hosts"], scheduler: "uplink" } },
                vlan_interface: { hosts: { vlan: "hosts", addresses: ["198.51.100.1/24"], scheduler: "uplink" } },
            },
        },
        {
            classes: { ...CLASSES, voice: { dscp: ["ef"], pcp: [5] } },
            schedulers: {
                uplink: {
                    rate: "1G",
                    queues: [
                        { class: "voice", priority: "strict", max: "100M" },
                        { class: "video", priority: "strict", max: "100M" },
                        {
                            class: "best-effort",
                            share: 100,
                            depth_packets: 100,
                            red: { min_threshold_percent: 20, max_threshold_percent: 50 },
                        },
                    ],
                },
            },
        }
    );
    expect(platform.unsupported(sample).filter((field) => /qos\.|scheduler/.test(field))).toEqual([
        "qos.classes by DSCP and by PCP: a QFX5100 sorts an IP packet by its DSCP alone once a port has a DSCP classifier, so a DSCP that no class lists can't fall back to the PCP. Sort by one of them",
        "qos.classes beside a QinQ VLAN, whose frames arrive on units the switch doesn't classify: it classifies unit 0 only",
        "qos.schedulers.uplink.rate, which a QFX5100 can't keep: Junos ignores a port's shaping-rate there. Leave rate out, and the queues share the port's speed",
        "qos.schedulers.uplink.queues, several strict queues, which Juniper doesn't document as taking turns on a QFX5100. On a QFX5200 the higher queue goes first. Write one strict queue",
        "qos.schedulers.uplink.queues[2].depth_packets, which a QFX5100 can't set: it gives a queue a part of its port's buffer, in percent of the bytes, not a number of packets",
        "qos.schedulers.uplink.queues[2].red, which a QFX5100 can't set: its RED counts in percent of the queue's buffer, which is no number of packets",
        "interfaces.lag.uplink.scheduler, with a strict queue's max: on a LAG the platform shapes each member to the rate",
        "interfaces.vlan_interface.hosts.scheduler on a VLAN interface: a QFX5100 schedules the queues of a port or LAG. Write it on the ports the VLAN leaves through",
    ]);

    const crowded = device({}, { classes: many, default_class: "class-0", schedulers: undefined });
    expect(platform.unsupported(crowded)).toContain("qos.classes, 9 of them: a QFX5100 has 8 queues for unicast, one for each class");
});

test("Junos warns that a QFX5100 floods and multicasts from a queue no class holds", () => {
    expect(platform.checks!(device())).toEqual([
        {
            level: "warning",
            device: "tor-01",
            message:
                "qos.schedulers: a QFX5100 sends broadcast, multicast, and flooded frames from a queue of their own, mcast, which no class of a scheduler holds",
        },
    ]);
    const unscheduled = device({ interfaces: { ethernet: { "10g-2": { access_vlan: "hosts" } } } }, { schedulers: undefined });
    expect(platform.checks!(unscheduled)).toEqual([]);
});

test("a Junos code point or class taken off a classifier is deleted alone, and a port's classifier by its type", () => {
    const before = platform.render(device());
    const sent = (classes: object) =>
        platform.plan(platform.render(device({}, { classes })), before, options).steps.flatMap((step) => step.send);

    expect(sent({ ...CLASSES, video: { dscp: ["af41"] } })).toEqual([
        "delete class-of-service classifiers dscp circuit forwarding-class video loss-priority low code-points 100100",
        "delete class-of-service classifiers dscp circuit forwarding-class video loss-priority low code-points 100110",
        "set class-of-service classifiers dscp circuit forwarding-class best-effort loss-priority low code-points 100100",
        "set class-of-service classifiers dscp circuit forwarding-class best-effort loss-priority low code-points 100110",
    ]);

    const byPcp = sent({ voice: { pcp: [5] }, video: { pcp: [4] }, "best-effort": { dscp: ["cs0"] } });
    expect(byPcp).toContain("delete class-of-service classifiers dscp circuit forwarding-class voice");
    expect(byPcp).toContain("delete class-of-service interfaces xe-0/0/0 unit 0 classifiers dscp circuit");
    expect(byPcp).toContain("set class-of-service classifiers ieee-802.1 circuit forwarding-class voice loss-priority low code-points 101");

    const removed = platform.render(device({}, { classes: undefined, default_class: undefined, schedulers: undefined }));
    expect(platform.plan(removed, before, options).steps.flatMap((step) => step.send)).toEqual(["delete class-of-service"]);
});

test("Junos marks in a filter of each family on each interface where routed packets arrive, and gives a new DSCP its class", () => {
    const sample = device(
        {},
        {
            schedulers: undefined,
            marking: [
                { description: "calls", if: { protocol: "udp", dst_port: 5060 }, then: { dscp: "ef" } },
                { if: { src: ["198.51.100.128/25", "2001:db8:10::/64"], dscp: ["cs1", "af11"] }, then: { class: "video" } },
                { if: { family: "ipv6", dst_port: [443, { min: 10000, max: 20000 }] }, then: { dscp: "af41", class: "voice" } },
            ],
        }
    );
    expect(platform.unsupported(sample)).toEqual([]);

    const lines = qosLines(platform.render(sample)).filter((line) => line.includes("marking"));
    expect(lines).toEqual([
        'set firewall family inet filter circuit-marking term "1 calls" from protocol udp',
        'set firewall family inet filter circuit-marking term "1 calls" from destination-port 5060',
        'set firewall family inet filter circuit-marking term "1 calls" then dscp 46',
        'set firewall family inet filter circuit-marking term "1 calls" then forwarding-class voice',
        'set firewall family inet filter circuit-marking term "1 calls" then loss-priority low',
        'set firewall family inet filter circuit-marking term "1 calls" then accept',
        "set firewall family inet filter circuit-marking term 2 from source-address 198.51.100.128/25",
        "set firewall family inet filter circuit-marking term 2 from dscp 8",
        "set firewall family inet filter circuit-marking term 2 from dscp 10",
        "set firewall family inet filter circuit-marking term 2 then forwarding-class video",
        "set firewall family inet filter circuit-marking term 2 then loss-priority low",
        "set firewall family inet filter circuit-marking term 2 then accept",
        "set firewall family inet filter circuit-marking term circuit-default then accept",
        "set interfaces xe-0/0/2 unit 0 family inet filter input circuit-marking",
        "set interfaces irb unit 10 family inet filter input circuit-marking",
        'set firewall family inet6 filter circuit-marking-v6 term "1 calls" from next-header udp',
        'set firewall family inet6 filter circuit-marking-v6 term "1 calls" from destination-port 5060',
        'set firewall family inet6 filter circuit-marking-v6 term "1 calls" then traffic-class 46',
        'set firewall family inet6 filter circuit-marking-v6 term "1 calls" then forwarding-class voice',
        'set firewall family inet6 filter circuit-marking-v6 term "1 calls" then loss-priority low',
        'set firewall family inet6 filter circuit-marking-v6 term "1 calls" then accept',
        "set firewall family inet6 filter circuit-marking-v6 term 2 from source-address 2001:db8:10::/64",
        "set firewall family inet6 filter circuit-marking-v6 term 2 from traffic-class 8",
        "set firewall family inet6 filter circuit-marking-v6 term 2 from traffic-class 10",
        "set firewall family inet6 filter circuit-marking-v6 term 2 then forwarding-class video",
        "set firewall family inet6 filter circuit-marking-v6 term 2 then loss-priority low",
        "set firewall family inet6 filter circuit-marking-v6 term 2 then accept",
        "set firewall family inet6 filter circuit-marking-v6 term 3 from next-header tcp",
        "set firewall family inet6 filter circuit-marking-v6 term 3 from next-header udp",
        "set firewall family inet6 filter circuit-marking-v6 term 3 from destination-port 443",
        "set firewall family inet6 filter circuit-marking-v6 term 3 from destination-port 10000-20000",
        "set firewall family inet6 filter circuit-marking-v6 term 3 then traffic-class 34",
        "set firewall family inet6 filter circuit-marking-v6 term 3 then forwarding-class voice",
        "set firewall family inet6 filter circuit-marking-v6 term 3 then loss-priority low",
        "set firewall family inet6 filter circuit-marking-v6 term 3 then accept",
        "set firewall family inet6 filter circuit-marking-v6 term circuit-default then accept",
        "set interfaces xe-0/0/2 unit 0 family inet6 filter input circuit-marking-v6",
        "set interfaces irb unit 10 family inet6 filter input circuit-marking-v6",
    ]);
});

test("Junos marks without classes, and keeps the class a PCP gave", () => {
    const plain = device({}, { classes: undefined, default_class: undefined, schedulers: undefined, marking: [{ then: { dscp: "cs1" } }] });
    expect(platform.unsupported(plain)).toEqual([]);
    expect(qosLines(platform.render(plain)).filter((line) => line.includes("term 1"))).toEqual([
        "set firewall family inet filter circuit-marking term 1 then dscp 8",
        "set firewall family inet filter circuit-marking term 1 then accept",
        "set firewall family inet6 filter circuit-marking-v6 term 1 then traffic-class 8",
        "set firewall family inet6 filter circuit-marking-v6 term 1 then accept",
    ]);

    const byPcp = device(
        {},
        { classes: { voice: { pcp: [5] }, "best-effort": { pcp: [0] } }, schedulers: undefined, marking: [{ then: { dscp: "ef" } }] }
    );
    expect(qosLines(platform.render(byPcp)).filter((line) => line.includes("forwarding-class voice") && line.includes("term 1"))).toEqual(
        []
    );
});

test("Junos refuses what a QFX5100's marking filter can't do", () => {
    const sample = device(
        {
            switching: { vlans: { hosts: { id: 10 } }, acls: { edge: [{ then: "accept" }] } },
            interfaces: {
                ethernet: { "10g-3": { addresses: ["203.0.113.1/24"], ingress_acl: "edge" } },
                vlan_interface: { hosts: { vlan: "hosts", addresses: ["198.51.100.1/24"] } },
            },
        },
        {
            schedulers: undefined,
            marking: [
                { then: { pcp: 5 } },
                { if: { in_interface: "hosts" }, then: { dscp: "ef" } },
                { if: { out_interface: "hosts" }, then: { dscp: "ef" } },
                { if: { protocol: "icmp", dst_port: 7 }, then: { dscp: "ef" } },
            ],
        }
    );
    expect(platform.unsupported(sample).filter((field) => /marking/.test(field))).toEqual([
        "qos.marking[0].then.pcp, which a QFX5100 sets only with a rewrite rule on the port a packet leaves through, for every packet of a class, the ones it switches too",
        "qos.marking[1].if.in_interface, not built yet",
        "qos.marking[2].if.out_interface, which the filter can't see: it sits where packets arrive, before the switch routes them",
        "qos.marking[3].if, ports with protocol icmp: only TCP and UDP have ports",
        "interfaces.ethernet.10g-3.ingress_acl beside qos.marking: a routed port takes one filter of each family",
    ]);
});

test("Junos refuses a rate for each prefix, which a QFX5100 ignores", () => {
    const sample = device({
        interfaces: { ethernet: { "10g-2": { access_vlan: "hosts", rate_limit: { per_prefix: { ipv4: 32, ipv6: 64, output: "20M" } } } } },
    });
    expect(platform.unsupported(sample)).toContain(
        "interfaces.ethernet.10g-2.rate_limit.per_prefix, which a QFX5100 can't police: Junos ignores prefix-action, its policer for each prefix, there"
    );
});

test("every Junos QoS key is experimental, as only commit check ran", () => {
    const sample = device({}, { marking: [{ then: { dscp: "ef" } }] });
    expect(platform.experimental!(sample)).toEqual(
        expect.arrayContaining(["qos.classes", "qos.default_class", "qos.schedulers", "interfaces.ethernet.10g-1.scheduler", "qos.marking"])
    );
});
