// The first core switch at site A: the root of the site's spanning tree, edge-a1's way down, the servers on the services VLAN, and an uplink to every top-of-rack switch.

import { defineDevice, merge } from "@takodotid/circuit";
import { AT } from "./customers";
import { INFRA_VLANS, SERVICES } from "./network";
import * as switches from "./switches";
import { customerVlans } from "./tenancy";

/** A server on the services VLAN. */
const server = (description: string) => ({
    description,
    access_vlan: "services",
    stp: { edge: true },
    storm_control: { broadcast: { percent: 1 }, multicast: { percent: 1 } },
});

export default defineDevice({
    name: "core-a1",
    platform: "vrp",
    model: "CE6855-48S6Q-HI",
    connection: { host: "10.0.99.4", user: "operator" },
    users: switches.users,
    system: switches.system,
    management: switches.vrpManagement("Site A, rack 1"),

    stp: { mode: "rstp", priority: 4096 },
    lldp: true,

    vlans: merge(INFRA_VLANS, { services: { id: 20, description: "Resolvers, time, logs, flows and DHCP" } }, customerVlans(AT.a)),

    ports: {
        "40g-1": { description: "edge-a1", trunk_vlans: switches.SITE_A_EDGE, link: { device: "edge-a1", port: "100g-2" } },
        "40g-2": { description: "tor-a1", trunk_vlans: switches.SITE_A_TOR, link: { device: "tor-a1", port: "40g-1" } },
        "40g-3": { description: "tor-a2", trunk_vlans: switches.SITE_A_TOR, link: { device: "tor-a2", port: "40g-1" } },
        "40g-5": { description: "core-a2, first cable", lag: "peer", link: { device: "core-a2", port: "40g-5" } },
        "40g-6": { description: "core-a2, second cable", lag: "peer", link: { device: "core-a2", port: "40g-6" } },
        "10g-47": { description: "tor-a3, first cable", lag: "tor-a3", link: { device: "tor-a3", port: "10g-23" } },
        "10g-48": { description: "tor-a3, second cable", lag: "tor-a3", link: { device: "tor-a3", port: "10g-24" } },
        "10g-1": server("Resolver 1"),
        "10g-2": server("Time server 1"),
        "10g-3": server("Log collector"),
        "10g-4": { ...server("Flow collector"), lldp: false },
    },

    interfaces: {
        peer: { type: "lag", description: "core-a2", mode: "lacp", trunk_vlans: switches.SITE_A_CORE },
        "tor-a3": { type: "lag", description: "tor-a3", mode: "lacp", trunk_vlans: switches.SITE_A_TOR },
        mgmt: { type: "vlan", vlan: "mgmt", addresses: ["10.0.99.4/24"] },
        infra: { type: "vlan", vlan: "infra", addresses: ["10.0.10.4/24"] },
        services: {
            type: "vlan",
            vlan: "services",
            addresses: ["10.0.20.2/24"],
            vrrp: [{ id: 20, address: "10.0.20.1", priority: 200, preempt: true }],
        },
    },

    routing: {
        router_id: "10.0.10.4",
        static: [{ prefix: "0.0.0.0/0", via: "10.0.10.1", description: "The edge routers" }],
        ospf: {
            areas: {
                "0.0.0.0": {
                    interfaces: {
                        infra: { cost: 10, bfd: true },
                        services: { passive: true },
                        mgmt: { passive: true },
                    },
                },
            },
        },
    },

    // A switch that boots without a config asks for one over DHCP, from the server on the services VLAN.
    dhcp_relay: { mgmt: { interface: "mgmt", servers: [SERVICES.dhcp] } },
    flow_export: { protocol: "sflow", collectors: [{ address: SERVICES.flows }], sampling: 8192, interfaces: ["40g-1", "40g-2", "40g-3"] },
});
