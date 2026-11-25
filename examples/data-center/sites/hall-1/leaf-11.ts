// The leaf switch of hall 1's first row, a Huawei CloudEngine, on level 1 of hall 1's area only. It is the gateway of the row's servers, whose VLAN IS-IS announces without a neighbor there.

import { dc } from "../../circuit";

export default dc.device({
    name: "leaf-11",
    site: "hall-1",
    role: "Leaf switch",
    platform: "vrp",
    model: "CE6855-48S6Q-HI",
    connection: { host: "10.0.0.21", user: "operator" },

    system: {
        users: { operator: { role: "admin", password: secret("LEAF_11_PASSWORD") } },
    },
    management: { allow: ["10.0.0.0/24"], ssh: {} },

    interfaces: {
        ethernet: {
            "40g-1": { description: "spine-11 40GE1/0/1", access_vlan: "row-1-link", link: { device: "spine-11", port: "40g-1" } },
            "10g-1": { description: "Rack 1, server 1", access_vlan: "servers" },
            "10g-2": { description: "Rack 1, server 2", access_vlan: "servers" },
            "10g-48": { description: "Management", access_vlan: "mgmt" },
        },
        vlan_interface: {
            mgmt: { vlan: "mgmt", addresses: ["10.0.0.21/24"] },
            "spine-11": { vlan: "row-1-link", addresses: ["10.1.0.2/30", "2001:db8:1::2/64"] },
            servers: { vlan: "servers", addresses: ["10.1.1.1/24", "2001:db8:1:1::1/64"] },
        },
    },
    switching: {
        vlans: {
            mgmt: { id: 10, description: "Management" },
            "row-1-link": { id: 101, description: "The link between spine-11 and leaf-11" },
            servers: { id: 111, description: "Row 1's servers" },
        },
    },

    routing: {
        bfd: { interval: 100, multiplier: 3 },
        isis: {
            net: "49.0001.0100.0000.0021.00",
            level_capability: "level-1",
            address_families: ["ipv4", "ipv6"],
            multi_topology: true,
            // The device runs level 1 only, so its one key is hall 1's.
            authentication: { algorithm: "hmac-sha-256", key_id: 1, key: secret("ISIS_HALL_1_KEY") },
            interfaces: {
                "spine-11": { metric: 10, bfd: true },
                servers: { passive: true },
            },
        },
    },
});
