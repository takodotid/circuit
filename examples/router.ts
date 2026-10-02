// A router using every field the routeros adapter supports. Not a real network: addresses are from documentation ranges.

import { readFileSync } from "node:fs";
import { defineDevice, secret } from "@takodotid/circuit";

export default defineDevice({
    name: "example-router",
    platform: "routeros",
    model: "CCR2216-1G-12XS-2XQ",
    connection: { host: "192.0.2.1", user: "admin" },
    users: {
        admin: {
            role: "admin",
            password: secret("EXAMPLE_ADMIN_PASSWORD"),
            ssh_keys: ["ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExampleKeyOnlyForTheExampleNotARealKey00000 operator"],
        },
        monitor: { role: "read-only", password: secret("EXAMPLE_MONITOR_PASSWORD") },
    },

    system: {
        timezone: "Asia/Jakarta",
        banner: "Authorised access only.",
        dns: { servers: ["192.0.2.53"], serve: true },
        ntp: { servers: ["pool.ntp.org"], serve: true },
        logging: { local: { level: "warning", files: 5 }, remote: [{ address: "192.0.2.14", port: 514, level: "info" }] },
        release_channel: "long-term",
        ip: { syn_cookies: true },
    },

    management: {
        allow: ["192.0.2.0/24"],
        ssh: {},
        https: { certificate: "web" },
        native: { interfaces: ["management"] },
        snmp: {
            community: secret("EXAMPLE_SNMP_COMMUNITY"),
            users: {
                monitor: {
                    auth: "sha1",
                    auth_password: secret("EXAMPLE_SNMP_AUTH"),
                    privacy: "aes128",
                    privacy_password: secret("EXAMPLE_SNMP_PRIVACY"),
                },
            },
            location: "Rack 1",
        },
    },

    certificates: {
        web: {
            certificate: readFileSync(new URL("example.pem", import.meta.url), "utf8"),
            private_key: secret("EXAMPLE_WEB_KEY"),
        },
    },

    hardware_offload: true,
    stp: { mode: "rstp", priority: 4096 },
    lldp: { interfaces: ["management"] },

    vlans: { management: { id: 10, description: "Management" }, servers: { id: 20 }, guests: { id: 30 } },
    vrfs: { guests: { description: "Kept apart from everything else" } },

    ports: {
        "100g-1": {
            description: "Core switch",
            trunk_vlans: ["management", "servers", "guests"],
            lldp: true,
            stp: { cost: 100 },
            acl: "edge",
        },
        "25g-1": { description: "Bond member", lag: "uplink" },
        "25g-2": { description: "Bond member", lag: "uplink" },
        "25g-3": {
            description: "Host",
            access_vlan: "servers",
            stp: { edge: true },
            storm_control: { broadcast: { percent: 5 }, multicast: { percent: 5 } },
        },
        "25g-4": { description: "Lab switch that must not join our spanning tree", access_vlan: "guests", stp: false },
        "1g-1": { description: "Out-of-band", addresses: ["198.51.100.2/30"] },
    },

    interfaces: {
        uplink: { type: "lag", description: "Upstream bond", mode: "lacp", addresses: ["203.0.113.2/30"] },
        loopback: { type: "loopback", addresses: ["192.0.2.255/32"] },
        management: {
            type: "vlan",
            vlan: "management",
            addresses: ["192.0.2.1/24"],
            vrrp: [{ id: 1, address: "192.0.2.254", priority: 200, preempt: true }],
        },
        servers: {
            type: "vlan",
            vlan: "servers",
            addresses: ["198.51.100.65/26", "2001:db8:20::1/64"],
            ipv6_ra: true,
            hardware_offload: false,
        },
        guests: { type: "vlan", vlan: "guests", addresses: ["198.51.100.129/26"], vrf: "guests" },
    },

    routing: {
        router_id: "192.0.2.255",
        static: [
            { prefix: "0.0.0.0/0", via: "203.0.113.1", description: "Upstream" },
            { prefix: "198.51.100.0/24", blackhole: true, description: "Originate" },
            { prefix: "0.0.0.0/0", via: "198.51.100.130", vrf: "guests", description: "Guest exit" },
        ],
        rpki: [{ address: "192.0.2.80", port: 323 }],
        bgp: {
            asn: 64500,
            networks: ["198.51.100.0/24"],
            groups: {
                upstream: {
                    remote_as: 64501,
                    local_role: "customer",
                    import: "UPSTREAM-IN",
                    export: "UPSTREAM-OUT",
                    max_prefixes: 10,
                    bfd: true,
                },
            },
            neighbors: {
                "upstream-1": { address: "203.0.113.1", group: "upstream" },
                internal: {
                    address: "192.0.2.254",
                    remote_as: 64500,
                    local_address: "192.0.2.255",
                    import: "UPSTREAM-IN",
                    export: "UPSTREAM-OUT",
                    hold_time: 90,
                    keepalive: 30,
                },
            },
        },
        ospf: {
            areas: {
                "0.0.0.0": { interfaces: { management: { passive: true }, uplink: { cost: 10, network: "point-to-point", bfd: true } } },
            },
            redistribute: ["connected", "static"],
        },
    },

    prefix_sets: {
        ours: { prefixes: ["198.51.100.0/24"] },
        "upstream-origins": { source: { registry: "ripe-stat", query: "AS64501", family: "ipv4" } },
    },

    policies: {
        "UPSTREAM-IN": [
            {
                description: "Only the default route",
                match: { prefix: "0.0.0.0/0" },
                set: { local_pref: 200, preferred_source: "192.0.2.255", add_large_communities: ["64500:1:1"] },
                action: "accept",
            },
        ],
        "UPSTREAM-OUT": [
            { description: "Not to upstreams", match: { large_community: "64500:100:0" }, action: "reject" },
            { set: { remove_large_communities: ["64500:*:*"], communities: ["64501:100"] } },
            { description: "Our space", match: { prefix_set: "ours", rpki: "valid" }, set: { prepend: 1, med: 10 }, action: "accept" },
        ],
    },

    firewall: {
        address_sets: { management: ["192.0.2.0/24"] },
        filter: {
            input: {
                default: "drop",
                rules: [
                    { description: "Established", match: { state: ["established", "related"] }, action: "accept" },
                    { description: "Management", match: { src_set: "management" }, action: "accept" },
                    { description: "BGP", match: { protocol: "tcp", dst_port: 179, src: "203.0.113.1/32" }, action: "accept" },
                    { description: "OSPF", match: { protocol: "ospf" }, action: "accept" },
                    { description: "VRRP", match: { protocol: "vrrp" }, action: "accept" },
                ],
            },
            forward: {
                rules: [{ description: "Established", match: { state: ["established", "related"] }, action: "accept", offload: true }],
            },
        },
        nat: {
            source: [{ description: "Guests out", match: { src: "198.51.100.128/26", out_interface: "uplink" }, action: "masquerade" }],
            destination: [
                {
                    description: "Web server",
                    match: { protocol: "tcp", dst_port: 8080, in_interface: "uplink" },
                    action: "dnat",
                    to: "198.51.100.70",
                    to_port: 80,
                },
            ],
        },
        helpers: ["ftp"],
    },

    acls: {
        edge: [
            { description: "Drop spoofed", match: { src: "198.51.100.0/24" }, action: "drop" },
            { description: "Cap UDP", match: { protocol: "udp" }, action: "accept", rate: "1G" },
        ],
    },

    dhcp: {
        servers: {
            interface: "servers",
            network: "198.51.100.64/26",
            gateway: "198.51.100.65",
            dns: ["192.0.2.53"],
            pool: ["198.51.100.100", "198.51.100.120"],
            lease_time: 3600,
        },
    },
    dhcp_relay: { guests: { interface: "guests", servers: ["198.51.100.66"] } },
    flow_export: { protocol: "ipfix", collectors: [{ address: "192.0.2.99" }], sampling: 100, interfaces: ["uplink"] },
});
