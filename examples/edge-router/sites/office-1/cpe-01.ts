// The router of a sales office of our own, on the OLT like any home. It logs in to bng-01 with PPPoE and takes its IPv4 address from the session. It asks for a /56 of IPv6 too, and gives the office a /64 of it, and makes its own IPv6 address on the session by SLAAC.

import { as64500 } from "../../circuit";

export default as64500.device({
    name: "cpe-01",
    site: "office-1",
    role: "Office router",
    platform: "routeros",
    model: "RB5009UG+S+",
    connection: { host: "192.168.10.1", user: "operator" },

    system: {
        timezone: "Asia/Jakarta",
        dns: { servers: ["198.51.100.53", "198.51.100.54"] },
        ntp: { servers: ["pool.ntp.org"] },
        users: { operator: { role: "admin", password: secret("CPE_01_PASSWORD") } },
    },
    management: { allow: ["192.168.10.0/24"], ssh: {} },

    // The ONT is a bridge, so the session runs on the port itself. The office's /64 is the delegated prefix with ::1 for the router, and the router announces it, so each host makes its own address.
    interfaces: {
        ethernet: {
            "2.5g-1": { description: "ONT" },
            "1g-1": { description: "Office", addresses: ["192.168.10.1/24"], ipv6_ra: true },
        },
        pppoe_client: {
            internet: {
                interface: "2.5g-1",
                description: "bng-01",
                user: "office-1",
                password: secret("CPE_01_PPPOE_PASSWORD"),
                service_name: "as64500",
                mtu: 1492,
                prefix_delegation: { prefix_length: 56, interfaces: { "1g-1": "::1" } },
                // Its own address on the session, from the /64 bng-01 announces there.
                slaac: true,
            },
        },
    },
    routing: {
        static_routes: [
            { prefix: presets.default_routes.ipv4, interface: "internet", description: "bng-01" },
            { prefix: presets.default_routes.ipv6, interface: "internet", description: "bng-01" },
        ],
    },

    services: {
        dns_server: true,
        dhcp_server: {
            office: {
                interface: "1g-1",
                network: "192.168.10.0/24",
                gateway: "192.168.10.1",
                dns: ["192.168.10.1"],
                pool: ["192.168.10.100", "192.168.10.200"],
            },
        },
    },

    firewall: {
        filter: {
            input: {
                default_action: "drop",
                rules: [
                    { description: "Replies", if: { connection_state: ["established", "related"] }, then: "accept" },
                    // ICMPv6 too, which IPv6 needs to find neighbors.
                    { description: "Ping", if: { protocol: "icmp" }, then: "accept" },
                    // The delegated prefix arrives from bng-01's link-local address, to the DHCPv6 client's port (RFC 8415).
                    {
                        description: "DHCPv6 from bng-01",
                        if: { in_interface: "internet", src: "fe80::/10", protocol: "udp", dst_port: 546 },
                        then: "accept",
                    },
                    { description: "Management", if: { src: "192.168.10.0/24" }, then: "accept" },
                    {
                        description: "DNS from the office",
                        if: { in_interface: "1g-1", protocol: "udp", dst_port: presets.ports.dns },
                        then: "accept",
                    },
                ],
            },
            // The office reaches the internet, and nothing from the internet reaches the office's hosts, by either family.
            forward: {
                default_action: "drop",
                rules: [
                    { description: "Replies", if: { connection_state: ["established", "related"] }, then: "accept", fast_path: true },
                    { description: "The office to the internet", if: { in_interface: "1g-1", out_interface: "internet" }, then: "accept" },
                ],
            },
        },
        nat: {
            source: [
                {
                    description: "Share the session's address",
                    if: { src: "192.168.10.0/24", out_interface: "internet" },
                    then: "masquerade",
                },
            ],
        },
    },
});
