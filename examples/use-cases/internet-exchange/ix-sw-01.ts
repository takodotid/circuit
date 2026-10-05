// The exchange's fabric: one switch, the peering LAN on every member port and on the route servers. The switch has no address on the peering LAN; it only carries it.

import { defineDevice, merge, secret } from "@takodotid/circuit";
import { exchange } from "./exchange";

export default defineDevice({
    name: "ix-sw-01",
    platform: "vrp",
    model: "CE6855-48S6Q-HI",
    connection: { host: "10.0.0.2", user: "operator" },
    users: { operator: { role: "admin", password: secret("IX_SW_01_PASSWORD") } },

    system: { timezone: "Asia/Jakarta", ntp: { servers: ["10.0.0.1"] } },
    management: { allow: ["10.0.0.0/24"], ssh: {} },

    lldp: true,
    stp: {},

    vlans: {
        mgmt: { id: 10, description: "Management, never on a member port" },
        peering: { id: 100, description: "Peering LAN" },
    },

    // Every member's port, from its file in members/, beside the exchange's own.
    ports: merge(exchange.ports("ix-sw-01"), {
        "10g-47": { description: "Route server rs1", access_vlan: "peering", stp: false },
        "10g-48": { description: "Route server rs2", access_vlan: "peering", stp: false },
        "40g-6": { description: "Management network", access_vlan: "mgmt" },
    }),

    interfaces: { mgmt: { type: "vlan", vlan: "mgmt", addresses: ["10.0.0.2/24"] } },
    routing: { static: [{ prefix: "0.0.0.0/0", via: "10.0.0.1" }] },
});
