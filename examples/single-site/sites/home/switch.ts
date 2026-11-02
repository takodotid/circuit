// The switch: a port for each device on the site, in the VLAN it belongs to.

import { as64500 } from "../../circuit";
import { home } from "./site";

export default as64500.device({
    name: "switch",
    site: "home",
    role: "Switch",
    platform: "vrp",
    model: "CE6855-48S6Q-HI",
    connection: { host: "192.168.10.2", user: "operator" },

    system: {
        timezone: home.timezone,
        ntp: { servers: ["192.168.10.1"] },
        users: { operator: { role: "admin", password: secret("SWITCH_PASSWORD") } },
    },
    management: { allow: [home.addresses.management], ssh: {} },

    interfaces: {
        ethernet: {
            "10g-1": {
                description: "router sfp28-1",
                trunk_vlans: ["mgmt", "home", "guests"],
                link: { device: "router", port: "25g-1" },
            },
            "10g-2": { description: "Desk", access_vlan: "home", stp: { edge: true } },
            "10g-3": { description: "Living room", access_vlan: "home", stp: { edge: true } },
            "10g-4": { description: "Guest access point", access_vlan: "guests", stp: { edge: true } },
        },
        vlan_interface: {
            mgmt: { vlan: "mgmt", addresses: [home.addresses.switch] },
        },
    },
    switching: {
        vlans: home.vlans,
        stp: {},
        lldp: true,
    },

    routing: {
        static_routes: [{ prefix: presets.default_routes.ipv4, next_hop: "192.168.10.1" }],
    },
});
