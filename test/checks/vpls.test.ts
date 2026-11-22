// What validate says about a VLAN in a VPLS whose PEs BGP finds. It checks the route distinguisher, the route targets, and the site ID (RFC 4761) or VPLS-id (RFC 6074), and what carries them.

import { beforeAll, expect, test } from "bun:test";
import { CrossChecks } from "../../src/checks/cross";
import { DeviceChecks } from "../../src/checks/device";
import type { Device } from "../../src/model";
import type { Vpls } from "../../src/config/switching";
import { Fixtures } from "../fixtures";

/** The routers of the MPLS core example: the museum's VLAN is in a VPLS at pe-01 and pe-02, and the library's at pe-01 and pe-03. */
let core: Record<string, Device>;

beforeAll(async () => {
    core = await Fixtures.example("mpls-core");
});

const errors = (device: Device) =>
    DeviceChecks.run(device)
        .filter((finding) => finding.level === "error")
        .map((finding) => finding.message);

/** Settings of a VPLS, any of them, written as a project might, right or wrong. */
type Written = { route_distinguisher?: string; route_targets?: Vpls["route_targets"]; site_id?: number; vpls_id?: string };

/** A router of the example with the VPLS of one of its VLANs changed, and a key set to `undefined` left out. */
function withVpls(name: string, changed: Written, vlan = "museum"): Device {
    const device = core[name]!;
    const settings = device.switching!.vlans![vlan]!;
    const vpls = Object.fromEntries(
        Object.entries({ ...settings.vpls!, ...changed }).filter(([, value]) => value !== undefined)
    ) as unknown as Vpls;
    return { ...device, switching: { ...device.switching, vlans: { ...device.switching!.vlans, [vlan]: { ...settings, vpls } } } };
}

/** What the cross-device checks find among these routers, each with the device that has it. */
const across = (routers: Device[]) => CrossChecks.run(routers).map((finding) => `${finding.device}: ${finding.message}`);

test("a VLAN's VPLS has a route distinguisher of its own, route targets, and a site ID of 2 bytes", () => {
    for (const name of ["pe-01", "pe-02", "pe-03"]) expect(errors(core[name]!)).toEqual([]);

    expect(errors(withVpls("pe-02", { route_distinguisher: "64500:101", route_targets: {}, site_id: 0 }))).toEqual([
        "switching.vlans.museum.vpls.route_distinguisher 64500:101 is VRF bank's too, and it is what keeps their routes apart. Give each its own",
        'switching.vlans.museum.vpls.route_targets has no target. Write import, export, or both, such as { import: ["64500:300"], export: ["64500:300"] }',
        "switching.vlans.museum.vpls.site_id 0: write a whole number from 1 to 65535, which no other PE of the VPLS has",
    ]);
    expect(
        errors(withVpls("pe-02", { route_distinguisher: "64500", route_targets: { import: ["64500:303", "64500:303"] }, site_id: 65536 }))
    ).toEqual([
        "switching.vlans.museum.vpls.route_distinguisher 64500 is not a number after a colon: write an AS number or an IPv4 address, a colon, and a number, such as 64500:101",
        "switching.vlans.museum.vpls.route_targets.import lists 64500:303 twice. Remove one",
        "switching.vlans.museum.vpls.site_id 65536: write a whole number from 1 to 65535, which no other PE of the VPLS has",
    ]);
});

test("a VLAN's VPLS has a site ID, for pseudowires that BGP sets up, or a VPLS-id, for those LDP sets up", () => {
    expect(errors(withVpls("pe-02", { site_id: undefined, vpls_id: "64500:303" }))).toEqual([]);
    expect(errors(withVpls("pe-02", { site_id: undefined }))).toEqual([
        "switching.vlans.museum.vpls has neither site_id nor vpls_id. Write site_id, this PE's number, for pseudowires that BGP sets up, or vpls_id, the VPLS's ID, for pseudowires that LDP sets up",
    ]);
    expect(errors(withVpls("pe-02", { vpls_id: "64500" }))).toEqual([
        "switching.vlans.museum.vpls has site_id and vpls_id. Write site_id for pseudowires that BGP sets up, or vpls_id for pseudowires that LDP sets up, the same at every PE of the VPLS",
        "switching.vlans.museum.vpls.vpls_id 64500 is not a number after a colon: write an AS number or an IPv4 address, a colon, and a number, such as 64500:101",
    ]);
});

test("a VLAN's VPLS needs MPLS, and a BGP neighbor that carries l2vpn-vpls from the LSR ID", () => {
    const pe03 = core["pe-03"]!;
    const withoutMpls: Device = { ...pe03, routing: { ...pe03.routing, mpls: undefined } };
    expect(errors(withoutMpls)).toEqual([
        "routing.bgp.neighbors.pe-01 carries l2vpn-vpls without routing.mpls, and traffic to a VPN route crosses the core by label. Write routing.mpls.ldp",
        "interfaces.pseudowire.pw-tv needs routing.mpls: LDP sets up the pseudowire, and its frames cross the core by label. Write routing.mpls.ldp",
        "switching.vlans.library.vpls needs routing.mpls: the VPLS's frames cross the core by label. Write routing.mpls.ldp",
    ]);

    const bgp = pe03.routing!.bgp!;
    const evpnOnly: Device = { ...pe03, routing: { ...pe03.routing, bgp: { ...bgp, neighbors: { "pe-02": bgp.neighbors!["pe-02"]! } } } };
    expect(errors(evpnOnly)).toEqual([
        "switching.vlans.library.vpls: BGP finds the VPLS's other PEs, and no BGP neighbor carries l2vpn-vpls. Write a neighbor in routing.bgp whose address_families has l2vpn-vpls",
    ]);

    const fromLink: Device = {
        ...pe03,
        routing: {
            ...pe03.routing,
            bgp: { ...bgp, neighbors: { ...bgp.neighbors, "pe-01": { ...bgp.neighbors!["pe-01"]!, local_address: "10.0.23.2" } } },
        },
    };
    expect(errors(fromLink)).toEqual([
        "routing.bgp.neighbors.pe-01 carries l2vpn-vpls from 10.0.23.2, and the far PE sends the VPN's traffic to that address, by the label LDP gives this router's LSR ID. Write local_address: \"10.255.0.3\"",
    ]);
});

test("the PEs of one VPLS each have a site ID of their own, or all the same VPLS-id", () => {
    expect(CrossChecks.run(Object.values(core)).filter((finding) => finding.level === "error")).toEqual([]);

    expect(across([withVpls("pe-01", { site_id: 2 }), core["pe-02"]!])).toEqual([
        "pe-01: switching.vlans.museum.vpls.site_id 2 is also the site_id of pe-02's VLAN museum, whose VPLS routes this VLAN takes. Give each PE of the VPLS its own site_id",
        "pe-02: switching.vlans.museum.vpls.site_id 2 is also the site_id of pe-01's VLAN museum, whose VPLS routes this VLAN takes. Give each PE of the VPLS its own site_id",
    ]);

    // A VPLS that takes none of the other's routes is another VPLS, where the same site ID is no clash.
    const apart = [withVpls("pe-01", { site_id: 2, route_targets: { import: ["64500:399"], export: ["64500:399"] } }), core["pe-02"]!];
    expect(across(apart).filter((finding) => finding.includes("vpls"))).toEqual([]);

    expect(across([withVpls("pe-01", { vpls_id: "64500:399" }, "library"), core["pe-03"]!])).toEqual([
        "pe-01: switching.vlans.library.vpls.vpls_id 64500:399, and pe-03's VLAN library, whose VPLS routes this VLAN takes, has 64500:302: LDP sets up no pseudowire between the two. Write the same vpls_id at every PE of the VPLS",
        "pe-03: switching.vlans.library.vpls.vpls_id 64500:302, and pe-01's VLAN library, whose VPLS routes this VLAN takes, has 64500:399: LDP sets up no pseudowire between the two. Write the same vpls_id at every PE of the VPLS",
    ]);
    expect(across([withVpls("pe-01", { vpls_id: undefined, site_id: 1 }, "library"), core["pe-03"]!])).toEqual([
        "pe-01: switching.vlans.library.vpls has site_id, and pe-03's VLAN library, whose VPLS routes this VLAN takes, has vpls_id: BGP and LDP set up no pseudowire between the two. Write the same one at every PE of the VPLS",
        "pe-03: switching.vlans.library.vpls has vpls_id, and pe-01's VLAN library, whose VPLS routes this VLAN takes, has site_id: BGP and LDP set up no pseudowire between the two. Write the same one at every PE of the VPLS",
    ]);
});
