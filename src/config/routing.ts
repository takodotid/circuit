import type { Family, HostAddress, IP, IPv4, Named, OneOrMore, Ordered, Prefix, Secret } from "./common";
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

/** Settings a BGP neighbor can set itself or take from its group. `P` is the device's policies, `T` its tables, `Net` what the network writes. */
export type NeighborSettings<P extends string, T extends string, Net extends NetworkFacts = AnyFacts> = {
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
    /** The neighbor is more than one hop away. */
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
    /** The address families the session carries. The family of the neighbor's address when absent. */
    address_families?: readonly Family[];
    /** Wait for the neighbor to connect instead of connecting to it. */
    passive?: boolean;
    /** Detect a dead link in under a second with BFD. */
    bfd?: boolean;
    /** Graceful restart (RFC 4724): while BGP restarts on one side, the other side keeps its routes and traffic keeps flowing. */
    graceful_restart?: boolean;
    /** The table for the routes learned from this neighbor, from `routing.tables`, or `main`. The main table when absent. On RouterOS, the session also announces from that table, so each prefix of `originated_prefixes` it announces needs a route in that table too. A running session uses a new table only after it restarts. */
    routing_table?: T | "main";
    /**
     * Its groups in the network's `communities`, and its own blackhole community, such as `{ groups: ["transit"], blackhole: "64501:666" }`. Circuit uses them to write the `{ communities }` rules of its policies. Allowed only when the network writes `communities`.
     */
    communities?: Net["communities"] extends true ? NeighborCommunities<Net["groups"]> : "allowed only when circuit.ts writes communities";
};

/** One BGP session. Any setting it leaves out comes from its neighbor group. */
export type Neighbor<P extends string, G extends string, T extends string, Net extends NetworkFacts = AnyFacts> = NeighborSettings<
    P,
    T,
    Net
> & {
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
export type Bgp<P extends string, G extends string, T extends string, Net extends NetworkFacts = AnyFacts> = {
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
    neighbor_groups?: Named<G, NeighborSettings<P, T, Net>>;
    /** BGP sessions, keyed by name. */
    neighbors?: Record<string, Neighbor<P, NoInfer<G>, T, Net>>;
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
    /** The OSPF network type of the link. `broadcast` when absent. */
    network?: "broadcast" | "point-to-point";
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

/** One OSPF area of the device. */
export type OspfArea<I extends string> = {
    /** `stub` takes no external routes, those redistributed into OSPF (RFC 2328). `nssa` takes none from other areas, but may redistribute its own (RFC 3101). A normal area when absent. Not on the backbone, `0.0.0.0`. */
    type?: "stub" | "nssa";
    /** Announce no routes from other areas into the area, only a default route: a totally stubby area, or a totally NSSA. Only with `type`. */
    no_summaries?: boolean;
    /** The cost, 1 to 16777214, of the default route this device announces into the area as its border router (ABR). Only with `type`. Without it, RouterOS and Junos announce no default route. */
    stub_default_cost?: number;
    /** The device's ports and interfaces in this area, each with its OSPF settings. */
    interfaces: Named<I, OspfInterface>;
};

/** OSPF, version 2 for IPv4 and version 3 for IPv6. */
export type Ospf<I extends string> = {
    /** Which versions run: `ipv4` for OSPFv2, `ipv6` for OSPFv3. `ipv4` when absent. */
    address_families?: readonly Family[];
    /** Areas keyed by area ID, for example `0.0.0.0`, each with the interfaces in it. */
    areas: Record<OspfAreaId, OspfArea<I>>;
    /** Routes from other sources announced into OSPF. */
    redistribute?: readonly ("connected" | "static")[];
};

/** A routing table beside the main one. It holds no interfaces. Routes go into it from static routes and BGP neighbors that give it in `routing_table`. `routing.policy_routing` sends traffic to it. */
export type RoutingTable = {
    /** What the table is for. */
    description?: string;
};

/** A separate routing table, with the interfaces that route in it. */
export type Vrf = {
    /** What the VRF is for. */
    description?: string;
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
    vrfs?: Named<F, Vrf>;
    /** Rules in order that route the traffic they match by another table. For example, traffic from one address block can use its own transit's default route. The first rule that matches decides. The main table routes traffic that no rule matches. */
    policy_routing?: Ordered<RoutingRule<I, NoInfer<T>>>;
    /** Routes you write by hand. Their order doesn't matter. */
    static_routes?: readonly StaticRoute<I, NoInfer<F>, NoInfer<T>>[];
    /** BGP sessions and what they exchange. In a part, only what the part adds, such as its neighbor groups and neighbors. */
    bgp?: Part extends true ? Partial<Bgp<NoInfer<P>, G, NoInfer<T>, Net>> : Bgp<NoInfer<P>, G, NoInfer<T>, Net>;
    /** OSPF areas and interfaces. */
    ospf?: Ospf<I>;
    /** BFD timers for every BFD session on the device: BGP, OSPF, and static routes. Both ends of a link should use the same timers. The platform's defaults when absent. Junos has no default, so there Circuit sends every 300 ms. */
    bfd?: Bfd;
    /** The RPKI validators the device asks for route origin validation. */
    rpki?: readonly RpkiServer[];
    /** Route policies, keyed by name. Each is a list of rules in order, written whole in one place. The first rule runs first, and a route that no rule accepts is rejected. */
    policies?: Named<P, Ordered<PolicyRule<NoInfer<P>, NoInfer<S>, Net>>>;
    /** Prefix sets that policies match on, keyed by name. */
    prefix_sets?: Named<S, PrefixSet>;
};
