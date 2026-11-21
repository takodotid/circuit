// The core router, a MikroTik CCR2216, in the backbone, area 0.0.0.0. Every building's router joins the backbone VLAN with priority 0, so this router is always its designated router (DR). The farm's router is on a carrier's line that carries no multicast.

import { campus } from "../../circuit";

export default campus.device({
    name: "core-01",
    site: "data-center",
    role: "Core router",
    platform: "routeros",
    model: "CCR2216-1G-12XS-2XQ",
    connection: { host: "10.0.0.1", user: "operator" },

    system: {
        users: { operator: { role: "admin", password: secret("CORE_01_PASSWORD") } },
    },
    management: { allow: ["10.0.0.0/24"], ssh: {} },

    interfaces: {
        ethernet: {
            "1g-1": { description: "Management", addresses: ["10.0.0.1/24"] },
            "25g-1": { description: "Backbone VLAN, on the campus switches", addresses: ["10.255.1.1/24"] },
            "25g-2": { description: "Servers", addresses: ["10.2.0.1/24"] },
            "25g-3": { description: "Carrier's line to the farm", addresses: ["10.255.2.1/29"] },
        },
        loopback: { loopback: { addresses: ["10.255.0.1/32"] } },
    },

    routing: {
        router_id: "10.255.0.1",
        ospf: {
            areas: {
                "0.0.0.0": {
                    interfaces: {
                        "25g-1": { priority: 255 },
                        "25g-2": { passive: true },
                        // NBMA: OSPF sends its hellos to the farm's router itself, and this router is the line's DR too.
                        "25g-3": { network: "non-broadcast", priority: 255, neighbors: ["10.255.2.2"] },
                        loopback: { passive: true },
                    },
                },
            },
        },
    },
});
