// The aggregation switch at site B: edge-b1's way down, the office, customers' servers, and tor-b1 below it.

import { defineDevice, Utils } from "@takodotid/circuit";
import { AT } from "../customers";
import { INFRA_VLANS } from "../network";
import * as switches from "../switches";
import { customerPorts, customerVlans, privateVlans } from "../tenancy";

const HOST = { storm_control: { broadcast: { pps: 2000 } } };

/** An office desk port. */
const desk = (description: string) => ({ ...HOST, description, access_vlan: "office" });

export default defineDevice({
    name: "agg-b1",
    platform: "raisecom-ros",
    model: "RAX721-C-6C48",
    connection: { host: "10.1.99.2", user: "operator" },
    users: switches.users,
    system: { ...switches.system, transceiver_monitoring: true },
    management: switches.raisecomManagement,

    stp: { priority: 8192 },
    lldp: true,

    vlans: switches.undescribed(
        Utils.merge(
            INFRA_VLANS,
            { office: { id: 50, description: "The site B office" } },
            customerVlans(AT.b),
            privateVlans(AT.b, "agg-b1")
        )
    ),

    ports: Utils.merge(customerPorts(AT.b, "agg-b1", HOST), {
        "100g-1": { description: "edge-b1", trunk_vlans: switches.SITE_B, link: { device: "edge-b1", port: "100g-1" } },
        "100g-2": { description: "tor-b1", trunk_vlans: switches.SITE_B, link: { device: "tor-b1", port: "40g-1" } },
        "10g-1": desk("Office, printer"),
        "10g-2": desk("Office, phone system"),
        "10g-3": desk("Office, door controller"),
        "10g-4": { ...desk("Office, wireless access point"), stp: false },
    }),

    interfaces: {
        mgmt: { type: "vlan", vlan: "mgmt", addresses: ["10.1.99.2/24"] },
        infra: { type: "vlan", vlan: "infra", addresses: ["10.1.10.2/24"] },
    },

    routing: {
        router_id: "10.1.10.2",
        static: [{ prefix: "0.0.0.0/0", via: "10.1.99.1" }],
        ospf: {
            areas: {
                "0.0.0.1": { interfaces: { infra: { cost: 10 }, mgmt: { passive: true } } },
            },
        },
    },
});
