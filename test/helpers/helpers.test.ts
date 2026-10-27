// Helpers are plain config: what each returns is what a device holds, or a check that finds what it describes.

import { expect, test } from "bun:test";
import { Platforms } from "../../src/platforms";
import router from "../../examples/platforms/routeros";
import switchDevice from "../../examples/platforms/vrp";

test("helpers build the rules they describe", async () => {
    const { Bgp, Checks, Filters } = await import("../../src/helpers");

    expect(Filters.antiSpoofing("ix", Filters.MARTIANS).map((rule) => rule.match?.src)).toEqual([...Filters.MARTIANS]);
    expect(Filters.badTcpFlags()).toHaveLength(6);
    expect(Bgp.sanity().map((rule) => rule.description)).toEqual([
        "IPv4 shorter than /8",
        "IPv4 longer than /24",
        "IPv6 shorter than /16",
        "IPv6 longer than /48",
        "RPKI invalid",
    ]);

    const findings = Checks.exportsEndInReject([{ ...router, policies: { ...router.policies, "UPSTREAM-OUT": [{ action: "accept" }] } }]);
    expect(findings.map((finding) => finding.message)).toContain("upstream-1: export UPSTREAM-OUT does not end in an unconditional reject");
});

test("Filters.antiAmplification drops fragments and amplifiers, keeps asked services' answers, one switch rule per port", async () => {
    const { Filters } = await import("../../src/helpers");
    const rules = Filters.antiAmplification(["198.51.100.0/24"], { keep_fragments: ["198.51.100.64/27", "192.0.2.0/24"] });

    expect(rules.slice(0, 2)).toEqual([
        {
            description: "UDP fragments to 198.51.100.64/27 kept",
            match: { protocol: "udp", dst: "198.51.100.64/27", src_port: 0 },
            action: "accept",
        },
        {
            description: "UDP fragments to 198.51.100.0/24",
            match: { protocol: "udp", dst: "198.51.100.0/24", src_port: 0 },
            action: "drop",
        },
    ]);
    expect([...new Set(rules.slice(2).map((rule) => rule.match?.src_port))]).toEqual(Object.values(Filters.AMPLIFIERS));
    // A server's own port passes first, so every drop takes the one range: a switch chip has few range checkers.
    expect(rules.filter((rule) => rule.match?.src_port === 53).map((rule) => [rule.action, rule.match?.dst_port])).toEqual([
        ["accept", 53],
        ["drop", { min: 0, max: 1023 }],
    ]);
    expect(rules.find((rule) => rule.match?.src_port === 11211)?.match?.dst_port).toBeUndefined();
    const ranges = rules.flatMap((rule) => [rule.match?.dst_port].flat()).filter((port) => typeof port === "object");
    expect(new Set(ranges.map((range) => JSON.stringify(range))).size).toBe(1);

    const dns = Platforms.get("routeros").render({ ...router, acls: { edge: rules } });
    expect(
        dns.match(/comment="UDP to 198.51.100.0\/24 from dns, to a port below 1024".*/g)?.map((line) => line.match(/dst-port=\S+/)?.[0])
    ).toEqual(["dst-port=0-1023"]);

    const listed = {
        ...router,
        acls: { edge: [{ description: "Two ports", match: { protocol: "udp" as const, src_port: [53, 123] }, action: "drop" as const }] },
    };
    const rendered = Platforms.get("routeros").render(listed);
    expect(rendered.match(/comment="Two ports".*/g)?.map((line) => line.match(/src-port=\S+/)?.[0])).toEqual([
        "src-port=53",
        "src-port=123",
    ]);
});

test("Checks.trustBoundary finds an untrusted VLAN beside a trusted one away from a router", async () => {
    const { Checks } = await import("../../src/helpers");

    expect(Checks.vlansOf({ access_vlan: "a", trunk_vlans: ["b"] })).toEqual(["a", "b"]);

    const check = Checks.trustBoundary({ untrusted: ["guests"], routers: ["example-router"] });
    expect(check([switchDevice]).map((finding) => finding.message)).toEqual([
        "LAG uplink carries an untrusted VLAN beside a trusted one and does not face a router",
        "interface guests puts an address on untrusted VLAN guests; only a router may",
    ]);
});

test("Checks.trustBoundary lets a named link between two switches extend a site", async () => {
    const { Checks } = await import("../../src/helpers");
    const extension = (name: string, far: string) =>
        ({
            ...switchDevice,
            name,
            interfaces: {},
            ports: { "10g-1": { trunk_vlans: ["guests", "management"], link: { device: far, port: "10g-1" } } },
        }) as typeof switchDevice;
    const devices = [extension("near", "far"), extension("far", "near")];

    expect(Checks.trustBoundary({ untrusted: ["guests"], routers: [] })(devices)).toHaveLength(2);
    expect(Checks.trustBoundary({ untrusted: ["guests"], routers: [], extended: [["near", "far"]] })(devices)).toEqual([]);
});

test("Checks.nativeVlansAreDeadEnds keeps a native VLAN on one trunk and off every other port", async () => {
    const { Checks } = await import("../../src/helpers");
    const withPorts = (ports: Record<string, object>, interfaces: Record<string, object> = {}) =>
        ({ ...switchDevice, name: "sw", ports, interfaces }) as unknown as typeof switchDevice;

    const alone = withPorts({ "10g-1": { trunk_vlans: ["servers"], native_vlan: "guests" }, "10g-2": { access_vlan: "servers" } });
    expect(Checks.nativeVlansAreDeadEnds([alone])).toEqual([]);

    const shared = withPorts(
        { "10g-1": { trunk_vlans: ["servers"], native_vlan: "guests" }, "10g-2": { lag: "uplink" } },
        { uplink: { type: "lag", mode: "lacp", trunk_vlans: ["servers"], native_vlan: "guests" } }
    );
    expect(Checks.nativeVlansAreDeadEnds([shared]).map((finding) => finding.message)).toEqual([
        "native VLAN guests is native on port 10g-1, LAG uplink: give each trunk its own",
    ]);

    const member = withPorts({
        "10g-1": { trunk_vlans: ["servers", "guests"], native_vlan: "guests" },
        "10g-2": { access_vlan: "guests" },
    });
    expect(Checks.nativeVlansAreDeadEnds([member]).map((finding) => finding.message)).toEqual([
        "native VLAN guests is also an access or tagged VLAN on port 10g-1",
        "native VLAN guests is also an access or tagged VLAN on port 10g-2",
    ]);
});

test("Bgp.communityScheme blackholes only inside the customer's space, and never announces it", async () => {
    const { Bgp } = await import("../../src/helpers");
    const communities = Bgp.communityScheme({
        asn: 64500,
        learned_from: { function: 1, classes: { customer: 3 } },
        blackhole: { function: 666 },
    });

    expect(communities.blackhole(["customer-v4", "customer-v6"])).toEqual(
        (["customer-v4", "customer-v6"] as const).map((prefixSet) => ({
            description: "Blackhole, asked by the neighbor",
            match: { large_community: "64500:666:0", prefix_set: prefixSet },
            set: { blackhole: true as const },
            action: "accept" as const,
        }))
    );
    expect(communities.actions(64502)[0]).toMatchObject({ match: { large_community: "64500:666:0" }, action: "reject" });
    expect(communities.catalogue).toContainEqual({
        community: "64500:666:0",
        description: "Blackhole: dropped in AS64500, and by the upstreams that take it",
    });

    // A neighbor with its own blackhole community gets the route, tagged with it, and none of ours.
    const passed = communities
        .actions({ asn: 64501, communities: { blackhole: "64501:666" } })
        .find((rule) => rule.description === "Blackhole passed on to AS64501")!;
    expect(passed).toMatchObject({ action: "accept", set: { add_communities: ["64501:666"], remove_large_communities: ["64500:*:*"] } });

    // A large blackhole community is added as a large one.
    const large = communities.blackholeExport({ asn: 64503, communities: { blackhole: "64503:666:0" } })[0]!;
    expect(large.set).toMatchObject({ add_large_communities: ["64503:666:0"] });
});

test("a trusted neighbor keeps its requests; anyone else loses every community of ours", async () => {
    const { Bgp } = await import("../../src/helpers");
    const communities = Bgp.communityScheme({
        asn: 64500,
        learned_from: { function: 1, classes: { transit: 1, customer: 3 } },
        do_not_announce: 100,
        blackhole: { function: 666 },
    });

    expect(communities.tag("customer", 65550, { trusted: true }).set?.remove_large_communities).toEqual(["64500:1:*"]);
    expect(communities.tag("customer", 65551).set?.remove_large_communities).toEqual(["64500:*:*"]);
    expect(communities.tag("transit", 6939).set?.remove_large_communities).toEqual(["64500:*:*"]);
});

test("Checks.exportsEndInReject leaves out an export to a customer", async () => {
    const { Checks } = await import("../../src/helpers");
    const policies = { ...router.policies, "UPSTREAM-OUT": [{ action: "accept" as const }] };
    const bgp = router.routing!.bgp!;
    const asCustomer = { ...bgp, groups: { upstream: { ...bgp.groups!.upstream!, role: "customer" as const } } };
    const aboutUpstream = (devices: Parameters<typeof Checks.exportsEndInReject>[0]) =>
        Checks.exportsEndInReject(devices).filter((finding) => finding.message.startsWith("upstream-1"));

    expect(aboutUpstream([{ ...router, policies }])).toHaveLength(1);
    expect(aboutUpstream([{ ...router, policies, routing: { ...router.routing, bgp: asCustomer } }])).toEqual([]);
});

test("Exchange.build gives a port to one member only", async () => {
    const { Exchange } = await import("../../src/helpers");
    const member = { name: "a", asn: 64510, ports: { "ix-sw-01": "10g-1" } };
    const exchange = Exchange.build({ vlan: "peering", lan: { ipv4: "203.0.113.0/24" } }, [member, { ...member, name: "b", asn: 64511 }]);

    expect(exchange.check([]).map((finding) => finding.message)).toContain("port 10g-1 is given to both a and b");
});

test("Exchange.build keeps members apart", async () => {
    const { Exchange } = await import("../../src/helpers");
    const member = { name: "a", asn: 64510, ports: {}, ipv4: "203.0.113.1" } as const;
    const exchange = Exchange.build({ vlan: "peering", lan: { ipv4: "203.0.113.0/24" }, reserved: ["203.0.113.1"] }, [
        member,
        { ...member, name: "b" },
    ]);

    expect(exchange.check([]).map((finding) => finding.message)).toEqual([
        "members a and b share AS64510",
        "203.0.113.1 of a is already reserved",
        "203.0.113.1 of b is already a's",
    ]);
});

test("Exchange.build puts a MAC limit and an ethertype filter on every member port, only when asked", async () => {
    const { Exchange } = await import("../../src/helpers");
    const member = { name: "a", asn: 64510, ports: { "ix-sw-01": "10g-1" } };
    const plain = Exchange.build({ vlan: "peering", lan: { ipv4: "203.0.113.0/24" } }, [member]);
    const filtered = Exchange.build(
        { vlan: "peering", lan: { ipv4: "203.0.113.0/24" }, mac_limit: 1, ethertypes: ["ipv4", "ipv6", "arp"] },
        [member]
    );

    expect(plain.ports("ix-sw-01")["10g-1"]).not.toHaveProperty("mac_limit");
    expect(plain.ports("ix-sw-01")["10g-1"]).not.toHaveProperty("ethertypes");
    expect(filtered.ports("ix-sw-01")["10g-1"]).toMatchObject({ mac_limit: 1, ethertypes: ["ipv4", "ipv6", "arp"] });
});

test("Exchange.build writes each member port as its doc lists, with LLDP and spanning tree off unless the exchange turns them on", async () => {
    const { Exchange } = await import("../../src/helpers");
    const member = { name: "a", asn: 64510, ports: { "ix-sw-01": "10g-1" } };
    const lan = { ipv4: "203.0.113.0/24" } as const;

    expect(Exchange.build({ vlan: "peering", lan }, [member]).ports("ix-sw-01")["10g-1"]).toEqual({
        description: "a, AS64510",
        access_vlan: "peering",
        stp: false,
        lldp: false,
        storm_control: { broadcast: { percent: 1 }, multicast: { percent: 1 }, unknown_unicast: { percent: 1 } },
    });
    expect(Exchange.build({ vlan: "peering", lan, lldp: true, stp: true }, [member]).ports("ix-sw-01")["10g-1"]).toMatchObject({
        lldp: true,
        stp: true,
    });
});

// The output was parse-checked with `bird -p -c` on BIRD 2.0.12 and 2.15.1; these keep its shape.
test("exchange.bird writes one BIRD session per member and family, each taking only the member's own routes", async () => {
    const { exchange, ROUTE_SERVERS } = await import("../../examples/use-cases/internet-exchange/exchange");
    const config = exchange.bird(ROUTE_SERVERS[0]);

    expect(config).toContain("router id 203.0.113.1;");
    expect(config.match(/^protocol bgp /gm)).toHaveLength(6);
    expect(config).toContain(
        [
            "protocol bgp cloudflare_ipv6 {",
            '    description "cloudflare, AS13335";',
            "    local 2001:db8:ffff::1 as 64500;",
            "    neighbor 2001:db8:ffff::10 as 13335;",
            "    rs client;",
            "    ipv6 {",
            "        import keep filtered on;",
            "        import filter {",
            "            if bgp_path.first != 13335 then reject;",
            "            if bgp_next_hop != 2001:db8:ffff::10 then reject;",
            "            if net ~ [ 2001:db8:ffff::/64+ ] then reject;",
            "            if net.len < 12 || net.len > 48 then reject;",
            "            accept;",
            "        };",
            "        export all;",
            "    };",
            "}",
        ].join("\n")
    );
});

test("exchange.bird gives a session only in the families both ends have, and refuses what BIRD would", async () => {
    const { Exchange } = await import("../../src/helpers");
    const lan = { ipv4: "203.0.113.0/24", ipv6: "2001:db8:ffff::/64" } as const;
    const members = [
        { name: "big-net", asn: 64510, ports: {}, ipv4: "203.0.113.10", ipv6: "2001:db8:ffff::10" },
        { name: "small", asn: 64511, ports: {}, ipv4: "203.0.113.11" },
    ] as const;
    const exchange = Exchange.build({ vlan: "peering", lan }, members);

    const onlyIpv4 = exchange.bird({ name: "rs1", asn: 64500, router_id: "203.0.113.1", ipv4: "203.0.113.1" });
    expect(onlyIpv4.match(/^protocol bgp \S+/gm)).toEqual(["protocol bgp big_net_ipv4", "protocol bgp small_ipv4"]);

    const both = exchange.bird({ name: "rs1", asn: 64500, router_id: "203.0.113.1", ipv4: "203.0.113.1", ipv6: "2001:db8:ffff::1" });
    expect(both.match(/^protocol bgp \S+/gm)).toEqual([
        "protocol bgp big_net_ipv4",
        "protocol bgp big_net_ipv6",
        "protocol bgp small_ipv4",
    ]);

    expect(() => exchange.bird({ name: "rs1", asn: 64500, router_id: "203.0.113.1" })).toThrow(
        "route server rs1 has no address on the peering LAN"
    );
    expect(() => exchange.bird({ name: "rs1", asn: 64500, router_id: "198.51.100.1", ipv4: "198.51.100.1" })).toThrow(
        "198.51.100.1 of route server rs1 is outside the peering LAN"
    );

    const clashing = Exchange.build({ vlan: "peering", lan }, [members[0], { ...members[1], name: "big_net" }]);
    expect(() => clashing.bird({ name: "rs1", asn: 64500, router_id: "203.0.113.1", ipv4: "203.0.113.1" })).toThrow(
        "members big-net and big_net would both have session big_net_ipv4"
    );
});

// The output was parse-checked with `bgpd -n` on OpenBGPD 9.1, and run against member routers, which got only the routes these rules keep; these keep its shape.
test("exchange.openbgpd writes one OpenBGPD group per family and rules that keep only each member's own routes", async () => {
    const { exchange, ROUTE_SERVERS } = await import("../../examples/use-cases/internet-exchange/exchange");
    const config = exchange.openbgpd(ROUTE_SERVERS[0]);

    expect(config).toContain(["AS 64500", "router-id 203.0.113.1"].join("\n"));
    expect(config).toContain("\nfib-update no\n");
    expect(config).toContain("\ntransparent-as yes\n");
    expect(config).toContain("\nrde rib Loc-RIB include filtered\n");
    expect(config.match(/^ {4}neighbor /gm)).toHaveLength(6);
    expect(config).toContain(
        [
            'group "ipv6 members" {',
            "    local-address 2001:db8:ffff::1",
            "    # A route whose first AS is not the member's own is dropped by the rules below. The default would close the whole session.",
            "    enforce neighbor-as no",
            "    neighbor 2001:db8:ffff::10 {",
            "        remote-as 13335",
            '        descr "cloudflare, AS13335"',
            "    }",
        ].join("\n")
    );
    expect(config.match(/^(allow|deny) .*$/gm)).toEqual([
        'allow from group "ipv4 members" peer-as neighbor-as nexthop neighbor prefix 0.0.0.0/0 prefixlen 8 - 24',
        'allow from group "ipv6 members" peer-as neighbor-as nexthop neighbor prefix ::/0 prefixlen 12 - 48',
        "deny from any prefix 203.0.113.0/24 or-longer",
        "deny from any prefix 2001:db8:ffff::/64 or-longer",
        "allow to any",
    ]);
});

test("exchange.openbgpd writes a group only for a family both ends have, and refuses a server bird would", async () => {
    const { Exchange } = await import("../../src/helpers");
    const lan = { ipv4: "203.0.113.0/24", ipv6: "2001:db8:ffff::/64" } as const;
    const members = [
        { name: "big-net", asn: 64510, ports: {}, ipv4: "203.0.113.10" },
        { name: "small", asn: 64511, ports: {}, ipv4: "203.0.113.11" },
    ] as const;
    const exchange = Exchange.build({ vlan: "peering", lan }, members);

    // No member has an IPv6 address, so the server's IPv6 address gets no group and no rule.
    const config = exchange.openbgpd({ name: "rs1", asn: 64500, router_id: "203.0.113.1", ipv4: "203.0.113.1", ipv6: "2001:db8:ffff::1" });
    expect(config.match(/^group .*$/gm)).toEqual(['group "ipv4 members" {']);
    expect(config).not.toContain("ipv6 members");
    expect(config).not.toContain("2001:db8:ffff::");

    expect(() => exchange.openbgpd({ name: "rs1", asn: 64500, router_id: "203.0.113.1" })).toThrow(
        "route server rs1 has no address on the peering LAN"
    );
    expect(() => exchange.openbgpd({ name: "rs1", asn: 64500, router_id: "198.51.100.1", ipv4: "198.51.100.1" })).toThrow(
        "198.51.100.1 of route server rs1 is outside the peering LAN"
    );
});

test("Bgp.announce accepts each prefix at its length and ends in the reject exportsEndInReject wants", async () => {
    const { Bgp, Checks } = await import("../../src/helpers");
    const rules = Bgp.announce([{ prefix: "192.0.2.0/24", description: "Our IPv4" }, { prefix: "2001:db8::/32" }]);

    expect(rules).toEqual([
        { description: "Our IPv4", match: { prefix: "192.0.2.0/24" }, action: "accept" },
        { match: { prefix: "2001:db8::/32" }, action: "accept" },
        { description: "Nothing else", action: "reject" },
    ]);
    expect(Checks.exportsEndInReject([{ ...router, policies: { ...router.policies, "UPSTREAM-OUT": rules } }])).toEqual([]);
});

test("Bgp.learn runs project rules, sanity, sources, preference and tag in that order, then accepts", async () => {
    const { Bgp } = await import("../../src/helpers");
    const before = { description: "No routes of ours back", match: { prefix: "192.0.2.0/24" as const }, action: "reject" as const };

    expect(
        Bgp.learn({
            before: [before],
            sanity: "SANITY",
            sources: ["192.0.2.1", "2001:db8::1"],
            local_pref: 250,
            tag: { large: "64500:1:1" },
        })
    ).toEqual([
        before,
        { call: "SANITY" },
        { set: { preferred_source: "192.0.2.1" } },
        { set: { preferred_source: "2001:db8::1" } },
        { set: { local_pref: 250 } },
        { description: "Tag 64500:1:1", set: { add_large_communities: ["64500:1:1"] } },
        { action: "accept" },
    ]);

    // Without a policy to call, the sanity rules are written in; a standard community or a rule of the scheme tags just the same.
    const scheme = Bgp.communityScheme({ asn: 64500, learned_from: { function: 1, classes: { transit: 1 } } });
    expect(Bgp.learn({ tag: { standard: "64500:100" } }).slice(0, 5)).toEqual(Bgp.sanity());
    expect(Bgp.learn({ tag: { standard: "64500:100" } }).at(-2)).toEqual({
        description: "Tag 64500:100",
        set: { add_communities: ["64500:100"] },
    });
    expect(Bgp.learn({ sanity: "SANITY", tag: scheme.tag("transit", 64501) }).at(-2)).toEqual(scheme.tag("transit", 64501));
});

test("Bgp.defaultOnly takes the default route of each family, with the source of its family", async () => {
    const { Bgp } = await import("../../src/helpers");

    expect(Bgp.defaultOnly({ local_pref: 100, description: "Transit A default", sources: ["2001:db8::1", "192.0.2.1"] })).toEqual([
        {
            description: "Transit A default",
            match: { prefix: "0.0.0.0/0" },
            set: { local_pref: 100, preferred_source: "192.0.2.1" },
            action: "accept",
        },
        {
            description: "Transit A default",
            match: { prefix: "::/0" },
            set: { local_pref: 100, preferred_source: "2001:db8::1" },
            action: "accept",
        },
    ]);
    expect(Bgp.defaultOnly()).toEqual([
        { description: "Default route, ipv4", match: { prefix: "0.0.0.0/0" }, action: "accept" },
        { description: "Default route, ipv6", match: { prefix: "::/0" }, action: "accept" },
    ]);
});

test("RouterOS and Junos render the three policy shapes; FortiOS has no RPKI match and no rule without an action", async () => {
    const { Bgp } = await import("../../src/helpers");
    const policies = {
        ANNOUNCE: Bgp.announce([{ prefix: "192.0.2.0/24", description: "Our IPv4" }]),
        LEARN: Bgp.learn({ local_pref: 250, tag: { standard: "64500:100" } }),
        DEFAULT: Bgp.defaultOnly({ local_pref: 100 }),
    };

    for (const name of ["routeros", "junos", "fortios"] as const) {
        const example = (await import(`../../examples/platforms/${name}`)).default;
        const device = { ...example, policies: { ...example.policies, ...policies } };
        const platform = Platforms.get(name);

        if (name === "fortios") {
            expect(platform.unsupported(device)).toContain("policies.LEARN[4].match.rpki");
            continue;
        }

        expect(platform.unsupported(device)).toEqual([]);
        expect(platform.render(device)).toContain("192.0.2.0/24");
    }
});

test("Bgp.announce ends in a reject unless told not to; Bgp.defaultOnly ends in one only when asked", async () => {
    const { Bgp } = await import("../../src/helpers");
    const ours = [{ prefix: "192.0.2.0/24" as const }];

    expect(Bgp.announce(ours).at(-1)).toEqual({ description: "Nothing else", action: "reject" });
    expect(Bgp.announce(ours, { reject: false })).toEqual([{ match: { prefix: "192.0.2.0/24" }, action: "accept" }]);
    expect(Bgp.defaultOnly()).toHaveLength(2);
    expect(Bgp.defaultOnly({ reject: true }).at(-1)).toEqual({ description: "Nothing else", action: "reject" });
});

test("communityScheme().actions is its single helpers in a fixed order, and each stands on its own", async () => {
    const { Bgp } = await import("../../src/helpers");
    const c = Bgp.communityScheme({
        asn: 64500,
        do_not_announce: 100,
        prepend: { once: 101, twice: 102 },
        blackhole: { function: 666 },
    });
    const takesBlackholes = { asn: 64510, communities: { blackhole: "64510:666" } } as const;

    // Toward a neighbor that takes no blackholes: blackhole, do-not-announce, prepends, strip.
    expect(c.actions(64511)).toEqual([...c.blackholeExport(64511), ...c.rejectDoNotAnnounce(64511), ...c.prepends(64511), c.stripOurs()]);
    // Toward one that does, do-not-announce comes first, so a route asked not to go there is never passed on as a blackhole.
    expect(c.actions(takesBlackholes)).toEqual([
        ...c.rejectDoNotAnnounce(takesBlackholes),
        ...c.blackholeExport(takesBlackholes),
        ...c.prepends(takesBlackholes),
        c.stripOurs(),
    ]);

    expect(c.blackholeExport(64511)).toEqual([
        { description: "Blackholed here, never announced", match: { large_community: "64500:666:0" }, action: "reject" },
    ]);
    expect(c.blackholeExport(takesBlackholes)[0]).toMatchObject({ description: "Blackhole passed on to AS64510", action: "accept" });
    expect(c.rejectDoNotAnnounce(64511).map((rule) => rule.match)).toEqual([
        { large_community: "64500:100:0" },
        { large_community: "64500:100:64511" },
    ]);
    expect(c.prepends(64511).map((rule) => rule.set)).toEqual([{ prepend: 1 }, { prepend: 2 }]);
    expect(c.stripOurs()).toEqual({
        description: "Our communities stay inside our network",
        set: { remove_communities: ["64500:*"], remove_large_communities: ["64500:*:*"] },
    });

    // A scheme without a function gives nothing for it.
    const bare = Bgp.communityScheme({ asn: 64500 });
    expect([...bare.blackholeExport(1), ...bare.rejectDoNotAnnounce(1), ...bare.prepends(1)]).toEqual([]);
});

test("Bgp.learn's tag is one explicit kind, and FortiOS says which rules it can't hold", async () => {
    const { Bgp } = await import("../../src/helpers");

    expect(Bgp.learn({ sanity: "SANITY", local_pref: 200, tag: { large: "64500:1:1" } })).toEqual([
        { call: "SANITY" },
        { set: { local_pref: 200 } },
        { description: "Tag 64500:1:1", set: { add_large_communities: ["64500:1:1"] } },
        { action: "accept" },
    ]);
    // @ts-expect-error A community is written with its kind, not told apart by its colons.
    const bare = () => Bgp.learn({ tag: "64500:1:1" });
    expect(bare).toBeFunction();

    const firewall = (await import("../../examples/platforms/fortios")).default;
    const refused = Platforms.get("fortios").unsupported({
        ...firewall,
        policies: { ...firewall.policies, LEARN: Bgp.learn({ sanity: "NOT-TO-UPSTREAMS", local_pref: 200 }) },
    });
    expect(refused).toContain("policies.LEARN[1], a rule without action: the platform stops at the first rule that matches");
});
