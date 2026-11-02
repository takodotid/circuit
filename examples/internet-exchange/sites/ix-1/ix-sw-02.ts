// The second fabric switch: more members, and the link to the first.

import { as64500 } from "../../circuit";
import { members } from "../../members";
import { ix_1 } from "./site";

export default as64500.device({
    name: "ix-sw-02",
    include: [members.parts],
    site: "ix-1",
    role: "Fabric switch",
    platform: "vrp",
    model: "CE6855-48S6Q-HI",
    connection: { host: "10.0.0.3", user: "operator" },

    system: {
        timezone: ix_1.timezone,
        ntp: { servers: ["10.0.0.1"] },
        users: { operator: { role: "admin", password: secret("IX_SW_02_PASSWORD") } },
    },
    management: { allow: [ix_1.management], ssh: {} },

    interfaces: {
        ethernet: {
            "40g-5": { description: "ix-sw-01 40GE1/0/5", trunk_vlans: ["peering", "mgmt"], link: { device: "ix-sw-01", port: "40g-5" } },
        },
        vlan_interface: {
            mgmt: { vlan: "mgmt", addresses: ["10.0.0.3/24"] },
        },
    },
    switching: {
        vlans: ix_1.vlans,
        stp: {},
        lldp: true,
    },

    routing: {
        static_routes: [{ prefix: presets.default_routes.ipv4, next_hop: "10.0.0.1" }],
    },
});
