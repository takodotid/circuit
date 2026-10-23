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
