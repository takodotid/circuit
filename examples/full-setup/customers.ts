// Every customer. A customer joins by being added here, and leaves by being removed: the next apply takes away its VLAN, ports, gateway, routes and BGP sessions.

import { customer } from "./tenancy";

export const CUSTOMERS = [
    customer({
        name: "acme",
        number: 1,
        site: "a",
        ipv4: "198.51.100.16/28",
        ipv6: true,
        bgp: { asn: 65537, prefixes: ["192.0.2.0/24", "2001:db8:201::/48"] },
        shield: true,
        ports: {
            "tor-a1": { "10g-1": { description: "acme router, first link" } },
            "tor-a2": { "10g-1": { description: "acme router, second link" } },
        },
    }),
    customer({
        name: "globex",
        number: 2,
        site: "a",
        ipv4: "198.51.100.32/28",
        ipv6: true,
        bgp: { asn: 65538, prefixes: ["2001:db8:202::/48"] },
        ports: {
            "tor-a1": {
                "10g-2": { description: "globex router" },
                "10g-3": { description: "globex web 1" },
            },
            "tor-a3": { "25g-1": { description: "globex web 2" } },
        },
    }),
    customer({
        name: "initech",
        number: 3,
        site: "a",
        ipv4: "198.51.100.48/29",
        ipv6: true,
        ports: {
            "tor-a2": {
                "10g-2": { description: "initech app", private: true },
                "10g-3": { description: "initech database", private: true },
            },
        },
    }),
    customer({
        name: "vandelay",
        number: 4,
        site: "a",
        ipv4: "198.51.100.56/29",
        routed: ["198.51.100.192/28"],
        ports: {
            "tor-a2": { "10g-4": { description: "vandelay firewall" } },
            "tor-a3": { "25g-2": { description: "vandelay backup" } },
        },
    }),
    customer({
        name: "soylent",
        number: 5,
        site: "a",
        ipv4: "198.51.100.64/27",
        ipv6: true,
        shield: true,
        ports: {
            "tor-a1": {
                "10g-4": { description: "soylent game server 1" },
                "10g-5": { description: "soylent game server 2" },
                "10g-6": { description: "soylent game server 3" },
                "10g-7": { description: "soylent game server 4" },
            },
            "tor-a3": {
                "25g-3": { description: "soylent matchmaking", private: true },
                "25g-4": { description: "soylent database", private: true },
            },
        },
    }),
    customer({
        name: "cyberdyne",
        number: 6,
        site: "a",
        ipv4: "198.51.100.96/28",
        ipv6: true,
        bgp: { asn: 65540, prefixes: ["2001:db8:203::/48"] },
        ports: { "tor-a3": { "25g-5": { description: "cyberdyne router" } } },
    }),
    customer({
        name: "tyrell",
        number: 7,
        site: "a",
        ipv4: "198.51.100.112/29",
        ports: { "tor-a1": { "10g-8": { description: "tyrell server" } } },
    }),
    customer({
        name: "wonka",
        number: 8,
        site: "a",
        ipv4: "198.51.100.120/29",
        ipv6: true,
        ports: {
            "tor-a2": {
                "10g-5": { description: "wonka shop 1" },
                "10g-6": { description: "wonka shop 2" },
            },
        },
    }),
    customer({
        name: "hanso",
        number: 9,
        site: "b",
        ipv4: "198.51.100.128/28",
        ipv6: true,
        ports: {
            "agg-b1": {
                "25g-1": { description: "hanso server 1" },
                "25g-2": { description: "hanso server 2" },
            },
        },
    }),
    customer({
        name: "oscorp",
        number: 10,
        site: "b",
        ipv4: "198.51.100.144/28",
        ipv6: true,
        bgp: { asn: 65541, prefixes: ["2001:db8:204::/48"] },
        ports: { "tor-b1": { "10g-1": { description: "oscorp router" } } },
    }),
    customer({
        name: "dunder",
        number: 11,
        site: "b",
        ipv4: "198.51.100.160/29",
        ports: {
            "tor-b1": {
                "10g-2": { description: "dunder file server" },
                "10g-3": { description: "dunder mail" },
            },
        },
    }),
    customer({
        name: "sirius",
        number: 12,
        site: "b",
        ipv4: "198.51.100.168/29",
        ipv6: true,
        ports: {
            "agg-b1": { "25g-3": { description: "sirius router" } },
            "tor-b1": {
                "10g-4": { description: "sirius build 1", private: true },
                "10g-5": { description: "sirius build 2", private: true },
            },
        },
    }),
];

/** The customers at each site. */
export const AT = {
    a: CUSTOMERS.filter((c) => c.site === "a"),
    b: CUSTOMERS.filter((c) => c.site === "b"),
};
