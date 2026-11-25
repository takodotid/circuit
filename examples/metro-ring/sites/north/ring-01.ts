// A metro router, a MikroTik CCR2216, linked to ring-02 by a short span of dark fiber, and to ring-03 by a long one. OSPF carries its loopback and the bandwidth and admin groups of its links, and LDP labels each loopback. Two pseudowires leave here, each in a tunnel whose path CSPF computes: the TV station's to studio 2 at ring-03, and the hospital's to its clinic at ring-02.

import { as64500 } from "../../circuit";

export default as64500.device({
    name: "ring-01",
    site: "north",
    role: "Metro router",
    platform: "routeros",
    model: "CCR2216-1G-12XS-2XQ",
    connection: { host: "10.1.1.1", user: "operator" },

    system: {
        users: { operator: { role: "admin", password: secret("RING_01_PASSWORD") } },
    },
    management: { allow: ["10.1.0.0/16"], ssh: {} },

    interfaces: {
        ethernet: {
            "1g-1": { description: "Management", addresses: ["10.1.1.1/24"] },
            "25g-1": { description: "TV station, studio 1", access_vlan: "tv" },
            "25g-2": { description: "Hospital, main site", access_vlan: "hospital" },
            "100g-1": {
                description: "ring-02 qsfp28-1-1",
                addresses: ["10.1.12.1/30"],
                link: { device: "ring-02", port: "100g-1" },
            },
            "100g-2": {
                description: "ring-03 qsfp28-2-1",
                addresses: ["10.1.13.1/30"],
                link: { device: "ring-03", port: "100g-2" },
            },
        },
        loopback: { loopback: { addresses: ["10.255.1.1/32"] } },
        pseudowire: {
            "pw-tv": { description: "TV station, to studio 2 at ring-03", peer: "10.255.1.3", pw_id: 401, access_vlan: "tv" },
            "pw-hospital": { description: "Hospital, to its clinic at ring-02", peer: "10.255.1.2", pw_id: 402, access_vlan: "hospital" },
        },
    },

    switching: {
        vlans: {
            // Each customer's port and its pseudowire, alone in one VLAN.
            tv: { id: 401, description: "TV station, studios 1 and 2" },
            hospital: { id: 402, description: "Hospital, main site and clinic" },
        },
    },

    routing: {
        router_id: "10.255.1.1",
        // OSPF tells every router of the ring the bandwidth each link has left for tunnels, and its admin groups.
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
            ldp: { lsr_id: "10.255.1.1", interfaces: ["100g-1", "100g-2"] },
            // Tunnels may reserve 40G of each link. Every router of the ring writes the same admin groups.
            rsvp_te: {
                admin_groups: { "dark-fiber": 0, wave: 1, protected: 2, "low-latency": 3 },
                interfaces: {
                    "100g-1": { bandwidth: "40G", admin_groups: ["dark-fiber", "low-latency"] },
                    "100g-2": { bandwidth: "40G", admin_groups: ["dark-fiber"] },
                },
                tunnels: {
                    // The TV station comes first: its tunnel takes the bandwidth of any other, and no other takes its own. It reserves 10G along the shortest path off the carrier's wave, the direct link. Should that link fail, it moves at once to its path around the ring, which it holds ready.
                    "ring-03": {
                        description: "TV station, to studio 2",
                        destination: "10.255.1.3",
                        bandwidth: "10G",
                        cspf: true,
                        admin_groups: { exclude_group: ["wave"] },
                        secondary_paths: {
                            "ring-03-around": {
                                explicit_path: [
                                    { address: "10.1.12.2", hop_type: "strict" },
                                    { address: "10.1.23.2", hop_type: "strict" },
                                ],
                                standby: true,
                            },
                        },
                        setup_priority: 0,
                        hold_priority: 0,
                        record_route: true,
                    },
                    // The hospital's video consults keep to the short span. While it is down, the tunnel takes a path that shares no link with it.
                    "ring-02": {
                        description: "Hospital, to its clinic",
                        destination: "10.255.1.2",
                        bandwidth: "2G",
                        cspf: true,
                        admin_groups: { include_all_group: ["low-latency"] },
                        secondary_paths: {
                            "ring-02-around": { cspf: true, admin_groups: { exclude_group: ["low-latency"] } },
                        },
                    },
                },
            },
        },
    },
});
