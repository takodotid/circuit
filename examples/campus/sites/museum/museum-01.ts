// The museum's router, a MikroTik RB5009, across the road from the library. The museum runs IPv4 only. The campus switches carry the backbone VLAN to it, so it is in the backbone, and a fiber leads to the galleries' router in area 0.0.0.2.

import { campus } from "../../circuit";

export default campus.device({
    name: "museum-01",
    site: "museum",
    role: "Building router",
    platform: "routeros",
    model: "RB5009UG+S+",
    connection: { host: "10.255.0.4", user: "operator" },

    system: {
        users: { operator: { role: "admin", password: secret("MUSEUM_01_PASSWORD") } },
    },
    management: { allow: ["10.0.0.0/24"], ssh: {} },

    interfaces: {
        ethernet: {
            "1g-1": { description: "Backbone VLAN, on the campus switches", addresses: ["10.255.1.4/24"] },
            "1g-2": {
                description: "museum-02 ether2, the fiber to the galleries",
                addresses: ["10.255.2.1/30"],
                link: { device: "museum-02", port: "1g-1" },
            },
        },
        loopback: { loopback: { addresses: ["10.255.0.4/32"] } },
    },

    routing: {
        router_id: "10.255.0.4",
        ospf: {
            areas: {
                "0.0.0.0": {
                    // museum-02 has no link into the backbone: this virtual link, across area 0.0.0.2, is its way in.
                    virtual_links: [{ transit_area_id: "0.0.0.2", router_id: "10.255.0.5" }],
                    interfaces: { "1g-1": { priority: 0 }, loopback: { passive: true } },
                },
                "0.0.0.2": { interfaces: { "1g-2": { network: "point-to-point" } } },
            },
        },
    },
});
