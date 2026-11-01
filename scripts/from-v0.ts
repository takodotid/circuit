// A device written for Circuit 0.x, as the v1 model has it: the same values, in v1's groups and field names, every rule as `{ if, then }`.
// `bun scripts/from-v0.ts <folder>` converts each `<name>.v0.json` there into `<name>.v1.json`, and each certificate into a `.pem` beside it.

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type Json = any;

/** Drops each key whose value is undefined, and the map itself when nothing is left. */
function clean(map: Json): Json {
    if (!map || typeof map !== "object" || Array.isArray(map)) return map;
    const kept = Object.fromEntries(Object.entries(map).filter(([, v]) => v !== undefined));
    return Object.keys(kept).length ? kept : undefined;
}

/** A map with each value changed by `change`. */
const each = (map: Json, change: (v: Json, k: string) => Json) =>
    map && Object.fromEntries(Object.entries<Json>(map).map(([k, v]) => [k, change(v, k)]));

/** A filter or NAT rule's match. */
const filterMatch = (m: Json) =>
    m &&
    clean({
        ...m,
        src_set: undefined,
        dst_set: undefined,
        state: undefined,
        src_address_set: m.src_set,
        dst_address_set: m.dst_set,
        connection_state: m.state,
    });

const filterRule = ({ match, action, offload, ...rest }: Json) =>
    clean({ ...rest, if: filterMatch(match), then: action, fast_path: offload });

const natRule = ({ match, action, to, ...rest }: Json) => clean({ ...rest, if: filterMatch(match), then: action, to_address: to });

const aclRule = ({ match, action, ...rest }: Json) => clean({ ...rest, if: match, then: action });

function policyRule(rule: Json): Json {
    // A v1 call rule holds nothing but `call`: 0.x's description on one has no place.
    if (rule.call !== undefined) return { call: rule.call };
    const { match, set, action, ...rest } = rule;
    const m =
        match &&
        clean({
            ...match,
            through_as: undefined,
            community: undefined,
            as_path_contains: match.through_as,
            standard_community: match.community,
        });
    const s =
        set &&
        clean({
            ...set,
            communities: undefined,
            add_communities: undefined,
            remove_communities: undefined,
            standard_communities: set.communities,
            add_standard_communities: set.add_communities,
            remove_standard_communities: set.remove_communities,
        });
    return clean({ ...rest, if: m, set: s, then: action });
}

const staticRoute = ({ via, table, ...rest }: Json) => clean({ ...rest, next_hop: via, routing_table: table });

const neighbor = ({ import: imp, export: exp, families, table, group, ...rest }: Json) =>
    clean({ ...rest, import_policy: imp, export_policy: exp, address_families: families, routing_table: table, neighbor_group: group });

const addresses = (list: Json) => list?.map((a: Json) => (typeof a === "string" ? a : clean({ address: a.address, peer_address: a.peer })));

/** A port or an interface, in v1's names. */
function routed(x: Json): Json {
    const { lag, acl, local, remote, members, addresses: list, ...rest } = x;
    // A port with no settings stays: it is on, where a port left out is shut down.
    return (
        clean({
            ...rest,
            addresses: addresses(list),
            in_lag: lag,
            ingress_acl: acl,
            local_address: local,
            remote_address: remote,
            member_interfaces: members,
        }) ?? {}
    );
}

export function fromV0(d: Json, site: string, certificates: (name: string, pem: string) => string): Json {
    const {
        name,
        platform,
        model,
        connection,
        system = {},
        users,
        management = {},
        certificates: certs,
        vlans,
        ports,
        interfaces,
        vrfs,
    } = d;
    const { routing = {}, policies, prefix_sets, firewall, acls, dhcp, dhcp_relay, flow_export, lldp, stp, hardware_offload, vdoms } = d;
    const { dns, ntp, logging, alarms, transceiver_monitoring, ip, ...systemRest } = system;
    const { snmp, native, ...managementRest } = management;
    const { console: con, ...conn } = connection;

    const byType: Json = {};
    for (const [key, { type, ...rest }] of Object.entries<Json>(interfaces ?? {}))
        (byType[type === "vlan" ? "vlan_interface" : type] ??= {})[key] = routed(rest);

    const { static: statics, rules, bgp, ospf, ...routingRest } = routing;

    return clean({
        name,
        site,
        platform,
        model,
        connection: clean({ ...conn, console: con && clean({ ...con, passwordOnly: undefined, password_only: con.passwordOnly }) }),
        system: clean({
            ...systemRest,
            ip_stack: ip,
            dns: dns?.servers && { servers: dns.servers },
            ntp: ntp?.servers && { servers: ntp.servers },
            logging: logging?.local && { local: logging.local },
            alarms,
            hardware_offload,
            users,
            certificates: each(certs, (c, k) => clean({ certificate_file: certificates(k, c.certificate), private_key: c.private_key })),
            vdoms: each(vdoms, ({ static: s, ...v }) => clean({ ...v, static_routes: s?.map(staticRoute) })),
        }),
        management: clean({ ...managementRest, native_protocol: native }),
        monitoring: clean({ snmp, syslog: logging?.remote, flow_export, transceivers: transceiver_monitoring }),
        interfaces: clean({ ethernet: each(ports, routed), ...byType }),
        switching: clean({ vlans, stp, lldp, acls: each(acls, (rules) => rules.map(aclRule)) }),
        services: clean({ dhcp_server: dhcp, dhcp_relay, dns_server: dns?.serve, ntp_server: ntp?.serve }),
        routing: clean({
            ...routingRest,
            vrfs,
            static_routes: statics?.map(staticRoute),
            policy_routing: rules?.map(({ table, ...r }: Json) => clean({ ...r, routing_table: table })),
            ospf: ospf && clean({ ...ospf, families: undefined, address_families: ospf.families }),
            bgp:
                bgp &&
                clean({
                    asn: bgp.asn,
                    originated_prefixes: bgp.networks,
                    neighbor_groups: each(bgp.groups, neighbor),
                    neighbors: each(bgp.neighbors, neighbor),
                }),
            policies: each(policies, (rules) => rules.map(policyRule)),
            prefix_sets,
        }),
        firewall:
            firewall &&
            clean({
                address_sets: firewall.address_sets,
                filter: each(firewall.filter, ({ default: def, rules: r }) => clean({ default_action: def, rules: r?.map(filterRule) })),
                nat:
                    firewall.nat &&
                    clean({ source: firewall.nat.source?.map(natRule), destination: firewall.nat.destination?.map(natRule) }),
                conntrack_helpers: firewall.helpers,
                untracked: firewall.untracked,
            }),
    });
}

if (import.meta.main) {
    const folder = process.argv[2]!;
    for (const file of readdirSync(folder).filter((f) => f.endsWith(".v0.json"))) {
        const id = file.replace(/\.v0\.json$/, "");
        const device = JSON.parse(readFileSync(join(folder, file), "utf8"));
        const v1 = fromV0(device, id.split("--")[0]!, (name, pem) => {
            const path = `${id}.${name}.pem`;
            writeFileSync(join(folder, path), pem);
            return path;
        });
        writeFileSync(join(folder, `${id}.v1.json`), JSON.stringify(v1, null, 2) + "\n");
    }
}
