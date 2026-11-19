// Tenant terramix: its VLANs, its gateway on the router, its servers' ports on the switch, a cap on UDP toward it, and its private network.
// Copy this file for a new tenant, and add it to index.ts.

const vlans = literal({
    "terramix-internet": { id: 1001, description: "Tenant terramix internet" },
    "terramix-private": { id: 2001, description: "Tenant terramix private" },
});

export const terramix = {
    parts: {
        "edge-01": part("device", {
            switching: { vlans },
            interfaces: {
                ethernet: {
                    "100g-1": { trunk_vlans: ["terramix-internet", "terramix-private"] },
                    "25g-4": { description: "Terramix private circuit", addresses: ["10.20.255.1/30"], vrf: "terramix" },
                },
                vlan_interface: {
                    "terramix-internet": {
                        vlan: "terramix-internet",
                        description: "Tenant terramix",
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
                    "terramix-private": {
                        vlan: "terramix-private",
                        description: "Tenant terramix private",
                        addresses: ["10.20.0.1/24"],
                        vrf: "terramix",
                    },
                },
            },
            services: { dhcpv6_server: { "terramix-internet": { interface: "terramix-internet", dns: ["2001:db8:100::53"] } } },
            routing: {
                // The private network's routes stay in a table of their own: they never meet the internet's, or another tenant's.
                vrfs: { terramix: { description: "Tenant terramix private" } },
                // Our monitoring reaches the private network. Nothing else crosses.
                vrf_imports: [
                    { from: "services", to: "terramix", policy: "monitoring-network" },
                    { from: "terramix", to: "services", policy: "terramix-private-network" },
                ],
                bgp: {
                    // The private VLAN's network, which only the session in the VRF can announce.
                    originated_prefixes: ["10.20.0.0/24"],
                    neighbors: {
                        "terramix-private": {
                            address: "10.20.255.2",
                            remote_as: 274016,
                            description: "Terramix, over its private circuit",
                            vrf: "terramix",
                            import_policy: "terramix-private-import",
                            export_policy: "terramix-private-network",
                        },
                    },
                },
                // Terramix's own private space, which its servers here have a part of.
                prefix_sets: { "terramix-private": { prefixes: ["10.16.0.0/12"] } },
                policies: {
                    "terramix-private-import": [{ if: { prefix_set: "terramix-private" }, then: "accept" }, { then: "reject" }],
                    "terramix-private-network": [{ if: { prefix: "10.20.0.0/24" }, then: "accept" }, { then: "reject" }],
                    "monitoring-network": [{ if: { prefix: "10.0.5.0/24" }, then: "accept" }, { then: "reject" }],
                },
            },
        }),
        "tor-01": part("device", {
            switching: { vlans },
            interfaces: {
                ethernet: {
                    "40g-1": { trunk_vlans: ["terramix-internet", "terramix-private"] },
                    "10g-1": { description: "terramix server 1", trunk_vlans: ["terramix-internet", "terramix-private"] },
                    "10g-2": { description: "terramix server 2", trunk_vlans: ["terramix-internet", "terramix-private"] },
                },
            },
        }),
    },
    rules: {
        edge_acl: part("acl", [
            {
                description: "terramix: UDP above 1G",
                if: { vlan: ["transit", "exchange"], protocol: "udp", dst: "198.51.100.8/29" },
                then: "accept",
                rate: "1G",
            },
        ]),
    },
};
