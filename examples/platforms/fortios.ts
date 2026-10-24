// A firewall using every field the fortios adapter supports. Not a real network: addresses are from documentation ranges.

import { readFileSync } from "node:fs";
import { defineDevice, secret } from "@takodotid/circuit";

export default defineDevice({
    name: "example-firewall",
    platform: "fortios",
    model: "FG-3700D",
    connection: { host: "192.0.2.4", user: "netops" },
    users: {
        netops: {
            role: "admin",
            password: secret("EXAMPLE_NETOPS_PASSWORD"),
            description: "Network team",
            ssh_keys: ["ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGq5UoWNbDBN7kXsEcNWmMEqlb7r0Ec6oOOfzxwKrUfS netops@example"],
        },
        noc: { role: "operator", password: secret("EXAMPLE_NOC_PASSWORD") },
        monitor: { role: "read-only", password: secret("EXAMPLE_MONITOR_PASSWORD") },
    },

    system: {
        timezone: "Asia/Jakarta",
        banner: "Authorised access only.",
        dns: { servers: ["192.0.2.53", "2001:db8::53"], serve: true },
        ntp: { servers: ["192.0.2.1", "pool.ntp.org"], serve: true },
        logging: {
            local: { level: "warning" },
            remote: [
                { address: "192.0.2.98", level: "info" },
                { address: "192.0.2.99", port: 5514, level: "warning" },
            ],
        },
        ip: { icmp_redirects: true },
    },
    management: {
        allow: ["192.0.2.0/24", "2001:db8::/64"],
        ssh: { port: 2222, auth_timeout: 30 },
        https: { port: 8443, certificate: "web" },
        native: {},
        snmp: {
            allow: ["192.0.2.96/28"],
            community: secret("EXAMPLE_SNMP_COMMUNITY"),
            users: {
                monitor: {
                    auth: "sha1",
                    auth_password: secret("EXAMPLE_SNMP_AUTH"),
                    privacy: "aes128",
                    privacy_password: secret("EXAMPLE_SNMP_PRIVACY"),
                },
            },
            contact: "noc@example.com",
            location: "Rack 2, Jakarta",
        },
    },

    certificates: {
        web: {
            certificate: readFileSync(new URL("example.pem", import.meta.url), "utf8"),
            private_key: secret("EXAMPLE_WEB_KEY"),
        },
    },

    lldp: true,
    hardware_offload: true,

    vlans: { management: { id: 10 }, servers: { id: 20 }, guests: { id: 30 } },
    vrfs: { guests: {} },

    ports: {
        "40g-1": { description: "Upstream bond", lag: "uplink", speed: "40g" },
        "40g-2": { description: "Upstream bond", lag: "uplink", speed: "40g" },
        "10g-1": { description: "Core switch", trunk_vlans: ["management", "servers", "guests"], mtu: 9000 },
        "10g-2": { description: "Lab host", speed: "1g", addresses: ["198.51.100.193/27"], lldp: false, acl: "lab" },
        "1g-1": { description: "Out-of-band", addresses: ["192.0.2.4/26"] },
    },

    interfaces: {
        uplink: { type: "lag", description: "Upstream", mode: "lacp", addresses: ["203.0.113.10/30", "2001:db8:fff0::2/64"] },
        loopback: { type: "loopback", description: "Router address", addresses: ["198.51.100.255/32"] },
        management: {
            type: "vlan",
            vlan: "management",
            description: "Management",
            addresses: ["192.0.2.129/26", "192.0.2.161/27", "2001:db8:10::1/64"],
            vrrp: [{ id: 1, address: "192.0.2.190", priority: 200, preempt: true }],
        },
        servers: {
            type: "vlan",
            vlan: "servers",
            addresses: ["198.51.100.33/27", "2001:db8:40::1/64", "2001:db8:41::1/64"],
            mtu: 9000,
            ipv6_ra: true,
        },
        guests: { type: "vlan", vlan: "guests", addresses: ["198.51.100.97/27"], vrf: "guests" },
        partner: {
            type: "gre",
            description: "Partner tunnel",
            local: "203.0.113.10",
            remote: "203.0.113.220",
            addresses: [{ address: "192.0.2.249/30", peer: "192.0.2.250" }, "2001:db8:ffee::1/64"],
        },
        stretch: {
            type: "vxlan",
            vni: 5000,
            local: "203.0.113.10",
            remote: "203.0.113.221",
            mac: "02:00:00:00:50:00",
            addresses: ["192.0.2.241/29"],
        },
    },

    routing: {
        router_id: "198.51.100.255",
        static: [
            { prefix: "0.0.0.0/0", via: "203.0.113.9", description: "Upstream", bfd: true },
            { prefix: "::/0", via: "2001:db8:fff0::1" },
            { prefix: "198.51.100.0/24", blackhole: true, description: "Originate" },
            { prefix: "198.18.0.0/15", via: "192.0.2.130", distance: 20 },
            { prefix: "0.0.0.0/0", via: "198.51.100.98", vrf: "guests", description: "Guest exit" },
        ],
        ospf: {
            families: ["ipv4", "ipv6"],
            areas: {
                "0.0.0.0": { interfaces: { loopback: { passive: true }, management: { cost: 10, network: "point-to-point", bfd: true } } },
            },
            redistribute: ["connected"],
        },
        bgp: {
            asn: 64500,
            networks: ["198.51.100.0/24"],
            groups: {
                upstream: {
                    remote_as: 64501,
                    import: "UPSTREAM-IN",
                    export: "UPSTREAM-OUT",
                    max_prefixes: 1000,
                    password: secret("EXAMPLE_BGP_PASSWORD"),
                    bfd: true,
                },
            },
            neighbors: {
                "upstream-1": { address: "203.0.113.9", group: "upstream", description: "Transit" },
                "upstream-1-v6": { address: "2001:db8:fff0::1", group: "upstream" },
                internal: {
                    address: "192.0.2.130",
                    remote_as: 64500,
                    local_address: "198.51.100.255",
                    multihop: true,
                    passive: true,
                    hold_time: 90,
                    keepalive: 30,
                },
            },
        },
        bfd: { interval: 300, multiplier: 4 },
    },

    prefix_sets: {
        ours: { prefixes: ["198.51.100.0/24"] },
        "upstream-origins": { source: { registry: "ripe-stat", query: "AS64501", family: "ipv4" } },
    },

    policies: {
        "UPSTREAM-IN": [
            { description: "Not too specific, and not marked to drop", match: { prefix_length: { min: 25 } }, action: "reject" },
            { match: { community: "64501:666" }, action: "reject" },
            {
                description: "Only the default route",
                match: { prefix: "0.0.0.0/0" },
                set: { local_pref: 200, add_communities: ["64500:100"] },
                action: "accept",
            },
            { description: "The upstream's own", match: { prefix_set: "upstream-origins" }, set: { med: 10 }, action: "accept" },
        ],
        "UPSTREAM-OUT": [
            { call: "NOT-TO-UPSTREAMS" },
            {
                description: "Our space",
                match: { family: "ipv4", prefix_set: "ours", prefix_length: { max: 24 } },
                set: { prepend: 1, remove_communities: ["64500:*"], next_hop: "203.0.113.10" },
                action: "accept",
            },
            { description: "Tagged for upstreams", match: { family: "ipv6" }, set: { communities: ["64501:100"] }, action: "accept" },
        ],
        "NOT-TO-UPSTREAMS": [{ match: { community: "64500:999" }, action: "reject" }],
    },

    firewall: {
        address_sets: { management: ["192.0.2.0/24", "2001:db8::/64"], dns: ["192.0.2.53"], partners: ["203.0.113.192/28"] },
        filter: {
            input: {
                default: "drop",
                rules: [
                    { description: "Established", match: { state: ["established", "related"] }, action: "accept" },
                    { description: "Management", match: { src_set: "management" }, action: "accept" },
                    { description: "VRRP", match: { protocol: "vrrp", in_interface: "management" }, action: "accept" },
                    { description: "OSPF", match: { protocol: "ospf" }, action: "accept" },
                    { description: "BGP", match: { protocol: "tcp", dst_port: 179 }, action: "accept" },
                    { description: "Ping", match: { protocol: "icmp" }, action: "accept" },
                ],
            },
            forward: {
                default: "drop",
                rules: [
                    { description: "Established", match: { state: ["established", "related"] }, action: "accept", offload: true },
                    { description: "Servers out", match: { in_interface: "servers", out_interface: "uplink" }, action: "accept" },
                    { description: "Guests out", match: { src: "198.51.100.96/27", out_interface: "uplink" }, action: "accept" },
                    { description: "Guests to resolvers", match: { protocol: "udp", dst_port: 53, dst_set: "dns" }, action: "accept" },
                    { description: "No SMTP out", match: { protocol: "tcp", dst_port: [25, 465, 587] }, action: "reject" },
                    { description: "Web in", match: { protocol: "tcp", dst_port: 80, dst: "198.51.100.42/32" }, action: "accept" },
                ],
            },
        },
        nat: {
            source: [
                { description: "Guests out", match: { src: "198.51.100.96/27", out_interface: "uplink" }, action: "masquerade" },
                {
                    description: "Servers out",
                    match: { src: "198.51.100.32/27", out_interface: "uplink" },
                    action: "snat",
                    to: "203.0.113.11",
                },
            ],
            destination: [
                {
                    description: "Web server",
                    match: { protocol: "tcp", dst: "203.0.113.10/32", dst_port: 8080, in_interface: "uplink" },
                    action: "dnat",
                    to: "198.51.100.42",
                    to_port: 80,
                },
                {
                    description: "Mail for partners",
                    match: { protocol: "tcp", dst: "203.0.113.12/32", dst_port: 25, src_set: "partners" },
                    action: "dnat",
                    to: "198.51.100.43",
                },
            ],
        },
        helpers: ["ftp", "sip"],
    },

    acls: {
        lab: [
            { description: "Drop spoofed", match: { src: "192.0.2.0/24" }, action: "drop" },
            { description: "No memcached", match: { protocol: "udp", dst_port: 11211 }, action: "drop" },
            { action: "accept" },
        ],
    },

    dhcp: {
        servers: {
            interface: "servers",
            network: "198.51.100.32/27",
            gateway: "198.51.100.33",
            dns: ["192.0.2.53"],
            pool: ["198.51.100.40", "198.51.100.50"],
            lease_time: 3600,
            reservations: [{ address: "198.51.100.41", mac: "00:11:22:33:44:55", description: "Printer" }],
        },
    },
    dhcp_relay: {
        guests: { interface: "guests", servers: ["198.51.100.66"] },
        servers: { interface: "servers", servers: ["2001:db8::67"] },
    },
    flow_export: { protocol: "sflow", collectors: [{ address: "192.0.2.99" }], sampling: 4096, interfaces: ["uplink", "servers"] },
});
