// Every customer, with everything its devices carry written out: its VLANs, its blocks, each edge router's addresses on its VLAN, its BGP sessions and policy, and its ports. A customer joins by being added here, and leaves by being removed: the next apply takes away its VLAN, ports, gateway, routes and BGP sessions.

import type { Customer } from "./tenancy";

export const CUSTOMERS: readonly Customer[] = [
    {
        name: "acme",
        site: "a",
        vlan: { name: "acme", id: 1001, description: "Customer acme" },
        blocks: ["198.51.100.16/28", "2001:db8:100:1::/64"],
        gateways: {
            "edge-a1": {
                addresses: ["198.51.100.18/28", "2001:db8:100:1::2/64"],
                ipv6_ra: true,
                vrrp: [{ id: 101, address: "198.51.100.17", priority: 200, preempt: true }],
            },
            "edge-a2": {
                addresses: ["198.51.100.19/28", "2001:db8:100:1::3/64"],
                ipv6_ra: true,
                vrrp: [{ id: 101, address: "198.51.100.17", priority: 100, preempt: true }],
            },
        },
        bgp: {
            asn: 65537,
            import: "CUSTOMER-ACME-IN",
            prefix_sets: { "acme-v4": ["192.0.2.0/24"], "acme-v6": ["2001:db8:201::/48"] },
            sessions: { "acme-v4": "198.51.100.20", "acme-v6": "2001:db8:100:1::4" },
            max_prefixes: 20,
        },
        shield: true,
        ports: {
            "tor-a1": {
                "10g-1": { description: "acme router, first link", access_vlan: "acme" },
            },
            "tor-a2": {
                "10g-1": { description: "acme router, second link", access_vlan: "acme" },
            },
        },
    },
    {
        name: "globex",
        site: "a",
        vlan: { name: "globex", id: 1002, description: "Customer globex" },
        blocks: ["198.51.100.32/28", "2001:db8:100:2::/64"],
        gateways: {
            "edge-a1": {
                addresses: ["198.51.100.34/28", "2001:db8:100:2::2/64"],
                ipv6_ra: true,
                vrrp: [{ id: 102, address: "198.51.100.33", priority: 200, preempt: true }],
            },
            "edge-a2": {
                addresses: ["198.51.100.35/28", "2001:db8:100:2::3/64"],
                ipv6_ra: true,
                vrrp: [{ id: 102, address: "198.51.100.33", priority: 100, preempt: true }],
            },
        },
        bgp: {
            asn: 65538,
            import: "CUSTOMER-GLOBEX-IN",
            prefix_sets: { "globex-v6": ["2001:db8:202::/48"] },
            sessions: { "globex-v6": "2001:db8:100:2::4" },
            max_prefixes: 10,
        },
        ports: {
            "tor-a1": {
                "10g-2": { description: "globex router", access_vlan: "globex" },
                "10g-3": { description: "globex web 1", access_vlan: "globex" },
            },
            "tor-a3": {
                "25g-1": { description: "globex web 2", access_vlan: "globex" },
            },
        },
    },
    {
        name: "initech",
        site: "a",
        vlan: { name: "initech", id: 1003, description: "Customer initech" },
        private: { name: "initech-private", id: 2003, description: "Customer initech, private" },
        blocks: ["198.51.100.48/29", "2001:db8:100:3::/64"],
        gateways: {
            "edge-a1": {
                addresses: ["198.51.100.50/29", "2001:db8:100:3::2/64"],
                ipv6_ra: true,
                vrrp: [{ id: 103, address: "198.51.100.49", priority: 200, preempt: true }],
            },
            "edge-a2": {
                addresses: ["198.51.100.51/29", "2001:db8:100:3::3/64"],
                ipv6_ra: true,
                vrrp: [{ id: 103, address: "198.51.100.49", priority: 100, preempt: true }],
            },
        },
        ports: {
            "tor-a2": {
                "10g-2": { description: "initech app", trunk_vlans: ["initech", "initech-private"] },
                "10g-3": { description: "initech database", trunk_vlans: ["initech", "initech-private"] },
            },
        },
    },
    {
        name: "vandelay",
        site: "a",
        vlan: { name: "vandelay", id: 1004, description: "Customer vandelay" },
        blocks: ["198.51.100.56/29"],
        gateways: {
            "edge-a1": { addresses: ["198.51.100.58/29"], vrrp: [{ id: 104, address: "198.51.100.57", priority: 200, preempt: true }] },
            "edge-a2": { addresses: ["198.51.100.59/29"], vrrp: [{ id: 104, address: "198.51.100.57", priority: 100, preempt: true }] },
        },
        routed: { via: "198.51.100.60", prefixes: ["198.51.100.192/28"] },
        ports: {
            "tor-a2": {
                "10g-4": { description: "vandelay firewall", access_vlan: "vandelay" },
            },
            "tor-a3": {
                "25g-2": { description: "vandelay backup", access_vlan: "vandelay" },
            },
        },
    },
    {
        name: "soylent",
        site: "a",
        vlan: { name: "soylent", id: 1005, description: "Customer soylent" },
        private: { name: "soylent-private", id: 2005, description: "Customer soylent, private" },
        blocks: ["198.51.100.64/27", "2001:db8:100:5::/64"],
        gateways: {
            "edge-a1": {
                addresses: ["198.51.100.66/27", "2001:db8:100:5::2/64"],
                ipv6_ra: true,
                vrrp: [{ id: 105, address: "198.51.100.65", priority: 200, preempt: true }],
            },
            "edge-a2": {
                addresses: ["198.51.100.67/27", "2001:db8:100:5::3/64"],
                ipv6_ra: true,
                vrrp: [{ id: 105, address: "198.51.100.65", priority: 100, preempt: true }],
            },
        },
        shield: true,
        ports: {
            "tor-a1": {
                "10g-4": { description: "soylent game server 1", access_vlan: "soylent" },
                "10g-5": { description: "soylent game server 2", access_vlan: "soylent" },
                "10g-6": { description: "soylent game server 3", access_vlan: "soylent" },
                "10g-7": { description: "soylent game server 4", access_vlan: "soylent" },
            },
            "tor-a3": {
                "25g-3": { description: "soylent matchmaking", trunk_vlans: ["soylent", "soylent-private"] },
                "25g-4": { description: "soylent database", trunk_vlans: ["soylent", "soylent-private"] },
            },
        },
    },
    {
        name: "cyberdyne",
        site: "a",
        vlan: { name: "cyberdyne", id: 1006, description: "Customer cyberdyne" },
        blocks: ["198.51.100.96/28", "2001:db8:100:6::/64"],
        gateways: {
            "edge-a1": {
                addresses: ["198.51.100.98/28", "2001:db8:100:6::2/64"],
                ipv6_ra: true,
                vrrp: [{ id: 106, address: "198.51.100.97", priority: 200, preempt: true }],
            },
            "edge-a2": {
                addresses: ["198.51.100.99/28", "2001:db8:100:6::3/64"],
                ipv6_ra: true,
                vrrp: [{ id: 106, address: "198.51.100.97", priority: 100, preempt: true }],
            },
        },
        bgp: {
            asn: 65540,
            import: "CUSTOMER-CYBERDYNE-IN",
            prefix_sets: { "cyberdyne-v6": ["2001:db8:203::/48"] },
            sessions: { "cyberdyne-v6": "2001:db8:100:6::4" },
            max_prefixes: 10,
        },
        ports: {
            "tor-a3": {
                "25g-5": { description: "cyberdyne router", access_vlan: "cyberdyne" },
            },
        },
    },
    {
        name: "tyrell",
        site: "a",
        vlan: { name: "tyrell", id: 1007, description: "Customer tyrell" },
        blocks: ["198.51.100.112/29"],
        gateways: {
            "edge-a1": { addresses: ["198.51.100.114/29"], vrrp: [{ id: 107, address: "198.51.100.113", priority: 200, preempt: true }] },
            "edge-a2": { addresses: ["198.51.100.115/29"], vrrp: [{ id: 107, address: "198.51.100.113", priority: 100, preempt: true }] },
        },
        ports: {
            "tor-a1": {
                "10g-8": { description: "tyrell server", access_vlan: "tyrell" },
            },
        },
    },
    {
        name: "wonka",
        site: "a",
        vlan: { name: "wonka", id: 1008, description: "Customer wonka" },
        blocks: ["198.51.100.120/29", "2001:db8:100:8::/64"],
        gateways: {
            "edge-a1": {
                addresses: ["198.51.100.122/29", "2001:db8:100:8::2/64"],
                ipv6_ra: true,
                vrrp: [{ id: 108, address: "198.51.100.121", priority: 200, preempt: true }],
            },
            "edge-a2": {
                addresses: ["198.51.100.123/29", "2001:db8:100:8::3/64"],
                ipv6_ra: true,
                vrrp: [{ id: 108, address: "198.51.100.121", priority: 100, preempt: true }],
            },
        },
        ports: {
            "tor-a2": {
                "10g-5": { description: "wonka shop 1", access_vlan: "wonka" },
                "10g-6": { description: "wonka shop 2", access_vlan: "wonka" },
            },
        },
    },
    {
        name: "hanso",
        site: "b",
        vlan: { name: "hanso", id: 1009, description: "Customer hanso" },
        blocks: ["198.51.100.128/28", "2001:db8:100:9::/64"],
        gateways: {
            "edge-b1": { addresses: ["198.51.100.129/28", "2001:db8:100:9::1/64"], ipv6_ra: true },
        },
        ports: {
            "agg-b1": {
                "25g-1": { description: "hanso server 1", access_vlan: "hanso" },
                "25g-2": { description: "hanso server 2", access_vlan: "hanso" },
            },
        },
    },
    {
        name: "oscorp",
        site: "b",
        vlan: { name: "oscorp", id: 1010, description: "Customer oscorp" },
        blocks: ["198.51.100.144/28", "2001:db8:100:a::/64"],
        gateways: {
            "edge-b1": { addresses: ["198.51.100.145/28", "2001:db8:100:a::1/64"], ipv6_ra: true },
        },
        bgp: {
            asn: 65541,
            import: "CUSTOMER-OSCORP-IN",
            prefix_sets: { "oscorp-v6": ["2001:db8:204::/48"] },
            sessions: { "oscorp-v6": "2001:db8:100:a::4" },
            max_prefixes: 10,
        },
        ports: {
            "tor-b1": {
                "10g-1": { description: "oscorp router", access_vlan: "oscorp" },
            },
        },
    },
    {
        name: "dunder",
        site: "b",
        vlan: { name: "dunder", id: 1011, description: "Customer dunder" },
        blocks: ["198.51.100.160/29"],
        gateways: {
            "edge-b1": { addresses: ["198.51.100.161/29"] },
        },
        ports: {
            "tor-b1": {
                "10g-2": { description: "dunder file server", access_vlan: "dunder" },
                "10g-3": { description: "dunder mail", access_vlan: "dunder" },
            },
        },
    },
    {
        name: "sirius",
        site: "b",
        vlan: { name: "sirius", id: 1012, description: "Customer sirius" },
        private: { name: "sirius-private", id: 2012, description: "Customer sirius, private" },
        blocks: ["198.51.100.168/29", "2001:db8:100:c::/64"],
        gateways: {
            "edge-b1": { addresses: ["198.51.100.169/29", "2001:db8:100:c::1/64"], ipv6_ra: true },
        },
        ports: {
            "agg-b1": {
                "25g-3": { description: "sirius router", access_vlan: "sirius" },
            },
            "tor-b1": {
                "10g-4": { description: "sirius build 1", trunk_vlans: ["sirius", "sirius-private"] },
                "10g-5": { description: "sirius build 2", trunk_vlans: ["sirius", "sirius-private"] },
            },
        },
    },
];

/** The customers at each site. */
export const AT = {
    a: CUSTOMERS.filter((c) => c.site === "a"),
    b: CUSTOMERS.filter((c) => c.site === "b"),
};
