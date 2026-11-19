// BGP's policies become route maps, prefix lists, and community lists.

import { Address } from "../../core/address";
import { Derive } from "../../core/derive";
import { Secrets } from "../../core/secrets";
import type { Device, Family, Neighbor, NeighborSettings, OspfArea, PolicyRule, PrefixSet, RouteMatch, RouteRule } from "../../model";
import { FortiOsNames } from "./names";
import type { FortiOsNode } from "./tree";
import { FortiOsTree } from "./tree";

/** The lengths a prefix list's rule takes within its prefix. */
type Lengths = { ge?: number; le?: number };

/** Each policy as a route map for each family, built once, with the lists its rules match. */
class RouteMaps {
    private readonly built = new Set<string>();

    constructor(
        private readonly root: FortiOsNode,
        private readonly device: Device
    ) {}

    /** A name made of a value's words, for a list named after what it matches: `64500:*` becomes `64500-any`. */
    private static slug(value: string): string {
        return value.replace(/\*/g, "any").replace(/[^A-Za-z0-9]+/g, "-");
    }

    /** A community pattern as a regular expression, `*` standing for any value of its field. */
    private static patternOf(pattern: string): string {
        return `^${pattern.replace(/\*/g, "[0-9]+")}$`;
    }

    /** The route map for a policy in one family; one that rejects everything when there is no policy. */
    of(policy: string | undefined, family: Family): string {
        if (!policy) {
            if (!this.built.has(FortiOsRouting.REJECT_ALL)) {
                this.built.add(FortiOsRouting.REJECT_ALL);
                this.root.block("router route-map").entry(FortiOsRouting.REJECT_ALL).block("rule").entry(1).set("action", "deny");
            }

            return FortiOsRouting.REJECT_ALL;
        }

        const name = family === "ipv4" ? policy : `${policy}-v6`;
        if (this.built.has(name)) return name;
        this.built.add(name);

        const map = this.root.block("router route-map").entry(name);
        let number = 0;

        for (const rule of FortiOsRouting.flatten(this.device, policy)) {
            const only = FortiOsRouting.familyOfRule(this.device, rule);
            if (only && only !== family) continue;

            this.rule(map.block("rule").entry(++number), rule, family, `${name}-${number}`);
        }

        return name;
    }

    private rule(entry: FortiOsNode, rule: RouteRule, family: Family, label: string): void {
        const match = rule.if ?? {};
        const set = rule.set ?? {};
        const address = family === "ipv4" ? "match-ip-address" : "match-ip6-address";
        const bits = FortiOsRouting.BITS[family];

        if (match.prefix) {
            this.list(label, family, [[match.prefix, {}]]);
            entry.set(address, FortiOsTree.quote(label));
        } else if (match.prefix_set && match.prefix_length) {
            const name = `${match.prefix_set}-${match.prefix_length.min ?? 0}-${match.prefix_length.max ?? bits}`;
            const prefixes = this.prefixesOf(match.prefix_set);
            this.list(
                name,
                family,
                prefixes.map((prefix) => [
                    prefix,
                    FortiOsRouting.bounds(prefix, family, match.prefix_length?.min, match.prefix_length?.max),
                ])
            );
            entry.set(address, FortiOsTree.quote(name));
        } else if (match.prefix_set) {
            entry.set(address, FortiOsTree.quote(match.prefix_set));
        } else if (match.prefix_length) {
            const { min = 0, max = bits } = match.prefix_length;
            const name = `circuit-length-${min}-${max}`;
            const everything = family === "ipv4" ? "0.0.0.0/0" : "::/0";
            this.list(name, family, [[everything, FortiOsRouting.bounds(everything, family, min, max)]]);
            entry.set(address, FortiOsTree.quote(name));
        }

        const asPath = FortiOsRouting.asPathRegexes(match);
        if (asPath.length) entry.set("match-as-path", FortiOsTree.quote(this.asPathList(label, asPath)));

        if (match.standard_community) {
            // A list takes the rule's name: one named after its values would pass the 35 characters a name may have.
            const values = [match.standard_community].flat();
            const name = values.length === 1 ? `circuit-match-${RouteMaps.slug(values[0]!)}` : label;
            const patterns = values.some((value) => value.includes("*"));
            entry.set("match-community", FortiOsTree.quote(this.communities(name, values, patterns)));
        }

        if (set.local_pref !== undefined) entry.set("set-local-preference", set.local_pref);
        if (set.med !== undefined) entry.set("set-metric", set.med);
        if (set.prepend !== undefined)
            entry.set("set-aspath", FortiOsTree.quote(Array(set.prepend).fill(this.device.routing?.bgp?.asn).join(" ")));

        // Replacing the communities makes removing some needless; added ones join the new ones.
        if (set.standard_communities) {
            entry.set("set-community", FortiOsTree.quoteAll([...set.standard_communities, ...(set.add_standard_communities ?? [])]));
        } else {
            if (set.add_standard_communities)
                entry.set("set-community", FortiOsTree.quoteAll(set.add_standard_communities)).set("set-community-additive", "enable");

            if (set.remove_standard_communities) {
                const name = `circuit-remove-${RouteMaps.slug(set.remove_standard_communities.join(" "))}`;
                entry.set("set-community-delete", FortiOsTree.quote(this.communities(name, set.remove_standard_communities, true)));
            }
        }

        if (set.next_hop && Address.family(set.next_hop) === family)
            entry.set(family === "ipv4" ? "set-ip-nexthop" : "set-ip6-nexthop", set.next_hop);

        // Permit is the default and is not printed.
        if (rule.then === "reject") entry.set("action", "deny");
    }

    private prefixesOf(set: string): string[] {
        return FortiOsRouting.listed(this.device.routing?.prefix_sets?.[set]) ?? [];
    }

    /** A prefix list of its own, rule by rule; a prefix no length fits is left out. */
    private list(name: string, family: Family, rules: [string, Lengths | undefined][]): void {
        const rulesBlock = this.root.block(FortiOsRouting.PREFIX_LIST[family]).entry(name).block("rule");
        let number = 0;

        for (const [prefix, lengths] of rules) if (lengths) FortiOsRouting.listRule(rulesBlock.entry(++number), family, prefix, lengths);
    }

    /** An AS path list that permits a route any of these regular expressions matches. */
    private asPathList(name: string, regexes: readonly string[]): string {
        const rules = this.root.block("router aspath-list").entry(name).block("rule");
        regexes.forEach((regexp, index) =>
            rules
                .entry(index + 1)
                .set("action", "permit")
                .set("regexp", FortiOsTree.quote(regexp))
        );
        return name;
    }

    /** A community list matching any of these communities, one rule each, or, expanded, any of these patterns. */
    private communities(name: string, values: readonly string[], patterns: boolean): string {
        const list = this.root.block("router community-list").entry(name);
        if (patterns) list.set("type", "expanded");

        values.forEach((value, index) => {
            const rule = list
                .block("rule")
                .entry(index + 1)
                .set("action", "permit");
            if (patterns) rule.set("regexp", FortiOsTree.quote(RouteMaps.patternOf(value)));
            else rule.set("match", FortiOsTree.quote(value));
        });

        return name;
    }
}

export class FortiOsRouting {
    /** The route map a session takes when its config states none, so it learns or announces nothing. */
    static readonly REJECT_ALL = "circuit-reject-all";

    /** The start of the comment on a prefix list `refresh` fills. The plan keeps the entries the device holds in one. */
    static readonly FILLED = "Filled by circuit refresh";

    static readonly PREFIX_LIST = { ipv4: "router prefix-list", ipv6: "router prefix-list6" } as const;

    /** The longest prefix of each family. */
    static readonly BITS = { ipv4: 32, ipv6: 128 } as const;

    /** The route match fields that hold AS numbers. */
    private static readonly AS_FIELDS = ["as_path_contains", "first_as", "origin_as"] as const;

    /** Where in the path each AS field looks: anywhere, at the start, at the end. */
    private static readonly AS_ANCHORS = {
        as_path_contains: { before: "_", after: "_" },
        first_as: { before: "^", after: "_" },
        origin_as: { before: "_", after: "$" },
    } as const;

    /** The conditions a route map rule matches with its one AS path list. */
    private static readonly AS_PATH_FIELDS = ["as_path_length", ...FortiOsRouting.AS_FIELDS] as const;

    /** A neighbor's settings with its group's beneath them. */
    static neighborSettings(device: Device, neighbor: Neighbor): NeighborSettings {
        const group = neighbor.neighbor_group ? device.routing?.bgp?.neighbor_groups?.[neighbor.neighbor_group] : undefined;
        return { ...group, ...neighbor };
    }

    /** The families a session carries: its own, or the family of its address. */
    static familiesOfNeighbor(device: Device, neighbor: Neighbor): Family[] {
        return [...(FortiOsRouting.neighborSettings(device, neighbor).address_families ?? [Address.family(neighbor.address)])];
    }

    /** The prefixes a set lists, from a list or a map of named prefixes; undefined for a set a registry fills. */
    static listed(set: PrefixSet | undefined): string[] | undefined {
        if (!set || !("prefixes" in set)) return undefined;
        return Array.isArray(set.prefixes) ? [...set.prefixes] : Object.values(set.prefixes);
    }

    /** Whether a static route, OSPF or BGP detects a dead neighbor with BFD, which the device then runs. */
    static usesBfd(device: Device): boolean {
        const routes = (device.routing?.static_routes ?? []).some((route) => route.bfd);
        const areas = Object.values(device.routing?.ospf?.areas ?? {});
        const ospf = areas.some((area) => Object.values(area.interfaces).some((settings) => settings?.bfd));
        const bgp = Object.values(device.routing?.bgp?.neighbors ?? {}).some(
            (neighbor) => FortiOsRouting.neighborSettings(device, neighbor).bfd
        );
        return routes || ospf || bgp;
    }

    static render(root: FortiOsNode, device: Device): void {
        FortiOsRouting.prefixLists(root, device);
        FortiOsRouting.ospf(root, device);
        FortiOsRouting.ospf6(root, device);
        FortiOsRouting.bgp(root, device);
    }

    private static listPrefix(prefix: string, family: Family): string {
        return family === "ipv4" ? FortiOsNames.subnet(FortiOsNames.network(prefix)) : FortiOsNames.network(prefix);
    }

    /** The device prints a bound the rule does not hold as `unset`. */
    static listRule(rule: FortiOsNode, family: Family, prefix: string, lengths: Lengths = {}): void {
        rule.set(family === "ipv4" ? "prefix" : "prefix6", FortiOsRouting.listPrefix(prefix, family));
        rule.set("ge", lengths.ge ?? FortiOsTree.UNSET);
        rule.set("le", lengths.le ?? FortiOsTree.UNSET);
    }

    /** The lengths a rule takes within a prefix to match lengths from `min` to `max`, or none when no length fits. A bound equal to the prefix's own length is left out. */
    static bounds(prefix: string, family: Family, min = 0, max: number = FortiOsRouting.BITS[family]): Lengths | undefined {
        const own = Address.split(FortiOsNames.network(prefix)).len;
        const low = Math.max(min, own);
        if (max < low) return undefined;
        if (low === own && max === own) return {};

        return { ...(low > own ? { ge: low } : {}), le: max };
    }

    /** Each prefix set matches its prefixes and any more specific. */
    private static prefixLists(root: FortiOsNode, device: Device): void {
        for (const [name, set] of Object.entries(device.routing?.prefix_sets ?? {})) {
            if (!set) continue;

            if ("source" in set) {
                const { registry, query, family } = set.source;
                const entry = root
                    .block(FortiOsRouting.PREFIX_LIST[family])
                    .entry(name)
                    .set("comments", FortiOsTree.quote(`${FortiOsRouting.FILLED} from ${registry} ${query}`));
                // Until `refresh` fills it, the list refuses every prefix, so a rule matching it matches nothing.
                const rule = entry.block("rule").entry(1);
                FortiOsRouting.listRule(rule, family, family === "ipv4" ? "0.0.0.0/0" : "::/0", { le: FortiOsRouting.BITS[family] });
                rule.set("action", "deny");
                continue;
            }

            const prefixes = FortiOsRouting.listed(set) ?? [];
            const family = prefixes[0] ? FortiOsNames.familyOfPrefix(prefixes[0]) : "ipv4";
            const entry = root.block(FortiOsRouting.PREFIX_LIST[family]).entry(name);
            prefixes.forEach((prefix, index) =>
                FortiOsRouting.listRule(entry.block("rule").entry(index + 1), family, prefix, FortiOsRouting.bounds(prefix, family))
            );
        }
    }

    private static networksOf(device: Device, name: string, family: Family): string[] {
        return FortiOsNames.addressesOf(FortiOsNames.settingsOf(device, name))
            .filter((address) => FortiOsNames.familyOfPrefix(address) === family)
            .map(FortiOsNames.network);
    }

    /** An area runs on the networks of its interfaces. An interface with a cost, a link type, or BFD has an entry of its own. */
    private static ospf(root: FortiOsNode, device: Device): void {
        const ospf = device.routing?.ospf;
        if (!ospf || !(ospf.address_families ?? ["ipv4"]).includes("ipv4")) return;

        const block = root.block("router ospf");
        if (device.routing?.router_id) block.set("router-id", device.routing.router_id);

        const passive: string[] = [];
        let networks = 0;

        for (const [areaId, area] of Object.entries(ospf.areas)) {
            FortiOsRouting.ospfArea(block.block("area").entry(areaId, true), area);

            for (const [name, settings] of Object.entries(area.interfaces)) {
                const iface = FortiOsNames.of(device, name);
                if (settings?.passive) passive.push(iface);

                const { passive: _passive, ...own } = settings ?? {};
                if (Object.keys(own).length) {
                    const entry = block.block("ospf-interface").entry(iface);
                    entry.set("interface", FortiOsTree.quote(iface));
                    if (own.cost !== undefined) entry.set("cost", own.cost);
                    if (own.network === "point-to-point") entry.set("network-type", "point-to-point");
                    if (own.hello_interval !== undefined) entry.set("hello-interval", own.hello_interval);
                    if (own.dead_interval !== undefined) entry.set("dead-interval", own.dead_interval);
                    // `unsupported()` refuses HMAC-SHA.
                    if (own.authentication) {
                        entry.set("authentication", "md5");
                        entry.block("md5-keys").entry(own.authentication.key_id).set("key-string", Secrets.marker(own.authentication.key));
                    }
                    if (own.bfd) entry.set("bfd", "enable");
                }

                for (const prefix of FortiOsRouting.networksOf(device, name, "ipv4")) {
                    const entry = block.block("network").entry(++networks);
                    entry.set("prefix", FortiOsNames.subnet(prefix));
                    // The backbone is the platform's default area and is not printed.
                    if (areaId !== "0.0.0.0") entry.set("area", areaId);
                }
            }
        }

        if (passive.length) block.set("passive-interface", FortiOsTree.quoteAll(passive));
        for (const source of ospf.redistribute ?? []) block.block(`redistribute "${source}"`).set("status", "enable");
    }

    /** A stub area or an NSSA, the same in OSPF and OSPFv3. A border router announces a default route into an NSSA with summaries only when told to (TRAPS.md). */
    private static ospfArea(entry: FortiOsNode, area: OspfArea): void {
        if (!area.type) return;

        entry.set("type", area.type);
        if (area.no_summaries) entry.set("stub-type", "no-summary");

        const cost = area.stub_default_cost;
        if (cost === undefined) return;
        if (area.type === "stub" || area.no_summaries) {
            entry.set("default-cost", cost);
            return;
        }
        entry.set("nssa-default-information-originate", "always");
        entry.set("nssa-default-information-originate-metric", cost);
    }

    /** Every interface of an area has an entry of its own. */
    private static ospf6(root: FortiOsNode, device: Device): void {
        const ospf = device.routing?.ospf;
        if (!ospf?.address_families?.includes("ipv6")) return;

        const block = root.block("router ospf6");
        if (device.routing?.router_id) block.set("router-id", device.routing.router_id);

        const passive: string[] = [];

        for (const [areaId, area] of Object.entries(ospf.areas)) {
            FortiOsRouting.ospfArea(block.block("area").entry(areaId, true), area);

            for (const [name, settings] of Object.entries(area.interfaces)) {
                const iface = FortiOsNames.of(device, name);
                if (settings?.passive) passive.push(iface);

                const entry = block.block("ospf6-interface").entry(iface);
                entry.set("interface", FortiOsTree.quote(iface));
                if (areaId !== "0.0.0.0") entry.set("area-id", areaId);
                if (settings?.cost !== undefined) entry.set("cost", settings.cost);
                if (settings?.network === "point-to-point") entry.set("network-type", "point-to-point");
                if (settings?.hello_interval !== undefined) entry.set("hello-interval", settings.hello_interval);
                if (settings?.dead_interval !== undefined) entry.set("dead-interval", settings.dead_interval);
                if (settings?.bfd) entry.set("bfd", "enable");
            }
        }

        if (passive.length) block.set("passive-interface", FortiOsTree.quoteAll(passive));
        for (const source of ospf.redistribute ?? []) block.block(`redistribute "${source}"`).set("status", "enable");
    }

    private static bgp(root: FortiOsNode, device: Device): void {
        const bgp = device.routing?.bgp;
        if (!bgp) return;

        const block = root.block("router bgp");
        if (bgp.asn !== undefined) block.set("as", bgp.asn);
        if (device.routing?.router_id) block.set("router-id", device.routing.router_id);
        if (bgp.cluster_id) block.set("cluster-id", bgp.cluster_id);
        if (bgp.confederation) block.set("confederation-identifier", bgp.confederation.identifier);
        if (bgp.confederation?.member_as.length)
            block.set("confederation-peers", FortiOsTree.quoteAll(bgp.confederation.member_as.map(String)));

        // Each neighbor asks for it, and the device as a whole keeps forwarding while BGP restarts.
        const graceful = Object.values(bgp.neighbors ?? {}).some(
            (neighbor) => neighbor && FortiOsRouting.neighborSettings(device, neighbor).graceful_restart
        );
        if (graceful) block.set("graceful-restart", "enable");

        const maps = new RouteMaps(root, device);

        for (const neighbor of Object.values(bgp.neighbors ?? {})) {
            if (!neighbor) continue;

            const settings = FortiOsRouting.neighborSettings(device, neighbor);
            const families = FortiOsRouting.familiesOfNeighbor(device, neighbor);
            const entry = block.block("neighbor").entry(neighbor.address);

            // Both families are active unless told otherwise.
            if (!families.includes("ipv4")) entry.set("activate", "disable");
            if (!families.includes("ipv6")) entry.set("activate6", "disable");
            if (settings.bfd) entry.set("bfd", "enable");
            if (settings.multihop) entry.set("ebgp-enforce-multihop", "enable");
            if (settings.passive) entry.set("passive", "enable");
            if (settings.description) entry.set("description", FortiOsTree.quote(settings.description));
            if (settings.remote_as !== undefined) entry.set("remote-as", settings.remote_as);

            const limit = Derive.prefixLimit(settings);

            for (const family of families) {
                const suffix = family === "ipv4" ? "" : "6";
                if (settings.send_default_route) entry.set(`capability-default-originate${suffix}`, "enable");
                if (settings.graceful_restart) entry.set(`capability-graceful-restart${suffix}`, "enable");
                if (limit) entry.set(`maximum-prefix${suffix}`, limit.limit);
                if (limit?.warn_only) entry.set(`maximum-prefix-warning-only${suffix}`, "enable");
                entry.set(`route-map-in${suffix}`, FortiOsTree.quote(maps.of(settings.import_policy, family)));
                entry.set(`route-map-out${suffix}`, FortiOsTree.quote(maps.of(settings.export_policy, family)));
                if (settings.route_reflector_client) entry.set(`route-reflector-client${suffix}`, "enable");
            }

            if (settings.keepalive !== undefined) entry.set("keep-alive-timer", settings.keepalive);
            if (settings.hold_time !== undefined) entry.set("holdtime-timer", settings.hold_time);

            const source = settings.local_address ? FortiOsNames.holderOf(device, settings.local_address) : undefined;
            if (source) entry.set("update-source", FortiOsTree.quote(FortiOsNames.of(device, source)));

            if (settings.password) entry.set("password", FortiOsTree.quote(Secrets.marker(settings.password)));
        }

        const networks = { ipv4: 0, ipv6: 0 };

        for (const prefix of bgp.originated_prefixes ?? []) {
            const family = FortiOsNames.familyOfPrefix(prefix);
            const entry = block.block(family === "ipv4" ? "network" : "network6").entry(++networks[family]);
            entry.set(family === "ipv4" ? "prefix" : "prefix6", FortiOsRouting.listPrefix(prefix, family));
        }

        const aggregates = { ipv4: 0, ipv6: 0 };

        for (const aggregate of bgp.aggregates ?? []) {
            const family = FortiOsNames.familyOfPrefix(aggregate.prefix);
            const entry = block.block(family === "ipv4" ? "aggregate-address" : "aggregate-address6").entry(++aggregates[family]);
            entry.set(family === "ipv4" ? "prefix" : "prefix6", FortiOsRouting.listPrefix(aggregate.prefix, family));
            if (aggregate.summary_only) entry.set("summary-only", "enable");
        }
    }

    /**
     * The regular expressions an AS path list permits for a rule's one AS path condition, or none. In the AS path the device matches, ASes have spaces between them, and `_` stands for a space, the start, or the end. A range of ASes is several expressions, since a regular expression has no number ranges.
     */
    static asPathRegexes(match: RouteMatch): string[] {
        const length = match.as_path_length;
        if (length) return FortiOsRouting.lengthRegexes(length.min ?? 0, length.max);

        const field = FortiOsRouting.AS_FIELDS.find((each) => match[each] !== undefined);
        if (!field) return [];

        const { before, after } = FortiOsRouting.AS_ANCHORS[field];
        const numbers = Derive.asRanges(match[field]!).flatMap(({ min, max }) => FortiOsRouting.numberPatterns(min, max));
        return numbers.map((number) => `${before}${number}${after}`);
    }

    /**
     * Patterns that together match the numbers from `min` to `max`, with no repetition count, as the NLNOG BGP Filter Guide writes them. 65552 to 131071 is `6555[2-9]`, `655[6-9][0-9]`, and on to `13107[0-1]`.
     */
    static numberPatterns(min: number, max: number): string[] {
        const patterns: string[] = [];

        for (let low = min; low <= max;) {
            // One length of number at a time, so no pattern needs a leading zero.
            const length = String(low).length;
            const high = Math.min(max, 10 ** length - 1);

            // The most trailing digits that can be any digit, then how far the digit before them goes.
            let any = 0;
            while (any < length - 1 && low % 10 ** (any + 1) === 0 && low + 10 ** (any + 1) - 1 <= high) any++;
            const block = 10 ** any;
            const first = Math.floor(low / block) % 10;
            let last = first;
            while (last < 9 && low + (last - first + 2) * block - 1 <= high) last++;

            const above = Math.floor(low / (block * 10));
            const digit = first === last ? `${first}` : `[${first}-${last}]`;
            patterns.push(`${above || ""}${digit}${"[0-9]".repeat(any)}`);
            low += (last - first + 1) * block;
        }

        return patterns;
    }

    /** A path of `min` ASes or more, and `max` or fewer when given: one AS, then one more after each space. `^[0-9]+( [0-9]+){50}` is 51 or more, and `^$` the empty path. */
    private static lengthRegexes(min: number, max: number | undefined): string[] {
        if (max === 0) return ["^$"];

        const after = Math.max(min, 1) - 1;
        const ases = max === undefined ? `^[0-9]+( [0-9]+){${after}}` : `^[0-9]+( [0-9]+){${after},${max - 1}}$`;
        return min === 0 ? ["^$", ases] : [ases];
    }

    /** The family a rule is limited to, by its match: a family, a prefix, or a prefix set of one family. */
    static familyOfRule(device: Device, rule: RouteRule): Family | undefined {
        const match = rule.if;
        if (match?.family) return match.family;
        if (match?.prefix) return FortiOsNames.familyOfPrefix(match.prefix);

        const set = match?.prefix_set ? device.routing?.prefix_sets?.[match.prefix_set] : undefined;
        if (set && "source" in set) return set.source.family;

        const first = FortiOsRouting.listed(set)?.[0];
        if (first) return FortiOsNames.familyOfPrefix(first);

        return undefined;
    }

    /** A policy's rules with each call replaced by the rules it calls, in order. A called policy that decides nothing hands back to the caller. A `{ communities }` rule, which Circuit writes out before the platform reads it, is left out; `unsupported()` refuses one. */
    static flatten(device: Device, policy: string, seen: string[] = [policy]): RouteRule[] {
        const flat: RouteRule[] = [];

        for (const rule of device.routing?.policies?.[policy] ?? []) {
            if ("call" in rule && rule.call !== undefined) {
                if (!seen.includes(rule.call)) flat.push(...FortiOsRouting.flatten(device, rule.call, [...seen, rule.call]));
                continue;
            }

            if (FortiOsRouting.isRouteRule(rule) && (rule.if || rule.set || rule.then)) flat.push(rule);
        }

        return flat;
    }

    /** Whether a policy rule is a rule on routes, not a call or a `{ communities }` rule. */
    static isRouteRule(rule: PolicyRule): rule is RouteRule {
        return !("call" in rule && rule.call !== undefined) && !("communities" in rule && rule.communities !== undefined);
    }

    /** Routing the platform cannot express, or that this adapter does not yet write. */
    static gaps(device: Device): string[] {
        const found: string[] = [];
        const routing = device.routing;

        if (routing?.rpki) found.push("routing.rpki, the platform has no route origin validation");
        if (routing?.router_id && !routing.ospf && !routing.bgp) found.push("routing.router_id without OSPF or BGP, which each hold it");
        if (routing?.bgp && routing.bgp.asn === undefined) found.push("routing.bgp without asn, which the platform's BGP needs");

        const ospf = routing?.ospf;
        if (ospf?.address_families?.includes("ipv6") && !routing?.router_id) found.push("routing.ospf for IPv6 without routing.router_id");

        for (const [areaId, area] of Object.entries(ospf?.areas ?? {})) {
            for (const [name, settings] of Object.entries(area.interfaces)) {
                if (FortiOsNames.settingsOf(device, name)?.vrf)
                    found.push(`routing.ospf on ${name}, which routes in a VRF: OSPF runs in the default table`);

                const authentication = settings?.authentication;
                const where = `routing.ospf.areas.${areaId}.interfaces.${name}.authentication`;
                if (authentication && authentication.algorithm !== "md5")
                    found.push(`${where}.algorithm ${authentication.algorithm}, FortiOS 6.2 signs OSPF with md5 only`);
                if (authentication?.key_id === 0) found.push(`${where}.key_id 0, FortiOS numbers keys from 1`);

                const ipv4 = FortiOsNames.addressesOf(FortiOsNames.settingsOf(device, name)).some(
                    (address) => Address.family(Address.host(address)) === "ipv4"
                );
                if ((ospf?.address_families ?? ["ipv4"]).includes("ipv4") && !ipv4)
                    found.push(`routing.ospf on ${name}, which has no IPv4 address for OSPF to run on`);
            }
        }

        for (const [name, neighbor] of Object.entries(routing?.bgp?.neighbors ?? {})) {
            if (!neighbor) continue;

            const where = `routing.bgp.neighbors.${name}`;
            const settings = FortiOsRouting.neighborSettings(device, neighbor);

            if (settings.role) found.push(`${where}.role, the platform has no BGP roles`);
            if (settings.ttl_security)
                found.push(
                    `${where}.ttl_security, the platform's BGP sets only the TTL it sends, and has no setting that drops packets arriving with less than 255`
                );
            if (settings.bfd && settings.multihop)
                found.push(
                    `${where}.bfd, FortiOS 6.2 runs single-hop BFD on a multihop session, which a peer running multihop BFD never answers`
                );
            if (Derive.prefixLimit(settings)?.restart_after !== undefined)
                found.push(`${where}.max_prefixes.restart_after, FortiOS 6.2 keeps the session closed until it is cleared by hand`);
            if (settings.local_address && !FortiOsNames.holderOf(device, settings.local_address)) {
                found.push(`${where}.local_address, no interface holds ${settings.local_address}`);
            }

            if (Address.family(neighbor.address) === "ipv6" && FortiOsRouting.familiesOfNeighbor(device, neighbor).includes("ipv4")) {
                found.push(`${where}.address_families ipv4 over an IPv6 session`);
            }
        }

        for (const [name, rules] of Object.entries(routing?.policies ?? {})) {
            (rules ?? []).forEach((rule, index) =>
                found.push(...FortiOsRouting.ruleGaps(device, `routing.policies.${name}[${index}]`, rule))
            );
        }

        return found;
    }

    private static ruleGaps(device: Device, where: string, rule: PolicyRule): string[] {
        if (!FortiOsRouting.isRouteRule(rule)) {
            return "communities" in rule && rule.communities !== undefined
                ? [`${where}.communities, a rule Circuit writes out as route rules before the platform reads it`]
                : [];
        }

        const found: string[] = [];
        const match = rule.if ?? {};
        const set = rule.set ?? {};

        if ((rule.if || rule.set) && !rule.then)
            found.push(`${where}, a rule without then: the platform stops at the first rule that matches`);

        for (const field of ["rpki", "large_community"] as const) {
            if (match[field] !== undefined) found.push(`${where}.if.${field}`);
        }

        const asPath = FortiOsRouting.AS_PATH_FIELDS.filter((field) => match[field] !== undefined);
        if (asPath.length > 1)
            found.push(
                `${where}.if.${asPath[1]} with ${asPath[0]}: a route map rule matches one AS path list. Match each in a rule of its own`
            );

        for (const field of [
            "large_communities",
            "add_large_communities",
            "remove_large_communities",
            "preferred_source",
            "blackhole",
        ] as const) {
            if (set[field] !== undefined) found.push(`${where}.set.${field}`);
        }

        if (match.prefix && match.prefix_length) found.push(`${where}.if.prefix with prefix_length`);
        if (match.prefix && match.prefix_set) found.push(`${where}.if.prefix with prefix_set`);

        const prefixSet = match.prefix_set ? device.routing?.prefix_sets?.[match.prefix_set] : undefined;
        if (prefixSet && "source" in prefixSet && match.prefix_length) {
            found.push(`${where}.if.prefix_length with a prefix set a registry fills`);
        }

        return found;
    }
}
