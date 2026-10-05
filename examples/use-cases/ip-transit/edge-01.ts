// An edge router that sells IP transit. It buys transit from Example Transit, AS64501, peers at Example IX, AS64502, and sells the whole internet to Example Customer, AS64510.

import type { Prefix } from "@takodotid/circuit";
import { defineDevice, secret } from "@takodotid/circuit";
import { antiSpoofing, badTcpFlags, bgpSanity, MARTIANS, PRIVATE_RANGES } from "@takodotid/circuit/presets";
import { ASN, communities } from "./routing";

/** Our own address space. */
const OURS = { v4: "198.51.100.0/24", v6: "2001:db8:100::/48" } as const satisfies Record<string, Prefix>;

/** Sources that never arrive from outside: our space, the customer's, and addresses not on the internet at all. */
const SPOOFED = [OURS.v4, "192.0.2.0/24", ...MARTIANS, ...PRIVATE_RANGES];

export default defineDevice({
    name: "edge-01",
    platform: "routeros",
    model: "CCR2216-1G-12XS-2XQ",
    connection: { host: "10.0.0.1", user: "operator" },
    users: { operator: { role: "admin", password: secret("EDGE_01_PASSWORD") } },
    management: { allow: ["10.0.0.0/24"], ssh: {} },

    vlans: {
        transit: { id: 300, description: "IP transit from Example Transit, AS64501" },
        ix: { id: 200, description: "Peering LAN of Example IX" },
        acme: { id: 1001, description: "Example Customer, AS64510" },
    },

    ports: {
        "1g-1": { description: "Management", addresses: ["10.0.0.1/24"] },
        "25g-1": { description: "Example Transit", access_vlan: "transit", acl: "edge" },
        "25g-2": { description: "Example IX", access_vlan: "ix", acl: "edge" },
        "25g-3": { description: "Example Customer", access_vlan: "acme" },
    },

    interfaces: {
        transit: { type: "vlan", vlan: "transit", addresses: ["203.0.113.2/30"] },
        ix: { type: "vlan", vlan: "ix", addresses: ["203.0.113.70/26", "2001:db8:ffff::70/64"] },
        acme: { type: "vlan", vlan: "acme", addresses: ["203.0.113.5/30", "2001:db8:ff01::1/64"] },
    },

    routing: {
        router_id: "203.0.113.2",
        static: [OURS.v4, OURS.v6].map((prefix) => ({ prefix, blackhole: true, description: "Originate" })),
        bgp: {
            asn: ASN,
            networks: [OURS.v4, OURS.v6],
            neighbors: {
                "example-transit": {
                    address: "203.0.113.1",
                    remote_as: 64501,
                    role: "provider",
                    import: "TRANSIT-IN",
                    export: "TRANSIT-OUT",
                    max_prefixes: 1_200_000,
                },
                "example-ix-rs": {
                    address: "203.0.113.65",
                    remote_as: 64502,
                    role: "rs",
                    import: "IX-IN",
                    export: "IX-OUT",
                    max_prefixes: 100_000,
                },
                // The customer sends a handful of prefixes at most. More means a mistake on their side, and the session closes.
                "acme-v4": {
                    address: "203.0.113.6",
                    remote_as: 64510,
                    role: "customer",
                    import: "ACME-IN",
                    export: "ACME-OUT",
                    max_prefixes: 10,
                },
                "acme-v6": {
                    address: "2001:db8:ff01::2",
                    remote_as: 64510,
                    role: "customer",
                    import: "ACME-IN",
                    export: "ACME-OUT",
                    max_prefixes: 10,
                },
            },
        },
    },

    // What the customer may announce: its own space, checked against its registry records before it is written here.
    prefix_sets: {
        "acme-v4": { prefixes: ["192.0.2.0/24"] },
        "acme-v6": { prefixes: ["2001:db8:200::/48"] },
    },

    policies: {
        SANITY: bgpSanity(),

        "TRANSIT-IN": [{ call: "SANITY" }, communities.tag("transit", 64501), { set: { local_pref: 100 } }, { action: "accept" }],
        "IX-IN": [{ call: "SANITY" }, communities.tag("exchange", 64502), { set: { local_pref: 200 } }, { action: "accept" }],

        // The customer's own routes win over the same routes from anyone else. It may also ask for a blackhole, or another action.
        "ACME-IN": [
            communities.blackhole("acme-v4"),
            communities.blackhole("acme-v6"),
            { call: "SANITY" },
            communities.tag("customer", 64510, { keepActions: true }),
            { description: "Their IPv4", match: { prefix_set: "acme-v4" }, set: { local_pref: 300 }, action: "accept" },
            { description: "Their IPv6", match: { prefix_set: "acme-v6" }, set: { local_pref: 300 }, action: "accept" },
            { description: "Nothing else", action: "reject" },
        ],

        // What the customer pays for: the whole internet, every route we know.
        "ACME-OUT": [{ description: "The full table", action: "accept" }],

        // Our space and the customer's, to the transit and the exchange.
        "TRANSIT-OUT": [
            ...communities.actions(64501),
            { description: "Our IPv4", match: { prefix: OURS.v4 }, action: "accept" },
            { description: "Our IPv6", match: { prefix: OURS.v6 }, action: "accept" },
            { description: "Customer IPv4", match: { prefix_set: "acme-v4" }, action: "accept" },
            { description: "Customer IPv6", match: { prefix_set: "acme-v6" }, action: "accept" },
            { description: "Nothing else leaves", action: "reject" },
        ],
        "IX-OUT": [
            ...communities.actions(64502),
            { description: "Our IPv4", match: { prefix: OURS.v4 }, action: "accept" },
            { description: "Our IPv6", match: { prefix: OURS.v6 }, action: "accept" },
            { description: "Customer IPv4", match: { prefix_set: "acme-v4" }, action: "accept" },
            { description: "Customer IPv6", match: { prefix_set: "acme-v6" }, action: "accept" },
            { description: "Nothing else leaves", action: "reject" },
        ],
    },

    firewall: {
        address_sets: { "bgp-neighbors": ["203.0.113.1", "203.0.113.65", "203.0.113.6", "2001:db8:ff01::2"] },
        filter: {
            input: {
                default: "drop",
                rules: [
                    { description: "Replies", match: { state: ["established", "related"] }, action: "accept" },
                    { description: "Ping", match: { protocol: "icmp" }, action: "accept" },
                    { description: "Management", match: { src: "10.0.0.0/24" }, action: "accept" },
                    { description: "BGP", match: { protocol: "tcp", dst_port: 179, src_set: "bgp-neighbors" }, action: "accept" },
                ],
            },
            forward: { rules: [...badTcpFlags()] },
        },
    },

    acls: { edge: [...antiSpoofing("transit", SPOOFED), ...antiSpoofing("ix", SPOOFED)] },
});
