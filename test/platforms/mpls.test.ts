// MPLS with LDP. RouterOS 7.24.6 ran it on three CHRs (test/platforms/routeros-chr-mpls.test.ts). Junos 21.4R3 took the statements in a `commit check` on a QFX5100, nothing committed (TRAPS.md), so it is experimental there.

import { expect, test } from "bun:test";
import { DeviceChecks } from "../../src/checks/device";
import type { Device, Mpls } from "../../src/model";
import { Platforms } from "../../src/platforms";
import { Fixtures } from "../fixtures";

const options = { secrets: false, rollback: 10 };

/** A fixture's device with `mpls`, its loopback announced by OSPF. */
function withMpls(fixture: string, mpls: Mpls): Device {
    const device = Fixtures.device(fixture);
    const ospf = device.routing!.ospf!;
    const backbone = ospf.areas["0.0.0.0"]!;
    const areas = { ...ospf.areas, "0.0.0.0": { ...backbone, interfaces: { ...backbone.interfaces, loopback: { passive: true } } } };
    return { ...device, routing: { ...device.routing, ospf: { ...ospf, areas }, mpls } };
}

/** What the device checks find, before any platform's own. */
const errors = (device: Device) =>
    DeviceChecks.run(device)
        .filter((finding) => finding.level === "error")
        .map((finding) => finding.message);

const sent = (platform: string, desired: string, current: string) =>
    Platforms.get(platform)
        .plan(desired, current, options)
        .steps.flatMap((step) => step.send);

/** The router's loopback, its router ID, and its LAG toward another LDP router. */
const ROUTER: Mpls = { ldp: { lsr_id: "192.0.2.255", interfaces: ["uplink"] } };

test("RouterOS enables MPLS on each LDP interface, then runs LDP from the LSR ID, and removes them in the reverse order", () => {
    const routeros = Platforms.get("routeros");
    const device = withMpls("platforms--example-router", ROUTER);
    const desired = routeros.render(device);
    const without = routeros.render({ ...device, routing: { ...device.routing, mpls: undefined } });

    expect(sent("routeros", desired, without)).toEqual([
        "/mpls interface add interface=uplink",
        "/mpls ldp add afi=ip lsr-id=192.0.2.255 transport-addresses=192.0.2.255",
        "/mpls ldp interface add interface=uplink",
    ]);
    expect(sent("routeros", without, desired)).toEqual([
        "/mpls ldp interface remove [ find interface=uplink ]",
        "/mpls ldp remove [ find (vrf=main or !vrf) ]",
        "/mpls interface remove [ find interface=uplink ]",
    ]);

    // As the CHRs printed theirs, with this router's names.
    const printed = `${without}/mpls interface
add interface=uplink
/mpls ldp
add afi=ip lsr-id=192.0.2.255 transport-addresses=192.0.2.255
/mpls ldp interface
add interface=uplink
`;
    expect(sent("routeros", desired, printed)).toEqual([]);
});

test("Junos puts the MPLS family on each LDP interface, runs MPLS and LDP there, and deletes them whole", () => {
    const junos = Platforms.get("junos");
    const device = withMpls("platforms--example-aggregation-switch", { ldp: { lsr_id: "203.0.113.65", interfaces: ["10g-48"] } });
    const desired = junos.render(device);

    // As `show | display set` printed them in the candidate of a `commit check`. Nothing was committed.
    for (const statement of [
        "set interfaces xe-0/0/47 unit 0 family mpls",
        "set protocols mpls interface xe-0/0/47.0",
        "set protocols ldp interface xe-0/0/47.0",
    ])
        expect(desired).toContain(statement);

    const without = junos.render({ ...device, routing: { ...device.routing, mpls: undefined } });
    expect(sent("junos", without, desired)).toEqual([
        "delete interfaces xe-0/0/47 unit 0 family mpls",
        "delete protocols mpls",
        "delete protocols ldp",
    ]);
});

// Nothing was committed, and the switch has no license to run MPLS or LDP.
test("MPLS on Junos is experimental", () => {
    const device = withMpls("platforms--example-aggregation-switch", { ldp: { lsr_id: "203.0.113.65", interfaces: ["10g-48"] } });

    expect(Platforms.get("junos").experimental!(device)).toEqual(["routing.mpls"]);
});

test("Junos refuses an LSR ID other than the router ID, which LDP takes as its own", () => {
    const device = withMpls("platforms--example-aggregation-switch", { ldp: { lsr_id: "203.0.113.66", interfaces: ["10g-48"] } });

    expect(Platforms.get("junos").unsupported(device)).toContain(
        "routing.mpls.ldp.lsr_id 203.0.113.66, Junos takes the LSR ID from routing.router_id: write the same address in both"
    );
});

test("FortiOS, VRP, and Raisecom ROS refuse MPLS", () => {
    const device = withMpls("platforms--example-router", ROUTER);

    expect(Platforms.get("fortios").unsupported({ ...device, platform: "fortios", model: "FG-3700D" })).toContain(
        "routing.mpls, FortiOS has no MPLS"
    );
    for (const platform of ["vrp", "raisecom-ros"])
        expect(Platforms.get(platform).unsupported({ ...device, platform } as Device)).toContain("routing.mpls, not built yet");
});

test("the LSR ID is the address of a loopback that OSPF or IS-IS announces", () => {
    expect(errors(withMpls("platforms--example-router", ROUTER))).toEqual([]);

    expect(errors(withMpls("platforms--example-router", { ldp: { lsr_id: "192.0.2.254", interfaces: ["uplink"] } }))).toContain(
        "routing.mpls.ldp.lsr_id 192.0.2.254 is no address of a loopback, and LDP sessions run between LSR IDs. Write the address of a loopback, such as 192.0.2.255"
    );

    const unannounced = { ...Fixtures.device("platforms--example-router") };
    unannounced.routing = { ...unannounced.routing, mpls: ROUTER };
    expect(errors(unannounced)).toContain(
        "routing.mpls.ldp.lsr_id 192.0.2.255 is on loopback loopback, which neither OSPF nor IS-IS announces, so other LDP routers can't reach it. Add loopback to routing.isis.interfaces, or to an area of routing.ospf, with passive: true"
    );
});

test("an LDP interface is a link in the main table, with an IPv4 address, and listed once", () => {
    const device = withMpls("platforms--example-router", {
        ldp: { lsr_id: "192.0.2.255", interfaces: ["uplink", "uplink", "loopback", "guests"] },
    });

    expect(errors(device)).toEqual([
        "routing.mpls.ldp.interfaces uplink is listed twice. Remove one",
        "routing.mpls.ldp.interfaces loopback is a loopback, and LDP runs on links to other routers. Remove it",
        "routing.mpls.ldp.interfaces guests routes in VRF guests, and MPLS runs in the main table. Remove it",
    ]);

    const switchDevice = withMpls("platforms--example-aggregation-switch", { ldp: { lsr_id: "203.0.113.65", interfaces: ["40g-1"] } });
    expect(errors(switchDevice)).toContain(
        "routing.mpls.ldp.interfaces 40g-1 has no IPv4 address, which LDP needs to find its neighbors. Give it one, or remove it"
    );
});
