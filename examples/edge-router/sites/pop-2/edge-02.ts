// The second edge router, a Juniper switch that routes. It takes only a default route from its transit and sells transit to a customer with its own AS.
// The addresses are documentation ranges, so use the ones your providers give you.

import { as64500 } from "../../circuit";

export default as64500.device({
    name: "edge-02",
    site: "pop-2",
    role: "Edge router",
    platform: "junos",
    model: "QFX5100-48S-6Q",
    connection: { host: "10.0.1.1", user: "netops" },

    system: {
        timezone: "Asia/Jakarta",
        // Junos filters NTP by address, so the server is written as one.
        ntp: { servers: ["10.0.1.123"] },
        users: {
            root: { role: "admin", password: secret("EDGE_02_ROOT_PASSWORD") },
            netops: { role: "admin", password: secret("EDGE_02_PASSWORD") },
        },
    },
    management: { allow: ["10.0.1.0/24"], ssh: {} },

    interfaces: {
        ethernet: {
            "1g-1": { description: "Management", addresses: ["10.0.1.1/24"] },
            "10g-1": { description: "Hurricane Electric", addresses: ["203.0.113.6/30"] },
            "10g-2": { description: "AS64501", addresses: ["198.51.100.129/30"] },
        },
    },

    routing: {
        router_id: "203.0.113.6",
        bgp: {
            neighbors: {
                "hurricane-electric": {
                    address: "203.0.113.5",
                    remote_as: 6939,
                    description: "Hurricane Electric",
                    import_policy: "transit-import",
                    export_policy: "export",
                },
                as64501: {
                    address: "198.51.100.130",
                    remote_as: 64501,
                    description: "AS64501, a transit customer",
                    max_prefixes: 10,
                    import_policy: "customer-import",
                    // All it takes from us. Without an export_policy, no other route goes to it.
                    send_default_route: true,
                },
            },
        },
        prefix_sets: {
            ours: { prefixes: [as64500.prefixes.ours.v4] },
            as64501: { prefixes: ["198.51.100.192/26"] },
        },
        policies: {
            "transit-import": [
                { description: "Only the default route", if: { prefix: presets.default_routes.ipv4 }, then: "accept" },
                { then: "reject" },
            ],
            "customer-import": [{ description: "The block we gave it", if: { prefix_set: "as64501" }, then: "accept" }, { then: "reject" }],
            export: [
                { description: "Our own space", if: { prefix_set: "ours" }, then: "accept" },
                { description: "Nothing else leaves", then: "reject" },
            ],
        },
    },
});
