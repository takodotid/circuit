// What validate says about EVPN: each VXLAN segment's VNI, VLAN, address, route distinguisher, and route targets (RFC 7432, RFC 8365), and the sessions that carry its routes.

import { beforeAll, expect, test } from "bun:test";
import { DeviceChecks } from "../../src/checks/device";
import type { Device, EvpnVxlan, Neighbor } from "../../src/model";
import { Fixtures } from "../fixtures";

/** pe-03 of the MPLS core example, with the school's segment and its EVPN session to pe-02. */
let pe03: Device;

beforeAll(async () => {
    pe03 = (await Fixtures.example("mpls-core"))["pe-03"]!;
});

const errors = (device: Device) =>
    DeviceChecks.run(device)
        .filter((finding) => finding.level === "error")
        .map((finding) => finding.message);

/** The school's segment on pe-03. */
const school = (): EvpnVxlan => pe03.interfaces!.vxlan!["vxlan-school"] as EvpnVxlan;

/** pe-03 with these VXLAN segments. */
const withSegments = (vxlan: Record<string, EvpnVxlan>): Device => ({ ...pe03, interfaces: { ...pe03.interfaces, vxlan } });

/** pe-03 with its session to pe-02 changed, beside its session to pe-01, which carries the library's VPLS routes. */
function withSession(settings: Partial<Neighbor>): Device {
    const bgp = pe03.routing!.bgp!;
    const neighbors = { "pe-01": bgp.neighbors!["pe-01"]!, "pe-02": { ...bgp.neighbors!["pe-02"]!, ...settings } };
    return { ...pe03, routing: { ...pe03.routing, bgp: { ...bgp, neighbors } } };
}

test("each segment has a VNI and a VLAN of its own, an address of the device, its own route distinguisher, and route targets", () => {
    expect(errors(pe03)).toEqual([]);

    const vlans = { ...pe03.switching!.vlans, guests: { id: 304 } };
    const device: Device = {
        ...withSegments({
            "vxlan-school": { ...school(), vni: 16_777_216 },
            "vxlan-guests": {
                ...school(),
                vni: 16_777_216,
                local_address: "10.255.0.30",
                evpn: {
                    route_distinguisher: "10.255.0.3:301",
                    route_targets: { import: ["64500:10302", "64500:10302"], export: ["64500:4294967296"] },
                },
            },
            "vxlan-lab": {
                ...school(),
                vni: 10303,
                access_vlan: "guests",
                evpn: { route_distinguisher: "10.255.0.3:303", route_targets: {} },
            },
        }),
        switching: { vlans },
    };
    expect(errors(device)).toEqual([
        "interfaces.vxlan.vxlan-school.vni 16777216: write a whole number from 1 to 16777215, the same on every VTEP of the segment",
        "interfaces.vxlan.vxlan-guests.vni 16777216: write a whole number from 1 to 16777215, the same on every VTEP of the segment",
        "interfaces.vxlan.vxlan-guests.vni 16777216 is interfaces.vxlan.vxlan-school's too. Give each VXLAN segment its own VNI",
        "interfaces.vxlan.vxlan-guests.access_vlan school is interfaces.vxlan.vxlan-school's too, which would join the two segments. Give each its own VLAN",
        "interfaces.vxlan.vxlan-guests.local_address 10.255.0.30 is on no interface of this device. Write the address of its loopback",
        "interfaces.vxlan.vxlan-guests.evpn.route_distinguisher 10.255.0.3:301 is interfaces.vxlan.vxlan-school's too, and it is what keeps their routes apart. Give each its own, such as 10.255.0.30:16777216",
        "interfaces.vxlan.vxlan-guests.evpn.route_targets.import lists 64500:10302 twice. Remove one",
        "interfaces.vxlan.vxlan-guests.evpn.route_targets.export 64500:4294967296 has 4294967296: write a number up to 4294967295",
        'interfaces.vxlan.vxlan-lab.evpn.route_targets has no target. Write the same on every VTEP of the segment, such as { import: ["64500:10303"], export: ["64500:10303"] }',
        "interfaces.vxlan: the segments in EVPN start from 10.255.0.3 and 10.255.0.30. The far VTEPs send each segment's frames to the address of this device's BGP session, so write one local_address on every segment",
    ]);
});

test("a segment needs a BGP session that carries its routes", () => {
    const { bgp: _bgp, ...routing } = pe03.routing!;
    expect(errors({ ...pe03, routing })).toEqual([
        "interfaces.vxlan.vxlan-school is in EVPN, and BGP carries its routes. Write routing.bgp, with a neighbor whose address_families has l2vpn-evpn",
        "switching.vlans.library.vpls: BGP finds the VPLS's other PEs, and no BGP neighbor carries l2vpn-vpls. Write a neighbor in routing.bgp whose address_families has l2vpn-vpls",
    ]);
    expect(errors(withSession({ address_families: ["ipv4"] }))).toContain(
        "interfaces.vxlan.vxlan-school is in EVPN, and BGP carries its routes. Write routing.bgp, with a neighbor whose address_families has l2vpn-evpn"
    );
});

test("a session that carries EVPN routes is iBGP, in the main table, from the segments' address", () => {
    expect(errors(withSession({ remote_as: 64501, multihop: true }))).toEqual([
        "routing.bgp.neighbors.pe-02 carries l2vpn-evpn to AS64501, another AS. Circuit carries EVPN routes between the VTEPs of one AS: write them on an iBGP neighbor, remote_as 64500",
    ]);
    expect(errors(withSession({ local_address: undefined }))).toEqual([
        "routing.bgp.neighbors.pe-02 carries l2vpn-evpn without local_address, and the far VTEPs send the segments' frames to that address. Write local_address: \"10.255.0.3\", the segments' local_address",
    ]);
    expect(errors(withSession({ send_default_route: true }))).toEqual([
        "routing.bgp.neighbors.pe-02 carries l2vpn-evpn only, and send_default_route sends an ipv4 or ipv6 default route. Remove send_default_route",
    ]);
    // A route reflector carries EVPN routes with no segment of its own, from any address.
    const reflector = withSession({ local_address: undefined });
    const { vxlan: _vxlan, ...interfaces } = reflector.interfaces!;
    expect(errors({ ...reflector, interfaces })).toEqual([]);
});

test("a session that carries EVPN routes only has no policy, which picks ipv4 and ipv6 routes", () => {
    expect(errors(withSession({ import_policy: "loopbacks" }))).toEqual([
        "routing.bgp.neighbors.pe-02 carries l2vpn-evpn only, and import_policy loopbacks picks ipv4 and ipv6 routes, while route targets pick EVPN routes. Remove import_policy",
    ]);
});

test("a VXLAN is a routed tunnel to one far end, or a segment in EVPN, a port of its VLAN, never parts of both", () => {
    // Neither shape type-checks, so a project that isn't type-checked is what writes them.
    const mixed = { ...school(), remote_address: "10.255.0.2", addresses: ["172.16.9.0/31"] } as unknown as EvpnVxlan;
    const tunnel = { vni: 10302, local_address: "10.255.0.3", remote_address: "10.255.0.2", access_vlan: "school" } as unknown as EvpnVxlan;
    expect(errors(withSegments({ "vxlan-school": mixed, "vxlan-tunnel": tunnel }))).toEqual([
        "interfaces.vxlan.vxlan-school.remote_address beside evpn: a segment in EVPN is a port of its VLAN, not routed. BGP EVPN finds the far VTEPs: remove it",
        "interfaces.vxlan.vxlan-school.addresses beside evpn: a segment in EVPN is a port of its VLAN, not routed. Write it on a VLAN interface of access_vlan, or remove it",
        "interfaces.vxlan.vxlan-tunnel.access_vlan without evpn: a tunnel to one far end is routed. Write evpn, or remove access_vlan",
    ]);
});
