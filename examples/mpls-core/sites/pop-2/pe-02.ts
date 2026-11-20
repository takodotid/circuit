// A provider edge router, a MikroTik CCR2216. IS-IS carries its loopback to pe-01, and LDP gives each loopback a label, so traffic between the two crosses the core by label.

import { as64500 } from "../../circuit";

export default as64500.device({
    name: "pe-02",
    site: "pop-2",
    role: "Provider edge router",
    platform: "routeros",
    model: "CCR2216-1G-12XS-2XQ",
    connection: { host: "10.0.2.1", user: "operator" },

    system: {
        users: { operator: { role: "admin", password: secret("PE_02_PASSWORD") } },
    },
    management: { allow: ["10.0.0.0/16"], ssh: {} },

    interfaces: {
        ethernet: {
            "1g-1": { description: "Management", addresses: ["10.0.2.1/24"] },
            "100g-1": { description: "pe-01 qsfp28-1-1", addresses: ["10.0.12.2/30"], link: { device: "pe-01", port: "100g-1" } },
        },
        loopback: { loopback: { addresses: ["10.255.0.2/32"] } },
    },

    routing: {
        router_id: "10.255.0.2",
        // Both routers are in area 49.0001, at level 2 only. The system ID is the loopback address.
        isis: {
            net: "49.0001.0102.5500.0002.00",
            level_capability: "level-2",
            address_families: ["ipv4"],
            interfaces: {
                loopback: { passive: true },
                "100g-1": { network: "point-to-point", metric: 10 },
            },
        },
        // The LSR ID is the loopback, which IS-IS announces. LDP runs on the link to pe-01.
        mpls: { ldp: { lsr_id: "10.255.0.2", interfaces: ["100g-1"] } },
    },
});
