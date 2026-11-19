// The switch for small tenants: each has a server on one port, in a VLAN they all share. The guards keep one tenant from harming another.

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
            "10g-1": { description: "Web server of a small tenant", access_vlan: "shared", stp: { edge: true, bpdu_guard: true } },
            "10g-2": { description: "Mail server of a small tenant", access_vlan: "shared", stp: { edge: true, bpdu_guard: true } },
            // One tenant brings its own switch. It may join the spanning tree, but never become its root.
            "10g-3": { description: "Switch of a small tenant", access_vlan: "shared", stp: { guard: "root" } },
        },
        vlan_interface: {
            mgmt: { vlan: "mgmt", addresses: [dc_1.addresses.tor_02] },
        },
    },
    switching: {
        vlans: { mgmt: dc_1.vlans.mgmt, shared: dc_1.vlans.shared },
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
