// The first edge router at site A: transit A, the exchange, the gateway of every site A customer beside edge-a2, and two tunnels to site B over the internet. The NOC dials in here.

import { defineDevice, merge, secret } from "@takodotid/circuit";
import { AT } from "./customers";
import * as edge from "./edge";
import { ASN, INFRA_VLANS, IX, OURS, SERVICES } from "./network";
import { customerSessions, customerVlanNames, customerVlans, gateways, routedBlocks } from "./tenancy";

const neighbors = merge(
    {
        "transit-a-v4": {
            address: "203.0.113.1",
            remote_as: 64501,
            role: "provider",
            description: "Transit A",
            import: "TRANSIT-A-IN",
            export: "TRANSIT-A-OUT",
            password: secret("TRANSIT_A_BGP_PASSWORD"),
            max_prefixes: 1_200_000,
            bfd: true,
        },
        "transit-a-v6": {
            address: "2001:db8:ffff:1::1",
            remote_as: 64501,
            role: "provider",
            description: "Transit A",
            import: "TRANSIT-A-IN",
            export: "TRANSIT-A-OUT",
            password: secret("TRANSIT_A_BGP_PASSWORD"),
            max_prefixes: 250_000,
            bfd: true,
        },
        "edge-a2-v4": { address: "198.51.100.2", group: "ibgp", local_address: "198.51.100.1" },
        "edge-a2-v6": { address: "2001:db8:100::2", group: "ibgp", local_address: "2001:db8:100::1" },
        "edge-b1-v4": { address: "198.51.100.3", group: "ibgp", local_address: "198.51.100.1" },
        "edge-b1-v6": { address: "2001:db8:100::3", group: "ibgp", local_address: "2001:db8:100::1" },
    },
    edge.exchangeSessions(),
    customerSessions(AT.a)
);

/** What edge-a1 trunks to core-a1. */
const TRUNK = ["mgmt", "infra", ...customerVlanNames(AT.a)];

export default defineDevice({
    name: "edge-a1",
    platform: "routeros",
    model: "CCR2216-1G-12XS-2XQ",
    connection: { host: "10.0.99.2", user: "operator" },
    users: edge.users,
    system: edge.system,
    management: { ...edge.management("Site A, rack 1"), native: { interfaces: ["mgmt"] } },
    certificates: edge.certificates,

    hardware_offload: true,
    stp: { mode: "rstp", priority: 16384 },
    lldp: { interfaces: ["100g-1", "100g-2", "mgmt"] },

    vlans: merge(
        INFRA_VLANS,
        {
            "transit-a": { id: 300, description: "Transit A, AS64501" },
            ix: { id: 200, description: `Peering LAN of ${IX.name}` },
        },
        customerVlans(AT.a)
    ),
    vrfs: { oob: { description: "The out-of-band network, apart from everything else" } },

    ports: {
        "1g-1": { description: "Out-of-band switch", addresses: ["10.9.0.1/24"], vrf: "oob" },
        "100g-1": {
            description: "edge-a2",
            mtu: 9000,
            addresses: ["10.254.0.0/31"],
            link: { device: "edge-a2", port: "100g-1" },
        },
        "100g-2": {
            description: "core-a1",
            speed: "40g",
            trunk_vlans: TRUNK,
            stp: { cost: 100 },
            link: { device: "core-a1", port: "40g-1" },
        },
        "25g-1": { description: "Transit A", access_vlan: "transit-a", acl: "edge", lldp: false, stp: false },
        "25g-2": { description: IX.name, access_vlan: "ix", acl: "edge", lldp: false, stp: false },
    },

    interfaces: merge(
        {
            loopback: {
                type: "loopback",
                description: "Router ID, iBGP, and the anycast resolver",
                addresses: ["198.51.100.1/32", "2001:db8:100::1/128", "198.51.100.10/32"],
            },
            mgmt: {
                type: "vlan",
                vlan: "mgmt",
                addresses: ["10.0.99.2/24"],
                vrrp: [{ id: 99, address: "10.0.99.1", priority: 200, preempt: true }],
            },
            infra: {
                type: "vlan",
                vlan: "infra",
                addresses: ["10.0.10.2/24"],
                vrrp: [{ id: 10, address: "10.0.10.1", priority: 200, preempt: true }],
            },
            "transit-a": {
                type: "vlan",
                vlan: "transit-a",
                description: "Transit A",
                addresses: ["203.0.113.2/30", "2001:db8:ffff:1::2/64"],
            },
            ix: {
                type: "vlan",
                vlan: "ix",
                description: IX.name,
                addresses: ["203.0.113.140/25", "2001:db8:ffff::140/64"],
                hardware_offload: false,
                exchange: { name: IX.name, speed: 25_000 },
            },
            "gre-b1": {
                type: "gre",
                description: "Backup path to site B, over the internet",
                local: "203.0.113.2",
                remote: "203.0.113.10",
                mtu: 1476,
                addresses: ["10.254.1.0/31"],
            },
            "vxlan-b1": {
                type: "vxlan",
                description: "Site B's lab, stretched to site A",
                vni: 4010,
                local: "203.0.113.2",
                remote: "203.0.113.10",
                mac: "02:00:00:00:a1:01",
                mtu: 1450,
                addresses: ["10.254.1.2/31"],
            },
            "wg-noc": {
                type: "wireguard",
                description: "The NOC's VPN",
                listen_port: 51820,
                endpoint: "203.0.113.2",
                private_key: secret("EDGE_A1_WG_NOC_KEY"),
                addresses: ["10.254.2.1/24"],
                peers: [
                    ...[1, 2, 3, 4].map((n) => ({
                        name: `noc-laptop-${n}`,
                        public_key: [
                            "ZXhhbXBsZSBub2MtbGFwdG9wLTEgbm90IGEgcmVhbCA=",
                            "ZXhhbXBsZSBub2MtbGFwdG9wLTIgbm90IGEgcmVhbCA=",
                            "ZXhhbXBsZSBub2MtbGFwdG9wLTMgbm90IGEgcmVhbCA=",
                            "ZXhhbXBsZSBub2MtbGFwdG9wLTQgbm90IGEgcmVhbCA=",
                        ][n - 1]!,
                        allowed_addresses: [`10.254.2.${10 + n}/32`],
                        client_allowed_addresses: ["10.0.0.0/8"],
                    })),
                    {
                        name: "monitoring",
                        public_key: "ZXhhbXBsZSBtb25pdG9yaW5nIG5vdCBhIHJlYWwga2U=",
                        endpoint: "monitor.example.net:51820",
                        allowed_addresses: ["10.254.2.100/32", "10.50.0.0/24"],
                        keepalive: 25,
                    },
                ],
            },
        },
        gateways(AT.a, 2, { priority: 200 })
    ),

    routing: {
        router_id: "198.51.100.1",
        static: [
            { prefix: OURS.v4, blackhole: true, description: "Originate" },
            { prefix: OURS.v6, blackhole: true, description: "Originate" },
            { prefix: "0.0.0.0/0", via: "10.9.0.254", vrf: "oob", description: "Out-of-band exit" },
            { prefix: "10.50.0.0/24", interface: "wg-noc", description: "The monitoring network, over its VPN" },
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
                        "gre-b1": { cost: 1000, network: "point-to-point" },
                    },
                },
            },
            redistribute: ["connected", "static"],
        },
    },

    prefix_sets: edge.prefixSets,
    policies: edge.policies("a", { "transit-a": 64501 }, true),

    firewall: edge.firewall({
        outside: ["transit-a", "ix"],
        neighbors,
        tunnelPeers: ["203.0.113.10"],
        wireguardPorts: [51820],
    }),
    acls: { edge: edge.acl(["transit-a", "ix"]) },

    flow_export: {
        protocol: "ipfix",
        collectors: [{ address: SERVICES.flows, port: 4739 }],
        sampling: 1000,
        interfaces: ["transit-a", "ix"],
    },
});
