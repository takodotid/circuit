// Values every network writes the same way, each from a public standard it names. Plain data, in one `presets` object: pick from it, or
// place its rules where they go in an ordered list with `merge`. Data is snake_case, like every field.

import type { Prefix } from "./common";
import type { FilterRule, Ports } from "./firewall";
import type { RouteRule } from "./routing";

const bogons = {
    ipv4: {
        /** "This network", RFC 791 and RFC 1122. */
        this_network: "0.0.0.0/8",
        /** Private use, RFC 1918. */
        private10: "10.0.0.0/8",
        /** Shared address space for carrier-grade NAT, RFC 6598. */
        shared_address_space: "100.64.0.0/10",
        /** Loopback, RFC 1122. */
        loopback: "127.0.0.0/8",
        /** Link-local, RFC 3927. */
        link_local: "169.254.0.0/16",
        /** Private use, RFC 1918. */
        private172: "172.16.0.0/12",
        /** IETF protocol assignments, RFC 6890. */
        ietf_protocols: "192.0.0.0/24",
        /** Documentation, TEST-NET-1, RFC 5737. */
        documentation1: "192.0.2.0/24",
        /** Private use, RFC 1918. */
        private192: "192.168.0.0/16",
        /** Benchmarking, RFC 2544. */
        benchmarking: "198.18.0.0/15",
        /** Documentation, TEST-NET-2, RFC 5737. */
        documentation2: "198.51.100.0/24",
        /** Documentation, TEST-NET-3, RFC 5737. */
        documentation3: "203.0.113.0/24",
        /** Multicast, RFC 5771. */
        multicast: "224.0.0.0/4",
        /** Reserved for future use, RFC 1112. */
        reserved: "240.0.0.0/4",
    },
    ipv6: {
        /** The unspecified address, RFC 4291. */
        unspecified: "::/128",
        /** Loopback, RFC 4291. */
        loopback: "::1/128",
        /** IPv4-mapped addresses, RFC 4291. */
        ipv4_mapped: "::ffff:0:0/96",
        /** Discard-only, RFC 6666. */
        discard_only: "100::/64",
        /** Documentation, RFC 3849. */
        documentation: "2001:db8::/32",
        /** Unique local, RFC 4193. */
        unique_local: "fc00::/7",
        /** Link-local, RFC 4291. */
        link_local: "fe80::/10",
        /** Multicast, RFC 4291. */
        multicast: "ff00::/8",
    },
} as const satisfies Record<"ipv4" | "ipv6", Record<string, Prefix>>;

const bgp_sanity: readonly RouteRule<never>[] = [
    { description: "IPv4 shorter than /8", if: { family: "ipv4", prefix_length: { max: 7 } }, then: "reject" },
    { description: "IPv4 longer than /24", if: { family: "ipv4", prefix_length: { min: 25 } }, then: "reject" },
    { description: "IPv6 shorter than /16", if: { family: "ipv6", prefix_length: { max: 15 } }, then: "reject" },
    { description: "IPv6 longer than /48", if: { family: "ipv6", prefix_length: { min: 49 } }, then: "reject" },
    { description: "RPKI invalid", if: { rpki: "invalid" }, then: "reject" },
];

const bad_tcp_flags: readonly FilterRule<never, never, never>[] = [
    { description: "Bad flags FIN+SYN", if: { protocol: "tcp", tcp_flags: { set: ["fin", "syn"], unset: [] } }, then: "drop" },
    { description: "Bad flags SYN+RST", if: { protocol: "tcp", tcp_flags: { set: ["syn", "rst"], unset: [] } }, then: "drop" },
    { description: "Bad flags FIN+RST", if: { protocol: "tcp", tcp_flags: { set: ["fin", "rst"], unset: [] } }, then: "drop" },
    { description: "Bad flags FIN without ACK", if: { protocol: "tcp", tcp_flags: { set: ["fin"], unset: ["ack"] } }, then: "drop" },
    { description: "Bad flags FIN+URG", if: { protocol: "tcp", tcp_flags: { set: ["fin", "urg"], unset: [] } }, then: "drop" },
    {
        description: "Bad flags Xmas scan",
        if: { protocol: "tcp", tcp_flags: { set: ["fin", "syn", "psh", "urg"], unset: [] } },
        then: "drop",
    },
];

/** Values every network writes the same way, each from a public standard. A global: write `presets.bogons`, with no import. */
export const presets = {
    /**
     * Address blocks that never appear as a source or destination on the internet: the IANA IPv4 and IPv6 Special-Purpose Address
     * Registries (RFC 6890), each block with the RFC that reserves it. Pick the ones your filters need: `presets.bogons.ipv4.loopback`.
     */
    bogons,

    /** The IPv4 private ranges of RFC 1918, in address order. */
    rfc1918: [bogons.ipv4.private10, bogons.ipv4.private172, bogons.ipv4.private192] as const,

    /** The default route of each family: every destination, `0.0.0.0/0` (RFC 4632) and `::/0` (RFC 4291). */
    default_routes: { ipv4: "0.0.0.0/0", ipv6: "::/0" } as const satisfies Record<"ipv4" | "ipv6", Prefix>,

    /** Well-known ports, by the service names of the IANA Service Name and Transport Protocol Port Number Registry (RFC 6335). */
    ports: {
        /** DNS, RFC 1035. */
        dns: 53,
        /** DHCP and BOOTP server, RFC 2131. */
        dhcp_server: 67,
        /** DHCP and BOOTP client, RFC 2131. */
        dhcp_client: 68,
        /** NTP, RFC 5905. */
        ntp: 123,
        /** SNMP, RFC 3411. */
        snmp: 161,
        /** BGP, RFC 4271. */
        bgp: 179,
        /** Windows networking: MS-RPC endpoint mapper (135), NetBIOS (137 to 139, RFC 1001 and RFC 1002) and SMB (445), as IANA lists them. */
        windows_networking: [135, { min: 137, max: 139 }, 445],
    } as const satisfies Record<string, Ports>,

    /**
     * Route policy rules rejecting what no neighbor should send, for an import, or as a policy every import calls (MANRS action 1,
     * filtering). In order: IPv4 shorter than /8 and longer than /24, IPv6 shorter than /16 and longer than /48: too specific for the
     * global table (RFC 7454, section 6.1.3), or wider than any block one network holds. Then routes RPKI finds invalid (RFC 6811).
     * A policy of its own (`"common-sanity": presets.bgp_sanity`), or placed with `merge`: `merge([presets.bgp_sanity, own_rule])`.
     */
    bgp_sanity,

    /** Firewall rules dropping TCP flag combinations no packet that follows TCP (RFC 9293) carries, for a forward chain. Place them with `merge`. */
    bad_tcp_flags,

    /**
     * UDP services that answer a small request with a much larger reply, which attackers use to reflect a flood at a victim: the ports
     * of CISA's alert TA14-017A, "UDP-Based Amplification Attacks", plus six that are widely abused the same way but not in it: SLP,
     * MS-SQL, ARD, CoAP, Ubiquiti and DVR. A reflected flood arrives from these. Pick the ports a rule needs by name: `src_port: [presets.udp_amplifiers.qotd, presets.udp_amplifiers.chargen]`.
     */
    udp_amplifiers: {
        qotd: 17,
        chargen: 19,
        dns: 53,
        portmap: 111,
        ntp: 123,
        netbios: 137,
        snmp: 161,
        cldap: 389,
        slp: 427,
        rip: 520,
        ms_sql: 1434,
        ssdp: 1900,
        ard: 3283,
        ws_discovery: 3702,
        mdns: 5353,
        coap: 5683,
        ubiquiti: 10001,
        memcached: 11211,
        dvr: 37810,
    } as const,
};
