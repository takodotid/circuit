// The hub: one tunnel per member, and the route servers behind it. Members reach each other and the route servers only through here.

import { defineDevice, secret } from "@takodotid/circuit";
import { HUB, SPACE, tunnels } from "./exchange";
import { MEMBERS } from "./members";

export default defineDevice({
    name: "hub-01",
    platform: "routeros",
    model: "CCR2216-1G-12XS-2XQ",
    connection: { host: "10.0.0.1", user: "operator" },
    users: { operator: { role: "admin", password: secret("HUB_01_PASSWORD") } },
    management: { allow: ["10.0.0.0/24"], ssh: {} },

    ports: {
        "1g-1": { description: "Management", addresses: ["10.0.0.1/24"] },
        "25g-1": { description: "Internet", addresses: [`${HUB}/30`] },
        "25g-2": { description: "Route servers rs1 and rs2", addresses: ["10.254.0.1/24"] },
    },

    // Every member's tunnel, from its file in members/.
    interfaces: tunnels(MEMBERS),

    routing: { static: [{ prefix: "0.0.0.0/0", via: "198.51.100.1", description: "Internet" }] },

    firewall: {
        address_sets: { members: MEMBERS.map((m) => m.endpoint) },
        filter: {
            input: {
                default: "drop",
                rules: [
                    { description: "Replies", match: { state: ["established", "related"] }, action: "accept" },
                    { description: "Members' tunnels", match: { protocol: "gre", src_set: "members" }, action: "accept" },
                    { description: "Management", match: { src: "10.0.0.0/24" }, action: "accept" },
                ],
            },
            // Inside the exchange, members and route servers reach each other. Nothing else passes through the hub.
            forward: {
                default: "drop",
                rules: [{ description: "Inside the exchange", match: { src: SPACE, dst: SPACE }, action: "accept" }],
            },
        },
    },
});
