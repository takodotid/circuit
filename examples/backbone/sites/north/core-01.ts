// The north region's core router, a Juniper QFX5100. The region is member AS 65001: its routers run iBGP with each other, and core-01 runs eBGP with the south region's core-02. Hurricane Electric sees AS64500, the confederation.

import { as64500 } from "../../circuit";

export default as64500.device({
    name: "core-01",
    site: "north",
    role: "Core router",
    platform: "junos",
    model: "QFX5100-48S-6Q",
    connection: { host: "10.0.1.1", user: "netops" },

    system: {
        // Junos refuses a config without a root password.
        users: {
            root: { role: "admin", password: secret("CORE_01_ROOT_PASSWORD") },
            netops: { role: "admin", password: secret("CORE_01_PASSWORD") },
        },
    },
    management: { allow: ["10.0.0.0/16"], ssh: {} },

    interfaces: {
        ethernet: {
            "1g-1": { description: "Management", addresses: ["10.0.1.1/24"] },
            "40g-1": { description: "core-02 port1", addresses: ["10.0.12.1/30"], link: { device: "core-02", port: "40g-1" } },
            "10g-1": { description: "Hurricane Electric", addresses: ["203.0.113.2/30"] },
        },
        loopback: { loopback: { addresses: ["10.255.1.1/32"] } },
    },

    routing: {
        router_id: "10.255.1.1",
        static_routes: [{ prefix: as64500.prefixes.ours.v4, blackhole: true }],
        bgp: {
            // This router's member AS.
            asn: 65001,
            confederation: { identifier: 64500, member_as: [65002] },
            originated_prefixes: [as64500.prefixes.ours.v4],
            neighbors: {
                // Another member AS, so the router shows it AS65001.
                "core-02": { address: "10.0.12.2", remote_as: 65002, import_policy: "backbone", export_policy: "backbone" },
                // A router of the north region, in the same member AS: iBGP.
                "edge-11": {
                    address: "10.255.1.11",
                    remote_as: 65001,
                    local_address: "10.255.1.1",
                    import_policy: "backbone",
                    export_policy: "backbone",
                },
                // Outside the confederation, so the router shows it AS64500.
                "hurricane-electric": {
                    address: "203.0.113.1",
                    remote_as: 6939,
                    description: "Hurricane Electric, IP transit",
                    import_policy: "transit-import",
                    export_policy: "transit-export",
                },
            },
        },
        prefix_sets: {
            "ours-v4": { prefixes: [as64500.prefixes.ours.v4] },
            "bogons-v4": { prefixes: presets.bogons.ipv4 },
        },
        policies: {
            sanity: presets.bgp_sanity,
            // Inside the confederation, every route goes everywhere.
            backbone: [{ then: "accept" }],
            "transit-import": [
                { call: "sanity" },
                { description: "Bogons", if: { prefix_set: "bogons-v4" }, then: "reject" },
                { if: { prefix_set: "ours-v4" }, then: "reject" },
                { then: "accept" },
            ],
            "transit-export": [
                { description: "Our own space", if: { prefix_set: "ours-v4" }, then: "accept" },
                { description: "Nothing else leaves", then: "reject" },
            ],
        },
    },
});
