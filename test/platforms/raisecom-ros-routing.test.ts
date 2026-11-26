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
