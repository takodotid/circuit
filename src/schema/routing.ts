import type { Family, IP, Prefix, Secret } from "./common";

/** A route the device has without learning it. */
export type StaticRoute<I extends string, F extends string> = {
    /** Destination. */
    prefix: Prefix;
    /** Next-hop address. */
    via?: IP;
    /** Next-hop interface, for a link without a next-hop address. */
    interface?: I;
    /** Discard matching traffic. The usual way to originate an aggregate. */
    blackhole?: true;
    /** Withdraw the route while BFD finds `via` dead, and put it back once `via` answers again. Needs `via`. */
    bfd?: true;
    /** Preference against other routes to the same prefix. Lower wins. 1 when absent. */
    distance?: number;
    /** The VRF the route is in. The default table when absent. */
    vrf?: F;
    /** Why the route exists. */
    description?: string;
};

/**
 * What a BGP neighbor is to us, with the roles RFC 9234 defines: `provider`, a transit we buy from; `customer`, one we sell transit to; `peer`, one we exchange our own routes with; `rs`, an exchange's route server; `rs-client`, a network using our route server.
 */
export type BgpRole = "provider" | "customer" | "peer" | "rs" | "rs-client";

/** Settings a BGP neighbor can set itself or take from its group. */
export type NeighborSettings<P extends string> = {
    /** The neighbor's AS. Our own AS makes the session internal. */
    remote_as?: number;
    /** Who the neighbor is. */
    description?: string;
    /** Source address for the session. The outgoing interface's address when absent. */
    local_address?: IP;
    /** Policy for routes learned. Nothing is accepted when absent. */
    import?: P;
    /** Policy for routes announced. Nothing is announced when absent. */
    export?: P;
    /** What the neighbor is to us, such as `provider` for a transit. Both sides then reject a route leak, as RFC 9234 describes. */
    role?: BgpRole;
    /** The neighbor is more than one hop away. */
    multihop?: boolean;
    /** TCP MD5 password shared with the neighbor. */
    password?: Secret;
    /** Close the session when the neighbor announces more prefixes than this. It stays closed until cleared by hand, on RouterOS with `/routing bgp session clear <session> flag=limit-exceeded`. */
    max_prefixes?: number;
    /** Seconds without a message before the session is declared down. */
    hold_time?: number;
    /** Seconds between keepalive messages. */
    keepalive?: number;
    /** Families exchanged. The family of the neighbor's address when absent. */
    families?: readonly Family[];
    /** Wait for the neighbor to connect instead of connecting to it. */
    passive?: boolean;
    /** Detect a dead link in under a second with BFD. */
    bfd?: boolean;
};

/** One BGP session. Settings it does not set come from its group. */
export type Neighbor<P extends string, G extends string> = NeighborSettings<P> & {
    /** The neighbor's address. */
    address: IP;
    /** The group this neighbor takes a setting from when it does not set that setting itself. */
    group?: NoInfer<G>;
};

/** BGP on this device. */
export type Bgp<P extends string, G extends string> = {
    /** Our AS number. */
    asn: number;
    /** Prefixes this device originates. Each needs a route, for example a static blackhole. Export policy still decides who receives them. */
    networks?: readonly Prefix[];
    /** Settings shared by several neighbors, keyed by group name. */
    groups?: Record<G, NeighborSettings<P>>;
    /** Sessions keyed by name. */
    neighbors?: Record<string, Neighbor<P, G>>;
};

/** How fast BFD notices a dead neighbor: after `multiplier` packets in a row are missed, so in `interval` times `multiplier` milliseconds. */
export type Bfd = {
    /** Milliseconds between the packets this device sends, and the shortest gap it asks of the neighbor. */
    interval: number;
    /** How many packets in a row may be missed before the neighbor is declared down. */
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

/** OSPF on one interface. */
export type OspfInterface = {
    /** Cost of sending through this interface. Lower is preferred. Derived from speed when absent. */
    cost?: number;
    /** Advertise the interface's network but form no adjacency on it. */
    passive?: boolean;
    /** How the link is treated. Broadcast when absent. */
    network?: "broadcast" | "point-to-point";
    /** Detect a dead neighbor in under a second with BFD. */
    bfd?: boolean;
};

/** An OSPF area ID, written as four numbers with dots between them, for example `0.0.0.0` for the backbone. */
export type OspfAreaId = `${number}.${number}.${number}.${number}`;

/** OSPF, version 2 for IPv4 and version 3 for IPv6. */
export type Ospf<I extends string> = {
    /** Which versions run. IPv4 when absent. */
    families?: readonly Family[];
    /** Areas keyed by area ID, for example `0.0.0.0`, each with the interfaces in it. */
    areas: Record<OspfAreaId, { interfaces: Partial<Record<I, OspfInterface>> }>;
    /** Routes from other sources announced into OSPF. */
    redistribute?: readonly ("connected" | "static")[];
};

/** Routing on this device. */
export type Routing<P extends string, G extends string, I extends string, F extends string> = {
    /** Identifies this router to its neighbors. */
    router_id?: IP;
    /** Routes the device has without learning them. */
    static?: readonly StaticRoute<I, F>[];
    /** BGP sessions and what they exchange. */
    bgp?: Bgp<P, G>;
    /** OSPF areas and interfaces. */
    ospf?: Ospf<I>;
    /** Validators answering route origin validation. */
    rpki?: readonly RpkiServer[];
    /** BFD timers for every BFD session on the device: BGP, OSPF and static routes. The platform's own when absent; Junos has none, so Circuit sends every 300 ms there. Both ends of a link should agree. */
    bfd?: Bfd;
};
