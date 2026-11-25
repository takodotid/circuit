// The switch for small tenants: each has a server on one port, in a subnet they all share. Each server reaches the gateway, never another tenant's server, and the guards keep one tenant from harming another. One tenant's switch reaches its racks in hall 2.

import { as64500 } from "../../circuit";
import { dc_1 } from "./site";

export default as64500.device({
    name: "tor-02",
    site: "dc-1",
    role: "Top-of-rack switch",
    platform: "junos",
    model: "QFX5100-48S-6Q",
    connection: { host: "10.0.99.3", user: "netops" },

    system: {
        timezone: dc_1.timezone,
        ntp: { servers: ["10.0.99.1"] },
        // Junos refuses a config without a root password.
        users: {
            root: { role: "admin", password: secret("TOR_02_ROOT_PASSWORD") },
            netops: { role: "admin", password: secret("TOR_02_PASSWORD") },
        },
    },
    management: { allow: [dc_1.addresses.management], ssh: {} },

    interfaces: {
        ethernet: {
            // A tenant's own switch: whatever VLANs it sends reach its racks in hall 2, inside VLAN hall-2.
            "10g-4": { description: "Switch of a tenant in halls 1 and 2", qinq_vlan: "hall-2", stp: { guard: "root" } },
            "10g-47": { description: "Core switch of hall 2", trunk_vlans: ["hall-2"] },
            // #region rate-limit
            // The tenant buys 200 Mbit/s. The switch's policer drops what arrives above it, and needs a burst. A QFX5100 can't shape what leaves.
            "10g-5": {
                description: "Server of a small tenant",
                access_vlan: "tenants",
                stp: { edge: true, bpdu_guard: true },
                rate_limit: { input: { cir: "200M", bc: 250_000 } },
            },
            // #endregion rate-limit
            // #region port-guards
            // Only the uplink to the router may carry DHCP offers and router advertisements.
            "10g-48": {
                description: "edge-01 sfp28-3",
                trunk_vlans: ["mgmt", "shared"],
                dhcp_trusted: true,
                ra_trusted: true,
                link: { device: "edge-01", port: "25g-3" },
            },
            // A switch plugged in here by mistake shuts the port down.
            "10g-1": { description: "Web server of a small tenant", access_vlan: "tenants", stp: { edge: true, bpdu_guard: true } },
            "10g-2": { description: "Mail server of a small tenant", access_vlan: "tenants", stp: { edge: true, bpdu_guard: true } },
            // One tenant brings its own switch. It may join the spanning tree, but never become its root.
            "10g-3": { description: "Switch of a small tenant", access_vlan: "tenants", stp: { guard: "root" } },
        },
        vlan_interface: {
            mgmt: { vlan: "mgmt", addresses: [dc_1.addresses.tor_02] },
        },
    },
    switching: {
        vlans: {
            mgmt: dc_1.vlans.mgmt,
            shared: dc_1.vlans.shared,
            // Isolated ports reach the uplink, which carries shared, but never each other (RFC 5517).
            tenants: { id: 501, description: "Small tenants, kept apart", private_vlan: { primary: "shared", type: "isolated" } },
            "hall-2": { id: 600, description: "One tenant's own VLANs, between halls 1 and 2" },
        },
        stp: {},
        dhcp_snooping: true,
        arp_inspection: true,
        ra_guard: true,
        // #endregion port-guards
        lldp: true,
    },

    routing: {
        static_routes: [{ prefix: presets.default_routes.ipv4, next_hop: "10.0.99.1" }],
    },
});
