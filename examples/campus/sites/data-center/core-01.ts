// The core router, a MikroTik CCR2216, in the backbone, area 0.0.0.0, for IPv4 and IPv6. Every building's router joins the backbone VLAN with priority 0, so this router is always its designated router (DR).

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
            "25g-1": { description: "Backbone VLAN, on the campus switches", addresses: ["10.255.1.1/24", "2001:db8:10:ff01::1/64"] },
            "25g-2": { description: "Servers", addresses: ["10.2.0.1/24", "2001:db8:10:200::1/64"] },
        },
        loopback: { loopback: { addresses: ["10.255.0.1/32", "2001:db8:10:ffff::1/128"] } },
    },

    routing: {
        router_id: "10.255.0.1",
        static_routes: [{ prefix: "10.3.0.0/16", next_hop: "10.2.0.254", description: "Research labs, behind their own firewall" }],
        ospf: {
            address_families: ["ipv4", "ipv6"],
            // The labs' route reaches every router outside a stub area.
            redistribute: ["static"],
            areas: {
                "0.0.0.0": {
                    interfaces: {
                        // BFD notices a building router gone in under a second.
                        "25g-1": { priority: 255, cost: 10, bfd: true },
                        "25g-2": { passive: true },
                        // The field station's router is managed from here, over OSPF.
                        "1g-1": { passive: true },
                        loopback: { passive: true },
                    },
                },
            },
        },
    },
});
