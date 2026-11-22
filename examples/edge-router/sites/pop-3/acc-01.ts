// The router of a small point of presence in the next town, linked to bng-01. The homes of an apartment block are on its first 1G port, each held to its own rate, and take their address by DHCP from bng-01, which the router relays. The relay adds Option 82, so the RADIUS servers let the block's homes in by their line.

import { as64500 } from "../../circuit";

export default as64500.device({
    name: "acc-01",
    site: "pop-3",
    role: "Access router",
    platform: "routeros",
    model: "RB5009UG+S+",
    connection: { host: "198.51.100.110", user: "operator" },

    system: {
        timezone: "Asia/Jakarta",
        ntp: { servers: ["pool.ntp.org"] },
        users: { operator: { role: "admin", password: secret("ACC_01_PASSWORD") } },
    },
    management: { allow: ["10.0.0.0/24"], ssh: {} },

    interfaces: {
        ethernet: {
            "10g-1": { description: "bng-01", addresses: ["198.51.100.110/30"] },
            // Each home gets the 100 Mbit/s down and 20 up it pays for: its address, and the /56 the network gives a home in IPv6.
            "1g-1": {
                description: "Apartment block",
                addresses: ["100.64.128.1/24"],
                rate_limit: { per_prefix: { ipv4: 32, ipv6: 56, input: "20M", output: "100M" } },
            },
        },
    },
    routing: {
        static_routes: [{ prefix: presets.default_routes.ipv4, next_hop: "198.51.100.109", description: "bng-01" }],
    },

    // The circuit ID is the MAC address of 1g-1 on RouterOS: the RADIUS servers know it as the block's line.
    services: {
        dhcp_relay: {
            "block-a": { interface: "1g-1", servers: ["198.51.100.109"], relay_agent_information: true },
        },
    },
});
