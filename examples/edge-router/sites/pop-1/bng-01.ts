// The broadband gateway: homes behind the OLT log in with PPPoE, and the billing system's RADIUS servers check each one and set its rate. A home router that asks gets an IPv6 prefix for its own networks. Homes on the second PON port take their address by DHCP instead (IPoE), and their prefix by DHCPv6, and the same servers check each one by its MAC address. It reaches the internet through edge-01.

import { as64500 } from "../../circuit";

// The billing system's RADIUS servers, which every service here asks. They are older ones, on the ports used before RFC 2865 assigned 1812 and 1813.
const radius = literal([
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
]);

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
    // The router pings each RADIUS server and its way out, and keeps the results: `/tool netwatch print` shows which answer.
    monitoring: {
        probes: {
            "radius-1": { target: "10.0.0.11", interval: 10, source_address: "10.0.0.2", vrf: "management" },
            "radius-2": { target: "10.0.0.12", interval: 10, source_address: "10.0.0.2", vrf: "management" },
            "edge-01": { target: "198.51.100.1", interval: 10 },
        },
    },

    interfaces: {
        ethernet: {
            "1g-1": { description: "Management", addresses: ["10.0.0.2/24"], vrf: "management" },
            "25g-1": { description: "edge-01", addresses: ["198.51.100.2/30", "2001:db8:100:ffff::2/64"] },
            // The OLT tags with IEEE 802.1ad's service tag: the homes of a PON port share a VLAN, and each business has a VLAN of its own inside olt-3.
            "25g-2": { description: "OLT", trunk_vlans: ["olt-1", "olt-2", "olt-3"], tpid: "0x88a8" },
            "25g-3": { description: "Broadband line of a local provider" },
        },
        // An out-of-band way in over another provider's line, in the management VRF, for when edge-01 is down.
        pppoe_client: {
            oob: {
                interface: "25g-3",
                description: "Out of band",
                user: "bng-01-oob",
                password: secret("BNG_01_OOB_PASSWORD"),
                mtu: 1492,
                // An IPv6 prefix for the management VRF too. The router asks for a /60, which holds the /64 it keeps on its management port, and takes what the provider gives.
                prefix_delegation: { prefix_length: 60, interfaces: { "1g-1": "::1" } },
                vrf: "management",
            },
        },
        vlan_interface: {
            "vlan-olt-1": { vlan: "olt-1" },
            "vlan-olt-2": { vlan: "olt-2", addresses: ["100.64.64.1/18", "2001:db8:100:10::1/64"], ipv6_ra: true },
            // A business on the third PON port, whose router has 198.51.100.106.
            "biz-1001": {
                vlan: "olt-3",
                inner_vlan_id: 1001,
                description: "Business on the OLT's third PON port",
                addresses: ["198.51.100.105/30"],
            },
        },
    },
    switching: {
        vlans: {
            "olt-1": { id: 101, description: "Homes on the OLT's first PON port" },
            "olt-2": { id: 102, description: "Homes on the OLT's second PON port" },
            "olt-3": { id: 103, description: "Businesses on the OLT's third PON port, each in a VLAN of its own inside it" },
        },
    },

    // Each home gets a shared address (RFC 6598), and source NAT gives it the router's own on the way out. Its router may ask for a /56 of our IPv6 space too, which needs no NAT, and the billing system may send a home its own /56 instead.
    services: {
        // A home on the second PON port gets a lease only once the RADIUS servers accept its MAC address.
        dhcp_server: {
            "olt-2": {
                interface: "vlan-olt-2",
                network: "100.64.64.0/18",
                gateway: "100.64.64.1",
                dns: ["198.51.100.53", "198.51.100.54"],
                pool: ["100.64.64.2", "100.64.127.254"],
                radius,
                acct_interim_interval: 300,
            },
        },
        // A home router there asks for a /56 by DHCPv6, and gets it once the same servers accept the MAC address in its DUID.
        dhcpv6_server: {
            "olt-2": {
                interface: "vlan-olt-2",
                prefix_delegation: { pool: "2001:db8:100:2000::/51", prefix_length: 56 },
                radius,
                acct_interim_interval: 300,
            },
        },
        pppoe_server: {
            "olt-1": {
                interfaces: ["vlan-olt-1"],
                service_name: "as64500",
                local_address: "100.64.0.1",
                pool: ["100.64.0.2", "100.64.63.254"],
                dns: ["198.51.100.53", "198.51.100.54"],
                mtu: 1492,
                radius,
                acct_interim_interval: 300,
                dynamic_authorization: true,
                prefix_delegation: { pool: "2001:db8:100:4000::/50", prefix_length: 56 },
                // A home router's own side of the session takes a /64 by SLAAC.
                slaac: { pool: "2001:db8:100:1000::/52" },
                interface_set: "homes",
            },
        },
    },

    routing: {
        vrfs: { management: { description: "Out-of-band management and the RADIUS servers" } },
        static_routes: [
            { prefix: presets.default_routes.ipv4, next_hop: "198.51.100.1", description: "edge-01" },
            { prefix: presets.default_routes.ipv6, next_hop: "2001:db8:100:ffff::1", description: "edge-01" },
            { prefix: presets.default_routes.ipv4, interface: "oob", vrf: "management", description: "Out of band" },
            { prefix: presets.default_routes.ipv6, interface: "oob", vrf: "management", description: "Out of band" },
        ],
    },
    firewall: {
        // The homes on the second PON port, and each PPPoE session while it is up. A home reaches the router itself only for an address, a prefix, and a ping.
        interface_sets: { homes: ["vlan-olt-2"] },
        filter: {
            input: {
                rules: [
                    { description: "Ping from homes", if: { in_interface_set: "homes", protocol: "icmp" }, then: "accept" },
                    {
                        description: "DHCP from homes",
                        if: { in_interface_set: "homes", protocol: "udp", dst_port: presets.ports.dhcp_server },
                        then: "accept",
                    },
                    {
                        description: "A prefix for a home's router (DHCPv6)",
                        if: { in_interface_set: "homes", protocol: "udp", dst_port: 547 },
                        then: "accept",
                    },
                    { description: "Nothing else from homes", if: { in_interface_set: "homes" }, then: "drop" },
                ],
            },
        },
        nat: {
            source: [{ description: "Homes to the internet", if: { src: "100.64.0.0/17", out_interface: "25g-1" }, then: "masquerade" }],
        },
    },
});
