// The first top-of-rack switch at site A: customers' servers, with an uplink to each core switch. Spanning tree blocks one of the two.

import { defineDevice, Utils } from "@takodotid/circuit";
import { AT } from "../customers";
import { INFRA_VLANS } from "../network";
import * as switches from "../switches";
import { customerPorts, customerVlans, privateVlans } from "../tenancy";

const HOST = { stp: { edge: true }, storm_control: { broadcast: { percent: 1 }, unknown_unicast: { percent: 5 } } };

export default defineDevice({
    name: "tor-a1",
    platform: "vrp",
    model: "CE6855-48S6Q-HI",
    connection: { host: "10.0.99.6", user: "operator" },
    users: switches.users,
    system: switches.system,
    management: switches.vrpManagement("Site A, rack 3"),

    stp: {},
    lldp: true,

    vlans: Utils.merge({ mgmt: INFRA_VLANS.mgmt }, customerVlans(AT.a), privateVlans(AT.a, "tor-a1")),

    // Every customer's ports, from customers.ts, beside the switch's own.
    ports: Utils.merge(customerPorts(AT.a, "tor-a1", HOST), {
        "40g-1": { description: "core-a1", trunk_vlans: switches.SITE_A_TOR, link: { device: "core-a1", port: "40g-2" } },
        "40g-2": { description: "core-a2", trunk_vlans: switches.SITE_A_TOR, link: { device: "core-a2", port: "40g-2" } },
    }),

    interfaces: { mgmt: { type: "vlan", vlan: "mgmt", addresses: ["10.0.99.6/24"] } },
    routing: { static: [{ prefix: "0.0.0.0/0", via: "10.0.99.1" }] },

    flow_export: { protocol: "sflow", collectors: [{ address: "10.0.20.40" }], sampling: 4096 },
});
