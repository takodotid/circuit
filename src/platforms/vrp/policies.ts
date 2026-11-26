// Route policies on VRP: each policy a `route-policy` with a node per rule, and the prefix lists and filters its nodes match on. The commands are from Huawei's CloudEngine command reference; a CE6855 on V200R005C00SPC800 showed which of them it has and how it prints them.

import { Address } from "../../core/address";
import { Derive } from "../../core/derive";
import type { AsNumbers, Device, Family, PolicyRule, Prefix, PrefixSet, RouteMatch, RouteRule, RouteSet } from "../../model";

/** The prefix list a node matches the routes of each family with. A family without one passes the node. */
type FamilyLists = Partial<Record<Family, string>>;

/** A rule as a node: its place in its policy and the rule. */
type Node = { number: number; rule: RouteRule };

export class VrpPolicies {
    /** Lists that only deny. A route of the list's family never matches a node that uses one, and a route of the other family passes it. A node checks each family's routes against that family's list only, and a list that only denies matches nothing (the route-policy reference). */
    static readonly NO_ROUTE: Readonly<Record<Family, string>> = { ipv4: "circuit-no-ipv4", ipv6: "circuit-no-ipv6" };

    /** The policy of a session that states none. Without a policy, VRP takes and announces every route. */
    static readonly REJECT_ALL = "circuit-reject-all";

    /** A line the render writes for a prefix set from a registry it did not fetch. The switch's own `!` lines are never compared. */
    static readonly UNFETCHED = "!Fetched by circuit diff and apply: ";

    /** The longest name of an AS path or a community filter. */
    static readonly FILTER_NAME = 51;

    /** The longest description of a node. */
    static readonly DESCRIPTION = 80;

    /** The most communities one `apply community` takes. */
    static readonly COMMUNITIES = 32;

    /** The route match fields that hold AS numbers. */
    static readonly AS_FIELDS = ["as_path_contains", "first_as", "origin_as"] as const;

    /** Nodes and the entries of a list are numbered in steps of 10, as the switch numbers them. */
    private static readonly STEP = 10;

    private static readonly LIST = { ipv4: "ip ip-prefix", ipv6: "ip ipv6-prefix" } as const;
    private static readonly IF_MATCH = { ipv4: "if-match ip-prefix", ipv6: "if-match ipv6 address prefix-list" } as const;
    private static readonly NEXT_HOP = { ipv4: "apply ip-address next-hop", ipv6: "apply ipv6 next-hop" } as const;

    /** The address that stands for every route of a family in a list entry, with a range of lengths. */
    private static readonly ANY = { ipv4: "0.0.0.0", ipv6: "::" } as const;

    /** Where in the AS path each AS field looks, in an AS path filter's regular expression: anywhere, at the start, at the end. `_` stands for a space, the start, or the end. */
    private static readonly AS_ANCHORS = {
        as_path_contains: { before: "_", after: "_" },
        first_as: { before: "^", after: "_" },
        origin_as: { before: "_", after: "$" },
    } as const;

    private static readonly FAMILIES = ["ipv4", "ipv6"] as const;

    /** Well-known communities (RFC 1997), which the switch prints by name: `65535:65281` prints as `no-export`. */
    private static readonly WELL_KNOWN: Readonly<Record<string, string>> = {
        "65535:65281": "no-export",
        "65535:65282": "no-advertise",
        "65535:65283": "no-export-subconfed",
    };

    /** The lines of each list and filter, by name, each written once. */
    private readonly lists = new Map<string, string[]>();

    private constructor(private readonly device: Device) {}

    /** The prefix lists of `routing.prefix_sets`, then the lists, filters, and route-policies of `policies`, each named once. */
    static lines(device: Device, policies: readonly string[]): string[] {
        const writer = new VrpPolicies(device);
        const blocks = policies.flatMap((policy) => writer.policy(policy));
        const sets = Object.entries(device.routing?.prefix_sets ?? {}).flatMap(([name, set]) =>
            set ? VrpPolicies.setLines(name, set) : []
        );
        const lists = [...writer.lists.values()].flat();
        const top = [...sets, ...lists];

        return [...(top.length ? [...top, "#"] : []), ...blocks];
    }

    /** IPv6 addresses print in capitals. */
    static spell(address: string): string {
        return Address.family(Address.host(address)) === "ipv6" ? Address.canonical(address).toUpperCase() : address;
    }

    /** Written as a list or as a map of named prefixes. A set from a registry has none until `diff` or `apply` fetches it. */
    static prefixesOf(set: PrefixSet): Prefix[] {
        if (!("prefixes" in set)) return [];

        return Array.isArray(set.prefixes) ? [...(set.prefixes as readonly Prefix[])] : Object.values(set.prefixes);
    }

    /** A rule on routes: neither a call nor a communities rule. */
    static isRouteRule(rule: PolicyRule): rule is RouteRule {
        return !("call" in rule && rule.call !== undefined) && !("communities" in rule && rule.communities !== undefined);
    }

    /** A policy's rules with each call replaced by the rules it calls, in order, numbered as nodes. */
    static nodes(device: Device, policy: string): Node[] {
        return VrpPolicies.flatten(device, policy, [policy]).map((rule, index) => ({ number: (index + 1) * VrpPolicies.STEP, rule }));
    }

    /**
     * The list each family's routes are matched with, from the rule's family, prefix, prefix set, and prefix length. Where two of them want different lists for one family, `conflict` gives both, the later first: one node takes one list per family.
     */
    static familyLists(device: Device, match: RouteMatch): { lists: FamilyLists; conflict?: string } {
        const wanted: { key: string; lists: FamilyLists }[] = [];

        if (match.family) wanted.push({ key: "family", lists: VrpPolicies.only(match.family) });
        if (match.prefix) {
            const family = Address.family(Address.host(match.prefix));
            wanted.push({ key: "prefix", lists: { ...VrpPolicies.only(family), [family]: VrpPolicies.prefixName(match.prefix) } });
        }

        const set = match.prefix_set ? device.routing?.prefix_sets?.[match.prefix_set] : undefined;
        if (match.prefix_set && set) {
            const families = VrpPolicies.familiesOf(set);
            const lists = Object.fromEntries(
                VrpPolicies.FAMILIES.map((family) => [family, families.has(family) ? match.prefix_set : VrpPolicies.NO_ROUTE[family]])
            );
            wanted.push({ key: "prefix_set", lists });
        }

        if (match.prefix_length) {
            const lists = Object.fromEntries(VrpPolicies.FAMILIES.map((family) => [family, VrpPolicies.lengthName(family, match)]));
            wanted.push({ key: "prefix_length", lists });
        }

        const lists: FamilyLists = {};
        const from: Partial<Record<Family, string>> = {};

        for (const { key, lists: each } of wanted) {
            for (const family of VrpPolicies.FAMILIES) {
                const list = each[family];
                const had = lists[family];
                if (!list || had === list || had === VrpPolicies.NO_ROUTE[family]) continue;

                if (had && list !== VrpPolicies.NO_ROUTE[family]) return { lists, conflict: `${key}, with ${from[family]}` };
                lists[family] = list;
                from[family] = key;
            }
        }

        return { lists };
    }

    /** The name of an AS path filter or a removal filter of a node, which a filter name of at most `FILTER_NAME` characters holds. */
    static filterName(kind: "path" | "remove", policy: string, number: number): string {
        return `circuit-${kind}-${policy}-${number}`;
    }

    /** The families a set holds prefixes of. A set from a registry holds its source's. */
    private static familiesOf(set: PrefixSet): Set<Family> {
        if ("source" in set) return new Set([set.source.family]);
        return new Set(VrpPolicies.prefixesOf(set).map((prefix) => Address.family(Address.host(prefix))));
    }

    /** The lists that keep a node to one family: the other family's routes never match it. */
    private static only(family: Family): FamilyLists {
        const other = family === "ipv4" ? "ipv6" : "ipv4";
        return { [other]: VrpPolicies.NO_ROUTE[other] };
    }

    /** The list of one prefix, named after it: `circuit-prefix-198.51.100.0-24`. */
    private static prefixName(prefix: Prefix): string {
        return `circuit-prefix-${Address.canonical(prefix).replace(/[:/]/g, "-")}`;
    }

    /** The list of a range of lengths in one family, or the family's `NO_ROUTE` when its routes are never that long. */
    private static lengthName(family: Family, match: RouteMatch): string {
        const { min, max } = VrpPolicies.lengthRange(family, match);
        return min > max ? VrpPolicies.NO_ROUTE[family] : `circuit-length-${min}-${max}`;
    }

    private static lengthRange(family: Family, match: RouteMatch): { min: number; max: number } {
        const bits = Address.bits(family);
        return { min: match.prefix_length?.min ?? 0, max: Math.min(match.prefix_length?.max ?? bits, bits) };
    }

    /**
     * An entry of a list, as the switch prints it: `198.51.100.0 24 greater-equal 24 less-equal 32`. One length alone is the exact prefix, `192.0.2.0 24`, and a lower bound of 0 is not printed.
     */
    static entry(address: string, length: number, from: number, to: number): string {
        if (from === length && to === length) return `${VrpPolicies.spell(address)} ${length}`;
        return `${VrpPolicies.spell(address)} ${length}${from ? ` greater-equal ${from}` : ""} less-equal ${to}`;
    }

    /** A set's prefixes, each with every more specific prefix inside it, in a list for each family it holds. A set from a registry not fetched, as Studio renders it, is a line the plan reads so that it keeps what the device holds. */
    private static setLines(name: string, set: PrefixSet): string[] {
        if ("source" in set) return [`${VrpPolicies.UNFETCHED}${VrpPolicies.LIST[set.source.family]} ${name}`];
        const counts = { ipv4: 0, ipv6: 0 };

        return VrpPolicies.prefixesOf(set).map((prefix) => {
            const { addr, len, family } = Address.split(prefix);
            const index = ++counts[family] * VrpPolicies.STEP;
            return `${VrpPolicies.LIST[family]} ${name} index ${index} permit ${VrpPolicies.entry(addr, len, len, Address.bits(family))}`;
        });
    }

    private static flatten(device: Device, policy: string, seen: string[]): RouteRule[] {
        const flat: RouteRule[] = [];

        for (const rule of device.routing?.policies?.[policy] ?? []) {
            if ("call" in rule && rule.call !== undefined) {
                if (!seen.includes(rule.call)) flat.push(...VrpPolicies.flatten(device, rule.call, [...seen, rule.call]));
                continue;
            }

            // A communities rule is not written here. `unsupported()` names it.
            if (VrpPolicies.isRouteRule(rule) && (rule.if || rule.set || rule.then)) flat.push(rule);
        }

        return flat;
    }

    /** One policy, a node per rule. A route no node permits is denied, so a policy with no rule is one node that denies. */
    private policy(policy: string): string[] {
        const nodes = VrpPolicies.nodes(this.device, policy);
        if (!nodes.length) return [`route-policy ${policy} deny node ${VrpPolicies.STEP}`, "#"];

        return nodes.flatMap(({ number, rule }) => [
            `route-policy ${policy} ${rule.then === "reject" ? "deny" : "permit"} node ${number}`,
            ...this.node(policy, number, rule).map((line) => ` ${line}`),
            "#",
        ]);
    }

    /** What a node matches and, when it permits, what it changes. Its `if-match` clauses must all match. */
    private node(policy: string, number: number, rule: RouteRule): string[] {
        const match = rule.if ?? {};
        const lines = rule.description ? [`description ${rule.description}`] : [];
        const { lists } = VrpPolicies.familyLists(this.device, match);

        for (const family of VrpPolicies.FAMILIES) {
            const list = lists[family];
            if (!list) continue;

            this.list(family, list, match);
            lines.push(`${VrpPolicies.IF_MATCH[family]} ${list}`);
        }

        const field = VrpPolicies.AS_FIELDS.find((each) => match[each] !== undefined);
        if (field) lines.push(`if-match as-path-filter ${this.asPathFilter(policy, number, field, match[field]!)}`);

        // Clauses on communities match a route that has any one of them.
        for (const value of [match.standard_community ?? []].flat()) lines.push(`if-match community-filter ${this.communityFilter(value)}`);

        // A node that denies changes nothing.
        if (rule.then !== "reject") lines.push(...this.applies(policy, number, rule.set ?? {}));
        return lines;
    }

    /** The changes, in the order the switch prints them. It removes communities before it sets them. */
    private applies(policy: string, number: number, set: RouteSet): string[] {
        const lines: string[] = [];

        if (set.prepend !== undefined) {
            const asn = this.device.routing!.bgp!.asn!;
            lines.push(`apply as-path ${Array<number>(set.prepend).fill(asn).join(" ")} additive`);
        }

        const nextHop = set.next_hop ? Address.family(set.next_hop) : undefined;
        if (nextHop === "ipv4") lines.push(`${VrpPolicies.NEXT_HOP.ipv4} ${set.next_hop}`);
        if (set.local_pref !== undefined) lines.push(`apply local-preference ${set.local_pref}`);
        if (set.med !== undefined) lines.push(`apply cost ${set.med}`);
        if (nextHop === "ipv6") lines.push(`${VrpPolicies.NEXT_HOP.ipv6} ${VrpPolicies.spell(set.next_hop!)}`);

        // Replacing the communities removes every other one.
        const removed = set.standard_communities ? [] : (set.remove_standard_communities ?? []);
        if (removed.length) lines.push(`apply comm-filter ${this.removalFilter(policy, number, removed)} delete`);

        const spelled = (values: readonly string[]) => [...new Set(values)].map(VrpPolicies.community).join(" ");
        if (set.standard_communities) {
            const all = [...set.standard_communities, ...(set.add_standard_communities ?? [])];
            lines.push(all.length ? `apply community ${spelled(all)}` : "apply community none");
        } else if (set.add_standard_communities?.length) {
            lines.push(`apply community ${spelled(set.add_standard_communities)} additive`);
        }

        return lines;
    }

    /** Writes the list a node names, once. A set's own lists are written from `routing.prefix_sets`. */
    private list(family: Family, name: string, match: RouteMatch): void {
        const command = VrpPolicies.LIST[family];
        const key = `${command} ${name}`;
        if (this.lists.has(key) || name === match.prefix_set) return;

        const bits = Address.bits(family);
        const any = VrpPolicies.ANY[family];
        const first = `${command} ${name} index ${VrpPolicies.STEP}`;

        if (name === VrpPolicies.NO_ROUTE[family]) this.lists.set(key, [`${first} deny ${VrpPolicies.entry(any, 0, 0, bits)}`]);
        else if (match.prefix && name === VrpPolicies.prefixName(match.prefix)) {
            const { addr, len } = Address.split(match.prefix);
            this.lists.set(key, [`${first} permit ${VrpPolicies.entry(addr, len, len, len)}`]);
        } else {
            const { min, max } = VrpPolicies.lengthRange(family, match);
            this.lists.set(key, [`${first} permit ${VrpPolicies.entry(any, 0, min, max)}`]);
        }
    }

    /** An AS path filter that permits a path with one of the ASes where the field looks, a regular expression for each run of numbers. */
    private asPathFilter(policy: string, number: number, field: (typeof VrpPolicies.AS_FIELDS)[number], numbers: AsNumbers): string {
        const name = VrpPolicies.filterName("path", policy, number);
        const { before, after } = VrpPolicies.AS_ANCHORS[field];
        const patterns = Derive.asRanges(numbers).flatMap(({ min, max }) => Derive.numberPatterns(min, max));

        this.lists.set(
            `ip as-path-filter ${name}`,
            patterns.map(
                (pattern, index) => `ip as-path-filter ${name} index ${(index + 1) * VrpPolicies.STEP} permit ${before}${pattern}${after}`
            )
        );
        return name;
    }

    /** A community as the switch prints it. */
    private static community(value: string): string {
        return VrpPolicies.WELL_KNOWN[value] ?? value;
    }

    /** A filter that matches one community, named after it: `circuit-64500-100`. */
    private communityFilter(value: string): string {
        const name = `circuit-${value.replace(":", "-")}`;
        const entry = `index ${VrpPolicies.STEP} permit ${VrpPolicies.community(value)}`;
        this.lists.set(`ip community-filter ${name}`, [`ip community-filter basic ${name} ${entry}`]);
        return name;
    }

    /** A filter with an entry for each community to remove. A filter whose entry holds several removes none of them (the `apply comm-filter delete` reference). */
    private removalFilter(policy: string, number: number, values: readonly string[]): string {
        const name = VrpPolicies.filterName("remove", policy, number);
        this.lists.set(
            `ip community-filter ${name}`,
            values.map(
                (value, index) =>
                    `ip community-filter basic ${name} index ${(index + 1) * VrpPolicies.STEP} permit ${VrpPolicies.community(value)}`
            )
        );
        return name;
    }
}
