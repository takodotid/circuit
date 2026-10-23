// What a FortiGate 3700D on FortiOS 6.2.2 printed while a feature was proved on it, and what Circuit makes of it.

import { expect, test } from "bun:test";
import firewall from "../../examples/platforms/fortios";
import { Platforms } from "../../src/platforms";
import { FortiOs } from "../../src/platforms/fortios";
import type { Device } from "../../src/schema";

const platform = Platforms.get("fortios");

test("circuit show may read what LLDP received", () => {
    for (const command of [
        "diagnose lldprx neighbor summary",
        "diagnose lldprx neighbor details",
        "diagnose lldprx port summary",
        "diagnose lldprx port details port5",
    ]) {
        expect(platform.readOnly(command)).toBe(true);
    }

    expect(platform.readOnly("diagnose lldprx")).toBe(false);
});

test("LLDP runs on an aggregate, and is refused on a VLAN interface, which has no LLDP settings", () => {
    const lldp = (name: string) =>
        platform.unsupported({ ...firewall, lldp: { interfaces: [name] } } as Device).filter((gap) => gap.startsWith("lldp"));

    expect(lldp("uplink")).toEqual([]);
    expect(lldp("guests")).toEqual(["lldp.interfaces guests, a vlan"]);
});

/** Two neighbors as `diagnose lldprx neighbor details` printed them, from a router whose LAG runs LLDP on each port. */
const LLDP_DETAILS = `lldprx.neighbor.1.port: 38
lldprx.neighbor.1.port.txt: port17
lldprx.neighbor.1.mac: 02:00:00:00:00:42
lldprx.neighbor.1.chassis.type: 4
lldprx.neighbor.1.chassis.type.txt: interface-mac
lldprx.neighbor.1.chassis.data: 02:00:00:00:00:35
lldprx.neighbor.1.port.id.type: 5
lldprx.neighbor.1.port.id.type.txt: interface-name
lldprx.neighbor.1.port.id.len: 7
lldprx.neighbor.1.port.id.data: sfp28-6
lldprx.neighbor.1.ttl: 121
lldprx.neighbor.1.port.desc.len: 25
lldprx.neighbor.1.port.desc.data: bridge/uplink-lag/sfp28-6
lldprx.neighbor.1.system.name.len: 14
lldprx.neighbor.1.system.name.data: example-router
lldprx.neighbor.1.system.desc.len: 76
lldprx.neighbor.1.system.desc.data: MikroTik RouterOS 7.23.5 (long-term) 2026-09-04 05:32:46 CCR2216-1G-12XS-2XQ
lldprx.neighbor.1.system.caps.available: 0014
lldprx.neighbor.1.system.caps.available.txt: bridge router
lldprx.neighbor.1.system.caps.enabled: 0014
lldprx.neighbor.1.system.caps.enabled.txt: bridge router
lldprx.neighbor.1.address.count: 1
lldprx.neighbor.1.address.1.type: 2
lldprx.neighbor.1.address.1.type.txt: ipv6
lldprx.neighbor.1.address.1.len: 16
lldprx.neighbor.1.address.1.addr: fe80::ff:fe00:35
lldprx.neighbor.1.address.1.addr.interface.type: 2
lldprx.neighbor.1.address.1.addr.interface.type.txt: if-index
lldprx.neighbor.1.address.1.addr.interface.number: 16
lldprx.neighbor.1.vlan.id: 0
lldprx.neighbor.1.med.caps.caps: 0001
lldprx.neighbor.1.med.caps.caps.txt: capabilities
lldprx.neighbor.1.med.caps.type: 0004
lldprx.neighbor.1.med.caps.type.txt: Network Connectivity
lldprx.neighbor.2.port: 23
lldprx.neighbor.2.port.txt: port5
lldprx.neighbor.2.mac: 02:00:00:00:00:3E
lldprx.neighbor.2.chassis.type: 4
lldprx.neighbor.2.chassis.type.txt: interface-mac
lldprx.neighbor.2.chassis.data: 02:00:00:00:00:35
lldprx.neighbor.2.port.id.type: 5
lldprx.neighbor.2.port.id.type.txt: interface-name
lldprx.neighbor.2.port.id.len: 7
lldprx.neighbor.2.port.id.data: sfp28-2
lldprx.neighbor.2.ttl: 121
lldprx.neighbor.2.system.name.len: 14
lldprx.neighbor.2.system.name.data: example-router`;

test("LLDP neighbors are read from diagnose lldprx neighbor details, by Circuit's port names", () => {
    expect(FortiOs.neighborsOf(LLDP_DETAILS, firewall as Device)).toEqual([
        { port: "10g-13", system: "example-router", remote_port: "sfp28-6" },
        { port: "10g-1", system: "example-router", remote_port: "sfp28-2" },
    ]);
});

test("no LLDP neighbor when the device received none", () => {
    expect(FortiOs.neighborsOf("", firewall as Device)).toEqual([]);
});

/** A firewall with one routed port, a static route through it, and an IPv6 one. */
const routed = {
    name: "example-firewall",
    platform: "fortios",
    model: "FG-3700D",
    connection: { host: "192.0.2.10", user: "admin" },
    ports: { "10g-1": { addresses: ["192.0.2.2/30", "2001:db8:ffff::2/64"] } },
    routing: {
        static: [
            { prefix: "198.51.100.0/24", via: "192.0.2.1", description: "BFD test" },
            { prefix: "2001:db8:100::/48", via: "2001:db8:ffff::1", description: "BFD test" },
        ],
    },
} as unknown as Device;

const withBfd = {
    ...routed,
    routing: {
        bfd: { interval: 300, multiplier: 4 },
        static: routed.routing!.static!.map((route) => ({ ...route, bfd: true as const })),
    },
} as Device;

/** What `show system settings`, `show router static` and `show router static6` printed once the device took BFD. */
const PRINTED_BFD = {
    "system settings": `config system settings
    set bfd enable
    set bfd-desired-min-tx 300
    set bfd-required-min-rx 300
    set bfd-detect-mult 4
    set default-voip-alg-mode kernel-helper-based
end`,
    "router static": `config router static
    edit 1
        set dst 198.51.100.0 255.255.255.0
        set gateway 192.0.2.1
        set device "port5"
        set comment "BFD test"
        set bfd enable
    next
end`,
    "router static6": `config router static6
    edit 1
        set dst 2001:db8:100::/48
        set gateway 2001:db8:ffff::1
        set device "port5"
        set comment "BFD test"
        set bfd enable
    next
end`,
};

/** The render of a device with some sections replaced by what the device printed. */
function asPrinted(device: Device, sections: Record<string, string>): string {
    let text = platform.render(device);

    for (const [section, printed] of Object.entries(sections)) {
        const start = text.indexOf(`config ${section}\n`);
        const end = text.indexOf("\nend", start) + "\nend".length;
        text = text.slice(0, start) + printed + text.slice(end);
    }

    return text;
}

const options = { secrets: false, rollback: 10 };

test("BFD timers and BFD on static routes render as the device printed them", () => {
    expect(platform.unsupported(withBfd)).toEqual([]);
    expect(platform.plan(platform.render(withBfd), asPrinted(withBfd, PRINTED_BFD), options).steps).toEqual([]);
});

test("timers the device does not print, its 250 ms and 3, plan nothing", () => {
    const defaults = { ...withBfd, routing: { ...withBfd.routing, bfd: { interval: 250, multiplier: 3 } } } as Device;
    const printed = {
        ...PRINTED_BFD,
        "system settings": "config system settings\n    set bfd enable\n    set default-voip-alg-mode kernel-helper-based\nend",
    };

    expect(platform.render(defaults)).toContain("set bfd-detect-mult 3");
    expect(platform.plan(platform.render(defaults), asPrinted(defaults, printed), options).steps).toEqual([]);
});

test("removing BFD unsets the timers while BFD still runs, then BFD, and creates each route again without it", () => {
    const sent = platform.plan(platform.render(routed), asPrinted(withBfd, PRINTED_BFD), options).steps.flatMap((step) => step.send);

    expect(sent).toEqual([
        "config system settings",
        "unset bfd-detect-mult",
        "unset bfd-required-min-rx",
        "unset bfd-desired-min-tx",
        "unset bfd",
        "end",
        "config router static",
        "delete 1",
        "edit 1",
        "set dst 198.51.100.0 255.255.255.0",
        "set gateway 192.0.2.1",
        'set device "port5"',
        'set comment "BFD test"',
        "next",
        "end",
        "config router static6",
        "delete 1",
        "edit 1",
        "set dst 2001:db8:100::/48",
        "set gateway 2001:db8:ffff::1",
        'set device "port5"',
        'set comment "BFD test"',
        "next",
        "end",
    ]);
});

test("BFD stays refused where it is not proved: on a multihop BGP session, and on a route in a VRF", () => {
    const multihop = {
        ...routed,
        routing: {
            ...routed.routing,
            bgp: { asn: 64496, neighbors: { far: { address: "198.51.100.1", remote_as: 64497, multihop: true, bfd: true } } },
        },
    } as Device;

    expect(platform.unsupported(multihop)).toContain(
        "routing.bgp.neighbors.far.bfd, BFD on a multihop session is not proved on a device yet"
    );

    const inVrf = {
        ...firewall,
        routing: { ...firewall.routing, static: [{ prefix: "0.0.0.0/0", via: "198.51.100.98", vrf: "guests", bfd: true }] },
    } as Device;

    expect(platform.unsupported(inVrf)).toContain("routing.static 0.0.0.0/0.bfd, BFD in a VRF is not proved on a device yet");
});
