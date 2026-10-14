// OSPF, OSPFv3 and BGP, with the route maps, prefix lists and community lists BGP's policies become.

import { familyOf, host, split } from "../../../core/addr";
import { marker } from "../../../core/secrets";
import type { Device, Family, Neighbor, NeighborSettings, PolicyRule } from "../../../schema";
import { addressesOf, familyOfPrefix, holderOf, nameOf, network, settingsOf, subnet } from "./names";
import { Block, quote, quoteAll, UNSET } from "./tree";

type AnyRule = PolicyRule<string, string>;
type AnyNeighbor = Neighbor<string, string>;

/** The route map a session takes when its config states none, so it learns or announces nothing. */
export const REJECT_ALL = "circuit-reject-all";

/** The start of the comment on a prefix list `refresh` fills. The plan keeps the entries the device holds in one. */
export const FILLED = "Filled by circuit refresh";

/** The table a prefix list of one family sits in. */
export const PREFIX_LIST = { ipv4: "router prefix-list", ipv6: "router prefix-list6" } as const;

/** The longest prefix of each family. */
export const BITS = { ipv4: 32, ipv6: 128 } as const;

/** A neighbor's settings with its group's beneath them. */
export function neighborSettings(device: Device, neighbor: AnyNeighbor): NeighborSettings<string> {
    const group = neighbor.group ? device.routing?.bgp?.groups?.[neighbor.group] : undefined;
    return { ...group, ...neighbor };
}

/** The families a session carries: its own, or the family of its address. */
export function familiesOfNeighbor(device: Device, neighbor: AnyNeighbor): Family[] {
    return [...(neighborSettings(device, neighbor).families ?? [familyOf(neighbor.address)])];
}

/** Whether OSPF or BGP detects a dead neighbor with BFD, which the device then runs. */
export function usesBfd(device: Device): boolean {
    const areas = Object.values(device.routing?.ospf?.areas ?? {});
    const ospf = areas.some((area) => Object.values(area.interfaces).some((settings) => settings?.bfd));
    const bgp = Object.values(device.routing?.bgp?.neighbors ?? {}).some((neighbor) => neighborSettings(device, neighbor).bfd);
    return ospf || bgp;
}

export function routing(root: Block, device: Device): void {
    prefixLists(root, device);
    ospf(root, device);
    ospf6(root, device);
    bgp(root, device);
}

/** A prefix as the platform writes it in a prefix list of its family. */
const listPrefix = (prefix: string, family: Family) => (family === "ipv4" ? subnet(network(prefix)) : network(prefix));

/** One rule of a prefix list: a prefix, and the lengths it takes within it. The device prints a bound the rule does not hold as `unset`. */
function listRule(rule: Block, family: Family, prefix: string, lengths: { ge?: number; le?: number } = {}): void {
    rule.set(family === "ipv4" ? "prefix" : "prefix6", listPrefix(prefix, family));
    rule.set("ge", lengths.ge ?? UNSET);
    rule.set("le", lengths.le ?? UNSET);
}

/** The lengths a rule takes within a prefix to match lengths from `min` to `max`, or none when no length fits. A bound equal to the prefix's own length is left out. */
function bounds(prefix: string, family: Family, min = 0, max: number = BITS[family]): { ge?: number; le?: number } | undefined {
    const own = split(network(prefix)).len;
    const low = Math.max(min, own);
    if (max < low) return undefined;
    if (low === own && max === own) return {};

    return { ...(low > own ? { ge: low } : {}), le: max };
}

/** Each prefix set as a prefix list matching its prefixes and any more specific. One a registry fills starts with a rule that denies every prefix, so it matches nothing until `refresh` fills it. */
function prefixLists(root: Block, device: Device): void {
    for (const [name, set] of Object.entries(device.prefix_sets ?? {})) {
        if ("source" in set) {
            const { registry, query, family } = set.source;
            const entry = root
                .block(PREFIX_LIST[family])
                .entry(name)
                .set("comments", quote(`${FILLED} from ${registry} ${query}`));
            // Until `refresh` fills it, the list refuses every prefix, so a rule matching it matches nothing.
            const rule = entry.block("rule").entry(1);
            listRule(rule, family, family === "ipv4" ? "0.0.0.0/0" : "::/0", { le: BITS[family] });
            rule.set("action", "deny");
            continue;
        }

        const family = set.prefixes[0] ? familyOfPrefix(set.prefixes[0]) : "ipv4";
        const entry = root.block(PREFIX_LIST[family]).entry(name);
        set.prefixes.forEach((prefix, index) => listRule(entry.block("rule").entry(index + 1), family, prefix, bounds(prefix, family)));
    }
}

/** The networks of an interface's addresses of one family, for an OSPF area to announce. */
function networksOf(device: Device, name: string, family: Family): string[] {
    return addressesOf(settingsOf(device, name))
        .filter((address) => familyOfPrefix(address) === family)
        .map(network);
}

/** OSPF for IPv4. An area runs on the networks of its interfaces; an interface named with a cost, a link type or BFD has settings of its own; a passive one forms no adjacency. */
function ospf(root: Block, device: Device): void {
    const ospf = device.routing?.ospf;
    if (!ospf || !(ospf.families ?? ["ipv4"]).includes("ipv4")) return;

    const block = root.block("router ospf");
    if (device.routing?.router_id) block.set("router-id", device.routing.router_id);

    const passive: string[] = [];
    let networks = 0;

    for (const [areaId, area] of Object.entries(ospf.areas)) {
        block.block("area").entry(areaId, true);

        for (const [name, settings] of Object.entries(area.interfaces)) {
            const iface = nameOf(device, name);
            if (settings?.passive) passive.push(iface);

            if (settings?.cost !== undefined || settings?.network === "point-to-point" || settings?.bfd) {
                const entry = block.block("ospf-interface").entry(iface);
                entry.set("interface", quote(iface));
                if (settings.cost !== undefined) entry.set("cost", settings.cost);
                if (settings.network === "point-to-point") entry.set("network-type", "point-to-point");
                if (settings.bfd) entry.set("bfd", "enable");
            }

            for (const prefix of networksOf(device, name, "ipv4")) {
                const entry = block.block("network").entry(++networks);
                entry.set("prefix", subnet(prefix));
                // The backbone is the platform's default area and is not printed.
                if (areaId !== "0.0.0.0") entry.set("area", areaId);
            }
        }
    }

    if (passive.length) block.set("passive-interface", quoteAll(passive));
    for (const source of ospf.redistribute ?? []) block.block(`redistribute "${source}"`).set("status", "enable");
}

/** OSPFv3 for IPv6. Every interface of an area runs it in that area. */
function ospf6(root: Block, device: Device): void {
    const ospf = device.routing?.ospf;
    if (!ospf?.families?.includes("ipv6")) return;

    const block = root.block("router ospf6");
    if (device.routing?.router_id) block.set("router-id", device.routing.router_id);

    const passive: string[] = [];

    for (const [areaId, area] of Object.entries(ospf.areas)) {
        block.block("area").entry(areaId, true);

        for (const [name, settings] of Object.entries(area.interfaces)) {
            const iface = nameOf(device, name);
            if (settings?.passive) passive.push(iface);

            const entry = block.block("ospf6-interface").entry(iface);
            entry.set("interface", quote(iface));
            if (areaId !== "0.0.0.0") entry.set("area-id", areaId);
            if (settings?.cost !== undefined) entry.set("cost", settings.cost);
            if (settings?.network === "point-to-point") entry.set("network-type", "point-to-point");
            if (settings?.bfd) entry.set("bfd", "enable");
        }
    }

    if (passive.length) block.set("passive-interface", quoteAll(passive));
    for (const source of ospf.redistribute ?? []) block.block(`redistribute "${source}"`).set("status", "enable");
}

/** BGP: each session with its settings and group's, the route maps its policies become for each family it carries, and the prefixes the device originates. */
function bgp(root: Block, device: Device): void {
    const bgp = device.routing?.bgp;
    if (!bgp) return;

    const block = root.block("router bgp");
    block.set("as", bgp.asn);
    if (device.routing?.router_id) block.set("router-id", device.routing.router_id);

    const maps = new RouteMaps(root, device);

    for (const neighbor of Object.values(bgp.neighbors ?? {})) {
        const settings = neighborSettings(device, neighbor);
        const families = familiesOfNeighbor(device, neighbor);
        const entry = block.block("neighbor").entry(neighbor.address);

        // Both families are active unless told otherwise.
        if (!families.includes("ipv4")) entry.set("activate", "disable");
        if (!families.includes("ipv6")) entry.set("activate6", "disable");
        if (settings.bfd) entry.set("bfd", "enable");
        if (settings.multihop) entry.set("ebgp-enforce-multihop", "enable");
        if (settings.passive) entry.set("passive", "enable");
        if (settings.description) entry.set("description", quote(settings.description));
        if (settings.remote_as !== undefined) entry.set("remote-as", settings.remote_as);

        for (const family of families) {
            const suffix = family === "ipv4" ? "" : "6";
            if (settings.max_prefixes !== undefined) entry.set(`maximum-prefix${suffix}`, settings.max_prefixes);
            entry.set(`route-map-in${suffix}`, quote(maps.of(settings.import, family)));
            entry.set(`route-map-out${suffix}`, quote(maps.of(settings.export, family)));
        }

        if (settings.keepalive !== undefined) entry.set("keep-alive-timer", settings.keepalive);
        if (settings.hold_time !== undefined) entry.set("holdtime-timer", settings.hold_time);

        const source = settings.local_address ? holderOf(device, settings.local_address) : undefined;
        if (source) entry.set("update-source", quote(nameOf(device, source)));

        if (settings.password) entry.set("password", quote(marker(settings.password)));
    }

    const networks = { ipv4: 0, ipv6: 0 };

    for (const prefix of bgp.networks ?? []) {
        const family = familyOfPrefix(prefix);
        const entry = block.block(family === "ipv4" ? "network" : "network6").entry(++networks[family]);
        entry.set(family === "ipv4" ? "prefix" : "prefix6", listPrefix(prefix, family));
    }
}

/** The family a rule is limited to, by its match: a family, a prefix, or a prefix set of one family. */
export function familyOfRule(device: Device, rule: AnyRule): Family | undefined {
    const match = rule.match;
    if (match?.family) return match.family;
    if (match?.prefix) return familyOfPrefix(match.prefix);

    const set = match?.prefix_set ? device.prefix_sets?.[match.prefix_set] : undefined;
    if (set && "source" in set) return set.source.family;
    if (set?.prefixes[0]) return familyOfPrefix(set.prefixes[0]);

    return undefined;
}

/** A policy's rules with each call replaced by the rules it calls, in order. A called policy that decides nothing hands back to the caller. */
export function flatten(device: Device, policy: string, seen: string[] = [policy]): AnyRule[] {
    const flat: AnyRule[] = [];

    for (const rule of device.policies?.[policy] ?? []) {
        if (rule.call && !seen.includes(rule.call)) flat.push(...flatten(device, rule.call, [...seen, rule.call]));
        if (rule.match || rule.set || rule.action) flat.push(rule);
    }

    return flat;
}

/** A name made of a value's words, for a list named after what it matches: `64500:*` becomes `64500-any`. */
const slug = (value: string) => value.replace(/\*/g, "any").replace(/[^A-Za-z0-9]+/g, "-");

/** A community pattern as a regular expression, `*` standing for any value of its field. */
const patternOf = (pattern: string) => `^${pattern.replace(/\*/g, "[0-9]+")}$`;

/** Each policy as a route map for each family, built once, with the lists its rules match. */
class RouteMaps {
    private readonly built = new Set<string>();

    constructor(
        private readonly root: Block,
        private readonly device: Device
    ) {}

    /** The route map for a policy in one family; one that rejects everything when there is no policy. */
    of(policy: string | undefined, family: Family): string {
        if (!policy) {
            if (!this.built.has(REJECT_ALL)) {
                this.built.add(REJECT_ALL);
                this.root.block("router route-map").entry(REJECT_ALL).block("rule").entry(1).set("action", "deny");
            }

            return REJECT_ALL;
        }

        const name = family === "ipv4" ? policy : `${policy}-v6`;
        if (this.built.has(name)) return name;
        this.built.add(name);

        const map = this.root.block("router route-map").entry(name);
        let number = 0;

        for (const rule of flatten(this.device, policy)) {
            const only = familyOfRule(this.device, rule);
            if (only && only !== family) continue;

            this.rule(map.block("rule").entry(++number), rule, family, `${name}-${number}`);
        }

        return name;
    }

    private rule(entry: Block, rule: AnyRule, family: Family, label: string): void {
        const match = rule.match ?? {};
        const set = rule.set ?? {};
        const address = family === "ipv4" ? "match-ip-address" : "match-ip6-address";

        if (match.prefix) {
            this.list(label, family, [[match.prefix, {}]]);
            entry.set(address, quote(label));
        } else if (match.prefix_set && match.prefix_length) {
            const name = `${match.prefix_set}-${match.prefix_length.min ?? 0}-${match.prefix_length.max ?? BITS[family]}`;
            const prefixes = this.prefixesOf(match.prefix_set);
            this.list(
                name,
                family,
                prefixes.map((prefix) => [prefix, bounds(prefix, family, match.prefix_length?.min, match.prefix_length?.max)])
            );
            entry.set(address, quote(name));
        } else if (match.prefix_set) {
            entry.set(address, quote(match.prefix_set));
        } else if (match.prefix_length) {
            const { min = 0, max = BITS[family] } = match.prefix_length;
            const name = `circuit-length-${min}-${max}`;
            const everything = family === "ipv4" ? "0.0.0.0/0" : "::/0";
            this.list(name, family, [[everything, bounds(everything, family, min, max)]]);
            entry.set(address, quote(name));
        }

        if (match.community)
            entry.set("match-community", quote(this.communities(`circuit-match-${slug(match.community)}`, [match.community], false)));

        if (set.local_pref !== undefined) entry.set("set-local-preference", set.local_pref);
        if (set.med !== undefined) entry.set("set-metric", set.med);
        if (set.prepend !== undefined) entry.set("set-aspath", quote(Array(set.prepend).fill(this.device.routing!.bgp!.asn).join(" ")));

        // Replacing the communities makes removing some needless; added ones join the new ones.
        if (set.communities) {
            entry.set("set-community", quoteAll([...set.communities, ...(set.add_communities ?? [])]));
        } else {
            if (set.add_communities) entry.set("set-community", quoteAll(set.add_communities)).set("set-community-additive", "enable");

            if (set.remove_communities) {
                const name = `circuit-remove-${slug(set.remove_communities.join(" "))}`;
                entry.set("set-community-delete", quote(this.communities(name, set.remove_communities, true)));
            }
        }

        if (set.next_hop && familyOf(set.next_hop) === family)
            entry.set(family === "ipv4" ? "set-ip-nexthop" : "set-ip6-nexthop", set.next_hop);

        // Permit is the default and is not printed.
        if (rule.action === "reject") entry.set("action", "deny");
    }

    /** The prefixes of a set the config lists. */
    private prefixesOf(set: string): string[] {
        const prefixes = this.device.prefix_sets?.[set];
        return prefixes && "prefixes" in prefixes ? [...prefixes.prefixes] : [];
    }

    /** A prefix list of its own, rule by rule; a prefix no length fits is left out. */
    private list(name: string, family: Family, rules: [string, { ge?: number; le?: number } | undefined][]): void {
        const rulesBlock = this.root.block(PREFIX_LIST[family]).entry(name).block("rule");
        let number = 0;

        for (const [prefix, lengths] of rules) if (lengths) listRule(rulesBlock.entry(++number), family, prefix, lengths);
    }

    /** A community list matching these communities, or, expanded, these patterns. */
    private communities(name: string, values: readonly string[], patterns: boolean): string {
        const list = this.root.block("router community-list").entry(name);
        if (patterns) list.set("type", "expanded");

        values.forEach((value, index) => {
            const rule = list
                .block("rule")
                .entry(index + 1)
                .set("action", "permit");
            if (patterns) rule.set("regexp", quote(patternOf(value)));
            else rule.set("match", quote(value));
        });

        return name;
    }
}

/** Routing the platform cannot express, or that this adapter does not yet write. */
export function routingGaps(device: Device): string[] {
    const found: string[] = [];
    const routing = device.routing;

    if (routing?.rpki) found.push("routing.rpki, the platform has no route origin validation");
    if (routing?.router_id && !routing.ospf && !routing.bgp) found.push("routing.router_id without OSPF or BGP, which each hold it");

    const ospf = routing?.ospf;
    if (ospf?.families?.includes("ipv6") && !routing?.router_id) found.push("routing.ospf for IPv6 without routing.router_id");

    for (const area of Object.values(ospf?.areas ?? {})) {
        for (const name of Object.keys(area.interfaces)) {
            if (settingsOf(device, name)?.vrf) found.push(`routing.ospf on ${name}, which routes in a VRF: OSPF runs in the default table`);

            const ipv4 = addressesOf(settingsOf(device, name)).some((address) => familyOf(host(address)) === "ipv4");
            if ((ospf?.families ?? ["ipv4"]).includes("ipv4") && !ipv4)
                found.push(`routing.ospf on ${name}, which has no IPv4 address for OSPF to run on`);
        }
    }

    for (const [name, neighbor] of Object.entries(routing?.bgp?.neighbors ?? {})) {
        const where = `routing.bgp.neighbors.${name}`;
        const settings = neighborSettings(device, neighbor);

        if (settings.role) found.push(`${where}.role, the platform has no BGP roles`);
        if (settings.local_address && !holderOf(device, settings.local_address)) {
            found.push(`${where}.local_address, no interface holds ${settings.local_address}`);
        }

        if (familyOf(neighbor.address) === "ipv6" && familiesOfNeighbor(device, neighbor).includes("ipv4")) {
            found.push(`${where}.families ipv4 over an IPv6 session`);
        }
    }

    for (const [name, rules] of Object.entries(device.policies ?? {})) {
        rules.forEach((rule, index) => found.push(...ruleGaps(device, `policies.${name}[${index}]`, rule)));
    }

    return found;
}

function ruleGaps(device: Device, where: string, rule: AnyRule): string[] {
    const found: string[] = [];
    const match = rule.match ?? {};
    const set = rule.set ?? {};

    if ((rule.match || rule.set) && !rule.action)
        found.push(`${where}, a rule without action: the platform stops at the first rule that matches`);

    for (const field of ["as_path_length", "rpki", "large_community"] as const) {
        if (match[field] !== undefined) found.push(`${where}.match.${field}`);
    }

    for (const field of [
        "large_communities",
        "add_large_communities",
        "remove_large_communities",
        "preferred_source",
        "blackhole",
    ] as const) {
        if (set[field] !== undefined) found.push(`${where}.set.${field}`);
    }

    if (match.prefix && match.prefix_length) found.push(`${where}.match.prefix with prefix_length`);
    if (match.prefix && match.prefix_set) found.push(`${where}.match.prefix with prefix_set`);

    const prefixSet = match.prefix_set ? device.prefix_sets?.[match.prefix_set] : undefined;
    if (prefixSet && "source" in prefixSet && match.prefix_length) {
        found.push(`${where}.match.prefix_length with a prefix set a registry fills`);
    }

    return found;
}
