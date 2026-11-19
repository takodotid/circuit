// The south region's core router, a FortiGate 3700D. The region is member AS 65002: its routers run iBGP with each other, and core-02 runs eBGP with the north region's core-01. Cogent sees AS64500, the confederation.

import { as64500 } from "../../circuit";

export default as64500.device({
    name: "core-02",
    site: "south",
    role: "Core router",
    platform: "fortios",
    model: "FG-3700D",
    connection: { host: "10.0.2.1", user: "netops" },

    system: {
        users: {
            netops: { role: "admin", password: secret("CORE_02_PASSWORD") },
        },
    },
    management: { allow: ["10.0.0.0/16"], ssh: {} },

    interfaces: {
        ethernet: {
            "1g-1": { description: "Management", addresses: ["10.0.2.1/24"] },
            "40g-1": { description: "core-01 et-0/0/48", addresses: ["10.0.12.2/30"], link: { device: "core-01", port: "40g-1" } },
            "10g-1": { description: "Cogent", addresses: ["203.0.113.6/30"] },
        },
        loopback: { loopback: { addresses: ["10.255.2.1/32"] } },
    },

    routing: {
        router_id: "10.255.2.1",
        static_routes: [{ prefix: as64500.prefixes.ours.v4, blackhole: true }],
        isis: {
            net: "49.0001.0102.5500.2001.00",
            level_capability: "level-1-2",
            address_families: ["ipv4"],
            // A key per level. Both are core-01's key, since the point-to-point link to it sends one hello for both levels.
            levels: {
                1: { authentication: { key: secret("ISIS_KEY") } },
                2: { authentication: { key: secret("ISIS_KEY") } },
            },
            interfaces: {
                // FortiOS has no passive interface, and a loopback forms no adjacency anyway.
                loopback: {},
                "40g-1": { network: "point-to-point", metric: 100 },
            },
        },
        bgp: {
            // This router's member AS.
            asn: 65002,
            confederation: { identifier: 64500, member_as: [65001] },
            originated_prefixes: [as64500.prefixes.ours.v4],
            neighbors: {
                "core-01": { address: "10.0.12.1", remote_as: 65001, import_policy: "backbone", export_policy: "backbone" },
                "edge-21": {
                    address: "10.255.2.21",
                    remote_as: 65002,
                    local_address: "10.255.2.1",
                    import_policy: "backbone",
                    export_policy: "backbone",
                },
                cogent: {
                    address: "203.0.113.5",
                    remote_as: 174,
                    description: "Cogent, IP transit",
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
            backbone: [{ then: "accept" }],
            // FortiOS has no RPKI, so no presets.bgp_sanity here.
            "transit-import": [
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
