// A provider edge router, a MikroTik CCR2216. IS-IS carries its loopback to pe-01 and pe-03, and LDP labels each loopback. iBGP carries the bank's VRF to pe-01 (L3VPN), and joins the museum's sites here and there (VPLS). Pseudowires carry the clinic's frames and the ISP's to pe-01, and the TV station's to pe-03. A VXLAN segment joins the school's campuses here and at pe-03 (EVPN).

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
            "25g-1": {
                description: "Bank, office 2",
                vrf: "bank",
                addresses: ["172.16.2.1/30", "2001:db8:b1:ff02::1/64"],
            },
            "25g-2": { description: "Clinic, site 2", access_vlan: "clinic" },
            "25g-3": { description: "School, campus 2", access_vlan: "school" },
            "25g-4": { description: "TV station, site 1", trunk_vlans: ["tv-studio", "tv-news"] },
            "25g-5": { description: "ISP, handoff 2", qinq_vlan: "isp" },
            "25g-6": { description: "Museum, site 2", access_vlan: "museum" },
            "100g-1": {
                description: "pe-01 qsfp28-1-1",
                addresses: ["10.0.12.2/30", "2001:db8:100:12::2/64"],
                link: { device: "pe-01", port: "100g-1" },
            },
            "100g-2": {
                description: "pe-03 qsfp28-1-1",
                addresses: ["10.0.23.1/30", "2001:db8:100:23::1/64"],
                link: { device: "pe-03", port: "100g-1" },
            },
        },
        loopback: { loopback: { addresses: ["10.255.0.2/32", "2001:db8:100:ffff::2/128"] } },
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
            "pw-isp": { description: "ISP, to handoff 1 at pe-01", peer: "10.255.0.1", pw_id: 500, qinq_vlan: "isp" },
            "pw-tv": {
                description: "TV station, to site 2 at pe-03",
                peer: "10.255.0.3",
                pw_id: 401,
                trunk_vlans: ["tv-studio", "tv-news"],
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
        vlans: {
            // The clinic's port and its pseudowire, alone in one VLAN.
            clinic: { id: 201, description: "Clinic, sites 1 and 2" },
            // The school's port and its VXLAN segment in another.
            school: { id: 301, description: "School, campuses 2 and 3" },
            // The ISP's own VLANs cross the core inside this one.
            isp: { id: 500, description: "ISP, handoffs 1 and 2" },
            // The TV station's two VLANs cross the core to pe-03 on one pseudowire, each frame with its tag.
            "tv-studio": { id: 401, description: "TV station, studio" },
            "tv-news": { id: 402, description: "TV station, newsroom" },
            // The museum's two sites share one LAN: BGP finds the other PE with the museum's route target, and sets up a pseudowire to it.
            museum: {
                id: 303,
                description: "Museum, sites 1 and 2",
                vpls: { route_distinguisher: "64500:303", route_targets: { import: ["64500:303"], export: ["64500:303"] }, site_id: 2 },
            },
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
        static_routes: [
            { prefix: "10.1.2.0/24", next_hop: "172.16.2.2", vrf: "bank", description: "Bank, office 2's network" },
            { prefix: "2001:db8:b1:2::/64", next_hop: "2001:db8:b1:ff02::2", vrf: "bank", description: "Bank, office 2's IPv6 network" },
        ],
        // The three routers are in area 49.0001, at level 2 only. The system ID is the loopback address.
        isis: {
            net: "49.0001.0102.5500.0002.00",
            level_capability: "level-2",
            address_families: ["ipv4", "ipv6"],
            interfaces: {
                loopback: { passive: true },
                "100g-1": { network: "point-to-point", metric: 10 },
                "100g-2": { network: "point-to-point", metric: 10 },
            },
        },
        // The LSR ID is the loopback, which IS-IS announces. LDP labels IPv4 and IPv6 routes, for the loopbacks only, on the links to pe-01 and pe-03. Its sessions run over IPv4, as on every router here, since the pseudowire runs to an LSR ID.
        mpls: {
            ldp: {
                lsr_id: "10.255.0.2",
                address_families: ["ipv4", "ipv6"],
                ipv6_transport_address: "2001:db8:100:ffff::2",
                prefer_ipv4_transport: true,
                interfaces: ["100g-1", "100g-2"],
                import_policy: "loopbacks",
                export_policy: "loopbacks",
            },
        },
        // The iBGP sessions to pe-01 carry the VRFs' routes, each with its label, and the museum's VPLS routes, and no other routes. IPv4 and VPLS routes go between the LSR IDs, and IPv6 routes between the IPv6 loopbacks (RFC 4659). The one to pe-03's loopback carries the EVPN routes of the school's segment, from the segment's own address.
        bgp: {
            neighbors: {
                "pe-01": {
                    description: "pe-01, VPN routes",
                    address: "10.255.0.1",
                    remote_as: 64500,
                    local_address: "10.255.0.2",
                    address_families: ["vpnv4", "l2vpn-vpls"],
                },
                "pe-01-v6": {
                    description: "pe-01, IPv6 VPN routes",
                    address: "2001:db8:100:ffff::1",
                    remote_as: 64500,
                    local_address: "2001:db8:100:ffff::2",
                    address_families: ["vpnv6"],
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
            "bank-offices": { prefixes: ["10.1.0.0/16", "2001:db8:b1::/56"] },
            loopbacks: { prefixes: ["10.255.0.0/24", "2001:db8:100:ffff::/64"] },
        },
        policies: {
            "bank-offices": [{ if: { prefix_set: "bank-offices" }, then: "accept" }, { then: "reject" }],
            loopbacks: [{ if: { prefix_set: "loopbacks" }, then: "accept" }, { then: "reject" }],
        },
    },
});
