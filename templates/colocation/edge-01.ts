// The edge router: BGP with an IP transit and an internet exchange, the gateway of every tenant, and the filter between them.
//
// Hurricane Electric and SGIX stand for your own transit and exchange. Addresses are from the documentation ranges; use the ones your providers give you.

import type { Prefix } from "@takodotid/circuit";
import { defineDevice, merge, secret } from "@takodotid/circuit";
import { antiSpoofing, badTcpFlags, bgpSanity, MARTIANS, PRIVATE_RANGES } from "@takodotid/circuit/presets";
import { ASN, communities } from "./routing";
import { edgeRules, gateways, internetVlanNames, internetVlans } from "./tenancy";
import { TENANTS } from "./tenants";

/** The address space this router announces. */
const OURS = ["198.51.100.0/24", "2001:db8:100::/48"] as const satisfies readonly Prefix[];

/** Where the router is managed from. */
const MANAGEMENT = "10.0.0.0/24" satisfies Prefix;

/** Sources that never arrive from the internet: our own space, and addresses that are not on the internet at all. */
const SPOOFED = [OURS[0], ...MARTIANS, ...PRIVATE_RANGES];

export default defineDevice({
    name: "edge-01",
    platform: "routeros",
    model: "CCR2216-1G-12XS-2XQ",
    connection: { host: "10.0.0.1", user: "operator" },
    users: { operator: { role: "admin", password: secret("EDGE_01_PASSWORD") } },

    system: { timezone: "Asia/Jakarta", ntp: { servers: ["pool.ntp.org"] } },
    management: { allow: [MANAGEMENT], ssh: {} },

    vlans: merge(
        {
            mgmt: { id: 99, description: "Management of the switches" },
            transit: { id: 300, description: "IP transit from Hurricane Electric, AS6939" },
            ix: { id: 200, description: "Peering LAN of SGIX" },
        },
        internetVlans(TENANTS)
    ),

    ports: {
        "1g-1": { description: "Management", addresses: ["10.0.0.1/24"] },
        "25g-1": { description: "Hurricane Electric", access_vlan: "transit", acl: "edge" },
        "25g-2": { description: "SGIX", access_vlan: "ix", acl: "edge" },
        "100g-1": {
            description: "tor-01",
            speed: "40g",
            trunk_vlans: ["mgmt", ...internetVlanNames(TENANTS)],
            link: { device: "tor-01", port: "40g-1" },
        },
    },

    interfaces: merge(
        {
            mgmt: { type: "vlan", vlan: "mgmt", addresses: ["10.0.99.1/24"] },
            transit: { type: "vlan", vlan: "transit", addresses: ["203.0.113.2/30"] },
            ix: { type: "vlan", vlan: "ix", addresses: ["192.0.2.10/24", "2001:db8:ffff::10/64"] },
        },
        gateways(TENANTS)
    ),

    routing: {
        router_id: "203.0.113.2",
        // A route for each block we announce, so it is in the table even when nothing inside it is up.
        static: OURS.map((prefix) => ({ prefix, blackhole: true, description: "Originate" })),
        bgp: {
            asn: ASN,
            networks: [...OURS],
            neighbors: {
                "hurricane-electric": {
                    address: "203.0.113.1",
                    remote_as: 6939,
                    role: "provider",
                    import: "TRANSIT-IN",
                    export: "OUT",
                    max_prefixes: 1_200_000,
                },
                "sgix-rs-v4": {
                    address: "192.0.2.1",
                    remote_as: 55518,
                    role: "rs",
                    import: "IX-IN",
                    export: "OUT",
                    max_prefixes: 100_000,
                },
                "sgix-rs-v6": {
                    address: "2001:db8:ffff::1",
                    remote_as: 55518,
                    role: "rs",
                    import: "IX-IN",
                    export: "OUT",
                    max_prefixes: 50_000,
                },
            },
        },
    },

    policies: {
        SANITY: bgpSanity(),
        // A route from the exchange is preferred over the same route from the transit: higher local preference wins.
        "TRANSIT-IN": [{ call: "SANITY" }, communities.tag("transit", 6939), { set: { local_pref: 100 } }, { action: "accept" }],
        "IX-IN": [{ call: "SANITY" }, communities.tag("exchange", 55518), { set: { local_pref: 200 } }, { action: "accept" }],
        OUT: [
            ...OURS.map((prefix) => ({ description: `Announce ${prefix}`, match: { prefix }, action: "accept" as const })),
            { description: "Nothing else leaves", action: "reject" },
        ],
    },

    firewall: {
        address_sets: { "bgp-neighbors": ["203.0.113.1", "192.0.2.1", "2001:db8:ffff::1"] },
        filter: {
            input: {
                default: "drop",
                rules: [
                    { description: "Replies", match: { state: ["established", "related"] }, action: "accept" },
                    { description: "Ping", match: { protocol: "icmp" }, action: "accept" },
                    { description: "Management", match: { src: MANAGEMENT }, action: "accept" },
                    { description: "BGP", match: { protocol: "tcp", dst_port: 179, src_set: "bgp-neighbors" }, action: "accept" },
                ],
            },
            forward: { rules: [...badTcpFlags()] },
        },
    },

    // In the switch chip, before a packet reaches the router's CPU: spoofed sources first, then each tenant's own rules.
    acls: {
        edge: [
            ...antiSpoofing("transit", SPOOFED),
            ...antiSpoofing("ix", SPOOFED),
            ...edgeRules(TENANTS, "transit"),
            ...edgeRules(TENANTS, "ix"),
        ],
    },
});
