// The top-of-rack switch: the tenants' servers, and one uplink to the router.

import { defineDevice, merge, secret } from "@takodotid/circuit";
import { internetVlanNames, internetVlans, portsOn, privateVlans } from "./tenancy";
import { TENANTS } from "./tenants";

export default defineDevice({
    name: "tor-01",
    platform: "vrp",
    model: "CE6855-48S6Q-HI",
    connection: { host: "10.0.99.2", user: "operator" },
    users: { operator: { role: "admin", password: secret("TOR_01_PASSWORD") } },

    system: { timezone: "Asia/Jakarta", ntp: { servers: ["10.0.99.1"] } },
    management: { allow: ["10.0.0.0/24"], ssh: {} },

    lldp: true,
    stp: {},

    vlans: merge({ mgmt: { id: 99, description: "Management" } }, internetVlans(TENANTS), privateVlans(TENANTS, "tor-01")),

    // Every tenant's ports, from its file in tenants/, beside the switch's own.
    ports: merge(portsOn(TENANTS, "tor-01"), {
        "40g-1": {
            description: "edge-01",
            trunk_vlans: ["mgmt", ...internetVlanNames(TENANTS)],
            link: { device: "edge-01", port: "100g-1" },
        },
    }),

    interfaces: { mgmt: { type: "vlan", vlan: "mgmt", addresses: ["10.0.99.2/24"] } },
    routing: { static: [{ prefix: "0.0.0.0/0", via: "10.0.99.1" }] },
});
