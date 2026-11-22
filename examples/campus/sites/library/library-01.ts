// The library's router, a MikroTik RB5009, the border router (ABR) of area 0.0.0.1: the library and the field station behind it. The backbone sees the area as one route for each family, and doesn't see the archive at all.

import { campus, classes } from "../../circuit";

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
            "10g-1": { description: "Backbone VLAN, on the campus switches", addresses: ["10.255.1.2/24", "2001:db8:10:ff01::2/64"] },
            "1g-1": { description: "field-01 ether2", addresses: ["10.1.3.1/30"], link: { device: "field-01", port: "1g-1" } },
            "1g-2": { description: "Library switch", trunk_vlans: ["reading-rooms", "archive"] },
        },
        vlan_interface: {
            "reading-rooms": {
                vlan: "reading-rooms",
                addresses: ["10.1.1.1/24", "2001:db8:10:101::1/64"],
                ipv6_ra: true,
                scheduler: "wifi",
            },
            archive: { vlan: "archive", addresses: ["10.1.200.1/24"] },
        },
        loopback: { loopback: { addresses: ["10.255.0.2/32", "2001:db8:10:ffff::2/128"] } },
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
            address_families: ["ipv4", "ipv6"],
            areas: {
                // Priority 0: this router never becomes the backbone VLAN's DR or its backup.
                "0.0.0.0": { interfaces: { "10g-1": { priority: 0, cost: 10, bfd: true }, loopback: { passive: true } } },
                // Totally stubby: the field station needs no route but a default one, which this router announces at cost 10.
                "0.0.0.1": {
                    type: "stub",
                    no_summaries: true,
                    stub_default_cost: 10,
                    ranges: [
                        { prefix: "10.1.0.0/17", advertise: true },
                        { prefix: "2001:db8:10:100::/56", advertise: true },
                        // Only the area reaches the archive.
                        { prefix: "10.1.128.0/17", advertise: false },
                    ],
                    interfaces: {
                        "reading-rooms": { passive: true },
                        archive: { passive: true },
                        "1g-1": { network: "point-to-point" },
                    },
                },
            },
        },
    },

    // The reading rooms' access points carry about 300 Mbit/s in all, less than the port's 1G, so the router queues what it sends them. Calls go first, and the rest share what is left.
    qos: {
        // #region class
        // The laptops' software updates come from the mirror in the data center, unmarked. Here they wait in the bulk queue, behind the readers' own traffic, and leave with the DSCP they came with.
        marking: [{ description: "Software updates", if: { src: ["10.2.0.30/32", "2001:db8:10:200::30/128"] }, then: { class: "bulk" } }],
        // #endregion class
        classes,
        default_class: "best-effort",
        schedulers: {
            wifi: {
                rate: "300M",
                queues: [
                    { class: "network", priority: "strict", max: "5M" },
                    { class: "voice", priority: "strict", max: "30M" },
                    { class: "video", share: 30 },
                    { class: "best-effort", share: 60 },
                    { class: "bulk", share: 10 },
                ],
            },
        },
    },
});
