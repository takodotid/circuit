// A provider edge router, a MikroTik CCR2216. IS-IS carries its loopback to pe-01 and pe-03, and LDP labels each loopback. iBGP carries the routes of the bank's VRF to pe-01 (L3VPN, RFC 4364). A pseudowire carries the clinic's frames to its other site there (VPWS). A VXLAN segment joins the school's campuses here and at pe-03, which iBGP finds (EVPN, RFC 8365).

import { as64500 } from "../../circuit";

export default as64500.device({
    name: "pe-02",
    site: "pop-2",
    role: "Provider edge router",
    platform: "routeros",
    model: "CCR2216-1G-12XS-2XQ",
    connection: { host: "10.0.2.1", user: "operator" },

    system: {
        users: { operator: { role: "admin", password: secret("PE_02_PASSWORD") } },
    },
    management: { allow: ["10.0.0.0/16"], ssh: {} },

    interfaces: {
        ethernet: {
            "1g-1": { description: "Management", addresses: ["10.0.2.1/24"] },
            "25g-1": { description: "Bank, office 2", vrf: "bank", addresses: ["172.16.2.1/30"] },
            "25g-2": { description: "Clinic, site 2", access_vlan: "clinic" },
            "25g-3": { description: "School, campus 2", access_vlan: "school" },
            "100g-1": { description: "pe-01 qsfp28-1-1", addresses: ["10.0.12.2/30"], link: { device: "pe-01", port: "100g-1" } },
            "100g-2": { description: "pe-03 qsfp28-1-1", addresses: ["10.0.23.1/30"], link: { device: "pe-03", port: "100g-1" } },
        },
        loopback: { loopback: { addresses: ["10.255.0.2/32"] } },
        // The clinic's frames cross the core to pe-01 on this pseudowire, which has the same pw_id, MTU, and control word there.
        pseudowire: {
            "pw-clinic": {
                description: "Clinic, to site 1 at pe-01",
                peer: "10.255.0.1",
                pw_id: 201,
                access_vlan: "clinic",
                mtu: 1500,
                control_word: true,
            },
        },
        // The school's frames cross the core in VXLAN to pe-03, which has the same VNI and route targets. EVPN over iBGP finds pe-03 and the MAC addresses behind it, so no far end is written here.
        vxlan: {
            "vxlan-school": {
                description: "School, to campus 3 at pe-03",
                vni: 10301,
                local_address: "10.255.0.2",
                access_vlan: "school",
                evpn: {
                    route_distinguisher: "10.255.0.2:301",
                    route_targets: { import: ["64500:10301"], export: ["64500:10301"] },
                },
            },
        },
    },

    switching: {
        // The clinic's port and its pseudowire, alone in one VLAN.
        // The school's port and its VXLAN segment in another.
        vlans: {
            clinic: { id: 201, description: "Clinic, sites 1 and 2" },
            school: { id: 301, description: "School, campuses 2 and 3" },
        },
    },

    routing: {
        router_id: "10.255.0.2",
        // The bank's VRF, in an L3VPN with its VRF on pe-01: both export and import the bank's route target.
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
        static_routes: [{ prefix: "10.1.2.0/24", next_hop: "172.16.2.2", vrf: "bank", description: "Bank, office 2's network" }],
        // The three routers are in area 49.0001, at level 2 only. The system ID is the loopback address.
        isis: {
            net: "49.0001.0102.5500.0002.00",
            level_capability: "level-2",
            address_families: ["ipv4"],
            interfaces: {
                loopback: { passive: true },
                "100g-1": { network: "point-to-point", metric: 10 },
                "100g-2": { network: "point-to-point", metric: 10 },
            },
        },
        // The LSR ID is the loopback, which IS-IS announces. LDP runs on the links to pe-01 and pe-03, and labels the loopbacks only: traffic crosses the core to a loopback, never to a link.
        mpls: { ldp: { lsr_id: "10.255.0.2", interfaces: ["100g-1", "100g-2"], import_policy: "loopbacks", export_policy: "loopbacks" } },
        // The iBGP session to pe-01's loopback carries the VRFs' routes, each with its label, and no other routes. The one to pe-03's carries the EVPN routes of the school's segment, from the segment's own address.
        bgp: {
            neighbors: {
                "pe-01": {
                    description: "pe-01, VPN routes",
                    address: "10.255.0.1",
                    remote_as: 64500,
                    local_address: "10.255.0.2",
                    address_families: ["vpnv4"],
                },
                "pe-03": {
                    description: "pe-03, EVPN routes",
                    address: "10.255.0.3",
                    remote_as: 64500,
                    local_address: "10.255.0.2",
                    address_families: ["l2vpn-evpn"],
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
