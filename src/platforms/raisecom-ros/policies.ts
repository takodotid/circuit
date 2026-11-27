// Route policies on Raisecom ROS: each policy a route-map with an entry per rule, and the prefix lists, community lists, and AS path lists its entries match. A RAX721 on ROS 6.5.2 took each and printed it as written here (TRAPS.md). BGP carries IPv4 alone here, so only IPv4 prefixes are written.

import { Address } from "../../core/address";
import { Derive } from "../../core/derive";
import type { AsNumbers, Device, PolicyRule, Prefix, PrefixSet, RouteMatch, RouteRule, RouteSet } from "../../model";

/** A rule as a route-map entry: its sequence number in its policy and the rule. */
type Entry = { sequence: number; rule: RouteRule };

export class RaisecomRosPolicies {
    /** The route-map of a session that gives no policy. Without one, the switch takes and announces every route. */
    static readonly REJECT_ALL = "circuit-reject-all";

    /** A line the render writes for a prefix set from a registry it did not fetch. The plan keeps what the device holds of it. */
    static readonly UNFETCHED = "!Fetched by circuit diff and apply: ip prefix-list ";

    /** The route match fields that hold AS numbers. */
    static readonly AS_FIELDS = ["as_path_contains", "first_as", "origin_as"] as const;

    /** AS path lists are numbered, 1 to 500. */
    static readonly AS_PATH_LISTS = { min: 1, max: 500 };

    /** The longest name of a route-map or a prefix list, and of a community list, and the longest description of an entry. */
    static readonly NAME_MAX = 20;
    static readonly COMMUNITY_LIST_MAX = 32;
    static readonly DESCRIPTION_MAX = 80;

    /** Entries of a route-map and of a list are numbered in steps of 10. */
    private static readonly STEP = 10;

    private static readonly IPV4_BITS = 32;

    /** The two halves of the IPv4 space. The switch keeps no range of lengths on `0.0.0.0/0`, so a range of every route's lengths is written on each half. */
    private static readonly HALVES = ["0.0.0.0/1", "128.0.0.0/1"] as const;

    /** Where in the AS path each AS field looks, in an AS path list's regular expression: anywhere, at the start, at the end. `_` stands for a space, the start, or the end. */
    private static readonly AS_ANCHORS = {
        as_path_contains: { before: "_", after: "_" },
        first_as: { before: "^", after: "_" },
        origin_as: { before: "_", after: "$" },
    } as const;

    /** The lines of each list, by its name, each written once. */
    private readonly lists = new Map<string, string[]>();

    /** Each AS path list's number, by its regular expressions. */
    private readonly asPaths = new Map<string, number>();

    private constructor(private readonly device: Device) {}

    /** The prefix lists of `routing.prefix_sets`, then the lists and route-maps of `policies`, each named once. */
    static lines(device: Device, policies: readonly string[]): string[] {
        const writer = new RaisecomRosPolicies(device);
        const routeMaps = policies.flatMap((policy) => writer.routeMap(policy));
        const sets = Object.entries(device.routing?.prefix_sets ?? {}).flatMap(([name, set]) =>
            set ? RaisecomRosPolicies.setLines(name, set) : []
        );

        return [...sets, ...[...writer.lists.values()].flat(), ...routeMaps];
    }

    /** How many AS path lists the policies need, one for each distinct AS match. */
    static asPathLists(device: Device, policies: readonly string[]): number {
        const writer = new RaisecomRosPolicies(device);
        for (const policy of policies) writer.routeMap(policy);
        return writer.asPaths.size;
    }

    /** A rule on routes: neither a call nor a communities rule. */
    static isRouteRule(rule: PolicyRule): rule is RouteRule {
        return !("call" in rule && rule.call !== undefined) && !("communities" in rule && rule.communities !== undefined);
    }

    /** A policy's rules with each call replaced by the rules it calls, in order, numbered as route-map entries. */
    static entries(device: Device, policy: string): Entry[] {
        return RaisecomRosPolicies.flatten(device, policy, [policy]).map((rule, index) => ({
            sequence: (index + 1) * RaisecomRosPolicies.STEP,
            rule,
        }));
    }

    /** Written as a list or as a map of named prefixes. A set from a registry has none until `diff` or `apply` fetches it. */
    static prefixesOf(set: PrefixSet): Prefix[] {
        if (!("prefixes" in set)) return [];
        return Array.isArray(set.prefixes) ? [...(set.prefixes as readonly Prefix[])] : Object.values(set.prefixes);
    }

    /** Whether a set holds IPv4 prefixes, the only ones a policy sees here. A set from a registry holds its source's family. */
    static holdsIpv4(set: PrefixSet): boolean {
        if ("source" in set) return set.source.family === "ipv4";
        return RaisecomRosPolicies.prefixesOf(set).some((prefix) => Address.family(Address.host(prefix)) === "ipv4");
    }

    /** The conditions of a rule that each need a prefix list. An entry matches one prefix list. */
    static prefixConditions(match: RouteMatch): ("prefix" | "prefix_set" | "prefix_length")[] {
        return (["prefix", "prefix_set", "prefix_length"] as const).filter((key) => match[key] !== undefined);
    }

    /**
     * A prefix as the switch prints it in a list, with the lengths from `from` to `to`: `0.0.0.0/0` alone is `default`, and with every length `any`. `le` is printed only above the prefix's length, and `le 32` not beside `ge`.
     */
    static entry(prefix: Prefix, from: number, to: number): string {
        const { addr, len } = Address.split(prefix);
        const bits = RaisecomRosPolicies.IPV4_BITS;
        if (len === 0 && from === 0) return to === bits ? "any" : "default";
        if (from === len && to === len) return `${addr}/${len}`;
        if (from === len) return `${addr}/${len} le ${to}`;
        return `${addr}/${len} ge ${from}${to === bits ? "" : ` le ${to}`}`;
    }

    /** A set's IPv4 prefixes, each with every more specific prefix inside it. A set from a registry not fetched, as Studio renders it, is a line the plan reads so that it keeps what the device holds. */
    private static setLines(name: string, set: PrefixSet): string[] {
        if ("source" in set) return set.source.family === "ipv4" ? [`${RaisecomRosPolicies.UNFETCHED}${name}`] : [];

        const ipv4 = RaisecomRosPolicies.prefixesOf(set).filter((prefix) => Address.family(Address.host(prefix)) === "ipv4");
        return ipv4.map((prefix, index) => {
            const { len } = Address.split(prefix);
            const sequence = (index + 1) * RaisecomRosPolicies.STEP;
            return `ip prefix-list ${name} seq ${sequence} permit ${RaisecomRosPolicies.entry(prefix, len, RaisecomRosPolicies.IPV4_BITS)}`;
        });
    }

    private static flatten(device: Device, policy: string, seen: string[]): RouteRule[] {
        const flat: RouteRule[] = [];

        for (const rule of device.routing?.policies?.[policy] ?? []) {
            if ("call" in rule && rule.call !== undefined) {
                if (!seen.includes(rule.call)) flat.push(...RaisecomRosPolicies.flatten(device, rule.call, [...seen, rule.call]));
                continue;
            }

            // A communities rule is not written here. `unsupported()` names it.
            if (RaisecomRosPolicies.isRouteRule(rule) && (rule.if || rule.set || rule.then)) flat.push(rule);
        }

        return flat;
    }

    /** One policy, an entry per rule. A route no entry permits is denied, so a policy with no rule is one entry that denies. */
    private routeMap(policy: string): string[] {
        const entries = RaisecomRosPolicies.entries(this.device, policy);
        if (!entries.length) return [`route-map ${policy} deny ${RaisecomRosPolicies.STEP}`, "!"];

        return [
            ...entries.flatMap(({ sequence, rule }) => [
                `route-map ${policy} ${rule.then === "reject" ? "deny" : "permit"} ${sequence}`,
                ...this.lines(policy, sequence, rule).map((line) => ` ${line}`),
            ]),
            "!",
        ];
    }

    /** What an entry matches and, when it permits, what it changes. Its `match` lines must all match. */
    private lines(policy: string, sequence: number, rule: RouteRule): string[] {
        const match = rule.if ?? {};
        const lines = rule.description ? [`description ${rule.description}`] : [];

        const list = this.prefixList(match);
        if (list) lines.push(`match ip address prefix-list ${list}`);

        // A route matches when it has any one of the communities, each a list of its own.
        const communities = [match.standard_community ?? []].flat().map((value) => this.communityList(value));
        if (communities.length) lines.push(`match community ${communities.join(" ")}`);

        const field = RaisecomRosPolicies.AS_FIELDS.find((each) => match[each] !== undefined);
        if (field) lines.push(`match as-path ${this.asPathList(field, match[field]!)}`);

        // An entry that denies changes nothing.
        if (rule.then !== "reject") lines.push(...this.sets(policy, sequence, rule.set ?? {}));
        return lines;
    }

    /** The changes. Replacing the communities removes every other one. */
    private sets(policy: string, sequence: number, set: RouteSet): string[] {
        const lines: string[] = [];

        if (set.local_pref !== undefined) lines.push(`set local-preference ${set.local_pref}`);
        if (set.med !== undefined) lines.push(`set metric ${set.med}`);
        if (set.next_hop) lines.push(`set ip next-hop ${set.next_hop}`);

        // Our own AS: `unsupported()` refuses a prepend without one.
        const asn = this.device.routing?.bgp?.asn;
        if (set.prepend !== undefined && asn !== undefined)
            lines.push(`set as-path prepend ${Array<number>(set.prepend).fill(asn).join(" ")}`);

        const removed = set.standard_communities ? [] : (set.remove_standard_communities ?? []);
        if (removed.length) lines.push(`set comm-list ${this.removalList(policy, sequence, removed)} delete`);

        const unique = (values: readonly string[]) => [...new Set(values)].join(" ");
        if (set.standard_communities) {
            const all = [...set.standard_communities, ...(set.add_standard_communities ?? [])];
            lines.push(all.length ? `set community ${unique(all)}` : "set community none");
        } else if (set.add_standard_communities?.length) {
            lines.push(`set community ${unique(set.add_standard_communities)} additive`);
        }

        return lines;
    }

    /** The prefix list an entry matches, from its prefix, prefix set, or prefix lengths: a set's own list, or one written here once. None for every IPv4 route. `unsupported()` refuses two of them in one rule. */
    private prefixList(match: RouteMatch): string | undefined {
        if (match.prefix_set) return match.prefix_set;

        if (match.prefix) {
            const name = `p-${Address.canonical(match.prefix).replace("/", "-")}`;
            const { len } = Address.split(match.prefix);
            this.lists.set(name, [
                `ip prefix-list ${name} seq ${RaisecomRosPolicies.STEP} permit ${RaisecomRosPolicies.entry(match.prefix, len, len)}`,
            ]);
            return name;
        }

        if (!match.prefix_length) return undefined;
        const bits = RaisecomRosPolicies.IPV4_BITS;
        const min = match.prefix_length.min ?? 0;
        const max = Math.min(match.prefix_length.max ?? bits, bits);
        if (min === 0 && max === bits) return undefined;

        const name = `len-${min}-${max}`;
        const entries = min === 0 ? ["default"] : [];
        const from = Math.max(min, 1);
        for (const half of RaisecomRosPolicies.HALVES) if (from <= max) entries.push(RaisecomRosPolicies.entry(half, from, max));

        this.lists.set(
            name,
            entries.map((entry, index) => `ip prefix-list ${name} seq ${(index + 1) * RaisecomRosPolicies.STEP} permit ${entry}`)
        );
        return name;
    }

    /** A list that matches one community, named after it: `circuit-64500-100`. */
    private communityList(value: string): string {
        const name = `circuit-${value.replace(":", "-")}`;
        this.lists.set(name, [`ip community-list standard ${name} permit ${value}`]);
        return name;
    }

    /** A list with an entry for each community to remove, for the entry at `sequence` of `policy`. */
    private removalList(policy: string, sequence: number, values: readonly string[]): string {
        const name = `del-${policy}-${sequence}`;
        this.lists.set(
            name,
            values.map((value) => `ip community-list standard ${name} permit ${value}`)
        );
        return name;
    }

    /** An AS path list that permits a path with one of the ASes where the field looks, a regular expression for each run of numbers. Lists are numbered in the order the policies first use them. */
    private asPathList(field: (typeof RaisecomRosPolicies.AS_FIELDS)[number], numbers: AsNumbers): number {
        const { before, after } = RaisecomRosPolicies.AS_ANCHORS[field];
        const patterns = Derive.asRanges(numbers)
            .flatMap(({ min, max }) => Derive.numberPatterns(min, max))
            .map((pattern) => `${before}${pattern}${after}`);
        const key = patterns.join(" ");

        let number = this.asPaths.get(key);
        if (number === undefined) {
            number = RaisecomRosPolicies.AS_PATH_LISTS.min + this.asPaths.size;
            this.asPaths.set(key, number);
            this.lists.set(
                `as-path ${number}`,
                patterns.map((pattern) => `ip as-path access-list ${number} permit ${pattern}`)
            );
        }

        return number;
    }
}
