// Routing on a RAX721 on ROS 6.5.2, as tako-mmr-01 printed it after each was applied to objects no service used (#418).

import { expect, test } from "bun:test";
import type { Device } from "../../src/model";
import { Platforms } from "../../src/platforms";
import { Fixtures } from "../fixtures";

const platform = Platforms.get("raisecom-ros");
const coreSwitch = Fixtures.device("platforms--example-core-switch");
const options = { secrets: false, rollback: 0 };
const sent = (desired: string, current: string) => platform.plan(desired, current, options).steps.flatMap((step) => step.send);

/** The blocks of `config` whose header starts with one of `headers`, and the top-level lines that start with `ip route`. */
const blocks = (config: string, headers: readonly string[]) =>
    config
        .split("!\n")
        .map((block) => block.trimStart())
        .filter((block) => headers.some((header) => block.startsWith(header)))
        .map((block) => `${block}!\n`)
        .join("");

const routed: Device = {
    ...coreSwitch,
    switching: { ...coreSwitch.switching, vlans: { ...coreSwitch.switching?.vlans, test: { id: 3999 } } },
    interfaces: {
        ...coreSwitch.interfaces,
        ethernet: { ...coreSwitch.interfaces?.ethernet, "10g-24": { description: "circuit test", addresses: ["198.51.100.1/30"] } },
        vlan_interface: { ...coreSwitch.interfaces?.vlan_interface, test: { vlan: "test", addresses: ["192.0.2.129/25"] } },
        loopback: { main: { addresses: ["203.0.113.1/32"] } },
    },
    routing: {
        ...coreSwitch.routing,
        static_routes: [
            ...(coreSwitch.routing?.static_routes ?? []),
            { prefix: "203.0.113.128/25", next_hop: "198.51.100.2", interface: "10g-24" },
            { prefix: "203.0.113.64/26", next_hop: "192.0.2.130", interface: "test" },
        ],
    },
} as Device;

// Tested on tako-mmr-01, 2026-11-26: a spare port routed, a loopback, and a route through each kind of interface.
const PRINTED = `interface loopback 1
ip address 203.0.113.1 255.255.255.255
!
interface tengigabitethernet 1/3/24
description circuit test
ip address 198.51.100.1 255.255.255.252
!
interface vlan 3999
ip address 192.0.2.129 255.255.255.128
!
`;

test("a routed port, a loopback, and a route through an interface render as the switch printed them", () => {
    const rendered = platform.render(routed);
    expect(platform.unsupported(routed)).toEqual([]);

    const headers = ["interface loopback", "interface tengigabitethernet 1/3/24", "interface vlan 3999"];
    expect(sent(blocks(rendered, headers), PRINTED)).toEqual([]);
    expect(rendered).toContain("ip route 203.0.113.128 255.255.255.128 198.51.100.2 tengigabitethernet 1/3/24\n");
    expect(rendered).toContain("ip route 203.0.113.64 255.255.255.192 192.0.2.130 vlan 3999\n");
    // The switch prints a route with a space at its end.
    expect(sent(rendered, rendered.replace(/^(ip route .*)$/gm, "$1 "))).toEqual([]);
});

test("a port the switch has switched lets go of it before it takes an address, and routes come after the interfaces", () => {
    const current = platform
        .render(coreSwitch)
        .replace("interface tengigabitethernet 1/3/24\nshutdown\n", "interface tengigabitethernet 1/3/24\nportswitch\nshutdown\n");
    const steps = sent(platform.render(routed), current);

    expect(
        steps.slice(steps.indexOf("interface tengigabitethernet 1/3/24"), steps.indexOf("interface tengigabitethernet 1/3/24") + 6)
    ).toEqual([
        "interface tengigabitethernet 1/3/24",
        "no shutdown",
        "no portswitch",
        "description circuit test",
        "ip address 198.51.100.1 255.255.255.252",
        "exit",
    ]);
    // A route through a VLAN interface is refused until the interface exists.
    expect(steps.indexOf("ip route 203.0.113.64 255.255.255.192 192.0.2.130 vlan 3999")).toBeGreaterThan(
        steps.indexOf("interface vlan 3999")
    );
});

test("taken away, an address goes by itself and a route by its interface too, as the switch keeps a route without it", () => {
    const printed = platform.render(routed).replace(/^(ip route .*)$/gm, "$1 ");
    const steps = sent(platform.render(coreSwitch), printed);

    expect(steps).toContain("no ip route 203.0.113.128 255.255.255.128 198.51.100.2 tengigabitethernet 1/3/24");
    expect(steps).toContain("no ip route 203.0.113.64 255.255.255.192 192.0.2.130 vlan 3999");
    expect(steps.slice(steps.indexOf("interface tengigabitethernet 1/3/24"))).toEqual(
        expect.arrayContaining(["no ip address 198.51.100.1", "no description", "shutdown"])
    );
    expect(steps).toContain("no interface loopback 1");
});

const inVrf: Device = {
    ...routed,
    interfaces: {
        ...routed.interfaces,
        ethernet: {
            ...routed.interfaces?.ethernet,
            "10g-24": { description: "circuit test", vrf: "test", addresses: ["198.51.100.1/30"] },
        },
        vlan_interface: {
            ...routed.interfaces?.vlan_interface,
            test: { vlan: "test", vrf: "test", addresses: ["192.0.2.129/25"] },
        },
        loopback: { main: { vrf: "test", addresses: ["203.0.113.1/32"] } },
    },
    routing: {
        ...routed.routing,
        vrfs: { test: {} },
        static_routes: [
            ...(coreSwitch.routing?.static_routes ?? []),
            { prefix: "203.0.113.64/26", next_hop: "192.0.2.130", interface: "test", vrf: "test" },
            { prefix: "203.0.113.128/25", next_hop: "198.51.100.2", vrf: "test" },
        ],
    },
} as Device;

// Tested on tako-mmr-01, 2026-11-26: a VRF with a spare port, a loopback, a VLAN interface, and routes in it.
const PRINTED_IN_VRF = `ip vrf test
!
interface loopback 1
ip vrf forwarding test
ip address 203.0.113.1 255.255.255.255
!
interface tengigabitethernet 1/3/24
ip vrf forwarding test
description circuit test
ip address 198.51.100.1 255.255.255.252
!
interface vlan 3999
ip vrf forwarding test
ip address 192.0.2.129 255.255.255.128
!
`;

test("a VRF is a block of its own, and its interfaces and routes name it, as the switch printed them", () => {
    const rendered = platform.render(inVrf);
    expect(platform.unsupported(inVrf)).toEqual([]);

    const headers = ["ip vrf", "interface loopback", "interface tengigabitethernet 1/3/24", "interface vlan 3999"];
    expect(sent(blocks(rendered, headers), PRINTED_IN_VRF)).toEqual([]);
    expect(rendered).toContain("ip route vrf test 203.0.113.64 255.255.255.192 192.0.2.130 vlan 3999\n");
    expect(rendered).toContain("ip route vrf test 203.0.113.128 255.255.255.128 198.51.100.2\n");
});

test("an interface that changes VRF gets its IP settings again, as the change removes them, and a VRF goes once no interface is in it", () => {
    const out = { ...inVrf, interfaces: { ...inVrf.interfaces, loopback: { main: { addresses: ["203.0.113.1/32"] } } } } as Device;
    expect(sent(platform.render(out), platform.render(inVrf))).toEqual([
        "interface loopback 1",
        "no ip vrf forwarding",
        "ip address 203.0.113.1 255.255.255.255",
        "exit",
    ]);

    const steps = sent(platform.render(coreSwitch), platform.render(inVrf));
    expect(steps.at(-1)).toBe("no ip vrf test");
    expect(steps).toContain("no ip route vrf test 203.0.113.64 255.255.255.192 192.0.2.130 vlan 3999");
});

test("a VRF has no description here", () => {
    const described = { ...inVrf, routing: { ...inVrf.routing, vrfs: { test: { description: "lab" } } } } as Device;
    expect(platform.unsupported(described)).toEqual(["routing.vrfs.test.description, the switch has no description for a VRF"]);
});

const checked: Device = {
    ...routed,
    interfaces: {
        ...routed.interfaces,
        ethernet: {
            ...routed.interfaces?.ethernet,
            "10g-24": { description: "circuit test", addresses: ["198.51.100.1/30"], urpf: { ipv4: "loose" } },
        },
        vlan_interface: {
            ...routed.interfaces?.vlan_interface,
            test: { vlan: "test", addresses: ["192.0.2.129/25"], urpf: { ipv4: "strict" } },
        },
    },
} as Device;

// Tested on tako-mmr-01, 2026-11-26: uRPF on a spare port and on a VLAN with no ports.
const PRINTED_URPF = `interface tengigabitethernet 1/3/24
description circuit test
ip address 198.51.100.1 255.255.255.252
ip urpf loose
!
interface vlan 3999
ip address 192.0.2.129 255.255.255.128
ip urpf strict
!
`;

test("uRPF checks IPv4 on a routed port and a VLAN interface, as the switch printed it, and goes by its keyword", () => {
    expect(platform.unsupported(checked)).toEqual([]);
    expect(platform.experimental!(checked)).toEqual(["interfaces.ethernet.10g-24.urpf.ipv4", "interfaces.vlan_interface.test.urpf.ipv4"]);
    const headers = ["interface tengigabitethernet 1/3/24", "interface vlan 3999"];
    expect(sent(blocks(platform.render(checked), headers), PRINTED_URPF)).toEqual([]);
    expect(sent(blocks(platform.render(routed), headers), PRINTED_URPF)).toEqual([
        "interface vlan 3999",
        "no ip urpf",
        "exit",
        "interface tengigabitethernet 1/3/24",
        "no ip urpf",
        "exit",
    ]);

    const ipv6 = structuredClone(checked);
    ipv6.interfaces!.vlan_interface!.test!.urpf = { ipv6: "strict" };
    ipv6.interfaces!.lag = { uplink: { trunk_vlans: ["test"], urpf: { ipv4: "loose" } } };
    expect(platform.unsupported(ipv6)).toEqual([
        "interfaces.lag.uplink.urpf, a LAG here only switches",
        "interfaces.vlan_interface.test.urpf.ipv6, only IPv4 here",
    ]);
});

const withOspf: Device = {
    ...routed,
    switching: { ...routed.switching, vlans: { ...routed.switching?.vlans, test2: { id: 3998 } } },
    interfaces: {
        ...routed.interfaces,
        ethernet: {
            ...routed.interfaces?.ethernet,
            "10g-24": { description: "circuit test", addresses: ["198.51.100.1/30"], urpf: { ipv4: "loose" } },
        },
        vlan_interface: {
            ...routed.interfaces?.vlan_interface,
            test: { vlan: "test", addresses: ["192.0.2.129/25"], urpf: { ipv4: "strict" } },
            test2: { vlan: "test2", addresses: ["198.51.100.9/30"] },
        },
    },
    routing: {
        ...routed.routing,
        router_id: "203.0.113.1",
        ospf: {
            areas: {
                "0.0.0.0": {
                    interfaces: {
                        "10g-24": { network: "point-to-point", hello_interval: 5, dead_interval: 20, cost: 100, bfd: true },
                        main: {},
                    },
                },
                "0.0.0.1": {
                    type: "nssa",
                    no_summaries: true,
                    stub_default_cost: 10,
                    ranges: [{ prefix: "192.0.2.128/25", advertise: true }],
                    interfaces: {
                        test: { network: "non-broadcast", neighbors: ["192.0.2.130"], priority: 5, hello_interval: 15, dead_interval: 60 },
                    },
                },
                "0.0.0.2": {
                    type: "stub",
                    ranges: [{ prefix: "198.51.100.8/29", advertise: false }],
                    interfaces: {
                        test2: {
                            hello_interval: 10,
                            dead_interval: 40,
                            priority: 1,
                            authentication: { algorithm: "md5", key_id: 7, key: { secret: "OSPF_KEY" } },
                        },
                    },
                },
            },
        },
    },
} as Device;

// Tested on tako-mmr-01, 2026-11-26: OSPF on a spare port, a loopback, and two VLANs with no ports, with uRPF on two of them. The key printed in clear.
const PRINTED_OSPF = `interface tengigabitethernet 1/3/24
description circuit test
ip address 198.51.100.1 255.255.255.252
ip ospf network ptp
ip ospf hello-interval 5
ip ospf cost 100
ip ospf bfd
ip urpf loose
!
interface vlan 3998
ip address 198.51.100.9 255.255.255.252
ip ospf authentication md5
ip ospf authentication-key md5 7 0 ctestospfkey
!
interface vlan 3999
ip address 192.0.2.129 255.255.255.128
ip ospf network non-broadcast
ip ospf hello-interval 15
ip ospf priority 5
ip urpf strict
!
router ospf 1 router-id 203.0.113.1
 neighbor 192.0.2.130
 area 0.0.0.1 nssa no-summary
 area 0.0.0.2 stub
 area 0.0.0.1 default-cost 10
 network 192.0.2.128 0.0.0.127 area 0.0.0.1
 network 198.51.100.0 0.0.0.3 area 0.0.0.0
 network 198.51.100.8 0.0.0.3 area 0.0.0.2
 network 203.0.113.1 0.0.0.0 area 0.0.0.0
 area 0.0.0.1 range 192.0.2.128 255.255.255.128
 area 0.0.0.2 range 198.51.100.8 255.255.255.248 not-advertise
!
`;

test("OSPF's areas, ranges, timers, NBMA neighbors, and MD5 key, and uRPF, render as the switch printed them", () => {
    const rendered = platform.render(withOspf);
    expect(platform.unsupported(withOspf)).toEqual([]);

    // The read hides the key, which the switch prints in clear.
    const read = platform.scrubOutput!(PRINTED_OSPF);
    expect(read).toContain("ip ospf authentication-key md5 7 0 <redacted>\n");
    expect(read).not.toContain("ctestospfkey");

    const headers = ["interface tengigabitethernet 1/3/24", "interface vlan 3998", "interface vlan 3999", "router ospf"];
    expect(sent(blocks(rendered, headers), read)).toEqual([]);
    // A dead interval of four hellos, and a hello interval or priority the link has unless set, print nothing.
    expect(blocks(rendered, ["interface vlan 3998"])).not.toContain("interval");

    // The switch restarted before they were removed one by one.
    expect(platform.experimental!(withOspf)).toEqual([
        "interfaces.ethernet.10g-24.urpf.ipv4",
        "interfaces.vlan_interface.test.urpf.ipv4",
        "routing.ospf.areas.0.0.0.0.interfaces.10g-24.hello_interval",
        "routing.ospf.areas.0.0.0.0.interfaces.10g-24.dead_interval",
        "routing.ospf.areas.0.0.0.1.type",
        "routing.ospf.areas.0.0.0.1.no_summaries",
        "routing.ospf.areas.0.0.0.1.stub_default_cost",
        "routing.ospf.areas.0.0.0.1.ranges",
        "routing.ospf.areas.0.0.0.1.interfaces.test.hello_interval",
        "routing.ospf.areas.0.0.0.1.interfaces.test.dead_interval",
        "routing.ospf.areas.0.0.0.1.interfaces.test.priority",
        "routing.ospf.areas.0.0.0.1.interfaces.test.neighbors",
        "routing.ospf.areas.0.0.0.1.interfaces.test.network",
        "routing.ospf.areas.0.0.0.2.type",
        "routing.ospf.areas.0.0.0.2.ranges",
        "routing.ospf.areas.0.0.0.2.interfaces.test2.hello_interval",
        "routing.ospf.areas.0.0.0.2.interfaces.test2.dead_interval",
        "routing.ospf.areas.0.0.0.2.interfaces.test2.priority",
        "routing.ospf.areas.0.0.0.2.interfaces.test2.authentication",
    ]);
});

test("OSPF in a VRF is refused, as the switch restarted minutes after one was removed", () => {
    const inVrfOspf = structuredClone(withOspf);
    inVrfOspf.routing!.ospf!.vrf = "test";

    expect(platform.unsupported(inVrfOspf)).toContain(
        "routing.ospf.vrf, not built: a RAX721 restarted minutes after one was removed, and the cause is not known"
    );
});

test("a new OSPF network type sends the link's timers again, as it sets them back to its own", () => {
    const changed = structuredClone(withOspf);
    changed.routing!.ospf!.areas["0.0.0.1"]!.interfaces.test = { hello_interval: 15, dead_interval: 60 };

    expect(
        sent(blocks(platform.render(changed), ["interface vlan 3999"]), blocks(platform.render(withOspf), ["interface vlan 3999"]))
    ).toEqual(["interface vlan 3999", "no ip ospf priority", "no ip ospf network", "ip ospf hello-interval 15", "exit"]);
});

test("OSPF and uRPF keep to what the switch takes", () => {
    const astray = structuredClone(withOspf);
    const areas = astray.routing!.ospf!.areas;
    areas["0.0.0.0"]!.interfaces.main = { passive: true };
    areas["0.0.0.0"]!.interfaces["10g-24"] = { network: "point-to-multipoint" };
    areas["0.0.0.2"]!.interfaces.test2 = { authentication: { algorithm: "hmac-sha-256", key_id: 0, key: { secret: "OSPF_KEY" } } };
    astray.interfaces!.vlan_interface!.test = { vlan: "test", addresses: ["192.0.2.129/25"], urpf: { ipv6: "strict" } };

    expect(platform.unsupported(astray)).toEqual([
        "interfaces.vlan_interface.test.urpf.ipv6, only IPv4 here",
        "routing.ospf.areas.0.0.0.0.interfaces.10g-24.network point-to-multipoint, the switch has none",
        "routing.ospf.areas.0.0.0.0.interfaces.main, a loopback forms no adjacency and takes no OSPF setting here: write {}",
        "routing.ospf.areas.0.0.0.2.interfaces.test2.authentication.algorithm hmac-sha-256, the switch signs with MD5 alone",
        "routing.ospf.areas.0.0.0.2.interfaces.test2.authentication.key_id 0, the switch takes 1 to 255",
    ]);
});

test("a routed port, a loopback, and a route keep to what the switch takes", () => {
    const astray = {
        ...routed,
        interfaces: {
            ...routed.interfaces,
            ethernet: {
                ...routed.interfaces?.ethernet,
                "10g-24": { addresses: ["198.51.100.1/30", "2001:db8::1/64"], stp: false },
            },
            lag: { uplink: { trunk_vlans: ["test"] } },
            loopback: { main: { description: "router ID", addresses: ["203.0.113.1/32"] } },
        },
        routing: { ...routed.routing, static_routes: [{ prefix: "203.0.113.0/24", next_hop: "192.0.2.130", interface: "uplink" }] },
    } as Device;

    expect(platform.unsupported(astray)).toEqual([
        "interfaces.ethernet.10g-24.addresses 2001:db8::1/64, only IPv4 here",
        "interfaces.ethernet.10g-24.stp on a routed port, tested on switched ports alone",
        "interfaces.loopback.main.description, not on a loopback here",
        "routing.static_routes 203.0.113.0/24 interface uplink, a route here names a routed port or a VLAN interface",
    ]);
});
