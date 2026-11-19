// Tenant netflix: its VLANs, its gateway on the router, its servers' ports on the switch, a cap on UDP toward it, and its private network.
// Copy this file for a new tenant, and add it to index.ts.

const vlans = literal({
    "netflix-internet": { id: 1001, description: "Tenant netflix internet" },
    "netflix-private": { id: 2001, description: "Tenant netflix private" },
});

export const netflix = {
    parts: {
        "edge-01": part("device", {
            switching: { vlans },
            interfaces: {
                ethernet: {
                    "100g-1": { trunk_vlans: ["netflix-internet", "netflix-private"] },
                    "25g-4": { description: "Netflix private circuit", addresses: ["10.20.255.1/30"], vrf: "netflix" },
                },
                vlan_interface: {
                    "netflix-internet": {
                        vlan: "netflix-internet",
                        description: "Tenant netflix",
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
                    "netflix-private": {
                        vlan: "netflix-private",
                        description: "Tenant netflix private",
                        addresses: ["10.20.0.1/24"],
                        vrf: "netflix",
                    },
                },
            },
            services: { dhcpv6_server: { "netflix-internet": { interface: "netflix-internet", dns: ["2001:db8:100::53"] } } },
            routing: {
                // The private network's routes stay in a table of their own: they never meet the internet's, or another tenant's.
                vrfs: { netflix: { description: "Tenant netflix private" } },
                // Our monitoring, in the management network, reaches the private network. Nothing else crosses.
                vrf_imports: [
                    { from: "main", to: "netflix", policy: "management-network" },
                    { from: "netflix", to: "main", policy: "netflix-private-network" },
                ],
                bgp: {
                    // The private VLAN's network, which only the session in the VRF can announce.
                    originated_prefixes: ["10.20.0.0/24"],
                    neighbors: {
                        "netflix-private": {
                            address: "10.20.255.2",
                            remote_as: 2906,
                            description: "Netflix, over its private circuit",
                            vrf: "netflix",
                            import_policy: "netflix-private-import",
                            export_policy: "netflix-private-network",
                        },
                    },
                },
                // Netflix's own private space, which its servers here have a part of.
                prefix_sets: { "netflix-private": { prefixes: ["10.16.0.0/12"] } },
                policies: {
                    "netflix-private-import": [{ if: { prefix_set: "netflix-private" }, then: "accept" }, { then: "reject" }],
                    "netflix-private-network": [{ if: { prefix: "10.20.0.0/24" }, then: "accept" }, { then: "reject" }],
                    "management-network": [{ if: { prefix: "10.0.0.0/24" }, then: "accept" }, { then: "reject" }],
                },
            },
        }),
        "tor-01": part("device", {
            switching: { vlans },
            interfaces: {
                ethernet: {
                    "40g-1": { trunk_vlans: ["netflix-internet", "netflix-private"] },
                    "10g-1": { description: "netflix server 1", trunk_vlans: ["netflix-internet", "netflix-private"] },
                    "10g-2": { description: "netflix server 2", trunk_vlans: ["netflix-internet", "netflix-private"] },
                },
            },
        }),
    },
    rules: {
        edge_acl: part("acl", [
            {
                description: "netflix: UDP above 1G",
                if: { vlan: ["transit", "exchange"], protocol: "udp", dst: "198.51.100.8/29" },
                then: "accept",
                rate: "1G",
            },
        ]),
    },
};
