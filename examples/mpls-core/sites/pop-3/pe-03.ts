// A provider edge router, a MikroTik CCR2216, one link away from pe-02 and with no customer yet. IS-IS carries its loopback, and LDP labels each loopback, so traffic to pe-01 crosses pe-02 by label. pe-01 is no neighbor, so a targeted LDP session joins the two across pe-02.

import { as64500 } from "../../circuit";

export default as64500.device({
    name: "pe-03",
    site: "pop-3",
    role: "Provider edge router",
    platform: "routeros",
    model: "CCR2216-1G-12XS-2XQ",
    connection: { host: "10.0.3.1", user: "operator" },

    system: {
        users: { operator: { role: "admin", password: secret("PE_03_PASSWORD") } },
    },
    management: { allow: ["10.0.0.0/16"], ssh: {} },

    interfaces: {
        ethernet: {
            "1g-1": { description: "Management", addresses: ["10.0.3.1/24"] },
            "100g-1": { description: "pe-02 qsfp28-2-1", addresses: ["10.0.23.2/30"], link: { device: "pe-02", port: "100g-2" } },
        },
        loopback: { loopback: { addresses: ["10.255.0.3/32"] } },
    },

    routing: {
        router_id: "10.255.0.3",
        // In area 49.0001, at level 2 only, as pe-01 and pe-02 are.
        isis: {
            net: "49.0001.0102.5500.0003.00",
            level_capability: "level-2",
            address_families: ["ipv4"],
            interfaces: {
                loopback: { passive: true },
                "100g-1": { network: "point-to-point", metric: 10 },
            },
        },
        // LDP runs on the link to pe-02, and labels the loopbacks only. The targeted session to pe-01 needs a target back there, which pe-01 has.
        mpls: {
            ldp: {
                lsr_id: "10.255.0.3",
                interfaces: ["100g-1"],
                targets: ["10.255.0.1"],
                import_policy: "loopbacks",
                export_policy: "loopbacks",
                // Over the session with pe-01, only the two loopbacks' own labels, as pe-01 gives.
                neighbors: { "10.255.0.1": { import_policy: "pe-01-loopback", export_policy: "own-loopback" } },
            },
        },
        prefix_sets: {
            loopbacks: { prefixes: ["10.255.0.0/24"] },
        },
        policies: {
            loopbacks: [{ if: { prefix_set: "loopbacks" }, then: "accept" }, { then: "reject" }],
            "own-loopback": [{ if: { prefix: "10.255.0.3/32" }, then: "accept" }, { then: "reject" }],
            "pe-01-loopback": [{ if: { prefix: "10.255.0.1/32" }, then: "accept" }, { then: "reject" }],
        },
    },
});
