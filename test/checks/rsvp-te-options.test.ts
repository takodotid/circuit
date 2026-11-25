// What validate says of an RSVP-TE tunnel's options: its secondary paths, priorities (RFC 3209, section 4.7), and admin groups (RFC 3630).

import { expect, test } from "bun:test";
import { Checks } from "../../src/checks";
import { DeviceChecks } from "../../src/checks/device";
import type { Device, Mpls, RsvpTe } from "../../src/model";
import { Fixtures } from "../fixtures";

const LDP: Mpls["ldp"] = { lsr_id: "192.0.2.255", interfaces: ["uplink"] };

/** A fixture's device with `rsvpTe` beside LDP, and OSPF's traffic engineering on its backbone. */
function withRsvpTe(rsvpTe: RsvpTe): Device {
    const device = Fixtures.device("platforms--example-router");
    const ospf = device.routing!.ospf!;
    const backbone = ospf.areas["0.0.0.0"]!;
    const interfaces = { ...backbone.interfaces, loopback: { passive: true } };
    const areas = { ...ospf.areas, "0.0.0.0": { ...backbone, interfaces, traffic_engineering: true as const } };
    return { ...device, routing: { ...device.routing, ospf: { ...ospf, areas }, mpls: { ldp: LDP, rsvp_te: rsvpTe } } };
}

const errors = (device: Device) =>
    DeviceChecks.run(device)
        .filter((finding) => finding.level === "error")
        .map((finding) => finding.message);

test("a tunnel with its options validates", () => {
    const device = withRsvpTe({
        admin_groups: { red: 0, blue: 1 },
        interfaces: { uplink: { bandwidth: "10G", admin_groups: ["red"] } },
        tunnels: {
            "pe-02": {
                destination: "192.0.2.2",
                cspf: true,
                admin_groups: { exclude_group: ["red"] },
                secondary_paths: {
                    "pe-02-around": { explicit_path: [{ address: "192.0.2.9", hop_type: "loose" }], standby: true },
                },
                setup_priority: 4,
                hold_priority: 3,
                record_route: true,
            },
        },
    });
    expect(errors(device)).toEqual([]);
});

test("priorities go together, from 0 to 7, the setup priority never higher than the hold priority (RFC 3209, section 4.7.3)", () => {
    const device = withRsvpTe({
        interfaces: { uplink: { bandwidth: "10G" } },
        tunnels: {
            alone: { destination: "192.0.2.2", cspf: true, setup_priority: 3 },
            higher: { destination: "192.0.2.3", cspf: true, setup_priority: 0, hold_priority: 7 },
            wrong: { destination: "192.0.2.4", cspf: true, setup_priority: 8, hold_priority: 0 } as never,
        },
    });
    expect(errors(device)).toEqual([
        "routing.mpls.rsvp_te.tunnels.alone has setup_priority alone. Write hold_priority beside it",
        "routing.mpls.rsvp_te.tunnels.higher.setup_priority 0 is higher than hold_priority 7, so the tunnel could take bandwidth it then gives up to a tunnel like itself (RFC 3209, section 4.7.3). Write a hold_priority of 0 or higher, a lower number",
        "routing.mpls.rsvp_te.tunnels.wrong.setup_priority 8 is not a priority from 0, the highest, to 7",
    ]);
});

test("a secondary path is a path, and has a name of its own on the device", () => {
    const device = withRsvpTe({
        interfaces: { uplink: { bandwidth: "10G" } },
        tunnels: {
            "pe-02": { destination: "192.0.2.2", cspf: true, secondary_paths: { "pe-03": { cspf: true }, around: {} as never } },
            "pe-03": { destination: "192.0.2.3", cspf: true, secondary_paths: { around: { cspf: true } } },
        },
    });
    expect(errors(device)).toEqual([
        "routing.mpls.rsvp_te.tunnels.pe-02.secondary_paths.around has no path. Write explicit_path, the routers it crosses, or cspf: true, for one the router computes",
        "routing.mpls.rsvp_te.tunnels.pe-02.secondary_paths.pe-03 has the name of tunnel pe-03's primary path, and each path of the device has its own. Give it another name",
        "routing.mpls.rsvp_te.tunnels.pe-03.secondary_paths.around has the name of tunnel pe-02's secondary path, and each path of the device has its own. Give it another name",
    ]);
});

test("each admin group is its own bit, from 0 to 31", () => {
    const device = withRsvpTe({ admin_groups: { red: 0, blue: 0, green: 32 }, interfaces: { uplink: { bandwidth: "10G" } } });
    expect(errors(device)).toEqual([
        "routing.mpls.rsvp_te.admin_groups.blue is bit 0, as admin group red is. Give each its own bit",
        "routing.mpls.rsvp_te.admin_groups.green 32 is not a bit from 0 to 31 (RFC 3630). Write one of them",
    ]);
});

test("admin groups keep to links as CSPF computes, so an explicit path takes none", () => {
    const device = withRsvpTe({
        admin_groups: { red: 0 },
        interfaces: { uplink: { bandwidth: "10G" } },
        tunnels: {
            "pe-02": {
                destination: "192.0.2.2",
                explicit_path: [{ address: "192.0.2.9", hop_type: "strict" }],
                admin_groups: { exclude_group: ["red"] },
            } as never,
        },
    });
    expect(errors(device)).toEqual([
        "routing.mpls.rsvp_te.tunnels.pe-02.admin_groups keeps to links as CSPF computes the path. Write cspf: true in place of explicit_path",
    ]);
});

test("each router of ours a secondary path crosses runs RSVP-TE", async () => {
    const devices = Object.values(await Fixtures.example("metro-ring"));
    expect(Checks.run(devices, undefined).filter((finding) => finding.level === "error")).toEqual([]);

    const withoutTe = devices.map((device) =>
        device.name === "ring-02" ? { ...device, routing: { ...device.routing, mpls: { ldp: device.routing!.mpls!.ldp } } } : device
    );
    const found = Checks.run(withoutTe, undefined).map((finding) => finding.message);
    expect(found).toContain(
        "routing.mpls.rsvp_te.tunnels.ring-03.secondary_paths.ring-03-around.explicit_path[0].address 10.1.12.2 is ring-02's, which runs no RSVP-TE, so the tunnel never comes up. Write routing.mpls.rsvp_te.interfaces on ring-02"
    );
});

test("an admin group is the same bit on every router", async () => {
    const devices = Object.values(await Fixtures.example("metro-ring"));
    const recolored = devices.map((device) => {
        const rsvpTe = device.routing?.mpls?.rsvp_te;
        if (device.name !== "ring-02" || !rsvpTe?.admin_groups) return device;
        const admin_groups = { ...rsvpTe.admin_groups, wave: 7 };
        return { ...device, routing: { ...device.routing, mpls: { ...device.routing!.mpls!, rsvp_te: { ...rsvpTe, admin_groups } } } };
    });
    const found = Checks.run(recolored, undefined).map((finding) => finding.message);
    // Whichever router comes first holds the bit the others are held to.
    expect(
        found.some((message) =>
            /^routing\.mpls\.rsvp_te\.admin_groups\.wave is bit [17], and bit [17] on ring-0\d\. Write the same bit on every router$/.test(
                message
            )
        )
    ).toBe(true);
});
