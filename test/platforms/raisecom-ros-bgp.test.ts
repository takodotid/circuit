// BGP, route policies, and IS-IS on a RAX721 on ROS 6.5.2, as tako-mmr-01 printed them after Circuit's plans applied each (#418). The tests used VLANs with no port, and sessions to documentation addresses routed to null, so no session or adjacency came up.

import { expect, test } from "bun:test";
import type { Device, PolicyRule } from "../../src/model";
import { Platforms } from "../../src/platforms";
import { RaisecomRosBgpSessions } from "../../src/platforms/raisecom-ros/bgp-sessions";
import { Fixtures } from "../fixtures";

const platform = Platforms.get("raisecom-ros");
const core = Fixtures.device("platforms--example-core-switch");
const options = { secrets: false, rollback: 0 };
const plan = (desired: string, current: string) => platform.plan(desired, current, options);
const sent = (desired: string, current: string) => plan(desired, current).steps.flatMap((step) => step.send);
const secret = (name: string) => ({ secret: name });

/** The core switch with two test VLANs, their VLAN interfaces, and a route to null for the test neighbors, and `routing` added. */
function device(routing: Record<string, unknown> = {}): Device {
    return {
        ...core,
        switching: { ...core.switching, vlans: { ...core.switching?.vlans, ctest: { id: 3990 }, "ctest-isis": { id: 3991 } } },
        interfaces: {
            ...core.interfaces,
            vlan_interface: {
                ...core.interfaces?.vlan_interface,
                ctest: { vlan: "ctest", addresses: ["198.51.100.1/24"] },
                "ctest-isis": { vlan: "ctest-isis", addresses: ["203.0.113.1/30"] },
            },
        },
        routing: { static_routes: [{ prefix: "192.0.2.0/24", blackhole: true }], ...routing },
    } as Device;
}

const POLICIES: Record<string, PolicyRule[]> = {
    "ctest-import": [
        { description: "bogon ASes", if: { as_path_contains: [0, { min: 64496, max: 64511 }] }, then: "reject" },
        { if: { prefix_length: { min: 25 } }, then: "reject" },
        { if: { prefix: "0.0.0.0/0" }, then: "reject" },
        { if: { standard_community: ["64500:100", "65535:65281"] }, set: { local_pref: 200 }, then: "accept" },
        { if: { first_as: 64496 }, set: { local_pref: 150, med: 10, next_hop: "192.0.2.9" }, then: "accept" },
        { if: { origin_as: 64497, prefix_set: "ctest-customers" }, set: { add_standard_communities: ["64500:300"] }, then: "accept" },
        { then: "reject" },
    ],
    "ctest-export": [
        {
            if: { prefix_set: "ctest-customers" },
            set: { prepend: 2, add_standard_communities: ["64500:300"], remove_standard_communities: ["64500:100", "64500:200"] },
            then: "accept",
        },
        { call: "ctest-short" },
        { if: { prefix: "192.0.2.128/25" }, set: { standard_communities: [] }, then: "accept" },
        { then: "reject" },
    ],
    "ctest-short": [{ if: { prefix_length: { max: 8 } }, set: { standard_communities: ["64500:1"] }, then: "accept" }],
    "ctest-leak": [{ if: { prefix_set: "ctest-customers" }, then: "accept" }, { then: "reject" }],
};

/** Every BGP, policy, and IS-IS setting Raisecom ROS writes. */
const routed = device({
    router_id: "198.51.100.1",
    prefix_sets: { "ctest-customers": { prefixes: ["192.0.2.128/25", "203.0.113.0/24", "0.0.0.0/0", "2001:db8::/32"] } },
    policies: POLICIES,
    isis: {
        net: "49.0001.1980.5110.0001.00",
        level_capability: "level-1-2",
        address_families: ["ipv4"],
        overload_bit: true,
        authentication: { algorithm: "hmac-md5", key: secret("CTEST_ISIS_KEY") },
        interfaces: { "ctest-isis": { metric: 20, passive: true, network: "point-to-point", bfd: true } },
        level2_to_level1: { import_policy: "ctest-leak" },
    },
    bgp: {
        asn: 64500,
        cluster_id: "198.51.100.1",
        originated_prefixes: ["192.0.2.128/25"],
        aggregates: [{ prefix: "192.0.2.0/24", summary_only: true }],
        neighbors: {
            "ctest-transit": {
                address: "192.0.2.2",
                remote_as: 64496,
                description: "ctest transit",
                import_policy: "ctest-import",
                export_policy: "ctest-export",
                multihop: true,
                local_address: "198.51.100.1",
                password: secret("CTEST_BGP_KEY"),
                hold_time: 30,
                keepalive: 10,
                send_default_route: true,
            },
            "ctest-client": {
                address: "192.0.2.3",
                remote_as: 64500,
                route_reflector_client: true,
                local_address: "198.51.100.1",
                bfd: true,
            },
        },
    },
});

// Tested on tako-mmr-01, 2026-11-27: what the switch printed of `routed`, after the plan from nothing applied it.
const PRINTED = `ip prefix-list ctest-customers seq 10 permit 192.0.2.128/25 le 32
ip prefix-list ctest-customers seq 20 permit 203.0.113.0/24 le 32
ip prefix-list ctest-customers seq 30 permit any
ip prefix-list len-0-8 seq 10 permit default
ip prefix-list len-0-8 seq 20 permit 0.0.0.0/1 le 8
ip prefix-list len-0-8 seq 30 permit 128.0.0.0/1 le 8
ip prefix-list len-25-32 seq 10 permit 0.0.0.0/1 ge 25
ip prefix-list len-25-32 seq 20 permit 128.0.0.0/1 ge 25
ip prefix-list p-0.0.0.0-0 seq 10 permit default
ip prefix-list p-192.0.2.128-25 seq 10 permit 192.0.2.128/25
interface vlan 3991
ip router isis 1
isis passive
isis network point-to-point
isis metric 20
isis password md5 <redacted>
isis bfd enable
!
route-map circuit-reject-all deny 10
route-map ctest-export permit 10
 match ip address prefix-list ctest-customers
 set as-path prepend 64500 64500
 set comm-list del-ctest-export-10  delete
 set community 64500:300   additive
route-map ctest-export permit 20
 match ip address prefix-list len-0-8
 set community 64500:1
route-map ctest-export permit 30
 match ip address prefix-list p-192.0.2.128-25
 set community none
route-map ctest-export deny 40
route-map ctest-import deny 10
 description bogon ASes
 match as-path 1
route-map ctest-import deny 20
 match ip address prefix-list len-25-32
route-map ctest-import deny 30
 match ip address prefix-list p-0.0.0.0-0
route-map ctest-import permit 40
 match community circuit-64500-100 circuit-65535-65281
 set local-preference 200
route-map ctest-import permit 50
 match as-path 2
 set metric 10
 set ip next-hop 192.0.2.9
 set local-preference 150
route-map ctest-import permit 60
 match as-path 3
 match ip address prefix-list ctest-customers
 set community 64500:300   additive
route-map ctest-import deny 70
route-map ctest-leak permit 10
 match ip address prefix-list ctest-customers
route-map ctest-leak deny 20
!
router isis 1
  net 49.0001.1980.5110.0001.00
  metric-style wide
  set-overload-bit
  area-password md5 <redacted>
  domain-password md5 <redacted>
  redistribute isis ip level-2 into level-1 route-map ctest-leak
!
router bgp 64500
 bgp router-id 198.51.100.1
 bgp cluster-id 198.51.100.1
 network 192.0.2.128 255.255.255.128
 aggregate-address 192.0.2.0 255.255.255.0 summary-only
 neighbor 192.0.2.2 remote-as 64496
 neighbor 192.0.2.2 description ctest transit
 neighbor 192.0.2.2 password <redacted>
 neighbor 192.0.2.2 ebgp-multihop 255
 neighbor 192.0.2.2 update-source 198.51.100.1
 neighbor 192.0.2.2 timers 10 30
 neighbor 192.0.2.2 send-community standard
 neighbor 192.0.2.2 default-originate
 neighbor 192.0.2.2 route-map ctest-import in
 neighbor 192.0.2.2 route-map ctest-export out
 neighbor 192.0.2.3 remote-as 64500
 neighbor 192.0.2.3 update-source 198.51.100.1
 neighbor 192.0.2.3 fall-over bfd
 neighbor 192.0.2.3 route-reflector-client
 neighbor 192.0.2.3 send-community standard
 neighbor 192.0.2.3 route-map circuit-reject-all in
 neighbor 192.0.2.3 route-map circuit-reject-all out
 address-family ipv6
 exit-address-family
 address-family vpnv4
 policy vpn-target
 exit-address-family
 address-family vpnv6
 policy vpn-target
 exit-address-family
 address-family l2vpn evpn
 policy vpn-target
 exit-address-family
!
ip as-path access-list 1 permit _0_
ip as-path access-list 1 permit _6449[6-9]_
ip as-path access-list 1 permit _6450[0-9]_
ip as-path access-list 1 permit _6451[0-1]_
ip as-path access-list 2 permit ^64496_
ip as-path access-list 3 permit _64497$
ip community-list standard circuit-64500-100 permit 64500:100
ip community-list standard circuit-65535-65281 permit 65535:65281
ip community-list standard del-ctest-export-10 permit 64500:100
ip community-list standard del-ctest-export-10 permit 64500:200
`;

/** What the switch prints for the test VLANs and the route to null alone, as the core switch renders them, the route in capitals. */
const unrouted = platform.render(device()).replace("ip route 192.0.2.0 255.255.255.0 null 0", "ip route 192.0.2.0 255.255.255.0 NULL 0 ");

test("BGP, route policies, and IS-IS render as the switch printed them", () => {
    expect(platform.unsupported(routed)).toEqual([]);
    expect(sent(platform.render(routed), `${unrouted}${PRINTED}`)).toEqual([]);
});

test("the plan from nothing writes the lists, then the route-maps, then the interfaces, IS-IS, and BGP", () => {
    const steps = plan(platform.render(routed), unrouted).steps.map((step) => step.title);

    expect(steps[0]).toBe("(top level)");
    expect(steps.indexOf("route-map ctest-import deny 10")).toBeLessThan(steps.indexOf("interface vlan 3991"));
    expect(steps.indexOf("interface vlan 3991")).toBeLessThan(steps.indexOf("router isis 1"));
    expect(steps.indexOf("router isis 1")).toBeLessThan(steps.indexOf("router bgp 64500"));
});

test("only what the switch prints is compared: the keys it prints in clear are hidden", () => {
    const answer = "router bgp 64500\n neighbor 192.0.2.2 password s3cret\nrouter isis 1\n  area-password md5 k3y\n";
    expect(platform.scrubOutput!(answer)).toBe(
        "router bgp 64500\n neighbor 192.0.2.2 password <redacted>\nrouter isis 1\n  area-password md5 <redacted>\n"
    );
});

/** `routed` changed: a prefix replaced, a rule gone and one that rejects now, other communities, a new AS for a session, IS-IS on level 2 alone. */
const changed = device({
    router_id: "198.51.100.1",
    prefix_sets: { "ctest-customers": { prefixes: ["192.0.2.128/25", "198.51.100.0/24", "0.0.0.0/0", "2001:db8::/32"] } },
    policies: {
        "ctest-import": [
            { description: "bogon ASes again", if: { as_path_contains: [0, { min: 64496, max: 64511 }] }, then: "reject" },
            { if: { prefix: "0.0.0.0/0" }, then: "reject" },
            { if: { standard_community: ["64500:110"] }, set: { local_pref: 210 }, then: "accept" },
            { if: { first_as: 64496 }, then: "reject" },
            { if: { origin_as: 64497, prefix_set: "ctest-customers" }, set: { add_standard_communities: ["64500:300"] }, then: "accept" },
            { then: "reject" },
        ],
        "ctest-export": [
            {
                if: { prefix_set: "ctest-customers" },
                set: { prepend: 3, add_standard_communities: ["64500:301"], remove_standard_communities: ["64500:100"] },
                then: "accept",
            },
            { then: "reject" },
        ],
    },
    isis: {
        net: "49.0001.1980.5110.0001.00",
        level_capability: "level-2",
        address_families: ["ipv4"],
        authentication: { algorithm: "hmac-md5", key: secret("CTEST_ISIS_KEY") },
        interfaces: { "ctest-isis": { metric: 30, network: "point-to-point" } },
    },
    bgp: {
        asn: 64500,
        originated_prefixes: ["192.0.2.128/25", "192.0.2.64/26"],
        aggregates: [{ prefix: "192.0.2.0/24" }],
        neighbors: {
            "ctest-transit": {
                address: "192.0.2.2",
                remote_as: 64497,
                description: "ctest transit renamed",
                import_policy: "ctest-import",
                export_policy: "ctest-export",
                multihop: true,
                local_address: "198.51.100.1",
                password: secret("CTEST_BGP_KEY"),
                hold_time: 60,
                keepalive: 20,
            },
            "ctest-client": { address: "192.0.2.3", remote_as: 64500, local_address: "198.51.100.1" },
        },
    },
});

test("a change is sent as the switch took it: a new AS renews the session, and what goes goes after what uses it", () => {
    const steps = sent(platform.render(changed), `${unrouted}${PRINTED}`);

    // The switch refuses a new AS for a session it has, `The neighbor already exists in AS 64496`.
    const renewed = steps.indexOf("no neighbor 192.0.2.2");
    expect(renewed).toBeGreaterThan(-1);
    expect(steps.slice(renewed + 1, renewed + 4)).toEqual([
        "no bgp cluster-id",
        "network 192.0.2.64 255.255.255.192",
        "aggregate-address 192.0.2.0 255.255.255.0",
    ]);
    expect(steps).toContain("neighbor 192.0.2.2 password <secret:CTEST_BGP_KEY>");

    // `no isis bfd enable` is refused at `enable`, and `no isis bfd` is incomplete.
    expect(steps).toContain("isis bfd disable");
    expect(steps).toContain("no redistribute isis ip level-2 into level-1");
    expect(steps).toContain("is-type level-2-only");

    // A route-map entry that changes from permit to deny goes first; one that is gone, after the sessions let go of it.
    expect(steps.indexOf("no route-map ctest-export permit 20")).toBeLessThan(steps.indexOf("route-map ctest-export deny 20"));
    expect(steps.slice(-8)).toEqual([
        "no route-map ctest-leak deny 20",
        "no route-map ctest-leak permit 10",
        "no route-map ctest-export permit 30",
        "no ip community-list standard circuit-65535-65281",
        "no ip community-list standard circuit-64500-100",
        "no ip prefix-list p-192.0.2.128-25",
        "no ip prefix-list len-25-32",
        "no ip prefix-list len-0-8",
    ]);
});

test("IS-IS goes once its interfaces let go of it, and BGP before its route-maps and lists", () => {
    const withoutIsis = sent(
        platform.render({ ...changed, routing: { ...changed.routing, isis: undefined } } as Device),
        platform.render(changed)
    );
    expect(withoutIsis).toEqual([
        "interface vlan 3991",
        "no isis password",
        "no isis metric",
        "no isis network point-to-point",
        "no ip router isis 1",
        "exit",
        "no router isis 1",
    ]);

    const withoutBgp = sent(
        platform.render(device()),
        platform.render({ ...changed, routing: { ...changed.routing, isis: undefined } } as Device)
    );
    expect(withoutBgp[0]).toBe("no router bgp 64500");
    expect(withoutBgp.at(-1)).toBe("no ip prefix-list ctest-customers");
});

// Tested on tako-mmr-01, 2026-11-27: `show ip bgp summary` with the two sessions of `routed`, which never came up.
const SUMMARY = `BGP router identifier 198.51.100.1, local AS number 64500
Peers 2, using 34 KiB of memory

Neighbor                                  V         AS MsgRcvd MsgSent  InQ OutQ Up/Down  State/PfxRcd
 192.0.2.2                                4      64496       0       0    0    0 never    Idle
 192.0.2.3                                4      64500       0       0    0    0 never    Idle
`;

test("circuit bgp reads each session's state from the summary", async () => {
    const answers = {
        "show ip bgp summary": SUMMARY.replace(
            "192.0.2.3                                4      64500       0       0    0    0 never    Idle",
            "192.0.2.3                                4      64500      15      12    0    0 00:05:12        3"
        ),
    };
    const session = { run: async (command: string) => answers[command as keyof typeof answers] ?? "", close: () => {} };

    expect(await RaisecomRosBgpSessions.read(routed, session)).toEqual([
        { neighbor: "ctest-transit", remote: "192.0.2.2", established: false, prefixes: "-", uptime: "-", reason: "Idle" },
        { neighbor: "ctest-client", remote: "192.0.2.3", established: true, prefixes: "3", uptime: "00:05:12" },
    ]);
    expect(RaisecomRosBgpSessions.rows("No BGP process is configured\n")).toEqual([]);
    expect(RaisecomRosBgpSessions.rows(SUMMARY.replace(/never {4}Idle/, "never    Idle (Admin)"))[0]?.state).toBe("Idle (Admin)");
});

test("what the switch has no setting for, or refuses, is refused with why", () => {
    const refused = (routing: Record<string, unknown>) => platform.unsupported(device({ router_id: "198.51.100.1", ...routing }));
    const bgp = (neighbor: Record<string, unknown>) => ({
        asn: 64500,
        neighbors: { "ctest-transit": { address: "192.0.2.2", remote_as: 64496, ...neighbor } },
    });

    expect(refused({ bgp: bgp({ graceful_restart: true, max_prefixes: 100, passive: true }) })).toEqual([
        "routing.bgp.neighbors.ctest-transit.passive, ROS 6.5.2 has none",
        "routing.bgp.neighbors.ctest-transit.max_prefixes, ROS 6.5.2 has none",
        "routing.bgp.neighbors.ctest-transit.graceful_restart, ROS 6.5.2 sets only graceful restart's timers, and no line turns it on",
    ]);
    expect(refused({ bgp: bgp({ keepalive: 30000, hold_time: 90000 }) })).toEqual([
        "routing.bgp.neighbors.ctest-transit.keepalive 30000, the switch takes 0 to 21845",
        "routing.bgp.neighbors.ctest-transit.hold_time 90000, the switch takes 0 to 65535",
    ]);

    // The switch takes a route-map's name and a prefix list's of 20 characters at most.
    const long = "ctest-import-from-transit";
    expect(refused({ policies: { [long]: [{ then: "reject" }] }, bgp: bgp({ import_policy: long }) })).toEqual([
        `routing.policies.${long}, a name the switch refuses: a route-map's takes 20 characters`,
    ]);
    expect(
        refused({
            policies: { "ctest-import": [{ if: { family: "ipv6", large_community: "64500:1:1" }, set: { local_pref: 1 } }] },
            bgp: bgp({ import_policy: "ctest-import" }),
        })
    ).toEqual([
        "routing.policies.ctest-import[0], a rule without then: a route-map here has no continue, so a route ends at the first entry it matches. Give the rule then: accept or reject",
        "routing.policies.ctest-import[0].if.family ipv6, BGP carries IPv4 here",
        "routing.policies.ctest-import[0].if.large_community, ROS 6.5.2 has no large communities",
    ]);

    expect(
        refused({
            isis: {
                net: "49.0001.1980.5110.0001.00",
                level_capability: "level-2",
                address_families: ["ipv4", "ipv6"],
                interfaces: { "ctest-isis": {} },
            },
        })
    ).toEqual([
        "routing.isis.address_families ipv6, IS-IS runs for IPv4 here",
        "routing.router_id without routing.ospf or routing.bgp, only they use it here",
    ]);
});

test("a prefix set from a registry not fetched keeps what the device holds, and a blackhole route goes to null", () => {
    const fromRegistry = device({
        router_id: "198.51.100.1",
        prefix_sets: { "ctest-customers": { source: { registry: "ripe-stat", query: "AS64500", family: "ipv4" } } },
        policies: { "ctest-import": [{ if: { prefix_set: "ctest-customers" }, then: "accept" }] },
        bgp: { asn: 64500, neighbors: { "ctest-transit": { address: "192.0.2.2", remote_as: 64496, import_policy: "ctest-import" } } },
    });
    const rendered = platform.render(fromRegistry);
    const held = "ip prefix-list ctest-customers seq 10 permit 192.0.2.128/25 le 32\n";

    expect(sent(rendered, `${rendered}${held}`)).toEqual([]);
    expect(rendered).toContain("ip route 192.0.2.0 255.255.255.0 null 0\n");
    expect(sent(platform.render({ ...fromRegistry, routing: undefined } as Device), unrouted)).toContain(
        "no ip route 192.0.2.0 255.255.255.0 null 0"
    );
});
