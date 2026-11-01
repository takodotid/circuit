// Where packets go: `routing.tables`, `.vrfs`, `.policy_routing`, `.static_routes`, `.bgp`, `.ospf`, `.bfd`, `.rpki`, `.policies`, `.prefix_sets`.

import type { Family, HostAddress, IP, Named, Ordered, Prefix, Secret } from "./common";
import type { CommunitiesRule, NeighborCommunities } from "./communities";
import { ACTIONS, CALL_RULE, closest, COMMUNITIES_EXPORT, COMMUNITIES_IMPORT, ROUTE_MATCH, ROUTE_RULE, ROUTE_SET } from "./keys";
import type { AnyFacts, NetworkFacts } from "./network";

/** A route the device has without learning it. `I` is the device's ports and interfaces, `F` its VRFs, `T` its tables. */
export type StaticRoute<I extends string, F extends string, T extends string> = {
    /** Destination. */
    prefix: Prefix;
    /** Next-hop address, alone or with its length. */
    next_hop?: HostAddress;
    /** One of the device's ports or interfaces: the next hop, for a link without a next-hop address. */
    interface?: I;
    /** Discard matching traffic. The usual way to originate an aggregate. */
    blackhole?: true;
    /** Withdraw the route while BFD finds `next_hop` dead, and put it back once `next_hop` answers again. Needs `next_hop`. */
    bfd?: true;
    /** Preference against other routes to the same prefix, 1 to 255. Lower wins. 1 when absent. */
    distance?: number;
    /** One of `routing.vrfs`: the VRF the route is in. A route has a `vrf` or a `routing_table`, not both. */
    vrf?: F;
    /** One of `routing.tables`: the table the route is in. The main table when absent. A route has a `vrf` or a `routing_table`, not both. */
    routing_table?: T | "main";
    /** Why the route exists. */
    description?: string;
};

/**
 * What a BGP neighbor is to us, with the roles RFC 9234 defines: `provider`, a transit we buy from; `customer`, one we sell transit to; `peer`, one we exchange our own routes with; `rs`, an exchange's route server; `rs-client`, a network using our route server.
 */
export type BgpRole = "provider" | "customer" | "peer" | "rs" | "rs-client";

/** Settings a BGP neighbor can set itself or take from its group. `P` is the device's policies, `T` its tables, `Net` what the network writes. */
export type NeighborSettings<P extends string, T extends string, Net extends NetworkFacts = AnyFacts> = {
    /** The neighbor's AS. Our own AS makes the session internal. */
    remote_as?: number;
    /** Who the neighbor is. */
    description?: string;
    /** Source address for the session, alone or with its length. The outgoing interface's address when absent. */
    local_address?: HostAddress;
    /** One of `routing.policies`: the policy for routes learned. Nothing is accepted when absent. */
    import_policy?: P;
    /** One of `routing.policies`: the policy for routes announced. Nothing is announced when absent. */
    export_policy?: P;
    /** What the neighbor is to us, such as `provider` for a transit. Both sides then reject a route leak, as RFC 9234 describes. */
    role?: BgpRole;
    /** The neighbor is more than one hop away. */
    multihop?: boolean;
    /** TCP MD5 password shared with the neighbor. */
    password?: Secret;
    /** Close the session when the neighbor announces more prefixes than this. It stays closed until cleared by hand, on RouterOS with `/routing bgp session clear <session> flag=limit-exceeded`. */
    max_prefixes?: number;
    /** Seconds without a message before the session is declared down, 3 or more. */
    hold_time?: number;
    /** Seconds between keepalive messages. */
    keepalive?: number;
    /** Address families exchanged. The family of the neighbor's address when absent. */
    address_families?: readonly Family[];
    /** Wait for the neighbor to connect instead of connecting to it. */
    passive?: boolean;
    /** Detect a dead link in under a second with BFD. */
    bfd?: boolean;
    /** One of `routing.tables`: the table the routes learned are installed in. The main table when absent. On RouterOS the session also announces from that table, so each prefix of `originated_prefixes` it announces needs a route in the table too, and a running session takes a new table only when it restarts. */
    routing_table?: T | "main";
    /**
     * The groups of the network's `communities` it is in, and its own blackhole community, for the `{ communities }` rules of its
     * policies: `{ groups: ["transit"], blackhole: "64501:666" }`. Only Circuit reads it. Allowed only when the network writes `communities`.
     */
    communities?: Net["communities"] extends true ? NeighborCommunities<Net["groups"]> : "allowed only when circuit.ts writes communities";
};

/** One BGP session. Settings it does not set come from its neighbor group. */
export type Neighbor<P extends string, G extends string, T extends string, Net extends NetworkFacts = AnyFacts> = NeighborSettings<
    P,
    T,
    Net
> & {
    /** The neighbor's address. */
    address: IP;
    /** One of `routing.bgp.neighbor_groups`: the group this neighbor takes a setting from when it does not set that setting itself. */
    neighbor_group?: G;
};

/** BGP on this device. `G` is the device's neighbor groups. */
export type Bgp<P extends string, G extends string, T extends string, Net extends NetworkFacts = AnyFacts> = {
    /** Our AS number. The network's `asn` when absent: the model needs one here, so Circuit writes the network's own. */
    asn?: number;
    /** Prefixes this device originates. Each needs a route, for example a static blackhole. Export policy still decides who receives them. */
    originated_prefixes?: readonly Prefix[];
    /** Settings shared by several neighbors, keyed by group name. */
    neighbor_groups?: Named<G, NeighborSettings<P, T, Net>>;
    /** Sessions, keyed by name. */
    neighbors?: Record<string, Neighbor<P, NoInfer<G>, T, Net>>;
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
    /** Cost of sending through this interface, 1 to 65535. Lower is preferred. Derived from speed when absent. */
    cost?: number;
    /** Advertise the interface's network but form no adjacency on it. */
    passive?: boolean;
    /** How the link is treated. Broadcast when absent. */
    network?: "broadcast" | "point-to-point";
    /** Detect a dead neighbor in under a second with BFD. */
    bfd?: boolean;
};

/** An OSPF area ID, four numbers with dots between them, for example `0.0.0.0` for the backbone. */
export type OspfAreaId = `${number}.${number}.${number}.${number}`;

/** OSPF, version 2 for IPv4 and version 3 for IPv6. */
export type Ospf<I extends string> = {
    /** Which versions run. IPv4 when absent. */
    address_families?: readonly Family[];
    /** Areas keyed by area ID, for example `0.0.0.0`, each with the interfaces in it. */
    areas: Record<
        OspfAreaId,
        {
            /** Some of the device's ports and interfaces, each with its OSPF settings. */
            interfaces: Named<I, OspfInterface>;
        }
    >;
    /** Routes from other sources announced into OSPF. */
    redistribute?: readonly ("connected" | "static")[];
};

/** A routing table beside the main one. It holds no interfaces: routes go in from static routes and BGP neighbors that name it in `routing_table`, and `routing.policy_routing` sends traffic to it. */
export type RoutingTable = {
    /** What the table is for. */
    description?: string;
};

/** A separate routing table, with the interfaces that route in it. */
export type Vrf = {
    /** What the VRF is for. */
    description?: string;
};

/** Traffic a routing rule matches: all of what is given. Every packet when absent. */
export type RoutingRuleMatch<I extends string> = {
    /** Source prefix. */
    src?: Prefix;
    /** Destination prefix. */
    dst?: Prefix;
    /** One of the device's ports or interfaces: the traffic arrives on it. */
    in_interface?: I;
};

/** One policy routing rule: traffic it matches is routed by `routing_table` instead of the main table. */
export type RoutingRule<I extends string, T extends string> = {
    /** Why the rule exists. */
    description?: string;
    /** What the traffic must match. Every packet when absent, so such a rule is the last one. */
    match?: RoutingRuleMatch<I>;
    /** One of `routing.tables`, or `main`: the table that routes the traffic. Always written: choosing it is what the rule is for. */
    routing_table: T | "main";
    /** When `routing_table` has no route for a packet: `none` drops it as unroutable, `main` routes it by the main table instead. `none` when absent. Not for a rule whose table is `main`. */
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

/** Prefixes listed here, or fetched from a registry by `refresh` and never typed by hand. */
export type PrefixSet =
    | {
          /** The prefixes, of either family or both: a list, or a map of named prefixes, which gives every value. Where the platform keeps one list per family, Circuit writes one of each. */
          prefixes: readonly Prefix[] | Readonly<Record<string, Prefix>>;
      }
    | {
          /** Where the prefixes are fetched from. */
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
    /** One of `routing.prefix_sets`: any prefix in it. */
    prefix_set?: S;
    /** Prefix length within this range, inclusive, 0 to 128. */
    prefix_length?: {
        /** The shortest length. */
        min?: number;
        /** The longest length. */
        max?: number;
    };
    /** AS path length within this range, inclusive. Every AS counts, prepends included. */
    as_path_length?: {
        /** The shortest path. */
        min?: number;
        /** The longest path. */
        max?: number;
    };
    /** The AS path holds this AS anywhere: the route came from it or through it. */
    as_path_contains?: number;
    /** The route's origin validation state. */
    rpki?: "valid" | "invalid" | "not-found";
    /** Has this standard community, `asn:value`. */
    standard_community?: StandardCommunity;
    /** Has this large community, `asn:function:parameter`. */
    large_community?: LargeCommunity;
};

/** Changes to a route. In community lists to remove, `*` stands for any value of a part, as in `64500:*:*`. */
export type RouteSet = {
    /** Preference among routes to the same prefix within our AS. Higher wins. */
    local_pref?: number;
    /** Multi-exit discriminator offered to the neighbor. Lower wins. */
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
    /** Source address for traffic the device itself sends to the route, alone or with its length. Applies to routes of the same family as the address. */
    preferred_source?: HostAddress;
    /** Drop traffic to the route on this device, instead of forwarding it. */
    blackhole?: true;
};

/** A route policy rule that runs another policy, and holds nothing else: `{ call: "exchange-import" }`. */
export type CallRule<P extends string> = {
    /** One of `routing.policies`, run here. A route it accepts or rejects stops there; any other goes on, with what it set. To call it for some routes only, put the condition inside that policy. */
    call: P;
    /** A call rule holds nothing else. */
    communities?: never;
};

/** A route policy rule on routes: which ones (`if`), what to change (`set`), and what then (`then`). It has `then`, `set`, or both. */
export type RouteRule<S extends string> = {
    /** Shown beside the rule on the device. */
    description?: string;
    /** Which routes the rule applies to. Every route when absent. */
    if?: RouteMatch<S>;
    /** What to change on a route that matches. Without `then`, the route goes on to the next rule, changed. */
    set?: RouteSet;
    /** What happens to a route that matches, after `set`: accepted or rejected, and the policy ends for it. Without `then`, it goes on to the next rule. */
    then?: "accept" | "reject";
    /** A rule that calls another policy holds nothing else. */
    call?: never;
    /** A communities rule holds nothing else. */
    communities?: never;
};

/**
 * One step of a route policy, plain data, the condition first:
 *
 * - `{ if: { prefix_set: "bogons" }, then: "reject" }` rejects the routes that match. No `if`: every route, `{ then: "accept" }`.
 * - `{ if: { prefix: "0.0.0.0/0" }, set: { local_pref: 110 }, then: "accept" }` changes them, then accepts them.
 * - `{ if: { ... }, set: { local_pref: 300 } }` changes them and goes on to the next rule.
 * - `{ call: "other-policy" }` runs one of `routing.policies`, and holds nothing else.
 * - `{ communities: "import" }` or `{ communities: "export" }`: the rules the network's `communities` mean here, which Circuit writes
 *   for the neighbors that use the policy. Allowed only when the network writes `communities`.
 *
 * The model keeps each as written.
 */
export type PolicyRule<P extends string, S extends string, Net extends NetworkFacts = AnyFacts> =
    | CallRule<P>
    | RouteRule<S>
    | (Net["communities"] extends true
          ? CommunitiesRule<Net["requests"]>
          : { communities: "allowed only when circuit.ts writes communities" });

/** What a route policy rule, its `if` and its `set` may hold, at run time: from keys.ts, which the types above check. */
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
        return more.length ? `a communities ${r.communities} rule has no ${more.join(", ")}. It takes: ${takes.join(", ")}.` : undefined;
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
    /** Routing tables beside the main one, keyed by name. Not `main`, and not the name of a VRF. */
    tables?: Named<T, RoutingTable>;
    /** Separate routing tables with the interfaces that route in them, keyed by name. */
    vrfs?: Named<F, Vrf>;
    /** Rules in order that route matching traffic by another table, such as traffic from one block by its own transits' default. The first that matches decides; traffic no rule matches is routed by the main table. */
    policy_routing?: Ordered<RoutingRule<I, NoInfer<T>>>;
    /** Routes the device has without learning them. A set: order means nothing. */
    static_routes?: readonly StaticRoute<I, NoInfer<F>, NoInfer<T>>[];
    /** BGP sessions and what they exchange. In a part, only what the part adds, such as its neighbor groups and neighbors. */
    bgp?: Part extends true ? Partial<Bgp<NoInfer<P>, G, NoInfer<T>, Net>> : Bgp<NoInfer<P>, G, NoInfer<T>, Net>;
    /** OSPF areas and interfaces. */
    ospf?: Ospf<I>;
    /** BFD timers for every BFD session on the device: BGP, OSPF and static routes. The platform's own when absent; Junos has none, so Circuit sends every 300 ms there. Both ends of a link should agree. */
    bfd?: Bfd;
    /** Validators answering route origin validation. */
    rpki?: readonly RpkiServer[];
    /** Route policies, keyed by name. Each is rules in order, written whole in one place: the first runs first, and a route no rule accepts is rejected. */
    policies?: Named<P, Ordered<PolicyRule<NoInfer<P>, NoInfer<S>, Net>>>;
    /** Prefix sets that policies match on, keyed by name. */
    prefix_sets?: Named<S, PrefixSet>;
};
