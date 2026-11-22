// A metro router, a MikroTik CCR2216, linked to ring-02 and ring-01. A pseudowire carries the TV station's frames from studio 2 back to studio 1 at ring-01, in a tunnel that takes the long way round the ring, through ring-02.

import { as64500 } from "../../circuit";

export default as64500.device({
    name: "ring-03",
    site: "south",
    role: "Metro router",
    platform: "routeros",
    model: "CCR2216-1G-12XS-2XQ",
    connection: { host: "10.1.3.1", user: "operator" },

    system: {
        users: { operator: { role: "admin", password: secret("RING_03_PASSWORD") } },
    },
    management: { allow: ["10.1.0.0/16"], ssh: {} },

    interfaces: {
        ethernet: {
            "1g-1": { description: "Management", addresses: ["10.1.3.1/24"] },
            "25g-1": { description: "TV station, studio 2", access_vlan: "tv" },
            "100g-1": {
                description: "ring-02 qsfp28-2-1",
                addresses: ["10.1.23.2/30"],
                link: { device: "ring-02", port: "100g-2" },
            },
            "100g-2": {
                description: "ring-01 qsfp28-2-1",
                addresses: ["10.1.13.2/30"],
                link: { device: "ring-01", port: "100g-2" },
            },
        },
        loopback: { loopback: { addresses: ["10.255.1.3/32"] } },
        pseudowire: {
            "pw-tv": { description: "TV station, to studio 1 at ring-01", peer: "10.255.1.1", pw_id: 401, access_vlan: "tv" },
        },
    },

    switching: {
        vlans: {
            tv: { id: 401, description: "TV station, studios 1 and 2" },
        },
    },

    routing: {
        router_id: "10.255.1.3",
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
            ldp: { lsr_id: "10.255.1.3", interfaces: ["100g-1", "100g-2"] },
            // The tunnel to ring-01 follows its hops: strict to ring-02 by its address on the link from here, then strict to ring-01 by its address on the link from ring-02.
            rsvp_te: {
                interfaces: { "100g-1": { bandwidth: "40G" }, "100g-2": { bandwidth: "40G" } },
                tunnels: {
                    "ring-01": {
                        description: "TV station, to studio 1",
                        destination: "10.255.1.1",
                        bandwidth: "10G",
                        explicit_path: [
                            { address: "10.1.23.1", hop_type: "strict" },
                            { address: "10.1.12.1", hop_type: "strict" },
                        ],
                    },
                },
            },
        },
    },
});
