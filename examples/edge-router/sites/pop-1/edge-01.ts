// The edge router: BGP with an IP transit and an internet exchange, filtered on the way in and on the way out.
// Hurricane Electric and DE-CIX stand for your own transit and exchange. The addresses are documentation ranges, so use the ones your providers give you.

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
    // Flow records of what crosses the transit and the exchange. A long flow is reported every minute, not only when it ends.
    monitoring: {
        flow_export: {
            protocol: "netflow-v9",
            collectors: [{ address: "10.0.0.31" }],
            interfaces: ["25g-1", "25g-2"],
            active_timeout: 60,
            idle_timeout: 15,
        },
    },

    // Loose uRPF drops what arrives from an address no route covers, such as a bogon, or from a prefix routed to a blackhole. RouterOS checks IPv4 only, in one mode for the whole router, so every interface with an IPv4 address says the same.
    interfaces: {
        ethernet: {
            "1g-1": { description: "Management", addresses: ["10.0.0.1/24"], urpf: { ipv4: "loose" } },
            "25g-1": { description: "Hurricane Electric", access_vlan: "transit", ingress_acl: "edge" },
            "25g-2": { description: "DE-CIX", access_vlan: "exchange", ingress_acl: "edge" },
        },
        vlan_interface: {
            transit: { vlan: "transit", addresses: ["203.0.113.2/30"], urpf: { ipv4: "loose" } },
            exchange: { vlan: "exchange", addresses: ["192.0.2.10/24", "2001:db8:ffff::10/64"], urpf: { ipv4: "loose" } },
        },
    },
    switching: {
        // #region outside-vlans
        vlans: {
            transit: { id: 300, description: "IP transit from Hurricane Electric, AS6939", untrusted: true },
            exchange: { id: 200, description: "DE-CIX peering LAN", untrusted: true },
        },
        // #endregion outside-vlans
        // #region edge-acl
        // In the switch chip, before a packet reaches the router's CPU: nothing from outside may claim our addresses or private ones.
        acls: {
            edge: [
                { description: "Our own space", if: { vlan: ["transit", "exchange"], src: as64500.prefixes.ours.v4 }, then: "drop" },
                { description: "Private ranges", if: { vlan: ["transit", "exchange"], src: presets.rfc1918 }, then: "drop" },
            ],
        },
        // #endregion edge-acl
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
                // #region transit
                "hurricane-electric": {
                    address: "203.0.113.1",
                    remote_as: 6939,
                    description: "Hurricane Electric",
                    role: "provider",
                    max_prefixes: 1_200_000,
                    // The transit is one hop away, so GTSM drops BGP packets from anywhere farther (RFC 5082).
                    ttl_security: true,
                    import_policy: "transit-import",
                    export_policy: "export",
                    communities: { groups: ["transit"] },
                },
                // #endregion transit
                "de-cix-rs-v4": {
                    address: "192.0.2.1",
                    remote_as: 6695,
                    description: "DE-CIX route server",
                    role: "rs",
                    max_prefixes: 100_000,
                    import_policy: "exchange-import",
                    export_policy: "export",
                    communities: { groups: ["exchange"] },
                },
                "de-cix-rs-v6": {
                    address: "2001:db8:ffff::1",
                    remote_as: 6695,
                    description: "DE-CIX route server",
                    role: "rs",
                    max_prefixes: 50_000,
                    import_policy: "exchange-import",
                    export_policy: "export",
                    communities: { groups: ["exchange"] },
                },
            },
        },
        // #region imports
        prefix_sets: {
            ours: { prefixes: as64500.prefixes.ours },
            "bogons-v4": { prefixes: presets.bogons.ipv4 },
            "bogons-v6": { prefixes: presets.bogons.ipv6 },
        },
        policies: {
            // #region local-pref
            sanity: presets.bgp_sanity,
            // A route from the exchange beats the same route from the transit: the higher local preference wins.
            "transit-import": [
                { call: "sanity" },
                { description: "Bogons", if: { prefix_set: "bogons-v4" }, then: "reject" },
                { description: "Bogons", if: { prefix_set: "bogons-v6" }, then: "reject" },
                { description: "Bogon ASNs", if: { as_path_contains: presets.bogon_asns }, then: "reject" },
                // Over 100 ASes, the NLNOG BGP Filter Guide's safe limit: such a path is overdone prepending, or an attack.
                { description: "Long AS paths", if: { as_path_length: { min: 101 } }, then: "reject" },
                { if: { prefix_set: "ours" }, then: "reject" },
                { communities: "import" },
                { set: { local_pref: 100 }, then: "accept" },
            ],
            // #endregion imports
            "exchange-import": [
                { call: "sanity" },
                { description: "Bogons", if: { prefix_set: "bogons-v4" }, then: "reject" },
                { description: "Bogons", if: { prefix_set: "bogons-v6" }, then: "reject" },
                { description: "Bogon ASNs", if: { as_path_contains: presets.bogon_asns }, then: "reject" },
                { description: "Long AS paths", if: { as_path_length: { min: 101 } }, then: "reject" },
                { if: { prefix_set: "ours" }, then: "reject" },
                { communities: "import" },
                { set: { local_pref: 200 }, then: "accept" },
            ],
            // #endregion local-pref
            // #region export
            export: [
                { communities: "export" },
                { description: "Our own space", if: { prefix_set: "ours" }, then: "accept" },
                { description: "Nothing else leaves", then: "reject" },
            ],
            // #endregion export
        },
    },

    firewall: {
        address_sets: {
            management: ["10.0.0.0/24"],
            "bgp-neighbors": bgpNeighbors(),
            "voice-carrier": ["203.0.113.64/28"],
            "backup-servers": ["198.51.100.40", "2001:db8:100::40"],
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
        interface_sets: { uplinks: ["transit", "exchange"] },
        // #region cgnat
        // The access network's subscribers have shared addresses (RFC 6598). Each one always leaves as the same address of our pool, with the same block of ports, so an abuse report's address and port name one subscriber (RFC 7422).
        nat: {
            source: [
                {
                    description: "CGNAT, 32 subscribers on each address",
                    if: { src: "100.64.0.0/22", out_interface_set: "uplinks" },
                    then: "snat",
                    to_pool: "198.51.100.0/27",
                    port_set_size: 2016,
                },
            ],
        },
        // #endregion cgnat
    },

    // #region marking
    // Our DiffServ domain begins at the transit and the exchange (RFC 2475): a DSCP set by another network is not ours to trust. Calls with our voice carrier get EF, and their signaling CS5, as RFC 4594 gives them. The first rule that matches marks a packet.
    qos: {
        marking: [
            {
                description: "Calls from the voice carrier",
                if: {
                    in_interface_set: "uplinks",
                    src_address_set: "voice-carrier",
                    protocol: "udp",
                    src_port: { min: 16384, max: 32767 },
                },
                then: { dscp: "ef" },
            },
            {
                description: "Calls to the voice carrier",
                if: {
                    out_interface_set: "uplinks",
                    dst_address_set: "voice-carrier",
                    protocol: "udp",
                    dst_port: { min: 16384, max: 32767 },
                },
                then: { dscp: "ef" },
            },
            {
                description: "Call signaling",
                if: { dst_address_set: "voice-carrier", protocol: "tcp", dst_port: 5061 },
                then: { dscp: "cs5" },
            },
            { description: "Everything else from outside", if: { in_interface_set: "uplinks" }, then: { dscp: "cs0" } },
            // The off-site copies go over IPv6 alone, below best effort (RFC 8622), so they never slow the subscribers down.
            {
                description: "Off-site backups",
                if: { family: "ipv6", src_address_set: "backup-servers", out_interface: "transit" },
                then: { dscp: "le" },
            },
            {
                description: "Monitoring of our devices",
                if: { in_interface: "1g-1", dst: as64500.prefixes.ours.v4 },
                then: { dscp: "cs2" },
            },
            {
                description: "Only our routers send network control",
                if: { src: "100.64.0.0/22", dscp: ["cs6", "cs7"] },
                then: { dscp: "cs0" },
            },
        ],
    },
    // #endregion marking
});
