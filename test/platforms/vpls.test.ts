// VPLSs whose PEs BGP finds, the school's among the three PEs of the MPLS core example (RFC 4761) and the library's between two (RFC 6074). RouterOS 7.24.6 ran both on three CHRs (test/platforms/routeros-chr-vpls.test.ts), and the lines it printed there are fed to the adapter here. Every other platform refuses them.

import { beforeAll, expect, test } from "bun:test";
import type { Device } from "../../src/model";
import { Platforms } from "../../src/platforms";
import { Fixtures } from "../fixtures";

const options = { secrets: false, rollback: 10 };
const routeros = Platforms.get("routeros");

/** The three PEs of the MPLS core example, each with the school's VLAN in a VPLS, and two with the library's. */
let core: Record<string, Device>;

beforeAll(async () => {
    core = await Fixtures.example("mpls-core");
});

/** pe-03 with the school's VLAN as written here. */
function withSchool(vlan: NonNullable<NonNullable<Device["switching"]>["vlans"]>[string]): Device {
    const pe03 = core["pe-03"]!;
    return { ...pe03, switching: { ...pe03.switching, vlans: { ...pe03.switching!.vlans, school: vlan } } };
}

test("RouterOS writes a VLAN's VPLS as a BGP VPLS entry named after the VLAN, whose pseudowires join the VLAN in the pseudowires' split horizon", () => {
    const desired = routeros.render(core["pe-03"]!);

    expect(desired).toContain(
        '/routing bgp vpls\nadd bridge=bridge bridge-horizon=2 bridge-pvid=301 export-route-targets=64500:301 import-route-targets=64500:301 name=school rd=64500:301 site-id=3\nadd bridge=bridge bridge-horizon=2 bridge-pvid=302 cisco-id="10.255.0.3&64500:302" export-route-targets=64500:302 import-route-targets=64500:302 name=library rd=64500:302\n'
    );
    // One family carries both kinds of VPLS route, which RouterOS tells apart, and the session's chain takes both.
    expect(desired).toContain(
        'add afi="l2vpn,l2vpn-cisco" as=64500 comment="pe-01, VPLS routes" input.filter=VPN instance=default local.address=10.255.0.3 local.role=ibgp name=pe-01 output.filter-chain=VPN remote.address=10.255.0.1/32 remote.as=64500\n'
    );
    expect(desired).toContain(
        'add chain=VPN rule="if (afi vpnv4) { accept }"\nadd chain=VPN rule="if (afi l2vpn) { accept }"\nadd chain=VPN rule="if (afi l2vpn-cisco) { accept }"\nadd chain=VPN rule=reject\n'
    );

    // As the CHRs printed them: the families in one word, and the VPLS-id after the address.
    const printed = desired
        .replaceAll('afi="l2vpn,l2vpn-cisco"', "afi=l2vpn,l2vpn-cisco")
        .replace('cisco-id="10.255.0.3&64500:302"', "cisco-id=10.255.0.3&64500:302");
    expect(routeros.plan(desired, printed, options).steps).toEqual([]);
});

test("RouterOS changes a VPLS's site ID, route distinguisher, and route targets in place", () => {
    const desired = routeros.render(core["pe-03"]!);
    const school = core["pe-03"]!.switching!.vlans!.school!;
    const changed = routeros.render(
        withSchool({
            ...school,
            vpls: {
                route_distinguisher: "10.255.0.3:301",
                route_targets: { import: ["64500:301", "64500:399"], export: ["64500:301"] },
                site_id: 13,
            },
        })
    );

    expect(routeros.plan(changed, desired, options).steps.flatMap((step) => step.send)).toEqual([
        "/routing bgp vpls set [ find name=school ] import-route-targets=64500:301,64500:399 rd=10.255.0.3:301 site-id=13",
    ]);
});

test("RouterOS wants each VLAN interface beside a VPLS that BGP sets up at an MTU of 1496 or less, as beside a pseudowire", () => {
    const pe03 = core["pe-03"]!;
    const routed: Device = {
        ...pe03,
        interfaces: { ...pe03.interfaces, vlan_interface: { "vlan-school": { vlan: "school", addresses: ["203.0.113.1/26"] } } },
    };
    expect(routeros.unsupported(routed)).toEqual([
        "interfaces.vlan_interface.vlan-school.mtu left out, 1500 beside a pseudowire: RouterOS lowers it to 1496 once the pseudowire runs, and refuses more. Write mtu: 1496 or less",
    ]);
});

test("RouterOS refuses a pseudowire written in a VLAN whose PEs BGP finds, as every pseudowire there shares one split horizon", () => {
    const pe03 = core["pe-03"]!;
    const spoke: Device = {
        ...pe03,
        interfaces: { ...pe03.interfaces, pseudowire: { "pw-school": { peer: "10.255.0.2", pw_id: 301, access_vlan: "school" } } },
    };
    expect(routeros.unsupported(spoke)).toEqual([
        "interfaces.pseudowire.pw-school in VLAN school, a VPLS whose PEs BGP finds: its pseudowires and this one share one split horizon, so no frame passes between them. Put this pseudowire in another VLAN, or remove vpls there",
    ]);
});

test("Junos, FortiOS, VRP, and Raisecom ROS refuse a VPLS that BGP sets up, each saying why", () => {
    const reasons: Record<string, string> = {
        junos: "a VPLS by BGP, not built for Junos yet: its MPLS is experimental, untested on a router that runs it",
        fortios: "a VPLS: FortiOS has no MPLS",
        vrp: "a VPLS by BGP, not built yet",
        "raisecom-ros": "a VPLS by BGP, not built yet",
    };
    const school = core["pe-03"]!.switching!.vlans!.school!;

    for (const [platform, reason] of Object.entries(reasons)) {
        const device = Fixtures.device(Fixtures.ofPlatform(platform)[0]!);
        const bgp = device.routing?.bgp ?? {};
        const withVpls: Device = {
            ...device,
            switching: { ...device.switching, vlans: { ...device.switching?.vlans, school } },
            routing: {
                ...device.routing,
                bgp: { ...bgp, neighbor_groups: { ...bgp.neighbor_groups, pe: { address_families: ["l2vpn-vpls"] } } },
            },
        };
        const refused = Platforms.get(platform).unsupported(withVpls);
        for (const where of ["switching.vlans.school.vpls", "routing.bgp.neighbor_groups.pe.address_families l2vpn-vpls"])
            expect(refused).toContain(`${where}, ${reason}`);
    }
});
