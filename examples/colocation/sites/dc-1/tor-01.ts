// The top-of-rack switch: the tenants' servers, from each tenant's own file, and one uplink to the router.

import { as64500 } from "../../circuit";
import { tenants } from "../../tenants";
import { dc_1 } from "./site";

export default as64500.device({
    name: "tor-01",
    include: [tenants.parts],
    site: "dc-1",
    role: "Top-of-rack switch",
    platform: "vrp",
    model: "CE6855-48S6Q-HI",
    connection: { host: "10.0.99.2", user: "operator" },

    system: {
        timezone: dc_1.timezone,
        ntp: { servers: ["10.0.99.1"] },
        users: { operator: { role: "admin", password: secret("TOR_01_PASSWORD") } },
    },
    management: { allow: [dc_1.addresses.management], ssh: {} },

    interfaces: {
        ethernet: {
            "40g-1": { description: "edge-01 qsfp28-1-1", trunk_vlans: ["mgmt"], link: { device: "edge-01", port: "100g-1" } },
        },
        vlan_interface: {
            mgmt: { vlan: "mgmt", addresses: [dc_1.addresses.tor_01] },
        },
    },
    switching: {
        vlans: { mgmt: dc_1.vlans.mgmt },
        stp: {},
        lldp: true,
    },

    routing: {
        static_routes: [{ prefix: presets.default_routes.ipv4, next_hop: "10.0.99.1" }],
    },
});
