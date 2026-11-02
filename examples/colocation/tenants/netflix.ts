// Tenant netflix: its VLANs, its gateway on the router, its servers' ports on the switch, and a cap on UDP toward it.
// Copy this file for a new tenant, and add it to index.ts.

const vlans = literal({
    "netflix-internet": { id: 1001, description: "Tenant netflix internet" },
    "netflix-private": { id: 2001, description: "Tenant netflix private" },
});

export const netflix = {
    parts: {
        "edge-01": part("device", {
            switching: { vlans: { "netflix-internet": vlans["netflix-internet"] } },
            interfaces: {
                ethernet: { "100g-1": { trunk_vlans: ["netflix-internet"] } },
                vlan_interface: {
                    "netflix-internet": {
                        vlan: "netflix-internet",
                        description: "Tenant netflix",
                        addresses: ["198.51.100.9/29", "2001:db8:100:1::1/64"],
                    },
                },
            },
        }),
        "tor-01": part("device", {
            switching: { vlans },
            interfaces: {
                ethernet: {
                    "40g-1": { trunk_vlans: ["netflix-internet"] },
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
