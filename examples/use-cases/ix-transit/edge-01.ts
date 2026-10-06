// An edge router that sells IX-only transit to Acme, AS65550: only the routes it learns at SGIX, AS55518, not those from its own transit, Hurricane Electric, AS6939.
//
// Addresses are from the documentation ranges. Ours are 198.51.100.0/24 and 2001:db8:100::/48, and the customer's link comes out of them. The customer's own are 192.0.2.0/24 and 2001:db8:200::/48. The transit's link and the exchange's peering LAN stand in for blocks those providers give you, from 203.0.113.0/24.

import type { Prefix } from "@takodotid/circuit";
import { defineDevice, secret } from "@takodotid/circuit";
import { antiSpoofing, badTcpFlags, bgpSanity, MARTIANS, PRIVATE_RANGES } from "@takodotid/circuit/presets";
import { ASN, communities } from "../ip-transit/routing";

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
        transit: { id: 300, description: "IP transit from Hurricane Electric, AS6939" },
        ix: { id: 200, description: "Peering LAN of SGIX" },
        acme: { id: 1001, description: "Acme, AS65550" },
    },

    ports: {
        "1g-1": { description: "Management", addresses: ["10.0.0.1/24"] },
        "25g-1": { description: "Hurricane Electric", access_vlan: "transit", acl: "edge" },
        "25g-2": { description: "SGIX", access_vlan: "ix", acl: "edge" },
        "25g-3": { description: "Acme", access_vlan: "acme" },
    },

    interfaces: {
        transit: { type: "vlan", vlan: "transit", addresses: ["203.0.113.2/30"] },
        ix: { type: "vlan", vlan: "ix", addresses: ["203.0.113.140/25", "2001:db8:ffff::70/64"] },
        acme: { type: "vlan", vlan: "acme", addresses: ["198.51.100.253/30", "2001:db8:100:ff01::1/64"] },
    },

    routing: {
        router_id: "203.0.113.2",
        static: [OURS.v4, OURS.v6].map((prefix) => ({ prefix, blackhole: true, description: "Originate" })),
        bgp: {
            asn: ASN,
            networks: [OURS.v4, OURS.v6],
            neighbors: {
                "hurricane-electric": {
                    address: "203.0.113.1",
                    remote_as: 6939,
                    role: "provider",
                    import: "TRANSIT-IN",
                    export: "TRANSIT-OUT",
                    max_prefixes: 1_200_000,
                },
                "sgix-rs": {
                    address: "203.0.113.129",
                    remote_as: 55518,
                    role: "rs",
                    import: "IX-IN",
                    export: "IX-OUT",
                    max_prefixes: 100_000,
                },
                // The customer sends a handful of prefixes at most. More means a mistake on their side, and the session closes.
                "acme-v4": {
                    address: "198.51.100.254",
                    remote_as: 65550,
                    role: "customer",
                    import: "ACME-IN",
                    export: "ACME-OUT",
                    max_prefixes: 10,
                },
                "acme-v6": {
                    address: "2001:db8:100:ff01::2",
                    remote_as: 65550,
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

        "TRANSIT-IN": [{ call: "SANITY" }, communities.tag("transit", 6939), { set: { local_pref: 100 } }, { action: "accept" }],
        "IX-IN": [{ call: "SANITY" }, communities.tag("exchange", 55518), { set: { local_pref: 200 } }, { action: "accept" }],

        // The customer's own routes win over the same routes from anyone else. It may also ask for a blackhole, or another action.
        "ACME-IN": [
            communities.blackhole("acme-v4"),
            communities.blackhole("acme-v6"),
            { call: "SANITY" },
            communities.tag("customer", 65550, { trusted: ["do_not_announce", "prepend"] }),
            { description: "Their IPv4", match: { prefix_set: "acme-v4" }, set: { local_pref: 300 }, action: "accept" },
            { description: "Their IPv6", match: { prefix_set: "acme-v6" }, set: { local_pref: 300 }, action: "accept" },
            { description: "Nothing else", action: "reject" },
        ],

        // What the customer pays for: what we learned at the exchange, our own space, and our other customers. Nothing from the transit.
        "ACME-OUT": [
            { description: "Learned at an exchange", match: { large_community: communities.community(1, 2) }, action: "accept" },
            { description: "Our other customers", match: { large_community: communities.community(1, 3) }, action: "accept" },
            { description: "Our IPv4", match: { prefix: OURS.v4 }, action: "accept" },
            { description: "Our IPv6", match: { prefix: OURS.v6 }, action: "accept" },
            { description: "Nothing from the transit", action: "reject" },
        ],

        // Only our own space to the transit. The customer did not buy a way in from the whole internet.
        "TRANSIT-OUT": [
            ...communities.actions(6939),
            { description: "Our IPv4", match: { prefix: OURS.v4 }, action: "accept" },
            { description: "Our IPv6", match: { prefix: OURS.v6 }, action: "accept" },
            { description: "Nothing else leaves", action: "reject" },
        ],

        // Our space and the customer's to the exchange, so the networks there send their traffic for the customer through us.
        "IX-OUT": [
            ...communities.actions(55518),
            { description: "Our IPv4", match: { prefix: OURS.v4 }, action: "accept" },
            { description: "Our IPv6", match: { prefix: OURS.v6 }, action: "accept" },
            { description: "Customer IPv4", match: { prefix_set: "acme-v4" }, action: "accept" },
            { description: "Customer IPv6", match: { prefix_set: "acme-v6" }, action: "accept" },
            { description: "Nothing else leaves", action: "reject" },
        ],
    },

    firewall: {
        address_sets: { "bgp-neighbors": ["203.0.113.1", "203.0.113.129", "198.51.100.254", "2001:db8:100:ff01::2"] },
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
