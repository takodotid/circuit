// The second fabric switch: more members, reached through ix-sw-01. Management comes over the same trunk as the peering LAN.

import { defineDevice, merge, secret } from "@takodotid/circuit";
import { exchange, MANAGEMENT, vlans } from "./exchange";

export default defineDevice({
    name: "ix-sw-02",
    platform: "vrp",
    model: "CE6855-48S6Q-HI",
    connection: { host: "10.0.0.3", user: "operator" },
    users: { operator: { role: "admin", password: secret("IX_SW_02_PASSWORD") } },

    system: { timezone: "Asia/Singapore", ntp: { servers: ["10.0.0.1"] } },
    management: { allow: [MANAGEMENT], ssh: {} },

    lldp: true,
    stp: {},
    vlans,

    ports: merge(exchange.ports("ix-sw-02"), {
        "40g-5": {
            description: "ix-sw-01",
            trunk_vlans: ["peering", "mgmt"],
            link: { device: "ix-sw-01", port: "40g-5" },
        },
    }),

    interfaces: { mgmt: { type: "vlan", vlan: "mgmt", addresses: ["10.0.0.3/24"] } },
    routing: { static: [{ prefix: "0.0.0.0/0", via: "10.0.0.1" }] },
});
