// Rate limits (RFC 2697). RouterOS is applied and measured on CHRs in CI (routeros-chr-rate-limit.test.ts). FortiOS's shapers and shaping policies were sent to a FG-3700D on 6.2.2 on a spare port, read back, and removed. Junos passed `commit check` on a QFX5100 with 21.4R3, and VRP went into a CE6855's candidate.

import { expect, test } from "bun:test";
import { Checks } from "../../src/checks";
import { Migrate } from "../../src/cli/migrate";
import type { Device } from "../../src/model";
import { Platforms } from "../../src/platforms";

const options = { secrets: false, rollback: 10 };

/** A device of `platform` with these interfaces, and a VLAN `hosts`. */
function device(platform: string, model: string, interfaces: object, more: object = {}): Device {
    const written = {
        name: "edge-01",
        site: "lab",
        platform,
        model,
        connection: { host: "192.0.2.10", user: "netops" },
        system: { users: { root: { role: "admin", password: { secret: "ROOT" } } } },
        switching: { vlans: { hosts: { id: 10 } } },
        interfaces,
        ...more,
    };
    return written as Device;
}

const rateLimits = (found: string[]) => found.filter((field) => field.includes("rate"));

/** The lines of `name` in a render. */
function menu(text: string, name: string): string[] {
    const start = text.indexOf(`${name}\n`);
    return text
        .slice(start, text.indexOf("\n/", start + 1))
        .split("\n")
        .slice(1);
}

const renders = (platform: string, sample: Device) => {
    const adapter = Platforms.get(platform);
    const text = adapter.render(sample);
    expect(adapter.plan(text, text, options).steps).toEqual([]);
    return text;
};

test("RouterOS limits a routed port or a VLAN interface with a simple queue, input first", () => {
    const sample = device("routeros", "CHR", {
        ethernet: {
            "virtual-2": { addresses: ["192.0.2.1/30"], rate_limit: { input: { cir: "200M", bc: 250_000 }, output: "1.5G" } },
            "virtual-3": { access_vlan: "hosts" },
        },
        vlan_interface: { hosts: { vlan: "hosts", addresses: ["198.51.100.1/30"], rate_limit: { output: "64k" } } },
    });

    expect(rateLimits(Platforms.get("routeros").unsupported(sample))).toEqual([]);
    const text = renders("routeros", sample);
    expect(text).toContain("add bucket-size=0.01/0.1 max-limit=200M/1500M name=ether2-rate-limit target=ether2");
    expect(text).toContain("add max-limit=0/64k name=hosts-rate-limit target=hosts");
});

test("RouterOS refuses a queue that traffic skips, and a burst its bucket can't hold", () => {
    const sample = device(
        "routeros",
        "CHR",
        {
            ethernet: {
                "virtual-2": { addresses: ["192.0.2.1/30"], rate_limit: { input: { cir: "200M", bc: 1000 } } },
                "virtual-3": { access_vlan: "hosts", rate_limit: { input: "200M" } },
            },
        },
        {
            system: { users: {}, hardware_offload: true },
            firewall: { filter: { forward: { rules: [{ then: "accept", fast_path: true }] } } },
            switching: { vlans: { hosts: { id: 10 } }, acls: { edge: [{ then: "accept", rate: { cir: "1G", bc: 1000 } }] } },
        }
    );

    expect(rateLimits(Platforms.get("routeros").unsupported(sample))).toEqual([
        "interfaces.ethernet.virtual-2.rate_limit beside a fast_path rule, whose flows skip the queue",
        "interfaces.ethernet.virtual-2.rate_limit while system.hardware_offload is on, whose traffic skips the queue: limit a VLAN interface with hardware_offload: false",
        "interfaces.ethernet.virtual-2.rate_limit.input.bc 1000, the platform's burst is a share of the rate in thousandths, up to 10 times it: at 200M, a multiple of 25000 bytes up to 250000000",
        "interfaces.ethernet.virtual-3.rate_limit on a switched port or LAG, whose queue sees nothing the router routes: limit the VLAN interface",
        "interfaces.ethernet.virtual-3.rate_limit beside a fast_path rule, whose flows skip the queue",
        "interfaces.ethernet.virtual-3.rate_limit while system.hardware_offload is on, whose traffic skips the queue: limit a VLAN interface with hardware_offload: false",
        "switching.acls.edge[0].rate.bc, a switch rule takes a rate without a burst: write the rate alone",
    ]);
});

test("RouterOS gives each prefix its own rate with a PCQ queue type, by source in and by destination out, and reads it back as a CHR printed it", () => {
    const sample = device("routeros", "CHR", {
        ethernet: {
            "virtual-2": { addresses: ["192.0.2.1/30"], rate_limit: { per_prefix: { ipv4: 30, ipv6: 56, output: "1.5M" } } },
            "virtual-3": { access_vlan: "hosts" },
        },
        vlan_interface: {
            hosts: {
                vlan: "hosts",
                addresses: ["198.51.100.1/24"],
                rate_limit: { output: "150k", per_prefix: { ipv4: 32, ipv6: 64, input: "100k", output: "100k" } },
            },
        },
    });

    expect(rateLimits(Platforms.get("routeros").unsupported(sample))).toEqual([]);
    const text = renders("routeros", sample);
    expect(menu(text, "/queue type")).toEqual([
        "add kind=pcq name=ether2-rate-limit-output pcq-classifier=dst-address pcq-rate=1500k pcq-dst-address-mask=30 pcq-dst-address6-mask=56",
        "add kind=pcq name=hosts-rate-limit-input pcq-classifier=src-address pcq-rate=100k pcq-src-address-mask=32 pcq-src-address6-mask=64",
        "add kind=pcq name=hosts-rate-limit-output pcq-classifier=dst-address pcq-rate=100k pcq-dst-address-mask=32 pcq-dst-address6-mask=64",
    ]);
    expect(menu(text, "/queue simple")).toEqual([
        "add name=ether2-rate-limit queue=default-small/ether2-rate-limit-output target=ether2",
        "add max-limit=0/150k name=hosts-rate-limit queue=hosts-rate-limit-input/hosts-rate-limit-output target=hosts",
    ]);

    // `export` leaves out each mask at its default, 32 and 128 (TRAPS.md).
    const printed = `/queue type
add kind=pcq name=ether2-rate-limit-output pcq-classifier=dst-address pcq-dst-address-mask=30 pcq-dst-address6-mask=56 pcq-rate=1500k
add kind=pcq name=hosts-rate-limit-input pcq-classifier=src-address pcq-rate=100k pcq-src-address6-mask=64
add kind=pcq name=hosts-rate-limit-output pcq-classifier=dst-address pcq-dst-address6-mask=64 pcq-rate=100k
/queue simple
add name=ether2-rate-limit queue=default-small/ether2-rate-limit-output target=ether2
add max-limit=0/150k name=hosts-rate-limit queue=hosts-rate-limit-input/hosts-rate-limit-output target=hosts
`;
    const read = text.replace(/\/queue type\n(?:add .*\n)+\/queue simple\n(?:add .*\n)+/, printed);
    expect(read).not.toBe(text);
    expect(Platforms.get("routeros").plan(text, read, options).steps).toEqual([]);
});

test("The other platforms refuse per_prefix", () => {
    for (const [platform, model, port] of [
        ["fortios", "FG-3700D", "10g-28"],
        ["raisecom-ros", "RAX721-C-6C48", "10g-1"],
    ] as const) {
        const sample = device(platform, model, {
            ethernet: { [port]: { access_vlan: "hosts", rate_limit: { per_prefix: { ipv4: 32, ipv6: 64, output: "20M" } } } },
        });
        expect(Platforms.get(platform).unsupported(sample)).toContain(
            `interfaces.ethernet.${port}.rate_limit.per_prefix, which the platform does not build`
        );
    }
});

// A CE6855 on V200R005C00SPC800 refused `qos car inbound source-ip-address ... per-address` and `ip car` (TRAPS.md).
test("VRP refuses per_prefix, as the CE6855 has no rate for each address", () => {
    const sample = device("vrp", "CE6855-48S6Q-HI", {
        ethernet: { "10g-3": { access_vlan: "hosts", rate_limit: { per_prefix: { ipv4: 32, ipv6: 64, output: "20M" } } } },
    });
    expect(Platforms.get("vrp").unsupported(sample)).toContain(
        "interfaces.ethernet.10g-3.rate_limit.per_prefix, the CE6855 has no rate for each address: its CAR polices a port or a traffic class as a whole"
    );
});

test("Junos polices what arrives on a switched port and shapes what leaves, in the numbers the switch prints", () => {
    const sample = device("junos", "QFX5100-48S-6Q", {
        ethernet: { "10g-3": { access_vlan: "hosts", rate_limit: { input: { cir: "1500M", bc: 250_000 }, output: "200M" } } },
    });

    expect(rateLimits(Platforms.get("junos").unsupported(sample))).toEqual([]);
    const text = renders("junos", sample);
    for (const line of [
        "set firewall policer circuit-rate-limit-xe-0-0-2 if-exceeding bandwidth-limit 1500000000",
        "set firewall policer circuit-rate-limit-xe-0-0-2 if-exceeding burst-size-limit 250k",
        "set firewall policer circuit-rate-limit-xe-0-0-2 then discard",
        "set firewall family ethernet-switching filter circuit-rate-limit-xe-0-0-2 term limit then policer circuit-rate-limit-xe-0-0-2",
        "set firewall family ethernet-switching filter circuit-rate-limit-xe-0-0-2 term limit then accept",
        "set interfaces xe-0/0/2 unit 0 family ethernet-switching filter input circuit-rate-limit-xe-0-0-2",
        "set class-of-service interfaces xe-0/0/2 shaping-rate 200m",
    ])
        expect(text).toContain(line);
});

test("Junos refuses a rate without the burst its policer needs, and what it has no place for", () => {
    const sample = device(
        "junos",
        "QFX5100-48S-6Q",
        {
            ethernet: {
                "10g-3": { access_vlan: "hosts", ingress_acl: "edge", rate_limit: { input: "200M", output: { cir: "200M", bc: 250_000 } } },
                "10g-4": { addresses: ["192.0.2.1/30"], rate_limit: { input: { cir: "200M", bc: 250_000 } } },
            },
            vlan_interface: { hosts: { vlan: "hosts", addresses: ["198.51.100.1/30"], rate_limit: { output: "200M" } } },
        },
        { switching: { vlans: { hosts: { id: 10 } }, acls: { edge: [{ then: "accept", rate: "1G" }] } } }
    );

    expect(rateLimits(Platforms.get("junos").unsupported(sample))).toEqual([
        "interfaces.ethernet.10g-3.rate_limit.input with an ingress_acl, the port takes one filter",
        'interfaces.ethernet.10g-3.rate_limit.input without bc, the platform\'s policer needs a burst: write { cir: "200M", bc: 250000 }, 10 ms at the rate, or a burst of your own',
        "interfaces.ethernet.10g-3.rate_limit.output.bc, the platform's port shaper takes no burst: write the rate alone",
        "interfaces.ethernet.10g-4.rate_limit.input, on a port or LAG that switches no VLAN, which is not built yet",
        "interfaces.vlan_interface.hosts.rate_limit.output, the platform shapes ports only",
        'switching.acls.edge[0].rate without bc, the platform\'s policer needs a burst: write { cir: "1G", bc: 1250000 }, 10 ms at the rate, or a burst of your own',
    ]);
});

test("FortiOS shapes each interface with shared shapers and four shaping policies, as a FG-3700D printed them", () => {
    const sample = device("fortios", "FG-3700D", {
        ethernet: { "10g-28": { addresses: ["192.0.2.1/30"], rate_limit: { input: "200M", output: "1500M" } } },
    });

    expect(rateLimits(Platforms.get("fortios").unsupported(sample))).toEqual([]);
    const printed = `config firewall shaper traffic-shaper
    edit "rate-limit-port32-in"
        set maximum-bandwidth 200
        set bandwidth-unit mbps
    next
    edit "rate-limit-port32-out"
        set maximum-bandwidth 1500
        set bandwidth-unit mbps
    next
end
config firewall shaping-policy
    edit 1
        set name "rate-limit-port32-from"
        set service "ALL"
        set srcintf "port32"
        set dstintf "any"
        set traffic-shaper "rate-limit-port32-in"
        set traffic-shaper-reverse "rate-limit-port32-out"
        set srcaddr "all"
        set dstaddr "all"
    next
    edit 2
        set name "rate-limit-port32-to"
        set service "ALL"
        set srcintf "any"
        set dstintf "port32"
        set traffic-shaper "rate-limit-port32-out"
        set traffic-shaper-reverse "rate-limit-port32-in"
        set srcaddr "all"
        set dstaddr "all"
    next
    edit 3
        set name "rate-limit-port32-from-v6"
        set ip-version 6
        set service "ALL"
        set srcintf "port32"
        set dstintf "any"
        set traffic-shaper "rate-limit-port32-in"
        set traffic-shaper-reverse "rate-limit-port32-out"
        set srcaddr6 "all"
        set dstaddr6 "all"
    next
    edit 4
        set name "rate-limit-port32-to-v6"
        set ip-version 6
        set service "ALL"
        set srcintf "any"
        set dstintf "port32"
        set traffic-shaper "rate-limit-port32-out"
        set traffic-shaper-reverse "rate-limit-port32-in"
        set srcaddr6 "all"
        set dstaddr6 "all"
    next
end
`;
    const fortios = Platforms.get("fortios");
    const text = renders("fortios", sample);
    const sections = (all: string) =>
        all.slice(all.indexOf("config firewall shaper traffic-shaper"), all.indexOf("config firewall local-in-policy"));
    const read = text.replace(sections(text), printed);
    expect(fortios.plan(text, read, options).steps).toEqual([]);

    // The factory's shapers stay, and a shaper the config dropped goes after its policies.
    const factory = `config firewall shaper traffic-shaper
    edit "shared-1M-pipe"
        set maximum-bandwidth 1024
    next
end
`;
    const without = fortios.render({ ...sample, interfaces: { ethernet: { "10g-28": { addresses: ["192.0.2.1/30"] } } } } as Device);
    const removals = fortios
        .plan(without, without.replace(sections(without), printed + factory), options)
        .steps.flatMap((step) => step.send);
    expect(removals.filter((line) => line.startsWith("delete"))).toEqual([
        "delete 1",
        "delete 2",
        "delete 3",
        "delete 4",
        'delete "rate-limit-port32-in"',
        'delete "rate-limit-port32-out"',
    ]);
});

test("FortiOS refuses a burst and a rate of no whole kbit/s", () => {
    const sample = device("fortios", "FG-3700D", {
        ethernet: { "10g-28": { addresses: ["192.0.2.1/30"], rate_limit: { input: { cir: "200M", bc: 250_000 }, output: "1.5k" } } },
    });

    expect(rateLimits(Platforms.get("fortios").unsupported(sample))).toEqual([
        "interfaces.ethernet.10g-28.rate_limit.input.bc, a FortiGate's shaper takes no burst: write the rate alone",
        "interfaces.ethernet.10g-28.rate_limit.output, the platform takes a rate in whole kbit/s",
    ]);
});

test("VRP polices a port through a CAR profile, only with --experimental", () => {
    const vrp = device("vrp", "CE6855-48S6Q-HI", {
        ethernet: { "10g-3": { access_vlan: "hosts", rate_limit: { input: { cir: "200M", bc: 250_000 }, output: "1.5G" } } },
        vlan_interface: { hosts: { vlan: "hosts", addresses: ["198.51.100.1/30"], rate_limit: { input: "200M" } } },
    });

    expect(rateLimits(Platforms.get("vrp").unsupported(vrp))).toEqual([
        "interfaces.vlan_interface.hosts.rate_limit, on a VLAN interface, which is not built yet",
    ]);
    expect(Platforms.get("vrp").experimental?.(vrp)).toEqual(["interfaces.ethernet.10g-3.rate_limit"]);
    const text = Platforms.get("vrp").render(vrp);
    expect(text).toContain("qos car rate-limit-10g-3 cir 200000 cbs 250000");
    expect(text).toContain(
        "interface 10GE1/0/3\n port default vlan 10\n qos car inbound rate-limit-10g-3\n qos lr cir 1500000 outbound\n#"
    );
});

test("Raisecom ROS limits a port and a LAG in kbit/s, with the switch's own burst unless one is written, as a RAX721 with ROS 6.5.2 printed them", () => {
    const raisecom = device("raisecom-ros", "RAX721-C-6C48", {
        ethernet: { "10g-1": { access_vlan: "hosts", rate_limit: { input: "200M", output: { cir: "200M", bc: 250_000 } } } },
        lag: { uplink: { trunk_vlans: ["hosts"], rate_limit: { input: "1G" } } },
        vlan_interface: { hosts: { vlan: "hosts", addresses: ["198.51.100.1/30"], rate_limit: { input: "200M" } } },
    });

    expect(rateLimits(Platforms.get("raisecom-ros").unsupported(raisecom))).toEqual([
        "interfaces.vlan_interface.hosts.rate_limit, the platform limits ports and LAGs",
    ]);
    const text = Platforms.get("raisecom-ros").render(raisecom);
    expect(text).toContain(
        "interface tengigabitethernet 1/3/1\nswitchport access vlan 10\nrate-limit ingress cir 200000\nrate-limit egress cir 200000 cbs 250\n!"
    );
    expect(text).toContain(
        "interface port-channel 1\nswitchport trunk allowed vlan 10\nswitchport mode trunk\nrate-limit ingress cir 1000000\n!"
    );
});

test("validate stops a rate limit that limits nothing, a rate or burst out of range, one on a LAG member, one beside shaping, and a prefix length out of range", () => {
    const sample = device("routeros", "CHR", {
        ethernet: {
            "virtual-2": { addresses: ["192.0.2.1/30"], rate_limit: {} },
            "virtual-3": { addresses: ["198.51.100.1/30"], rate_limit: { input: "0M", output: { cir: "1G", bc: 1.5 } } },
            "virtual-4": { addresses: ["203.0.113.1/30"], shaping: { algorithm: "cake", mbps: 100 }, rate_limit: { output: "100M" } },
            "virtual-5": { in_lag: "uplink", rate_limit: { input: "1G" } },
            "virtual-6": { addresses: ["203.0.113.9/30"], rate_limit: { per_prefix: { ipv4: 33, ipv6: 0, output: "0k" } } },
            "virtual-7": { addresses: ["203.0.113.13/30"], rate_limit: { per_prefix: { ipv4: 32, ipv6: 64 } } },
            "virtual-8": {
                addresses: ["203.0.113.17/30"],
                shaping: { algorithm: "cake", mbps: 100 },
                rate_limit: { per_prefix: { ipv4: 32, ipv6: 64, output: "20M" } },
            },
        },
        lag: { uplink: { addresses: ["203.0.113.5/30"] } },
    });

    const messages = Checks.run([sample], undefined).map((finding) => finding.message);
    expect(messages.filter((message) => message.includes("rate_limit"))).toEqual(
        expect.arrayContaining([
            "interfaces.ethernet.virtual-2.rate_limit limits nothing: write input, output, per_prefix, or several",
            "interfaces.ethernet.virtual-3.rate_limit.input 0M is not a rate above 0, such as 200M, 1.5G, or 64k",
            "interfaces.ethernet.virtual-3.rate_limit.output.bc 1.5 is not a whole number of bytes above 0",
            "interfaces.ethernet.virtual-4.rate_limit.output beside shaping, which also limits what leaves: write one of them",
            "interfaces.ethernet.virtual-5.rate_limit is on a member of uplink: write it on the LAG",
            "interfaces.ethernet.virtual-6.rate_limit.per_prefix.output 0k is not a rate above 0, such as 200M, 1.5G, or 64k",
            "interfaces.ethernet.virtual-6.rate_limit.per_prefix.ipv4 33 is not a prefix length from 1 to 32: write 32 for each address",
            "interfaces.ethernet.virtual-6.rate_limit.per_prefix.ipv6 0 is not a prefix length from 1 to 128: write 128 for each address",
            "interfaces.ethernet.virtual-7.rate_limit.per_prefix limits nothing: write input, output, or both",
            "interfaces.ethernet.virtual-8.rate_limit.per_prefix.output beside shaping, which also limits what leaves: write one of them",
        ])
    );
});

test("circuit migrate writes out the burst Circuit 0.x gave a rate on Junos", () => {
    const rule = { action: "accept", match: { protocol: "icmp" }, rate: "2M" };
    const migrated = (platform: string) =>
        Migrate.device(
            { name: "sw-01", platform, model: "QFX5100-48S-6Q", connection: { host: "192.0.2.10" }, acls: { edge: [rule] } },
            "site-1",
            () => ""
        ).switching.acls.edge[0].rate;

    expect(migrated("junos")).toEqual({ cir: "2M", bc: 2500 });
    expect(migrated("routeros")).toBe("2M");
});
