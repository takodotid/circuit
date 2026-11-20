// The meet-me room's switch: carriers hand off here, each on a port of its own, and reach the tenants' racks over one trunk.

import { as64500 } from "../../circuit";
import { dc_1 } from "./site";

export default as64500.device({
    name: "mmr-01",
    site: "dc-1",
    role: "Meet-me-room switch",
    platform: "raisecom-ros",
    model: "RAX721-C-6C48",
    connection: { host: "10.0.99.4", user: "operator" },

    system: {
        timezone: dc_1.timezone,
        ntp: { servers: ["10.0.99.1"] },
        users: { operator: { role: "admin", password: secret("MMR_01_PASSWORD") } },
    },
    // This switch answers time queries whenever it takes time from a server, and has no setting to stop it, so the config says so.
    services: { ntp_server: true },
    management: { allow: [dc_1.addresses.management], ssh: {} },

    switching: {
        vlans: {
            mgmt: dc_1.vlans.mgmt,
            cogent: { id: 700 },
            "hall-3": { id: 610 },
            "rack-b4": { id: 710 },
        },
        stp: {},
        // Only toward our own racks: a carrier doesn't learn our switch.
        lldp: { interfaces: ["100g-1"] },
    },

    interfaces: {
        ethernet: {
            "100g-1": { description: "Trunk to the tenants' racks", trunk_vlans: ["mgmt", "cogent", "hall-3", "rack-b4"] },
            // A tenant's IP transit from Cogent AS174, held to the 1 Gbit/s the tenant pays for.
            "10g-1": {
                description: "Cogent AS174, a tenant's IP transit",
                access_vlan: "cogent",
                stp: false,
                storm_control: { broadcast: { pps: 1000 } },
                rate_limit: { input: "1G", output: { cir: "1G", bc: 2_000_000 } },
            },
            // A carrier's layer 2 circuit to hall 3: whatever VLANs it sends cross inside VLAN hall-3.
            "10g-2": { description: "Carrier's circuit to hall 3", qinq_vlan: "hall-3", stp: false },
            // A tenant's own switch may join our spanning tree, but never become its root.
            "10g-3": { description: "Switch of a tenant in rack B4", access_vlan: "rack-b4", stp: { edge: false, guard: "root" } },
        },
        vlan_interface: {
            mgmt: { vlan: "mgmt", addresses: [dc_1.addresses.mmr_01] },
        },
    },

    routing: {
        static_routes: [{ prefix: presets.default_routes.ipv4, next_hop: "10.0.99.1" }],
    },
});
