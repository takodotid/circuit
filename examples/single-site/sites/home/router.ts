// The router: the internet connection, a gateway and DHCP for each VLAN, and the firewall.

import { as64500 } from "../../circuit";
import { home } from "./site";

export default as64500.device({
    name: "router",
    site: "home",
    role: "Router",
    platform: "routeros",
    model: "CCR2216-1G-12XS-2XQ",
    connection: { host: "192.168.10.1", user: "operator" },

    system: {
        timezone: home.timezone,
        dns: { servers: ["1.1.1.1", "1.0.0.1"] },
        ntp: { servers: ["pool.ntp.org"] },
        users: { operator: { role: "admin", password: secret("ROUTER_PASSWORD") } },
    },
    management: { allow: [home.addresses.management], ssh: {} },

    interfaces: {
        ethernet: {
            "1g-1": { description: "Internet provider", addresses: ["203.0.113.2/30"] },
            "25g-1": {
                description: "switch 10GE1/0/1",
                speed: "10g",
                trunk_vlans: ["mgmt", "home", "guests"],
                link: { device: "switch", port: "10g-1" },
            },
        },
        // The gateway of each VLAN.
        vlan_interface: {
            mgmt: { vlan: "mgmt", addresses: [home.addresses.router] },
            home: { vlan: "home", addresses: ["192.168.20.1/24"] },
            guests: { vlan: "guests", addresses: ["192.168.30.1/24"] },
        },
    },
    switching: {
        vlans: home.vlans,
    },

    services: {
        dns_server: true,
        ntp_server: true,
        dhcp_server: {
            home: {
                interface: "home",
                network: "192.168.20.0/24",
                gateway: "192.168.20.1",
                dns: ["192.168.20.1"],
                pool: ["192.168.20.100", "192.168.20.200"],
            },
            guests: {
                interface: "guests",
                network: "192.168.30.0/24",
                gateway: "192.168.30.1",
                dns: ["192.168.30.1"],
                pool: ["192.168.30.100", "192.168.30.200"],
                lease_time: 3600,
            },
        },
    },

    routing: {
        static_routes: [{ prefix: presets.default_routes.ipv4, next_hop: "203.0.113.1", description: "Internet provider" }],
    },

    firewall: {
        filter: {
            // Traffic to the router itself.
            input: {
                default_action: "drop",
                rules: [
                    { description: "Replies", if: { connection_state: ["established", "related"] }, then: "accept" },
                    { description: "Ping", if: { protocol: "icmp" }, then: "accept" },
                    { description: "Management", if: { src: home.addresses.management }, then: "accept" },
                    { description: "DNS from home", if: { in_interface: "home", protocol: "udp", dst_port: 53 }, then: "accept" },
                    { description: "DNS from guests", if: { in_interface: "guests", protocol: "udp", dst_port: 53 }, then: "accept" },
                ],
            },
            // Traffic through the router: home and guests reach the internet, and nothing else gets through.
            forward: {
                default_action: "drop",
                rules: [
                    { description: "Replies", if: { connection_state: ["established", "related"] }, then: "accept", fast_path: true },
                    { description: "Home to the internet", if: { in_interface: "home", out_interface: "1g-1" }, then: "accept" },
                    { description: "Guests to the internet", if: { in_interface: "guests", out_interface: "1g-1" }, then: "accept" },
                ],
            },
        },
        nat: {
            source: [{ description: "Share the public address", if: { out_interface: "1g-1" }, then: "masquerade" }],
        },
    },
});
