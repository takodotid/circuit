// A switch using every field the raisecom-ros adapter supports. Not a real network: addresses are from documentation ranges.

import { defineDevice, secret } from "@takodotid/circuit";

export default defineDevice({
    name: "example-core-switch",
    platform: "raisecom-ros",
    model: "RAX721-C-6C48",
    connection: { host: "192.0.2.3", user: "operator" },
    users: { operator: { role: "admin", password: secret("EXAMPLE_OPERATOR_PASSWORD") } },

    system: { timezone: "Asia/Jakarta", ntp: { servers: ["192.0.2.1"] }, transceiver_monitoring: true },
    management: {
        allow: ["192.0.2.0/24"],
        ssh: { auth_timeout: 100, auth_retries: 3 },
        privilege_password: secret("EXAMPLE_ENABLE"),
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

    stp: { priority: 4096 },
    lldp: true,

    vlans: { management: { id: 10 }, servers: { id: 20 }, exchange: { id: 200 }, native: { id: 999 } },

    ports: {
        "100g-1": { description: "Exchange", access_vlan: "exchange", lldp: false, stp: false },
        "25g-1": { description: "Router", lag: "router" },
        "25g-2": { description: "Router", lag: "router" },
        "10g-1": { description: "Host", access_vlan: "servers", storm_control: { broadcast: { pps: 1000 } } },
    },

    interfaces: {
        router: { type: "lag", mode: "static", trunk_vlans: ["management", "servers", "exchange"], native_vlan: "native" },
        management: {
            type: "vlan",
            vlan: "management",
            addresses: ["192.0.2.3/24"],
            vrrp: [{ id: 1, address: "192.0.2.254", priority: 120, interval: 2 }],
        },
    },

    routing: {
        router_id: "192.0.2.3",
        static: [{ prefix: "0.0.0.0/0", via: "192.0.2.1" }],
        ospf: {
            areas: { "0.0.0.0": { interfaces: { management: { cost: 10, network: "point-to-point", passive: true } } } },
            redistribute: ["connected", "static"],
        },
    },
});
