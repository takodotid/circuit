// EVPN over VXLAN on Junos, in a QFX5100's default switch. It passed `commit check` in a private candidate on a QFX5100 with Junos 21.4R3-S8.5, with warnings for the `evpn-vxlan`, `vxlan`, and `bgp` licenses the switch lacks. A segment and its sessions were set, changed, and removed, and the plan against what the candidate printed was empty each time. Nothing was committed.

import { expect, test } from "bun:test";
import type { Device, EvpnVxlan, Neighbor } from "../../src/model";
import { Platforms } from "../../src/platforms";
import { Fixtures } from "../fixtures";

const junos = Platforms.get("junos");
const options = { secrets: false, rollback: 10 };

/** The servers' VLAN as a segment, from the switch's loopback. */
const servers: EvpnVxlan = {
    vni: 10020,
    local_address: "203.0.113.65",
    access_vlan: "servers",
    evpn: { route_distinguisher: "203.0.113.65:20", route_targets: { import: ["64500:10020"], export: ["64500:10020"] } },
};

const vtep: Neighbor = { address: "203.0.113.66", remote_as: 64500, local_address: "203.0.113.65", address_families: ["l2vpn-evpn"] };

/** The aggregation switch with these segments, and these BGP neighbors in place of its own. */
function withEvpn(vxlan: Record<string, EvpnVxlan>, neighbors: Record<string, Neighbor> = { "vtep-2": vtep }): Device {
    const device = Fixtures.device("platforms--example-aggregation-switch");
    return {
        ...device,
        interfaces: { ...device.interfaces, vxlan },
        routing: { ...device.routing, bgp: { ...device.routing!.bgp!, neighbors } },
    };
}

const sent = (desired: string, current: string) => junos.plan(desired, current, options).steps.flatMap((step) => step.send);

/** The EVPN statements of a render of `servers` and `vtep-2`, as the candidate printed them. */
const PRINTED = [
    "set vlans servers vxlan vni 10020",
    "set protocols evpn encapsulation vxlan",
    "set protocols evpn multicast-mode ingress-replication",
    "set protocols evpn extended-vni-list 10020",
    "set switch-options vtep-source-interface lo0.0",
    "set switch-options route-distinguisher 203.0.113.65:20",
    "set switch-options vrf-target target:64500:10020",
    "set protocols bgp group vtep-2 import circuit-evpn",
    "set protocols bgp group vtep-2 import circuit-reject-all",
    "set protocols bgp group vtep-2 export circuit-evpn",
    "set protocols bgp group vtep-2 export circuit-reject-all",
    "set protocols bgp group vtep-2 family evpn signaling",
    "set policy-options policy-statement circuit-evpn term evpn from family evpn",
    "set policy-options policy-statement circuit-evpn term evpn then accept",
];

test("Junos makes a segment its VLAN's VNI in the default switch, and a session's EVPN routes pass its own policies, experimentally", () => {
    const device = withEvpn({ "vxlan-servers": servers });
    const desired = junos.render(device);

    for (const line of PRINTED) expect(desired).toContain(line);
    expect(desired).not.toContain("family inet unicast");

    expect(junos.unsupported(device)).toEqual([]);
    expect(junos.experimental!(device)).toEqual(
        expect.arrayContaining(["interfaces.vxlan.vxlan-servers", "routing.bgp.neighbors.vtep-2.address_families l2vpn-evpn"])
    );
});

test("Junos writes an AS above 65535 with L, as the switch prints it, and a segment's import and export targets apart", () => {
    const moved: EvpnVxlan = {
        ...servers,
        vni: 10030,
        access_vlan: "guests-l2",
        evpn: { route_distinguisher: "4200000000:30", route_targets: { import: ["4200000000:10030"], export: ["203.0.113.65:10030"] } },
    };
    const device = withEvpn({ "vxlan-servers": moved });
    const fixture = Fixtures.device("platforms--example-aggregation-switch");
    const both: Device = {
        ...device,
        switching: { ...fixture.switching, vlans: { ...fixture.switching!.vlans, "guests-l2": { id: 31 } } },
    };

    // As the candidate printed them after `delete` and `set`: `4200000000:30` comes back as `4200000000L:30`.
    expect(sent(junos.render(both), junos.render(withEvpn({ "vxlan-servers": servers })))).toEqual([
        "delete vlans servers vxlan",
        "set vlans guests-l2 vlan-id 31",
        "set vlans guests-l2 vxlan vni 10030",
        "delete protocols evpn extended-vni-list 10020",
        "set protocols evpn extended-vni-list 10030",
        "delete switch-options route-distinguisher 203.0.113.65:20",
        "set switch-options route-distinguisher 4200000000L:30",
        "delete switch-options vrf-target target:64500:10020",
        "set switch-options vrf-target import target:4200000000L:10030",
        "set switch-options vrf-target export target:203.0.113.65:10030",
    ]);
});

test("Junos takes EVPN routes beside IPv4 on one session, and leaves its policies to the IPv4 routes", () => {
    const both: Neighbor = { ...vtep, address_families: ["ipv4", "l2vpn-evpn"], import_policy: "transit-in" };
    const desired = junos.render(withEvpn({ "vxlan-servers": servers }, { "vtep-2": both }));

    for (const line of [
        "set protocols bgp group vtep-2 import circuit-evpn",
        "set protocols bgp group vtep-2 import transit-in",
        "set protocols bgp group vtep-2 family inet unicast",
        "set protocols bgp group vtep-2 family evpn signaling",
    ])
        expect(desired).toContain(line);
    expect(desired.indexOf("import circuit-evpn")).toBeLessThan(desired.indexOf("import transit-in"));
});

test("Junos refuses a second segment, a VTEP off the main loopback, and what the switch has no place for", () => {
    const routed = withEvpn(
        {
            "vxlan-servers": { ...servers, port: 4790, mac: "02:00:00:00:00:01", description: "Servers" },
            "vxlan-guests": { ...servers, vni: 10030, local_address: "198.51.100.5", access_vlan: "management" },
        },
        { "vtep-2": { ...vtep, max_prefixes: 1000 } }
    );
    const twoTargets = withEvpn({
        "vxlan-servers": { ...servers, evpn: { ...servers.evpn, route_targets: { import: ["64500:10020", "64500:10021"] } } },
    });

    expect(junos.unsupported(routed)).toEqual([
        "interfaces.vxlan.vxlan-guests, a second segment: Junos runs EVPN in a QFX5100's default switch, one instance with one route distinguisher. Write one segment",
        "interfaces.vxlan.vxlan-servers.port 4790: a Junos VLAN takes no UDP port for VXLAN. Write 4789, or remove port",
        "interfaces.vxlan.vxlan-servers.mac, which only RouterOS sets for now",
        "interfaces.vxlan.vxlan-servers.description: Junos has no description for a segment. Describe its VLAN",
        "interfaces.vxlan.vxlan-guests.local_address 198.51.100.5: Junos sends VXLAN from its main loopback, lo0.0. Write that loopback's address, its one IPv4 address",
        "interfaces.vlan_interface.management, on segment vxlan-guests's VLAN: Juniper documents a QFX5100 as a VTEP that bridges a VXLAN and routes none",
        "routing.bgp.neighbors.vtep-2.max_prefixes, with EVPN routes: not built for Junos yet",
    ]);
    expect(junos.unsupported(twoTargets)).toEqual([
        "interfaces.vxlan.vxlan-servers.evpn.route_targets.import, more than one: Junos's vrf-target takes one import target",
        "interfaces.vxlan.vxlan-servers.evpn.route_targets.export, absent: Junos's default switch needs one export target. Write it",
    ]);
});
