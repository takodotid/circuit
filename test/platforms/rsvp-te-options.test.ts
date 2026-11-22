// An RSVP-TE tunnel's options on RouterOS: secondary paths, priorities, and record route. RouterOS 7.24.6 ran them on three CHRs (test/platforms/routeros-chr-rsvp-te-options.test.ts), and the lines it printed there are fed to the adapter here.

import { expect, test } from "bun:test";
import type { Device, Mpls, RsvpTe } from "../../src/model";
import { Platforms } from "../../src/platforms";
import { Fixtures } from "../fixtures";

const options = { secrets: false, rollback: 10 };
const routeros = Platforms.get("routeros");

const LDP: Mpls["ldp"] = { lsr_id: "192.0.2.255", interfaces: ["uplink"] };

/** A tunnel CSPF computes, with a secondary path set up ahead and another CSPF computes, its priorities, and record route. */
const RSVP_TE: RsvpTe = {
    interfaces: { uplink: { bandwidth: "10G" } },
    tunnels: {
        "pe-02": {
            destination: "192.0.2.2",
            bandwidth: "1.5G",
            cspf: true,
            secondary_paths: {
                "pe-02-around": { explicit_path: [{ address: "192.0.2.9", hop_type: "loose" }], standby: true },
                "pe-02-any": { cspf: true },
            },
            setup_priority: 4,
            hold_priority: 3,
            record_route: true,
        },
    },
};

/** A fixture's device with `rsvpTe` beside LDP, its loopback announced by OSPF, with traffic engineering. */
function withRsvpTe(rsvpTe: RsvpTe): Device {
    const device = Fixtures.device("platforms--example-router");
    const ospf = device.routing!.ospf!;
    const backbone = ospf.areas["0.0.0.0"]!;
    const interfaces = { ...backbone.interfaces, loopback: { passive: true } };
    const areas = { ...ospf.areas, "0.0.0.0": { ...backbone, interfaces, traffic_engineering: true as const } };
    return { ...device, routing: { ...device.routing, ospf: { ...ospf, areas }, mpls: { ldp: LDP, rsvp_te: rsvpTe } } };
}

const sent = (desired: string, current: string) => routeros.plan(desired, current, options).steps.flatMap((step) => step.send);

/** The tunnel of `RSVP_TE` with `changes`. */
const tunnelWith = (changes: object): RsvpTe => ({ ...RSVP_TE, tunnels: { "pe-02": { ...RSVP_TE.tunnels!["pe-02"]!, ...changes } } });

test("RouterOS writes a tunnel's priorities and record route on each of its paths, and its secondary paths in order", () => {
    const desired = routeros.render(withRsvpTe(RSVP_TE));
    expect(desired).toContain(
        [
            "/mpls traffic-eng path",
            "add holding-priority=3 name=pe-02 record-route=yes setup-priority=4 use-cspf=yes",
            "add holding-priority=3 hops=192.0.2.9/loose name=pe-02-around record-route=yes setup-priority=4",
            "add holding-priority=3 name=pe-02-any record-route=yes setup-priority=4 use-cspf=yes",
            "/mpls traffic-eng tunnel",
            'add bandwidth=1500M from-address=192.0.2.255 name=pe-02 primary-path=pe-02 secondary-paths="pe-02-around,pe-02-any" secondary-standby=yes to-address=192.0.2.2',
        ].join("\n")
    );

    // As the CHRs printed them: each bandwidth in the unit it was given, with `bps`.
    const printed = desired.replace("bandwidth=10G ", "bandwidth=10000Mbps ").replace("bandwidth=1500M ", "bandwidth=1500000kbps ");
    expect(sent(desired, printed)).toEqual([]);
});

test("RouterOS changes a tunnel's options in place, and clears each with unset", () => {
    const all = routeros.render(withRsvpTe(RSVP_TE));
    const bare = routeros.render(
        withRsvpTe(tunnelWith({ secondary_paths: undefined, setup_priority: undefined, hold_priority: undefined, record_route: undefined }))
    );

    // The tunnel lets go of its secondary paths before they go.
    expect(sent(bare, all)).toEqual([
        "/mpls traffic-eng path unset [ find name=pe-02 ] setup-priority",
        "/mpls traffic-eng path unset [ find name=pe-02 ] holding-priority",
        "/mpls traffic-eng path unset [ find name=pe-02 ] record-route",
        "/mpls traffic-eng tunnel unset [ find name=pe-02 ] secondary-paths",
        "/mpls traffic-eng tunnel set [ find name=pe-02 ] secondary-standby=no",
        "/mpls traffic-eng path remove [ find name=pe-02-around ]",
        "/mpls traffic-eng path remove [ find name=pe-02-any ]",
    ]);

    const raised = routeros.render(withRsvpTe(tunnelWith({ setup_priority: 1, hold_priority: 0 })));
    expect(sent(raised, all)).toEqual([
        "/mpls traffic-eng path set [ find name=pe-02 ] holding-priority=0 setup-priority=1",
        "/mpls traffic-eng path set [ find name=pe-02-around ] holding-priority=0 setup-priority=1",
        "/mpls traffic-eng path set [ find name=pe-02-any ] holding-priority=0 setup-priority=1",
    ]);
});

test("RouterOS sets up ahead the first secondary path of a tunnel alone", () => {
    const second = tunnelWith({
        secondary_paths: {
            "pe-02-around": { explicit_path: [{ address: "192.0.2.9", hop_type: "loose" }] },
            "pe-02-any": { cspf: true, standby: true },
        },
    });
    expect(routeros.unsupported(withRsvpTe(second))).toContain(
        "routing.mpls.rsvp_te.tunnels.pe-02.secondary_paths.pe-02-any.standby, not on the first secondary path: RouterOS sets up ahead one secondary path, the first that comes up. Write standby on the first one alone"
    );
    expect(routeros.unsupported(withRsvpTe(RSVP_TE)).filter((problem) => problem.includes("rsvp_te"))).toEqual([]);
});
