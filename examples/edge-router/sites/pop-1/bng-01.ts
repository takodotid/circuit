// The broadband gateway: homes behind the OLT log in with PPPoE, and the billing system's RADIUS servers check each one and set its rate. It reaches the internet through edge-01.

import { as64500 } from "../../circuit";

export default as64500.device({
    name: "bng-01",
    site: "pop-1",
    role: "Broadband gateway",
    platform: "routeros",
    model: "CCR2216-1G-12XS-2XQ",
    connection: { host: "10.0.0.2", user: "operator" },

    // Managed in a VRF of its own, so no subscriber can reach the management network or the RADIUS servers.
    system: {
        timezone: "Asia/Jakarta",
        ntp: { servers: ["pool.ntp.org"] },
        users: { operator: { role: "admin", password: secret("BNG_01_PASSWORD") } },
    },
    management: { allow: ["10.0.0.0/24"], ssh: { vrf: "management" } },

    interfaces: {
        ethernet: {
            "1g-1": { description: "Management", addresses: ["10.0.0.2/24"], vrf: "management" },
            "25g-1": { description: "edge-01", addresses: ["198.51.100.2/30"] },
            "25g-2": { description: "OLT", trunk_vlans: ["olt-1"] },
        },
        vlan_interface: {
            "vlan-olt-1": { vlan: "olt-1" },
        },
    },
    switching: {
        vlans: {
            "olt-1": { id: 101, description: "Homes on the OLT's first PON port" },
        },
    },

    // Each home gets a shared address (RFC 6598), and source NAT gives it the router's own on the way out. The RADIUS servers are older ones, on the ports used before RFC 2865 assigned 1812 and 1813.
    services: {
        pppoe_server: {
            "olt-1": {
                interfaces: ["vlan-olt-1"],
                service_name: "as64500",
                local_address: "100.64.0.1",
                pool: ["100.64.0.2", "100.64.63.254"],
                dns: ["198.51.100.53", "198.51.100.54"],
                mtu: 1492,
                radius: [
                    {
                        address: "10.0.0.11",
                        secret_key: secret("RADIUS_KEY"),
                        source_address: "10.0.0.2",
                        vrf: "management",
                        auth_port: 1645,
                        acct_port: 1646,
                    },
                    {
                        address: "10.0.0.12",
                        secret_key: secret("RADIUS_KEY"),
                        source_address: "10.0.0.2",
                        vrf: "management",
                        auth_port: 1645,
                        acct_port: 1646,
                    },
                ],
                acct_interim_interval: 300,
                dynamic_authorization: true,
            },
        },
    },

    routing: {
        vrfs: { management: { description: "Out-of-band management and the RADIUS servers" } },
        static_routes: [{ prefix: "0.0.0.0/0", next_hop: "198.51.100.1", description: "edge-01" }],
    },
    firewall: {
        nat: {
            source: [{ description: "Homes to the internet", if: { src: "100.64.0.0/18", out_interface: "25g-1" }, then: "masquerade" }],
        },
    },
});
