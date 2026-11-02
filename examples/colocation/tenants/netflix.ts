// Tenant acme: its VLANs, its gateway on the router, its servers' ports on the switch, and a cap on UDP toward it.
// Copy this file for a new tenant, and add it to index.ts.

const vlans = literal({
    "acme-internet": { id: 1001, description: "Tenant acme internet" },
    "acme-private": { id: 2001, description: "Tenant acme private" },
});

export const acme = {
    parts: {
        "edge-01": part("device", {
            switching: { vlans: { "acme-internet": vlans["acme-internet"] } },
            interfaces: {
                ethernet: { "100g-1": { trunk_vlans: ["acme-internet"] } },
                vlan_interface: {
                    "acme-internet": {
                        vlan: "acme-internet",
                        description: "Tenant acme",
                        addresses: ["198.51.100.9/29", "2001:db8:100:1::1/64"],
                    },
                },
            },
        }),
        "tor-01": part("device", {
            switching: { vlans },
            interfaces: {
                ethernet: {
                    "40g-1": { trunk_vlans: ["acme-internet"] },
                    "10g-1": { description: "acme server 1", trunk_vlans: ["acme-internet", "acme-private"] },
                    "10g-2": { description: "acme server 2", trunk_vlans: ["acme-internet", "acme-private"] },
                },
            },
        }),
    },
    rules: {
        edge_acl: part("acl", [
            {
                description: "acme: UDP above 1G",
                if: { vlan: ["transit", "exchange"], protocol: "udp", dst: "198.51.100.8/29" },
                then: "accept",
                rate: "1G",
            },
        ]),
    },
};
