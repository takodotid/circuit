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
        blackhole: { function: 666, upstreams: { 64501: "64501:666" } },
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
        description: "Blackhole: dropped in AS64500 and by its upstreams that take it",
    });

    // A neighbor with its own blackhole community gets the route, tagged with it, and none of ours.
    const passed = communities.actions(64501).find((rule) => rule.description === "Blackhole passed on to AS64501")!;
    expect(passed).toMatchObject({ action: "accept", set: { add_communities: ["64501:666"], remove_large_communities: ["64500:*:*"] } });
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
