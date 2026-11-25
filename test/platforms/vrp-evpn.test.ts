// EVPN over VXLAN on VRP, tried on a CE6855 on V200R005C00SPC800 with `commit trial`, on new VLANs with no ports and a far VTEP that does not exist. The next plan was empty. A change of targets and the removal went into a candidate. `PRINTED` is what the switch printed.

import { expect, test } from "bun:test";
import type { Device } from "../../src/model";
import { Vrp } from "../../src/platforms/vrp/index";
import { Fixtures } from "../fixtures";

const vrp = new Vrp();
const options = { secrets: false, rollback: 10 };
const base = Fixtures.device("single-site--switch");

type Segment = NonNullable<NonNullable<Device["interfaces"]>["vxlan"]>[string];
type Session = NonNullable<NonNullable<NonNullable<Device["routing"]>["bgp"]>["neighbors"]>[string];

const segment: Segment = {
    description: "School segment",
    vni: 3973,
    local_address: "192.0.2.17",
    access_vlan: "school",
    evpn: { route_distinguisher: "192.0.2.17:3973", route_targets: { import: ["64500:3973"], export: ["64500:3973"] } },
};

const session: Session = { address: "192.0.2.18", remote_as: 64500, local_address: "192.0.2.17", address_families: ["l2vpn-evpn"] };

/** The single-site switch with a segment on a VLAN of its own, a VTEP on a VLAN interface, and an iBGP session to the far VTEP. */
function evpn(vxlan: Segment = segment, neighbor: Session = session): Device {
    return {
        ...base,
        switching: { ...base.switching, vlans: { ...base.switching!.vlans, school: { id: 3973 }, vtep: { id: 3974 } } },
        interfaces: {
            ...base.interfaces,
            vlan_interface: { ...base.interfaces!.vlan_interface, vtep: { vlan: "vtep", addresses: ["192.0.2.17/28"] } },
            vxlan: { school: vxlan },
        },
        routing: { ...base.routing, router_id: "192.0.2.17", bgp: { asn: 64500, neighbors: { "vtep-b": neighbor } } },
    };
}

/** What the switch printed, with this file's names: `policy vpn-target`, its default, and the IPv4 family the session leaves. */
const PRINTED = `evpn-overlay enable
#
bridge-domain 3973
 description School segment
 l2 binding vlan 3973
 vxlan vni 3973
 evpn
  route-distinguisher 192.0.2.17:3973
  vpn-target 64500:3973 export-extcommunity
  vpn-target 64500:3973 import-extcommunity
#
interface Nve1
 source 192.0.2.17
 vni 3973 head-end peer-list protocol bgp
#
bgp 64500
 router-id 192.0.2.17
 peer 192.0.2.18 as-number 64500
 peer 192.0.2.18 connect-interface Vlanif3974 192.0.2.17
 #
 ipv4-family unicast
  undo peer 192.0.2.18 enable
 #
 l2vpn-family evpn
  policy vpn-target
  peer 192.0.2.18 enable
#
`;

/** The render with the segment, the NVE interface, and BGP as the switch printed them. */
const printed = (render: string) =>
    `${render
        .replace(/^evpn-overlay enable\n#\n/m, "")
        .replace(/^bridge-domain 3973\n[\s\S]*?^#\n/m, "")
        .replace(/^interface Nve1\n[\s\S]*?^#\n/m, "")
        .replace(/^bgp 64500\n[\s\S]*?^#\n(?! )/m, "")}${PRINTED}`;

test("VRP writes a segment as a bridge domain of its VLAN, sent by the NVE interface to the VTEPs BGP finds, as the switch prints it", () => {
    const desired = vrp.render(evpn());

    expect(desired).toContain("bridge-domain 3973\n description School segment\n l2 binding vlan 3973\n vxlan vni 3973\n evpn\n");
    // A session for EVPN alone exchanges no IPv4 routes, so it needs no route-policy.
    expect(desired).not.toContain("route-policy");
    expect(vrp.plan(desired, printed(desired), options).steps).toEqual([]);
    expect(vrp.unsupported(evpn())).toEqual([]);
    expect(vrp.experimental(evpn())).toEqual(["interfaces.vxlan.school", "routing.bgp.neighbors.vtep-b.address_families l2vpn-evpn"]);
});

test("VRP changes a segment's targets in place, and refuses a new route distinguisher in the same plan", () => {
    const current = printed(vrp.render(evpn()));
    const targets = {
        ...segment,
        evpn: { ...segment.evpn, route_targets: { import: ["64500:3973", "64500:3975"], export: ["64500:3974"] } },
    };

    expect(vrp.plan(vrp.render(evpn(targets as Segment)), current, options).steps.flatMap((step) => step.send)).toEqual([
        "bridge-domain 3973",
        "evpn",
        "undo vpn-target 64500:3973 export-extcommunity",
        "vpn-target 64500:3974 export-extcommunity",
        "vpn-target 64500:3975 import-extcommunity",
        "quit",
        "quit",
    ]);

    const moved = { ...segment, evpn: { ...segment.evpn, route_distinguisher: "192.0.2.17:3974" } } as Segment;
    expect(vrp.plan(vrp.render(evpn(moved)), current, options)).toEqual({
        steps: [],
        problems: [
            "the route distinguisher of bridge-domain 3973 changes: the switch takes a new one only once the old is gone, so remove the segment in one apply and add it in the next",
        ],
    });
});

test("VRP refuses what the switch can't take, or what no switch here has run", () => {
    const refused = evpn(
        { ...segment, vni: 16000001, port: 4790, mac: "02:00:00:00:00:01", local_address: "198.51.100.1" } as Segment,
        {
            ...session,
            route_reflector_client: true,
            max_prefixes: 1000,
        } as Session
    );
    const routed: Device = {
        ...refused,
        interfaces: { ...refused.interfaces, vlan_interface: { ...refused.interfaces!.vlan_interface, school: { vlan: "school" } } },
    };

    expect(vrp.unsupported(routed)).toEqual(
        expect.arrayContaining([
            "interfaces.vxlan.school.vni 16000001, the switch takes 16000000 at most",
            "interfaces.vxlan.school.port, not built yet",
            "interfaces.vxlan.school.mac, the switch gives the NVE interface its own",
            "interfaces.vxlan.school.local_address 198.51.100.1, no VLAN interface of the device holds it: VRP builds no loopback yet",
            "interfaces.vlan_interface.school, on the VLAN of interfaces.vxlan.school: a VLAN in a bridge domain is not routed here yet",
            "routing.bgp.neighbors.vtep-b.route_reflector_client beside l2vpn-evpn, not built yet",
            "routing.bgp.neighbors.vtep-b.max_prefixes beside l2vpn-evpn, not built yet",
        ])
    );
});
