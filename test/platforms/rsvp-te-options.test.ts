// An RSVP-TE tunnel's options on RouterOS: secondary paths. RouterOS 7.24.6 ran them on three CHRs (test/platforms/routeros-chr-rsvp-te-options.test.ts), and the lines it printed there are fed to the adapter here.

import { expect, test } from "bun:test";
import type { Device, Mpls, RsvpTe } from "../../src/model";
import { Platforms } from "../../src/platforms";
import { Fixtures } from "../fixtures";

const options = { secrets: false, rollback: 10 };
const routeros = Platforms.get("routeros");

const LDP: Mpls["ldp"] = { lsr_id: "192.0.2.255", interfaces: ["uplink"] };

/** A tunnel CSPF computes, with a secondary path set up ahead and another CSPF computes. */
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

test("RouterOS writes a tunnel's secondary paths in order, the first set up ahead", () => {
    const desired = routeros.render(withRsvpTe(RSVP_TE));
    expect(desired).toContain(
        [
            "/mpls traffic-eng path",
            "add name=pe-02 use-cspf=yes",
            "add hops=192.0.2.9/loose name=pe-02-around",
            "add name=pe-02-any use-cspf=yes",
            "/mpls traffic-eng tunnel",
            'add bandwidth=1500M from-address=192.0.2.255 name=pe-02 primary-path=pe-02 secondary-paths="pe-02-around,pe-02-any" secondary-standby=yes to-address=192.0.2.2',
        ].join("\n")
    );

    // As the CHRs printed them: each bandwidth in the unit it was given, with `bps`.
    const printed = desired.replace("bandwidth=10G ", "bandwidth=10000Mbps ").replace("bandwidth=1500M ", "bandwidth=1500000kbps ");
    expect(sent(desired, printed)).toEqual([]);
});

test("RouterOS lets a tunnel go of its secondary paths before they go", () => {
    const all = routeros.render(withRsvpTe(RSVP_TE));
    const bare = routeros.render(withRsvpTe(tunnelWith({ secondary_paths: undefined })));

    expect(sent(bare, all)).toEqual([
        "/mpls traffic-eng tunnel unset [ find name=pe-02 ] secondary-paths",
        "/mpls traffic-eng tunnel set [ find name=pe-02 ] secondary-standby=no",
        "/mpls traffic-eng path remove [ find name=pe-02-around ]",
        "/mpls traffic-eng path remove [ find name=pe-02-any ]",
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
