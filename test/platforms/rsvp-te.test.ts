// RSVP-TE tunnels (RFC 3209) beside LDP, and OSPF's traffic engineering (RFC 3630). RouterOS 7.24.6 ran them on three CHRs (test/platforms/routeros-chr-rsvp-te.test.ts), and the lines it printed there are fed to the adapter here. Junos refuses them while its MPLS is experimental, and every other platform refuses them.

import { expect, test } from "bun:test";
import { Checks } from "../../src/checks";
import { DeviceChecks } from "../../src/checks/device";
import type { Device, Mpls, RsvpTe } from "../../src/model";
import { Platforms } from "../../src/platforms";
import { Fixtures } from "../fixtures";

const options = { secrets: false, rollback: 10 };
const routeros = Platforms.get("routeros");

/** The router's LSR ID and its LAG toward another router, which runs LDP and RSVP-TE. */
const LDP: Mpls["ldp"] = { lsr_id: "192.0.2.255", interfaces: ["uplink"] };

/** A tunnel along an explicit path, one CSPF computes, and the link they reserve on. */
const RSVP_TE: RsvpTe = {
    interfaces: { uplink: { bandwidth: "10G" } },
    tunnels: {
        "pe-02": {
            destination: "192.0.2.2",
            bandwidth: "1.5G",
            explicit_path: [
                { address: "192.0.2.9", hop_type: "strict" },
                { address: "192.0.2.2", hop_type: "loose" },
            ],
        },
        "pe-03": { description: "pe-03, the clinic's pseudowire", destination: "192.0.2.3", cspf: true },
    },
};

/** A fixture's device with `rsvpTe` beside LDP, its loopback announced by OSPF, and its backbone with traffic engineering when `te`. */
function withRsvpTe(rsvpTe: RsvpTe | undefined, te = true, fixture = "platforms--example-router"): Device {
    const device = Fixtures.device(fixture);
    const ospf = device.routing!.ospf!;
    const backbone = ospf.areas["0.0.0.0"]!;
    const interfaces = { ...backbone.interfaces, loopback: { passive: true } };
    const areas = { ...ospf.areas, "0.0.0.0": { ...backbone, interfaces, ...(te ? { traffic_engineering: true as const } : {}) } };
    return { ...device, routing: { ...device.routing, ospf: { ...ospf, areas }, mpls: { ldp: LDP, rsvp_te: rsvpTe } } };
}

/** What the device checks find, before any platform's own. */
const errors = (device: Device) =>
    DeviceChecks.run(device)
        .filter((finding) => finding.level === "error")
        .map((finding) => finding.message);

const sent = (desired: string, current: string) => routeros.plan(desired, current, options).steps.flatMap((step) => step.send);

test("the device validates, and RouterOS writes OSPF's traffic engineering, RSVP-TE on each link, and a path and a tunnel for each tunnel", () => {
    const device = withRsvpTe(RSVP_TE);
    expect(errors(device)).toEqual([]);

    const desired = routeros.render(device);
    // The LSR ID is OSPF's router address, which CSPF finds the tunnel's far end by, and where each tunnel starts (TRAPS.md).
    expect(desired).toContain("add mpls-te-address=192.0.2.255 mpls-te-area=0.0.0.0 name=ospf-v2");
    expect(desired).toContain(
        '/mpls traffic-eng interface\nadd bandwidth=10G interface=uplink\n/mpls traffic-eng path\nadd hops="192.0.2.9/strict,192.0.2.2/loose" name=pe-02\nadd name=pe-03 use-cspf=yes\n'
    );
    expect(desired).toContain(
        '/mpls traffic-eng tunnel\nadd bandwidth=1500M from-address=192.0.2.255 name=pe-02 primary-path=pe-02 to-address=192.0.2.2\nadd comment="pe-03, the clinic\'s pseudowire" from-address=192.0.2.255 name=pe-03 primary-path=pe-03 to-address=192.0.2.3\n'
    );

    // As the CHRs printed them: each bandwidth in the unit it was given, with `bps`.
    const without = routeros.render(withRsvpTe(undefined, false));
    const printed = desired.replace("bandwidth=10G ", "bandwidth=10000Mbps ").replace("bandwidth=1500M ", "bandwidth=1500000kbps ");
    expect(sent(desired, printed)).toEqual([]);

    expect(sent(desired, without)).toEqual([
        "/routing ospf instance set [ find name=ospf-v2 ] mpls-te-address=192.0.2.255 mpls-te-area=0.0.0.0",
        "/mpls traffic-eng interface add bandwidth=10G interface=uplink",
        "/mpls traffic-eng path add hops=192.0.2.9/strict,192.0.2.2/loose name=pe-02",
        "/mpls traffic-eng path add name=pe-03 use-cspf=yes",
        "/mpls traffic-eng tunnel add bandwidth=1500M from-address=192.0.2.255 name=pe-02 primary-path=pe-02 to-address=192.0.2.2",
        '/mpls traffic-eng tunnel add comment="pe-03, the clinic\'s pseudowire" from-address=192.0.2.255 name=pe-03 primary-path=pe-03 to-address=192.0.2.3',
    ]);
    expect(sent(without, desired)).toEqual([
        "/routing ospf instance unset [ find name=ospf-v2 ] mpls-te-address",
        "/routing ospf instance unset [ find name=ospf-v2 ] mpls-te-area",
        "/mpls traffic-eng tunnel remove [ find name=pe-02 ]",
        "/mpls traffic-eng tunnel remove [ find name=pe-03 ]",
        "/mpls traffic-eng path remove [ find name=pe-02 ]",
        "/mpls traffic-eng path remove [ find name=pe-03 ]",
        "/mpls traffic-eng interface remove [ find interface=uplink ]",
    ]);
});

test("RouterOS changes a tunnel in place: CSPF in place of its hops, and back, and without its bandwidth", () => {
    const explicit = routeros.render(withRsvpTe(RSVP_TE));
    const pe02 = RSVP_TE.tunnels!["pe-02"]!;
    const computed = routeros.render(
        withRsvpTe({ ...RSVP_TE, tunnels: { ...RSVP_TE.tunnels, "pe-02": { destination: pe02.destination, cspf: true } } })
    );

    expect(sent(computed, explicit)).toEqual([
        "/mpls traffic-eng path unset [ find name=pe-02 ] hops",
        "/mpls traffic-eng path set [ find name=pe-02 ] use-cspf=yes",
        "/mpls traffic-eng tunnel unset [ find name=pe-02 ] bandwidth",
    ]);
    expect(sent(explicit, computed)).toEqual([
        "/mpls traffic-eng path set [ find name=pe-02 ] hops=192.0.2.9/strict,192.0.2.2/loose use-cspf=no",
        "/mpls traffic-eng tunnel set [ find name=pe-02 ] bandwidth=1500M",
    ]);
});

test("RSVP-TE runs on links with an IPv4 address and a bandwidth, and its tunnels end at another router along a path", () => {
    const loopback = withRsvpTe({ interfaces: { loopback: { bandwidth: "1G" } } });
    expect(errors(loopback)).toContain(
        "routing.mpls.rsvp_te.interfaces.loopback is a loopback, and RSVP-TE runs on links to other routers. Remove it"
    );

    const none = withRsvpTe({ interfaces: { uplink: { bandwidth: "0M" } }, tunnels: { self: { destination: "192.0.2.255", cspf: true } } });
    expect(errors(none)).toEqual([
        "routing.mpls.rsvp_te.interfaces.uplink.bandwidth 0M is not a rate above 0, such as 200M, 1.5G, or 64k",
        "routing.mpls.rsvp_te.tunnels.self.destination 192.0.2.255 is this router's own LSR ID. Write the far router's",
    ]);

    const pathless = withRsvpTe({
        interfaces: { uplink: { bandwidth: "1G" } },
        tunnels: {
            both: { destination: "192.0.2.2", cspf: true, explicit_path: [] } as never,
            neither: { destination: "192.0.2.3" } as never,
        },
    });
    expect(errors(pathless)).toEqual([
        "routing.mpls.rsvp_te.tunnels.both has explicit_path and cspf. Write one",
        "routing.mpls.rsvp_te.tunnels.both.explicit_path has no hop. Write the routers the tunnel crosses, the one it ends at last",
        "routing.mpls.rsvp_te.tunnels.neither has no path. Write explicit_path, the routers it crosses, or cspf: true, for one the router computes",
    ]);
});

test("CSPF needs OSPF's traffic engineering, which needs RSVP-TE, OSPFv2, and the main table", () => {
    expect(errors(withRsvpTe(RSVP_TE, false))).toEqual([
        "routing.mpls.rsvp_te.tunnels.pe-03.cspf computes the path from each link's bandwidth, which OSPF tells the routers. Write traffic_engineering: true on the OSPF area of routing.mpls.rsvp_te.interfaces",
    ]);
    expect(errors(withRsvpTe(undefined))).toEqual([
        "routing.ospf.areas.0.0.0.0.traffic_engineering tells the other routers the bandwidth of the links that run RSVP-TE, and this router runs none. Write routing.mpls.rsvp_te, or remove it",
    ]);

    const ipv6 = withRsvpTe(RSVP_TE);
    const ospf = { ...ipv6.routing!.ospf!, address_families: ["ipv6" as const] };
    expect(errors({ ...ipv6, routing: { ...ipv6.routing, ospf } })).toContain(
        "routing.ospf.areas.0.0.0.0.traffic_engineering is OSPFv2's (RFC 3630), and routing.ospf.address_families has no ipv4. Add ipv4, or remove it"
    );
});

test("RouterOS runs OSPF's traffic engineering in one area", () => {
    const device = withRsvpTe(RSVP_TE);
    const ospf = device.routing!.ospf!;
    const areas = { ...ospf.areas, "0.0.0.1": { traffic_engineering: true as const, interfaces: {} } };
    expect(routeros.unsupported({ ...device, routing: { ...device.routing, ospf: { ...ospf, areas } } })).toContain(
        "routing.ospf.areas.0.0.0.1.traffic_engineering, a second area with it: RouterOS runs traffic engineering in one OSPF area. Write it on one area"
    );
});

test("Junos refuses RSVP-TE while its MPLS is experimental, and every platform but RouterOS refuses OSPF's traffic engineering", () => {
    const device = withRsvpTe(RSVP_TE);
    expect(Platforms.get("junos").unsupported(device)).toContain(
        "routing.mpls.rsvp_te, not built for Junos yet: its MPLS is experimental, untested on a router that runs it"
    );
    for (const platform of ["junos", "vrp", "fortios", "raisecom-ros"])
        expect(Platforms.get(platform).unsupported(device)).toContain(
            "routing.ospf.areas.0.0.0.0.traffic_engineering, not built yet, since no device of the platform has run it"
        );
});

test("a router of ours that a tunnel crosses or ends at runs RSVP-TE", async () => {
    const devices = Object.values(await Fixtures.example("metro-ring"));
    const head = devices.find((device) => device.routing?.mpls?.rsvp_te?.tunnels);
    expect(head).toBeDefined();
    const ends = devices.map((device) =>
        device === head || !device.routing?.mpls
            ? device
            : { ...device, routing: { ...device.routing, mpls: { ldp: device.routing.mpls.ldp } } }
    );
    const found = Checks.run(ends, undefined)
        .filter((finding) => finding.level === "error")
        .map((finding) => finding.message);
    expect(found.some((message) => /runs no RSVP-TE, so the tunnel never comes up/.test(message))).toBe(true);
    expect(Checks.run(devices, undefined).filter((finding) => finding.level === "error")).toEqual([]);
});
