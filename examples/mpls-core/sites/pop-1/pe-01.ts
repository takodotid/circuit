// A provider edge router, a MikroTik CCR2216. IS-IS carries its loopback to pe-02, and LDP labels each loopback, so traffic between the two crosses the core by label. iBGP carries the routes of the bank's VRF to pe-02 (L3VPN, RFC 4364). A pseudowire carries the clinic's frames to its other site there (VPWS).

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
        // The clinic's port and its pseudowire, alone in one VLAN.
        vlans: { clinic: { id: 201, description: "Clinic, sites 1 and 2" } },
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
        // The LSR ID is the loopback, which IS-IS announces. LDP runs on the link to pe-02, and labels the loopbacks only: traffic crosses the core to a loopback, never to a link.
        mpls: { ldp: { lsr_id: "10.255.0.1", interfaces: ["100g-1"], import_policy: "loopbacks", export_policy: "loopbacks" } },
        // The iBGP session between the loopbacks carries the VRFs' routes, each with its label, and no other routes.
        bgp: {
            neighbors: {
                "pe-02": {
                    description: "pe-02, VPN routes",
                    address: "10.255.0.2",
                    remote_as: 64500,
                    local_address: "10.255.0.1",
                    address_families: ["vpnv4"],
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
        },
    },
});
