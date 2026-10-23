// The top-of-rack switch at site B, below agg-b1: customers' servers and the office's desks.

import { defineDevice, Utils } from "@takodotid/circuit";
import { AT } from "../customers";
import { INFRA_VLANS, SERVICES } from "../network";
import * as switches from "../switches";
import { customerPorts, customerVlans, privateVlans } from "../tenancy";

const HOST = { stp: { edge: true }, storm_control: { broadcast: { percent: 1 } } };

export default defineDevice({
    name: "tor-b1",
    platform: "vrp",
    model: "CE6855-48S6Q-HI",
    connection: { host: "10.1.99.3", user: "operator" },
    users: switches.users,
    system: switches.system,
    management: switches.vrpManagement("Site B, rack 2"),

    stp: { mode: "rstp" },
    lldp: true,

    vlans: Utils.merge(
        INFRA_VLANS,
        { office: { id: 50, description: "The site B office" } },
        customerVlans(AT.b),
        privateVlans(AT.b, "tor-b1")
    ),

    ports: Utils.merge(customerPorts(AT.b, "tor-b1", HOST), {
        "40g-1": { description: "agg-b1", trunk_vlans: switches.SITE_B, link: { device: "agg-b1", port: "100g-2" } },
        ...Object.fromEntries(
            [1, 2, 3, 4, 5, 6].map((n) => [`10g-${40 + n}`, { ...HOST, description: `Office, desk ${n}`, access_vlan: "office" }])
        ),
    }),

    interfaces: {
        mgmt: { type: "vlan", vlan: "mgmt", addresses: ["10.1.99.3/24"] },
        infra: { type: "vlan", vlan: "infra", addresses: ["10.1.10.3/24"] },
    },

    routing: {
        router_id: "10.1.10.3",
        static: [{ prefix: "0.0.0.0/0", via: "10.1.99.1" }],
        ospf: {
            areas: {
                "0.0.0.1": { interfaces: { infra: { cost: 10, bfd: true }, mgmt: { passive: true } } },
            },
        },
    },

    flow_export: { protocol: "sflow", collectors: [{ address: SERVICES.flows }], sampling: 4096, interfaces: ["40g-1"] },
});
