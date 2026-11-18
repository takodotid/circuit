// The second edge router, a Juniper QFX5100 at AMS-IX: peering only, through the exchange's route servers and with Hurricane Electric.
// The addresses are documentation ranges, so use the ones the exchange gives you.

import { as64500 } from "../../circuit";

export default as64500.device({
    name: "edge-02",
    site: "pop-2",
    role: "Edge router",
    platform: "junos",
    model: "QFX5100-48S-6Q",
    connection: { host: "10.0.1.1", user: "netops" },

    system: {
        timezone: "Europe/Amsterdam",
        ntp: { servers: ["10.0.1.254"] },
        // Junos refuses a config without a root password.
        users: {
            root: { role: "admin", password: secret("EDGE_02_ROOT_PASSWORD") },
            netops: { role: "admin", password: secret("EDGE_02_PASSWORD") },
        },
    },
    management: { allow: ["10.0.0.0/16"], ssh: {} },

    interfaces: {
        ethernet: {
            "1g-1": { description: "Management", addresses: ["10.0.1.1/24"] },
            "10g-1": { description: "AMS-IX", addresses: ["203.0.113.130/25", "2001:db8:fffe::130/64"] },
        },
    },

    routing: {
        router_id: "203.0.113.130",
        static_routes: [
            { prefix: as64500.prefixes.ours.v4, blackhole: true },
            { prefix: as64500.prefixes.ours.v6, blackhole: true },
        ],
        bgp: {
            originated_prefixes: [as64500.prefixes.ours.v4, as64500.prefixes.ours.v6],
            // Junos turns graceful restart on for every session at once, so each neighbor has it.
            neighbors: {
                // #region prefix-limits
                // A leak at the exchange closes the session, and it opens again after 30 minutes without anyone clearing it.
                "ams-ix-rs-v4": {
                    address: "203.0.113.250",
                    remote_as: 6777,
                    description: "AMS-IX route server",
                    max_prefixes: { limit: 150_000, restart_after: 1800 },
                    graceful_restart: true,
                    import_policy: "exchange-import",
                    export_policy: "export",
                    communities: { groups: ["exchange"] },
                },
                "ams-ix-rs-v6": {
                    address: "2001:db8:fffe::250",
                    remote_as: 6777,
                    description: "AMS-IX route server",
                    max_prefixes: { limit: 50_000, restart_after: 1800 },
                    graceful_restart: true,
                    import_policy: "exchange-import",
                    export_policy: "export",
                    communities: { groups: ["exchange"] },
                },
                // Hurricane Electric's table grows every month. Past the limit, the router only logs a message.
                "hurricane-electric": {
                    address: "203.0.113.140",
                    remote_as: 6939,
                    description: "Hurricane Electric, peering at AMS-IX",
                    max_prefixes: { limit: 250_000, warn_only: true },
                    graceful_restart: true,
                    import_policy: "exchange-import",
                    export_policy: "export",
                    communities: { groups: ["exchange"] },
                },
                // #endregion prefix-limits
            },
        },
        prefix_sets: {
            // A Junos policy rule takes its family from the set, so each family has its own.
            "ours-v4": { prefixes: [as64500.prefixes.ours.v4] },
            "ours-v6": { prefixes: [as64500.prefixes.ours.v6] },
            "bogons-v4": { prefixes: presets.bogons.ipv4 },
            "bogons-v6": { prefixes: presets.bogons.ipv6 },
        },
        policies: {
            sanity: presets.bgp_sanity,
            // Two ASes use it, so the communities rule comes first and runs per AS.
            "exchange-import": [
                { communities: "import" },
                { call: "sanity" },
                { description: "Bogons", if: { prefix_set: "bogons-v4" }, then: "reject" },
                { description: "Bogons", if: { prefix_set: "bogons-v6" }, then: "reject" },
                { if: { prefix_set: "ours-v4" }, then: "reject" },
                { if: { prefix_set: "ours-v6" }, then: "reject" },
                { set: { local_pref: 200 }, then: "accept" },
            ],
            export: [
                { communities: "export" },
                { description: "Our own space", if: { prefix_set: "ours-v4" }, then: "accept" },
                { description: "Our own space", if: { prefix_set: "ours-v6" }, then: "accept" },
                { description: "Nothing else leaves", then: "reject" },
            ],
        },
    },
});
