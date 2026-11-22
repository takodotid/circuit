// A provider edge router, a MikroTik CCR2216, one link away from pe-02. IS-IS carries its loopback, and LDP labels each loopback. pe-01 is no neighbor, so a targeted LDP session joins the two across pe-02. BGP joins the school's campuses at pe-01 and pe-02, and the library's branch at pe-01 (VPLS). A pseudowire carries the TV station's two VLANs to pe-02, with their tags.

import { as64500 } from "../../circuit";

export default as64500.device({
    name: "pe-03",
    site: "pop-3",
    role: "Provider edge router",
    platform: "routeros",
    model: "CCR2216-1G-12XS-2XQ",
    connection: { host: "10.0.3.1", user: "operator" },

    system: {
        users: { operator: { role: "admin", password: secret("PE_03_PASSWORD") } },
    },
    management: { allow: ["10.0.0.0/16"], ssh: {} },

    interfaces: {
        ethernet: {
            "1g-1": { description: "Management", addresses: ["10.0.3.1/24"] },
            "25g-1": { description: "School, campus 3", access_vlan: "school" },
            "25g-2": { description: "Library, branch 2", access_vlan: "library" },
            "25g-3": { description: "TV station, site 2", trunk_vlans: ["tv-studio", "tv-news"] },
            "100g-1": { description: "pe-02 qsfp28-2-1", addresses: ["10.0.23.2/30"], link: { device: "pe-02", port: "100g-2" } },
        },
        loopback: { loopback: { addresses: ["10.255.0.3/32"] } },
        pseudowire: {
            "pw-tv": {
                description: "TV station, to site 1 at pe-02",
                peer: "10.255.0.2",
                pw_id: 401,
                trunk_vlans: ["tv-studio", "tv-news"],
            },
        },
    },

    switching: {
        vlans: {
            // The TV station's two VLANs cross the core to pe-03 on one pseudowire, each frame with its tag.
            "tv-studio": { id: 401, description: "TV station, studio" },
            "tv-news": { id: 402, description: "TV station, newsroom" },
            // The school's campuses share one LAN: BGP finds the other PEs with the school's route target, and sets up a pseudowire to each.
            school: {
                id: 301,
                description: "School, campuses 1 to 3",
                vpls: { route_distinguisher: "64500:301", route_targets: { import: ["64500:301"], export: ["64500:301"] }, site_id: 3 },
            },
            // The library's two branches share one LAN as well: BGP finds the other PE, and LDP sets up the pseudowire (RFC 6074).
            library: {
                id: 302,
                description: "Library, branches 1 and 2",
                vpls: {
                    route_distinguisher: "64500:302",
                    route_targets: { import: ["64500:302"], export: ["64500:302"] },
                    vpls_id: "64500:302",
                },
            },
        },
    },

    routing: {
        router_id: "10.255.0.3",
        // In area 49.0001, at level 2 only, as pe-01 and pe-02 are.
        isis: {
            net: "49.0001.0102.5500.0003.00",
            level_capability: "level-2",
            address_families: ["ipv4"],
            interfaces: {
                loopback: { passive: true },
                "100g-1": { network: "point-to-point", metric: 10 },
            },
        },
        // LDP runs on the link to pe-02, and labels the loopbacks only. The targeted session to pe-01 needs a target back there, which pe-01 has.
        mpls: {
            ldp: {
                lsr_id: "10.255.0.3",
                interfaces: ["100g-1"],
                targets: ["10.255.0.1"],
                import_policy: "loopbacks",
                export_policy: "loopbacks",
                // Over the session with pe-01, only the two loopbacks' own labels, as pe-01 gives.
                neighbors: { "10.255.0.1": { import_policy: "pe-01-loopback", export_policy: "own-loopback" } },
            },
        },
        // The iBGP sessions between the loopbacks carry the school's and the library's VPLS routes, and no other routes.
        bgp: {
            neighbors: {
                "pe-01": {
                    description: "pe-01, VPLS routes",
                    address: "10.255.0.1",
                    remote_as: 64500,
                    local_address: "10.255.0.3",
                    address_families: ["l2vpn-vpls"],
                },
                "pe-02": {
                    description: "pe-02, VPLS routes",
                    address: "10.255.0.2",
                    remote_as: 64500,
                    local_address: "10.255.0.3",
                    address_families: ["l2vpn-vpls"],
                },
            },
        },
        prefix_sets: {
            loopbacks: { prefixes: ["10.255.0.0/24"] },
        },
        policies: {
            loopbacks: [{ if: { prefix_set: "loopbacks" }, then: "accept" }, { then: "reject" }],
            "own-loopback": [{ if: { prefix: "10.255.0.3/32" }, then: "accept" }, { then: "reject" }],
            "pe-01-loopback": [{ if: { prefix: "10.255.0.1/32" }, then: "accept" }, { then: "reject" }],
        },
    },
});
