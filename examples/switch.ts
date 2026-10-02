// A switch using every field the vrp adapter supports. Not a real network: addresses are from documentation ranges.

import { defineDevice, secret } from "@takodotid/circuit";

export default defineDevice({
    name: "example-switch",
    platform: "vrp",
    model: "CE6855-48S6Q-HI",
    connection: { host: "192.0.2.2", user: "operator" },
    users: { operator: { role: "admin", password: secret("EXAMPLE_OPERATOR_PASSWORD") } },

    system: { timezone: "Asia/Jakarta", ntp: { servers: ["192.0.2.1"] } },
    management: {
        allow: ["192.0.2.0/24"],
        ssh: {},
        snmp: {
            users: {
                monitor: {
                    auth: "sha1",
                    auth_password: secret("EXAMPLE_SNMP_AUTH"),
                    privacy: "aes128",
                    privacy_password: secret("EXAMPLE_SNMP_PRIVACY"),
                },
            },
        },
    },

    stp: { mode: "rstp", priority: 8192 },
    lldp: true,

    vlans: { management: { id: 10, description: "Management" }, servers: { id: 20 }, guests: { id: 30 } },
    vrfs: { guests: {} },

    ports: {
        "40g-1": { description: "Router", lag: "uplink" },
        "40g-2": { description: "Router", lag: "uplink" },
        "10g-1": { description: "Host", access_vlan: "servers", stp: { edge: true }, storm_control: { broadcast: { percent: 1 } } },
        "10g-2": { description: "Host without LLDP", access_vlan: "servers", lldp: false },
        "10g-3": { description: "Lab switch", access_vlan: "guests", stp: false },
    },

    interfaces: {
        uplink: { type: "lag", mode: "lacp", trunk_vlans: ["management", "servers", "guests"] },
        management: {
            type: "vlan",
            vlan: "management",
            addresses: ["192.0.2.2/24"],
            vrrp: [{ id: 1, address: "192.0.2.254", priority: 100 }],
        },
        guests: { type: "vlan", vlan: "guests", addresses: ["198.51.100.130/26"], vrf: "guests" },
    },

    routing: {
        router_id: "192.0.2.2",
        static: [
            { prefix: "0.0.0.0/0", via: "192.0.2.1" },
            { prefix: "0.0.0.0/0", via: "198.51.100.129", vrf: "guests" },
        ],
        ospf: { areas: { "0.0.0.0": { interfaces: { management: { cost: 10, bfd: true } } } }, redistribute: ["connected"] },
    },

    dhcp_relay: { guests: { interface: "guests", servers: ["198.51.100.66"] } },
    flow_export: { protocol: "sflow", collectors: [{ address: "192.0.2.99" }], interfaces: ["10g-1"] },
});
