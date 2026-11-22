// A metro router, a MikroTik CCR2216, linked to ring-01 by a short span of dark fiber, and to ring-03 by a carrier's protected wave. It runs RSVP-TE on both links for the tunnels that cross it, such as the TV station's from ring-03 to ring-01. It starts the hospital's tunnel back to its main site at ring-01.

import { as64500 } from "../../circuit";

export default as64500.device({
    name: "ring-02",
    site: "east",
    role: "Metro router",
    platform: "routeros",
    model: "CCR2216-1G-12XS-2XQ",
    connection: { host: "10.1.2.1", user: "operator" },

    system: {
        users: { operator: { role: "admin", password: secret("RING_02_PASSWORD") } },
    },
    management: { allow: ["10.1.0.0/16"], ssh: {} },

    interfaces: {
        ethernet: {
            "1g-1": { description: "Management", addresses: ["10.1.2.1/24"] },
            "25g-1": { description: "Hospital, clinic", access_vlan: "hospital" },
            "100g-1": {
                description: "ring-01 qsfp28-1-1",
                addresses: ["10.1.12.2/30"],
                link: { device: "ring-01", port: "100g-1" },
            },
            "100g-2": {
                description: "ring-03 qsfp28-1-1",
                addresses: ["10.1.23.1/30"],
                link: { device: "ring-03", port: "100g-1" },
            },
        },
        loopback: { loopback: { addresses: ["10.255.1.2/32"] } },
        pseudowire: {
            "pw-hospital": {
                description: "Hospital, to its main site at ring-01",
                peer: "10.255.1.1",
                pw_id: 402,
                access_vlan: "hospital",
            },
        },
    },

    switching: {
        vlans: {
            hospital: { id: 402, description: "Hospital, main site and clinic" },
        },
    },

    routing: {
        router_id: "10.255.1.2",
        ospf: {
            areas: {
                "0.0.0.0": {
                    traffic_engineering: true,
                    interfaces: {
                        loopback: { passive: true },
                        "100g-1": { network: "point-to-point" },
                        "100g-2": { network: "point-to-point" },
                    },
                },
            },
        },
        mpls: {
            ldp: { lsr_id: "10.255.1.2", interfaces: ["100g-1", "100g-2"] },
            rsvp_te: {
                admin_groups: { "dark-fiber": 0, wave: 1, protected: 2, "low-latency": 3 },
                interfaces: {
                    "100g-1": { bandwidth: "40G", admin_groups: ["dark-fiber", "low-latency"] },
                    "100g-2": { bandwidth: "40G", admin_groups: ["wave", "protected"] },
                },
                tunnels: {
                    // The way back keeps to links that are short or protected: the short span to ring-01.
                    "ring-01": {
                        description: "Hospital, to its main site",
                        destination: "10.255.1.1",
                        bandwidth: "2G",
                        cspf: true,
                        admin_groups: { include_any_group: ["low-latency", "protected"] },
                    },
                },
            },
        },
    },
});
