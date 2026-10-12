// The second top-of-rack switch at site A: customers' servers, some with a private network between them, and an uplink to each core switch.

import { defineDevice, merge } from "@takodotid/circuit";
import { AT } from "./customers";
import { INFRA_VLANS } from "./network";
import * as switches from "./switches";
import { customerPorts, customerVlans, privateVlans } from "./tenancy";

const HOST = { stp: { edge: true }, storm_control: { broadcast: { percent: 1 } } };

export default defineDevice({
    name: "tor-a2",
    platform: "vrp",
    model: "CE6855-48S6Q-HI",
    connection: { host: "10.0.99.7", user: "operator" },
    users: switches.users,
    system: switches.system,
    management: switches.vrpManagement("Site A, rack 4"),

    stp: {},
    lldp: true,

    vlans: merge({ mgmt: INFRA_VLANS.mgmt }, customerVlans(AT.a), privateVlans(AT.a, "tor-a2")),

    ports: merge(customerPorts(AT.a, "tor-a2", HOST), {
        "40g-1": { description: "core-a1", trunk_vlans: switches.SITE_A_TOR, link: { device: "core-a1", port: "40g-3" } },
        "40g-2": { description: "core-a2", trunk_vlans: switches.SITE_A_TOR, link: { device: "core-a2", port: "40g-3" } },
    }),

    interfaces: { mgmt: { type: "vlan", vlan: "mgmt", addresses: ["10.0.99.7/24"] } },
    routing: { static: [{ prefix: "0.0.0.0/0", via: "10.0.99.1" }] },
});
