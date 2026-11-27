// Hall 1's spine switch, a Huawei CloudEngine, on both levels of hall 1's area, 49.0001: level 1 to the hall's leaf switches, and level 2 to hall 2's spine. Each level has its own key.

import { dc } from "../../circuit";

export default dc.device({
    name: "spine-11",
    site: "hall-1",
    role: "Spine switch",
    platform: "vrp",
    model: "CE6855-48S6Q-HI",
    connection: { host: "10.0.0.11", user: "operator" },

    system: {
        users: { operator: { role: "admin", password: secret("SPINE_11_PASSWORD") } },
    },
    management: { allow: ["10.0.0.0/24"], ssh: {} },

    // Each link to another switch is a routed port. Management is a VLAN, as the hall's other devices are on it too.
    interfaces: {
        ethernet: {
            "40g-1": {
                description: "leaf-11 40GE1/0/1",
                addresses: ["10.1.0.1/30", "2001:db8:1::1/64"],
                link: { device: "leaf-11", port: "40g-1" },
            },
            "40g-2": { description: "spine-21 40GE1/0/2, in hall 2", addresses: ["10.255.0.1/30", "2001:db8:ff::1/64"] },
            "10g-48": { description: "Management", access_vlan: "mgmt" },
        },
        vlan_interface: {
            mgmt: { vlan: "mgmt", addresses: ["10.0.0.11/24"] },
        },
    },
    switching: {
        vlans: {
            mgmt: { id: 10, description: "Management" },
        },
        // The switch routes a port on a VLAN of its own, one of these for each routed port. No VLAN above may be in the range.
        reserved_vlans: { min: 4000, max: 4063 },
    },

    routing: {
        bfd: { interval: 100, multiplier: 3 },
        prefix_sets: { "hall-2": { prefixes: ["10.2.0.0/16", "2001:db8:2::/48"] } },
        policies: {
            "hall-2": [{ description: "Hall 2's networks", if: { prefix_set: "hall-2" }, then: "accept" }, { then: "reject" }],
        },
        isis: {
            net: "49.0001.0100.0000.0011.00",
            level_capability: "level-1-2",
            address_families: ["ipv4", "ipv6"],
            multi_topology: true,
            levels: {
                1: { authentication: { algorithm: "hmac-sha-256", key_id: 1, key: secret("ISIS_HALL_1_KEY") } },
                2: { authentication: { algorithm: "hmac-sha-256", key_id: 2, key: secret("ISIS_SPINE_KEY") } },
            },
            // Broadcast links: VRP signs the one hello of a point-to-point link with one key, and each level here has its own.
            interfaces: {
                "40g-1": { metric: 10, bfd: true },
                "40g-2": { metric: 100, bfd: true },
            },
            // A leaf takes the nearest spine to hall 2, not the default route to any spine.
            level2_to_level1: { import_policy: "hall-2" },
        },
    },
});
