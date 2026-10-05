// An example tenant. Copy this file for each new tenant, and add it to index.ts.

import { tenant } from "../tenancy";

export default tenant({
    name: "acme",
    number: 1,
    blocks: [
        { prefix: "198.51.100.8/29", gateway: "198.51.100.9" },
        { prefix: "2001:db8:100:1::/64", gateway: "2001:db8:100:1::1" },
    ],
    acl: [{ description: "UDP to acme above 1G", match: { protocol: "udp" }, action: "accept", rate: "1G" }],
    ports: {
        "tor-01": {
            "10g-1": { description: "acme server 1", trunk: ["internet", "private"] },
            "10g-2": { description: "acme server 2", trunk: ["internet", "private"] },
        },
    },
});
