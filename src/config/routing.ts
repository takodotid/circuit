import type { Family, HostAddress, IP, IPv4, IPv6, Named, OneOrMore, Ordered, Prefix, Secret } from "./common";
import type { CommunitiesRule, NeighborCommunities } from "./communities";
import { ACTIONS, CALL_RULE, closest, COMMUNITIES_EXPORT, COMMUNITIES_IMPORT, ROUTE_MATCH, ROUTE_RULE, ROUTE_SET } from "./keys";
import type { AnyFacts, NetworkFacts } from "./network";

/** A route you write by hand, not one the device learns. `I` is the device's ports and interfaces, `F` its VRFs, `T` its tables. */
export type StaticRoute<I extends string, F extends string, T extends string> = {
    /** The destination prefix. */
    prefix: Prefix;
    /** Next-hop address, alone or with its length. A link-local next hop, in `fe80::/10`, needs `interface` too. */
    next_hop?: HostAddress;
    /** The port or interface to send the traffic out of. Alone, for a link without a next-hop address. With `next_hop`, the interface that reaches the next hop, such as `{ next_hop: "fe80::1", interface: "10g-1" }`. Some platforms refuse the two together: the feature matrix in the platforms reference says which. */
    interface?: I;
    /** Drop the traffic. This is the usual way to originate an aggregate in BGP. */
    blackhole?: true;
    /** Remove the route while BFD sees `next_hop` as down, and put it back once `next_hop` answers again. Needs `next_hop`. */
    bfd?: true;
    /** Preference against other routes to the same prefix, 1 to 255. Lower wins. 1 when absent. */
    distance?: number;
    /** The VRF the route is in, from `routing.vrfs`. A route has a `vrf` or a `routing_table`, not both. */
    vrf?: F;
    /** The table the route is in, from `routing.tables`, or `main`. The main table when absent. A route has a `vrf` or a `routing_table`, not both. */
    routing_table?: T | "main";
    /** Why the route exists. */
    description?: string;
};

/**
 * What a BGP neighbor is to us, with the roles of RFC 9234:
 *
 * - `provider`: a transit we buy from.
 * - `customer`: a network we sell transit to.
 * - `peer`: a network we exchange our own routes with.
 * - `rs`: an exchange's route server.
 * - `rs-client`: a network that uses our route server.
 */
export type BgpRole = "provider" | "customer" | "peer" | "rs" | "rs-client";

/** A prefix limit that does not keep the session closed: it opens again after a time, or it never closes. */
export type PrefixLimit =
    | {
          /** The most prefixes the neighbor may announce. */
          limit: number;
          /** Close the session, then open it again after this many seconds. */
          restart_after: number;
          warn_only?: never;
      }
    | {
          /** The most prefixes the neighbor may announce. */
          limit: number;
          /** Keep the session up and only log a message. */
          warn_only: true;
          restart_after?: never;
      };

/** What a BGP session carries: `ipv4` or `ipv6` routes, or the routes of VRFs with route targets, `vpnv4` (RFC 4364) or `vpnv6` (RFC 4659). `l2vpn-evpn` carries the EVPN routes of VXLAN segments (RFC 7432, RFC 8365). */
export type BgpFamily = Family | "vpnv4" | "vpnv6" | "l2vpn-evpn";

/** Settings a BGP neighbor can set itself or take from its group. `P` is the device's policies, `T` its tables, `F` its VRFs, `Net` what the network writes. */
export type NeighborSettings<P extends string, T extends string, F extends string = string, Net extends NetworkFacts = AnyFacts> = {
    /** The neighbor's AS. If it is our own AS, the session is internal (iBGP). */
    remote_as?: number;
    /** Who the neighbor is. */
    description?: string;
    /** Source address for the session, alone or with its length. The outgoing interface's address when absent. */
    local_address?: HostAddress;
    /** The policy for the routes we learn from this neighbor, from `routing.policies`. Nothing is accepted when absent. */
    import_policy?: P;
    /** The policy for the routes we announce to this neighbor, from `routing.policies`. Nothing is announced when absent. */
    export_policy?: P;
    /** What the neighbor is to us, such as `provider` for a transit. Both sides then reject a route leak, as RFC 9234 describes. */
    role?: BgpRole;
    /** The neighbor is more than one hop away. An eBGP neighbor on no network the device shares needs it, or its session never comes up. */
    multihop?: boolean;
    /** Send with TTL 255, and accept only BGP packets that arrive with TTL 255, so only from a directly connected neighbor (GTSM, RFC 5082). Not with `multihop`. */
    ttl_security?: boolean;
    /** This router is a route reflector, and the neighbor is its client: the router passes on to it the routes it learns from its other iBGP neighbors (RFC 4456). For iBGP neighbors only. */
    route_reflector_client?: boolean;
    /** Announce a default route to the neighbor, in each address family the session carries, even when this device has none. The export policy does not apply to it. */
    send_default_route?: boolean;
    /** TCP MD5 password shared with the neighbor. */
    password?: Secret;
    /** Close the session if the neighbor announces more prefixes than this. It stays closed until you clear it by hand. On RouterOS, use `/routing bgp session clear <session> flag=limit-exceeded`. Write `{ limit, restart_after }` to open it again after that many seconds, or `{ limit, warn_only: true }` to only log a message. */
    max_prefixes?: number | PrefixLimit;
    /** Seconds without a message before the session goes down, 3 or more. */
    hold_time?: number;
    /** Seconds between keepalive messages. */
    keepalive?: number;
    /**
     * The address families the session carries. The family of the neighbor's address when absent. `vpnv4` and `vpnv6` carry the routes of each VRF with `route_targets` to another PE, and bring back the far VRFs' routes. Write them on an iBGP session from this router's LSR ID, `local_address`, to the far PE's, with `routing.mpls`: the routes' traffic crosses the core by label. Route targets pick the VPN routes a VRF takes, so `import_policy` and `export_policy` apply to `ipv4` and `ipv6` routes only.
     *
     * `l2vpn-evpn` carries the EVPN routes of each VXLAN with `evpn` to another VTEP, and brings back the far VTEPs' routes. Write it on an iBGP session from the VXLANs' `local_address` to the far VTEP's. Route targets pick these routes too.
     */
    address_families?: readonly BgpFamily[];
    /** Wait for the neighbor to connect instead of connecting to it. */
    passive?: boolean;
    /** Detect a dead link in under a second with BFD. */
    bfd?: boolean;
    /** Graceful restart (RFC 4724): while BGP restarts on one side, the other side keeps its routes and traffic keeps flowing. */
    graceful_restart?: boolean;
    /** The table for the routes learned from this neighbor, from `routing.tables`, or `main`. The main table when absent. On RouterOS, the session also announces from that table, so each prefix of `originated_prefixes` it announces needs a route in that table too. A running session uses a new table only after it restarts. */
    routing_table?: T | "main";
    /** The VRF the session runs in, from `routing.vrfs`. The device reaches the neighbor through the VRF's interfaces and puts the routes it learns in the VRF. The session announces only routes the VRF holds, so each prefix of `originated_prefixes` it announces needs a route in the VRF. A neighbor has a `vrf` or a `routing_table`, not both. */
    vrf?: F;
    /**
     * Its groups in the network's `communities`, and its own blackhole community, such as `{ groups: ["transit"], blackhole: "64501:666" }`. Circuit uses them to write the `{ communities }` rules of its policies. Allowed only when the network writes `communities`.
     */
    communities?: Net["communities"] extends true ? NeighborCommunities<Net["groups"]> : "allowed only when circuit.ts writes communities";
};

/** One BGP session. Any setting it leaves out comes from its neighbor group. */
export type Neighbor<
    P extends string,
    G extends string,
    T extends string,
    F extends string = string,
    Net extends NetworkFacts = AnyFacts,
> = NeighborSettings<P, T, F, Net> & {
    /** The neighbor's address. */
    address: IP;
    /** Its neighbor group, from `routing.bgp.neighbor_groups`. The neighbor takes any setting it leaves out from this group. */
    neighbor_group?: G;
};

/** A prefix BGP announces in place of the more specific routes inside it (RFC 4271). */
export type BgpAggregate = {
    /** The aggregate. BGP announces it while it holds a more specific route inside it, learned from a neighbor or in `originated_prefixes`. Like any route, it reaches only the neighbors whose export policy accepts it. Traffic to an address inside it that no more specific route covers is dropped. */
    prefix: Prefix;
    /** Announce the aggregate alone, and none of the more specific routes inside it. */
    summary_only?: true;
};

/** A BGP confederation (RFC 5065): one AS to the outside, made of member ASes that each run their own iBGP. */
export type BgpConfederation = {
    /** The AS the confederation shows to every neighbor outside it, usually the network's `asn`. */
    identifier: number;
    /** The other member ASes, not this router's own. A neighbor whose `remote_as` is one of them is in the confederation, and the router shows it `routing.bgp.asn`. An empty list when the router has no neighbor in another member AS. */
    member_as: readonly number[];
};

/** BGP on this device. `G` is the device's neighbor groups. */
export type Bgp<P extends string, G extends string, T extends string, F extends string = string, Net extends NetworkFacts = AnyFacts> = {
    /** Our AS number. The network's `asn` when absent. In a confederation, this router's member AS. */
    asn?: number;
    /** This router's AS is a member AS of a confederation, such as `{ identifier: 64500, member_as: [65002, 65003] }`. */
    confederation?: BgpConfederation;
    /** The cluster ID of this route reflector (RFC 4456). Reflectors that serve the same clients share one. The router ID when absent. Junos needs it for `route_reflector_client`. */
    cluster_id?: IPv4;
    /** Prefixes this device originates. Each needs a route, such as a static blackhole route. The export policies still decide who gets them. */
    originated_prefixes?: readonly Prefix[];
    /** Aggregates BGP announces, such as `{ prefix: "198.51.100.0/24", summary_only: true }`. */
    aggregates?: readonly BgpAggregate[];
    /** Settings shared by several neighbors, keyed by group name. */
    neighbor_groups?: Named<G, NeighborSettings<P, T, F, Net>>;
    /** BGP sessions, keyed by name. */
    neighbors?: Record<string, Neighbor<P, NoInfer<G>, T, F, Net>>;
};

/** How fast BFD notices a dead neighbor. The neighbor is down after `multiplier` packets in a row are missed, so after `interval` times `multiplier` milliseconds. */
export type Bfd = {
    /** Milliseconds between the packets this device sends. It is also the shortest gap it asks the neighbor to use. */
    interval: number;
    /** How many packets in a row may be missed before the neighbor is down. */
    multiplier: number;
};

/** A route origin validation server, RFC 8210. */
export type RpkiServer = {
    /** Where the validator listens. */
    address: IP;
    /** Its RTR port, often 323 or 8282. */
    port: number;
    /** Who runs it, or why it is here. */
    description?: string;
};

/** How OSPFv2 packets on a link are signed. Every router on the link uses the same algorithm, key ID, and key. */
export type OspfAuthentication = {
    /** `md5` (RFC 2328), or HMAC-SHA (RFC 5709). */
    algorithm: "md5" | "hmac-sha-1" | "hmac-sha-256" | "hmac-sha-384" | "hmac-sha-512";
    /** The key's ID, 0 to 255. */
    key_id: number;
    /** The key. With `md5`, 16 characters at most (RFC 2328). */
    key: Secret;
};

/** OSPF on one interface. */
export type OspfInterface = {
    /** Cost of sending through this interface, 1 to 65535. Lower is preferred. Derived from speed when absent. */
    cost?: number;
    /** Advertise the interface's network but form no adjacency on it. */
    passive?: boolean;
    /**
     * The OSPF network type of the link (RFC 2328). `broadcast` when absent. On `broadcast` and `non-broadcast`, the routers elect a designated router (DR). `point-to-multipoint` treats the link as a point-to-point link to each neighbor, with no DR, as on a radio link where not every router hears the others. `non-broadcast` (NBMA) is a link that carries no multicast, so it needs `neighbors`. These two are OSPFv2 only.
     */
    network?: "broadcast" | "point-to-point" | "point-to-multipoint" | "non-broadcast";
    /** The address on this link of each OSPF neighbor, for a link that carries no multicast: the device sends its hellos to each address. With `network` `non-broadcast`, or `point-to-multipoint`, which without them finds its neighbors by multicast. */
    neighbors?: readonly IPv4[];
    /** This device's priority, 0 to 255, in the election of the link's designated router (DR) and its backup (RFC 2328, section 9.4). The highest wins, and 0 never becomes either. On `broadcast` and `non-broadcast` links. The platform's own when absent: 128 on RouterOS. */
    priority?: number;
    /** Seconds between hello packets, 1 to 65535. Every router on the link uses the same. 10 when absent. */
    hello_interval?: number;
    /** Seconds without a hello before a neighbor is down, more than `hello_interval` and up to 65535. Every router on the link uses the same. 40 when both are absent; write it with `hello_interval`, since platforms differ without it. */
    dead_interval?: number;
    /** Sign every packet, so the device ignores a router without the key. OSPFv2 only. */
    authentication?: OspfAuthentication;
    /** Detect a dead neighbor in under a second with BFD. */
    bfd?: boolean;
};

/** An OSPF area ID, four numbers with dots between them, for example `0.0.0.0` for the backbone. */
export type OspfAreaId = `${number}.${number}.${number}.${number}`;

/** Addresses of an area that its border router (ABR) announces to the other areas as one route (RFC 2328, section 3.5). */
export type OspfRange = {
    /** The range, such as `10.1.0.0/16`. The area's networks inside it are not announced one by one. */
    prefix: Prefix;
    /** `true` announces the range as one route, while the area has a network inside it. `false` announces nothing of it, so the other areas don't reach those networks. */
    advertise: boolean;
    /** The cost the range is announced with, 0 to 16777214. Without it, the largest cost of the area's networks inside the range (RFC 2328, section 12.4.3). Only with `advertise` `true`. */
    cost?: number;
};

/** A virtual link to another border router (ABR), across an area both are in, that joins this device to the backbone (RFC 2328, section 15). Both ends write one, each with the other's router ID. */
export type OspfVirtualLink = {
    /** The area the link crosses, which this device has interfaces in. Not the backbone, and not a stub area or an NSSA. */
    transit_area_id: OspfAreaId;
    /** The router ID of the border router at the far end. */
    router_id: IPv4;
};

/** One OSPF area of the device. */
export type OspfArea<I extends string> = {
    /** `stub` takes no external routes, those redistributed into OSPF (RFC 2328). `nssa` takes none from other areas, but may redistribute its own (RFC 3101). A normal area when absent. Not on the backbone, `0.0.0.0`. */
    type?: "stub" | "nssa";
    /** Announce no routes from other areas into the area, only a default route: a totally stubby area, or a totally NSSA. Only with `type`. */
    no_summaries?: boolean;
    /** The cost, 1 to 16777214, of the default route this device announces into the area as its border router (ABR). Only with `type`. Without it, RouterOS and Junos announce no default route. */
    stub_default_cost?: number;
    /** What this device, as the area's border router (ABR), announces to the other areas in place of the area's networks, each range once. */
    ranges?: readonly OspfRange[];
    /** In the backbone, `0.0.0.0`, only: links across another area to border routers in the backbone, for each OSPF version the device runs. For a border router with no link into the backbone, or a backbone cut in two. The device needs `routing.router_id`. */
    virtual_links?: readonly OspfVirtualLink[];
    /** The device's ports and interfaces in this area, each with its OSPF settings. */
    interfaces: Named<I, OspfInterface>;
};

/** OSPF, version 2 for IPv4 and version 3 for IPv6. `F` is the device's VRFs. */
export type Ospf<I extends string, F extends string = string> = {
    /** Which versions run: `ipv4` for OSPFv2, `ipv6` for OSPFv3. `ipv4` when absent. */
    address_families?: readonly Family[];
    /** The VRF OSPF runs in, from `routing.vrfs`. Each of its interfaces routes in that VRF, and the routes it learns go there. The main table when absent. */
    vrf?: F;
    /** Areas keyed by area ID, for example `0.0.0.0`, each with the interfaces in it. */
    areas: Record<OspfAreaId, OspfArea<I>>;
    /** Routes from other sources announced into OSPF. */
    redistribute?: readonly ("connected" | "static")[];
};

/** An IS-IS network entity title: the area, the system ID of three groups, and `00`. */
export type IsisNet = `${string}.${string}.${string}.${string}.00`;

/** IS-IS on one interface. */
export type IsisInterface = {
    /** Cost of sending through this interface, 1 to 16777214, at each level the device runs, for IPv4 and IPv6 alike. Lower is preferred. The platform's own when absent, usually 10. */
    metric?: number;
    /** Advertise the interface's networks but form no adjacency on it. */
    passive?: boolean;
    /** The link type. `broadcast` when absent. On `point-to-point`, no designated router is elected. */
    network?: "broadcast" | "point-to-point";
    /** Detect a dead neighbor in under a second with BFD. */
    bfd?: boolean;
};

/**
 * How IS-IS packets are signed, with OpenConfig's key chain names. The device ignores a router without the key. Every router at the level uses the same algorithm, key ID, and key: in its area at level 1, across areas at level 2.
 */
export type IsisAuthentication =
    | {
          /** HMAC-MD5 (RFC 5304). */
          algorithm: "hmac-md5";
          /** The key, 35 characters at most on FortiOS. */
          key: Secret;
          key_id?: never;
      }
    | {
          /** HMAC-SHA (RFC 5310). */
          algorithm: "hmac-sha-1" | "hmac-sha-256" | "hmac-sha-384" | "hmac-sha-512";
          /** The key's ID, 0 to 65535, which each packet carries so the receiver knows the key (RFC 5310). 0 to 63 on Junos. */
          key_id: number;
          /** The key. */
          key: Secret;
      };

/** IS-IS settings of one level. */
export type IsisLevel = {
    /** Sign the level's hellos, LSPs, and sequence number packets. */
    authentication?: IsisAuthentication;
};

/** Which level 2 routes a router on both levels leaks into level 1 (RFC 5302). `P` is the device's policies. */
export type IsisLevel2ToLevel1<P extends string> = {
    /** The policy that picks them, from `routing.policies`. It sees each route's prefix, and the routes it accepts go into level 1, marked with the up/down bit so they never go back up. Its rules, and those of policies it calls, match `family`, `prefix`, `prefix_set`, and `prefix_length`, and set nothing. */
    import_policy: P;
};

/** IS-IS (ISO/IEC 10589, RFC 1195), with wide metrics (RFC 5305). `P` is the device's policies. */
export type Isis<I extends string, P extends string = string> = {
    /** The device's network entity title (NET): its area, its system ID, and `00`, such as `49.0001.0102.5500.1001.00`. No two devices share a system ID. */
    net: IsisNet;
    /** The levels the device runs: `level-1` inside its area, `level-2` between areas, or `level-1-2` for both. */
    level_capability: "level-1" | "level-2" | "level-1-2";
    /** What IS-IS routes: `ipv4`, `ipv6`, or both. Both share one topology (RFC 5308), so each link between IS-IS routers needs both, unless `multi_topology` is on. */
    address_families: readonly Family[];
    /** Route IPv6 in a topology of its own (RFC 5120, MT ID 2). IPv6 then takes only links that run it. A router that routes IPv4 alone still forms adjacencies. Every router that routes IPv6 in IS-IS needs it too. Needs `ipv6` in `address_families`. */
    multi_topology?: boolean;
    /** Sign every IS-IS packet with one key, at each level the device runs. For a key per level, write it in `levels` instead. */
    authentication?: IsisAuthentication;
    /** Settings of level 1 or level 2, such as `{ 2: { authentication: { algorithm: "hmac-md5", key: secret("ISIS_L2_KEY") } } }`. Only levels the device runs. */
    levels?: { 1?: IsisLevel; 2?: IsisLevel };
    /** The device's ports and interfaces that run IS-IS, each with its settings. */
    interfaces: Named<I, IsisInterface>;
    /** Set the overload bit in the device's LSPs (ISO/IEC 10589). Other routers stop routing through the device, and still reach its own networks: for a router drained for maintenance, or a route reflector out of the traffic's path. */
    overload_bit?: boolean;
    /**
     * Leak level 2 routes into level 1 (RFC 5302), such as `{ import_policy: "loopbacks" }`. The routers of the area then take the nearest way out to them, not the default route to the nearest router on both levels. Only with `level_capability: "level-1-2"`. Without it, no level 2 route goes into level 1.
     */
    level2_to_level1?: IsisLevel2ToLevel1<P>;
};

/** LDP's label policies for one neighbor. `P` is the device's policies. */
export type LdpNeighbor<P extends string = string> = {
    /** The policy for the labels the device takes from this neighbor, from `routing.policies`, in place of `routing.mpls.ldp.import_policy`. Its rules match as that policy's do. */
    import_policy?: P;
    /** The policy for the labels the device gives this neighbor, from `routing.policies`, in place of `routing.mpls.ldp.export_policy`. Its rules match as that policy's do. */
    export_policy?: P;
};

/** LDP (RFC 5036): the device gives a label to each route of its IGP and tells its LDP neighbors. `P` is the device's policies. */
export type Ldp<I extends string, P extends string = string> = {
    /** The device's LSR ID, which other LDP routers know it by. LDP sessions run between LSR IDs, so it is the address of a loopback that OSPF or IS-IS announces. */
    lsr_id: IPv4;
    /**
     * What LDP gives labels to: routes to IPv4 prefixes, `ipv4`, and with `ipv6`, routes to IPv6 prefixes too (RFC 7552), such as `["ipv4", "ipv6"]`. `ipv4` when absent. With both, each LDP neighbor that runs both holds one session with the device, over IPv6, for the labels of both. Needs `ipv6_transport_address` with `ipv6`.
     */
    address_families?: readonly Family[];
    /** The IPv6 address LDP runs its IPv6 sessions from, such as `2001:db8:ffff::1`: an IPv6 address of a loopback that OSPFv3 or IS-IS announces. LDP has no IPv6 LSR ID to take it from. Its IPv4 sessions run from `lsr_id`. With `ipv6` in `address_families` only. */
    ipv6_transport_address?: IPv6;
    /**
     * With a neighbor that runs LDP for both families, hold the session over IPv4, between LSR IDs, not over IPv6 (RFC 7552, section 6.1.1). Targeted sessions and pseudowires to an LSR ID need it. Write it on every LDP router the device holds a session with: RFC 7552 keeps a session down when the two ends prefer other families. Over IPv6 when absent. With `ipv6` in `address_families` only.
     */
    prefer_ipv4_transport?: true;
    /** The ports and interfaces that forward MPLS and run LDP, each toward another LDP router. */
    interfaces: readonly I[];
    /**
     * Targeted LDP (RFC 5036, section 2.4.2): the LSR IDs of LDP routers to hold a session with across the core, such as a PE at another site. Write a target back at the far router, or it may ignore this one. A pseudowire sets up its own session to its peer, so it needs none here.
     */
    targets?: readonly IPv4[];
    /** The policy for the labels the device takes from its LDP neighbors, from `routing.policies`. It sees the prefix of each label, and the device keeps the labels it accepts. Its rules match `family`, `prefix`, `prefix_set`, and `prefix_length` only, and set nothing. Every label when absent. */
    import_policy?: P;
    /** The policy for the labels the device gives its LDP neighbors, from `routing.policies`, such as for its loopbacks only. It sees the prefix of each route LDP labels, and the device tells its neighbors the labels it accepts. Its rules match as `import_policy`'s do. Every label when absent. */
    export_policy?: P;
    /** Label policies for some LDP neighbors, each by its LSR ID, such as `{ "192.0.2.3": { import_policy: "its-loopback" } }`. A neighbor's policy takes the place of `import_policy` or `export_policy` for its labels alone. */
    neighbors?: Readonly<Record<IPv4, LdpNeighbor<P>>>;
};

/** MPLS (RFC 3031): packets cross the network by their labels. */
export type Mpls<I extends string, P extends string = string> = {
    /** LDP gives the labels. */
    ldp: Ldp<I, P>;
};

/** A routing table beside the main one. It holds no interfaces. Routes go into it from static routes and BGP neighbors that give it in `routing_table`. `routing.policy_routing` sends traffic to it. */
export type RoutingTable = {
    /** What the table is for. */
    description?: string;
};

/**
 * A route distinguisher (RFC 4364, section 4.2): an AS number and a number, `64500:101`, or an IPv4 address and a number, `192.0.2.1:101`. With an AS up to 65535, the number goes up to 4294967295; with a larger AS or an address, up to 65535.
 */
export type RouteDistinguisher = `${number}:${number}` | `${IPv4}:${number}`;

/** A route target, an extended community (RFC 4360, RFC 5668), written as a route distinguisher is: `64500:101`, or `192.0.2.1:101`. */
export type RouteTarget = `${number}:${number}` | `${IPv4}:${number}`;

/** Which VPN routes a VRF or an EVPN segment takes, and what its own carry. */
export type VrfRouteTargets = {
    /** It takes each VPN route that carries any of these. */
    import?: readonly RouteTarget[];
    /** Its own routes carry these. */
    export?: readonly RouteTarget[];
};

/** A separate routing table, with the interfaces that route in it. `P` is the device's policies. */
export type Vrf<P extends string = string> = {
    /** What the VRF is for. */
    description?: string;
    /** Keeps the VRF's routes apart from another VRF's with the same prefix among VPN routes, such as `64500:101`. Each VRF of the device has its own. Needed with `route_targets`. */
    route_distinguisher?: RouteDistinguisher;
    /**
     * Makes the VRF part of an L3VPN (RFC 4364), such as `{ import: ["64500:101"], export: ["64500:101"] }`. Every route the VRF holds, connected, static, or learned from its OSPF or BGP, goes to the BGP neighbors that carry `vpnv4` or `vpnv6` with the `export` targets. `export_policy` keeps back those it rejects. The VRF takes the VPN routes that carry an `import` target, but those `import_policy` rejects. Needs `route_distinguisher`.
     */
    route_targets?: VrfRouteTargets;
    /** The policy for the VPN routes the VRF takes, from `routing.policies`, so it takes only some of the routes with its `import` targets. It sees each VPN route that carries one, and the VRF takes those it accepts. Needs `route_targets.import`. */
    import_policy?: P;
    /** The policy for the VRF's own routes that go out as VPN routes, from `routing.policies`. It sees every route the VRF holds, and those it accepts go out with the `export` targets. Needs `route_targets.export`. */
    export_policy?: P;
};

/** Routes one table takes from another, through a policy. `F` is the device's VRFs, `P` its policies. */
export type VrfImport<F extends string, P extends string> = {
    /** Where the routes come from: a VRF of `routing.vrfs`, or `main`. */
    from: F | "main";
    /** Where they go: a VRF of `routing.vrfs`, or `main`. */
    to: F | "main";
    /** The policy that picks the routes `to` takes, from `routing.policies`. It sees every route `from` holds: connected, static, and learned. Traffic routed by a route taken this way leaves through the interfaces of `from`. */
    policy: P;
};

/** The traffic a policy routing rule matches. All conditions must be true. Every packet when absent. */
export type RoutingRuleMatch<I extends string> = {
    /** Source prefix. */
    src?: Prefix;
    /** Destination prefix. */
    dst?: Prefix;
    /** The port or interface the traffic arrives on. */
    in_interface?: I;
};

/** One policy routing rule. The traffic it matches is routed by `routing_table` instead of the main table. */
export type RoutingRule<I extends string, T extends string> = {
    /** Why the rule exists. */
    description?: string;
    /** What the traffic must match. Every packet when absent, so a rule without it comes last. */
    match?: RoutingRuleMatch<I>;
    /** The table that routes the traffic, from `routing.tables`, or `main`. Always needed, because choosing it is what the rule is for. */
    routing_table: T | "main";
    /** What happens when `routing_table` has no route for a packet. `none` drops it as unroutable. `main` routes it by the main table instead. `none` when absent. Not for a rule whose table is `main`. */
    fallback?: "none" | "main";
};

/** A standard BGP community, `asn:value`, for example `64500:100`. Each part is 0 to 65535. */
export type StandardCommunity = `${number}:${number}`;

/** A large BGP community, `asn:function:parameter`, for example `64500:1:6939`. Each part is 0 to 4294967295. */
export type LargeCommunity = `${number}:${number}:${number}`;

/** A standard community to remove. `*` stands for any value of a part, as in `64500:*`. */
export type StandardCommunityPattern = `${number | "*"}:${number | "*"}`;

/** A large community to remove. `*` stands for any value of a part, as in `64500:*:*`. */
export type LargeCommunityPattern = `${number | "*"}:${number | "*"}:${number | "*"}`;

/** AS numbers from `min` to `max`, both included. */
export type AsRange = {
    /** The first AS number, 0 to 4294967295. */
    min: number;
    /** The last AS number, 0 to 4294967295, not below `min`. */
    max: number;
};

/** An AS number, a range of AS numbers, or any of several. */
export type AsNumbers = number | AsRange | readonly (number | AsRange)[];

/**
 * A list of prefixes, written here or fetched from a registry. `circuit diff` and `circuit apply` fetch them each time, and the plan adds and removes them one by one, like any list. `circuit validate` and Studio don't fetch them.
 */
export type PrefixSet =
    | {
          /** The prefixes, of either family or both. Write a list, or a map of named prefixes whose values are all used. If the platform keeps one list per family, Circuit writes one list for each. */
          prefixes: readonly Prefix[] | Readonly<Record<string, Prefix>>;
      }
    | {
          /** Where `diff` and `apply` fetch the prefixes from. If the answer is empty, or has more than 100,000 prefixes, Circuit stops before it sends anything. */
          source: {
              /** The registry they come from. */
              registry: "ripe-stat";
              /** What to ask for, for example `AS64501`. */
              query: string;
              /** Which family to keep. */
              family: Family;
          };
      };

/** Conditions on a route. All must be true. An empty match is true for every route. `S` is the device's prefix sets. */
export type RouteMatch<S extends string> = {
    /** Only routes of this family. */
    family?: Family;
    /** Exactly this prefix. */
    prefix?: Prefix;
    /** The route's prefix is one of this set's prefixes, or a more specific prefix inside one, from `routing.prefix_sets`. A set that holds `10.0.0.0/8` also matches `10.1.0.0/16`. */
    prefix_set?: S;
    /** The prefix length is within this range, both ends included, 0 to 128. */
    prefix_length?: {
        /** The shortest length. */
        min?: number;
        /** The longest length. */
        max?: number;
    };
    /** The AS path length is within this range, both ends included. Every AS counts, prepends too. */
    as_path_length?: {
        /** The shortest path. */
        min?: number;
        /** The longest path. */
        max?: number;
    };
    /** The AS path has one of these ASes anywhere, so the route came from it or through it, such as `presets.bogon_asns`. */
    as_path_contains?: AsNumbers;
    /** The first AS of the path is one of these: the neighbor that sent the route. */
    first_as?: AsNumbers;
    /** The last AS of the path is one of these: the AS that originated the route (RFC 6811). */
    origin_as?: AsNumbers;
    /** The route's RPKI origin validation state. */
    rpki?: "valid" | "invalid" | "not-found";
    /** The route has this standard community, `asn:value`, or any of several. A part may be `*`, as in `64500:*`. */
    standard_community?: OneOrMore<StandardCommunityPattern>;
    /** The route has this large community, `asn:function:parameter`, or any of several. A part may be `*`, as in `64500:1:*`. */
    large_community?: OneOrMore<LargeCommunityPattern>;
};

/** Changes to a route. In community lists to remove, `*` stands for any value of a part, as in `64500:*:*`. */
export type RouteSet = {
    /** Preference among routes to the same prefix within our AS. Higher wins. */
    local_pref?: number;
    /** The multi-exit discriminator (MED) sent to the neighbor. Lower wins. */
    med?: number;
    /** Prepend our own AS this many times, 1 to 16, to make the path look longer. */
    prepend?: number;
    /** Replace the route's standard communities with these. */
    standard_communities?: readonly StandardCommunity[];
    /** Add these standard communities. */
    add_standard_communities?: readonly StandardCommunity[];
    /** Remove standard communities matching these. A part may be `*`. */
    remove_standard_communities?: readonly StandardCommunityPattern[];
    /** Replace the route's large communities with these. */
    large_communities?: readonly LargeCommunity[];
    /** Add these large communities. */
    add_large_communities?: readonly LargeCommunity[];
    /** Remove large communities matching these. A part may be `*`. */
    remove_large_communities?: readonly LargeCommunityPattern[];
    /** Next hop for the route. */
    next_hop?: IP;
    /** The source address for traffic the device itself sends along the route, alone or with its length. It applies only to routes of the address's family. */
    preferred_source?: HostAddress;
    /** Drop traffic to the route on this device, instead of forwarding it. */
    blackhole?: true;
};

/** A route policy rule that runs another policy, and holds nothing else: `{ call: "exchange-import" }`. */
export type CallRule<P extends string> = {
    /** The policy to run here, from `routing.policies`. A route it accepts or rejects stops there. Any other route goes on to the next rule, with the changes it made. To call it for some routes only, put the condition inside that policy. */
    call: P;
    /** A call rule holds nothing else. */
    communities?: never;
};

/** A route policy rule: which routes (`if`), what to change (`set`), and what happens next (`then`). It has `then`, `set`, or both. */
export type RouteRule<S extends string> = {
    /** Shown beside the rule on the device. */
    description?: string;
    /** Which routes the rule applies to. Every route when absent. */
    if?: RouteMatch<S>;
    /** What to change on a route that matches. Without `then`, the route goes on to the next rule, changed. */
    set?: RouteSet;
    /** What happens to a matching route, after `set`. It is accepted or rejected, and the policy ends for it. Without `then`, the route goes on to the next rule. */
    then?: "accept" | "reject";
    /** A rule that calls another policy holds nothing else. */
    call?: never;
    /** A communities rule holds nothing else. */
    communities?: never;
};

/**
 * One step of a route policy, written as plain data, with the condition first:
 *
 * - `{ if: { prefix_set: "bogons" }, then: "reject" }` rejects the routes that match. Without `if`, a rule applies to every route: `{ then: "accept" }`.
 * - `{ if: { prefix: "0.0.0.0/0" }, set: { local_pref: 110 }, then: "accept" }` changes them, then accepts them.
 * - `{ if: { ... }, set: { local_pref: 300 } }` changes them and goes on to the next rule.
 * - `{ call: "other-policy" }` runs one of `routing.policies`, and holds nothing else.
 * - `{ communities: "import" }` or `{ communities: "export" }` stands for the rules the network's `communities` mean here. Circuit writes them for the neighbors that use the policy. Allowed only when the network writes `communities`.
 */
export type PolicyRule<P extends string, S extends string, Net extends NetworkFacts = AnyFacts> =
    | CallRule<P>
    | RouteRule<S>
    | (Net["communities"] extends true
          ? CommunitiesRule<Net["requests"]>
          : { communities: "allowed only when circuit.ts writes communities" });

/** What a route policy rule, its `if`, and its `set` may hold at run time, from keys.ts, which the types above check. */
const RULE_KEYS = Object.keys(ROUTE_RULE);
const MATCH_KEYS = Object.keys(ROUTE_MATCH);
const SET_KEYS = Object.keys(ROUTE_SET);
const COMMUNITIES_RULE: Record<string, string[]> = {
    import: Object.keys(COMMUNITIES_IMPORT).filter((k) => k !== "communities"),
    export: Object.keys(COMMUNITIES_EXPORT).filter((k) => k !== "communities"),
};

/** Keys of `written` not in `takes`, each with "did you mean" where one is close: `protocl (did you mean protocol?)`. */
const wrongKeys = (written: string[], takes: string[]) =>
    written
        .filter((k) => !takes.includes(k))
        .map((k) => {
            const hint = closest(k, takes);
            return hint ? `${k} (did you mean ${hint}?)` : k;
        });

/** What is wrong with a route policy rule as written, or nothing. */
export function policyRuleProblem(rule: unknown): string | undefined {
    if (!rule || typeof rule !== "object" || Array.isArray(rule))
        return `${JSON.stringify(rule)} is no rule. A rule is { if, set, then }, or { call }.`;
    const r = rule as Record<string, unknown>;
    const keys = Object.keys(r);
    if ("communities" in r) {
        const takes = COMMUNITIES_RULE[r.communities as string];
        if (!takes) return `communities is import or export, not ${JSON.stringify(r.communities)}.`;
        const more = wrongKeys(
            keys.filter((k) => k !== "communities"),
            takes
        );
        return more.length
            ? `a communities ${r.communities as string} rule has no ${more.join(", ")}. It takes: ${takes.join(", ")}.`
            : undefined;
    }
    if ("call" in r) {
        if (typeof r.call !== "string") return "call takes the name of a policy.";
        const more = keys.filter((k) => !Object.hasOwn(CALL_RULE, k));
        return more.length ? `a call rule holds nothing else, but this one has ${more.join(", ")}.` : undefined;
    }
    const wrong = wrongKeys(keys, RULE_KEYS);
    if (wrong.length) return `a rule has no ${wrong.join(", ")}. It takes: ${RULE_KEYS.join(", ")}, or call alone.`;
    const then: readonly unknown[] = ACTIONS.policy;
    if (r.then !== undefined && !then.includes(r.then)) {
        const hint = typeof r.then === "string" ? closest(r.then, ACTIONS.policy) : undefined;
        return `then is accept or reject, not ${JSON.stringify(r.then)}.${hint ? ` Did you mean ${hint}?` : ""}`;
    }
    if (r.then === undefined && r.set === undefined) return "the rule does nothing: it needs then, set, or both.";
    const match = wrongKeys(Object.keys((r.if as object | undefined) ?? {}), MATCH_KEYS);
    if (match.length) return `if has no ${match.join(", ")}. It takes: ${MATCH_KEYS.join(", ")}.`;
    const set = wrongKeys(Object.keys((r.set as object | undefined) ?? {}), SET_KEYS);
    return set.length ? `set has no ${set.join(", ")}. It takes: ${SET_KEYS.join(", ")}.` : undefined;
}

/**
 * Where packets go. The type parameters are the names the device declares: `P` policies, `S` prefix sets, `G` neighbor groups, `T` tables, `F` VRFs; `I` is its ports and interfaces. `Part` is true in a part, where BGP holds only what the part adds. `Net` is what the network writes.
 */
export type Routing<
    P extends string,
    S extends string,
    G extends string,
    T extends string,
    F extends string,
    I extends string,
    Part extends boolean = false,
    Net extends NetworkFacts = AnyFacts,
> = {
    /** Identifies this router to its neighbors. */
    router_id?: IP;
    /** Routing tables beside the main one, keyed by name. A name can't be `main` or the name of a VRF. */
    tables?: Named<T, RoutingTable>;
    /** Separate routing tables with the interfaces that route in them, keyed by name. */
    vrfs?: Named<F, Vrf<NoInfer<P>>>;
    /** Routes a VRF or the main table takes from another, each through a policy. For example, a tenant's VRF takes the main table's default route, and main takes the tenant's prefixes. */
    vrf_imports?: readonly VrfImport<NoInfer<F>, NoInfer<P>>[];
    /** Rules in order that route the traffic they match by another table. For example, traffic from one address block can use its own transit's default route. The first rule that matches decides. The main table routes traffic that no rule matches. */
    policy_routing?: Ordered<RoutingRule<I, NoInfer<T>>>;
    /** Routes you write by hand. Their order doesn't matter. */
    static_routes?: readonly StaticRoute<I, NoInfer<F>, NoInfer<T>>[];
    /** BGP sessions and what they exchange. In a part, only what the part adds, such as its neighbor groups and neighbors. */
    bgp?: Part extends true ? Partial<Bgp<NoInfer<P>, G, NoInfer<T>, NoInfer<F>, Net>> : Bgp<NoInfer<P>, G, NoInfer<T>, NoInfer<F>, Net>;
    /** OSPF areas and interfaces, in the main table or in one VRF. */
    ospf?: Ospf<I, NoInfer<F>>;
    /** IS-IS, in the main table. */
    isis?: Isis<I, NoInfer<P>>;
    /** MPLS, in the main table, such as `{ ldp: { lsr_id: "192.0.2.1", interfaces: ["100g-1", "100g-2"] } }`. */
    mpls?: Mpls<I, NoInfer<P>>;
    /** BFD timers for every BFD session on the device: BGP, OSPF, IS-IS, and static routes. Both ends of a link should use the same timers. The platform's defaults when absent. Junos has no default, so there Circuit sends every 300 ms. */
    bfd?: Bfd;
    /** The RPKI validators the device asks for route origin validation. */
    rpki?: readonly RpkiServer[];
    /** Route policies, keyed by name. Each is a list of rules in order, written whole in one place. The first rule runs first, and a route that no rule accepts is rejected. */
    policies?: Named<P, Ordered<PolicyRule<NoInfer<P>, NoInfer<S>, Net>>>;
    /** Prefix sets that policies match on, keyed by name. */
    prefix_sets?: Named<S, PrefixSet>;
};
