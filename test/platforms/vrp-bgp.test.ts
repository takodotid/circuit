// Tested on a CE6855 on V200R005C00SPC800, with sessions to documentation addresses that never came up. Each plan was committed with `commit trial`, and the plan after it was empty: `routed` from nothing, a change to it, and its removal. `PRINTED` is what the switch printed for `routed`, with the names of this file.

import { expect, test } from "bun:test";
import type { Device, NeighborSettings, PolicyRule } from "../../src/model";
import { Vrp } from "../../src/platforms/vrp/index";
import { Fixtures } from "../fixtures";

const vrp = new Vrp();
const options = { secrets: false, rollback: 10 };
const base = Fixtures.device("single-site--switch");
const plan = (desired: string, current: string) => vrp.plan(desired, current, options);
const sent = (desired: string, current: string) => plan(desired, current).steps.flatMap((step) => step.send);

const policies: Record<string, PolicyRule[]> = {
    "transit-import": [
        { description: "Odd lengths", if: { prefix_set: "odd-lengths" }, then: "reject" },
        { if: { prefix_length: { min: 25 } }, then: "reject" },
        { if: { prefix_length: { max: 7 } }, then: "reject" },
        { if: { as_path_contains: [0, 23456, { min: 64496, max: 64511 }] }, then: "reject" },
        { call: "default-route" },
        { if: { standard_community: ["64500:100", "65535:65281", "65535:666"] }, set: { local_pref: 200 }, then: "accept" },
        { if: { first_as: 64501, family: "ipv4" }, set: { local_pref: 150, med: 10, next_hop: "198.51.100.9" }, then: "accept" },
        { if: { family: "ipv6" }, set: { next_hop: "2001:db8::9" }, then: "accept" },
        {
            description: "AS64501's block",
            if: { prefix: "198.51.100.128/26", origin_as: [64501, { min: 64502, max: 64505 }] },
            set: { add_standard_communities: ["64500:300"] },
            then: "accept",
        },
        { then: "reject" },
    ],
    "default-route": [{ if: { prefix: "0.0.0.0/0" }, then: "reject" }],
    "transit-export": [
        {
            if: { prefix_set: "customers" },
            set: { prepend: 2, add_standard_communities: ["64500:300"], remove_standard_communities: ["64500:100", "64500:200"] },
            then: "accept",
        },
        { if: { origin_as: 64502 }, set: { standard_communities: ["64500:1"] }, then: "accept" },
        { if: { prefix: "2001:db8:200::/48" }, set: { standard_communities: [] }, then: "accept" },
        { then: "reject" },
    ],
};

const transit: NeighborSettings = { remote_as: 64501, import_policy: "transit-import", export_policy: "transit-export", passive: true };

/** Every BGP setting VRP writes, on the switch of the single-site example, whose VLAN interface holds 192.168.10.2. */
function routed(neighbors: Record<string, unknown> = {}, more: Partial<Record<string, PolicyRule[]>> = {}): Device {
    return {
        ...base,
        routing: {
            ...base.routing,
            router_id: "192.0.2.1",
            prefix_sets: {
                customers: { prefixes: ["198.51.100.0/24", "203.0.113.0/24", "2001:db8:100::/48"] },
                // How the switch prints a /8, a /32, and a /0.
                "odd-lengths": { prefixes: ["0.0.0.0/8", "192.0.2.1/32", "0.0.0.0/0"] },
            },
            policies: { ...policies, ...more },
            bgp: {
                asn: 64500,
                cluster_id: "192.0.2.1",
                originated_prefixes: ["198.51.100.0/24", "2001:db8:100::/48"],
                neighbor_groups: { transit },
                neighbors: {
                    as64501: {
                        address: "198.51.100.1",
                        neighbor_group: "transit",
                        description: "AS64501 transit",
                        multihop: true,
                        local_address: "192.168.10.2",
                        password: { secret: "AS64501_BGP_KEY" },
                        hold_time: 90,
                        keepalive: 30,
                        max_prefixes: 1000,
                    },
                    "hall-3": {
                        address: "203.0.113.1",
                        remote_as: 64500,
                        passive: true,
                        route_reflector_client: true,
                        max_prefixes: { limit: 500, restart_after: 300 },
                    },
                    "as64501-v6": { address: "2001:db8::1", neighbor_group: "transit", multihop: true },
                    ...neighbors,
                },
            },
        },
    } as Device;
}

const without = vrp.render(base);

/** What the switch printed for `routed()`: its BGP view, its route-policies, then its lists and filters. A key prints as a cipher, which the read redacts. */
const PRINTED = `bgp 64500
 router-id 192.0.2.1
 peer 198.51.100.1 as-number 64501
 peer 198.51.100.1 description AS64501 transit
 peer 198.51.100.1 ebgp-max-hop 255
 peer 198.51.100.1 timer keepalive 30 hold 90
 peer 198.51.100.1 connect-interface Vlanif10 192.168.10.2
 peer 198.51.100.1 listen-only
 peer 198.51.100.1 password cipher <redacted>
 peer 203.0.113.1 as-number 64500
 peer 203.0.113.1 listen-only
 peer 2001:DB8::1 as-number 64501
 peer 2001:DB8::1 ebgp-max-hop 255
 peer 2001:DB8::1 listen-only
 #
 ipv4-family unicast
  reflector cluster-id 192.0.2.1
  network 198.51.100.0 255.255.255.0
  peer 198.51.100.1 enable
  peer 198.51.100.1 route-policy transit-import import
  peer 198.51.100.1 route-policy transit-export export
  peer 198.51.100.1 route-limit 1000 idle-forever
  peer 198.51.100.1 advertise-community
  peer 203.0.113.1 enable
  peer 203.0.113.1 route-policy circuit-reject-all import
  peer 203.0.113.1 route-policy circuit-reject-all export
  peer 203.0.113.1 route-limit 500 idle-timeout 5
  peer 203.0.113.1 reflect-client
  peer 203.0.113.1 advertise-community
 #
 ipv6-family unicast
  reflector cluster-id 192.0.2.1
  network 2001:DB8:100:: 48
  peer 2001:DB8::1 enable
  peer 2001:DB8::1 route-policy transit-import import
  peer 2001:DB8::1 route-policy transit-export export
  peer 2001:DB8::1 advertise-community
#
route-policy circuit-reject-all deny node 10
#
route-policy transit-import deny node 10
 description Odd lengths
 if-match ip-prefix odd-lengths
 if-match ipv6 address prefix-list circuit-no-ipv6
#
route-policy transit-import deny node 20
 if-match ip-prefix circuit-length-25-32
 if-match ipv6 address prefix-list circuit-length-25-128
#
route-policy transit-import deny node 30
 if-match ip-prefix circuit-length-0-7
 if-match ipv6 address prefix-list circuit-length-0-7
#
route-policy transit-import deny node 40
 if-match as-path-filter circuit-path-transit-import-40
#
route-policy transit-import deny node 50
 if-match ip-prefix circuit-prefix-0.0.0.0-0
 if-match ipv6 address prefix-list circuit-no-ipv6
#
route-policy transit-import permit node 60
 if-match community-filter circuit-64500-100 
 if-match community-filter circuit-65535-65281 
 if-match community-filter circuit-65535-666 
 apply local-preference 200
#
route-policy transit-import permit node 70
 if-match ipv6 address prefix-list circuit-no-ipv6
 if-match as-path-filter circuit-path-transit-import-70
 apply ip-address next-hop 198.51.100.9
 apply local-preference 150
 apply cost 10
#
route-policy transit-import permit node 80
 if-match ip-prefix circuit-no-ipv4
 apply ipv6 next-hop 2001:DB8::9
#
route-policy transit-import permit node 90
 description AS64501's block
 if-match ip-prefix circuit-prefix-198.51.100.128-26
 if-match ipv6 address prefix-list circuit-no-ipv6
 if-match as-path-filter circuit-path-transit-import-90
 apply community 64500:300 additive
#
route-policy transit-import deny node 100
#
route-policy transit-export permit node 10
 if-match ip-prefix customers
 if-match ipv6 address prefix-list customers
 apply as-path 64500 64500 additive
 apply comm-filter circuit-remove-transit-export-10 delete
 apply community 64500:300 additive
#
route-policy transit-export permit node 20
 if-match as-path-filter circuit-path-transit-export-20
 apply community 64500:1
#
route-policy transit-export permit node 30
 if-match ip-prefix circuit-no-ipv4
 if-match ipv6 address prefix-list circuit-prefix-2001-db8-200---48
 apply community none
#
route-policy transit-export deny node 40
#
ip ip-prefix circuit-length-0-7 index 10 permit 0.0.0.0 0 less-equal 7
ip ip-prefix circuit-length-25-32 index 10 permit 0.0.0.0 0 greater-equal 25 less-equal 32
ip ip-prefix circuit-no-ipv4 index 10 deny 0.0.0.0 0 less-equal 32
ip ip-prefix circuit-prefix-0.0.0.0-0 index 10 permit 0.0.0.0 0
ip ip-prefix circuit-prefix-198.51.100.128-26 index 10 permit 198.51.100.128 26
ip ip-prefix odd-lengths index 10 permit 0.0.0.0 8 greater-equal 8 less-equal 32
ip ip-prefix odd-lengths index 20 permit 192.0.2.1 32
ip ip-prefix odd-lengths index 30 permit 0.0.0.0 0 less-equal 32
ip ip-prefix customers index 10 permit 198.51.100.0 24 greater-equal 24 less-equal 32
ip ip-prefix customers index 20 permit 203.0.113.0 24 greater-equal 24 less-equal 32
ip as-path-filter circuit-path-transit-import-40 index 10 permit _0_
ip as-path-filter circuit-path-transit-import-40 index 20 permit _23456_
ip as-path-filter circuit-path-transit-import-40 index 30 permit _6449[6-9]_
ip as-path-filter circuit-path-transit-import-40 index 40 permit _6450[0-9]_
ip as-path-filter circuit-path-transit-import-40 index 50 permit _6451[0-1]_
ip as-path-filter circuit-path-transit-import-70 index 10 permit ^64501_
ip as-path-filter circuit-path-transit-import-90 index 10 permit _64501$
ip as-path-filter circuit-path-transit-import-90 index 20 permit _6450[2-5]$
ip as-path-filter circuit-path-transit-export-20 index 10 permit _64502$
ip community-filter basic circuit-64500-100 index 10 permit 64500:100
ip community-filter basic circuit-65535-65281 index 10 permit no-export
ip community-filter basic circuit-65535-666 index 10 permit 65535:666
ip community-filter basic circuit-remove-transit-export-10 index 10 permit 64500:100
ip community-filter basic circuit-remove-transit-export-10 index 20 permit 64500:200
ip ipv6-prefix circuit-length-0-7 index 10 permit :: 0 less-equal 7
ip ipv6-prefix circuit-length-25-128 index 10 permit :: 0 greater-equal 25 less-equal 128
ip ipv6-prefix circuit-no-ipv6 index 10 deny :: 0 less-equal 128
ip ipv6-prefix circuit-prefix-2001-db8-200---48 index 10 permit 2001:DB8:200:: 48
ip ipv6-prefix customers index 10 permit 2001:DB8:100:: 48 greater-equal 48 less-equal 128
#`;

/** The switch's own configuration with `PRINTED` after it. */
const printed = `${without}${PRINTED}\n`;

test("BGP, route-policies, and their lists render as the switch printed them", () => {
    expect(vrp.unsupported(routed())).toEqual([]);
    expect(vrp.experimental(routed())).toEqual([]);
    expect(plan(vrp.render(routed()), printed)).toEqual({ steps: [], problems: [] });
});

test("lists and filters go first, then the route-policies that match on them, then BGP", () => {
    const titles = plan(vrp.render(routed()), without).steps.map((step) => step.title);

    expect(titles[0]).toBe("(top level)");
    const policy = titles.findIndex((title) => title.startsWith("route-policy "));
    const bgp = titles.findIndex((title) => title.startsWith("bgp "));
    expect(policy).toBeGreaterThan(0);
    expect(bgp).toBeGreaterThan(titles.findLastIndex((title) => title.startsWith("route-policy ")));
    expect(sent(vrp.render(routed()), without)).toContain("peer 2001:DB8::1 enable");
});

test("removing BGP removes the process, then the route-policies, then the lists and filters", () => {
    const steps = plan(without, printed).steps;
    const last = steps.at(-1)!;

    expect(steps[0]!.send).toEqual(["undo bgp 64500"]);
    expect(last.title).toBe("Route policies and lists no longer used");
    expect(last.send.indexOf("undo route-policy transit-import node 10")).toBeLessThan(
        last.send.indexOf("undo ip ip-prefix odd-lengths index 10")
    );
    expect(last.send).toContain("undo ip community-filter basic circuit-65535-65281 index 10");
    expect(last.send).toContain("undo ip as-path-filter circuit-path-transit-import-40 index 50");
});

test("a peer whose AS changes is removed and written whole again, as the switch refuses a new AS", () => {
    const moved = routed({ as64501: { ...routed().routing!.bgp!.neighbors!.as64501!, remote_as: 64502 } });
    const lines = sent(vrp.render(moved), printed);

    expect(lines.indexOf("undo peer 198.51.100.1")).toBeLessThan(lines.indexOf("peer 198.51.100.1 as-number 64502"));
    expect(lines.indexOf("peer 198.51.100.1 as-number 64502")).toBeLessThan(lines.indexOf("peer 198.51.100.1 description AS64501 transit"));
    expect(lines).toContain("peer 198.51.100.1 route-policy transit-import import");
    expect(lines.filter((line) => line.startsWith("undo peer 198.51.100.1 "))).toEqual([]);
});

test("a peer that goes takes its every line with it, and a policy no peer uses goes last", () => {
    const steps = plan(vrp.render(routed({ "hall-3": undefined })), printed).steps;
    const lines = steps.flatMap((step) => step.send);

    expect(lines).toContain("undo peer 203.0.113.1");
    expect(lines.filter((line) => line.includes(" 203.0.113.1 ") && line !== "undo peer 203.0.113.1")).toEqual([]);
    // No client is left to reflect to.
    expect(lines).toContain("undo reflector cluster-id");
    expect(steps.at(-1)!.send).toEqual(["undo route-policy circuit-reject-all node 10"]);
});

test("a rule that goes renumbers the nodes after it, and what no node holds goes last", () => {
    const shorter = routed({}, { "transit-import": policies["transit-import"]!.slice(1) });
    const steps = plan(vrp.render(shorter), printed).steps;
    const lines = steps.flatMap((step) => step.send);

    // Node 90 changes from permit to deny, so it is removed first and written again.
    expect(lines.indexOf("undo route-policy transit-import node 90")).toBeLessThan(
        lines.indexOf("route-policy transit-import deny node 90")
    );
    expect(steps.at(-1)!.send).toContain("undo route-policy transit-import node 100");
    expect(steps.at(-1)!.send).toContain("undo ip as-path-filter circuit-path-transit-import-40 index 10");
    expect(lines).toContain("undo if-match community-filter circuit-64500-100");
});

test("a prefix set from a registry that is not fetched keeps what the switch holds", () => {
    const device = routed();
    const sets = { ...device.routing!.prefix_sets!, customers: { source: { registry: "ripe-stat", query: "AS64501", family: "ipv4" } } };
    const unfetched = { ...device, routing: { ...device.routing, prefix_sets: sets } } as Device;
    const lines = sent(vrp.render(unfetched), printed);

    expect(vrp.render(unfetched)).toContain("!Fetched by circuit diff and apply: ip ip-prefix customers\n");
    expect(lines.filter((line) => line.startsWith("undo ip ip-prefix customers"))).toEqual([]);
});

test("what a route-policy on V200R005 can't do is refused, with why", () => {
    const refused = routed(
        {
            as64501: {
                ...routed().routing!.bgp!.neighbors!.as64501!,
                max_prefixes: { limit: 10, warn_only: true },
                keepalive: undefined,
                bfd: true,
            },
        },
        {
            "transit-import": [
                { if: { prefix: "192.0.2.0/24" }, set: { local_pref: 50 } },
                { if: { as_path_length: { max: 10 } }, then: "reject" },
                { if: { first_as: 64501, origin_as: 64502 }, then: "accept" },
                { if: { large_community: "64500:1:1" }, then: "reject" },
                { if: { standard_community: "64500:*" }, then: "reject" },
                { if: { prefix_set: "customers", prefix_length: { max: 24 } }, then: "accept" },
                { set: { next_hop: "198.51.100.9" }, then: "accept" },
            ],
        }
    );

    expect(vrp.unsupported(refused)).toEqual([
        "routing.bgp.neighbors.as64501.bfd, not built yet",
        "routing.bgp.neighbors.as64501.max_prefixes.warn_only, the platform's alert-only also refuses every route past the limit",
        "routing.bgp.neighbors.as64501.hold_time, without keepalive: the platform sets both together, so write both",
        "routing.policies.transit-import[0], a rule without then: V200R005 has no goto next-node, so a route ends at the first node it matches. Give the rule then: accept or reject",
        "routing.policies.transit-import[1].if.as_path_length, V200R005 has no if-match as-path length",
        "routing.policies.transit-import[2].if.origin_as, with first_as: a node matches one AS path filter, so match each in a rule of its own",
        "routing.policies.transit-import[3].if.large_community, V200R005 has no large communities",
        "routing.policies.transit-import[4].if.standard_community, with *: exact communities only, not built yet",
        "routing.policies.transit-import[5].if.prefix_length, with prefix_set: a node matches one prefix list for each family, so write one of them",
        "routing.policies.transit-import[6].set.next_hop, the rule also matches ipv6 routes: match family ipv4 too",
        "routing.bgp.neighbors.as64501.bfd, BFD on a multihop session is not tested on a device yet",
    ]);
});

test("a session from an IPv6 address of the switch is not tested yet", () => {
    const device = routed({
        "as64501-v6": { address: "2001:db8::1", neighbor_group: "transit", multihop: true, local_address: "2001:db8:10::2" },
    });
    const v6 = {
        ...device,
        interfaces: {
            ...device.interfaces,
            vlan_interface: { mgmt: { vlan: "mgmt", addresses: ["192.168.10.2/24", "2001:db8:10::2/64"] } },
        },
    } as Device;

    expect(vrp.unsupported(v6)).toEqual([]);
    expect(vrp.experimental(v6)).toEqual(["routing.bgp.neighbors.as64501-v6.local_address"]);
    expect(vrp.render(v6)).toContain(" peer 2001:DB8::1 connect-interface Vlanif10 2001:DB8:10::2\n");
});
