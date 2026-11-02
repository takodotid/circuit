// The network: one site, a home or a small office, with a router and a switch. Circuit reads this file first, then every device file under sites/.

import { managementStaysOnTrunks } from "./lib/checks";

export const as64500 = circuit({
    asn: 64500,
    sites: {
        home: { description: "A home or a small office: one router and one switch." },
    },
    checks: {
        same_vlan_ids: true,
        management_stays_on_trunks: managementStaysOnTrunks,
    },
});
