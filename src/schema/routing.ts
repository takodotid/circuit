import type { Family, IP, Prefix, Secret } from "./common";

/** A route the device carries without learning it. */
export type StaticRoute<I extends string, F extends string> = {
    /** Destination. */
    prefix: Prefix;
    /** Next-hop address. */
    via?: IP;
    /** Next-hop interface, for a link without a next-hop address. */
    interface?: I;
    /** Discard matching traffic. The usual way to originate an aggregate. */
    blackhole?: true;
    /** Preference against other routes to the same prefix. Lower wins. 1 when absent. */
    distance?: number;
    /** The VRF the route belongs to. The default table when absent. */
    vrf?: F;
    /** Why the route exists. */
    description?: string;
};

/** Our side of the relationship, as RFC 9234 defines it. */
export type BgpRole = "provider" | "customer" | "peer" | "rs" | "rs-client";

/** Settings a BGP neighbor can state itself or take from its group. */
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
    /** Our role toward this neighbor, which lets both sides reject a leak. */
    local_role?: BgpRole;
    /** The neighbor is more than one hop away. */
    multihop?: boolean;
    /** TCP MD5 password shared with the neighbor. */
    password?: Secret;
    /** Close the session when the neighbor announces more prefixes than this. */
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

/** One BGP session. Settings it does not state come from its group. */
export type Neighbor<P extends string, G extends string> = NeighborSettings<P> & {
    /** The neighbor's address. */
    address: IP;
    /** Group whose settings this neighbor takes where it states none. */
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

/** OSPF, version 2 for IPv4 and version 3 for IPv6. */
export type Ospf<I extends string> = {
    /** Which versions run. IPv4 when absent. */
    families?: readonly Family[];
    /** Areas keyed by area ID, for example `0.0.0.0`, each with the interfaces in it. */
    areas: Record<string, { interfaces: Partial<Record<I, OspfInterface>> }>;
    /** Routes from other sources announced into OSPF. */
    redistribute?: readonly ("connected" | "static")[];
};

/** Routing on this device. */
export type Routing<P extends string, G extends string, I extends string, F extends string> = {
    /** Identifies this router to its neighbors. */
    router_id?: IP;
    /** Routes the device carries without learning them. */
    static?: readonly StaticRoute<I, F>[];
    /** BGP sessions and what they exchange. */
    bgp?: Bgp<P, G>;
    /** OSPF areas and interfaces. */
    ospf?: Ospf<I>;
    /** Validators answering route origin validation. */
    rpki?: readonly RpkiServer[];
};
