// Every key Circuit takes, at run time, so `circuit validate` stops on one it doesn't know. Each shape is typed `ShapeOf<the type>`, which needs every key of the type and allows no other. So a key added to, renamed in, or removed from a type fails `tsc` until its shape matches.

import type { CommunityScheme, CommunitiesExport, CommunitiesImport } from "./communities";
import type { AnyDevice } from "./device";
import type { FilterRule, NatRule, TcpMssRule } from "./firewall";
import type { Checks, Integrations, NetworkSecrets, NetworkSettings, Prefixes, Site } from "./network";
import type { MarkingRule } from "./qos";
import type { CallRule, IsisAuthentication, PolicyRule, RouteMatch, RouteRule, RouteSet, RoutingRule } from "./routing";
import type { AclRule } from "./switching";

/**
 * Where keys may be. `0` holds none that Circuit checks, such as a number, a name, or a list of names. A map lists its keys, each with its own shape. `{ "*": shape }` takes any key, such as a VLAN's name. `[shape]` is a list of that item.
 */
export type Shape = 0 | readonly [Shape] | { readonly [key: string]: Shape };

type Prim = string | number | boolean | bigint | symbol | null | undefined;
type AllKeys<U> = U extends unknown ? keyof U : never;
type ValueAt<U, K> = U extends unknown ? (K extends keyof U ? U[K] : never) : never;
type Item<T> = Extract<T, readonly unknown[]> extends readonly (infer E)[] ? E : never;

/** A map with any key (an index signature, such as VLANs by name), or one with keys written out. A key typed `never` is no key. */
type ObjectShape<O> =
    {} extends Required<O>
        ? { readonly "*": ShapeOf<O[keyof O]> }
        : { readonly [K in AllKeys<O> as [NonNullable<ValueAt<O, K>>] extends [never] ? never : K]-?: ShapeOf<ValueAt<O, K>> };

/** The shape of type `T`: what each shape here must be, exactly. A list of plain values is `0`, as a plain value. */
export type ShapeOf<T> = [Exclude<T, Prim>] extends [never]
    ? 0
    : [Exclude<T, Prim | readonly unknown[]>] extends [never]
      ? ShapeOf<Item<T>> extends 0
          ? 0
          : readonly [ShapeOf<Item<T>>]
      : ObjectShape<Exclude<T, Prim | readonly unknown[]>>;

const SECRET = { secret: 0, secret_file: 0 } as const;
const RANGE = { min: 0, max: 0 } as const;
const RADIUS_SERVER = { address: 0, secret_key: SECRET, source_address: 0, vrf: 0, auth_port: 0, acct_port: 0 } as const;
const ISIS_AUTHENTICATION = { algorithm: 0, key_id: 0, key: SECRET } as const satisfies ShapeOf<IsisAuthentication>;
const LIMIT = { cir: 0, bc: 0 } as const;
const RATE_LIMIT = { input: LIMIT, output: LIMIT } as const;

const FILTER_MATCH = {
    family: 0,
    protocol: 0,
    src: 0,
    dst: 0,
    src_address_set: 0,
    dst_address_set: 0,
    src_port: RANGE,
    dst_port: RANGE,
    in_interface: 0,
    out_interface: 0,
    in_interface_set: 0,
    out_interface_set: 0,
    connection_state: 0,
    connection_nat_state: 0,
    tcp_flags: { set: 0, unset: 0 },
} as const;

export const FILTER_RULE = { description: 0, if: FILTER_MATCH, then: 0, fast_path: 0 } as const satisfies ShapeOf<
    FilterRule<string, string, string>
>;
export const NAT_RULE = {
    description: 0,
    if: FILTER_MATCH,
    then: 0,
    to_address: 0,
    to_port: 0,
    to_pool: 0,
    port_allocation: 0,
    port_set_size: 0,
    port_sets_per_subscriber: 0,
    port_set_timeout: 0,
} as const satisfies ShapeOf<NatRule<string, string, string>>;
const { protocol: _protocol, tcp_flags: _tcpFlags, connection_state: _state, ...TCP_MSS_MATCH } = FILTER_MATCH;
const TCP_MSS_RULE = { description: 0, if: TCP_MSS_MATCH, mss: 0 } as const satisfies ShapeOf<TcpMssRule<string, string, string>>;
const { tcp_flags: _flags, connection_state: _connection, connection_nat_state: _nat, ...MARKING_MATCH } = FILTER_MATCH;
const MARKING_RULE = {
    description: 0,
    if: { ...MARKING_MATCH, dscp: 0 },
    then: { dscp: 0, pcp: 0, class: 0 },
} as const satisfies ShapeOf<MarkingRule<string, string, string>>;
export const ACL_RULE = {
    description: 0,
    if: { family: 0, protocol: 0, src: 0, dst: 0, src_port: RANGE, dst_port: RANGE, vlan: 0 },
    then: 0,
    rate: LIMIT,
} as const satisfies ShapeOf<AclRule<string>>;
export const ROUTING_RULE = {
    description: 0,
    match: { src: 0, dst: 0, in_interface: 0 },
    routing_table: 0,
    fallback: 0,
} as const satisfies ShapeOf<RoutingRule<string, string>>;

export const ROUTE_MATCH = {
    family: 0,
    prefix: 0,
    prefix_set: 0,
    prefix_length: RANGE,
    as_path_length: RANGE,
    as_path_contains: RANGE,
    first_as: RANGE,
    origin_as: RANGE,
    rpki: 0,
    standard_community: 0,
    large_community: 0,
} as const satisfies ShapeOf<RouteMatch<string>>;
export const ROUTE_SET = {
    local_pref: 0,
    med: 0,
    prepend: 0,
    standard_communities: 0,
    add_standard_communities: 0,
    remove_standard_communities: 0,
    large_communities: 0,
    add_large_communities: 0,
    remove_large_communities: 0,
    next_hop: 0,
    preferred_source: 0,
    blackhole: 0,
} as const satisfies ShapeOf<RouteSet>;
/** A route policy rule of each kind: on routes, a call, a communities import, a communities export. */
export const ROUTE_RULE = { description: 0, if: ROUTE_MATCH, set: ROUTE_SET, then: 0 } as const satisfies ShapeOf<RouteRule<string>>;
export const CALL_RULE = { call: 0 } as const satisfies ShapeOf<CallRule<string>>;
export const COMMUNITIES_IMPORT = { communities: 0, accept_requests: 0, add_tags: 0 } as const satisfies ShapeOf<CommunitiesImport<string>>;
export const COMMUNITIES_EXPORT = { communities: 0, keep_ours: 0, send_tags: 0 } as const satisfies ShapeOf<CommunitiesExport>;
export const POLICY_RULE = { ...ROUTE_RULE, ...CALL_RULE, ...COMMUNITIES_IMPORT, ...COMMUNITIES_EXPORT } as const satisfies ShapeOf<
    PolicyRule<string, string>
>;

/** What `then` may be in each kind of rule. */
export const ACTIONS = {
    filter: ["accept", "drop", "reject"],
    nat: ["masquerade", "snat", "dnat", "nat64"],
    acl: ["accept", "drop"],
    policy: ["accept", "reject"],
} as const;

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
// Each list is exactly what its type's `then` takes: `tsc` fails here otherwise.
true satisfies Same<(typeof ACTIONS.filter)[number], FilterRule<string, string, string>["then"]>;
true satisfies Same<(typeof ACTIONS.nat)[number], NatRule<string, string, string>["then"]>;
true satisfies Same<(typeof ACTIONS.acl)[number], AclRule<string>["then"]>;
true satisfies Same<(typeof ACTIONS.policy)[number], NonNullable<RouteRule<string>["then"]>>;

const SERVICE = { allow: 0, port: 0, vrf: 0 } as const;
const STATIC_ROUTE = {
    prefix: 0,
    next_hop: 0,
    interface: 0,
    blackhole: 0,
    bfd: 0,
    distance: 0,
    vrf: 0,
    routing_table: 0,
    description: 0,
} as const;
const ROUTED = {
    addresses: [{ address: 0, peer_address: 0 }],
    urpf: { ipv4: 0, ipv6: 0 },
    ipv6_ra: {
        interval: 0,
        lifetime: 0,
        prefixes: [{ prefix: 0, valid_lifetime: 0, preferred_lifetime: 0, disable_autoconfiguration: 0 }],
        dns_servers: 0,
        dns_search_list: 0,
        managed: 0,
        other_config: 0,
    },
    hardware_offload: 0,
    vrrp: [{ id: 0, address: 0, priority: 0, preempt: 0, interval: 0 }],
    vrf: 0,
    exchange: { name: 0, speed: 0, peeringdb_ixlan: 0 },
} as const;
const THRESHOLD = { pps: 0, percent: 0 } as const;
const SWITCHED = {
    access_vlan: 0,
    trunk_vlans: 0,
    native_vlan: 0,
    stp: { edge: 0, cost: 0, priority: 0, bpdu_guard: 0, guard: 0 },
    storm_control: { broadcast: THRESHOLD, multicast: THRESHOLD, unknown_unicast: THRESHOLD },
    mac_limit: 0,
    ethertypes: 0,
    bound_to: [{ mac: 0, addresses: 0 }],
    dhcp_trusted: 0,
    ra_trusted: 0,
    qinq_vlan: 0,
    tpid: 0,
    vlan_translation: [{ from: 0, to: 0 }],
} as const;
const BASE = { ...ROUTED, description: 0, mtu: 0, shaping: { algorithm: 0, mbps: 0 } } as const;
// No packet arrives on a loopback, and a bridge doesn't route what crosses it.
const { urpf: _urpf, ...UNCHECKED } = BASE;
const NEIGHBOR_SETTINGS = {
    remote_as: 0,
    description: 0,
    local_address: 0,
    import_policy: 0,
    export_policy: 0,
    role: 0,
    multihop: 0,
    ttl_security: 0,
    route_reflector_client: 0,
    send_default_route: 0,
    password: SECRET,
    max_prefixes: { limit: 0, restart_after: 0, warn_only: 0 },
    hold_time: 0,
    keepalive: 0,
    address_families: 0,
    passive: 0,
    bfd: 0,
    graceful_restart: 0,
    routing_table: 0,
    vrf: 0,
    communities: { groups: 0, blackhole: 0 },
} as const;
const CHAIN = { default_action: 0, rules: [FILTER_RULE] } as const;

/** Every key a device may have, its parts merged in. */
export const DEVICE = {
    name: 0,
    site: 0,
    role: 0,
    platform: 0,
    model: 0,
    connection: {
        host: 0,
        user: 0,
        port: 0,
        console: { jump: { host: 0, user: 0, password: SECRET, port: 0, cloudflared: 0 }, port: 0, baud: 0, password_only: 0 },
    },
    system: {
        timezone: 0,
        banner: 0,
        release_channel: 0,
        ip_stack: { icmp_redirects: 0, syn_cookies: 0 },
        alarms: { "*": { severity: 0 } },
        dns: { servers: 0, vrf: 0 },
        ntp: { servers: 0, vrf: 0 },
        logging: { local: { level: 0, files: 0, lines_per_file: 0 } },
        hardware_offload: 0,
        users: { "*": { role: 0, password: SECRET, description: 0, ssh_keys: 0 } },
        aaa: {
            tacacs: [{ address: 0, secret_key: SECRET, source_address: 0 }],
            radius: [RADIUS_SERVER],
            remote_role: 0,
            accounting_events: 0,
        },
        certificates: { "*": { certificate_file: 0, private_key: SECRET } },
        // A VDOM's routes have no VRF.
        vdoms: {
            management: {
                name: 0,
                interfaces: 0,
                static_routes: [
                    { prefix: 0, next_hop: 0, interface: 0, blackhole: 0, bfd: 0, distance: 0, routing_table: 0, description: 0 },
                ],
            },
        },
    },
    management: {
        allow: 0,
        interfaces: 0,
        ssh: { ...SERVICE, weak_crypto: 0, auth_timeout: 0, auth_retries: 0 },
        telnet: SERVICE,
        http: SERVICE,
        https: { ...SERVICE, certificate: 0 },
        api: SERVICE,
        api_tls: { ...SERVICE, certificate: 0 },
        ftp: SERVICE,
        native_protocol: { ...SERVICE, interfaces: 0 },
        console: { password: SECRET },
        privilege_password: SECRET,
    },
    monitoring: {
        snmp: {
            ...SERVICE,
            community: SECRET,
            users: { "*": { auth: 0, auth_password: SECRET, privacy: 0, privacy_password: SECRET } },
            contact: 0,
            location: 0,
            traps: [{ address: 0, port: 0, community: SECRET, user: 0 }],
        },
        syslog: [{ address: 0, vrf: 0, port: 0, level: 0, transport_security: { ca_certificate: 0 } }],
        flow_export: {
            protocol: 0,
            collectors: [{ address: 0, port: 0 }],
            sampling: 0,
            interfaces: 0,
            active_timeout: 0,
            idle_timeout: 0,
        },
        transceivers: 0,
        probes: { "*": { target: 0, interval: 0, source_address: 0, vrf: 0 } },
    },
    interfaces: {
        ethernet: {
            "*": {
                ...ROUTED,
                ...SWITCHED,
                description: 0,
                mtu: 0,
                speed: 0,
                lldp: 0,
                ingress_acl: 0,
                in_lag: 0,
                link: { device: 0, port: 0, through: 0 },
                dhcp_client: { default_routes: [{ routing_table: 0, distance: 0 }] },
                shaping: { algorithm: 0, mbps: 0 },
                rate_limit: RATE_LIMIT,
                scheduler: 0,
            },
        },
        lag: {
            "*": {
                ...BASE,
                ...SWITCHED,
                mode: 0,
                id: 0,
                link_check: { arp_targets: 0, interval_ms: 0 },
                mac: 0,
                rate_limit: RATE_LIMIT,
                scheduler: 0,
            },
        },
        vlan_interface: { "*": { ...BASE, vlan: 0, inner_vlan_id: 0, mac: 0, proxy_arp: 0, rate_limit: RATE_LIMIT, scheduler: 0 } },
        bridge: { "*": { ...UNCHECKED, member_interfaces: 0 } },
        loopback: { "*": UNCHECKED },
        gre: { "*": { ...BASE, local_address: 0, remote_address: 0 } },
        vxlan: { "*": { ...BASE, vni: 0, local_address: 0, remote_address: 0, port: 0, mac: 0 } },
        ipsec: {
            "*": {
                addresses: ROUTED.addresses,
                description: 0,
                local_address: 0,
                remote_address: 0,
                pre_shared_key: SECRET,
                certificate: 0,
                ca_certificate: 0,
                remote_identity: { distinguished_name: 0, fqdn: 0, email: 0, address: 0 },
                ike: { encryption: 0, integrity: 0, prf: 0, dh_group: 0, lifetime: 0 },
                esp: { encryption: 0, integrity: 0, pfs_group: 0, lifetime: 0 },
                liveness_check: { interval: 0, retries: 0 },
                nat_traversal: 0,
                nat_keepalive: 0,
            },
        },
        wireguard: {
            "*": {
                ...BASE,
                listen_port: 0,
                routing_table: 0,
                endpoint: 0,
                private_key: SECRET,
                peers: [{ name: 0, public_key: 0, allowed_addresses: 0, endpoint: 0, keepalive: 0, client_allowed_addresses: 0 }],
            },
        },
        eoip: { "*": { ...BASE, local_address: 0, remote_address: 0, tunnel_id: 0, in_lag: 0 } },
        pseudowire: { "*": { description: 0, peer: 0, pw_id: 0, access_vlan: 0, mtu: 0, control_word: 0 } },
        pppoe_client: {
            "*": {
                interface: 0,
                description: 0,
                user: 0,
                password: SECRET,
                service_name: 0,
                mtu: 0,
                prefix_delegation: { prefix_length: 0, interfaces: { "*": 0 } },
                slaac: 0,
                vrf: 0,
            },
        },
    },
    switching: {
        vlans: { "*": { id: 0, description: 0, untrusted: 0, private_vlan: { primary: 0, type: 0 } } },
        stp: { mode: 0, priority: 0 },
        dhcp_snooping: 0,
        arp_inspection: 0,
        ra_guard: 0,
        lldp: { interfaces: 0 },
        acls: { "*": [ACL_RULE] },
    },
    services: {
        dhcp_server: {
            "*": {
                interface: 0,
                network: 0,
                gateway: 0,
                dns: 0,
                pool: 0,
                lease_time: 0,
                reservations: [{ address: 0, mac: 0, description: 0 }],
                radius: [RADIUS_SERVER],
                acct_interim_interval: 0,
            },
        },
        dhcpv6_server: {
            "*": {
                interface: 0,
                pool: 0,
                prefix_delegation: { pool: 0, prefix_length: 0 },
                dns: 0,
                lease_time: 0,
                radius: [RADIUS_SERVER],
                acct_interim_interval: 0,
            },
        },
        dhcp_relay: { "*": { interface: 0, servers: 0 } },
        pppoe_server: {
            "*": {
                interfaces: 0,
                service_name: 0,
                local_address: 0,
                pool: 0,
                dns: 0,
                mtu: 0,
                radius: [RADIUS_SERVER],
                acct_interim_interval: 0,
                dynamic_authorization: 0,
                prefix_delegation: { pool: 0, prefix_length: 0 },
                slaac: { pool: 0 },
                interface_set: 0,
            },
        },
        dns_server: 0,
        dns64: { prefix: 0 },
        ntp_server: 0,
        upnp: { internal: 0, external: 0, external_address: 0 },
    },
    routing: {
        router_id: 0,
        tables: { "*": { description: 0 } },
        vrfs: {
            "*": { description: 0, route_distinguisher: 0, route_targets: { import: 0, export: 0 }, import_policy: 0, export_policy: 0 },
        },
        vrf_imports: [{ from: 0, to: 0, policy: 0 }],
        policy_routing: [ROUTING_RULE],
        static_routes: [STATIC_ROUTE],
        bgp: {
            asn: 0,
            confederation: { identifier: 0, member_as: 0 },
            cluster_id: 0,
            originated_prefixes: 0,
            aggregates: [{ prefix: 0, summary_only: 0 }],
            neighbor_groups: { "*": NEIGHBOR_SETTINGS },
            neighbors: { "*": { ...NEIGHBOR_SETTINGS, address: 0, neighbor_group: 0 } },
        },
        ospf: {
            address_families: 0,
            vrf: 0,
            areas: {
                "*": {
                    type: 0,
                    no_summaries: 0,
                    stub_default_cost: 0,
                    ranges: [{ prefix: 0, advertise: 0, cost: 0 }],
                    virtual_links: [{ transit_area_id: 0, router_id: 0 }],
                    interfaces: {
                        "*": {
                            cost: 0,
                            passive: 0,
                            network: 0,
                            neighbors: 0,
                            priority: 0,
                            hello_interval: 0,
                            dead_interval: 0,
                            authentication: { algorithm: 0, key_id: 0, key: SECRET },
                            bfd: 0,
                        },
                    },
                },
            },
            redistribute: 0,
        },
        isis: {
            net: 0,
            level_capability: 0,
            address_families: 0,
            multi_topology: 0,
            authentication: ISIS_AUTHENTICATION,
            levels: { 1: { authentication: ISIS_AUTHENTICATION }, 2: { authentication: ISIS_AUTHENTICATION } },
            interfaces: { "*": { metric: 0, passive: 0, network: 0, bfd: 0 } },
            overload_bit: 0,
            level2_to_level1: { import_policy: 0 },
        },
        mpls: {
            ldp: {
                lsr_id: 0,
                interfaces: 0,
                targets: 0,
                import_policy: 0,
                export_policy: 0,
                neighbors: { "*": { import_policy: 0, export_policy: 0 } },
            },
        },
        bfd: { interval: 0, multiplier: 0 },
        rpki: [{ address: 0, port: 0, description: 0 }],
        policies: { "*": [POLICY_RULE] },
        prefix_sets: { "*": { prefixes: { "*": 0 }, source: { registry: 0, query: 0, family: 0 } } },
    },
    firewall: {
        address_sets: { "*": 0 },
        interface_sets: { "*": 0 },
        filter: { input: CHAIN, forward: CHAIN, output: CHAIN },
        nat: { source: [NAT_RULE], destination: [NAT_RULE] },
        tcp_mss: [TCP_MSS_RULE],
        conntrack_helpers: 0,
        untracked: 0,
    },
    qos: {
        marking: [MARKING_RULE],
        classes: { "*": { dscp: 0 } },
        default_class: 0,
        schedulers: {
            "*": {
                rate: 0,
                queues: [
                    {
                        class: 0,
                        priority: 0,
                        max: 0,
                        share: 0,
                        depth_packets: 0,
                        red: { min_threshold_percent: 0, max_threshold_percent: 0 },
                    },
                ],
            },
        },
    },
} as const satisfies ShapeOf<AnyDevice>;

const OPTION = { code: 0, description: 0 } as const;
/** Every option of a community scheme. */
const COMMUNITIES = {
    asn: 0,
    groups: { "*": { value: 0, description: 0 } },
    learned_from_group: OPTION,
    learned_at_site: OPTION,
    learned_from_as: OPTION,
    do_not_announce_to_as: OPTION,
    do_not_announce_to_group: OPTION,
    prepend: { once: OPTION, twice: OPTION, three_times: OPTION },
    blackhole: OPTION,
    custom_descriptions: { "*": 0 },
} as const satisfies ShapeOf<CommunityScheme>;

/** Circuit's built-in checks, each with its settings. Any other name in `checks` is one of the project's own. */
export const CHECKS = {
    untrusted_vlans: { filtering_devices: 0, mixed_links: 0 },
    exports_end_in_reject: 0,
    imports_end_in_accept_or_reject: 0,
    native_vlans_are_dead_ends: 0,
    tunnels_outside_offered: 0,
    same_vlan_ids: 0,
} as const satisfies ShapeOf<Checks<string>>;

/** Every key `circuit()` takes. `checks` is looked at apart: a project's own check has a name of its own. */
export const NETWORK = {
    asn: 0,
    prefixes: { "*": { "*": 0 } } satisfies ShapeOf<Prefixes>,
    communities: COMMUNITIES,
    sites: { "*": { description: 0, number: 0 } satisfies ShapeOf<Site> },
    checks: 0,
    integrations: {
        peeringdb: { api_key: SECRET },
        librenms: { url: 0, api_token: SECRET },
        netbox: { url: 0, api_token: SECRET },
        prometheus: { targets: 0, auths: 0 },
    } satisfies ShapeOf<Integrations>,
    secrets: { file: 0 } satisfies ShapeOf<NetworkSecrets>,
} as const satisfies { readonly [K in keyof NetworkSettings<{}, number>]-?: Shape };

// `satisfies` misses an extra key that comes from a spread or another constant. `Same` catches it, because every key of a shape is required: a shape with one more key, at any depth, is not the type's.
true satisfies Same<typeof DEVICE, ShapeOf<AnyDevice>>;
true satisfies Same<typeof FILTER_RULE, ShapeOf<FilterRule<string, string, string>>>;
true satisfies Same<typeof NAT_RULE, ShapeOf<NatRule<string, string, string>>>;
true satisfies Same<typeof ACL_RULE, ShapeOf<AclRule<string>>>;
true satisfies Same<typeof MARKING_RULE, ShapeOf<MarkingRule<string, string, string>>>;
true satisfies Same<typeof ROUTING_RULE, ShapeOf<RoutingRule<string, string>>>;
true satisfies Same<typeof ROUTE_RULE, ShapeOf<RouteRule<string>>>;
true satisfies Same<typeof CALL_RULE, ShapeOf<CallRule<string>>>;
true satisfies Same<typeof COMMUNITIES_IMPORT, ShapeOf<CommunitiesImport<string>>>;
true satisfies Same<typeof COMMUNITIES_EXPORT, ShapeOf<CommunitiesExport>>;
true satisfies Same<typeof COMMUNITIES, ShapeOf<CommunityScheme>>;
true satisfies Same<typeof CHECKS, ShapeOf<Checks<string>>>;
true satisfies Same<typeof NETWORK.integrations, ShapeOf<Integrations>>;
true satisfies Same<typeof NETWORK.sites, ShapeOf<Readonly<Record<string, Site>>>>;
true satisfies Same<typeof NETWORK.prefixes, ShapeOf<Prefixes>>;
true satisfies Same<keyof typeof NETWORK, keyof NetworkSettings<{}, number>>;

/** A key Circuit doesn't take: where it is, dot by dot (`firewall.filter.input.rules[3].if`), the key, and the keys taken there. */
export type UnknownKey = { path: string; key: string; known: string[] };

/**
 * Every key in `value` that `shape` doesn't take. A list met where the shape is a map is a list of such maps (a port range, or several). A plain value met where the shape is a map is one the type allows beside it, such as an address written alone.
 */
export function unknownKeys(value: unknown, shape: Shape, path = ""): UnknownKey[] {
    if (shape === 0 || !value || typeof value !== "object") return [];
    if (Array.isArray(value)) {
        const item: Shape = Array.isArray(shape) ? (shape as readonly [Shape])[0] : shape;
        return value.flatMap((v, i) => unknownKeys(v, item, `${path}[${i}]`));
    }
    if (Array.isArray(shape)) return [];
    const map = shape as { readonly [key: string]: Shape };
    const at = (key: string) => (path ? `${path}.${key}` : key);
    if (Object.hasOwn(map, "*")) return Object.entries(value).flatMap(([k, v]) => unknownKeys(v, map["*"]!, at(k)));
    return Object.entries(value).flatMap(([k, v]) =>
        Object.hasOwn(map, k) ? unknownKeys(v, map[k]!, at(k)) : [{ path, key: k, known: Object.keys(map) }]
    );
}

/** Every path in `value` where `shape` takes a secret but plain text is written, such as `system.users.operator.password`. */
export function plainSecrets(value: unknown, shape: Shape, path = ""): string[] {
    if (shape === SECRET) return value !== undefined && (typeof value !== "object" || value === null) ? [path] : [];
    if (shape === 0 || !value || typeof value !== "object") return [];
    if (Array.isArray(value)) {
        const item: Shape = Array.isArray(shape) ? (shape as readonly [Shape])[0] : shape;
        return value.flatMap((v, i) => plainSecrets(v, item, `${path}[${i}]`));
    }
    if (Array.isArray(shape)) return [];
    const map = shape as { readonly [key: string]: Shape };
    const at = (key: string) => (path ? `${path}.${key}` : key);
    if (Object.hasOwn(map, "*")) return Object.entries(value).flatMap(([k, v]) => plainSecrets(v, map["*"]!, at(k)));
    return Object.entries(value).flatMap(([k, v]) => (Object.hasOwn(map, k) ? plainSecrets(v, map[k]!, at(k)) : []));
}

/** The closest of `names`, for "Did you mean": at most two letters off, or a quarter of a long name. */
export function closest(name: string, names: Iterable<string>): string | undefined {
    const distance = (a: string, b: string) => {
        let row = Array.from({ length: b.length + 1 }, (_, i) => i);
        for (let i = 1; i <= a.length; i++) {
            const next = [i];
            for (let j = 1; j <= b.length; j++)
                next[j] = Math.min(row[j]! + 1, next[j - 1]! + 1, row[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
            row = next;
        }
        return row[b.length]!;
    };
    let best: [string, number] | undefined;
    for (const n of names)
        if (distance(name, n) <= Math.max(2, name.length / 4) && (!best || distance(name, n) < best[1])) best = [n, distance(name, n)];
    return best?.[0];
}

/** What to say about an unknown key: "Did you mean" when one is close, else the keys taken there. */
export function unknownKeyHelp({ key, known }: UnknownKey): string {
    const hint = closest(key, known);
    return hint ? `Did you mean ${hint}?` : `It takes: ${known.join(", ")}.`;
}
