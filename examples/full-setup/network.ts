// What every device in this network shares: our AS and address space, where the devices are managed from, the services they use, our BGP communities, and the exchange both site A routers peer at.
//
// Not a real network. Our addresses are from the documentation ranges, 198.51.100.0/24 and 2001:db8:100::/48, and the links to other networks come from 203.0.113.0/24 and 2001:db8:ffff::/48. Every other network has a documentation AS number.

import type { IP, Prefix, Vlan } from "@takodotid/circuit";
import { Bgp, Filters } from "@takodotid/circuit/presets";

/** Our AS number. */
export const ASN = 64500;

/** The space we originate. */
export const OURS = { v4: "198.51.100.0/24", v6: "2001:db8:100::/48" } as const satisfies Record<string, Prefix>;

/** Sources that never arrive from outside: our own space, and addresses not on the internet at all. */
export const SPOOFED = [OURS.v4, ...Filters.MARTIANS, ...Filters.PRIVATE_RANGES];

/** Where the devices are managed from: each site's management VLAN, and the NOC's VPN. */
export const ADMIN = ["10.0.99.0/24", "10.1.99.0/24", "10.254.2.0/24"] as const satisfies readonly Prefix[];

/** The servers on the services VLAN at site A. */
export const SERVICES = {
    resolvers: ["10.0.20.53", "10.0.20.54"],
    ntp: ["10.0.20.123", "10.0.20.124"],
    syslog: "10.0.20.14",
    flows: "10.0.20.40",
    dhcp: "10.0.20.67",
    monitoring: ["10.0.20.30", "10.0.20.31"],
    rpki: ["10.0.20.80", "10.0.20.81"],
} as const satisfies Record<string, IP | readonly IP[]>;

/** The sites, by the number a route learned there is tagged with. */
export const SITE = { a: 1, b: 2 } as const;

export type Site = keyof typeof SITE;

/** VLANs every site has, with the same number at each. */
export const INFRA_VLANS = {
    mgmt: { id: 99, description: "Management of every device at the site" },
    infra: { id: 10, description: "OSPF between the site's routers and switches" },
} as const satisfies Record<string, Vlan>;

/** What our BGP communities mean. The edge routers tag each route they learn with them, and `circuit communities` publishes them. */
export const communities = Bgp.communityScheme({
    asn: ASN,
    learned_from: { function: 1, classes: { transit: 1, exchange: 2, peer: 3, customer: 4 } },
    learned_at: { function: 2, sites: { [SITE.a]: "site A", [SITE.b]: "site B" } },
    learned_from_as: 3,
    do_not_announce: 100,
    prepend: { once: 101, twice: 102, three_times: 103 },
    // Transit A drops traffic to a route it receives with its own blackhole community. The other transits never receive a blackholed route.
    blackhole: { function: 666, upstreams: { 64501: "64501:666" } },
});

/** A network we peer with directly at the exchange. */
export type ExchangePeer = {
    name: string;
    asn: number;
    description: string;
    ipv4: IP;
    ipv6: IP;
    /** Its routes, at most, by family. */
    max_prefixes: { ipv4: number; ipv6: number };
};

/** The exchange both site A routers have a port at. */
export const IX = {
    name: "Example IX",
    asn: 64504,
    lan: { ipv4: "203.0.113.128/25", ipv6: "2001:db8:ffff::/64" },
    route_servers: [
        { name: "rs1", ipv4: "203.0.113.129", ipv6: "2001:db8:ffff::1" },
        { name: "rs2", ipv4: "203.0.113.130", ipv6: "2001:db8:ffff::2" },
    ],
    peers: [
        {
            name: "content-a",
            asn: 64505,
            description: "A content network",
            ipv4: "203.0.113.150",
            ipv6: "2001:db8:ffff::150",
            max_prefixes: { ipv4: 2_000, ipv6: 1_000 },
        },
        {
            name: "cdn-b",
            asn: 64506,
            description: "A content delivery network",
            ipv4: "203.0.113.151",
            ipv6: "2001:db8:ffff::151",
            max_prefixes: { ipv4: 500, ipv6: 500 },
        },
        {
            name: "isp-c",
            asn: 65536,
            description: "Another regional provider",
            ipv4: "203.0.113.152",
            ipv6: "2001:db8:ffff::152",
            max_prefixes: { ipv4: 300, ipv6: 100 },
        },
    ],
} as const satisfies {
    name: string;
    asn: number;
    lan: { ipv4: Prefix; ipv6: Prefix };
    route_servers: readonly { name: string; ipv4: IP; ipv6: IP }[];
    peers: readonly ExchangePeer[];
};
