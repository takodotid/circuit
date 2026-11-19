// The second edge router, a Juniper QFX5100 at AMS-IX. It peers through the exchange's route servers and with Hurricane Electric, and sells transit to a customer with its own AS.
// The addresses are documentation ranges, so use the ones the exchange and the customer give you.

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
        // Each engineer logs in with their own name, which the TACACS+ servers check, and the servers keep each command they type. Circuit still logs in as netops, which the router checks itself.
        aaa: {
            tacacs: [
                { address: "10.0.0.21", secret_key: secret("TACACS_KEY"), source_address: "10.0.1.1" },
                { address: "10.0.0.22", secret_key: secret("TACACS_KEY"), source_address: "10.0.1.1" },
            ],
            remote_role: "operator",
            accounting_events: ["login", "command"],
        },
    },
    management: { allow: ["10.0.0.0/16"], ssh: {} },

    interfaces: {
        ethernet: {
            "1g-1": { description: "Management", addresses: ["10.0.1.1/24"] },
            "10g-1": { description: "AMS-IX", addresses: ["203.0.113.130/25", "2001:db8:fffe::130/64"] },
            // #region urpf
            // Strict uRPF drops what arrives from an address not routed back through the same interface. So the customer can send only from the block we route to it and from its end of the link, and a server only from its own subnet (BCP 38).
            "10g-2": {
                description: "AS64501",
                addresses: ["198.51.100.129/30", "2001:db8:100:ff::1/64"],
                urpf: { ipv4: "strict", ipv6: "strict" },
            },
            "10g-3": { description: "Servers", access_vlan: "servers" },
            "10g-4": { description: "Business customers", access_vlan: "business" },
        },
        vlan_interface: {
            servers: {
                vlan: "servers",
                addresses: ["198.51.100.65/27", "2001:db8:100:1::1/64"],
                urpf: { ipv4: "strict", ipv6: "strict" },
                // #endregion urpf
                // #region router-advertisement
                // The servers keep the addresses written on them. From the router they learn their gateway, resolvers, and search domain.
                // They drop the router as their gateway 90 seconds after it falls silent.
                ipv6_ra: {
                    interval: 30,
                    lifetime: 90,
                    prefixes: [{ prefix: "2001:db8:100:1::/64", disable_autoconfiguration: true }],
                    dns_servers: ["2001:db8:100:1::53"],
                    dns_search_list: ["example.net"],
                },
                // #endregion router-advertisement
            },
            // The M flag tells each customer's router to ask the DHCPv6 server below for an address.
            business: { vlan: "business", addresses: ["2001:db8:100:2::1/64"], ipv6_ra: { managed: true } },
        },
    },
    switching: {
        vlans: { servers: { id: 100 }, business: { id: 200 } },
    },

    // #region dhcpv6
    // Each business customer's router takes an address and a /56 for the networks behind it.
    services: {
        dhcpv6_server: {
            business: {
                interface: "business",
                pool: ["2001:db8:100:2::100", "2001:db8:100:2::1ff"],
                prefix_delegation: { pool: "2001:db8:100:8000::/49", prefix_length: 56 },
                dns: ["2001:db8:100:1::53"],
                lease_time: 86_400,
            },
        },
    },
    // #endregion dhcpv6

    routing: {
        router_id: "203.0.113.130",
        static_routes: [
            { prefix: as64500.prefixes.ours.v4, blackhole: true },
            { prefix: as64500.prefixes.ours.v6, blackhole: true },
        ],
        bgp: {
            originated_prefixes: [as64500.prefixes.ours.v4, as64500.prefixes.ours.v6],
            // The customer's block is inside ours, and the export accepts both. Only our block leaves.
            aggregates: [{ prefix: as64500.prefixes.ours.v4, summary_only: true }],
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
                as64501: {
                    address: "198.51.100.130",
                    remote_as: 64501,
                    description: "AS64501, a transit customer",
                    max_prefixes: 10,
                    graceful_restart: true,
                    import_policy: "customer-import",
                    // All it takes from us. Without an export_policy, no other route goes to it.
                    send_default_route: true,
                },
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
                // Through a route server, the first AS is the member that sent the route. AS64501's customers reach us through AS64501, which pays for it.
                { description: "AS64501's customers", if: { first_as: { min: 64502, max: 64505 } }, then: "reject" },
                { set: { local_pref: 200 }, then: "accept" },
            ],
            "customer-import": [
                // AS64501 announces the block itself, or for one of its own customers, AS64502 to AS64505.
                {
                    description: "The block we gave it",
                    if: { prefix: "198.51.100.192/26", first_as: 64501, origin_as: [64501, { min: 64502, max: 64505 }] },
                    then: "accept",
                },
                { then: "reject" },
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
