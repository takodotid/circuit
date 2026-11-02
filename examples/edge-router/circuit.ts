// The network, AS64500: its own address space, its BGP communities, and the checks Circuit runs on it.

import { importsFiltered } from "./lib/checks";

export const as64500 = circuit({
    asn: 64500,
    prefixes: {
        ours: { v4: "198.51.100.0/24", v6: "2001:db8:100::/48" },
    },
    communities: {
        groups: { transit: { value: 1 }, exchange: { value: 2 } },
        learned_from_group: { code: 1 },
        learned_from_as: { code: 3 },
    },
    sites: {
        "pop-1": { description: "The point of presence: one router with an IP transit and an internet exchange." },
    },
    checks: {
        exports_end_in_reject: true,
        imports_end_in_accept_or_reject: true,
        untrusted_vlans: { filtering_devices: ["edge-01"] },
        imports_filtered: importsFiltered,
    },
});
