// BGP on VRP: one `bgp <asn>` view with each session, and a view for each address family that holds what the sessions exchange. The commands are from Huawei's CloudEngine command reference; a CE6855 on V200R005C00SPC800 showed which of them it has and how it prints them.

import { Address } from "../../core/address";
import { Derive } from "../../core/derive";
import { Secrets } from "../../core/secrets";
import type { Device, Family, Interface, Neighbor, NeighborSettings, RouteRule } from "../../model";
import { LineDiff } from "../line-diff";
import type { Dialect, Group } from "../line-diff";
import { VrpNames } from "./names";
import { VrpPolicies } from "./policies";

export class VrpBgp {
    /** The view of each address family. */
    private static readonly FAMILY_VIEW = { ipv4: "ipv4-family unicast", ipv6: "ipv6-family unicast" } as const;

    /** The most hops an eBGP session may cross: `multihop` sets no limit. */
    private static readonly MAX_HOPS = 255;

    static readonly SECONDS_PER_MINUTE = 60;

    /** How long the switch waits before it opens a session closed on its prefix limit, in whole minutes. */
    static readonly IDLE_MINUTES = { min: 1, max: 1200 };

    /** The timers the switch takes. The hold time is 0 or 3 seconds and up, and at least three keepalives. */
    private static readonly KEEPALIVE_MAX = 21845;
    private static readonly HOLD = { min: 3, max: 65535 };
    private static readonly KEEPALIVES_PER_HOLD = 3;

    /** A line of a session: `peer <address> ...`. */
    private static readonly PEER = /^peer (\S+) /;

    /** Lists and filters: removed once no node names them. */
    private static readonly LISTS = /^(ip ip-prefix|ip ipv6-prefix|ip community-filter basic|ip as-path-filter) (\S+) index \d+ /;

    /** A node's header: removed once no session uses its policy. */
    private static readonly NODE = /^route-policy (\S+) (?:permit|deny) node (\d+)$/;

    /** The prefix lists, filters, and route-policies the sessions and `others` use, then the BGP view. No view without `routing.bgp.asn`, which `unsupported()` names. */
    static lines(device: Device, others: readonly string[] = []): string[] {
        const bgp = device.routing?.bgp;
        if (!bgp || bgp.asn === undefined) return VrpPolicies.lines(device, [...new Set(others)].sort());

        const neighbors = Object.values(bgp.neighbors ?? {}).flatMap((neighbor) => (neighbor ? [neighbor] : []));
        const used = new Set([
            ...others,
            ...neighbors.flatMap((neighbor) => {
                const settings = VrpBgp.settingsOf(device, neighbor);
                if (!VrpBgp.unicast(settings, neighbor)) return [];
                return [settings.import_policy ?? VrpPolicies.REJECT_ALL, settings.export_policy ?? VrpPolicies.REJECT_ALL];
            }),
        ]);

        return [...VrpPolicies.lines(device, [...used].sort()), ...VrpBgp.view(device, neighbors)];
    }

    /** A neighbor's settings with its group's beneath them. */
    static settingsOf(device: Device, neighbor: Neighbor): NeighborSettings {
        const group = neighbor.neighbor_group ? device.routing?.bgp?.neighbor_groups?.[neighbor.neighbor_group] : undefined;
        return { ...group, ...neighbor };
    }

    /** The VLAN interface or loopback that holds `address`, as the switch calls it. */
    static interfaceOf(device: Device, address: string): string | undefined {
        const holds = (entries: NonNullable<Interface["addresses"]> = []) =>
            entries.some(
                (entry) => Address.canonical(Address.host(typeof entry === "string" ? entry : entry.address)) === Address.canonical(address)
            );

        for (const iface of Object.values(device.interfaces?.vlan_interface ?? {})) {
            const vlan = iface && device.switching?.vlans?.[iface.vlan];
            if (vlan && holds(iface.addresses)) return `Vlanif${vlan.id}`;
        }

        for (const [name, loopback] of Object.entries(device.interfaces?.loopback ?? {}))
            if (holds(loopback?.addresses)) return VrpNames.loopback(device, name);

        return undefined;
    }

    /** A session from an IPv6 address of its own: `connect-interface` with an IPv6 address is in the command reference, but no switch has shown how it prints it. */
    static experimental(device: Device): string[] {
        return Object.entries(device.routing?.bgp?.neighbors ?? {}).flatMap(([name, neighbor]) => {
            const local = neighbor && VrpBgp.settingsOf(device, neighbor).local_address;
            return local && Address.family(Address.host(local)) === "ipv6" ? [`routing.bgp.neighbors.${name}.local_address`] : [];
        });
    }

    /** What BGP takes here, and what it can't: the sessions, then the policies' rules. */
    static unsupported(device: Device): string[] {
        const bgp = device.routing?.bgp;
        const found: string[] = [];

        if (bgp && bgp.asn === undefined) found.push("routing.bgp.asn, absent: write it here or in circuit.ts");
        const routerId = device.routing?.router_id;
        if (bgp && routerId && Address.family(routerId) === "ipv6") found.push("routing.router_id, IPv6: BGP takes an IPv4 router ID");

        for (const [name, neighbor] of Object.entries(bgp?.neighbors ?? {})) {
            if (neighbor) found.push(...VrpBgp.neighborGaps(device, `routing.bgp.neighbors.${name}`, neighbor));
        }

        // A CE6855 refused `peer <address> graceful-restart`: `graceful-restart` in the BGP view is for every session.
        const graceful = Object.entries(bgp?.neighbors ?? {}).map(([name, neighbor]) => ({
            name,
            on: !!neighbor && !!VrpBgp.settingsOf(device, neighbor).graceful_restart,
        }));
        const first = graceful.find(({ on }) => on)?.name;
        const without = graceful.filter(({ on }) => !on).map(({ name }) => name);
        if (first && without.length)
            found.push(
                `routing.bgp.neighbors.${first}.graceful_restart, but not on ${without.join(", ")}: the platform turns it on for every session at once. Set it on every neighbor or on none`
            );

        for (const [name, rules] of Object.entries(device.routing?.policies ?? {})) {
            (rules ?? []).forEach((rule, index) => {
                const where = `routing.policies.${name}[${index}]`;
                if ("communities" in rule && rule.communities !== undefined)
                    found.push(`${where}.communities, a rule the platform does not write`);
                if (VrpPolicies.isRouteRule(rule)) found.push(...VrpBgp.ruleGaps(device, where, rule));
            });

            for (const { number, rule } of VrpPolicies.nodes(device, name)) {
                const filters = [
                    ...(VrpPolicies.AS_FIELDS.some((field) => rule.if?.[field] !== undefined) ? (["path"] as const) : []),
                    ...(rule.set?.remove_standard_communities?.length && !rule.set.standard_communities ? (["remove"] as const) : []),
                ];
                const long = filters
                    .map((kind) => VrpPolicies.filterName(kind, name, number))
                    .find((filter) => filter.length > VrpPolicies.FILTER_NAME);
                if (long)
                    found.push(
                        `routing.policies.${name}, a name too long for the filter ${long}: the platform takes ${VrpPolicies.FILTER_NAME} characters`
                    );
            }
        }

        return [...new Set(found)];
    }

    /**
     * A plan that changes BGP. A route-policy, a list, or a filter that goes is removed last, after the sessions and nodes that use it let go of it. A set from a registry the render did not fetch keeps what the device holds. Returns what is removed last.
     */
    static order(groups: Group[], desired: string, dialect: Dialect): string[] {
        const unfetched = desired
            .split("\n")
            .filter((line) => line.startsWith(VrpPolicies.UNFETCHED))
            .map((line) => `${line.slice(VrpPolicies.UNFETCHED.length)} `);

        VrpBgp.renewPeers(groups, desired, dialect);

        const top = groups.find((group) => group.path.length === 0);
        if (!top) return [];

        const nodes = new Set(desired.split("\n").flatMap((line) => VrpBgp.nodeKey(line) ?? []));
        const lists = new Set(desired.split("\n").flatMap((line) => VrpBgp.listKey(line) ?? []));

        top.remove = top.remove.filter((line) => !unfetched.some((prefix) => line.startsWith(prefix)));
        const lastNodes = top.remove.filter((line) => VrpBgp.NODE.test(line) && !nodes.has(VrpBgp.nodeKey(line)!));
        const lastLists = top.remove.filter((line) => VrpBgp.LISTS.test(line) && !lists.has(VrpBgp.listKey(line)!));
        top.remove = top.remove.filter((line) => !lastNodes.includes(line) && !lastLists.includes(line));

        return [...lastNodes, ...lastLists];
    }

    /**
     * A session that goes, or whose AS changes, is removed whole by `undo peer`, which takes its every line with it. The switch refuses a new AS for a session it has. A session that stays is then written whole again, its own lines first.
     */
    private static renewPeers(groups: Group[], desired: string, dialect: Dialect): void {
        const wanted = LineDiff.entries(desired, dialect);
        const key = (path: readonly string[]) => path.join("\u0000");

        for (const group of groups.filter((each) => each.path.length === 1 && each.path[0]?.startsWith("bgp "))) {
            const undone = new Set(group.remove.flatMap((line) => /^peer (\S+) as-number /.exec(line)?.[1] ?? []));
            const ofUndone = (line: string) => undone.has(VrpBgp.PEER.exec(line)?.[1] ?? "");
            const view = groups.filter((each) => each.path[0] === group.path[0]);

            for (const each of view) each.remove = each.remove.filter((line) => !ofUndone(line) || / as-number /.test(line));

            for (const entry of wanted.filter((each) => each.path[0] === group.path[0] && ofUndone(each.line))) {
                let target = groups.find((each) => key(each.path) === key(entry.path));
                if (!target) {
                    target = { path: entry.path, remove: [], add: [] };
                    groups.push(target);
                }
                if (!target.add.includes(entry.line)) target.add.push(entry.line);
            }

            // In the order the render writes them, so a session's AS comes before its other lines.
            for (const each of groups.filter((other) => other.path[0] === group.path[0])) {
                const order = wanted.filter((entry) => key(entry.path) === key(each.path)).map((entry) => entry.line);
                each.add.sort((a, b) => order.indexOf(a) - order.indexOf(b));
            }
        }
    }

    /** The undo of a BGP or route-policy line that is not the line with `undo` before it, or nothing. */
    static undo(line: string): string | undefined {
        // A session goes whole, and every line of it with it.
        const peer = /^peer (\S+) as-number /.exec(line);
        if (peer) return `undo peer ${peer[1]}`;

        const keyword =
            /^(confederation id|peer \S+ (?:description|ebgp-max-hop|connect-interface|password|route-limit|valid-ttl-hops)|router-id|reflector cluster-id) /.exec(
                line
            );
        if (keyword) return `undo ${keyword[1]}`;

        const node = VrpBgp.NODE.exec(line);
        if (node) return `undo route-policy ${node[1]} node ${node[2]}`;

        const entry = /^(ip ip-prefix|ip ipv6-prefix|ip community-filter basic|ip as-path-filter) (\S+ index \d+) /.exec(line);
        if (entry) return `undo ${entry[1]} ${entry[2]}`;

        // An aggregate is undone by its address and mask, without `detail-suppressed`.
        const aggregate = /^aggregate \S+ \S+/.exec(line);
        if (aggregate) return `undo ${aggregate[0]}`;

        const applied = /^apply (local-preference|cost|as-path|community|comm-filter) /.exec(line);
        if (applied) return `undo apply ${applied[1]}`;

        return undefined;
    }

    /** Which lines are one setting with two values: none of BGP's and the route-policies'. Each line is undone before its new value, and a session's new AS goes through `renewPeers`. */
    static head(line: string): string | undefined {
        return /^(peer|network|aggregate|router-id|reflector|if-match|apply|route-policy|bgp) |^(ip ip-prefix|ip ipv6-prefix|ip community-filter|ip as-path-filter) /.test(
            line
        )
            ? line
            : undefined;
    }

    /** `route-policy <name> node <number>`, which a node keeps whether it permits or denies. */
    private static nodeKey(line: string): string | undefined {
        const node = VrpBgp.NODE.exec(line);
        return node ? `${node[1]} ${node[2]}` : undefined;
    }

    /** A list or a filter: its command and name. */
    private static listKey(line: string): string | undefined {
        const list = VrpBgp.LISTS.exec(line);
        return list ? `${list[1]} ${list[2]}` : undefined;
    }

    /** The BGP view: the sessions, then each family's view with its networks and what each session exchanges in it. */
    private static view(device: Device, neighbors: Neighbor[]): string[] {
        const bgp = device.routing!.bgp!;
        const routerId = device.routing?.router_id;
        const lines = [`bgp ${bgp.asn}`, ...(routerId ? [` router-id ${routerId}`] : [])];
        const confederation = bgp.confederation;
        if (confederation) lines.push(` confederation id ${confederation.identifier}`);
        if (confederation?.member_as.length) lines.push(` confederation peer-as ${confederation.member_as.join(" ")}`);
        // One setting for every session: `unsupported()` refuses it on only some.
        if (neighbors.some((neighbor) => VrpBgp.settingsOf(device, neighbor).graceful_restart)) lines.push(" graceful-restart");
        const families: Record<Family, string[]> = { ipv4: [], ipv6: [] };
        const evpn: string[] = [];

        for (const prefix of bgp.originated_prefixes ?? []) {
            const { addr, len, family } = Address.split(prefix);
            families[family].push(
                family === "ipv4" ? `network ${addr} ${Address.netmask(len)}` : `network ${VrpPolicies.spell(addr)} ${len}`
            );
        }

        // `detail-suppressed` keeps back the routes inside the aggregate.
        for (const { prefix, summary_only: summaryOnly } of bgp.aggregates ?? []) {
            const { addr, len, family } = Address.split(prefix);
            const mask = family === "ipv4" ? `${addr} ${Address.netmask(len)}` : `${VrpPolicies.spell(addr)} ${len}`;
            families[family].push(`aggregate ${mask}${summaryOnly ? " detail-suppressed" : ""}`);
        }

        for (const neighbor of neighbors) {
            const settings = VrpBgp.settingsOf(device, neighbor);
            const peer = `peer ${VrpPolicies.spell(neighbor.address)}`;
            const family = Address.family(neighbor.address);

            lines.push(...VrpBgp.session(device, peer, settings).map((line) => ` ${line}`));
            // An IPv4 session exchanges IPv4 routes until told not to.
            if (VrpBgp.unicast(settings, neighbor)) families[family].push(...VrpBgp.exchange(peer, settings));
            else if (family === "ipv4") families.ipv4.push(`undo ${peer} enable`);
            if (Derive.carriesEvpn(settings)) evpn.push(`${peer} enable`);
        }

        const clients = neighbors.some((neighbor) => VrpBgp.settingsOf(device, neighbor).route_reflector_client);

        for (const family of ["ipv4", "ipv6"] as const) {
            if (!families[family].length) continue;

            if (bgp.cluster_id && clients) families[family].push(`reflector cluster-id ${bgp.cluster_id}`);
            lines.push(" #", ` ${VrpBgp.FAMILY_VIEW[family]}`, ...families[family].map((line) => `  ${line}`));
        }
        // The switch takes only the EVPN routes whose targets a segment imports, `policy vpn-target`, its default, which it prints.
        if (evpn.length) lines.push(" #", " l2vpn-family evpn", "  policy vpn-target", ...evpn.map((line) => `  ${line}`));

        return [...lines, "#"];
    }

    /** Whether a session exchanges the routes of its address's family: it does unless `address_families` leaves that family out. */
    private static unicast(settings: NeighborSettings, neighbor: Neighbor): boolean {
        return Derive.unicastFamilies(settings, neighbor.address).includes(Address.family(neighbor.address));
    }

    /** A session's own lines, in the order the switch prints them. */
    private static session(device: Device, peer: string, settings: NeighborSettings): string[] {
        const lines = [`${peer} as-number ${settings.remote_as}`];
        if (settings.description) lines.push(`${peer} description ${settings.description}`);
        // An internal session may cross any number of hops already.
        if (settings.multihop && settings.remote_as !== device.routing?.bgp?.asn) lines.push(`${peer} ebgp-max-hop ${VrpBgp.MAX_HOPS}`);
        if (settings.hold_time !== undefined && settings.keepalive !== undefined)
            lines.push(`${peer} timer keepalive ${settings.keepalive} hold ${settings.hold_time}`);

        const local = settings.local_address && Address.host(settings.local_address);
        const iface = local && VrpBgp.interfaceOf(device, local);
        if (local && iface) lines.push(`${peer} connect-interface ${iface} ${VrpPolicies.spell(local)}`);
        if (settings.passive) lines.push(`${peer} listen-only`);
        // Sent with TTL 255, and only TTL 255 taken: one hop (GTSM, RFC 5082).
        if (settings.ttl_security) lines.push(`${peer} valid-ttl-hops 1`);
        if (settings.password) lines.push(`${peer} password cipher ${Secrets.marker(settings.password)}`);
        return lines;
    }

    /** What a session exchanges in its family's view. The switch sends communities only to a session told to, so every session is. */
    private static exchange(peer: string, settings: NeighborSettings): string[] {
        const lines = [
            `${peer} enable`,
            `${peer} route-policy ${settings.import_policy ?? VrpPolicies.REJECT_ALL} import`,
            `${peer} route-policy ${settings.export_policy ?? VrpPolicies.REJECT_ALL} export`,
        ];

        const limit = Derive.prefixLimit(settings);
        if (limit && !limit.warn_only) {
            const idle =
                limit.restart_after === undefined ? "idle-forever" : `idle-timeout ${limit.restart_after / VrpBgp.SECONDS_PER_MINUTE}`;
            lines.push(`${peer} route-limit ${limit.limit} ${idle}`);
        }

        lines.push(`${peer} advertise-community`);
        if (settings.route_reflector_client) lines.push(`${peer} reflect-client`);
        // Sent whether or not the device has a default route.
        if (settings.send_default_route) lines.push(`${peer} default-route-advertise`);
        return lines;
    }

    private static neighborGaps(device: Device, where: string, neighbor: Neighbor): string[] {
        const settings = VrpBgp.settingsOf(device, neighbor);
        const found: string[] = [];
        const notBuilt = "not built yet";

        // A CE6855 refused `peer <address> local-role`.
        if (settings.role) found.push(`${where}.role, V200R005 has no BGP roles`);
        for (const key of ["bfd", "vrf"] as const)
            if (settings[key] !== undefined && settings[key] !== false) found.push(`${where}.${key}, ${notBuilt}`);
        if (settings.routing_table && settings.routing_table !== "main") found.push(`${where}.routing_table, ${notBuilt}`);

        const family = Address.family(neighbor.address);
        const families = (settings.address_families ?? [family]).filter((each) => each !== "l2vpn-evpn" || family === "ipv4");
        if (families.some((each) => each !== family && each !== "l2vpn-evpn"))
            found.push(`${where}.address_families, a session carries the family of the neighbor's address, and l2vpn-evpn, only here`);
        if (Derive.carriesEvpn(settings) && family === "ipv6")
            found.push(`${where}.address_families l2vpn-evpn, from an IPv6 address: not built yet`);
        if (Derive.carriesEvpn(settings) && settings.route_reflector_client)
            found.push(`${where}.route_reflector_client beside l2vpn-evpn, ${notBuilt}`);
        if (Derive.carriesEvpn(settings) && settings.max_prefixes !== undefined)
            found.push(`${where}.max_prefixes beside l2vpn-evpn, ${notBuilt}`);

        const limit = Derive.prefixLimit(settings);
        if (limit?.warn_only)
            found.push(`${where}.max_prefixes.warn_only, the platform's alert-only also refuses every route past the limit`);
        const minutes = limit?.restart_after === undefined ? undefined : limit.restart_after / VrpBgp.SECONDS_PER_MINUTE;
        const { min, max } = VrpBgp.IDLE_MINUTES;
        if (minutes !== undefined && (!Number.isInteger(minutes) || minutes < min || minutes > max))
            found.push(
                `${where}.max_prefixes.restart_after, the platform waits whole minutes, ${min} to ${max}: write a multiple of ${VrpBgp.SECONDS_PER_MINUTE}`
            );

        found.push(...VrpBgp.timerGaps(where, settings));

        const local = settings.local_address && Address.host(settings.local_address);
        if (local && !VrpBgp.interfaceOf(device, local))
            found.push(`${where}.local_address ${local}, no VLAN interface or loopback of the device holds it`);

        return found;
    }

    /** The switch sets the keepalive and the hold time together, the hold time at least three keepalives. */
    private static timerGaps(where: string, settings: NeighborSettings): string[] {
        const { hold_time: hold, keepalive } = settings;
        if (hold === undefined && keepalive === undefined) return [];
        if (hold === undefined || keepalive === undefined)
            return [
                hold === undefined
                    ? `${where}.keepalive, without hold_time: the platform sets both together, so write both`
                    : `${where}.hold_time, without keepalive: the platform sets both together, so write both`,
            ];

        const holdTaken = hold === 0 || (hold >= VrpBgp.HOLD.min && hold <= VrpBgp.HOLD.max);
        const keepaliveTaken = keepalive >= 0 && keepalive <= VrpBgp.KEEPALIVE_MAX;
        const proportion = hold >= keepalive * VrpBgp.KEEPALIVES_PER_HOLD;
        if (holdTaken && keepaliveTaken && proportion) return [];

        return [
            `${where}.hold_time ${hold} with keepalive ${keepalive}: the platform takes a hold time of 0 or ${VrpBgp.HOLD.min} to ${VrpBgp.HOLD.max}, a keepalive up to ${VrpBgp.KEEPALIVE_MAX}, and a hold time of at least three keepalives`,
        ];
    }

    /** What a rule asks that a route-policy on V200R005 can't do. */
    private static ruleGaps(device: Device, where: string, rule: RouteRule): string[] {
        const found: string[] = [];
        const match = rule.if ?? {};
        const set = rule.set ?? {};
        const noLarge = "V200R005 has no large communities";

        if (rule.then === undefined)
            found.push(
                `${where}, a rule without then: V200R005 has no goto next-node, so a route ends at the first node it matches. Give the rule then: accept or reject`
            );
        if (rule.description && rule.description.length > VrpPolicies.DESCRIPTION)
            found.push(`${where}.description, over ${VrpPolicies.DESCRIPTION} characters`);

        const { lists, conflict } = VrpPolicies.familyLists(device, match);
        if (conflict) found.push(`${where}.if.${conflict}: a node matches one prefix list for each family, so write one of them`);

        if (match.as_path_length) found.push(`${where}.if.as_path_length, V200R005 has no if-match as-path length`);
        const fields = VrpPolicies.AS_FIELDS.filter((field) => match[field] !== undefined);
        if (fields.length > 1)
            found.push(
                `${where}.if.${fields[1]}, with ${fields[0]}: a node matches one AS path filter, so match each in a rule of its own`
            );
        if (match.rpki) found.push(`${where}.if.rpki, routing.rpki is not on this platform`);
        if (match.large_community) found.push(`${where}.if.large_community, ${noLarge}`);
        if ([match.standard_community ?? []].flat().some((value) => value.includes("*")))
            found.push(`${where}.if.standard_community, with *: exact communities only, not built yet`);

        for (const key of ["large_communities", "add_large_communities", "remove_large_communities"] as const)
            if (set[key]) found.push(`${where}.set.${key}, ${noLarge}`);
        if (!set.standard_communities && set.remove_standard_communities?.some((value) => value.includes("*")))
            found.push(`${where}.set.remove_standard_communities, with *: exact communities only, not built yet`);
        const communities = new Set([...(set.standard_communities ?? []), ...(set.add_standard_communities ?? [])]);
        if (communities.size > VrpPolicies.COMMUNITIES)
            found.push(`${where}.set, over ${VrpPolicies.COMMUNITIES} communities: the platform sets ${VrpPolicies.COMMUNITIES} at most`);
        if (set.preferred_source) found.push(`${where}.set.preferred_source, BGP has no source address here`);
        if (set.blackhole) found.push(`${where}.set.blackhole, V200R005 has no blackhole next hop`);

        // A next hop fits routes of its own family only, so the rule must keep to that family.
        const nextHop = set.next_hop ? Address.family(set.next_hop) : undefined;
        const other = nextHop === "ipv4" ? "ipv6" : "ipv4";
        if (nextHop && rule.then !== "reject" && lists[other] !== VrpPolicies.NO_ROUTE[other])
            found.push(`${where}.set.next_hop, the rule also matches ${other} routes: match family ${nextHop} too`);

        return found;
    }
}
