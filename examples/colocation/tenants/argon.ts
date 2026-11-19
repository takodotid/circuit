// Tenant argon: its VLANs, its gateway on the router, its servers' ports on the switch, a cap on UDP toward it, and its private network.
// Copy this file for a new tenant, and add it to index.ts.

const vlans = literal({
    "argon-internet": { id: 1001, description: "Tenant argon internet" },
    "argon-private": { id: 2001, description: "Tenant argon private" },
});

export const argon = {
    parts: {
        "edge-01": part("device", {
            switching: { vlans },
            interfaces: {
                ethernet: {
                    "100g-1": { trunk_vlans: ["argon-internet", "argon-private"] },
                    "25g-4": { description: "Argon private circuit", addresses: ["10.20.255.1/30"], vrf: "argon" },
                },
                vlan_interface: {
                    "argon-internet": {
                        vlan: "argon-internet",
                        description: "Tenant argon",
                        addresses: ["198.51.100.9/29", "2001:db8:100:1::1/64"],
                        // The servers make their own addresses in the /64, and use our resolvers.
                        // Once the router stops announcing the /64, the servers stop using it for new connections within a day, and drop it after a week.
                        // A server that reads no DNS servers from router advertisements asks DHCPv6 for them.
                        ipv6_ra: {
                            prefixes: [{ prefix: "2001:db8:100:1::/64", valid_lifetime: 604_800, preferred_lifetime: 86_400 }],
                            dns_servers: ["2001:db8:100::53"],
                            other_config: true,
                        },
                    },
                    "argon-private": {
                        vlan: "argon-private",
                        description: "Tenant argon private",
                        addresses: ["10.20.0.1/24"],
                        vrf: "argon",
                    },
                },
            },
            services: { dhcpv6_server: { "argon-internet": { interface: "argon-internet", dns: ["2001:db8:100::53"] } } },
            routing: {
                // The private network's routes stay in a table of their own: they never meet the internet's, or another tenant's.
                vrfs: { argon: { description: "Tenant argon private" } },
                // Our monitoring reaches the private network. Nothing else crosses.
                vrf_imports: [
                    { from: "services", to: "argon", policy: "monitoring-network" },
                    { from: "argon", to: "services", policy: "argon-private-network" },
                ],
                bgp: {
                    // The private VLAN's network, which only the session in the VRF can announce.
                    originated_prefixes: ["10.20.0.0/24"],
                    neighbors: {
                        "argon-private": {
                            address: "10.20.255.2",
                            remote_as: 58477,
                            description: "Argon, over its private circuit",
                            vrf: "argon",
                            import_policy: "argon-private-import",
                            export_policy: "argon-private-network",
                        },
                    },
                },
                // Argon's own private space, which its servers here have a part of.
                prefix_sets: { "argon-private": { prefixes: ["10.16.0.0/12"] } },
                policies: {
                    "argon-private-import": [{ if: { prefix_set: "argon-private" }, then: "accept" }, { then: "reject" }],
                    "argon-private-network": [{ if: { prefix: "10.20.0.0/24" }, then: "accept" }, { then: "reject" }],
                    "monitoring-network": [{ if: { prefix: "10.0.5.0/24" }, then: "accept" }, { then: "reject" }],
                },
            },
        }),
        "tor-01": part("device", {
            switching: { vlans },
            interfaces: {
                ethernet: {
                    "40g-1": { trunk_vlans: ["argon-internet", "argon-private"] },
                    "10g-1": { description: "argon server 1", trunk_vlans: ["argon-internet", "argon-private"] },
                    "10g-2": { description: "argon server 2", trunk_vlans: ["argon-internet", "argon-private"] },
                },
            },
        }),
    },
    rules: {
        edge_acl: part("acl", [
            {
                description: "argon: UDP above 1G",
                if: { vlan: ["transit", "exchange"], protocol: "udp", dst: "198.51.100.8/29" },
                then: "accept",
                rate: "1G",
            },
        ]),
    },
};
