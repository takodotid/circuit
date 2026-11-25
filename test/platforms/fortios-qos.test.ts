// Classes, schedulers, and marking on FortiOS (decision 226), as a FG-3700D on FortiOS 6.2.2 took them in a test VDOM.

import { expect, test } from "bun:test";
import type { Device } from "../../src/model";
import { FortiOs } from "../../src/platforms/fortios";

const platform = new FortiOs();
const options = { secrets: false, rollback: 10 };

const firewall: Device = {
    name: "fw-01",
    site: "lab",
    platform: "fortios",
    model: "FG-3700D",
    connection: { host: "127.0.0.1", user: "netops" },
    system: { users: { netops: { role: "admin", password: { secret: "EXAMPLE_NETOPS_PASSWORD" } } } },
    management: { allow: ["192.0.2.0/24"], ssh: {} },
    interfaces: {
        ethernet: {
            "10g-1": { description: "Upstream", addresses: ["203.0.113.2/30"], scheduler: "wan" },
            "10g-2": { description: "Tenants", addresses: ["198.51.100.1/24"] },
        },
    },
    qos: {
        marking: [
            {
                description: "Calls from the tenants",
                if: { in_interface: "10g-2", protocol: "udp", dst_port: 5060 },
                then: { dscp: "cs5" },
            },
            { if: { dscp: "ef" }, then: { dscp: "af41" } },
            { if: { src: "198.51.100.7/32" }, then: { class: "voice" } },
        ],
        classes: { voice: { dscp: ["ef", "cs5"] }, video: { dscp: ["af41"] }, best: { dscp: ["cs0"] } },
        default_class: "best",
        schedulers: {
            wan: {
                rate: "100M",
                queues: [
                    { class: "voice", priority: "strict", max: "20M" },
                    { class: "video", share: 50 },
                    { class: "best", share: 50, depth_packets: 200 },
                ],
            },
        },
    },
};

/** The sections a render holds, each as `show` prints it. */
function section(rendered: string, name: string): string {
    return new RegExp(`^config ${name}\\n[\\s\\S]*?^end$`, "m").exec(rendered)?.[0] ?? "";
}

test("classes are traffic classes from 2, and each DSCP a class lists is a shaping policy of each family", () => {
    const rendered = platform.render(firewall);

    expect(section(rendered, "firewall traffic-class")).toBe(
        [
            "config firewall traffic-class",
            "    edit 2",
            '        set class-name "voice"',
            "    next",
            "    edit 3",
            '        set class-name "video"',
            "    next",
            "    edit 4",
            '        set class-name "best"',
            "    next",
            "end",
        ].join("\n")
    );
    const policies = section(rendered, "firewall shaping-policy");
    expect(policies).toContain(
        [
            "    edit 6",
            '        set name "voice-ef"',
            '        set srcintf "any"',
            '        set dstintf "any"',
            '        set srcaddr "all"',
            '        set dstaddr "all"',
            '        set service "ALL"',
            "        set tos-mask 0xfc",
            "        set tos 0xb8",
            "        set class-id 2",
            "    next",
        ].join("\n")
    );
    expect(policies).toContain('        set name "voice-ef-v6"\n        set ip-version 6');
    expect(policies).toContain('        set name "video-af41"');
    // The default class takes what no policy sorts.
    expect(policies).not.toContain("best-cs0");
});

test("a marking rule comes first, sets the DSCP, and gives the class of the DSCP it sets or the class it names", () => {
    const policies = section(platform.render(firewall), "firewall shaping-policy");

    expect(policies).toContain(
        [
            "    edit 1",
            '        set name "marking-1"',
            '        set comment "Calls from the tenants"',
            '        set srcintf "port6"',
            '        set dstintf "any"',
            '        set srcaddr "all"',
            '        set dstaddr "all"',
            '        set service "udp/5060"',
            "        set diffserv-forward enable",
            "        set diffservcode-forward 101000",
            "        set class-id 2",
            "    next",
        ].join("\n")
    );
    expect(policies).toContain(
        "        set tos-mask 0xfc\n        set tos 0xb8\n        set diffserv-forward enable\n        set diffservcode-forward 100010\n        set class-id 3"
    );
    expect(policies).toMatch(/set name "marking-3"\n(?:.*\n)*? {8}set srcaddr "198.51.100.7\/32"\n(?:.*\n)*? {8}set class-id 2\n {4}next/);
    expect(policies).not.toMatch(/set name "marking-3"\n(?:.*\n)*? {8}set diffserv-forward/);
});

test("a scheduler is a shaping profile that queues, in whole percents of the interface's outbandwidth", () => {
    const rendered = platform.render(firewall);

    expect(section(rendered, "firewall shaping-profile")).toBe(
        [
            "config firewall shaping-profile",
            '    edit "wan"',
            "        set type queuing",
            "        set default-class-id 4",
            "        config shaping-entries",
            "            edit 1",
            "                set class-id 2",
            "                set priority top",
            "                set guaranteed-bandwidth-percentage 20",
            "                set maximum-bandwidth-percentage 20",
            "            next",
            "            edit 2",
            "                set class-id 3",
            "                set priority low",
            "                set guaranteed-bandwidth-percentage 40",
            "                set maximum-bandwidth-percentage 100",
            "            next",
            "            edit 3",
            "                set class-id 4",
            "                set priority low",
            "                set guaranteed-bandwidth-percentage 40",
            "                set maximum-bandwidth-percentage 100",
            "                set limit 200",
            "            next",
            "        end",
            "    next",
            "end",
        ].join("\n")
    );
    expect(rendered).toMatch(/edit "port5"\n(?:.*\n)*? {8}set outbandwidth 100000\n {8}set egress-shaping-profile "wan"/);
    expect(platform.unsupported(firewall)).toEqual([]);
    expect(platform.experimental(firewall)).toEqual([]);
});

test("FortiOS refuses what its shaping policies and profiles can't hold", () => {
    const refused = (device: Device) => platform.unsupported(device).filter((gap) => /qos|rate_limit|offload|fast_path/.test(gap));
    const qos = firewall.qos!;
    const wan = qos.schedulers!.wan!;

    expect(refused({ ...firewall, system: { ...firewall.system, hardware_offload: true } })).toEqual([
        "system.hardware_offload beside qos.marking or a scheduler: on 6.2 an offloaded session skips the egress shaping profile (Fortinet bug 469798), and no offloaded session was seen marked. Write system.hardware_offload: false, which writes auto-asic-offload disable on each policy that accepts, or leave qos out",
    ]);
    expect(
        refused({
            ...firewall,
            qos: {
                ...qos,
                marking: [{ then: { pcp: 5 } }],
                classes: { ...qos.classes, voice: { dscp: ["ef"], pcp: [5] } },
                schedulers: {
                    wan: {
                        rate: "100M",
                        queues: [
                            { class: "voice", priority: "strict", max: "20500k" },
                            {
                                class: "video",
                                share: 50,
                                depth_packets: 100,
                                red: { min_threshold_percent: 20, max_threshold_percent: 50 },
                            },
                            { class: "best", share: 50, depth_packets: 3 },
                        ],
                    },
                },
            },
        })
    ).toEqual([
        "qos.classes.voice.pcp, FortiOS 6.2's shaping policies match no PCP: list the DSCPs the class's packets carry",
        "qos.marking[0].then.pcp, FortiOS 6.2 sets a PCP only in a firewall policy: set a DSCP",
        "qos.schedulers.wan.queues[0].max, FortiOS takes a whole percent of the scheduler's rate, 100M",
        "qos.schedulers.wan.queues[1].red, FortiOS's RED needs a drop probability, which Circuit has no key for: write depth_packets alone",
        "qos.schedulers.wan.queues[2].depth_packets, FortiOS takes 5 to 10000 packets",
    ]);
    expect(refused({ ...firewall, qos: { ...qos, schedulers: { wan: { ...wan, rate: undefined } } } })).toEqual([
        "qos.schedulers.wan without rate: FortiOS shares out an interface's outbandwidth, so write the rate",
    ]);

    const limited: Device = {
        ...firewall,
        interfaces: {
            ethernet: {
                ...firewall.interfaces!.ethernet,
                "10g-2": { addresses: ["198.51.100.1/24"], rate_limit: { per_prefix: { ipv4: 32, ipv6: 128, output: "10M" } } },
            },
        },
    };
    expect(refused(limited)).toEqual([
        "interfaces.ethernet.10g-2.rate_limit.per_prefix, FortiOS 6.2's per-IP shaper counts a session by the address that started it, so a session from outside would count against the far end",
        "interfaces.ethernet.10g-2.rate_limit beside qos.marking or qos.classes: FortiOS gives a session one shaping policy, and both need it. Write a scheduler's rate instead",
    ]);
});

test("an interface takes its shaping profile after the profile is made, and lets go of it before the profile goes", () => {
    const rendered = platform.render(firewall);
    const bare = platform.render({
        ...firewall,
        qos: undefined,
        interfaces: { ethernet: { ...firewall.interfaces!.ethernet, "10g-1": { description: "Upstream", addresses: ["203.0.113.2/30"] } } },
    });

    const titles = (plan: ReturnType<typeof platform.plan>) => plan.steps.map((step) => step.title);
    const added = platform.plan(rendered, bare, options);
    expect(added.problems).toEqual([]);
    expect(titles(added).indexOf("system interface, shaping")).toBeGreaterThan(titles(added).indexOf("firewall shaping-profile"));
    expect(added.steps.find((step) => step.title === "system interface, shaping")?.send).toEqual([
        "config system interface",
        'edit "port5"',
        "set outbandwidth 100000",
        'set egress-shaping-profile "wan"',
        "next",
        "end",
    ]);

    const removed = platform.plan(bare, rendered, options);
    expect(removed.problems).toEqual([]);
    expect(titles(removed).indexOf("system interface, shaping")).toBeLessThan(titles(removed).indexOf("firewall shaping-profile, removed"));
    expect(removed.steps.find((step) => step.title === "system interface, shaping")?.send).toEqual([
        "config system interface",
        'edit "port5"',
        "unset egress-shaping-profile",
        "unset outbandwidth",
        "next",
        "end",
    ]);
});

// A FG-3700D on 6.2.2 refused a shaping entry that raised its guarantee first: `Sum of 'guaranteed-bandwidth-percentage' of all shaping-entries > 100%`.
test("a shaping entry that lowers its guarantee goes before one that raises it", () => {
    const wan = firewall.qos!.schedulers!.wan!;
    const before = platform.render(firewall);
    const after = platform.render({
        ...firewall,
        qos: {
            ...firewall.qos,
            schedulers: { wan: { ...wan, queues: [{ class: "voice", priority: "strict", max: "30M" }, wan.queues[1]!, wan.queues[2]!] } },
        },
    });

    const step = platform.plan(after, before, options).steps.find((one) => one.title === "firewall shaping-profile");
    expect(step?.send.filter((line) => /^(edit|set guaranteed)/.test(line))).toEqual([
        'edit "wan"',
        "edit 2",
        "set guaranteed-bandwidth-percentage 35",
        "edit 3",
        "set guaranteed-bandwidth-percentage 35",
        "edit 1",
        "set guaranteed-bandwidth-percentage 30",
    ]);
});

test("what the device leaves out at its default plans nothing", () => {
    const wan = firewall.qos!.schedulers!.wan!;
    const device: Device = {
        ...firewall,
        qos: {
            ...firewall.qos,
            marking: [{ if: { dscp: "ef" }, then: { dscp: "cs0" } }],
            schedulers: { wan: { ...wan, queues: [wan.queues[0]!, wan.queues[1]!, { class: "best", share: 50, depth_packets: 1000 }] } },
        },
    };
    const rendered = platform.render(device);
    // As `show` printed them on 6.2.2: a queue of 1000 packets, and a DSCP of 0, are the defaults.
    const printed = rendered.replace(/\n {16}set limit 1000/, "").replaceAll(/\n {8}set diffservcode-forward 000000/g, "");

    expect(printed).not.toBe(rendered);
    expect(platform.plan(rendered, printed, options).steps).toEqual([]);
});
