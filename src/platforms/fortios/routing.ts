// BGP's policies become route maps, prefix lists, and community lists.

import { Address } from "../../core/address";
import { Derive } from "../../core/derive";
import { Secrets } from "../../core/secrets";
import { Utils } from "../../core/utils";
import type {
    Device,
    Family,
    Neighbor,
    NeighborSettings,
    Ospf,
    OspfArea,
    OspfInterface,
    PolicyRule,
    PrefixSet,
    RouteMatch,
    RouteRule,
} from "../../model";
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

    /** The start of the comment on a prefix list from a registry that the render did not fetch, as Studio renders it. The plan keeps the entry the device holds. */
    static readonly UNFETCHED = "Fetched by circuit diff and apply";

    static readonly PREFIX_LIST = { ipv4: "router prefix-list", ipv6: "router prefix-list6" } as const;

    static readonly ACCESS_LIST = { ipv4: "router access-list", ipv6: "router access-list6" } as const;

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

    /** IS-IS's `is-type` and the levels its interfaces' metrics are set at, for each level capability. */
    private static readonly ISIS_LEVELS = {
        "level-1": { type: "level-1", levels: [1] },
        "level-2": { type: "level-2-only", levels: [2] },
        "level-1-2": { type: "level-1-2", levels: [1, 2] },
    } as const;

    /** The key chain that holds an IS-IS level's key, before the level's number. */
    private static readonly ISIS_KEY_CHAIN = "circuit-isis-l";

    /** A key chain's key is valid from 2001, before any date the device's clock shows, with no end. The device needs both lifetimes, and prints them this way. */
    private static readonly KEY_LIFETIME = "00:00:00 01 01 2001 infinite";

    /** A neighbor's settings with its group's beneath them. */
    static neighborSettings(device: Device, neighbor: Neighbor): NeighborSettings {
        const group = neighbor.neighbor_group ? device.routing?.bgp?.neighbor_groups?.[neighbor.neighbor_group] : undefined;
        return { ...group, ...neighbor };
    }

    /** The families a session carries: its own, or the family of its address. */
    static familiesOfNeighbor(device: Device, neighbor: Neighbor): Family[] {
        return Derive.unicastFamilies(FortiOsRouting.neighborSettings(device, neighbor), neighbor.address);
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
        FortiOsRouting.isis(root, device);
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
                    .set("comments", FortiOsTree.quote(`${FortiOsRouting.UNFETCHED} from ${registry} ${query}`));
                // Without its prefixes, the list refuses every prefix, so a rule matching it matches nothing.
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

    /**
     * An area runs on the networks of its interfaces, in the VRF they route in, which the device runs an OSPF process for. An interface with a cost, a link type, a priority, or BFD has an entry of its own. The neighbors a link sends its hellos to are the router's, each found on the link whose network holds it.
     */
    private static ospf(root: FortiOsNode, device: Device): void {
        const ospf = device.routing?.ospf;
        if (!ospf || !(ospf.address_families ?? ["ipv4"]).includes("ipv4")) return;

        const block = root.block("router ospf");
        if (device.routing?.router_id) block.set("router-id", device.routing.router_id);

        const passive: string[] = [];
        let networks = 0;
        let neighbors = 0;

        for (const [areaId, area] of Object.entries(ospf.areas)) {
            FortiOsRouting.ospfArea(block.block("area").entry(areaId, true), area, "ipv4");

            for (const [name, settings] of Object.entries(area.interfaces)) {
                const iface = FortiOsNames.of(device, name);
                if (settings?.passive) passive.push(iface);

                const { passive: _passive, ...own } = settings ?? {};
                if (Object.keys(own).length) {
                    const entry = block.block("ospf-interface").entry(iface);
                    entry.set("interface", FortiOsTree.quote(iface));
                    if (own.cost !== undefined) entry.set("cost", own.cost);
                    if (own.priority !== undefined) entry.set("priority", own.priority);
                    const type = FortiOsRouting.networkType(own);
                    if (type) entry.set("network-type", type);
                    if (own.hello_interval !== undefined) entry.set("hello-interval", own.hello_interval);
                    if (own.dead_interval !== undefined) entry.set("dead-interval", own.dead_interval);
                    // `unsupported()` refuses HMAC-SHA.
                    if (own.authentication) {
                        entry.set("authentication", "md5");
                        entry.block("md5-keys").entry(own.authentication.key_id).set("key-string", Secrets.marker(own.authentication.key));
                    }
                    if (own.bfd) entry.set("bfd", "enable");
                }

                for (const address of settings?.neighbors ?? []) {
                    const neighbor = block.block("neighbor").entry(++neighbors).set("ip", address);
                    // The device needs each neighbor's cost on a point-to-multipoint link (TRAPS.md); `unsupported()` refuses one without the link's.
                    if (settings?.network === "point-to-multipoint" && settings.cost !== undefined) neighbor.set("cost", settings.cost);
                }

                for (const prefix of FortiOsRouting.networksOf(device, name, "ipv4")) {
                    const entry = block.block("network").entry(++networks);
                    entry.set("prefix", FortiOsNames.subnet(prefix));
                    // The backbone is the platform's default area and is not printed.
                    if (areaId !== "0.0.0.0") entry.set("area", areaId);
                }
            }
        }

        FortiOsRouting.virtualLinks(block, ospf.areas);
        if (passive.length) block.set("passive-interface", FortiOsTree.quoteAll(passive));
        for (const source of ospf.redistribute ?? []) block.block(`redistribute "${source}"`).set("status", "enable");
    }

    /** A point-to-multipoint link with neighbors sends its hellos to them alone, as an NBMA link does. Broadcast is the default and is not printed. */
    private static networkType(settings: OspfInterface): string | undefined {
        if (settings.network === "point-to-multipoint")
            return settings.neighbors?.length ? "point-to-multipoint-non-broadcast" : "point-to-multipoint";
        return settings.network === "broadcast" ? undefined : settings.network;
    }

    /** The backbone's virtual links, each under the area it crosses, named after the far router's ID (RFC 2328, section 15). */
    private static virtualLinks(block: FortiOsNode, areas: Ospf["areas"]): void {
        for (const link of areas["0.0.0.0"]?.virtual_links ?? [])
            block.block("area").entry(link.transit_area_id, true).block("virtual-link").entry(link.router_id).set("peer", link.router_id);
    }

    /** A stub area or an NSSA, the same in OSPF and OSPFv3, and the area's ranges of `family`. A border router announces a default route into an NSSA with summaries only when told to (TRAPS.md). */
    private static ospfArea(entry: FortiOsNode, area: OspfArea, family: Family): void {
        const ranges = (area.ranges ?? []).filter((range) => FortiOsNames.familyOfPrefix(range.prefix) === family);
        // `unsupported()` refuses a range's cost, which the device has no setting for.
        ranges.forEach((range, index) => {
            const each = entry.block("range").entry(index + 1);
            each.set(family === "ipv4" ? "prefix" : "prefix6", FortiOsRouting.listPrefix(range.prefix, family));
            each.set("advertise", range.advertise ? "enable" : "disable");
        });

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
            FortiOsRouting.ospfArea(block.block("area").entry(areaId, true), area, "ipv6");

            for (const [name, settings] of Object.entries(area.interfaces)) {
                const iface = FortiOsNames.of(device, name);
                if (settings?.passive) passive.push(iface);

                const entry = block.block("ospf6-interface").entry(iface);
                entry.set("interface", FortiOsTree.quote(iface));
                if (areaId !== "0.0.0.0") entry.set("area-id", areaId);
                if (settings?.cost !== undefined) entry.set("cost", settings.cost);
                if (settings?.priority !== undefined) entry.set("priority", settings.priority);
                if (settings?.network === "point-to-point") entry.set("network-type", "point-to-point");
                if (settings?.hello_interval !== undefined) entry.set("hello-interval", settings.hello_interval);
                if (settings?.dead_interval !== undefined) entry.set("dead-interval", settings.dead_interval);
                if (settings?.bfd) entry.set("bfd", "enable");
            }
        }

        FortiOsRouting.virtualLinks(block, ospf.areas);
        if (passive.length) block.set("passive-interface", FortiOsTree.quoteAll(passive));
        for (const source of ospf.redistribute ?? []) block.block(`redistribute "${source}"`).set("status", "enable");
    }

    /** IS-IS with wide metrics and one NET. Every interface has an entry, turned on for each family; a loopback's link type is `loopback`, which forms no adjacency. */
    private static isis(root: FortiOsNode, device: Device): void {
        const isis = device.routing?.isis;
        if (!isis) return;

        const { type, levels } = FortiOsRouting.ISIS_LEVELS[isis.level_capability];
        const block = root.block("router isis");
        block.set("is-type", type);
        block.set("metric-style", "wide");
        // MD5 takes its key from a key chain only, one per level. It signs the level's LSPs and sequence number packets here, and its hellos on each interface.
        const chains = new Map<number, string>();
        for (const level of levels) {
            // `unsupported()` refuses HMAC-SHA.
            const key = Derive.isisAuthentication(isis, level)?.key;
            if (!key) continue;

            const chain = `${FortiOsRouting.ISIS_KEY_CHAIN}${level}`;
            chains.set(level, chain);
            const entry = root.block("router key-chain").entry(chain).block("key").entry(1);
            entry.set("key-string", FortiOsTree.quote(Secrets.marker(key)));
            entry.set("accept-lifetime", FortiOsRouting.KEY_LIFETIME);
            entry.set("send-lifetime", FortiOsRouting.KEY_LIFETIME);
        }
        const sign = (node: FortiOsNode) => {
            for (const [level, chain] of chains) {
                node.set(`auth-mode-l${level}`, "md5");
                node.set(`auth-keychain-l${level}`, FortiOsTree.quote(chain));
            }
        };
        sign(block);
        block.block("isis-net").entry(1).set("net", isis.net);

        for (const [name, settings] of Object.entries(isis.interfaces)) {
            const iface = FortiOsNames.of(device, name);
            const entry = block.block("isis-interface").entry(iface);
            sign(entry);
            if (isis.address_families.includes("ipv4")) entry.set("status", "enable");
            if (isis.address_families.includes("ipv6")) entry.set("status6", "enable");
            // `unsupported()` refuses another link type on a loopback.
            if (device.interfaces?.loopback?.[name]) entry.set("network-type", "loopback");
            else if (settings?.network === "point-to-point") entry.set("network-type", "point-to-point");
            const metric = settings?.metric;
            if (metric !== undefined) for (const level of levels) entry.set(`wide-metric-l${level}`, metric);
        }

        if (isis.overload_bit) block.set("overload-bit", "enable");

        // Each family leaks through an access list: `redistribute-l2-list` takes no prefix list or route map (TRAPS.md).
        const leak = isis.level2_to_level1?.import_policy;
        if (!leak) return;
        for (const family of isis.address_families) {
            const suffix = family === "ipv4" ? "" : "6";
            block.set(`redistribute${suffix}-l2`, "enable");
            block.set(`redistribute${suffix}-l2-list`, FortiOsTree.quote(FortiOsRouting.accessList(root, device, leak, family)));
        }
    }

    /**
     * A policy that picks prefixes, as an access list of one family, named after it. Each rule matches its prefix alone, with `exact-match`, or each prefix of its set and what lies inside it. A rule without either matches `any`. The list permits unless told to deny, and denies what no rule matches.
     */
    private static accessList(root: FortiOsNode, device: Device, policy: string, family: Family): string {
        const rules = root.block(FortiOsRouting.ACCESS_LIST[family]).entry(policy).block("rule");
        const key = family === "ipv4" ? "prefix" : "prefix6";
        let number = 0;

        for (const rule of FortiOsRouting.flatten(device, policy)) {
            const only = FortiOsRouting.familyOfRule(device, rule);
            if (only && only !== family) continue;

            const match = rule.if ?? {};
            const set = match.prefix_set ? device.routing?.prefix_sets?.[match.prefix_set] : undefined;
            const prefixes = match.prefix ? [match.prefix] : match.prefix_set ? (FortiOsRouting.listed(set) ?? []) : [undefined];
            for (const prefix of prefixes) {
                const entry = rules.entry(++number);
                if (rule.then === "reject") entry.set("action", "deny");
                entry.set(key, prefix ? FortiOsRouting.listPrefix(prefix, family) : "any");
                if (match.prefix) entry.set("exact-match", "enable");
            }
        }

        return policy;
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
        const numbers = Derive.asRanges(match[field]!).flatMap(({ min, max }) => Derive.numberPatterns(min, max));
        return numbers.map((number) => `${before}${number}${after}`);
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

    /** A policy and each one it calls, at any depth. */
    private static called(device: Device, policy: string, seen: string[] = []): string[] {
        if (seen.includes(policy)) return seen;
        seen.push(policy);

        for (const rule of device.routing?.policies?.[policy] ?? [])
            if ("call" in rule && rule.call !== undefined) FortiOsRouting.called(device, rule.call, seen);
        return seen;
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
        // `router bgp` has no `config vrf-leak` (TRAPS.md).
        if (routing?.vrf_imports)
            found.push("routing.vrf_imports, FortiOS 6.2 takes no routes from one VRF into another: route leaking between VRFs needs 6.4");
        if (routing?.router_id && !routing.ospf && !routing.bgp) found.push("routing.router_id without OSPF or BGP, which each hold it");
        found.push(...FortiOsRouting.tableGaps(device));
        if (routing?.bgp && routing.bgp.asn === undefined) found.push("routing.bgp without asn, which the platform's BGP needs");

        const ospf = routing?.ospf;
        if (ospf?.address_families?.includes("ipv6") && !routing?.router_id) found.push("routing.ospf for IPv6 without routing.router_id");
        // OSPF runs in the VRF its interfaces route in, and OSPFv3 in the default VRF only (TRAPS.md).
        if (ospf?.vrf && ospf.address_families?.includes("ipv6"))
            found.push("routing.ospf.vrf with ipv6 in address_families, FortiOS 6.2 runs OSPFv3 in the default VRF only");

        for (const [areaId, area] of Object.entries(ospf?.areas ?? {})) {
            // `config range` holds a prefix, `advertise`, and a prefix to announce in its place, but no cost.
            (area.ranges ?? []).forEach((range, index) => {
                if (range.cost !== undefined)
                    found.push(
                        `routing.ospf.areas.${areaId}.ranges[${index}].cost, FortiOS 6.2 has no cost for a range, which takes the largest cost inside it`
                    );
            });

            for (const [name, settings] of Object.entries(area.interfaces)) {
                if (settings?.network === "point-to-multipoint" && settings.neighbors?.length && settings.cost === undefined)
                    found.push(
                        `routing.ospf.areas.${areaId}.interfaces.${name}.neighbors on a point-to-multipoint link without cost, FortiOS 6.2 needs a cost for each neighbor there. Write cost on ${name}`
                    );

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

        // BGP has one table, the default VRF's, whatever interface reaches a neighbor (TRAPS.md).
        const noVrf = "FortiOS 6.2 runs BGP in the default VRF only: BGP in a VRF needs 6.4";
        for (const [name, group] of Object.entries(routing?.bgp?.neighbor_groups ?? {}))
            if (group?.vrf) found.push(`routing.bgp.neighbor_groups.${name}.vrf, ${noVrf}`);
        // Neither `router isis` nor its interfaces have a setting for a topology, RFC 5120's multi-topology (TRAPS.md).
        if (routing?.isis?.multi_topology) found.push("routing.isis.multi_topology, FortiOS routes IPv6 in IPv4's topology only");
        // The FortiOS 6.2 CLI reference lists `password` and `md5` for `auth-mode-l1` and `auth-mode-l2`, and a key chain's key has no algorithm.
        for (const { where, authentication } of Derive.isisAuthentications(device))
            if (authentication.algorithm !== "hmac-md5")
                found.push(`${where}, FortiOS 6.2 signs IS-IS with hmac-md5 only, not ${authentication.algorithm}`);
        // An access list matches a prefix, or what lies inside it, with no range of lengths.
        const leak = routing?.isis?.level2_to_level1?.import_policy;
        for (const name of leak ? FortiOsRouting.called(device, leak) : [])
            (routing?.policies?.[name] ?? []).forEach((rule, index) => {
                if (FortiOsRouting.isRouteRule(rule) && rule.if?.prefix_length)
                    found.push(
                        `routing.policies.${name}[${index}].if.prefix_length, in routing.isis.level2_to_level1: FortiOS leaks through an access list, which matches no prefix length. Match prefix or prefix_set`
                    );
            });
        for (const [name, settings] of Object.entries(routing?.isis?.interfaces ?? {})) {
            const where = `routing.isis.interfaces.${name}`;
            if (settings?.passive) found.push(`${where}.passive, FortiOS has none: only a loopback forms no adjacency`);
            if (settings?.network && device.interfaces?.loopback?.[name])
                found.push(`${where}.network, a loopback's link type is loopback on FortiOS`);
            // Neither `router isis` nor an `isis-interface` entry takes `bfd` (TRAPS.md).
            if (settings?.bfd) found.push(`${where}.bfd, FortiOS 6.2 has no BFD for IS-IS`);
        }

        for (const [name, neighbor] of Object.entries(routing?.bgp?.neighbors ?? {})) {
            if (!neighbor) continue;

            const where = `routing.bgp.neighbors.${name}`;
            const settings = FortiOsRouting.neighborSettings(device, neighbor);

            if (neighbor.vrf) found.push(`${where}.vrf, ${noVrf}`);

            // A neighbor has no `role` (TRAPS.md).
            if (settings.role) found.push(`${where}.role, FortiOS 6.2 has no BGP roles (RFC 9234)`);
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

    /** A table beside the main one, and policy routing to it. A static route takes the VRF of the interface it leaves through, and a policy route sends traffic to a next hop, not to a table (TRAPS.md). */
    private static tableGaps(device: Device): string[] {
        const routing = device.routing;
        const noTables = "FortiOS 6.2 has no routing table beside its VRFs";
        const found: string[] = [];

        if (routing?.tables) found.push(`routing.tables, ${noTables}`);
        if (routing?.policy_routing)
            found.push("routing.policy_routing, FortiOS 6.2 policy routes send traffic to a next hop, not to a table");
        for (const route of routing?.static_routes ?? [])
            if (Utils.otherTable(route.routing_table)) found.push(`routing.static_routes ${route.prefix} routing_table, ${noTables}`);
        for (const [name, group] of Object.entries(routing?.bgp?.neighbor_groups ?? {}))
            if (Utils.otherTable(group?.routing_table)) found.push(`routing.bgp.neighbor_groups.${name}.routing_table, ${noTables}`);
        for (const [name, neighbor] of Object.entries(routing?.bgp?.neighbors ?? {}))
            if (Utils.otherTable(neighbor?.routing_table)) found.push(`routing.bgp.neighbors.${name}.routing_table, ${noTables}`);

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
