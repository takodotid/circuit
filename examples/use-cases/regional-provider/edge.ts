// What the three edge routers share: their logins and services, the policies they apply to BGP, the firewall in front of them, and the filter in their switch chip.

import { readFileSync } from "node:fs";
import type { AclRule, Firewall, IP, Neighbor, Prefix, NeighborSettings, PolicyRule, RoutePolicy, RpkiServer } from "@takodotid/circuit";
import { secret } from "@takodotid/circuit";
import { Bgp, Filters } from "@takodotid/circuit/helpers";
import { AT, CUSTOMERS } from "./customers";
import { ADMIN, ASN, communities, IX, OURS, SERVICES, SITE, type Site, SPOOFED } from "./network";
import { customerPolicies, customerPrefixSets, customerSpace } from "./tenancy";

export const users = {
    operator: { role: "admin", password: secret("EDGE_OPERATOR_PASSWORD"), description: "Circuit" },
    noc: {
        role: "operator",
        password: secret("EDGE_NOC_PASSWORD"),
        description: "The NOC on call",
        ssh_keys: [
            "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExampleKeyOnlyForTheExampleNotARealKey00001 noc-1",
            "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExampleKeyOnlyForTheExampleNotARealKey00002 noc-2",
        ],
    },
    monitor: { role: "read-only", password: secret("EDGE_MONITOR_PASSWORD"), description: "Monitoring" },
} as const;

export const system = {
    timezone: "Asia/Jakarta",
    banner: "Authorised access only. Every session is logged.",
    dns: { servers: SERVICES.resolvers, serve: true },
    ntp: { servers: SERVICES.ntp, serve: true },
    logging: { local: { level: "warning", files: 5, lines_per_file: 10_000 }, remote: [{ address: SERVICES.syslog, level: "info" }] },
    release_channel: "long-term",
    ip: { syn_cookies: true },
} as const;

/** Ways in, from the admin networks only. */
export const management = (location: string) =>
    ({
        allow: ADMIN,
        ssh: {},
        https: { certificate: "web" },
        api_tls: { certificate: "web", allow: [`${SERVICES.monitoring[0]}/32`] },
        snmp: {
            allow: SERVICES.monitoring.map((address): Prefix => `${address}/32`),
            community: secret("EDGE_SNMP_COMMUNITY"),
            users: {
                monitor: {
                    auth: "sha1",
                    auth_password: secret("EDGE_SNMP_AUTH"),
                    privacy: "aes128",
                    privacy_password: secret("EDGE_SNMP_PRIVACY"),
                },
            },
            contact: "noc@example.net",
            location,
        },
    }) as const;

export const certificates = {
    web: {
        certificate: readFileSync(new URL("../../platforms/example.pem", import.meta.url), "utf8"),
        private_key: secret("EDGE_WEB_KEY"),
    },
};

export const rpki: RpkiServer[] = SERVICES.rpki.map((address, index) => ({
    address,
    port: index === 0 ? 323 : 8282,
    description: `Validator ${index + 1}`,
}));

/** iBGP between every edge router, from its loopback. One session per family. */
export const groups = {
    ibgp: { remote_as: ASN, description: "Our other edge routers", import: "IBGP-IN", export: "IBGP-OUT" },
    "ix-rs": {
        remote_as: IX.asn,
        role: "rs",
        description: `${IX.name} route servers`,
        import: "IX-RS-IN",
        export: "IX-RS-OUT",
        max_prefixes: 150_000,
    },
    "ix-peers": { role: "peer", description: `Peers at ${IX.name}` },
} as const satisfies Record<string, NeighborSettings<string>>;

/** The sessions at the exchange: both route servers, and every direct peer, in each family. */
export function exchangeSessions() {
    const neighbors: Record<string, Neighbor<string, keyof typeof groups>> = {};

    for (const server of IX.route_servers) {
        neighbors[`${server.name}-v4`] = { address: server.ipv4, group: "ix-rs" };
        neighbors[`${server.name}-v6`] = { address: server.ipv6, group: "ix-rs" };
    }

    for (const peer of IX.peers) {
        const settings = { remote_as: peer.asn, description: peer.description, import: `PEER-${peer.name.toUpperCase()}-IN` };
        const out = `PEER-${peer.name.toUpperCase()}-OUT`;

        neighbors[`${peer.name}-v4`] = {
            ...settings,
            address: peer.ipv4,
            group: "ix-peers",
            export: out,
            max_prefixes: peer.max_prefixes.ipv4,
        };
        neighbors[`${peer.name}-v6`] = {
            ...settings,
            address: peer.ipv6,
            group: "ix-peers",
            export: out,
            max_prefixes: peer.max_prefixes.ipv6,
        };
    }

    return neighbors;
}

/** Every BGP customer's space, whichever site it is at, so any edge router can pass it on. */
export const prefixSets = customerPrefixSets(CUSTOMERS);

/** What leaves for another network: our space and our BGP customers' own, nothing else. */
const announced = (neighborAs: number): PolicyRule<never, string>[] => [
    ...communities.actions(neighborAs),
    { description: "Our IPv4", match: { prefix: OURS.v4 }, action: "accept" },
    { description: "Our IPv6", match: { prefix: OURS.v6 }, action: "accept" },
    ...customerSpace(CUSTOMERS),
    { description: "Nothing else leaves", action: "reject" },
];

/** An import from a network that is not our customer, preferred by `local_pref`. */
const learned = (
    kind: "transit" | "exchange" | "peer",
    neighborAs: number,
    site: Site,
    local_pref: number,
    extra: PolicyRule<never, never>[] = []
): RoutePolicy<string, string> => [
    { call: "SANITY" },
    communities.tag(kind, neighborAs, { site: SITE[site] }),
    ...extra,
    { set: { local_pref } },
    { action: "accept" },
];

/** Every policy an edge router at this site has: its transits', the exchange's when it is there, iBGP, and its BGP customers'. */
export function policies(site: Site, transits: Readonly<Record<string, number>>, exchange: boolean) {
    const result: Record<string, RoutePolicy<string, string>> = {
        SANITY: Bgp.sanity(),

        "IBGP-IN": [{ description: "Everything our other edge routers pass on", action: "accept" }],
        // Only what an import tagged, and our own space. A route that skipped an import never spreads.
        "IBGP-OUT": [
            { description: "Our IPv4", match: { prefix: OURS.v4 }, action: "accept" },
            { description: "Our IPv6", match: { prefix: OURS.v6 }, action: "accept" },
            ...(["transit", "exchange", "peer", "customer"] as const).map((kind) => ({
                description: `Learned from a ${kind}`,
                match: { large_community: communities.learned_from[kind] },
                action: "accept" as const,
            })),
            { description: "Nothing untagged", action: "reject" },
        ],

        // What a customer pays for: every route we know.
        "CUSTOMER-OUT": [{ description: "The full table", action: "accept" }],
    };

    for (const [name, asn] of Object.entries(transits)) {
        result[`${name.toUpperCase()}-IN`] = learned("transit", asn, site, 100);
        result[`${name.toUpperCase()}-OUT`] = announced(asn);
    }

    if (exchange) {
        result["IX-RS-IN"] = learned("exchange", IX.asn, site, 200);
        result["IX-RS-OUT"] = announced(IX.asn);

        // A direct peer's own routes, and its customers', win over the same routes from the route servers.
        for (const peer of IX.peers) {
            const short = { description: "Its own and its customers' routes", match: { as_path_length: { max: 2 } }, set: { med: 0 } };
            result[`PEER-${peer.name.toUpperCase()}-IN`] = learned("peer", peer.asn, site, 250, [short]);
            result[`PEER-${peer.name.toUpperCase()}-OUT`] = announced(peer.asn);
        }
    }

    return { ...result, ...customerPolicies(AT[site]) };
}

/** Address sets every edge router's firewall matches on. */
type Sets = "admin" | "monitoring" | "bgp-neighbors" | "tunnel-peers" | "ours";

/** The firewall in front of an edge router. `outside` are its interfaces toward other networks; `neighbors` its BGP sessions; `tunnelPeers` the far ends of its tunnels. */
export function firewall<const I extends string>(options: {
    outside: readonly I[];
    neighbors: Readonly<Record<string, { address: IP }>>;
    tunnelPeers: readonly IP[];
    wireguardPorts: readonly number[];
}): Firewall<I, Sets> {
    const { outside, neighbors, tunnelPeers, wireguardPorts } = options;

    return {
        address_sets: {
            admin: ADMIN,
            monitoring: SERVICES.monitoring,
            "bgp-neighbors": Object.values(neighbors).map((neighbor) => neighbor.address),
            "tunnel-peers": tunnelPeers,
            ours: [OURS.v4, OURS.v6],
        },
        filter: {
            input: {
                default: "drop",
                rules: [
                    { description: "Replies", match: { state: ["established", "related"] }, action: "accept" },
                    { description: "Invalid", match: { state: ["invalid"] }, action: "drop" },
                    { description: "Ping", match: { protocol: "icmp" }, action: "accept" },
                    {
                        description: "Management",
                        match: { protocol: "tcp", dst_port: [22, 443, 8729], src_set: "admin" },
                        action: "accept",
                    },
                    { description: "SNMP", match: { protocol: "udp", dst_port: 161, src_set: "monitoring" }, action: "accept" },
                    { description: "BGP", match: { protocol: "tcp", dst_port: 179, src_set: "bgp-neighbors" }, action: "accept" },
                    { description: "BFD", match: { protocol: "udp", dst_port: { min: 3784, max: 3785 } }, action: "accept" },
                    { description: "OSPF", match: { protocol: "ospf" }, action: "accept" },
                    { description: "VRRP", match: { protocol: "vrrp" }, action: "accept" },
                    ...(tunnelPeers.length
                        ? [
                              {
                                  description: "GRE",
                                  match: { protocol: "gre" as const, src_set: "tunnel-peers" as const },
                                  action: "accept" as const,
                              },
                              {
                                  description: "VXLAN",
                                  match: { protocol: "udp" as const, dst_port: 4789, src_set: "tunnel-peers" as const },
                                  action: "accept" as const,
                              },
                          ]
                        : []),
                    ...(wireguardPorts.length
                        ? [
                              {
                                  description: "WireGuard",
                                  match: { protocol: "udp" as const, dst_port: wireguardPorts },
                                  action: "accept" as const,
                              },
                          ]
                        : []),
                    { description: "DNS for customers, UDP", match: { protocol: "udp", dst_port: 53, src_set: "ours" }, action: "accept" },
                    { description: "DNS for customers, TCP", match: { protocol: "tcp", dst_port: 53, src_set: "ours" }, action: "accept" },
                    { description: "NTP for customers", match: { protocol: "udp", dst_port: 123, src_set: "ours" }, action: "accept" },
                ],
            },
            forward: {
                rules: [
                    { description: "Replies", match: { state: ["established", "related"] }, action: "accept", offload: true },
                    { description: "Invalid", match: { state: ["invalid"] }, action: "drop" },
                    ...Filters.badTcpFlags(),
                    // Remote desktop and telnet on a customer's server are never meant for the whole internet.
                    ...outside.map((iface) => ({
                        description: `Remote desktop and telnet from ${iface}`,
                        match: { protocol: "tcp" as const, dst_port: [23, 3389, 5900], in_interface: iface },
                        action: "drop" as const,
                    })),
                ],
            },
        },
        nat: {
            // Management networks reach the internet, for updates, from the router's own address.
            source: outside.map((iface) => ({
                description: `Management out through ${iface}`,
                match: { src: "10.0.0.0/8", out_interface: iface },
                action: "masquerade" as const,
            })),
        },
        helpers: ["ftp"],
    };
}

/** The filter in an edge router's switch chip, on every port from another network: spoofed sources on each outside VLAN, then reflected floods toward each customer that asked for it. */
export function acl<const V extends string>(outside: readonly V[]): AclRule<V>[] {
    const shielded = CUSTOMERS.filter((c) => c.shield).map((c) => c.ipv4);

    return [...outside.flatMap((vlan) => Filters.antiSpoofing(vlan, SPOOFED)), ...Filters.antiAmplification(shielded)];
}
