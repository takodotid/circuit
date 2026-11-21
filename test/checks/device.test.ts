import { expect, test } from "bun:test";
import { Checks } from "../../src/checks";
import type { Device, Ipsec, NatRule } from "../../src/model";
import { Fixtures } from "../fixtures";

const router = Fixtures.device("platforms--example-router");

const messages = (device: Device) => Checks.run([device], undefined).map((finding) => finding.message);

test("a MAC limit is a whole number above 0, and an ethertype filter lets each kind in once", () => {
    const [port, settings] = Object.entries(router.interfaces?.ethernet ?? {})[0]!;
    const device: Device = {
        ...router,
        interfaces: {
            ...router.interfaces,
            ethernet: { ...router.interfaces?.ethernet, [port]: { ...settings, mac_limit: 0, ethertypes: ["ipv4", "ipv4"] } },
            lag: { ...router.interfaces?.lag, members: { mac_limit: 1.5, ethertypes: [] } },
        },
    };

    expect(messages(device)).toEqual(
        expect.arrayContaining([
            `interfaces.ethernet.${port}.mac_limit 0 is not a whole number above 0`,
            `interfaces.ethernet.${port}.ethertypes lists a kind twice`,
            "interfaces.lag.members.mac_limit 1.5 is not a whole number above 0",
            "interfaces.lag.members.ethertypes is empty, so it would drop every frame",
        ])
    );
});

test("a bound port is an access port, with each MAC address and each address written once and well", () => {
    const [port, settings] = Object.entries(router.interfaces?.ethernet ?? {})[0]!;
    const device: Device = {
        ...router,
        interfaces: {
            ...router.interfaces,
            ethernet: {
                ...router.interfaces?.ethernet,
                [port]: {
                    ...settings,
                    bound_to: [
                        { mac: "02:00:00:00:00:01", addresses: ["192.0.2.10", "192.0.2.9/29", "fe80::1"] },
                        { mac: "02:00:00:00:00:01", addresses: ["192.0.2.10"] },
                        { mac: "01:00:5e:00:00:01", addresses: [] },
                        { mac: "02:00:00:00:00:0g", addresses: [] },
                    ],
                },
            },
            lag: { ...router.interfaces?.lag, members: { access_vlan: "lan", bound_to: [] } },
        },
    };
    const where = `interfaces.ethernet.${port}.bound_to`;

    expect(messages(device)).toEqual(
        expect.arrayContaining([
            `${where} is on a port that is not an access port: bind the hosts of one VLAN`,
            `${where}[0].addresses 192.0.2.9/29 has bits past its length: write 192.0.2.8/29`,
            `${where}[0].addresses fe80::1 is link-local, which a bound host may always send from`,
            `${where}[1].mac 02:00:00:00:00:01 is listed twice`,
            `${where}[1].addresses 192.0.2.10 is listed twice on the port`,
            `${where}[2].mac 01:00:5e:00:00:01 is a multicast address, which no host sends from`,
            `${where}[3].mac '02:00:00:00:00:0g' is not a MAC address, such as 02:00:00:00:00:01`,
            "interfaces.lag.members.bound_to is empty, so it would drop every frame",
        ])
    );
});

test("a static route with bfd needs next_hop, the address BFD watches", () => {
    const viaInterface: Device = {
        ...router,
        routing: { ...router.routing, static_routes: [{ prefix: "198.51.100.128/25", interface: "uplink", bfd: true }] },
    };

    expect(messages(viaInterface)).toContain("routing.static_routes 198.51.100.128/25 has bfd without next_hop, the address BFD watches");
});

test("a next hop with an interface after % says where the interface goes", () => {
    const device: Device = {
        ...router,
        routing: { ...router.routing, static_routes: [{ prefix: "::/0", next_hop: "fe80::1%ether1" }] },
    };

    expect(messages(device)).toContain(
        'routing.static_routes ::/0 next_hop fe80::1%ether1 has an interface after %. Write next_hop: "fe80::1", and the interface in interface'
    );
});

// A blackhole route drops the traffic, so a next hop or an interface beside it says the opposite.
test("a blackhole route has neither next_hop nor interface", () => {
    const routes: Device["routing"] = {
        ...router.routing,
        static_routes: [
            { prefix: "198.51.100.0/24", blackhole: true, next_hop: "192.0.2.1" },
            { prefix: "198.51.100.0/25", blackhole: true, interface: "uplink" },
            { prefix: "2001:db8::/32", blackhole: true, next_hop: "2001:db8:1::1", interface: "uplink" },
            { prefix: "203.0.113.0/24", blackhole: true },
        ],
    };
    const firewall = Fixtures.device("platforms--example-firewall");
    const management: NonNullable<Device["system"]>["vdoms"] = {
        management: { name: "mgmt", interfaces: ["1g-1"], static_routes: [{ prefix: "0.0.0.0/0", blackhole: true, interface: "1g-1" }] },
    };

    const found = [
        ...messages({ ...router, routing: routes }),
        ...messages({ ...firewall, system: { ...firewall.system, vdoms: management } }),
    ].filter((message) => message.includes("blackhole"));

    expect(found).toEqual([
        "routing.static_routes 198.51.100.0/24 has blackhole with next_hop. Remove next_hop to drop the traffic, or remove blackhole to forward it",
        "routing.static_routes 198.51.100.0/25 has blackhole with interface. Remove interface to drop the traffic, or remove blackhole to forward it",
        "routing.static_routes 2001:db8::/32 has blackhole with next_hop and interface. Remove next_hop and interface to drop the traffic, or remove blackhole to forward it",
        "system.vdoms.management.static_routes 0.0.0.0/0 has blackhole with interface. Remove interface to drop the traffic, or remove blackhole to forward it",
    ]);
});

// GTSM accepts only TTL 255, which a packet from more than one hop away never has.
test("ttl_security with multihop is an error, once at a group that has both", () => {
    const bgp = router.routing!.bgp!;
    const device: Device = {
        ...router,
        routing: {
            ...router.routing,
            bgp: {
                ...bgp,
                neighbor_groups: { ...bgp.neighbor_groups, controllers: { remote_as: 64512, multihop: true, ttl_security: true } },
                neighbors: {
                    ...bgp.neighbors,
                    "controller-1": { address: "198.51.100.7", neighbor_group: "controllers" },
                    "controller-2": { address: "198.51.100.8", neighbor_group: "controllers", multihop: false },
                    cogent: { address: "203.0.113.5", neighbor_group: "upstream", multihop: true, ttl_security: true },
                },
            },
        },
    };

    expect(messages(device).filter((message) => message.includes("has ttl_security with multihop"))).toEqual([
        "routing.bgp.neighbor_groups.controllers has ttl_security with multihop, but a packet from more than one hop away never arrives with TTL 255. Remove ttl_security, or remove multihop if the neighbor is directly connected",
        "routing.bgp.neighbors.cogent has ttl_security with multihop, but a packet from more than one hop away never arrives with TTL 255. Remove ttl_security, or remove multihop if the neighbor is directly connected",
    ]);
});

// RouterOS, Junos, and FortiOS bring up an eBGP session without multihop only to a neighbor on a network they share.
test("an eBGP neighbor on no network of the device, in its VRF, needs multihop", () => {
    const bgp = router.routing!.bgp!;
    const device: Device = {
        ...router,
        routing: {
            ...router.routing,
            bgp: {
                ...bgp,
                neighbor_groups: { ...bgp.neighbor_groups, far: { remote_as: 64501, multihop: true } },
                neighbors: {
                    "on-uplink": { address: "203.0.113.1", remote_as: 64501 },
                    "link-local": { address: "fe80::1", remote_as: 64501 },
                    far: { address: "198.51.100.200", remote_as: 64501 },
                    "far-multihop": { address: "198.51.100.201", remote_as: 64501, multihop: true },
                    "far-group": { address: "198.51.100.202", neighbor_group: "far" },
                    "far-gtsm": { address: "198.51.100.203", remote_as: 64501, ttl_security: true },
                    "far-ibgp": { address: "198.51.100.204", remote_as: 64500 },
                    "uplink-in-guests": { address: "203.0.113.1", remote_as: 64501, vrf: "guests" },
                },
            },
        },
    };

    expect(messages(device).filter((message) => message.includes("is on no network"))).toEqual([
        "routing.bgp.neighbors.far: 198.51.100.200 is on no network of this device, so an eBGP session to it never comes up. Write multihop: true if AS64501 is more than one hop away, or fix the address",
        "routing.bgp.neighbors.far-gtsm: 198.51.100.203 is on no network of this device, so an eBGP session to it never comes up. Fix the address: ttl_security takes a directly connected neighbor only",
        "routing.bgp.neighbors.uplink-in-guests: 203.0.113.1 is on no network of this device in VRF guests, so an eBGP session to it never comes up. Write multihop: true if AS64501 is more than one hop away, or fix the address",
    ]);
});

// BGP announces an aggregate only while it holds a route inside it, and only where an export accepts it. A policy the config can't decide on is left alone.
test("an aggregate no export accepts, or with nothing inside it, is an error", () => {
    const device = Fixtures.device("platforms--example-aggregation-switch");
    const bgp = device.routing!.bgp!;
    const found = (changed: Device) => messages(changed).filter((message) => message.startsWith("routing.bgp.aggregates"));
    const withAggregates = (aggregates: NonNullable<typeof bgp.aggregates>, neighbors = bgp.neighbors) =>
        found({ ...device, routing: { ...device.routing, bgp: { ...bgp, aggregates, neighbors } } });
    const noExport = (prefix: string) =>
        `routing.bgp.aggregates ${prefix}: no neighbor's export_policy accepts it, so BGP announces it to no one. Add { if: { prefix: "${prefix}" }, then: "accept" } to the export_policy of each neighbor that should get it, before any rule that rejects it`;

    // transit-out accepts what is inside 203.0.113.64/26, after a call that decides nothing. customer-out accepts only 0.0.0.0/0.
    expect(withAggregates([{ prefix: "203.0.113.64/27" }])).toEqual([]);
    expect(withAggregates([{ prefix: "203.0.113.0/24", summary_only: true }])).toEqual([noExport("203.0.113.0/24")]);

    const collector = { address: "192.0.2.90" as const, remote_as: 64500, export_policy: "transit-out" };
    expect(withAggregates([{ prefix: "198.51.100.0/24" }], { collector })).toEqual([
        "routing.bgp.aggregates 198.51.100.0/24 has no route inside it to stand for: no prefix of originated_prefixes is inside it, and no neighbor that carries ipv4 has an import_policy. Add the prefixes inside it to originated_prefixes",
        noExport("198.51.100.0/24"),
    ]);

    // An RPKI state is not known before the route exists.
    const policies = { ...device.routing!.policies, "transit-out": [{ if: { rpki: "valid" as const }, then: "accept" as const }] };
    const aggregates = [{ prefix: "203.0.113.0/24" as const }];
    expect(found({ ...device, routing: { ...device.routing, policies, bgp: { ...bgp, aggregates } } })).toEqual([]);
});

// Two parts merged can write both, which the editor refuses in one.
test("max_prefixes with both warn_only and restart_after is an error", () => {
    const bgp = router.routing!.bgp!;
    const both = { limit: 1000, warn_only: true, restart_after: 300 };
    const device = {
        ...router,
        routing: {
            ...router.routing,
            bgp: {
                ...bgp,
                neighbor_groups: { ...bgp.neighbor_groups, transit: { max_prefixes: both } },
                neighbors: { ...bgp.neighbors, cogent: { address: "203.0.113.5", remote_as: 174, max_prefixes: both } },
            },
        },
    } as unknown as Device;

    expect(messages(device).filter((message) => message.includes("has warn_only"))).toEqual([
        "routing.bgp.neighbor_groups.transit.max_prefixes has warn_only and restart_after. Keep warn_only to leave the session up, or restart_after to close it and open it again",
        "routing.bgp.neighbors.cogent.max_prefixes has warn_only and restart_after. Keep warn_only to leave the session up, or restart_after to close it and open it again",
    ]);
});

// A route reflector's clients are iBGP neighbors (RFC 4456), and a role is what an eBGP neighbor is to us (RFC 9234).
test("route_reflector_client on an eBGP neighbor is an error, once at a group that has both, and so is a role on an iBGP neighbor", () => {
    const bgp = router.routing!.bgp!;
    const device: Device = {
        ...router,
        routing: {
            ...router.routing,
            bgp: {
                ...bgp,
                cluster_id: "192.0.2.256",
                neighbor_groups: {
                    ...bgp.neighbor_groups,
                    clients: { remote_as: 64500, route_reflector_client: true },
                    cogent: { remote_as: 174, route_reflector_client: true },
                },
                neighbors: {
                    ...bgp.neighbors,
                    "cogent-1": { address: "203.0.113.5", neighbor_group: "cogent" },
                    as64501: { address: "203.0.113.6", neighbor_group: "upstream", route_reflector_client: true },
                    "edge-02": { address: "192.0.2.2", neighbor_group: "clients" },
                    "edge-03": { address: "192.0.2.3", neighbor_group: "clients", role: "peer" },
                },
            },
        },
    };

    const found = messages(device).filter((message) => /route_reflector_client|cluster_id|has role/.test(message));
    expect(found).toEqual([
        "routing.bgp.cluster_id: '192.0.2.256' is not an IPv4 address, such as 192.0.2.1",
        "routing.bgp.neighbor_groups.cogent has route_reflector_client, but AS174 is not ours, AS64500: a route reflector has iBGP clients only (RFC 4456). Remove route_reflector_client",
        "routing.bgp.neighbors.as64501 has route_reflector_client, but AS64501 is not ours, AS64500: a route reflector has iBGP clients only (RFC 4456). Remove route_reflector_client",
        "routing.bgp.neighbors.edge-03 has role, but AS64500 is ours, and a role is for eBGP neighbors (RFC 9234). Remove role",
    ]);
});

// RFC 5065: a member AS is seen only inside the confederation, and the identifier only outside it. RFC 9234 does not recommend roles between member ASes.
test("a confederation keeps its identifier apart from every member AS, and a neighbor in another member AS has no role", () => {
    const bgp = router.routing!.bgp!;
    const member = (asn: number, member_as: number[]): Device => ({
        ...router,
        routing: {
            ...router.routing,
            bgp: {
                ...bgp,
                asn,
                confederation: { identifier: 64500, member_as },
                neighbors: {
                    "core-02": { address: "192.0.2.2", remote_as: 65002, role: "peer" },
                    "core-03": { address: "192.0.2.3", remote_as: 64500 },
                },
            },
        },
    });
    const confederation = (device: Device) => messages(device).filter((message) => /^routing\.bgp\..*confederation/.test(message));

    expect(confederation(member(65001, [65001, 64500, 65002]))).toEqual([
        "routing.bgp.confederation.member_as has AS65001, this router's own member AS (routing.bgp.asn). List only the other member ASes",
        "routing.bgp.confederation.member_as has AS64500, the identifier. List only the member ASes",
        "routing.bgp.neighbors.core-02 has role, but AS65002 is in our confederation, and RFC 9234 does not recommend roles inside one. Remove role",
        "routing.bgp.neighbors.core-03 has remote_as 64500, the confederation's identifier, which only neighbors outside it see. Write the neighbor's member AS: 65001 if it is in ours, or one of member_as",
    ]);
    expect(confederation(member(64500, [65002]))).toContain(
        "routing.bgp.asn is AS64500, the confederation's identifier. Write this router's member AS in routing.bgp.asn, such as 65001"
    );
});

// RFC 2328 and RFC 3101: the backbone is a normal area, and only a stub area or an NSSA takes a default cost.
test("OSPF areas, timers, and keys are checked, and a border router without a default cost is warned", () => {
    const key = { secret: "OSPF_KEY" };
    const device: Device = {
        ...router,
        routing: {
            ...router.routing,
            ospf: {
                address_families: ["ipv4", "ipv6"],
                areas: {
                    "0.0.0.0": {
                        type: "stub",
                        interfaces: { uplink: { hello_interval: 60, authentication: { algorithm: "md5", key_id: 256, key } } },
                    },
                    "0.0.0.1": { no_summaries: true, stub_default_cost: 0, interfaces: {} },
                    "0.0.0.2": { type: "nssa", interfaces: { management: { hello_interval: 10, dead_interval: 10 } } },
                },
            },
        },
    };

    const findings = Checks.run([device], undefined).filter((finding) => finding.message.startsWith("routing.ospf"));
    expect(findings.map(({ level, message }) => `${level}: ${message}`)).toEqual([
        "error: routing.ospf.areas.0.0.0.0 has type stub, but the backbone is a normal area (RFC 2328). Remove type",
        "error: routing.ospf.areas.0.0.0.0.interfaces.uplink.authentication.key_id is 256: write a whole number from 0 to 255",
        "error: routing.ospf.areas.0.0.0.0.interfaces.uplink.authentication with OSPFv3: Circuit signs OSPFv2 only, and each platform signs OSPFv3 its own way. Remove authentication, or ipv6 from routing.ospf.address_families",
        "error: routing.ospf.areas.0.0.0.1 has no_summaries without type: only a stub area or an NSSA takes it. Write type, or remove no_summaries",
        "error: routing.ospf.areas.0.0.0.1 has stub_default_cost without type: only a stub area or an NSSA takes it. Write type, or remove stub_default_cost",
        "error: routing.ospf.areas.0.0.0.1.stub_default_cost is 0: write a whole number from 1 to 16777214",
        "error: routing.ospf.areas.0.0.0.2.interfaces.management.dead_interval 10 is not more than hello_interval 10, so a neighbor would go down between two hellos. Write 40, four times hello_interval",
        "warning: routing.ospf.areas.0.0.0.0.interfaces.uplink has hello_interval without dead_interval. Platforms differ in the dead interval they then use, and neighbors whose dead intervals differ never come up. Write dead_interval, such as 240",
        "warning: routing.ospf.areas.0.0.0.2 is an NSSA without stub_default_cost, and this device is its border router. RouterOS and Junos then announce no default route into it, and other platforms one at a cost of their own. Write stub_default_cost, such as 10",
    ]);
});

// RFC 2328: a range is on a border router (section 3.5), and a priority where a DR is elected (section 9.4). An NBMA or a point-to-multipoint link has neighbors (Appendix C.5 and C.6).
test("OSPF ranges, priorities, and neighbors are checked", () => {
    const device: Device = {
        ...router,
        routing: {
            ...router.routing,
            ospf: {
                areas: {
                    "0.0.0.0": {
                        interfaces: {
                            uplink: { network: "point-to-point", priority: 1 },
                            management: { network: "non-broadcast", priority: 256 },
                            "1g-1": {
                                network: "point-to-multipoint",
                                neighbors: ["198.51.100.2", "198.51.100.9", "198.51.100.1", "198.51.100.1"],
                            },
                        },
                    },
                    "0.0.0.1": {
                        ranges: [
                            { prefix: "198.51.100.64/24", advertise: true },
                            { prefix: "2001:db8:20::/48", advertise: false },
                            { prefix: "198.51.100.0/24", advertise: false },
                        ],
                        interfaces: { servers: { passive: true, neighbors: ["198.51.100.66"] } },
                    },
                },
            },
        },
    };

    const findings = Checks.run([device], undefined).filter((finding) => finding.message.startsWith("routing.ospf"));
    expect(findings.map(({ level, message }) => `${level}: ${message}`)).toEqual([
        "error: routing.ospf.areas.0.0.0.0.interfaces.uplink.priority: no designated router is elected on a point-to-point link. Remove priority",
        "error: routing.ospf.areas.0.0.0.0.interfaces.management.priority is 256: write a whole number from 0 to 255",
        "error: routing.ospf.areas.0.0.0.0.interfaces.management: a non-broadcast link carries no multicast, so the device finds no neighbor there by itself. Write the address of each in neighbors",
        "error: routing.ospf.areas.0.0.0.0.interfaces.1g-1.neighbors[0] 198.51.100.2 is 1g-1's own address. Write the neighbor's",
        "error: routing.ospf.areas.0.0.0.0.interfaces.1g-1.neighbors[1] 198.51.100.9 is on no IPv4 network of 1g-1. Write the neighbor's address on this link",
        "error: routing.ospf.areas.0.0.0.0.interfaces.1g-1.neighbors[3]: 198.51.100.1 is in neighbors twice. Remove one",
        "error: routing.ospf.areas.0.0.0.1.ranges[0].prefix 198.51.100.64/24 has bits past its length: write 198.51.100.0/24",
        "error: routing.ospf.areas.0.0.0.1.ranges[1].prefix 2001:db8:20::/48 is ipv6, which OSPF doesn't route here. Add ipv6 to routing.ospf.address_families, or remove the range",
        "error: routing.ospf.areas.0.0.0.1.ranges[2].prefix: 198.51.100.0/24 is in routing.ospf.areas.0.0.0.1.ranges twice. Remove one",
        'error: routing.ospf.areas.0.0.0.1.interfaces.servers.neighbors: a broadcast link finds its neighbors by multicast. Remove neighbors, or write network: "non-broadcast" or "point-to-multipoint"',
    ]);

    // A device in one area is no border router, so a range there does nothing. Neighbors are written for OSPFv2 only.
    const inOneArea: Device = {
        ...router,
        routing: {
            ...router.routing,
            ospf: {
                address_families: ["ipv4", "ipv6"],
                areas: {
                    "0.0.0.1": {
                        ranges: [{ prefix: "198.51.100.0/24", advertise: true }],
                        interfaces: { "1g-1": { network: "point-to-multipoint" } },
                    },
                },
            },
        },
    };
    expect(messages(inOneArea).filter((message) => message.startsWith("routing.ospf"))).toEqual([
        "routing.ospf.areas.0.0.0.1.ranges: example-router is in one area only, so it is no border router and announces no summary. Remove ranges, or write them on the border router",
        "routing.ospf.areas.0.0.0.1.interfaces.1g-1.network point-to-multipoint with OSPFv3: Circuit runs point-to-multipoint links for OSPFv2 only. Write another network, or remove ipv6 from routing.ospf.address_families",
    ]);
});

// RFC 2328: a summary's metric is below LSInfinity (section 12.4.3). A virtual link is in the backbone of a border router, across a normal area (section 15; RFC 3101).
test("OSPF range costs and virtual links are checked", () => {
    const device: Device = {
        ...router,
        routing: {
            ...router.routing,
            ospf: {
                areas: {
                    "0.0.0.0": {
                        virtual_links: [
                            { transit_area_id: "0.0.0.1", router_id: "192.0.2.1" },
                            { transit_area_id: "0.0.0.0", router_id: "192.0.2.2" },
                            { transit_area_id: "0.0.0.2", router_id: "192.0.2.3" },
                            { transit_area_id: "0.0.0.3", router_id: "192.0.2.4" },
                            { transit_area_id: "0.0.0.1", router_id: "192.0.2.255" },
                            { transit_area_id: "0.0.0.1", router_id: "192.0.2.256" },
                            { transit_area_id: "0.0.0.1", router_id: "192.0.2.1" },
                        ],
                        interfaces: {},
                    },
                    "0.0.0.1": {
                        ranges: [
                            { prefix: "198.51.100.0/25", advertise: true, cost: 16_777_215 },
                            { prefix: "198.51.100.128/25", advertise: false, cost: 10 },
                            { prefix: "203.0.113.0/24", advertise: true, cost: 0 },
                        ],
                        interfaces: { servers: { passive: true } },
                    },
                    "0.0.0.2": { type: "stub", stub_default_cost: 10, interfaces: { management: { passive: true } } },
                    "0.0.0.4": { virtual_links: [{ transit_area_id: "0.0.0.1", router_id: "192.0.2.1" }], interfaces: {} },
                },
            },
        },
    };

    const where = "routing.ospf.areas.0.0.0.0.virtual_links";
    expect(messages(device).filter((message) => message.startsWith("routing.ospf"))).toEqual([
        `${where}[1].transit_area_id: a virtual link crosses an area other than the backbone. Write the area both border routers are in`,
        `${where}[2].transit_area_id 0.0.0.2 is a stub area, which carries no virtual link (RFC 2328, RFC 3101). Write a normal area`,
        `${where}[3].transit_area_id 0.0.0.3: example-router has no interface in that area. Write an area of routing.ospf.areas that both border routers have interfaces in`,
        `${where}[4].router_id 192.0.2.255 is example-router's own. Write the far border router's router ID`,
        `${where}[5].router_id: '192.0.2.256' is not an IPv4 address. Write the far border router's router ID`,
        `${where}[6]: the virtual link across 0.0.0.1 to 192.0.2.1 is in ${where} twice. Remove one`,
        "routing.ospf.areas.0.0.0.1.ranges[0].cost is 16777215: write a whole number from 0 to 16777214",
        "routing.ospf.areas.0.0.0.1.ranges[1].cost: a range with advertise false is announced at no cost. Remove cost",
        "routing.ospf.areas.0.0.0.4.virtual_links: a virtual link is part of the backbone. Move it to routing.ospf.areas.0.0.0.0",
    ]);

    // A device in one area is no border router, and the far end knows it by a router ID it writes.
    const { router_id: _routerId, ...unnamed } = router.routing ?? {};
    const inOneArea: Device = {
        ...router,
        routing: {
            ...unnamed,
            ospf: {
                areas: {
                    "0.0.0.0": { virtual_links: [{ transit_area_id: "0.0.0.1", router_id: "192.0.2.1" }], interfaces: {} },
                    "0.0.0.1": { interfaces: { servers: {} } },
                },
            },
        },
    };
    expect(messages(inOneArea).filter((message) => message.startsWith("routing.ospf"))).toEqual([
        `${where}: example-router is in one area only, so it is no border router, and a virtual link joins two border routers. Remove virtual_links, or write them on a border router`,
        `${where}: the far end knows this device by its router ID. Write routing.router_id, such as the loopback's address`,
    ]);
});

test("an AS number is a whole number from 0 to 4294967295, and a range starts before it ends", () => {
    const device: Device = {
        ...router,
        routing: {
            ...router.routing,
            policies: {
                ...router.routing?.policies,
                checked: [
                    { if: { first_as: -1, origin_as: [64501, { min: 65534, max: 64512 }], as_path_contains: 64500.5 }, then: "reject" },
                ],
            },
        },
    };

    expect(messages(device)).toEqual(
        expect.arrayContaining([
            "routing.policies.checked[0].if.first_as: -1 is no AS number; write 0 to 4294967295",
            "routing.policies.checked[0].if.origin_as: the range ends before it starts; write { min: 64512, max: 65534 }",
            "routing.policies.checked[0].if.as_path_contains: 64500.5 is no AS number; write 0 to 4294967295",
        ])
    );
});

test("logins through servers name one kind of server, at least one, each once, sending from an address of its own family", () => {
    const key = { secret: "AAA_KEY" };
    const withAaa = (aaa: NonNullable<Device["system"]>["aaa"]): Device => ({ ...router, system: { ...router.system, aaa } });
    const found = (device: Device) => messages(device).filter((message) => message.startsWith("system.aaa"));

    expect(found(withAaa({ tacacs: [{ address: "192.0.2.10", secret_key: key }], radius: [], remote_role: "admin" }))).toEqual([
        "system.aaa has both tacacs and radius: write one of them",
    ]);
    expect(found(withAaa({ radius: [], remote_role: "admin" }))).toEqual([
        "system.aaa has no server: write tacacs or radius, with at least one server",
    ]);

    const radius = [
        { address: "2001:db8::10", secret_key: key, source_address: "192.0.2.1" },
        { address: "2001:db8:0::10", secret_key: key },
        { address: "192.0.2.300", secret_key: key },
    ] as const;
    expect(found(withAaa({ radius, remote_role: "read-only" }))).toEqual([
        "system.aaa.radius[0].source_address 192.0.2.1 and address 2001:db8::10 differ in family",
        "system.aaa.radius[1]: 2001:db8:0::10 is listed twice",
        "system.aaa.radius[2].address: '192.0.2.300' is not an address",
    ]);
});

test("a pool's subscribers and blocks of ports fit, and two pools share no address unless they map alike", () => {
    const cgnat = {
        if: { src: "100.64.0.0/22" },
        then: "snat",
        to_pool: "198.51.100.0/27",
        port_allocation: "deterministic",
        port_set_size: 2016,
    } as const;
    const device: Device = {
        ...router,
        firewall: {
            nat: {
                source: [
                    cgnat,
                    { ...cgnat, if: { ...cgnat.if, protocol: "tcp" } },
                    { ...cgnat, port_set_size: 2100 },
                    { ...cgnat, if: { src: "100.64.4.0/22" }, to_pool: "198.51.100.32/28", port_set_size: 70_000 },
                    { ...cgnat, if: { src: "100.64.8.0/28" }, to_pool: "198.51.100.64/26" },
                    { ...cgnat, if: { src: "100.64.12.1/22" }, to_pool: "198.51.100.128/27" },
                    { ...cgnat, if: {}, to_pool: "198.51.100.160/27" },
                    { ...cgnat, if: { src: "100.64.16.0/22" }, to_pool: "198.51.100.16/28", port_set_size: 1000 },
                ],
                destination: [{ ...cgnat, description: "Inbound" }],
            },
        },
    };
    const found = messages(device).filter((message) => message.startsWith("firewall.nat"));

    expect(found).toEqual([
        "firewall.nat.destination, to_pool 198.51.100.0/27 (Inbound): a pool translates the source. Move the rule to firewall.nat.source.",
        "firewall.nat.source, to_pool 198.51.100.0/27: 32 subscribers on each pool address take 32 × 2100 = 67200 ports, more than the 64512 from 1024 to 65535. Write port_set_size: 2016 or less, or a to_pool of /26 or shorter.",
        "firewall.nat.source, to_pool 198.51.100.32/28: port_set_size 70000 is not a whole number from 1 to 64512",
        "firewall.nat.source, to_pool 198.51.100.64/26: the pool has more addresses than if.src 100.64.8.0/28 has subscribers. Write a to_pool of /28 or longer.",
        "firewall.nat.source, to_pool 198.51.100.128/27: if.src 100.64.12.1/22 has bits past its length: write 100.64.12.0/22",
        "firewall.nat.source, to_pool 198.51.100.160/27: write the subscribers' IPv4 prefix in if.src",
        "firewall.nat.source: to_pool 198.51.100.0/27 for 100.64.0.0/22 and to_pool 198.51.100.16/28 for 100.64.16.0/22 share addresses, so two subscribers would get the same ports. Give each its own pool addresses.",
    ]);
});

test("a dynamic pool fits one subscriber's blocks on an address, and shares no address with another pool unless it is the same one", () => {
    const pba = {
        if: { src: "100.64.0.0/16" },
        then: "snat",
        to_pool: "198.51.100.0/27",
        port_allocation: "dynamic",
        port_set_size: 512,
        port_sets_per_subscriber: 4,
    } as const;
    const deterministic = { ...pba, port_allocation: "deterministic", port_sets_per_subscriber: undefined } as const;
    const device: Device = {
        ...router,
        firewall: {
            nat: {
                source: [
                    pba,
                    { ...pba, if: { src: "100.65.0.0/16" } },
                    { ...pba, port_set_size: 256 },
                    { ...pba, to_pool: "198.51.100.32/27", port_sets_per_subscriber: 200 },
                    { ...pba, to_pool: "198.51.100.64/27", port_set_size: 0.5 },
                    { ...pba, to_pool: "198.51.100.96/27", port_sets_per_subscriber: undefined } as unknown as NatRule,
                    { ...pba, to_pool: "198.51.100.128/27", port_allocation: "random" } as unknown as NatRule,
                    { ...deterministic, if: { src: "100.64.0.0/22" }, to_pool: "198.51.100.160/27", port_set_size: 2016 },
                    {
                        ...deterministic,
                        if: { src: "100.64.4.0/22" },
                        to_pool: "198.51.100.192/27",
                        port_set_size: 2016,
                        port_sets_per_subscriber: 4,
                    } as unknown as NatRule,
                ],
            },
        },
    };
    const found = messages(device).filter((message) => message.startsWith("firewall.nat"));

    expect(found).toEqual([
        "firewall.nat.source, to_pool 198.51.100.32/27: one subscriber's 200 blocks of 512 ports take 102400 ports, more than the 64512 from 1024 to 65535 on its pool address. Write port_sets_per_subscriber: 126 or less.",
        "firewall.nat.source, to_pool 198.51.100.64/27: port_set_size 0.5 is not a whole number from 1 to 64512",
        "firewall.nat.source, to_pool 198.51.100.96/27: write port_sets_per_subscriber, the most blocks one subscriber holds at once",
        'firewall.nat.source, to_pool 198.51.100.128/27: write port_allocation: "deterministic" or "dynamic", how each subscriber gets its ports',
        "firewall.nat.source, to_pool 198.51.100.192/27: a deterministic pool gives each subscriber one block. Remove port_sets_per_subscriber.",
        "firewall.nat.source: to_pool 198.51.100.0/27, dynamic, 4 × 512 ports and to_pool 198.51.100.0/27, dynamic, 4 × 256 ports share addresses, so two subscribers would get the same ports. Write the same port_set_size and port_sets_per_subscriber in both, or give each its own pool addresses.",
    ]);
});

test("an IPsec tunnel's endpoints are of one family, a cbc encryption takes integrity and a gcm one none, and a lifetime is whole seconds", () => {
    const device: Device = {
        ...router,
        interfaces: {
            ...router.interfaces,
            ipsec: {
                branch: {
                    local_address: "192.0.2.1",
                    remote_address: "2001:db8::2",
                    pre_shared_key: { secret: "IPSEC_KEY" },
                    ike: { encryption: "aes-256-cbc", prf: "hmac-sha2-256", dh_group: 14, lifetime: 0.5 },
                    esp: { encryption: "aes-256-gcm", integrity: "hmac-sha2-256-128", lifetime: 3600 },
                },
            },
        },
    };

    expect(messages(device)).toEqual(
        expect.arrayContaining([
            "interfaces.ipsec.branch: local_address 192.0.2.1 and remote_address 2001:db8::2 differ in family",
            'interfaces.ipsec.branch.ike has aes-256-cbc without integrity. Add integrity, such as "hmac-sha2-256-128"',
            "interfaces.ipsec.branch.ike.lifetime 0.5 is not a whole number of seconds above 0",
            "interfaces.ipsec.branch.esp.integrity: aes-256-gcm protects integrity itself. Remove integrity",
        ])
    );
});

test("an IPsec tunnel authenticates one way, with a certificate that has its key and a CA that has none, and checks liveness and sends NAT keepalives in whole numbers", () => {
    const tunnel = {
        local_address: "192.0.2.1",
        remote_address: "192.0.2.2",
        ike: { encryption: "aes-256-gcm", prf: "hmac-sha2-256", dh_group: 19, lifetime: 86400 },
        esp: { encryption: "aes-256-gcm", lifetime: 3600 },
    } as const;
    // A project's types refuse the first three; a file Circuit reads without them may still hold them.
    const loose = (value: object) => value as Ipsec;
    const device: Device = {
        ...router,
        system: {
            ...router.system,
            certificates: { ...router.system?.certificates, ca: { certificate_file: "platforms--example-router.web.pem" } },
        },
        interfaces: {
            ...router.interfaces,
            ipsec: {
                both: loose({ ...tunnel, pre_shared_key: { secret: "IPSEC_KEY" }, certificate: "web", ca_certificate: "ca" }),
                none: loose(tunnel),
                alone: loose({ ...tunnel, certificate: "web" }),
                swapped: {
                    ...tunnel,
                    certificate: "ca",
                    ca_certificate: "web",
                    liveness_check: { interval: 0, retries: 2.5 },
                    nat_keepalive: 0.5,
                },
            },
        },
    };

    expect(messages(device)).toEqual(
        expect.arrayContaining([
            "interfaces.ipsec.both: pre_shared_key and a certificate. Keep one: pre_shared_key, or certificate with ca_certificate",
            "interfaces.ipsec.none has no way to authenticate. Add pre_shared_key, or certificate with ca_certificate",
            "interfaces.ipsec.alone.certificate needs ca_certificate: the CA that signed the peer's certificate",
            "interfaces.ipsec.swapped.certificate ca has no private key to sign with. Add its private_key",
            "interfaces.ipsec.swapped.ca_certificate web has a private key: write the CA's certificate alone, which the device only trusts",
            "interfaces.ipsec.swapped.liveness_check.interval 0 is not a whole number of seconds above 0",
            "interfaces.ipsec.swapped.liveness_check.retries 2.5 is not a whole number above 0",
            "interfaces.ipsec.swapped.nat_keepalive 0.5 is not a whole number of seconds above 0",
        ])
    );
});
