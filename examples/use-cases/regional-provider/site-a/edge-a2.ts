// The second edge router at site A: transit B, the exchange, the gateway of every site A customer beside edge-a1, and the leased wave to site B. A WireGuard tunnel to edge-b1 keeps site B's management in reach when the wave and the GRE tunnel are both down.

import { defineDevice, secret, Utils } from "@takodotid/circuit";
import { AT } from "../customers";
import * as edge from "../edge";
import { ASN, INFRA_VLANS, IX, OURS, SERVICES } from "../network";
import { customerSessions, customerVlanNames, customerVlans, gateways, routedBlocks } from "../tenancy";

const neighbors = Utils.merge(
    {
        "transit-b-v4": {
            address: "203.0.113.5",
            remote_as: 64502,
            role: "provider",
            description: "Transit B",
            import: "TRANSIT-B-IN",
            export: "TRANSIT-B-OUT",
            max_prefixes: 1_200_000,
            hold_time: 90,
            keepalive: 30,
        },
        "transit-b-v6": {
            address: "2001:db8:ffff:2::1",
            remote_as: 64502,
            role: "provider",
            description: "Transit B",
            import: "TRANSIT-B-IN",
            export: "TRANSIT-B-OUT",
            max_prefixes: 250_000,
            hold_time: 90,
            keepalive: 30,
        },
        "edge-a1-v4": { address: "198.51.100.1", group: "ibgp", local_address: "198.51.100.2" },
        "edge-a1-v6": { address: "2001:db8:100::1", group: "ibgp", local_address: "2001:db8:100::2" },
        "edge-b1-v4": { address: "198.51.100.3", group: "ibgp", local_address: "198.51.100.2" },
        "edge-b1-v6": { address: "2001:db8:100::3", group: "ibgp", local_address: "2001:db8:100::2" },
    },
    edge.exchangeSessions(),
    customerSessions(AT.a)
);

/** What edge-a2 trunks to core-a2. */
const TRUNK = ["mgmt", "infra", ...customerVlanNames(AT.a)];

export default defineDevice({
    name: "edge-a2",
    platform: "routeros",
    model: "CCR2216-1G-12XS-2XQ",
    connection: { host: "10.0.99.3", user: "operator" },
    users: edge.users,
    system: edge.system,
    management: edge.management("Site A, rack 2"),
    certificates: edge.certificates,

    hardware_offload: true,
    stp: { mode: "rstp", priority: 20480 },
    lldp: { interfaces: ["100g-1", "25g-3", "25g-4", "25g-12", "mgmt"] },

    vlans: Utils.merge(
        INFRA_VLANS,
        {
            "transit-b": { id: 301, description: "Transit B, AS64502" },
            ix: { id: 200, description: `Peering LAN of ${IX.name}` },
        },
        customerVlans(AT.a)
    ),
    vrfs: { oob: { description: "The out-of-band network, apart from everything else" } },

    ports: {
        "1g-1": { description: "Out-of-band switch", addresses: ["10.9.0.2/24"], vrf: "oob" },
        "100g-1": {
            description: "edge-a1",
            mtu: 9000,
            addresses: ["10.254.0.1/31"],
            link: { device: "edge-a1", port: "100g-1" },
        },
        "25g-1": { description: "Transit B", access_vlan: "transit-b", acl: "edge", lldp: false, stp: false },
        "25g-2": { description: IX.name, access_vlan: "ix", acl: "edge", lldp: false, stp: false },
        "25g-3": { description: "core-a2, first cable", speed: "10g", lag: "core", link: { device: "core-a2", port: "10g-1" } },
        "25g-4": { description: "core-a2, second cable", speed: "10g", lag: "core", link: { device: "core-a2", port: "10g-2" } },
        "25g-12": {
            description: "Leased wave to edge-b1",
            mtu: 9000,
            addresses: ["10.254.0.2/31"],
            link: { device: "edge-b1", port: "25g-12" },
        },
    },

    interfaces: Utils.merge(
        {
            loopback: { type: "loopback", description: "Router ID and iBGP", addresses: ["198.51.100.2/32", "2001:db8:100::2/128"] },
            core: { type: "lag", description: "core-a2", mode: "lacp", trunk_vlans: TRUNK },
            mgmt: {
                type: "vlan",
                vlan: "mgmt",
                addresses: ["10.0.99.3/24"],
                vrrp: [{ id: 99, address: "10.0.99.1", priority: 100 }],
            },
            infra: {
                type: "vlan",
                vlan: "infra",
                addresses: ["10.0.10.3/24"],
                vrrp: [{ id: 10, address: "10.0.10.1", priority: 100 }],
            },
            "transit-b": {
                type: "vlan",
                vlan: "transit-b",
                description: "Transit B",
                addresses: ["203.0.113.6/30", "2001:db8:ffff:2::2/64"],
            },
            ix: {
                type: "vlan",
                vlan: "ix",
                description: IX.name,
                addresses: ["203.0.113.141/25", "2001:db8:ffff::141/64"],
                hardware_offload: false,
                exchange: { name: IX.name, speed: 25_000 },
            },
            "wg-b1": {
                type: "wireguard",
                description: "Site B's management, when nothing else reaches it",
                listen_port: 51821,
                private_key: secret("EDGE_A2_WG_KEY"),
                addresses: ["10.254.1.4/31"],
                peers: [
                    {
                        name: "edge-b1",
                        public_key: "ZXhhbXBsZSBlZGdlLWIxIG5vdCBhIHJlYWwga2V5Li4=",
                        endpoint: "203.0.113.10:51821",
                        allowed_addresses: ["10.254.1.5/32", "10.1.99.0/24"],
                        keepalive: 25,
                    },
                ],
            },
            "gre-acme": {
                type: "gre",
                description: "Acme's branch office",
                local: "203.0.113.6",
                remote: "192.0.2.1",
                addresses: ["10.254.9.0/31"],
            },
        },
        gateways(AT.a, 3, { priority: 100 })
    ),

    routing: {
        router_id: "198.51.100.2",
        static: [
            { prefix: OURS.v4, blackhole: true, description: "Originate" },
            { prefix: OURS.v6, blackhole: true, description: "Originate" },
            { prefix: "0.0.0.0/0", via: "10.9.0.254", vrf: "oob", description: "Out-of-band exit" },
            { prefix: "10.1.99.0/24", interface: "wg-b1", distance: 200, description: "Site B management, last resort" },
            { prefix: "10.200.0.0/16", interface: "gre-acme", description: "Acme's branch office" },
            ...routedBlocks(AT.a),
        ],
        rpki: edge.rpki,
        bgp: {
            asn: ASN,
            networks: [OURS.v4, OURS.v6],
            groups: edge.groups,
            neighbors,
        },
        ospf: {
            areas: {
                "0.0.0.0": {
                    interfaces: {
                        loopback: { passive: true },
                        mgmt: { passive: true },
                        "100g-1": { cost: 10, network: "point-to-point", bfd: true },
                        infra: { cost: 10, bfd: true },
                        "25g-12": { cost: 100, network: "point-to-point", bfd: true },
                    },
                },
            },
            redistribute: ["connected", "static"],
        },
    },

    prefix_sets: edge.prefixSets,
    policies: edge.policies("a", { "transit-b": 64502 }, true),

    firewall: edge.firewall({
        outside: ["transit-b", "ix"],
        neighbors,
        tunnelPeers: ["203.0.113.10", "192.0.2.1"],
        wireguardPorts: [51821],
    }),
    acls: { edge: edge.acl(["transit-b", "ix"]) },

    flow_export: {
        protocol: "ipfix",
        collectors: [{ address: SERVICES.flows, port: 4739 }],
        sampling: 1000,
        interfaces: ["transit-b", "ix"],
    },
});
