// An example tenant. Copy this file for each new tenant, and add it to index.ts.

import type { Tenant } from "../tenancy";

export default {
    name: "acme",
    internet: {
        vlan: { name: "acme-internet", id: 1001, description: "Tenant acme internet" },
        gateways: ["198.51.100.9/29", "2001:db8:100:1::1/64"],
    },
    private: { vlan: { name: "acme-private", id: 2001, description: "Tenant acme private" } },
    acl: [{ description: "UDP to acme above 1G", match: { protocol: "udp" }, action: "accept", rate: "1G" }],
    ports: {
        "tor-01": {
            "10g-1": { description: "acme server 1", trunk_vlans: ["acme-internet", "acme-private"] },
            "10g-2": { description: "acme server 2", trunk_vlans: ["acme-internet", "acme-private"] },
        },
    },
} satisfies Tenant;
