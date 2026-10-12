// The edge router at site B: transit C, the gateway of every site B customer and of the office, and three ways to site A: the leased wave, a GRE tunnel over the internet, and a WireGuard tunnel for management. Staff dial in here.

import { defineDevice, merge, secret } from "@takodotid/circuit";
import { AT } from "./customers";
import * as edge from "./edge";
import { ASN, INFRA_VLANS, OURS, SERVICES } from "./network";
import { customerSessions, customerVlanNames, customerVlans, gateways, routedBlocks } from "./tenancy";

const neighbors = merge(
    {
        "transit-c-v4": {
            address: "203.0.113.9",
            remote_as: 64503,
            role: "provider",
            description: "Transit C",
            import: "TRANSIT-C-IN",
            export: "TRANSIT-C-OUT",
            max_prefixes: 1_200_000,
        },
        "transit-c-v6": {
            address: "2001:db8:ffff:3::1",
            remote_as: 64503,
            role: "provider",
            description: "Transit C",
            import: "TRANSIT-C-IN",
            export: "TRANSIT-C-OUT",
            max_prefixes: 250_000,
        },
        "edge-a1-v4": { address: "198.51.100.1", group: "ibgp", local_address: "198.51.100.3" },
        "edge-a1-v6": { address: "2001:db8:100::1", group: "ibgp", local_address: "2001:db8:100::3" },
        "edge-a2-v4": { address: "198.51.100.2", group: "ibgp", local_address: "198.51.100.3" },
        "edge-a2-v6": { address: "2001:db8:100::2", group: "ibgp", local_address: "2001:db8:100::3" },
    },
    customerSessions(AT.b)
);

const staff = [
    "ZXhhbXBsZSBzdGFmZi0xIG5vdCBhIHJlYWwga2V5Li4=",
    "ZXhhbXBsZSBzdGFmZi0yIG5vdCBhIHJlYWwga2V5Li4=",
    "ZXhhbXBsZSBzdGFmZi0zIG5vdCBhIHJlYWwga2V5Li4=",
    "ZXhhbXBsZSBzdGFmZi00IG5vdCBhIHJlYWwga2V5Li4=",
    "ZXhhbXBsZSBzdGFmZi01IG5vdCBhIHJlYWwga2V5Li4=",
];

export default defineDevice({
    name: "edge-b1",
    platform: "routeros",
    model: "CCR2216-1G-12XS-2XQ",
    connection: { host: "10.1.99.1", user: "operator" },
    users: edge.users,
    system: edge.system,
    management: edge.management("Site B, rack 1"),
    certificates: edge.certificates,

    hardware_offload: true,
    stp: { mode: "rstp", priority: 4096 },
    lldp: true,

    vlans: merge(
        INFRA_VLANS,
        {
            "transit-c": { id: 302, description: "Transit C, AS64503" },
            office: { id: 50, description: "The site B office" },
        },
        customerVlans(AT.b)
    ),
    vrfs: { oob: { description: "The out-of-band network, apart from everything else" } },

    ports: {
        "1g-1": { description: "Out-of-band switch", addresses: ["10.9.1.1/24"], vrf: "oob" },
        "100g-1": {
            description: "agg-b1",
            trunk_vlans: ["mgmt", "infra", "office", ...customerVlanNames(AT.b)],
            link: { device: "agg-b1", port: "100g-1" },
        },
        "25g-1": { description: "Transit C", access_vlan: "transit-c", acl: "edge", lldp: false, stp: false },
        "25g-12": {
            description: "Leased wave to edge-a2",
            mtu: 9000,
            addresses: ["10.254.0.3/31"],
            link: { device: "edge-a2", port: "25g-12" },
        },
    },

    interfaces: merge(
        {
            loopback: {
                type: "loopback",
                description: "Router ID, iBGP, and the anycast resolver",
                addresses: ["198.51.100.3/32", "2001:db8:100::3/128", "198.51.100.10/32"],
            },
            mgmt: { type: "vlan", vlan: "mgmt", addresses: ["10.1.99.1/24"] },
            infra: { type: "vlan", vlan: "infra", addresses: ["10.1.10.1/24"] },
            office: { type: "vlan", vlan: "office", description: "The site B office", addresses: ["10.1.50.1/24"] },
            "transit-c": {
                type: "vlan",
                vlan: "transit-c",
                description: "Transit C",
                addresses: ["203.0.113.10/30", "2001:db8:ffff:3::2/64"],
            },
            "gre-a1": {
                type: "gre",
                description: "Backup path to site A, over the internet",
                local: "203.0.113.10",
                remote: "203.0.113.2",
                mtu: 1476,
                addresses: ["10.254.1.1/31"],
            },
            "vxlan-a1": {
                type: "vxlan",
                description: "The lab, stretched to site A",
                vni: 4010,
                local: "203.0.113.10",
                remote: "203.0.113.2",
                mac: "02:00:00:00:b1:01",
                mtu: 1450,
                addresses: ["10.254.1.3/31"],
            },
            "wg-a2": {
                type: "wireguard",
                description: "Site A's management, when nothing else reaches it",
                listen_port: 51821,
                private_key: secret("EDGE_B1_WG_KEY"),
                addresses: ["10.254.1.5/31"],
                peers: [
                    {
                        name: "edge-a2",
                        public_key: "ZXhhbXBsZSBlZGdlLWEyIG5vdCBhIHJlYWwga2V5Li4=",
                        endpoint: "203.0.113.6:51821",
                        allowed_addresses: ["10.254.1.4/32", "10.0.99.0/24"],
                        keepalive: 25,
                    },
                ],
            },
            "wg-staff": {
                type: "wireguard",
                description: "Staff working from home",
                listen_port: 51820,
                endpoint: "203.0.113.10",
                private_key: secret("EDGE_B1_WG_STAFF_KEY"),
                addresses: ["10.254.3.1/24"],
                peers: [
                    ...staff.map((public_key, index) => ({
                        name: `staff-${index + 1}`,
                        public_key,
                        allowed_addresses: [`10.254.3.${11 + index}/32`],
                        client_allowed_addresses: ["10.1.50.0/24"],
                    })),
                    {
                        name: "lab",
                        public_key: "ZXhhbXBsZSBsYWIgbm90IGEgcmVhbCBrZXkuLi4uLi4=",
                        endpoint: "lab.example.net:51820",
                        allowed_addresses: ["10.254.3.200/32", "172.16.30.0/24"],
                        keepalive: 25,
                    },
                ],
            },
        },
        gateways(AT.b, 1)
    ),

    routing: {
        router_id: "198.51.100.3",
        static: [
            { prefix: OURS.v4, blackhole: true, description: "Originate" },
            { prefix: OURS.v6, blackhole: true, description: "Originate" },
            { prefix: "0.0.0.0/0", via: "10.9.1.254", vrf: "oob", description: "Out-of-band exit" },
            { prefix: "10.0.99.0/24", interface: "wg-a2", distance: 200, description: "Site A management, last resort" },
            { prefix: "172.16.30.0/24", interface: "wg-staff", description: "The lab" },
            ...routedBlocks(AT.b),
        ],
        rpki: edge.rpki,
        bgp: {
            asn: ASN,
            networks: [OURS.v4, OURS.v6],
            groups: { ibgp: edge.groups.ibgp },
            neighbors,
        },
        ospf: {
            areas: {
                "0.0.0.0": {
                    interfaces: {
                        loopback: { passive: true },
                        "25g-12": { cost: 100, network: "point-to-point", bfd: true },
                        "gre-a1": { cost: 1000, network: "point-to-point" },
                    },
                },
                "0.0.0.1": {
                    interfaces: {
                        infra: { cost: 10 },
                        mgmt: { passive: true },
                        office: { passive: true },
                    },
                },
            },
            redistribute: ["connected", "static"],
        },
    },

    prefix_sets: edge.prefixSets,
    policies: edge.policies("b", { "transit-c": 64503 }, false),

    firewall: edge.firewall({
        outside: ["transit-c"],
        neighbors,
        tunnelPeers: ["203.0.113.2"],
        wireguardPorts: [51820, 51821],
    }),
    acls: { edge: edge.acl(["transit-c"]) },

    dhcp: {
        office: {
            interface: "office",
            network: "10.1.50.0/24",
            gateway: "10.1.50.1",
            dns: ["10.1.50.1"],
            pool: ["10.1.50.100", "10.1.50.199"],
            lease_time: 28_800,
            reservations: [
                { address: "10.1.50.10", mac: "02:00:00:00:50:10", description: "Printer" },
                { address: "10.1.50.11", mac: "02:00:00:00:50:11", description: "Phone system" },
                { address: "10.1.50.12", mac: "02:00:00:00:50:12", description: "Door controller" },
            ],
        },
    },

    flow_export: {
        protocol: "netflow-v9",
        collectors: [{ address: SERVICES.flows }],
        sampling: 1000,
        interfaces: ["transit-c"],
    },
});
