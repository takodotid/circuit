// The network, AS64500: a colocation site whose tenants each get their own VLANs, addresses and ports.

import { blocksApart } from "./lib/checks";

export const as64500 = circuit({
    asn: 64500,
    prefixes: {
        ours: { v4: "198.51.100.0/24", v6: "2001:db8:100::/48" },
    },
    communities: {
        groups: { transit: { value: 1 }, exchange: { value: 2 } },
        learned_from_group: { code: 1 },
    },
    sites: {
        "dc-1": { description: "The data centre: one router, and one top-of-rack switch for the tenants' servers." },
    },
    checks: {
        exports_end_in_reject: true,
        imports_end_in_accept_or_reject: true,
        same_vlan_ids: true,
        blocks_apart: blocksApart,
    },
});
