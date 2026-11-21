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
        // Our CA signs a certificate for each end of a tunnel, and nothing else. The private key stays out of git.
        certificates: {
            "as64500-ipsec-ca": { certificate_file: "certificates/as64500-ipsec-ca.pem" },
            "core-02": { certificate_file: "certificates/core-02.pem", private_key: secretFile("certificates/core-02.key") },
        },
    },
    management: { allow: ["10.0.0.0/16"], ssh: {} },
    // The log server keeps the log of each block of ports the pool below gives and takes back.
    monitoring: { syslog: [{ address: "10.0.0.10", level: "info" }] },

    interfaces: {
        ethernet: {
            "1g-1": { description: "Management", addresses: ["10.0.2.1/24"] },
            "40g-1": { description: "core-01 et-0/0/48", addresses: ["10.0.12.2/30"], link: { device: "core-01", port: "40g-1" } },
            "10g-1": { description: "Cogent", addresses: ["203.0.113.6/30"] },
            "10g-2": { description: "Office internet line, behind the office router's NAT", addresses: ["192.168.10.2/24"] },
        },
        loopback: { loopback: { addresses: ["10.255.2.1/32"] } },
        // Two branch offices reach the region over the internet, through Cogent. Both ends of a tunnel write the same algorithms.
        // When a branch stops answering the liveness checks, its tunnel goes down, and so does the static route through it.
        ipsec: {
            // The office sits behind its ISP's NAT, whose address this is. IKE finds the NAT and moves the tunnel into UDP on its own.
            // The tunnel carries IPv6 too, since it has an IPv6 address.
            "ipsec-branch-1": {
                description: "Branch office 1",
                addresses: [{ address: "10.255.12.1/30", peer_address: "10.255.12.2" }, "2001:db8:100:1201::1/64"],
                local_address: "203.0.113.6",
                remote_address: "192.0.2.20",
                certificate: "core-02",
                ca_certificate: "as64500-ipsec-ca",
                ike: { encryption: "aes-256-gcm", prf: "hmac-sha2-256", dh_group: 19, lifetime: 86400 },
                esp: { encryption: "aes-256-gcm", pfs_group: 19, lifetime: 3600 },
                liveness_check: { interval: 10, retries: 3 },
            },
            // Its router has no AES-GCM for IKE: the algorithms every IKEv2 peer has. Its ISP drops ESP, so ESP always goes in UDP.
            "ipsec-branch-2": {
                description: "Branch office 2",
                addresses: [{ address: "10.255.12.5/30", peer_address: "10.255.12.6" }],
                local_address: "203.0.113.6",
                remote_address: "192.0.2.30",
                pre_shared_key: secret("IPSEC_BRANCH_2"),
                ike: { ...presets.ipsec_rfc8247, lifetime: 28800 },
                esp: { encryption: "aes-256-cbc", integrity: "hmac-sha2-256-128", lifetime: 3600 },
                liveness_check: { interval: 10, retries: 3 },
                nat_traversal: "always",
            },
            // Out-of-band access for the operators, from the jump host, over the office's internet line.
            // This end is behind the office router's NAT, which forgets an idle UDP mapping after 30 seconds.
            // So it sends a NAT keepalive every 20 seconds. With no other path to fail over to, it doesn't check its peer.
            "ipsec-oob": {
                description: "Out-of-band, to the jump host",
                addresses: [{ address: "10.255.12.9/30", peer_address: "10.255.12.10" }],
                local_address: "192.168.10.2",
                remote_address: "192.0.2.40",
                pre_shared_key: secret("IPSEC_OOB"),
                ike: { encryption: "aes-256-gcm", prf: "hmac-sha2-256", dh_group: 19, lifetime: 86400 },
                esp: { encryption: "aes-256-gcm", pfs_group: 19, lifetime: 3600 },
                liveness_check: false,
                nat_keepalive: 20,
            },
        },
    },

    routing: {
        router_id: "10.255.2.1",
        static_routes: [
            { prefix: as64500.prefixes.ours.v4, blackhole: true },
            { prefix: "10.21.0.0/16", interface: "ipsec-branch-1", description: "Branch office 1" },
            { prefix: "2001:db8:100:2100::/56", interface: "ipsec-branch-1", description: "Branch office 1" },
            { prefix: "10.22.0.0/16", interface: "ipsec-branch-2", description: "Branch office 2" },
            { prefix: "192.0.2.40/32", next_hop: "192.168.10.1", description: "The jump host, over the office line" },
        ],
        isis: {
            net: "49.0001.0102.5500.2001.00",
            level_capability: "level-1-2",
            address_families: ["ipv4"],
            // A key per level. Both are core-01's key, since the point-to-point link to it sends one hello for both levels.
            levels: {
                1: { authentication: { algorithm: "hmac-md5", key: secret("ISIS_KEY") } },
                2: { authentication: { algorithm: "hmac-md5", key: secret("ISIS_KEY") } },
            },
            interfaces: {
                // FortiOS has no passive interface, and a loopback forms no adjacency anyway.
                loopback: {},
                "40g-1": { network: "point-to-point", metric: 100 },
            },
            // Drained for maintenance. Remove it to carry traffic through core-02 again.
            overload_bit: true,
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

    firewall: {
        // #region cgnat-dynamic
        // The branch offices reach the internet through Cogent from a pool of our addresses. A host gets blocks of 512 ports as it
        // needs them, 4 at most, and the device logs each block it gives and takes back. Only that log says which host had a pool
        // address and port at the time of an abuse report. A host keeps a block two minutes after its last connection ends, so a
        // host that connects again soon leaves from the same address and ports, with no new log line.
        nat: {
            source: [
                {
                    description: "Branch offices to the internet",
                    if: { src: "10.20.0.0/14", out_interface: "10g-1" },
                    then: "snat",
                    to_pool: "198.51.100.240/28",
                    port_allocation: "dynamic",
                    port_set_size: 512,
                    port_sets_per_subscriber: 4,
                    port_set_timeout: 120,
                },
            ],
        },
        // #endregion cgnat-dynamic
    },
});
