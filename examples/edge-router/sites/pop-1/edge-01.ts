// The edge router: BGP with an IP transit and an internet exchange, filtered on the way in and on the way out.
// transit-a and exchange-a stand for your own transit and exchange. The addresses are documentation ranges: use the ones your providers give you.

import { as64500 } from "../../circuit";

export default as64500.device({
    name: "edge-01",
    site: "pop-1",
    role: "Edge router",
    platform: "routeros",
    model: "CCR2216-1G-12XS-2XQ",
    connection: { host: "10.0.0.1", user: "operator" },

    system: {
        timezone: "Asia/Jakarta",
        ntp: { servers: ["pool.ntp.org"] },
        users: { operator: { role: "admin", password: secret("EDGE_01_PASSWORD") } },
    },
    management: { allow: ["10.0.0.0/24"], ssh: {} },

    interfaces: {
        ethernet: {
            "1g-1": { description: "Management", addresses: ["10.0.0.1/24"] },
            "25g-1": { description: "transit-a", access_vlan: "transit", ingress_acl: "edge" },
            "25g-2": { description: "exchange-a", access_vlan: "exchange", ingress_acl: "edge" },
        },
        vlan_interface: {
            transit: { vlan: "transit", addresses: ["203.0.113.2/30"] },
            exchange: { vlan: "exchange", addresses: ["192.0.2.10/24", "2001:db8:ffff::10/64"] },
        },
    },
    switching: {
        vlans: {
            transit: { id: 300, description: "IP transit from transit-a, AS64501", untrusted: true },
            exchange: { id: 200, description: "Peering LAN of exchange-a", untrusted: true },
        },
        // In the switch chip, before a packet reaches the router's CPU: nothing from outside may claim our addresses or private ones.
        acls: {
            edge: [
                { description: "Our own space", if: { vlan: ["transit", "exchange"], src: as64500.prefixes.ours.v4 }, then: "drop" },
                { description: "Private ranges", if: { vlan: ["transit", "exchange"], src: presets.rfc1918 }, then: "drop" },
            ],
        },
    },

    routing: {
        router_id: "203.0.113.2",
        // A route for each block we announce, so it is in the table even when nothing inside it is up.
        static_routes: [
            { prefix: as64500.prefixes.ours.v4, blackhole: true, description: "Originate" },
            { prefix: as64500.prefixes.ours.v6, blackhole: true, description: "Originate" },
        ],
        bgp: {
            originated_prefixes: [as64500.prefixes.ours.v4, as64500.prefixes.ours.v6],
            neighbors: {
                "transit-a": {
                    address: "203.0.113.1",
                    remote_as: 64501,
                    description: "transit-a",
                    role: "provider",
                    max_prefixes: 1_200_000,
                    import_policy: "transit-import",
                    export_policy: "export",
                    communities: { groups: ["transit"] },
                },
                "exchange-a-rs-v4": {
                    address: "192.0.2.1",
                    remote_as: 64502,
                    description: "exchange-a route server",
                    role: "rs",
                    max_prefixes: 100_000,
                    import_policy: "exchange-import",
                    export_policy: "export",
                    communities: { groups: ["exchange"] },
                },
                "exchange-a-rs-v6": {
                    address: "2001:db8:ffff::1",
                    remote_as: 64502,
                    description: "exchange-a route server",
                    role: "rs",
                    max_prefixes: 50_000,
                    import_policy: "exchange-import",
                    export_policy: "export",
                    communities: { groups: ["exchange"] },
                },
            },
        },
        prefix_sets: {
            ours: { prefixes: as64500.prefixes.ours },
        },
        policies: {
            sanity: presets.bgp_sanity,
            // A route from the exchange beats the same route from the transit: the higher local preference wins.
            "transit-import": [
                { call: "sanity" },
                { if: { prefix_set: "ours" }, then: "reject" },
                { communities: "import" },
                { set: { local_pref: 100 }, then: "accept" },
            ],
            "exchange-import": [
                { call: "sanity" },
                { if: { prefix_set: "ours" }, then: "reject" },
                { communities: "import" },
                { set: { local_pref: 200 }, then: "accept" },
            ],
            export: [
                { communities: "export" },
                { description: "Our own space", if: { prefix_set: "ours" }, then: "accept" },
                { description: "Nothing else leaves", then: "reject" },
            ],
        },
    },

    firewall: {
        address_sets: {
            management: ["10.0.0.0/24"],
            "bgp-neighbors": bgpNeighbors(),
        },
        filter: {
            input: {
                default_action: "drop",
                rules: [
                    { description: "Replies", if: { connection_state: ["established", "related"] }, then: "accept" },
                    { description: "Ping", if: { protocol: "icmp" }, then: "accept" },
                    { description: "Management", if: { src_address_set: "management" }, then: "accept" },
                    {
                        description: "BGP",
                        if: { src_address_set: "bgp-neighbors", protocol: "tcp", dst_port: presets.ports.bgp },
                        then: "accept",
                    },
                ],
            },
            forward: {
                rules: presets.bad_tcp_flags,
            },
        },
    },
});
