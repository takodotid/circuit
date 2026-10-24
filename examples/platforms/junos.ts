// A switch using every field the junos adapter supports. Not a real network: addresses are from documentation ranges.

import { defineDevice, secret } from "@takodotid/circuit";

export default defineDevice({
    name: "example-aggregation-switch",
    platform: "junos",
    model: "QFX5100-48S-6Q",
    connection: { host: "203.0.113.130", user: "netops" },
    users: {
        root: { role: "admin", password: secret("EXAMPLE_ROOT_PASSWORD") },
        netops: {
            role: "admin",
            password: secret("EXAMPLE_NETOPS_PASSWORD"),
            description: "Network team",
            ssh_keys: ["ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGq5UoWNbDBN7kXsEcNWmMEqlb7r0Ec6oOOfzxwKrUfS netops@example"],
        },
        monitor: { role: "read-only", password: secret("EXAMPLE_MONITOR_PASSWORD") },
    },

    system: {
        timezone: "Asia/Jakarta",
        banner: "Authorized access only",
        dns: { servers: ["192.0.2.53"] },
        ntp: { servers: ["192.0.2.1"] },
        logging: { local: { level: "notice", files: 5 }, remote: [{ address: "192.0.2.98", level: "info" }] },
    },
    management: {
        allow: ["192.0.2.0/24", "2001:db8::/64"],
        ssh: {},
        http: {},
        api: { port: 3443 },
        native: {},
        snmp: {
            community: secret("EXAMPLE_SNMP_COMMUNITY"),
            contact: "noc@example.com",
            location: "Rack 4, Jakarta",
            users: {
                monitor: {
                    auth: "sha256",
                    auth_password: secret("EXAMPLE_SNMP_AUTH"),
                    privacy: "aes128",
                    privacy_password: secret("EXAMPLE_SNMP_PRIVACY"),
                },
            },
        },
    },

    stp: { mode: "rstp", priority: 8192 },
    lldp: true,

    vlans: {
        management: { id: 10, description: "Management" },
        servers: { id: 20 },
        guests: { id: 30 },
        native: { id: 999 },
    },
    vrfs: { guests: { description: "Guest network" } },

    ports: {
        "1g-1": { description: "Out-of-band", addresses: ["203.0.113.130/26"] },
        "40g-1": { description: "Router", lag: "uplink" },
        "40g-2": { description: "Router", lag: "uplink" },
        "10g-1": {
            description: "Host",
            access_vlan: "servers",
            mtu: 9000,
            acl: "host-in",
            stp: { edge: true },
            storm_control: { broadcast: { percent: 1 }, multicast: { percent: 1 } },
        },
        "10g-2": {
            description: "Host on a 1G optic",
            access_vlan: "servers",
            speed: "1g",
            lldp: false,
            mac_limit: 1,
            ethertypes: ["ipv4", "ipv6", "arp"],
        },
        "10g-3": { description: "Lab switch", trunk_vlans: ["guests"], native_vlan: "native", stp: false },
        "10g-48": { description: "Transit", addresses: ["198.51.100.5/31", "2001:db8:31::1/64"], acl: "transit-in" },
    },

    interfaces: {
        uplink: { type: "lag", mode: "lacp", trunk_vlans: ["management", "servers", "guests"], mtu: 9000, stp: { cost: 2000 } },
        management: {
            type: "vlan",
            vlan: "management",
            description: "Management",
            addresses: ["192.0.2.5/24", "2001:db8::5/64"],
            vrrp: [{ id: 1, address: "192.0.2.254", priority: 120, preempt: true, interval: 2 }],
            mtu: 9000,
            ipv6_ra: true,
        },
        guests: { type: "vlan", vlan: "guests", addresses: ["198.51.100.131/26"], vrf: "guests" },
        loopback: { type: "loopback", addresses: ["203.0.113.65/32", "2001:db8:ffff::1/128"] },
        tunnel: {
            type: "gre",
            description: "To the far site",
            local: "203.0.113.65",
            remote: "198.51.100.200",
            addresses: ["203.0.113.200/31"],
            mtu: 1476,
        },
    },

    routing: {
        router_id: "203.0.113.65",
        static: [
            { prefix: "0.0.0.0/0", via: "192.0.2.1" },
            { prefix: "0.0.0.0/0", via: "198.51.100.4", distance: 20 },
            { prefix: "203.0.113.64/26", blackhole: true },
            { prefix: "::/0", via: "2001:db8::1", bfd: true },
            { prefix: "0.0.0.0/0", via: "198.51.100.129", vrf: "guests" },
        ],
        ospf: {
            families: ["ipv4", "ipv6"],
            areas: {
                "0.0.0.0": {
                    interfaces: {
                        management: { cost: 10, bfd: true },
                        loopback: { passive: true },
                        "10g-48": { network: "point-to-point" },
                    },
                },
            },
            redistribute: ["connected", "static"],
        },
        bgp: {
            asn: 64500,
            networks: ["203.0.113.64/26"],
            groups: {
                transit: { import: "transit-in", export: "transit-out", max_prefixes: 1000000, hold_time: 90, bfd: true },
            },
            neighbors: {
                "transit-1": {
                    address: "198.51.100.4",
                    remote_as: 64511,
                    group: "transit",
                    description: "Transit",
                    password: secret("EXAMPLE_BGP_PASSWORD"),
                },
                "customer-1": {
                    address: "192.0.2.30",
                    remote_as: 64512,
                    description: "Customer",
                    import: "customer-in",
                    export: "customer-out",
                    families: ["ipv4", "ipv6"],
                },
                "collector-1": {
                    address: "192.0.2.90",
                    remote_as: 64500,
                    description: "Route collector",
                    local_address: "203.0.113.65",
                    multihop: true,
                    passive: true,
                    bfd: true,
                },
            },
        },
        rpki: [{ address: "192.0.2.80", port: 323 }],
        bfd: { interval: 300, multiplier: 4 },
    },

    prefix_sets: {
        ours: { prefixes: ["203.0.113.64/26"] },
        customer: { source: { registry: "ripe-stat", query: "AS64512", family: "ipv4" } },
    },

    policies: {
        "transit-in": [
            { description: "Drop invalid", match: { rpki: "invalid" }, action: "reject" },
            { description: "Drop long prefixes", match: { prefix_length: { min: 25 } }, action: "reject" },
            { description: "Prefer short paths", match: { as_path_length: { max: 3 } }, set: { local_pref: 120 } },
            { description: "Tag transit", set: { add_communities: ["64500:100"] }, action: "accept" },
        ],
        "transit-out": [
            { call: "clean" },
            {
                description: "Ours",
                match: { prefix_set: "ours" },
                set: { prepend: 2, med: 10, add_large_communities: ["64500:1:1"] },
                action: "accept",
            },
        ],
        clean: [{ description: "Strip our tags", set: { remove_communities: ["64500:*"], remove_large_communities: ["64500:*:*"] } }],
        "customer-in": [
            { description: "Blackhole on request", match: { community: "64500:666" }, set: { blackhole: true }, action: "accept" },
            {
                description: "Customer routes",
                match: { prefix_set: "customer" },
                set: { communities: ["64500:200"], next_hop: "198.51.100.4" },
                action: "accept",
            },
            {
                description: "Customer IPv6",
                match: { family: "ipv6", large_community: "64512:1:1" },
                set: { large_communities: ["64500:2:2"] },
                action: "accept",
            },
        ],
        "customer-out": [{ description: "Default only", match: { prefix: "0.0.0.0/0" }, action: "accept" }],
    },

    acls: {
        "host-in": [
            { description: "SSH from admins", match: { protocol: "tcp", src: "192.0.2.0/24", dst_port: 22 }, action: "accept" },
            { description: "Traceroute", match: { protocol: "udp", dst_port: { min: 33434, max: 33534 } }, action: "accept", rate: "10M" },
            { description: "Ping", match: { protocol: "icmp" }, action: "accept" },
            { description: "No IPv6 web", match: { family: "ipv6", protocol: "tcp", dst_port: [80, 443] }, action: "drop" },
        ],
        "transit-in": [
            { description: "No spoofed sources", match: { src: "203.0.113.64/26" }, action: "drop" },
            { description: "Limit ICMP", match: { protocol: "icmp" }, action: "accept", rate: "2M" },
        ],
    },

    dhcp: {
        management: {
            interface: "management",
            network: "192.0.2.0/24",
            gateway: "192.0.2.254",
            dns: ["192.0.2.53"],
            pool: ["192.0.2.100", "192.0.2.150"],
            lease_time: 86400,
            reservations: [{ address: "192.0.2.101", mac: "02:00:00:00:00:01", description: "Console server" }],
        },
    },

    dhcp_relay: { guests: { interface: "guests", servers: ["198.51.100.66"] } },
    flow_export: { protocol: "sflow", collectors: [{ address: "192.0.2.99" }], sampling: 4096, interfaces: ["10g-1", "uplink"] },
});
