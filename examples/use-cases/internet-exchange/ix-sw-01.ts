// The first fabric switch: members, the route servers, and the way in for management. The switches have no address on the peering LAN; they only carry it.

import { defineDevice, merge, secret } from "@takodotid/circuit";
import { exchange, MANAGEMENT, vlans } from "./exchange";

export default defineDevice({
    name: "ix-sw-01",
    platform: "vrp",
    model: "CE6855-48S6Q-HI",
    connection: { host: "10.0.0.2", user: "operator" },
    users: { operator: { role: "admin", password: secret("IX_SW_01_PASSWORD") } },

    system: { timezone: "Asia/Singapore", ntp: { servers: ["10.0.0.1"] } },
    management: { allow: [MANAGEMENT], ssh: {} },

    lldp: true,
    stp: {},
    vlans,

    // Every member's port on this switch, from its file in members/, beside the exchange's own.
    ports: merge(exchange.ports("ix-sw-01"), {
        "10g-47": { description: "Route server rs1", access_vlan: "peering", stp: false },
        "10g-48": { description: "Route server rs2", access_vlan: "peering", stp: false },
        "40g-5": {
            description: "ix-sw-02",
            trunk_vlans: ["peering", "mgmt"],
            link: { device: "ix-sw-02", port: "40g-5" },
        },
        "40g-6": { description: "Management network", access_vlan: "mgmt" },
    }),

    interfaces: { mgmt: { type: "vlan", vlan: "mgmt", addresses: ["10.0.0.2/24"] } },
    routing: { static: [{ prefix: "0.0.0.0/0", via: "10.0.0.1" }] },
});
