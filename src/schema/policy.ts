import type { Family, IP, Prefix } from "./common";

/** Registries a prefix set can be fetched from. */
export type Registry = "ripe-stat";

/** Prefixes listed here, or fetched from a registry by `refresh` and never typed by hand. */
export type PrefixSet =
    | {
          /** The prefixes, of one family. */
          prefixes: readonly Prefix[];
      }
    | {
          source: {
              /** Where the prefixes come from. */
              registry: Registry;
              /** What to ask for, for example `AS7713`. */
              query: string;
              /** Which family to keep. */
              family: Family;
          };
      };

/** Conditions on a route. All must hold. An empty match holds for every route. */
export type Match<S extends string> = {
    /** Only routes of this family. */
    family?: Family;
    /** Exactly this prefix. */
    prefix?: Prefix;
    /** Any prefix in this set. */
    prefix_set?: S;
    /** Prefix length within this range, inclusive. */
    prefix_length?: { min?: number; max?: number };
    /** AS path length within this range, inclusive. Every AS counts, prepends included. */
    as_path_length?: { min?: number; max?: number };
    /** The route's origin validation state. */
    rpki?: "valid" | "invalid" | "not-found";
    /** Carries this standard community, `asn:value`. */
    community?: string;
    /** Carries this large community, `asn:function:parameter`. */
    large_community?: string;
};

/** Changes to a route. In community lists to remove, `*` stands for any value of a field, as in `64500:*:*`. */
export type Sets = {
    /** Preference among routes to the same prefix within our AS. Higher wins. */
    local_pref?: number;
    /** Multi-exit discriminator offered to the neighbor. Lower wins. */
    med?: number;
    /** Prepend our own AS this many times, to make the path look longer. */
    prepend?: number;
    /** Replace the route's standard communities with these. */
    communities?: readonly string[];
    /** Add these standard communities. */
    add_communities?: readonly string[];
    /** Remove standard communities matching these. */
    remove_communities?: readonly string[];
    /** Replace the route's large communities with these. */
    large_communities?: readonly string[];
    /** Add these large communities. */
    add_large_communities?: readonly string[];
    /** Remove large communities matching these. */
    remove_large_communities?: readonly string[];
    /** Next hop for the route. */
    next_hop?: IP;
    /** Source address for traffic the device itself sends to the route. Applies to routes of the same family as the address. */
    preferred_source?: IP;
    /** Drop traffic to the route on this device, instead of forwarding it. */
    blackhole?: true;
};

/**
 * One step of a route policy. Evaluated in this order: `call`, then `match`, then `set`, then `action`.
 *
 * A rule without `action` changes the route and moves on to the next rule.
 */
export type PolicyRule<P extends string, S extends string> = {
    /** Shown beside the rule on the device. */
    description?: string;
    /** Evaluate another policy first. A route it accepts or rejects stops there. */
    call?: P;
    /** Which routes the rule applies to. Every route when absent. */
    match?: Match<S>;
    /** What to change on a matching route. */
    set?: Sets;
    /** Accept or reject a matching route, ending the policy for it. */
    action?: "accept" | "reject";
};

/** Rules evaluated in order, first decision wins. A route no rule accepts is rejected. */
export type RoutePolicy<P extends string, S extends string> = readonly PolicyRule<P, S>[];
