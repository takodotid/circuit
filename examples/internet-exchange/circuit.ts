// The exchange, AS64500: two fabric switches that carry one peering LAN between the members and the route servers.

import { membersDescribed } from "./lib/checks";

export const as64500 = circuit({
    asn: 64500,
    prefixes: {
        peering_lan: { v4: "203.0.113.0/24", v6: "2001:db8:ffff::/64" },
    },
    sites: {
        "ix-1": { description: "The exchange's one site: two switches, two route servers." },
    },
    checks: {
        same_vlan_ids: true,
        members_described: membersDescribed,
    },
});
