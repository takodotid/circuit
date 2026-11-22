// A metro router, a MikroTik CCR2216, linked to ring-02 and ring-03. OSPF carries its loopback and the bandwidth of its links, and LDP labels each loopback. A pseudowire carries the TV station's frames from studio 1 to studio 2 at ring-03, in a tunnel whose path CSPF computes. The tunnel holds a path around the ring ready.

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
        },
    },

    switching: {
        vlans: {
            // The studio's port and its pseudowire, alone in one VLAN.
            tv: { id: 401, description: "TV station, studios 1 and 2" },
        },
    },

    routing: {
        router_id: "10.255.1.1",
        // OSPF tells every router of the ring the bandwidth each link has left for tunnels.
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
            // Tunnels may reserve 40G of each link. The pseudowire to ring-03 crosses in the tunnel to ring-03, which reserves 10G along the shortest path that has it. Should that path fail, the tunnel moves at once to its path around the ring, which it holds ready.
            rsvp_te: {
                interfaces: { "100g-1": { bandwidth: "40G" }, "100g-2": { bandwidth: "40G" } },
                tunnels: {
                    "ring-03": {
                        description: "TV station, to studio 2",
                        destination: "10.255.1.3",
                        bandwidth: "10G",
                        cspf: true,
                        secondary_paths: {
                            "ring-03-around": {
                                explicit_path: [
                                    { address: "10.1.12.2", hop_type: "strict" },
                                    { address: "10.1.23.2", hop_type: "strict" },
                                ],
                                standby: true,
                            },
                        },
                    },
                },
            },
        },
    },
});
