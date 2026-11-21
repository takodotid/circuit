// The library's router, a MikroTik RB5009, the border router (ABR) of the library's area, 0.0.0.1. The backbone sees the library as one route, and doesn't see the archive at all. A radio links it to the observatory and the boathouse, which don't hear each other.

import { campus } from "../../circuit";

export default campus.device({
    name: "library-01",
    site: "library",
    role: "Building router",
    platform: "routeros",
    model: "RB5009UG+S+",
    connection: { host: "10.0.0.2", user: "operator" },

    system: {
        users: { operator: { role: "admin", password: secret("LIBRARY_01_PASSWORD") } },
    },
    management: { allow: ["10.0.0.0/24"], ssh: {} },

    interfaces: {
        ethernet: {
            "2.5g-1": { description: "Management", addresses: ["10.0.0.2/24"] },
            "10g-1": { description: "Backbone VLAN, on the campus switches", addresses: ["10.255.1.2/24"] },
            "1g-1": { description: "Radio to the observatory and the boathouse", addresses: ["10.1.2.1/28"] },
            "1g-2": { description: "Library switch", trunk_vlans: ["reading-rooms", "archive"] },
        },
        vlan_interface: {
            "reading-rooms": { vlan: "reading-rooms", addresses: ["10.1.1.1/24"] },
            archive: { vlan: "archive", addresses: ["10.1.200.1/24"] },
        },
        loopback: { loopback: { addresses: ["10.255.0.2/32"] } },
    },
    switching: {
        vlans: {
            "reading-rooms": { id: 11, description: "Reading rooms' Wi-Fi" },
            archive: { id: 12, description: "The archive's scanners" },
        },
    },

    routing: {
        router_id: "10.255.0.2",
        ospf: {
            areas: {
                // Priority 0: this router never becomes the backbone VLAN's DR or its backup.
                "0.0.0.0": { interfaces: { "10g-1": { priority: 0 }, loopback: { passive: true } } },
                "0.0.0.1": {
                    ranges: [
                        { prefix: "10.1.0.0/17", advertise: true },
                        // Only the library reaches the archive.
                        { prefix: "10.1.128.0/17", advertise: false },
                    ],
                    interfaces: {
                        "reading-rooms": { passive: true },
                        archive: { passive: true },
                        // Each station hears this router but not the other, so OSPF treats the radio as a point-to-point link to each.
                        "1g-1": { network: "point-to-multipoint" },
                    },
                },
            },
        },
    },
});
