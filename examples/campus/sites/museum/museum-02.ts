// The galleries' router, a MikroTik RB5009. The galleries ran their own OSPF area, 0.0.0.3, before the museum joined the campus, and kept it. Its only link is the fiber to museum-01, in area 0.0.0.2. A virtual link to museum-01 across that area joins it to the backbone, until the galleries move into area 0.0.0.2.

import { campus } from "../../circuit";

export default campus.device({
    name: "museum-02",
    site: "museum",
    role: "Galleries router",
    platform: "routeros",
    model: "RB5009UG+S+",
    connection: { host: "10.255.0.5", user: "operator" },

    system: {
        users: { operator: { role: "admin", password: secret("MUSEUM_02_PASSWORD") } },
    },
    management: { allow: ["10.0.0.0/24"], ssh: {} },

    interfaces: {
        ethernet: {
            "1g-1": { description: "museum-01 10GE1/0/2, the fiber to the entrance hall", addresses: ["10.255.2.2/30"] },
            "1g-2": { description: "Galleries switch", addresses: ["10.4.1.1/24"] },
        },
        loopback: { loopback: { addresses: ["10.255.0.5/32"] } },
    },

    routing: {
        router_id: "10.255.0.5",
        ospf: {
            areas: {
                "0.0.0.0": { virtual_links: [{ transit_area_id: "0.0.0.2", router_id: "10.255.0.4" }], interfaces: {} },
                "0.0.0.2": { interfaces: { "1g-1": { network: "point-to-point" } } },
                // The other areas see the galleries as one route, at cost 50 whatever the links inside cost.
                "0.0.0.3": {
                    ranges: [{ prefix: "10.4.0.0/16", advertise: true, cost: 50 }],
                    interfaces: { "1g-2": { passive: true }, loopback: { passive: true } },
                },
            },
        },
    },
});
