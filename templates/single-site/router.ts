// The router: the internet connection, a gateway and DHCP for each VLAN, and the firewall.

import { defineDevice, secret } from "@takodotid/circuit";
import { MANAGEMENT, ROUTER, TIMEZONE, vlans } from "./site";

export default defineDevice({
    name: "router",
    platform: "routeros",
    model: "CCR2216-1G-12XS-2XQ",
    connection: { host: ROUTER, user: "operator" },
    users: { operator: { role: "admin", password: secret("ROUTER_PASSWORD") } },

    system: {
        timezone: TIMEZONE,
        dns: { servers: ["1.1.1.1", "1.0.0.1"], serve: true },
        ntp: { servers: ["pool.ntp.org"], serve: true },
    },
    management: { allow: [MANAGEMENT], ssh: {} },

    vlans,

    ports: {
        "1g-1": { description: "Internet provider", addresses: ["203.0.113.2/30"] },
        "25g-1": {
            description: "Switch",
            speed: "10g",
            trunk_vlans: ["mgmt", "home", "guests"],
            link: { device: "switch", port: "10g-1" },
        },
    },

    // The gateway of each VLAN.
    interfaces: {
        mgmt: { type: "vlan", vlan: "mgmt", addresses: [`${ROUTER}/24`] },
        home: { type: "vlan", vlan: "home", addresses: ["192.168.20.1/24"] },
        guests: { type: "vlan", vlan: "guests", addresses: ["192.168.30.1/24"] },
    },

    routing: { static: [{ prefix: "0.0.0.0/0", via: "203.0.113.1", description: "Internet provider" }] },

    dhcp: {
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

    firewall: {
        filter: {
            // Traffic to the router itself.
            input: {
                default: "drop",
                rules: [
                    { description: "Replies", match: { state: ["established", "related"] }, action: "accept" },
                    { description: "Ping", match: { protocol: "icmp" }, action: "accept" },
                    { description: "Management", match: { src: MANAGEMENT }, action: "accept" },
                    { description: "DNS from home", match: { in_interface: "home", protocol: "udp", dst_port: 53 }, action: "accept" },
                    { description: "DNS from guests", match: { in_interface: "guests", protocol: "udp", dst_port: 53 }, action: "accept" },
                ],
            },
            // Traffic passing through the router.
            forward: {
                rules: [
                    { description: "Replies", match: { state: ["established", "related"] }, action: "accept", offload: true },
                    {
                        description: "Guests stay off the home network",
                        match: { in_interface: "guests", out_interface: "home" },
                        action: "drop",
                    },
                    { description: "Guests stay off management", match: { in_interface: "guests", out_interface: "mgmt" }, action: "drop" },
                ],
            },
        },
        nat: {
            source: [{ description: "Share the public address", match: { out_interface: "1g-1" }, action: "masquerade" }],
        },
    },
});
