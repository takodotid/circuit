// A provider edge router, a MikroTik CCR2216. IS-IS carries its loopback to pe-01, and LDP gives each loopback a label, so traffic between the two crosses the core by label. The bank's office 2 is on 25g-1, in the VRF bank, and iBGP carries the VRF's routes to pe-01 as VPN routes (RFC 4364).

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
            "100g-1": { description: "pe-01 qsfp28-1-1", addresses: ["10.0.12.2/30"], link: { device: "pe-01", port: "100g-1" } },
        },
        loopback: { loopback: { addresses: ["10.255.0.2/32"] } },
    },

    routing: {
        router_id: "10.255.0.2",
        // The bank's VRF, in an L3VPN with its VRF on pe-01: both export and import the bank's route target.
        vrfs: {
            bank: {
                description: "Bank, offices 1 and 2",
                route_distinguisher: "64500:101",
                route_targets: { import: ["64500:101"], export: ["64500:101"] },
            },
        },
        static_routes: [{ prefix: "10.1.2.0/24", next_hop: "172.16.2.2", vrf: "bank", description: "Bank, office 2's network" }],
        // Both routers are in area 49.0001, at level 2 only. The system ID is the loopback address.
        isis: {
            net: "49.0001.0102.5500.0002.00",
            level_capability: "level-2",
            address_families: ["ipv4"],
            interfaces: {
                loopback: { passive: true },
                "100g-1": { network: "point-to-point", metric: 10 },
            },
        },
        // The LSR ID is the loopback, which IS-IS announces. LDP runs on the link to pe-01.
        mpls: { ldp: { lsr_id: "10.255.0.2", interfaces: ["100g-1"] } },
        // The iBGP session between the loopbacks carries the VRFs' routes, each with its label, and no other routes.
        bgp: {
            neighbors: {
                "pe-01": {
                    description: "pe-01, VPN routes",
                    address: "10.255.0.1",
                    remote_as: 64500,
                    local_address: "10.255.0.2",
                    address_families: ["vpnv4"],
                },
            },
        },
    },
});
