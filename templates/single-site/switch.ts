// The switch: a port for each device on the site, on the VLAN it belongs to.

import { defineDevice, secret } from "@takodotid/circuit";
import { MANAGEMENT, ROUTER, TIMEZONE, vlans } from "./site";

export default defineDevice({
    name: "switch",
    platform: "vrp",
    model: "CE6855-48S6Q-HI",
    connection: { host: "192.168.10.2", user: "operator" },
    users: { operator: { role: "admin", password: secret("SWITCH_PASSWORD") } },

    system: { timezone: TIMEZONE, ntp: { servers: [ROUTER] } },
    management: { allow: [MANAGEMENT], ssh: {} },

    lldp: true,
    stp: {},

    vlans,

    ports: {
        "10g-1": {
            description: "Router",
            trunk_vlans: ["mgmt", "home", "guests"],
            link: { device: "router", port: "25g-1" },
        },
        "10g-2": { description: "Desk", access_vlan: "home", stp: { edge: true } },
        "10g-3": { description: "Living room", access_vlan: "home", stp: { edge: true } },
        "10g-4": { description: "Guest access point", access_vlan: "guests", stp: { edge: true } },
    },

    interfaces: { mgmt: { type: "vlan", vlan: "mgmt", addresses: ["192.168.10.2/24"] } },
    routing: { static: [{ prefix: "0.0.0.0/0", via: ROUTER }] },
});
