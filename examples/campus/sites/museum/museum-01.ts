// The museum's router, a Huawei CloudEngine switch, across the road from the library. The museum runs IPv4 only. The campus switches carry the backbone VLAN to it, so it is in the backbone. A fiber leads to the galleries' router, and a carrier's line to the depot, the museum's store across town, both in area 0.0.0.2.

import { campus } from "../../circuit";

export default campus.device({
    name: "museum-01",
    site: "museum",
    role: "Building router",
    platform: "vrp",
    model: "CE6855-48S6Q-HI",
    connection: { host: "10.255.1.4", user: "operator" },

    system: {
        users: { operator: { role: "admin", password: secret("MUSEUM_01_PASSWORD") } },
    },
    management: { allow: ["10.0.0.0/24"], ssh: {} },

    // A switch routes between VLAN interfaces, so each routed port is in a VLAN of its own.
    interfaces: {
        ethernet: {
            "10g-1": { description: "Backbone VLAN, on the campus switches", access_vlan: "backbone" },
            "10g-2": { description: "museum-02 ether2, the fiber to the galleries", access_vlan: "galleries" },
            "10g-3": { description: "Entrance hall switch", access_vlan: "entrance" },
            "10g-4": { description: "Carrier's line to the depot", access_vlan: "depot" },
        },
        vlan_interface: {
            backbone: { vlan: "backbone", addresses: ["10.255.1.4/24"] },
            galleries: { vlan: "galleries", addresses: ["10.255.2.1/30"] },
            entrance: { vlan: "entrance", addresses: ["10.5.1.1/24"] },
            depot: { vlan: "depot", addresses: ["10.5.9.1/29"] },
        },
    },
    switching: {
        vlans: {
            backbone: { id: 100, description: "The campus backbone" },
            galleries: { id: 102, description: "The fiber to the galleries" },
            entrance: { id: 110, description: "The entrance hall" },
            depot: { id: 190, description: "The carrier's line to the depot" },
        },
    },

    routing: {
        router_id: "10.255.0.4",
        ospf: {
            areas: {
                "0.0.0.0": {
                    // museum-02 has no link into the backbone: this virtual link, across area 0.0.0.2, is its way in.
                    virtual_links: [{ transit_area_id: "0.0.0.2", router_id: "10.255.0.5" }],
                    interfaces: { backbone: { priority: 0 } },
                },
                "0.0.0.2": {
                    // The other areas see the museum's own networks as one route, at cost 20.
                    ranges: [{ prefix: "10.5.0.0/16", advertise: true, cost: 20 }],
                    interfaces: {
                        galleries: { network: "point-to-point" },
                        entrance: { passive: true },
                        // NBMA: the carrier's line carries no multicast, so OSPF sends its hellos to the depot's router itself.
                        depot: { network: "non-broadcast", neighbors: ["10.5.9.2"] },
                    },
                },
            },
        },
    },
});
