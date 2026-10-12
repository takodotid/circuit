// The third top-of-rack switch at site A, on another platform: customers' servers on 25G, and two cables bundled to each core switch.

import { defineDevice, merge } from "@takodotid/circuit";
import { AT } from "./customers";
import { INFRA_VLANS } from "./network";
import * as switches from "./switches";
import { customerPorts, customerVlans, privateVlans } from "./tenancy";

// The platform limits flooding in packets per second, and only broadcast.
const HOST = { storm_control: { broadcast: { pps: 2000 } } };

export default defineDevice({
    name: "tor-a3",
    platform: "raisecom-ros",
    model: "RAX721-C-6C48",
    connection: { host: "10.0.99.8", user: "operator" },
    users: switches.users,
    system: { ...switches.system, transceiver_monitoring: true },
    management: switches.raisecomManagement,

    stp: { mode: "mstp", priority: 32768 },
    lldp: true,

    vlans: switches.undescribed(merge({ mgmt: INFRA_VLANS.mgmt }, customerVlans(AT.a), privateVlans(AT.a, "tor-a3"))),

    ports: merge(customerPorts(AT.a, "tor-a3", HOST), {
        "10g-21": { description: "core-a2, first cable", lag: "core-a2", link: { device: "core-a2", port: "10g-47" } },
        "10g-22": { description: "core-a2, second cable", lag: "core-a2", link: { device: "core-a2", port: "10g-48" } },
        "10g-23": { description: "core-a1, first cable", lag: "core-a1", link: { device: "core-a1", port: "10g-47" } },
        "10g-24": { description: "core-a1, second cable", lag: "core-a1", link: { device: "core-a1", port: "10g-48" } },
    }),

    interfaces: {
        "core-a1": { type: "lag", description: "core-a1", mode: "lacp", trunk_vlans: switches.SITE_A_TOR },
        "core-a2": { type: "lag", description: "core-a2", mode: "lacp", trunk_vlans: switches.SITE_A_TOR },
        mgmt: { type: "vlan", vlan: "mgmt", addresses: ["10.0.99.8/24"] },
    },
    routing: { static: [{ prefix: "0.0.0.0/0", via: "10.0.99.1" }] },
});
