import { Address } from "../core/address";
import type { Community } from "../core/define";
import type {
    Device,
    IP,
    LargeCommunity,
    LargeCommunityPattern,
    PolicyRule,
    Prefix,
    StandardCommunity,
    StandardCommunityPattern,
} from "../schema";

/** The prefix lengths a BGP import accepts. */
export type SanityLengths = {
    /** Shortest and longest IPv4 prefix accepted. /8 to /24 when absent. */
    ipv4?: { min: number; max: number };
    /** Shortest and longest IPv6 prefix accepted. /16 to /48 when absent. */
    ipv6?: { min: number; max: number };
};

/** A prefix we announce, and what it is. */
export type Announced = { prefix: Prefix; description?: string };

/** What `Bgp.learn` builds an import from. */
export type LearnOptions<P extends string> = {
    /** Rules of your own, first. */
    before?: readonly PolicyRule<P, never>[];
    /** A policy holding `Bgp.sanity()` to call. The sanity rules are written in the import itself when absent. */
    sanity?: P;
    /** The source address for routes of its family, one per family. */
    sources?: readonly IP[];
    /** Preference for the routes learned. Higher wins. */
    local_pref?: number;
    /** Where the route came from: a community to add, or a rule, such as `communityScheme(...).tag(...)`. */
    tag?: StandardCommunity | LargeCommunity | PolicyRule<never, never>;
};

/** What `Bgp.defaultOnly` sets on the default routes it takes. */
export type DefaultOnlyOptions = {
    /** Preference for the default route. Higher wins. */
    local_pref?: number;
    /** Shown beside each rule. `Default route, ipv4` and `Default route, ipv6` when absent. */
    description?: string;
    /** The source address for the default of its family, one per family. */
    sources?: readonly IP[];
    /** End with `{ description: "Nothing else", action: "reject" }`, so the policy takes the default route only. Off by default: any other route goes on to the rules after these. */
    reject?: boolean;
};

/** What `Bgp.announce` writes after the accepts. */
export type AnnounceOptions = {
    /** End with `{ description: "Nothing else", action: "reject" }`, so nothing else leaves. On by default: it stops a route leak when the reject is forgotten. Turn it off for an export that adds rules after these. */
    reject?: boolean;
};

/** Kinds of neighbor and the number each is tagged with, such as `{ transit: 1, customer: 3 }`. */
export type CommunityClasses = Readonly<Record<string, number>>;

/**
 * A BGP community scheme of large communities, `asn:function:parameter`, in the style of RFC 8195. Each field names the function number your network uses for it; leave out what your network does not offer.
 *
 * The type parameters keep the exact numbers you write, so the communities `Bgp.communityScheme` gives back show them in the editor: Asn your AS, LearnedFrom the function of `learned_from`, Classes its classes.
 */
export type CommunityScheme<
    Asn extends number = number,
    LearnedFrom extends number = number,
    Classes extends CommunityClasses = CommunityClasses,
> = {
    /** Your AS. It is the first part of every community. */
    asn: Asn;
    /** Set on import: the kind of neighbor a route came from, `asn:function:class`. */
    learned_from?: { function: LearnedFrom; classes: Classes };
    /** Set on import: the site a route was learned at, `asn:function:site`. `sites` names the sites, for the catalogue. */
    learned_at?: { function: number; sites?: Readonly<Record<number, string>> };
    /** Set on import: the AS a route was learned from, `asn:function:asn`. */
    learned_from_as?: number;
    /** A neighbor asks: do not announce the route to an AS, `asn:function:asn`, or to anyone, `asn:function:0`. */
    do_not_announce?: number;
    /** A neighbor asks: prepend toward an AS once, twice or three times, `asn:function:asn`. */
    prepend?: { once?: number; twice?: number; three_times?: number };
    /**
     * A neighbor asks: drop all traffic to this route, `asn:function:0`, usually one address under attack. Your router drops it, and so does every upstream in `upstreams`.
     *
     * `upstreams` maps an upstream's AS to its own blackhole community, as its NOC gives it. The route is passed to that upstream with it, so the traffic stops before it reaches your links. An upstream not listed never receives the route.
     */
    blackhole?: { function: number; upstreams?: Readonly<Record<number, StandardCommunity>> };
};

/** The class names a scheme declares, or any name when it declares none. */
type ClassName<Classes extends CommunityClasses> = {} extends Classes ? string : Extract<keyof Classes, string>;

/** BGP policy: an import sanity policy, the shapes most imports and exports take, a community scheme, and helpers that read a device's BGP neighbors. */
export class Bgp {
    private static readonly PREPENDS = [
        ["once", 1],
        ["twice", 2],
        ["three_times", 3],
    ] as const;

    /** The default route of each family. */
    private static readonly DEFAULTS = [
        { family: "ipv4", prefix: "0.0.0.0/0" },
        { family: "ipv6", prefix: "::/0" },
    ] as const;

    /** Route policy rules rejecting what no neighbor should send: prefixes too short or too long for the global table, and RPKI invalid. Place it first in an import, or as a policy other imports call. */
    static sanity(lengths: SanityLengths = {}): PolicyRule<never, never>[] {
        const ipv4 = lengths.ipv4 ?? { min: 8, max: 24 };
        const ipv6 = lengths.ipv6 ?? { min: 16, max: 48 };

        return [
            {
                description: `IPv4 shorter than /${ipv4.min}`,
                match: { family: "ipv4", prefix_length: { max: ipv4.min - 1 } },
                action: "reject",
            },
            {
                description: `IPv4 longer than /${ipv4.max}`,
                match: { family: "ipv4", prefix_length: { min: ipv4.max + 1 } },
                action: "reject",
            },
            {
                description: `IPv6 shorter than /${ipv6.min}`,
                match: { family: "ipv6", prefix_length: { max: ipv6.min - 1 } },
                action: "reject",
            },
            {
                description: `IPv6 longer than /${ipv6.max}`,
                match: { family: "ipv6", prefix_length: { min: ipv6.max + 1 } },
                action: "reject",
            },
            { description: "RPKI invalid", match: { rpki: "invalid" }, action: "reject" },
        ];
    }

    /**
     * An export that announces each prefix, at exactly its length. It returns, in order:
     *
     * 1. `{ description, match: { prefix }, action: "accept" }` for each prefix;
     * 2. `{ description: "Nothing else", action: "reject" }`, the unconditional reject `Checks.exportsEndInReject` looks for.
     *
     * The reject is there by default, so a forgotten one can't leak routes. `{ reject: false }` leaves it out, for an export that adds rules after these and ends in a reject of its own.
     */
    static announce(prefixes: readonly Announced[], options: AnnounceOptions = {}): PolicyRule<never, never>[] {
        return [
            ...prefixes.map(({ prefix, description }) => ({
                ...(description ? { description } : {}),
                match: { prefix },
                action: "accept" as const,
            })),
            ...(options.reject === false ? [] : [Bgp.NOTHING_ELSE]),
        ];
    }

    /** The reject that ends a policy: nothing else gets through. */
    private static readonly NOTHING_ELSE: PolicyRule<never, never> = { description: "Nothing else", action: "reject" };

    /**
     * An import policy that takes a neighbor's routes: `before` first, then the sanity rules, then each source address and the local preference, then the tag, then accept.
     *
     * `sanity` names a policy holding `Bgp.sanity()` to call, so several imports share one; without it, the sanity rules are written here. `tag` is a community to add, or a rule such as `communityScheme(...).tag(...)`. Each of `sources` is the source address for routes of its own family.
     */
    static learn<const P extends string = never>(options: LearnOptions<P> = {}): PolicyRule<P, never>[] {
        const { tag } = options;

        return [
            ...(options.before ?? []),
            ...(options.sanity ? [{ call: options.sanity }] : Bgp.sanity()),
            ...(options.sources ?? []).map((source) => ({ set: { preferred_source: source } })),
            ...(options.local_pref !== undefined ? [{ set: { local_pref: options.local_pref } }] : []),
            ...(tag === undefined ? [] : [typeof tag === "object" ? tag : Bgp.adding(tag)]),
            { action: "accept" },
        ];
    }

    /**
     * Import rules that take the default route from a transit. They are, in order:
     *
     * 1. `{ description, match: { prefix: "0.0.0.0/0" }, set: { local_pref, preferred_source }, action: "accept" }`;
     * 2. the same for `::/0`;
     * 3. with `{ reject: true }` only, `{ description: "Nothing else", action: "reject" }`.
     *
     * Without `reject`, any other route goes on to the rules after these, so `[...Bgp.defaultOnly(), ...Bgp.learn()]` takes both. Each of `sources` is the source address for the default of its own family; `set` holds only what is given.
     */
    static defaultOnly(options: DefaultOnlyOptions = {}): PolicyRule<never, never>[] {
        const defaults = Bgp.DEFAULTS.map(({ family, prefix }) => {
            const source = options.sources?.find((address) => Address.family(address) === family);
            const set = {
                ...(options.local_pref !== undefined ? { local_pref: options.local_pref } : {}),
                ...(source ? { preferred_source: source } : {}),
            };

            return {
                description: options.description ?? `Default route, ${family}`,
                match: { prefix },
                ...(Object.keys(set).length ? { set } : {}),
                action: "accept" as const,
            };
        });

        return options.reject ? [...defaults, Bgp.NOTHING_ELSE] : defaults;
    }

    /** A rule adding one community, standard or large. */
    private static adding(community: StandardCommunity | LargeCommunity): PolicyRule<never, never> {
        const large = community.split(":").length === 3;
        return {
            description: `Tag ${community}`,
            set: large ? { add_large_communities: [community as LargeCommunity] } : { add_communities: [community as StandardCommunity] },
        };
    }

    /** Each BGP neighbor's own policies and role, or its group's. */
    static neighborPolicies(device: Device) {
        const bgp = device.routing?.bgp;

        return Object.entries(bgp?.neighbors ?? {}).map(([name, neighbor]) => {
            const group = neighbor.group ? bgp?.groups?.[neighbor.group] : undefined;

            return {
                name,
                address: neighbor.address,
                role: neighbor.role ?? group?.role,
                import: neighbor.import ?? group?.import,
                export: neighbor.export ?? group?.export,
            };
        });
    }

    /** The prefixes an export policy accepts by name. */
    static offered(device: Device, policy: string | undefined): Prefix[] {
        const rules = policy ? (device.policies?.[policy] ?? []) : [];
        return rules.filter((rule) => rule.action === "accept" && rule.match?.prefix).map((rule) => rule.match!.prefix!);
    }

    /**
     * Policy rules and a catalogue from one community scheme, so the communities your routers set, the ones they act on, and the ones you publish never disagree.
     *
     * - `tag(neighborClass, neighborAs, { site, trusted })`: a rule for an import policy. It removes your communities a neighbor set, then adds where the route was learned. A `trusted` neighbor keeps its requests: do not announce, prepend, blackhole. `site` is needed when the scheme has `learned_at`.
     * - `actions(neighborAs, { blackhole })`: rules for an export policy toward one neighbor. They act on a customer's action communities, then remove all of yours. Place them before the rules that accept. A blackholed route goes no further, unless `blackhole` names the neighbor's own blackhole community: then it is passed on with it, so the neighbor drops the traffic too.
     * - `blackhole(prefixSets)`: rules for the import policy of a neighbor you trust with blackholes, before anything that rejects long prefixes. They take a route the neighbor asked to blackhole, but only inside `prefixSets`, its own space, and drop traffic to it here. One rule per set, so one call covers both families.
     * - `catalogue`: every community, for `communities` in `defineNetwork`.
     * - `community(fn, parameter)`: one community of yours, for a rule of your own.
     * - `learned_from`: the community each class is tagged with, by class name, such as `learned_from.customer`.
     */
    static communityScheme<
        const Asn extends number,
        const LearnedFrom extends number = number,
        const Classes extends CommunityClasses = {},
    >(scheme: CommunityScheme<Asn, LearnedFrom, Classes>) {
        type Class = ClassName<Classes>;

        const { asn } = scheme;

        /** One community of yours, `asn:fn:parameter`. */
        const community = <const Fn extends number, const Parameter extends number>(fn: Fn, parameter: Parameter) =>
            `${asn}:${fn}:${parameter}` as `${Asn}:${Fn}:${Parameter}`;

        /** Every value of one of your functions, `asn:fn:*`, for a list of communities to remove. */
        const anyOf = (fn: number): LargeCommunityPattern => `${asn}:${fn}:*`;

        /** A line of the catalogue, where `nnn` stands for any number. */
        const written = (fn: number, parameter: number | string) => `${asn}:${fn}:${parameter}`;

        const ours = {
            standard: [`${asn}:*`] as StandardCommunityPattern[],
            large: [`${asn}:*:*`] as LargeCommunityPattern[],
        };

        const learnedFrom = Object.fromEntries(
            Object.entries<number>(scheme.learned_from?.classes ?? {}).map(([name, value]) => [
                name,
                community(scheme.learned_from!.function, value),
            ])
        ) as { readonly [Name in keyof Classes]: `${Asn}:${LearnedFrom}:${Classes[Name]}` };

        const information = [scheme.learned_from?.function, scheme.learned_at?.function, scheme.learned_from_as].filter(
            (fn): fn is number => fn !== undefined
        );

        const tag = (
            neighborClass: Class,
            neighborAs: number,
            options: { site?: number; trusted?: boolean } = {}
        ): PolicyRule<never, never> => {
            const { site, trusted = false } = options;
            if (scheme.learned_at && site === undefined)
                throw new Error(`Bgp.communityScheme: tag for AS${neighborAs} needs a site, for learned_at`);

            return {
                description: `Learned from AS${neighborAs}`,
                set: {
                    remove_communities: ours.standard,
                    // A trusted neighbor keeps its requests and loses only the "where it came from" tags, which are ours to set. Anyone else loses every community of ours.
                    remove_large_communities: trusted ? information.map(anyOf) : ours.large,
                    add_large_communities: [
                        ...(scheme.learned_from
                            ? [community(scheme.learned_from.function, scheme.learned_from.classes[neighborClass])]
                            : []),
                        ...(scheme.learned_at ? [community(scheme.learned_at.function, site!)] : []),
                        ...(scheme.learned_from_as !== undefined ? [community(scheme.learned_from_as, neighborAs)] : []),
                    ],
                },
            };
        };

        const blackhole = <S extends string>(prefixSets: readonly S[]): PolicyRule<never, S>[] => {
            const fn = scheme.blackhole?.function;
            if (fn === undefined) throw new Error("Bgp.communityScheme: blackhole needs a function number in the scheme");

            return prefixSets.map((prefixSet) => ({
                description: "Blackhole, asked by the neighbor",
                match: { large_community: community(fn, 0), prefix_set: prefixSet },
                set: { blackhole: true },
                action: "accept",
            }));
        };

        const actions = (neighborAs: number): PolicyRule<never, never>[] => {
            // The upstream's own blackhole community, when it takes blackholes from us.
            const passOn = scheme.blackhole?.upstreams?.[neighborAs];

            return [
                ...(scheme.blackhole !== undefined && !passOn
                    ? [
                          {
                              description: "Blackholed here, never announced",
                              match: { large_community: community(scheme.blackhole.function, 0) },
                              action: "reject" as const,
                          },
                      ]
                    : []),
                ...(scheme.do_not_announce !== undefined
                    ? [
                          {
                              description: "Asked not to be announced anywhere",
                              match: { large_community: community(scheme.do_not_announce, 0) },
                              action: "reject" as const,
                          },
                          {
                              description: `Asked not to be announced to AS${neighborAs}`,
                              match: { large_community: community(scheme.do_not_announce, neighborAs) },
                              action: "reject" as const,
                          },
                      ]
                    : []),
                ...(scheme.blackhole !== undefined && passOn
                    ? [
                          {
                              description: `Blackhole passed on to AS${neighborAs}`,
                              match: { large_community: community(scheme.blackhole.function, 0) },
                              set: {
                                  remove_communities: ours.standard,
                                  remove_large_communities: ours.large,
                                  add_communities: [passOn],
                              },
                              action: "accept" as const,
                          },
                      ]
                    : []),
                ...Bgp.PREPENDS.flatMap(([name, times]) => {
                    const fn = scheme.prepend?.[name];
                    if (fn === undefined) return [];

                    return [
                        {
                            description: `Asked to prepend ${name.replace("_", " ")} to AS${neighborAs}`,
                            match: { large_community: community(fn, neighborAs) },
                            set: { prepend: times },
                        },
                    ];
                }),
                {
                    description: "Our communities stay inside our network",
                    set: { remove_communities: ours.standard, remove_large_communities: ours.large },
                },
            ];
        };

        const catalogue: Community[] = [
            ...Object.entries<number>(scheme.learned_from?.classes ?? {}).map(([name, value]) => ({
                community: written(scheme.learned_from!.function, value),
                description: `Learned from ${Bgp.article(name)}`,
            })),
            ...(scheme.learned_at
                ? [
                      ...Object.entries(scheme.learned_at.sites ?? {}).map(([site, name]) => ({
                          community: written(scheme.learned_at!.function, site),
                          description: `Learned in ${name}`,
                      })),
                      { community: written(scheme.learned_at.function, "nnn"), description: "Learned at site $0" },
                  ]
                : []),
            ...(scheme.learned_from_as !== undefined
                ? [{ community: written(scheme.learned_from_as, "nnn"), description: "Learned from AS$0" }]
                : []),
            ...(scheme.do_not_announce !== undefined
                ? [
                      { community: written(scheme.do_not_announce, 0), description: "Do not announce to anyone" },
                      { community: written(scheme.do_not_announce, "nnn"), description: "Do not announce to AS$0" },
                  ]
                : []),
            ...Bgp.PREPENDS.flatMap(([name]) => {
                const fn = scheme.prepend?.[name];
                return fn === undefined
                    ? []
                    : [{ community: written(fn, "nnn"), description: `Prepend ${name.replace("_", " ")} to AS$0` }];
            }),
            ...(scheme.blackhole !== undefined
                ? [
                      {
                          community: written(scheme.blackhole.function, 0),
                          description: Object.keys(scheme.blackhole.upstreams ?? {}).length
                              ? `Blackhole: dropped in AS${asn} and by its upstreams that take it`
                              : `Blackhole: dropped in AS${asn}, not announced further`,
                      },
                  ]
                : []),
        ];

        return { community, learned_from: learnedFrom, tag, actions, blackhole, catalogue };
    }

    /** A word with its article: "a customer", "an upstream". */
    private static article(word: string): string {
        return /^[aeiou]/i.test(word) ? `an ${word}` : `a ${word}`;
    }
}
