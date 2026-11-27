// MPLS with LDP on VRP, tried on a CE6855 on V200R005C00SPC800 on VLAN interfaces of new VLANs with no ports, so no LDP session came up. Circuit's plan from nothing was committed with `commit trial`, and the plan after it was empty. A change, a new LSR ID, and the removal went into a candidate during the trial, and the plan against each was empty. `PRINTED` is what the switch printed, with the names of this file.

import { expect, test } from "bun:test";
import type { Device, Mpls, PolicyRule } from "../../src/model";
import { Vrp } from "../../src/platforms/vrp/index";
import { Fixtures } from "../fixtures";

const vrp = new Vrp();
const options = { secrets: false, rollback: 10 };
const base = Fixtures.device("single-site--switch");
const sent = (desired: string, current: string) => vrp.plan(desired, current, options).steps.flatMap((step) => step.send);

const policies: Record<string, PolicyRule[]> = {
    labels: [
        { if: { prefix: "192.0.2.255/32" }, then: "accept" },
        { if: { prefix_set: "loopbacks" }, then: "accept" },
        { if: { prefix_length: { max: 24 } }, then: "reject" },
    ],
};

const LDP: Mpls = { ldp: { lsr_id: "192.0.2.255", interfaces: ["core"], targets: ["192.0.2.253"], export_policy: "labels" } };

/** The single-site switch with a VLAN interface toward another LDP router, and a loopback that OSPF announces. */
function routed(mpls: Mpls | undefined): Device {
    return {
        ...base,
        switching: { ...base.switching, vlans: { ...base.switching!.vlans, core: { id: 3981 } } },
        interfaces: {
            ...base.interfaces,
            vlan_interface: { ...base.interfaces!.vlan_interface, core: { vlan: "core", addresses: ["192.0.2.1/30"] } },
            loopback: { loopback: { addresses: ["192.0.2.255/32"] } },
        },
        routing: {
            ...base.routing,
            router_id: "192.0.2.255",
            prefix_sets: { loopbacks: { prefixes: ["192.0.2.240/28", "2001:db8:ffff::/48"] } },
            policies,
            ospf: { areas: { "0.0.0.0": { interfaces: { core: { cost: 10 }, loopback: { passive: true } } } } },
            mpls,
        },
    };
}

/** What the switch prints after an outbound policy. */
const TRAILING = "  ";

/** MPLS as the switch printed it: LDP's IPv4 lines after ` #`, an outbound policy with spaces after it, and the VLAN interface's MPLS after its OSPF. */
const PRINTED = `ip ip-prefix circuit-ldp-labels index 10 permit 192.0.2.255 32
ip ip-prefix circuit-ldp-labels index 20 permit 192.0.2.240 28 greater-equal 28 less-equal 32
ip ip-prefix circuit-ldp-labels index 30 deny 0.0.0.0 0 less-equal 24
#
mpls lsr-id 192.0.2.255
#
mpls
 lsp-trigger all
#
mpls ldp
 #
 ipv4-family
  outbound peer all fec ip-prefix circuit-ldp-labels${TRAILING}
#
mpls ldp remote-peer 192.0.2.253
 remote-ip 192.0.2.253
#
interface Vlanif3981
 ip address 192.0.2.1 255.255.255.252
 ospf cost 10
 mpls
 mpls ldp
#
`;

/** The render with its MPLS and its VLAN interface as the switch printed them. */
const printed = (render: string) =>
    `${render.replace(/^ip ip-prefix circuit-ldp-[\s\S]*?^mpls ldp remote-peer [\s\S]*?^#\n/m, "").replace(/^interface Vlanif3981\n[\s\S]*?^#\n/m, "")}${PRINTED}`;

test("VRP labels every route, gives labels by a prefix list, and plans nothing against how the switch prints it", () => {
    const device = routed(LDP);
    const desired = vrp.render(device);

    for (const block of PRINTED.split("#\n").filter((each) => each.startsWith("mpls")))
        expect(desired).toContain(block.replace(`${TRAILING}\n`, "\n"));
    expect(vrp.plan(desired, printed(desired), options).steps).toEqual([]);
    expect(vrp.unsupported(device)).toEqual([]);
    expect(vrp.experimental(device)).toEqual(["routing.mpls"]);
});

test("VRP turns MPLS on for the switch before its VLAN interfaces, and the list before LDP's policy names it", () => {
    expect(sent(vrp.render(routed(LDP)), vrp.render(routed(undefined)))).toEqual([
        "ip ip-prefix circuit-ldp-labels index 10 permit 192.0.2.255 32",
        "ip ip-prefix circuit-ldp-labels index 20 permit 192.0.2.240 28 greater-equal 28 less-equal 32",
        "ip ip-prefix circuit-ldp-labels index 30 deny 0.0.0.0 0 less-equal 24",
        "mpls lsr-id 192.0.2.255",
        "mpls",
        "lsp-trigger all",
        "quit",
        "mpls ldp",
        "ipv4-family",
        "outbound peer all fec ip-prefix circuit-ldp-labels",
        "quit",
        "quit",
        "mpls ldp remote-peer 192.0.2.253",
        "remote-ip 192.0.2.253",
        "quit",
        "interface Vlanif3981",
        "mpls",
        "mpls ldp",
        "quit",
    ]);
});

test("VRP moves a policy to one neighbor, a session to another target, and takes the old session away", () => {
    const changed: Mpls = {
        ldp: {
            lsr_id: "192.0.2.255",
            interfaces: ["core"],
            targets: ["192.0.2.252"],
            neighbors: { "192.0.2.2": { export_policy: "labels" } },
        },
    };

    // An outbound policy is undone without its list: with it, `Too many parameters`.
    expect(sent(vrp.render(routed(changed)), printed(vrp.render(routed(LDP))))).toEqual([
        "mpls ldp",
        "ipv4-family",
        "undo outbound peer all fec",
        "outbound peer 192.0.2.2 fec ip-prefix circuit-ldp-labels",
        "quit",
        "quit",
        "mpls ldp remote-peer 192.0.2.252",
        "remote-ip 192.0.2.252",
        "quit",
        "undo mpls ldp remote-peer 192.0.2.253",
    ]);

    // A new LSR ID is taken in place, and the switch asks before it restarts MPLS.
    const renumbered: Mpls = { ldp: { ...LDP.ldp, lsr_id: "192.0.2.254" } };
    expect(sent(vrp.render(routed(renumbered)), printed(vrp.render(routed(LDP))))).toEqual(["mpls lsr-id 192.0.2.254"]);
});

test("VRP takes MPLS off the VLAN interfaces, then the switch's sessions, LDP, MPLS, and the LSR ID, then the list", () => {
    // The switch asks before it deletes LDP and MPLS, and the apply answers yes.
    expect(sent(vrp.render(routed(undefined)), printed(vrp.render(routed(LDP))))).toEqual([
        "interface Vlanif3981",
        "undo mpls ldp",
        "undo mpls",
        "quit",
        "undo mpls ldp remote-peer 192.0.2.253",
        "undo mpls ldp",
        "undo mpls",
        "undo mpls lsr-id",
        "undo ip ip-prefix circuit-ldp-labels index 30",
        "undo ip ip-prefix circuit-ldp-labels index 20",
        "undo ip ip-prefix circuit-ldp-labels index 10",
    ]);
});

test("a policy with no rule that decides an IPv4 label gives none", () => {
    const device = routed({ ldp: { ...LDP.ldp, export_policy: "ipv6" } });
    const withPolicy = {
        ...device,
        routing: { ...device.routing, policies: { ipv6: [{ if: { family: "ipv6" }, then: "accept" }] } },
    } as Device;

    expect(vrp.render(withPolicy)).toContain("ip ip-prefix circuit-ldp-ipv6 index 10 deny 0.0.0.0 0 less-equal 32\n");
});

test("VRP refuses LDP for IPv6, a policy for the labels LDP takes, a policy for every neighbor beside one for some, and LDP on a port", () => {
    const refused = routed({
        ldp: {
            ...LDP.ldp,
            interfaces: ["core", "10g-2"],
            address_families: ["ipv4", "ipv6"],
            ipv6_transport_address: "2001:db8:ffff::255",
            import_policy: "labels",
            neighbors: { "192.0.2.2": { import_policy: "labels", export_policy: "labels" } },
        },
    });

    expect(vrp.unsupported(refused)).toEqual([
        "routing.mpls.ldp.interfaces 10g-2, neither a VLAN interface nor a routed port: the switch runs LDP on those",
        "routing.mpls.ldp.address_families ipv6, V200R005 has no LDP for IPv6: `ipv6-family` is not a command in its `mpls ldp` view, and a VLAN interface refuses `mpls ldp ipv6`",
        "routing.mpls.ldp.ipv6_transport_address, V200R005 has no LDP for IPv6: `ipv6-family` is not a command in its `mpls ldp` view, and a VLAN interface refuses `mpls ldp ipv6`",
        "routing.mpls.ldp.import_policy, V200R005 has no policy for the labels LDP takes: `inbound peer` is not a command in its `mpls ldp` view",
        "routing.mpls.ldp.neighbors.192.0.2.2.import_policy, V200R005 has no policy for the labels LDP takes: `inbound peer` is not a command in its `mpls ldp` view",
        "routing.mpls.ldp.neighbors.192.0.2.2.export_policy beside routing.mpls.ldp.export_policy: the switch takes a policy for every LDP neighbor, or for some, not both",
    ]);
});

test("VRP refuses an LDP policy's rule that a prefix list can't hold, in a policy it calls too", () => {
    const device = routed({ ldp: { ...LDP.ldp, export_policy: "wide" } });
    const refused = {
        ...device,
        routing: {
            ...device.routing,
            policies: {
                wide: [{ if: { prefix: "192.0.2.255/32", prefix_set: "loopbacks" }, then: "accept" }, { call: "fetched" }],
                fetched: [{ if: { prefix_set: "upstream-origins" }, then: "reject" }],
            },
            prefix_sets: {
                ...device.routing!.prefix_sets,
                "upstream-origins": { source: { registry: "ripe-stat", query: "AS64501", family: "ipv4" } },
            },
        },
    } as Device;

    expect(vrp.unsupported(refused)).toEqual([
        "routing.policies.fetched[0].if.prefix_set upstream-origins, from a registry, in an LDP policy: the switch writes an entry for each prefix. Write the prefixes",
        "routing.policies.wide[0].if.prefix_set, with prefix: a node matches one prefix list for each family, so write one of them",
    ]);
});

test("VRP refuses RSVP-TE, OSPF's traffic engineering, pseudowires, VPLS, and L3VPN, each with what the switch said", () => {
    const device = routed({ ...LDP, rsvp_te: { interfaces: { core: { bandwidth: "1G" } } } });
    const ospf = device.routing!.ospf!;
    const refused: Device = {
        ...device,
        routing: {
            ...device.routing,
            ospf: { ...ospf, areas: { "0.0.0.0": { ...ospf.areas["0.0.0.0"]!, traffic_engineering: true } } },
            vrfs: { customer: { route_distinguisher: "64500:1", route_targets: { import: ["64500:1"], export: ["64500:1"] } } },
        },
        interfaces: { ...device.interfaces, pseudowire: { "pw-1": { peer: "192.0.2.2", pw_id: 1, access_vlan: "home" } } },
    };

    expect(vrp.unsupported(refused)).toEqual(
        expect.arrayContaining([
            "interfaces.pseudowire.pw-1, a pseudowire: V200R005 on a CE6855 has none, as `display mpls l2vc` is not a command and a VLAN interface refuses `mpls l2vc`",
            "routing.mpls.rsvp_te, V200R005 on a CE6855 has no RSVP-TE: `mpls te` and `mpls rsvp-te` are not commands in its `mpls` view, nor `explicit-path`",
            "routing.ospf.areas.0.0.0.0.traffic_engineering, V200R005 on a CE6855 has no traffic engineering: `mpls-te enable` is not a command in an OSPF area",
            "routing.vrfs.customer.route_distinguisher, L3VPN: Huawei's guide says a CloudEngine switch can't be a PE on an MPLS network, and V200R005 asks to reset each session that starts to carry vpnv4, so it was not tried",
        ])
    );
    expect(vrp.unsupported(refused).filter((refusal) => refusal.includes("traffic_engineering"))).toHaveLength(1);
});

test("VRP refuses MPLS beside a private VLAN, a MUX VLAN there, which Huawei's guide says MPLS can't run beside", () => {
    const device = routed(LDP);
    const isolated: Device = {
        ...device,
        switching: {
            ...device.switching,
            vlans: { ...device.switching!.vlans, kiosks: { id: 3984, private_vlan: { primary: "home", type: "isolated" } } },
        },
    };

    expect(vrp.unsupported(isolated)).toContain(
        "switching.vlans.kiosks.private_vlan beside routing.mpls: Huawei's CloudEngine MPLS guide says MPLS can't be used together with a MUX VLAN, which a private VLAN is here"
    );
});
