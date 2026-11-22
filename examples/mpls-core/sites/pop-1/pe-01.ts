// A provider edge router, a MikroTik CCR2216. IS-IS carries its loopback to pe-02, and LDP labels each loopback, so traffic crosses the core by label. iBGP carries the bank's VRF to pe-02 (L3VPN), and joins the school and the library to their other sites (VPLS). A pseudowire carries the clinic's frames to pe-02 (VPWS). A targeted LDP session joins it to pe-03, across pe-02.

import { as64500 } from "../../circuit";

export default as64500.device({
    name: "pe-01",
    site: "pop-1",
    role: "Provider edge router",
    platform: "routeros",
    model: "CCR2216-1G-12XS-2XQ",
    connection: { host: "10.0.1.1", user: "operator" },

    system: {
        users: { operator: { role: "admin", password: secret("PE_01_PASSWORD") } },
    },
    management: { allow: ["10.0.0.0/16"], ssh: {} },

    interfaces: {
        ethernet: {
            "1g-1": { description: "Management", addresses: ["10.0.1.1/24"] },
            "25g-1": { description: "Bank, office 1", vrf: "bank", addresses: ["172.16.1.1/30"] },
            "25g-2": { description: "Clinic, site 1", access_vlan: "clinic" },
            "25g-3": { description: "School, campus 1", access_vlan: "school" },
            "25g-4": { description: "Library, branch 1", access_vlan: "library" },
            "100g-1": { description: "pe-02 qsfp28-1-1", addresses: ["10.0.12.1/30"], link: { device: "pe-02", port: "100g-1" } },
        },
        loopback: { loopback: { addresses: ["10.255.0.1/32"] } },
        // The clinic's frames cross the core to pe-02 on this pseudowire, which has the same pw_id, MTU, and control word there.
        pseudowire: {
            "pw-clinic": {
                description: "Clinic, to site 2 at pe-02",
                peer: "10.255.0.2",
                pw_id: 201,
                access_vlan: "clinic",
                mtu: 1500,
                control_word: true,
            },
        },
    },

    switching: {
        vlans: {
            // The clinic's port and its pseudowire, alone in one VLAN.
            clinic: { id: 201, description: "Clinic, sites 1 and 2" },
            // The school's campuses share one LAN: BGP finds the other PEs with the school's route target, and sets up a pseudowire to each.
            school: {
                id: 301,
                description: "School, campuses 1 to 3",
                vpls: { route_distinguisher: "64500:301", route_targets: { import: ["64500:301"], export: ["64500:301"] }, site_id: 1 },
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
        router_id: "10.255.0.1",
        // The bank's VRF, in an L3VPN with its VRF on pe-02: both export and import the bank's route target.
        vrfs: {
            bank: {
                description: "Bank, offices 1 and 2",
                route_distinguisher: "64500:101",
                route_targets: { import: ["64500:101"], export: ["64500:101"] },
                // Only the offices' networks cross the core, not the links to the bank's routers.
                import_policy: "bank-offices",
                export_policy: "bank-offices",
            },
        },
        static_routes: [{ prefix: "10.1.1.0/24", next_hop: "172.16.1.2", vrf: "bank", description: "Bank, office 1's network" }],
        // Both routers are in area 49.0001, at level 2 only. The system ID is the loopback address.
        isis: {
            net: "49.0001.0102.5500.0001.00",
            level_capability: "level-2",
            address_families: ["ipv4"],
            interfaces: {
                loopback: { passive: true },
                "100g-1": { network: "point-to-point", metric: 10 },
            },
        },
        // The LSR ID is the loopback, which IS-IS announces. LDP runs on the link to pe-02, and labels the loopbacks only: traffic crosses the core to a loopback, never to a link. pe-03 is no neighbor, so LDP holds a targeted session with it, and pe-03 has one back.
        mpls: {
            ldp: {
                lsr_id: "10.255.0.1",
                interfaces: ["100g-1"],
                targets: ["10.255.0.3"],
                import_policy: "loopbacks",
                export_policy: "loopbacks",
                // Traffic between pe-01 and pe-03 goes by pe-02's labels, so over their session the two give each other only their own loopback's.
                neighbors: { "10.255.0.3": { import_policy: "pe-03-loopback", export_policy: "own-loopback" } },
            },
        },
        // The iBGP sessions between the loopbacks carry the VRFs' routes, each with its label, and the VPLS routes, and no other routes.
        bgp: {
            neighbors: {
                "pe-02": {
                    description: "pe-02, VPN routes",
                    address: "10.255.0.2",
                    remote_as: 64500,
                    local_address: "10.255.0.1",
                    address_families: ["vpnv4", "l2vpn-vpls"],
                },
                "pe-03": {
                    description: "pe-03, VPLS routes",
                    address: "10.255.0.3",
                    remote_as: 64500,
                    local_address: "10.255.0.1",
                    address_families: ["l2vpn-vpls"],
                },
            },
        },
        prefix_sets: {
            "bank-offices": { prefixes: ["10.1.0.0/16"] },
            loopbacks: { prefixes: ["10.255.0.0/24"] },
        },
        policies: {
            "bank-offices": [{ if: { prefix_set: "bank-offices" }, then: "accept" }, { then: "reject" }],
            loopbacks: [{ if: { prefix_set: "loopbacks" }, then: "accept" }, { then: "reject" }],
            "own-loopback": [{ if: { prefix: "10.255.0.1/32" }, then: "accept" }, { then: "reject" }],
            "pe-03-loopback": [{ if: { prefix: "10.255.0.3/32" }, then: "accept" }, { then: "reject" }],
        },
    },
});
