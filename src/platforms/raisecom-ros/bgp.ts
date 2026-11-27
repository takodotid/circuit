// BGP on Raisecom ROS: one `router bgp <asn>` block with each session's lines, for IPv4 in the main table. A RAX721 on ROS 6.5.2 took each line and printed it as written here, with sessions that never came up (TRAPS.md).

import { Address } from "../../core/address";
import { Secrets } from "../../core/secrets";
import type { Device, Neighbor, NeighborSettings, RouteRule } from "../../model";
import type { Group } from "../line-diff";
import { RaisecomRosIsis } from "./isis";
import { RaisecomRosPolicies } from "./policies";

export class RaisecomRosBgp {
    /** The most hops an eBGP session may cross, 255: `multihop` sets no limit. */
    private static readonly MAX_HOPS = 255;

    /** The timers the switch takes, in seconds. */
    static readonly KEEPALIVE_MAX = 21845;
    static readonly HOLD_MAX = 65535;

    /** A session's line: `neighbor <address> ...`. */
    private static readonly NEIGHBOR = /^neighbor (\S+) /;

    /** The process's header. */
    static readonly HEADER = /^router bgp \d+$/;

    /** A route-map entry's header: removed once nothing uses its policy. */
    private static readonly ROUTE_MAP = /^route-map (\S+) (?:permit|deny) (\d+)$/;

    /** A list's entry: removed once no route-map uses the list. */
    private static readonly LIST = /^(ip prefix-list \S+|ip community-list standard \S+|ip as-path access-list \d+) /;

    /** The lists and route-maps the sessions and IS-IS use, then the BGP block. No block without `routing.bgp.asn`, which `unsupported()` names. */
    static lines(device: Device): string[] {
        const bgp = device.routing?.bgp;
        const lists = RaisecomRosPolicies.lines(device, RaisecomRosBgp.policies(device));
        return bgp?.asn === undefined ? lists : [...lists, ...RaisecomRosBgp.block(device, RaisecomRosBgp.neighbors(device))];
    }

    /** The policies written as route-maps: each session's, or the one that rejects every route, and the one of IS-IS's leak, by name. */
    static policies(device: Device): string[] {
        const used = new Set(RaisecomRosIsis.policies(device));
        for (const neighbor of RaisecomRosBgp.neighbors(device)) {
            const settings = RaisecomRosBgp.settingsOf(device, neighbor);
            used.add(settings.import_policy ?? RaisecomRosPolicies.REJECT_ALL);
            used.add(settings.export_policy ?? RaisecomRosPolicies.REJECT_ALL);
        }
        return [...used].sort();
    }

    private static neighbors(device: Device): Neighbor[] {
        return Object.values(device.routing?.bgp?.neighbors ?? {}).flatMap((neighbor) => (neighbor ? [neighbor] : []));
    }

    /** BGP and the policies that pick routes, for BGP or for IS-IS's leak. The switch took them and printed them back. No session or adjacency came up, so no route crossed them. */
    static experimental(device: Device): string[] {
        const found = device.routing?.bgp ? ["routing.bgp"] : [];
        for (const name of Object.keys(device.routing?.policies ?? {})) found.push(`routing.policies.${name}`);
        return found;
    }

    /** A neighbor's settings with its group's beneath them. Each session is written whole, so a plan changes one session at a time. */
    static settingsOf(device: Device, neighbor: Neighbor): NeighborSettings {
        const group = neighbor.neighbor_group ? device.routing?.bgp?.neighbor_groups?.[neighbor.neighbor_group] : undefined;
        return { ...group, ...neighbor };
    }

    /** The block: the router's own settings, the prefixes it originates and aggregates, then each session, in the order the switch prints them. */
    private static block(device: Device, neighbors: Neighbor[]): string[] {
        const bgp = device.routing!.bgp!;
        const routerId = device.routing?.router_id;
        const lines = [`router bgp ${bgp.asn}`];

        if (routerId) lines.push(` bgp router-id ${routerId}`);
        if (bgp.cluster_id) lines.push(` bgp cluster-id ${bgp.cluster_id}`);

        for (const prefix of bgp.originated_prefixes ?? []) {
            const { addr, len } = Address.split(prefix);
            lines.push(` network ${addr} ${Address.netmask(len)}`);
        }
        for (const aggregate of bgp.aggregates ?? []) {
            const { addr, len } = Address.split(aggregate.prefix);
            lines.push(` aggregate-address ${addr} ${Address.netmask(len)}${aggregate.summary_only ? " summary-only" : ""}`);
        }

        for (const neighbor of neighbors) lines.push(...RaisecomRosBgp.session(device, neighbor).map((line) => ` ${line}`));
        return [...lines, "!"];
    }

    /** A session's lines. The switch sends communities only to a session told to, so every session is. */
    private static session(device: Device, neighbor: Neighbor): string[] {
        const settings = RaisecomRosBgp.settingsOf(device, neighbor);
        const peer = `neighbor ${neighbor.address}`;
        const lines = [`${peer} remote-as ${settings.remote_as}`];

        if (settings.description) lines.push(`${peer} description ${settings.description}`);
        if (settings.password) lines.push(`${peer} password ${Secrets.marker(settings.password)}`);
        // An internal session may cross any number of hops already.
        if (settings.multihop && settings.remote_as !== device.routing?.bgp?.asn)
            lines.push(`${peer} ebgp-multihop ${RaisecomRosBgp.MAX_HOPS}`);
        if (settings.local_address) lines.push(`${peer} update-source ${Address.host(settings.local_address)}`);
        if (settings.keepalive !== undefined && settings.hold_time !== undefined)
            lines.push(`${peer} timers ${settings.keepalive} ${settings.hold_time}`);
        if (settings.bfd) lines.push(`${peer} fall-over bfd`);
        // Sent whether or not the device has a default route.
        if (settings.send_default_route) lines.push(`${peer} default-originate`);
        if (settings.route_reflector_client) lines.push(`${peer} route-reflector-client`);

        lines.push(
            `${peer} send-community standard`,
            `${peer} route-map ${settings.import_policy ?? RaisecomRosPolicies.REJECT_ALL} in`,
            `${peer} route-map ${settings.export_policy ?? RaisecomRosPolicies.REJECT_ALL} out`
        );
        return lines;
    }

    /** Which lines of the block and of a route-map are one setting with two values, or undefined for another line. */
    static head(line: string): string | undefined {
        const routeMap = /^neighbor \S+ route-map \S+ (in|out)$/.exec(line);
        if (routeMap) return line.replace(/ route-map \S+ /, " route-map ");

        const setting = /^neighbor \S+ (?:description|password|timers) /.exec(line);
        if (setting) return setting[0].trimEnd();

        // An aggregate with or without `summary-only` replaces the one with its address and mask.
        const aggregate = /^aggregate-address \S+ \S+/.exec(line);
        if (aggregate) return aggregate[0];

        // A list's entries each stand alone, but a prefix list's entry is replaced by one with its number. The switch refuses a new AS for a session it has, so the old one goes.
        const prefixEntry = /^ip prefix-list \S+ seq \d+/.exec(line);
        if (prefixEntry) return prefixEntry[0];
        if (/^(ip community-list|ip as-path access-list|network|neighbor \S+ remote-as) /.test(line)) return line;

        // A route-map entry holds one of each kind of line.
        return /^(match community|set community|set comm-list|set as-path prepend) /.exec(line)?.[1];
    }

    /** The undo of a line of BGP or a route policy that is not the line with `no` before it, or undefined. */
    static undo(line: string, path: readonly string[]): string | undefined {
        // A session goes whole, its every line with it.
        const neighbor = /^neighbor (\S+) remote-as /.exec(line);
        if (neighbor) return `no neighbor ${neighbor[1]}`;

        const keyword = /^(neighbor \S+ (?:description|password|ebgp-multihop|update-source|timers)|bgp router-id|bgp cluster-id) /.exec(
            line
        );
        if (keyword) return `no ${keyword[1]}`;

        const routeMap = /^(neighbor \S+ route-map) \S+ (in|out)$/.exec(line);
        if (routeMap) return `no ${routeMap[1]} ${routeMap[2]}`;

        // An aggregate goes by its address and mask, without `summary-only`.
        const aggregate = /^aggregate-address \S+ \S+/.exec(line);
        if (aggregate) return `no ${aggregate[0]}`;

        // A route-map's line goes by its kind alone.
        if (path[0]?.startsWith("route-map ")) {
            const kind =
                /^(description|call|match (?:ip address prefix-list|community|as-path)|set (?:local-preference|metric|ip next-hop|as-path prepend|comm-list|community))\b/.exec(
                    line
                );
            if (kind) return `no ${kind[1]}`;
        }

        return undefined;
    }

    /**
     * A plan that changes BGP. A session whose AS changes is removed whole and written again, as the switch refuses a new AS for a session it has. A route-map entry or a list that goes is removed after the sessions let go of it, and the process after its sessions. Returns what goes last, in order.
     */
    static order(groups: Group[], desired: string): string[] {
        RaisecomRosBgp.renewNeighbors(groups, desired);

        const top = groups.find((group) => group.path.length === 0);
        if (!top) return [];

        // A set from a registry the render did not fetch keeps what the device holds.
        const unfetched = desired
            .split("\n")
            .filter((line) => line.startsWith(RaisecomRosPolicies.UNFETCHED))
            .map((line) => `ip prefix-list ${line.slice(RaisecomRosPolicies.UNFETCHED.length)} `);
        top.remove = top.remove.filter((line) => !unfetched.some((prefix) => line.startsWith(prefix)));

        const entries = new Set(desired.split("\n").flatMap((line) => RaisecomRosBgp.entryKey(line) ?? []));
        const lists = new Set(desired.split("\n").flatMap((line) => RaisecomRosBgp.LIST.exec(line)?.[1] ?? []));

        const processes = top.remove.filter((line) => RaisecomRosBgp.HEADER.test(line));
        const routeMaps = top.remove.filter((line) => RaisecomRosBgp.ROUTE_MAP.test(line) && !entries.has(RaisecomRosBgp.entryKey(line)!));
        const goneLists = top.remove.filter((line) => {
            const list = RaisecomRosBgp.LIST.exec(line)?.[1];
            return list !== undefined && !lists.has(list);
        });
        const late = [...processes, ...routeMaps, ...goneLists];
        top.remove = top.remove.filter((line) => !late.includes(line));

        // A list that goes whole goes by its name, once.
        const listNames = [...new Set(goneLists.map((line) => RaisecomRosBgp.LIST.exec(line)![1]!))];
        return [...processes, ...routeMaps, ...listNames];
    }

    /** `route-map <name> <sequence>`, which an entry keeps whether it permits or denies. */
    private static entryKey(line: string): string | undefined {
        const entry = RaisecomRosBgp.ROUTE_MAP.exec(line);
        return entry ? `${entry[1]} ${entry[2]}` : undefined;
    }

    /** A session that goes, or whose AS changes, goes whole with `no neighbor`, which takes its every line with it. One whose AS changes is written whole again, its AS first. */
    private static renewNeighbors(groups: Group[], desired: string): void {
        const block = groups.find((group) => group.path.length === 1 && RaisecomRosBgp.HEADER.test(group.path[0]!));
        if (!block) return;

        const gone = new Set(block.remove.flatMap((line) => /^neighbor (\S+) remote-as /.exec(line)?.[1] ?? []));
        if (!gone.size) return;

        const ofGone = (line: string) => gone.has(RaisecomRosBgp.NEIGHBOR.exec(line)?.[1] ?? "");
        const renewed = desired
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => ofGone(line));

        block.remove = block.remove.filter((line) => !ofGone(line) || / remote-as /.test(line));
        block.add = [...block.add.filter((line) => !ofGone(line)), ...renewed];
    }

    /** What BGP takes here, and what it can't: the process, the sessions, then the policies' rules. */
    static unsupported(device: Device): string[] {
        const bgp = device.routing?.bgp;
        const found: string[] = [];
        const none = "ROS 6.5.2 has none";

        if (bgp && bgp.asn === undefined) found.push("routing.bgp.asn, absent: write it here or in circuit.ts");
        if (bgp?.confederation) found.push(`routing.bgp.confederation, ${none}`);
        const routerId = device.routing?.router_id;
        if (bgp && routerId && Address.family(routerId) === "ipv6") found.push("routing.router_id, IPv6: BGP takes an IPv4 router ID");

        for (const prefix of bgp?.originated_prefixes ?? [])
            if (Address.family(Address.host(prefix)) === "ipv6")
                found.push(`routing.bgp.originated_prefixes ${prefix}, BGP carries IPv4 here`);
        (bgp?.aggregates ?? []).forEach((aggregate, index) => {
            if (Address.family(Address.host(aggregate.prefix)) === "ipv6")
                found.push(`routing.bgp.aggregates[${index}], BGP carries IPv4 here`);
        });

        for (const [name, neighbor] of Object.entries(bgp?.neighbors ?? {}))
            if (neighbor) found.push(...RaisecomRosBgp.neighborGaps(device, `routing.bgp.neighbors.${name}`, neighbor));

        for (const [name, rules] of Object.entries(device.routing?.policies ?? {})) {
            (rules ?? []).forEach((rule, index) => {
                const where = `routing.policies.${name}[${index}]`;
                if ("communities" in rule && rule.communities !== undefined)
                    found.push(`${where}.communities, a rule the platform does not write`);
                if (RaisecomRosPolicies.isRouteRule(rule)) found.push(...RaisecomRosBgp.ruleGaps(device, where, rule));
            });
        }

        return [...new Set([...found, ...RaisecomRosBgp.nameGaps(device)])];
    }

    /** Names and numbers past what the switch takes: a route-map's and a prefix list's name, an entry's description, and the AS path lists. */
    private static nameGaps(device: Device): string[] {
        const found: string[] = [];
        const { NAME_MAX, DESCRIPTION_MAX, AS_PATH_LISTS } = RaisecomRosPolicies;
        const policies = RaisecomRosBgp.policies(device);

        for (const name of policies)
            if (name.length > NAME_MAX)
                found.push(`routing.policies.${name}, a name the switch refuses: a route-map's takes ${NAME_MAX} characters`);

        for (const [name, set] of Object.entries(device.routing?.prefix_sets ?? {}))
            if (set && RaisecomRosPolicies.holdsIpv4(set) && name.length > NAME_MAX)
                found.push(`routing.prefix_sets.${name}, a name the switch refuses: a prefix list's takes ${NAME_MAX} characters`);

        for (const [name, rules] of Object.entries(device.routing?.policies ?? {}))
            (rules ?? []).forEach((rule, index) => {
                if ("description" in rule && rule.description && rule.description.length > DESCRIPTION_MAX)
                    found.push(`routing.policies.${name}[${index}].description, over the ${DESCRIPTION_MAX} characters the switch takes`);
            });

        const lists = RaisecomRosPolicies.asPathLists(device, policies);
        if (lists > AS_PATH_LISTS.max)
            found.push(`routing.policies, ${lists} different AS matches: the switch numbers AS path lists up to ${AS_PATH_LISTS.max}`);

        return found;
    }

    private static neighborGaps(device: Device, where: string, neighbor: Neighbor): string[] {
        const settings = RaisecomRosBgp.settingsOf(device, neighbor);
        const found: string[] = [];
        const none = "ROS 6.5.2 has none";

        if (Address.family(neighbor.address) === "ipv6") found.push(`${where}.address, IPv6: BGP carries IPv4 here`);
        if ((settings.address_families ?? ["ipv4"]).some((family) => family !== "ipv4"))
            found.push(`${where}.address_families, BGP carries IPv4 here`);
        if (settings.role) found.push(`${where}.role, ${none}`);
        if (settings.ttl_security) found.push(`${where}.ttl_security, ${none}`);
        if (settings.passive) found.push(`${where}.passive, ${none}`);
        if (settings.max_prefixes !== undefined) found.push(`${where}.max_prefixes, ${none}`);
        // `bgp graceful-restart` takes only its timers here, `restart-time` and `stalepath-time`, and no line turns it on.
        if (settings.graceful_restart)
            found.push(`${where}.graceful_restart, ROS 6.5.2 sets only graceful restart's timers, and no line turns it on`);
        if (settings.vrf) found.push(`${where}.vrf, BGP in a VRF is not built yet here`);
        if (settings.routing_table && settings.routing_table !== "main")
            found.push(`${where}.routing_table, BGP runs in the main table here`);
        if (settings.local_address && Address.family(Address.host(settings.local_address)) === "ipv6")
            found.push(`${where}.local_address, IPv6: BGP carries IPv4 here`);
        if (settings.route_reflector_client && settings.remote_as !== device.routing?.bgp?.asn)
            found.push(`${where}.route_reflector_client, for iBGP neighbors only`);

        const { hold_time: hold, keepalive } = settings;
        if ((hold === undefined) !== (keepalive === undefined))
            found.push(`${where}.${hold === undefined ? "keepalive" : "hold_time"}, the switch sets both together, so write both`);
        if (keepalive !== undefined && keepalive > RaisecomRosBgp.KEEPALIVE_MAX)
            found.push(`${where}.keepalive ${keepalive}, the switch takes 0 to ${RaisecomRosBgp.KEEPALIVE_MAX}`);
        if (hold !== undefined && hold > RaisecomRosBgp.HOLD_MAX)
            found.push(`${where}.hold_time ${hold}, the switch takes 0 to ${RaisecomRosBgp.HOLD_MAX}`);

        return found;
    }

    /** What a rule asks that a route-map here can't do. */
    private static ruleGaps(device: Device, where: string, rule: RouteRule): string[] {
        const found: string[] = [];
        const match = rule.if ?? {};
        const set = rule.set ?? {};
        const noLarge = "ROS 6.5.2 has no large communities";
        const ipv4 = "BGP carries IPv4 here";

        if (rule.then === undefined)
            found.push(
                `${where}, a rule without then: a route-map here has no continue, so a route ends at the first entry it matches. Give the rule then: accept or reject`
            );

        const prefixes = RaisecomRosPolicies.prefixConditions(match);
        if (prefixes.length > 1)
            found.push(`${where}.if.${prefixes[1]}, with ${prefixes[0]}: an entry matches one prefix list, so write one of them`);
        if (match.family === "ipv6") found.push(`${where}.if.family ipv6, ${ipv4}`);
        if (match.prefix && Address.family(Address.host(match.prefix)) === "ipv6")
            found.push(`${where}.if.prefix ${match.prefix}, ${ipv4}`);
        const prefixSet = match.prefix_set ? device.routing?.prefix_sets?.[match.prefix_set] : undefined;
        if (prefixSet && !RaisecomRosPolicies.holdsIpv4(prefixSet))
            found.push(`${where}.if.prefix_set ${match.prefix_set}, which holds no IPv4 prefix: ${ipv4}`);

        const fields = RaisecomRosPolicies.AS_FIELDS.filter((field) => match[field] !== undefined);
        if (fields.length > 1)
            found.push(
                `${where}.if.${fields[1]}, with ${fields[0]}: an entry matches one AS path list, so match each in a rule of its own`
            );
        if (match.as_path_length) found.push(`${where}.if.as_path_length, not built yet`);
        if (match.rpki) found.push(`${where}.if.rpki, routing.rpki is not on this platform`);
        if (match.large_community) found.push(`${where}.if.large_community, ${noLarge}`);
        if ([match.standard_community ?? []].flat().some((value) => value.includes("*")))
            found.push(`${where}.if.standard_community, with *: exact communities only, not built yet`);

        for (const key of ["large_communities", "add_large_communities", "remove_large_communities"] as const)
            if (set[key]) found.push(`${where}.set.${key}, ${noLarge}`);
        if (!set.standard_communities && set.remove_standard_communities?.some((value) => value.includes("*")))
            found.push(`${where}.set.remove_standard_communities, with *: exact communities only, not built yet`);
        if (set.preferred_source) found.push(`${where}.set.preferred_source, BGP has no source address here`);
        if (set.blackhole) found.push(`${where}.set.blackhole, not built yet`);
        if (set.next_hop && Address.family(set.next_hop) === "ipv6") found.push(`${where}.set.next_hop, IPv6: ${ipv4}`);
        if (set.prepend !== undefined && device.routing?.bgp?.asn === undefined)
            found.push(`${where}.set.prepend, without routing.bgp.asn to prepend`);

        return found;
    }
}
