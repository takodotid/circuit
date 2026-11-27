// EVPN over VXLAN: a VXLAN segment in EVPN, a port of a VLAN, and the iBGP sessions that carry its routes. RouterOS 7.24.6 ran it on three CHRs (test/platforms/routeros-chr-evpn.test.ts), and the lines it printed there are fed to the adapter here. Junos builds it experimentally (junos-evpn.test.ts), and every other platform refuses it.

import { beforeAll, expect, test } from "bun:test";
import type { Device, EvpnVxlan, Neighbor } from "../../src/model";
import { Platforms } from "../../src/platforms";
import { Fixtures } from "../fixtures";

const options = { secrets: false, rollback: 10 };
const routeros = Platforms.get("routeros");

/** pe-03 of the MPLS core example, with the school's segment and its EVPN session to pe-02. */
let pe03: Device;

beforeAll(async () => {
    pe03 = (await Fixtures.example("mpls-core"))["pe-03"]!;
});

/** The school's segment on pe-03. */
const school = (): EvpnVxlan => pe03.interfaces!.vxlan!["vxlan-school"] as EvpnVxlan;

/** pe-03 with these VXLAN segments. */
const withSegments = (vxlan: Record<string, EvpnVxlan>): Device => ({ ...pe03, interfaces: { ...pe03.interfaces, vxlan } });

/** pe-03 with its session to pe-02 changed. */
function withSession(settings: Partial<Neighbor>): Device {
    const bgp = pe03.routing!.bgp!;
    return { ...pe03, routing: { ...pe03.routing, bgp: { ...bgp, neighbors: { "pe-02": { ...bgp.neighbors!["pe-02"]!, ...settings } } } } };
}

const sent = (desired: string, current: string) => routeros.plan(desired, current, options).steps.flatMap((step) => step.send);

test("RouterOS makes a segment a VXLAN interface on the bridge, untagged in its VLAN, and an EVPN entry of its VNI", () => {
    expect(routeros.unsupported(pe03)).toEqual([]);
    const desired = routeros.render(pe03);

    expect(desired).toContain(
        '/interface vxlan\nadd bridge=bridge bridge-pvid=301 comment="School, to campus 2 at pe-02" learning=no local-address=10.255.0.3 name=vxlan-school vni=10301\n'
    );
    expect(desired).toContain(
        "/routing bgp evpn\nadd export.route-targets=64500:10301 import.route-targets=64500:10301 instance=default name=vxlan-school rd=10.255.0.3:301 vni=10301\n"
    );
    // A session that carries EVPN routes only has no filter chain: route targets pick its routes.
    expect(desired).toContain(
        'add afi=evpn as=64500 comment="pe-02, EVPN routes" instance=default local.address=10.255.0.3 local.role=ibgp name=pe-02 remote.address=10.255.0.2/32 remote.as=64500\n'
    );
    expect(desired).not.toContain("/interface vxlan vteps");
    // The segment's port is the bridge's own, made by the VXLAN interface: the render adds no bridge port for it.
    expect(desired).not.toContain("interface=vxlan-school");

    // As the CHRs printed them: the MAC each VXLAN interface made up for itself, which the plan leaves alone, and a connection's `.role` and `.as`.
    const printed = desired
        .replace("local-address=10.255.0.3 name=vxlan-school", "local-address=10.255.0.3 mac-address=5E:2A:C1:0C:89:1D name=vxlan-school")
        .replace(
            "local.role=ibgp name=pe-02 remote.address=10.255.0.2/32 remote.as=64500",
            ".role=ibgp name=pe-02 remote.address=10.255.0.2/32 .as=64500"
        );
    expect(routeros.plan(desired, printed, options).steps).toEqual([]);
});

test("a device with only a segment in EVPN still gets the bridge", () => {
    const { ethernet, ...interfaces } = pe03.interfaces!;
    const routed = Object.fromEntries(Object.entries(ethernet!).filter(([, port]) => !port?.access_vlan));
    const desired = routeros.render({ ...pe03, interfaces: { ...interfaces, ethernet: routed } });

    expect(desired).toContain("/interface bridge\nadd name=bridge protocol-mode=none vlan-filtering=yes\n");
});

test("RouterOS removes a segment's EVPN entry before its VXLAN interface, and replaces the entry to change it, since a set stops it for good", () => {
    const desired = routeros.render(pe03);
    const { vxlan: _vxlan, ...interfaces } = pe03.interfaces!;
    const without = routeros.render({ ...pe03, interfaces });

    const removing = sent(without, desired);
    const entry = removing.findIndex((line) => line.startsWith("/routing bgp evpn remove"));
    const vxlan = removing.findIndex((line) => line.startsWith("/interface vxlan remove"));
    expect(entry).toBeGreaterThan(-1);
    expect(vxlan).toBeGreaterThan(entry);

    const newTargets = withSegments({
        "vxlan-school": { ...school(), evpn: { ...school().evpn, route_targets: { import: ["64500:10302"], export: ["64500:10302"] } } },
    });
    expect(sent(routeros.render(newTargets), desired)).toEqual([
        "/routing bgp evpn remove [ find name=vxlan-school ]",
        "/routing bgp evpn add export.route-targets=64500:10302 import.route-targets=64500:10302 instance=default name=vxlan-school rd=10.255.0.3:301 vni=10301",
    ]);
});

test("RouterOS refuses two segments with one route target, EVPN routes beside others on one session, and a limit on them", () => {
    const vlans = { ...pe03.switching!.vlans, guests: { id: 302 } };
    const twoSegments: Device = {
        ...withSegments({
            "vxlan-school": school(),
            "vxlan-guests": {
                ...school(),
                vni: 10302,
                access_vlan: "guests",
                evpn: { route_distinguisher: "10.255.0.3:302", route_targets: { import: ["64500:10301"], export: ["64500:10302"] } },
            },
        }),
        switching: { vlans },
    };
    expect(routeros.unsupported(twoSegments)).toEqual([
        "interfaces.vxlan.vxlan-guests.evpn.route_targets 64500:10301, interfaces.vxlan.vxlan-school's too: RouterOS 7.24 tells the segments' EVPN routes apart by their route targets alone. Give each segment targets of its own",
    ]);

    expect(routeros.unsupported(withSession({ address_families: ["ipv4", "l2vpn-evpn"] }))).toEqual([
        "routing.bgp.neighbors.pe-02.address_families l2vpn-evpn beside ipv4, not built for RouterOS yet. Write a neighbor of its own for l2vpn-evpn",
    ]);
    expect(routeros.unsupported(withSession({ max_prefixes: 1000 }))).toEqual([
        "routing.bgp.neighbors.pe-02.max_prefixes, with EVPN routes: RouterOS limits only ipv4 and ipv6 routes",
    ]);
    expect(routeros.unsupported(withSegments({ "vxlan-school": { ...school(), local_address: "2001:db8:255::3" } }))).toEqual([
        "interfaces.vxlan.vxlan-school.local_address 2001:db8:255::3, an IPv6 VTEP in EVPN, not tested on RouterOS yet",
    ]);
});

test("FortiOS refuses EVPN, saying why, and Raisecom ROS refuses VXLAN and a BGP without its AS", () => {
    const reasons: Record<string, string> = {
        fortios: "EVPN: FortiOS 6.2 has none. EVPN over VXLAN needs 7.4",
    };

    for (const platform of [...Object.keys(reasons), "raisecom-ros"]) {
        const device = Fixtures.device(Fixtures.ofPlatform(platform)[0]!);
        const bgp = device.routing?.bgp ?? {};
        const withEvpn: Device = {
            ...device,
            interfaces: { ...device.interfaces, vxlan: { "vxlan-school": school() } },
            routing: {
                ...device.routing,
                bgp: { ...bgp, neighbor_groups: { ...bgp.neighbor_groups, vteps: { address_families: ["l2vpn-evpn"] } } },
            },
        };
        const refused = Platforms.get(platform).unsupported(withEvpn);
        const reason = reasons[platform];
        if (!reason) {
            expect(refused).toContain("interfaces.vxlan.vxlan-school");
            expect(refused).toContain("routing.bgp.asn, absent: write it here or in circuit.ts");
            continue;
        }
        for (const where of ["interfaces.vxlan.vxlan-school", "routing.bgp.neighbor_groups.vteps.address_families l2vpn-evpn"])
            expect(refused).toContain(`${where}, ${reason}`);
    }
});
