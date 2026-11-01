// A network's BGP large communities, `asn:code:value` (RFC 8092), used as RFC 8195 describes. The scheme is written once, in
// `circuit({ communities })`; a neighbor group says which groups it is in, and a policy places `{ communities: "import" }` or
// `{ communities: "export" }`. Circuit writes the catalogue from the scheme, and each such rule as the rules it means for the neighbors
// that use the policy.

import type { Community } from "./network";
import type { LargeCommunity, StandardCommunity } from "./routing";

/** One option of the scheme. */
export type CommunityOption = {
    /** The middle number of `asn:code:value` (RFC 8195 calls it the function). */
    code: number;
    /** The catalogue's words for it, in place of Circuit's. Each option says which line they are. */
    description?: string;
};

/** A group of neighbors, such as `transit`. */
export type CommunityGroup = {
    /** The last number of a community about the group, such as the `2` of `64500:1:2`. Neighbors write it into their routers: keep it. */
    value: number;
    /** How the catalogue names the group, such as `an IP transit`. Its name with `a` or `an` when absent: `a transit`. */
    description?: string;
};

/**
 * The network's large communities, `asn:code:value`. Write the options the network offers, and leave out the rest. Each option is an
 * object with its `code`, and may have its own `description` for the catalogue.
 */
export type CommunityScheme = {
    /** The first number of every community. The network's `asn` when absent. */
    asn?: number;
    /** Groups of neighbors, by name, such as `{ transit: { value: 1 }, exchange: { value: 2 } }`. A neighbor group says which it is in. Needed by the `_group` options. */
    groups?: Readonly<Record<string, CommunityGroup>>;
    /** A tag: the groups of the neighbor a route was learned from, `asn:code:<group value>`. `description` is the words before the group: `Learned from` when absent. */
    learned_from_group?: CommunityOption;
    /** A tag: the site a route was learned at, `asn:code:<site number>`, from the site's `number` in `sites`. `description` is the `nnn` line: `Learned at site $0` when absent. */
    learned_at_site?: CommunityOption;
    /** A tag: the AS a route was learned from, `asn:code:<asn>`. Never on a customer's routes, so customers share one import policy. `description` is the `nnn` line: `Learned from AS$0` when absent. */
    learned_from_as?: CommunityOption;
    /** A request: do not announce to an AS, `asn:code:<asn>`, or to anyone, `asn:code:0`. `description` is the `nnn` line: `Do not announce to AS$0` when absent. */
    do_not_announce_to_as?: CommunityOption;
    /** A request: do not announce to the neighbors of a group, `asn:code:<group value>`. `description` is the words before the group: `Do not announce to` when absent. */
    do_not_announce_to_group?: CommunityOption;
    /** A request: prepend our AS toward an AS once, twice or three times, `asn:code:<asn>`. Each `description` is its `nnn` line: `Prepend once to AS$0` when absent. */
    prepend?: { once?: CommunityOption; twice?: CommunityOption; three_times?: CommunityOption };
    /** A request: drop all traffic to the route, `asn:code:0`. A neighbor group with its own `blackhole` community is passed the route with it, so it drops the traffic too; any other never gets the route. `description` is its line: `Blackhole: dropped in AS<asn>` when absent. */
    blackhole?: CommunityOption;
    /** Your own words for one community of the catalogue, by the community as the catalogue writes it: `{ "64500:2:0": "Learned at site-a" }`. */
    custom_descriptions?: Readonly<Record<string, string>>;
};

/** The options a neighbor sends to ask something of us, which an import may accept. */
export type CommunityRequest = "do_not_announce_to_as" | "do_not_announce_to_group" | "prepend" | "blackhole";

/** The requests a scheme `C` offers. */
export type RequestsOf<C> = C extends object ? Extract<keyof C, CommunityRequest> : never;

/** The group names a scheme `C` writes. */
export type GroupsOf<C> = C extends { readonly groups: infer G } ? keyof G & string : never;

/**
 * The scheme as written, `C`, and an error at each option that needs what is not written: a `_group` option without `groups`, and
 * `learned_at_site` while no site has a `number` (`Numbered`). The editor still offers them. A key that is no option is an error too.
 */
export type SchemeCheck<C, Numbered extends boolean> = {
    [K in Exclude<keyof C, keyof CommunityScheme> & string]: `${K} is no option of communities`;
} & (C extends {
    readonly groups: object;
}
    ? unknown
    : {
          learned_from_group?: "learned_from_group needs communities.groups";
          do_not_announce_to_group?: "do_not_announce_to_group needs communities.groups";
      }) &
    (Numbered extends true ? unknown : { learned_at_site?: "learned_at_site needs a number on a site, in sites" });

/** What a neighbor, or its group, says about communities. `G` is the scheme's groups. */
export type NeighborCommunities<G extends string> = {
    /** The groups it is in, from the network's `communities.groups`. Its routes are tagged with each, and a request about a group acts on it. */
    groups?: readonly ([G] extends [never] ? "needs communities.groups in circuit.ts" : G)[];
    /** Its own blackhole community, when it takes blackholes from us, such as `64501:666`. A route asked to be blackholed is passed to it with this. */
    blackhole?: StandardCommunity | LargeCommunity;
};

/**
 * A route policy rule that Circuit writes out, in an import: it takes off the requests a neighbor may not send, and the tags only we
 * set, then tags the route with where it was learned. `R` is the requests the scheme offers.
 */
export type CommunitiesImport<R extends string> = {
    /** The rules for an import. */
    communities: "import";
    /** The requests this neighbor may send, which stay on the route. None when absent: every request is taken off (RFC 7454). */
    accept_requests?: readonly R[];
    /** Tag the route with where it was learned: its groups, the site, its AS (not a customer's). `true` when absent. `false` leaves the tags as they came, for iBGP, where our own router set them. */
    add_tags?: boolean;
    /** A communities rule holds nothing else. */
    call?: never;
};

/**
 * A route policy rule that Circuit writes out, in an export, before the rules that accept: it does what routes ask (do not announce,
 * prepend, blackhole) toward the neighbor, then takes our communities off.
 */
export type CommunitiesExport = {
    /** The rules for an export. */
    communities: "export";
    /** Keep our communities on the route. `false` when absent. Toward iBGP, write it: `true` sends every tag and request on, as it is; without it, `circuit check` stops. */
    keep_ours?: boolean;
    /** Keep our tags on the route, for a neighbor that wants to see where a route was learned; the requests are still taken off. `false` when absent. */
    send_tags?: boolean;
    /** A communities rule holds nothing else. */
    call?: never;
};

/** A route policy rule Circuit writes out from the scheme, when the network writes `communities`. */
export type CommunitiesRule<R extends string> = CommunitiesImport<R> | CommunitiesExport;

// ---------- what Circuit does with them ----------

// The network and a device's JSON, walked without their types.
type Json = any;

const PREPENDS = [
    ["once", 1],
    ["twice", 2],
    ["three_times", 3],
] as const;
const REQUESTS: CommunityRequest[] = ["do_not_announce_to_as", "do_not_announce_to_group", "prepend", "blackhole"];
const TAGS = ["learned_from_group", "learned_at_site", "learned_from_as"];

const article = (word: string) => `${/^[aeiou]/i.test(word) ? "an" : "a"} ${word}`;

/** The codes of the options named, a prepend's three included. */
const codesOf = (s: Json, names: string[]): number[] =>
    names.flatMap((n) =>
        n === "prepend" ? PREPENDS.flatMap(([p]) => (s.prepend?.[p] ? [s.prepend[p].code] : [])) : s[n] ? [s[n].code] : []
    );

/** Every community of the scheme as the catalogue lists it, `nnn` for any number, with the scheme's own words where it has them. */
export function catalogue(network: Json): Community[] {
    const s = network.communities;
    if (!s) return [];
    const asn = s.asn ?? network.asn;
    const line = (option: Json, value: number | string, text: string) => ({
        community: `${asn}:${option.code}:${value}`,
        description: text,
    });
    const groups = Object.entries<Json>(s.groups ?? {});
    const named = (name: string, group: Json) => group.description ?? article(name);
    const sites = Object.entries<Json>(network.sites ?? {}).filter(([, site]) => site.number !== undefined);
    const o = s;
    const lines = [
        ...(o.learned_from_group
            ? groups.map(([n, g]) =>
                  line(o.learned_from_group, g.value, `${o.learned_from_group.description ?? "Learned from"} ${named(n, g)}`)
              )
            : []),
        ...(o.learned_at_site
            ? [
                  ...sites.map(([n, site]) => line(o.learned_at_site, site.number, `Learned at ${n}`)),
                  line(o.learned_at_site, "nnn", o.learned_at_site.description ?? "Learned at site $0"),
              ]
            : []),
        ...(o.learned_from_as ? [line(o.learned_from_as, "nnn", o.learned_from_as.description ?? "Learned from AS$0")] : []),
        ...(o.do_not_announce_to_as
            ? [
                  line(o.do_not_announce_to_as, 0, "Do not announce to anyone"),
                  line(o.do_not_announce_to_as, "nnn", o.do_not_announce_to_as.description ?? "Do not announce to AS$0"),
              ]
            : []),
        ...(o.do_not_announce_to_group
            ? groups.map(([n, g]) =>
                  line(
                      o.do_not_announce_to_group,
                      g.value,
                      `${o.do_not_announce_to_group.description ?? "Do not announce to"} ${named(n, g)}`
                  )
              )
            : []),
        ...PREPENDS.flatMap(([p]) =>
            o.prepend?.[p] ? [line(o.prepend[p], "nnn", o.prepend[p].description ?? `Prepend ${p.replace("_", " ")} to AS$0`)] : []
        ),
        ...(o.blackhole ? [line(o.blackhole, 0, o.blackhole.description ?? `Blackhole: dropped in AS${asn}`)] : []),
    ];
    return lines.map((l) => ({ ...l, description: s.custom_descriptions?.[l.community] ?? l.description }));
}

/** What is wrong with the scheme, which the editor may have missed. */
export function schemeProblems(network: Json): string[] {
    const s = network.communities;
    if (!s) return [];
    const found: string[] = [];
    for (const option of ["learned_from_group", "do_not_announce_to_group"])
        if (s[option] && !s.groups) found.push(`communities.${option} needs communities.groups.`);
    if (s.learned_at_site && !Object.values<Json>(network.sites ?? {}).some((site) => site.number !== undefined))
        found.push("communities.learned_at_site needs a number on a site, in sites.");
    const listed = new Set(catalogue(network).map((l) => l.community));
    for (const community of Object.keys(s.custom_descriptions ?? {}))
        if (!listed.has(community))
            found.push(
                `communities.custom_descriptions: ${community} is no community of the scheme. The catalogue has ${[...listed].join(", ")}.`
            );
    return found;
}

/** One neighbor as a communities rule sees it: its AS, its groups, its blackhole community, and whether it is a customer. */
type Peer = { asn: number; groups: string[]; blackhole?: string; customer: boolean; ibgp: boolean };

/**
 * The rules one communities rule is written as, toward one neighbor: `all` in place, for a policy one AS uses; for a policy several
 * ASes use, `own`, the rules of this AS, which run first in a policy of their own, and `shared`, the same for every AS.
 */
type Written = { all: Json[]; own: Json[]; shared: Json[] };

/**
 * An import: takes off the requests not accepted and the tags, adds the tags, and blackholes a route that asks, when accepted. A
 * customer's routes get no `learned_from_as` tag (decision 50), so the customers share one import policy.
 */
function importRules(s: Json, asn: number, rule: Json, to: Peer, site: number | undefined, groupsShared: boolean): Written {
    const accepted: string[] = rule.accept_requests ?? [];
    const tags = rule.add_tags !== false;
    const off = codesOf(s, [...(tags ? TAGS : []), ...REQUESTS.filter((r) => !accepted.includes(r))]);
    const everything = tags && !REQUESTS.some((r) => accepted.includes(r) && (r === "prepend" ? s.prepend : s[r]));
    const asTag = !!s.learned_from_as && !to.customer;
    const add = tags
        ? [
              ...(s.learned_from_group ? to.groups.map((g) => `${asn}:${s.learned_from_group.code}:${s.groups[g].value}`) : []),
              ...(s.learned_at_site ? [`${asn}:${s.learned_at_site.code}:${site}`] : []),
              ...(asTag ? [`${asn}:${s.learned_from_as.code}:${to.asn}`] : []),
          ]
        : [];
    const set = {
        remove_standard_communities: [`${asn}:*`],
        ...(everything
            ? { remove_large_communities: [`${asn}:*:*`] }
            : off.length
              ? { remove_large_communities: off.map((c) => `${asn}:${c}:*`) }
              : {}),
        ...(add.length ? { add_large_communities: add } : {}),
    };
    const blackhole =
        accepted.includes("blackhole") && s.blackhole
            ? [
                  {
                      description: "Blackhole, asked by the neighbor",
                      if: { large_community: `${asn}:${s.blackhole.code}:0` },
                      set: { blackhole: true },
                  },
              ]
            : [];
    // The tag is the AS's own when it names the AS, or groups that differ between the ASes.
    const ownTag = tags && (asTag || (!!s.learned_from_group && to.groups.length > 0 && !groupsShared));
    const tag = {
        description: !tags ? "Requests it may not send taken off" : ownTag ? `Learned from AS${to.asn}` : "Where it was learned",
        set,
    };
    return {
        all: [{ ...tag, description: tags && !to.customer ? `Learned from AS${to.asn}` : tag.description }, ...blackhole],
        own: ownTag ? [tag] : [],
        shared: [...(ownTag ? [] : [tag]), ...blackhole],
    };
}

/**
 * An export, before the rules that accept: a blackholed route rejected, or passed on to a neighbor that takes it; a route asked not to
 * go anywhere, to this AS or to one of its groups, rejected; the prepends it asks for; our communities taken off. Toward a customer, no
 * request about one AS (decision 39). Rejects come first, so "do not announce" always wins over a prepend. Toward iBGP, where our
 * other routers act on the requests themselves, only our communities taken off, unless `keep_ours`.
 */
function exportRules(s: Json, asn: number, rule: Json, to: Peer, groupsShared: boolean): Written {
    const requests = codesOf(s, REQUESTS);
    const ours = rule.keep_ours
        ? {}
        : {
              remove_standard_communities: [`${asn}:*`],
              remove_large_communities: rule.send_tags ? requests.map((c) => `${asn}:${c}:*`) : [`${asn}:*:*`],
          };
    const asks = (option: Json, value: number) => ({ large_community: `${asn}:${option.code}:${value}` });
    const dna = s.do_not_announce_to_as;
    const blackholed = s.blackhole ? [{ description: "Blackholed here, never announced", if: asks(s.blackhole, 0), then: "reject" }] : [];
    const anywhere = dna ? [{ description: "Asked not to be announced anywhere", if: asks(dna, 0), then: "reject" }] : [];
    const toAs =
        dna && !to.customer ? [{ description: `Asked not to be announced to AS${to.asn}`, if: asks(dna, to.asn), then: "reject" }] : [];
    const toGroups = s.do_not_announce_to_group
        ? to.groups.map((g) => ({
              description: `Asked not to be announced to ${g}`,
              if: asks(s.do_not_announce_to_group, s.groups[g].value),
              then: "reject",
          }))
        : [];
    const add =
        to.blackhole?.split(":").length === 3 ? { add_large_communities: [to.blackhole] } : { add_standard_communities: [to.blackhole] };
    const passOn =
        s.blackhole && to.blackhole
            ? [{ description: `Blackhole passed on to AS${to.asn}`, if: asks(s.blackhole, 0), set: { ...ours, ...add }, then: "accept" }]
            : [];
    const prepends = to.customer
        ? []
        : PREPENDS.flatMap(([p, times]) =>
              s.prepend?.[p]
                  ? [
                        {
                            description: `Asked to prepend ${p.replace("_", " ")} to AS${to.asn}`,
                            if: asks(s.prepend[p], to.asn),
                            set: { prepend: times },
                        },
                    ]
                  : []
          );
    const strip = rule.keep_ours
        ? []
        : [{ description: rule.send_tags ? "Our requests stay inside our network" : "Our communities stay inside our network", set: ours }];
    if (to.ibgp) return { all: strip, own: [], shared: strip };
    return {
        all: [...(passOn.length ? [] : blackholed), ...anywhere, ...toAs, ...toGroups, ...passOn, ...prepends, ...strip],
        // A route passed on as a blackhole is accepted in the AS's own policy, so what must reject it first comes with it there.
        own: passOn.length
            ? [...anywhere, ...toAs, ...toGroups, ...passOn, ...prepends]
            : [...toAs, ...(groupsShared ? [] : toGroups), ...prepends],
        shared: [...blackholed, ...anywhere, ...(groupsShared ? toGroups : []), ...strip],
    };
}

/** Each BGP neighbor of a device, with what it takes from its group. */
function neighborsOf(d: Json) {
    const bgp = d.routing?.bgp ?? {};
    return Object.entries<Json>(bgp.neighbors ?? {}).map(([name, x]) => {
        const group = x.neighbor_group ? bgp.neighbor_groups?.[x.neighbor_group] : undefined;
        const c = x.communities ?? group?.communities ?? {};
        return {
            name,
            x,
            group,
            asn: x.remote_as ?? group?.remote_as,
            groups: (c.groups ?? []) as string[],
            blackhole: c.blackhole as string | undefined,
            customer: (x.role ?? group?.role) === "customer",
            import: x.import_policy ?? group?.import_policy,
            export: x.export_policy ?? group?.export_policy,
        };
    });
}

const isCommunities = (rule: Json) => !!rule && typeof rule === "object" && "communities" in rule;

/**
 * Writes out each `{ communities }` rule of a device, for the neighbors that use its policy: their AS, their groups, their blackhole
 * community, and the device's site. A policy one AS uses gets the rules in place. A policy several ASes use keeps what they share, and
 * each AS with rules of its own gets a policy `<policy>-as<asn>` with them, which then calls it; its neighbors use that one. Then
 * takes the `communities` block off each neighbor and group: only Circuit reads it. Returns what is wrong, each starting with `at`.
 */
export function writeCommunities(network: Json, d: Json, at: (map: object | undefined, kind: string, key: string) => string): string[] {
    const found: string[] = [];
    const policies = d.routing?.policies ?? {};
    const bgp = d.routing?.bgp ?? {};
    const neighbors = neighborsOf(d);
    const s = network.communities;
    const blocks = [
        ...Object.entries<Json>(bgp.neighbor_groups ?? {}).map(([n, g]) => ["neighbor_groups", n, g]),
        ...Object.entries<Json>(bgp.neighbors ?? {}).map(([n, x]) => ["neighbors", n, x]),
    ];
    for (const [kind, n, x] of blocks) {
        if (!x.communities) continue;
        const where = `${kind}.${n}`;
        const here = at(bgp[kind], kind, n);
        if (!s) found.push(`${here}routing.bgp.${where}.communities: needs communities in circuit.ts.`);
        else
            for (const g of x.communities.groups ?? [])
                if (!s.groups?.[g])
                    found.push(
                        `${here}routing.bgp.${where}.communities: no group ${g} in communities.groups. The groups: ${Object.keys(s.groups ?? {}).join(", ") || "none"}.`
                    );
    }
    // A policy is written out only from blocks that are right.
    if (found.length) {
        for (const [, , x] of blocks) delete x.communities;
        return found;
    }

    for (const [p, rules] of Object.entries<Json[]>(policies)) {
        const written = rules.filter(isCommunities);
        if (!written.length) continue;
        const here = `${at(policies, "policies", p)}routing.policies.${p}: `;
        if (!s) {
            found.push(`${here}a communities rule needs communities in circuit.ts.`);
            continue;
        }
        const start = found.length;
        const kinds = [...new Set(written.map((r) => r.communities))];
        if (kinds.length > 1) found.push(`${here}holds an import and an export communities rule. A policy is one or the other.`);
        const kind: "import" | "export" = kinds[0];
        const other = kind === "import" ? "export" : "import";
        const wrong = neighbors.filter((n) => n[other] === p);
        if (wrong.length)
            found.push(
                `${here}has a communities ${kind} rule, but ${wrong.map((n) => n.name).join(", ")} use it as their ${other} policy.`
            );
        const users = neighbors.filter((n) => n[kind] === p);
        if (!users.length)
            found.push(
                `${here}no neighbor uses it as its ${kind} policy. Circuit writes a communities rule for the neighbors that use its policy, so it goes in a policy a neighbor names, not one another policy calls.`
            );
        for (const rule of written) {
            for (const r of rule.accept_requests ?? [])
                if (!REQUESTS.includes(r) || !(r === "prepend" ? s.prepend : s[r]))
                    found.push(
                        `${here}accept_requests: ${r} is no request of communities. It has: ${REQUESTS.filter((q) => (q === "prepend" ? s.prepend : s[q])).join(", ") || "none"}.`
                    );
            if (kind === "import" && rule.add_tags !== false && s.learned_at_site && network.sites?.[d.site]?.number === undefined)
                found.push(
                    `${here}learned_at_site tags each route with the site's number, but ${d.site} has none. Write number on it, in sites.`
                );
        }
        const ours = bgp.asn ?? network.asn;
        if (kind === "export")
            for (const n of users)
                if (n.asn === ours && written.some((r) => r.keep_ours === undefined))
                    found.push(
                        `${here}${n.name} is iBGP (AS${ours}), and its communities export doesn't write keep_ours. Write keep_ours: true to send our tags and requests on inside the network, or false to take them off.`
                    );
        for (const n of users) if (n.asn === undefined) found.push(`${here}${n.name} has no remote_as, which a communities rule needs.`);

        const byAs = new Map<number, typeof users>();
        for (const n of users) byAs.set(n.asn, [...(byAs.get(n.asn) ?? []), n]);
        const peer = (asn: number): Peer => {
            const [n] = byAs.get(asn)!;
            return { asn, groups: n!.groups, blackhole: n!.blackhole, customer: n!.customer, ibgp: asn === ours };
        };
        for (const [asn, ns] of byAs)
            if (new Set(ns.map((n) => JSON.stringify([n.groups, n.blackhole, n.customer]))).size > 1)
                found.push(
                    `${here}the neighbors of AS${asn} that use it (${ns.map((n) => n.name).join(", ")}) differ in their communities or role. Give them one neighbor group.`
                );
        const ases = [...byAs.keys()];
        if (ases.length > 1 && (written.length > 1 || !isCommunities(rules[0])))
            found.push(
                `${here}several ASes use it (${ases.map((a) => `AS${a}`).join(", ")}), so each one's own rules run first, in a policy of its own that then calls this one. Write its communities rule first, and once.`
            );
        if (found.length > start) continue;

        const site = network.sites?.[d.site]?.number;
        const asn = s.asn ?? network.asn;
        const groupsShared = new Set(users.map((n) => JSON.stringify(n.groups))).size === 1;
        const expand = (rule: Json, to: Peer) =>
            kind === "import" ? importRules(s, asn, rule, to, site, groupsShared) : exportRules(s, asn, rule, to, groupsShared);

        // A policy one AS uses: the rules in place.
        if (ases.length === 1) {
            policies[p] = rules.flatMap((r) => (isCommunities(r) ? expand(r, peer(ases[0]!)).all : [r]));
            continue;
        }

        // Several ASes: what they share once, in the policy, and each AS's own rules in a policy that runs first, then calls it.
        const parts = ases.map((a) => ({ asn: a, ...expand(rules[0], peer(a)) }));
        if (new Set(parts.map((x) => JSON.stringify(x.shared))).size > 1) {
            found.push(`${here}its ASes share no common rules. Give each AS a policy of its own.`);
            continue;
        }
        policies[p] = [...parts[0]!.shared, ...rules.slice(1)];
        const field = kind === "import" ? "import_policy" : "export_policy";
        // The ASes of the neighbors that take the policy from each group, before any of them changes.
        const fromGroup = new Map<object, Set<number>>();
        for (const u of users) if (u.x[field] === undefined) fromGroup.set(u.group, (fromGroup.get(u.group) ?? new Set()).add(u.asn));
        for (const { asn: a, own } of parts) {
            if (!own.length) continue;
            const name = `${p}-as${a}`;
            if (policies[name]) found.push(`${here}AS${a}'s own policy would be ${name}, which is taken.`);
            policies[name] = [...own, { call: p }];
            // Its neighbors use it: on their group, when every neighbor that takes the policy from the group is of this AS.
            for (const n of byAs.get(a)!) {
                if (n.x[field] !== undefined || fromGroup.get(n.group)!.size > 1) n.x[field] = name;
                else n.group[field] = name;
            }
        }
    }

    for (const [, , x] of blocks) delete x.communities;
    return found;
}
