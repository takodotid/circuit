// The graph is read from the config alone: each layer finds what the fields say, matches the far end where it is one of our devices, and marks what only one end declares.

import { expect, test } from "bun:test";
import { dot, mermaid } from "../src/cli/graph";
import { defineDevice, secret } from "../src/core/define";
import { graphOf, only, type GraphEdge } from "../src/core/graph";

const r1 = defineDevice({
    name: "r1",
    platform: "routeros",
    model: "CCR2216-1G-12XS-2XQ",
    connection: { host: "10.0.10.1", user: "admin" },
    users: { admin: { role: "admin", password: secret("R1_PASSWORD") } },
    vlans: { mgmt: { id: 10 }, servers: { id: 20 } },
    ports: {
        "25g-1": { lag: "core", link: { device: "sw", port: "10g-1" } },
        "25g-2": { lag: "core", link: { device: "sw", port: "10g-2" } },
        "100g-1": { addresses: [{ address: "192.0.2.1/32", peer: "192.0.2.2" }], link: { device: "r2", port: "100g-1" } },
    },
    interfaces: {
        core: { type: "lag", trunk_vlans: ["mgmt", "servers"] },
        mgmt: { type: "vlan", vlan: "mgmt", addresses: ["10.0.10.1/24"], vrrp: [{ id: 1, address: "10.0.10.254", priority: 200 }] },
        lo: { type: "loopback", addresses: ["10.255.0.1/32"] },
        "to-r2": { type: "gre", local: "10.255.0.1", remote: "10.255.0.2" },
        wg: {
            type: "wireguard",
            listen_port: 51820,
            addresses: ["10.9.0.1/24"],
            private_key: secret("R1_WG_KEY"),
            peers: [
                { name: "r2", public_key: "r2-public-key", allowed_addresses: ["10.9.0.2/32"] },
                { name: "laptop", public_key: "laptop-public-key", allowed_addresses: ["10.9.0.10/32"] },
            ],
        },
    },
    routing: {
        bgp: {
            asn: 64500,
            neighbors: {
                r2: { address: "10.255.0.2", remote_as: 64500 },
                transit: { address: "203.0.113.1", remote_as: 64501, role: "provider" },
                stale: { address: "10.255.0.9", remote_as: 64500 },
            },
        },
        ospf: { areas: { "0.0.0.0": { interfaces: { mgmt: {}, lo: { passive: true } } } } },
    },
});

const r2 = defineDevice({
    name: "r2",
    platform: "routeros",
    model: "CCR2216-1G-12XS-2XQ",
    connection: { host: "10.0.10.2", user: "admin" },
    users: { admin: { role: "admin", password: secret("R2_PASSWORD") } },
    vlans: { mgmt: { id: 10 } },
    ports: {
        "100g-1": { addresses: [{ address: "192.0.2.2/32", peer: "192.0.2.1" }], link: { device: "r1", port: "100g-1" } },
        "25g-1": { access_vlan: "mgmt", link: { device: "sw", port: "10g-3" } },
        "25g-2": { link: { device: "sw", port: "10g-4" } },
    },
    interfaces: {
        mgmt: { type: "vlan", vlan: "mgmt", addresses: ["10.0.10.2/24"], vrrp: [{ id: 1, address: "10.0.10.254" }] },
        lo: { type: "loopback", addresses: ["10.255.0.2/32"] },
        "to-r1": { type: "gre", local: "10.255.0.2", remote: "10.255.0.1" },
        wg: {
            type: "wireguard",
            listen_port: 51820,
            addresses: ["10.9.0.2/24"],
            private_key: secret("R2_WG_KEY"),
            peers: [{ name: "r1", public_key: "r1-public-key", allowed_addresses: ["10.9.0.1/32"], endpoint: "10.255.0.1:51820" }],
        },
    },
    routing: {
        bgp: { asn: 64500, neighbors: { r1: { address: "10.255.0.1", remote_as: 64500 } } },
        ospf: { areas: { "0.0.0.0": { interfaces: { mgmt: {} } } } },
    },
});

const sw = defineDevice({
    name: "sw",
    platform: "vrp",
    model: "CE6855-48S6Q-HI",
    connection: { host: "10.0.10.3", user: "admin" },
    users: { admin: { role: "admin", password: secret("SW_PASSWORD") } },
    vlans: { mgmt: { id: 10 }, servers: { id: 20 } },
    ports: {
        "10g-1": { lag: "uplink", link: { device: "r1", port: "25g-1" } },
        "10g-2": { lag: "uplink", link: { device: "r1", port: "25g-2" } },
        "10g-3": { access_vlan: "mgmt", link: { device: "r2", port: "25g-1" } },
        "10g-4": { description: "Not linked back" },
    },
    interfaces: {
        uplink: { type: "lag", trunk_vlans: ["mgmt", "servers"] },
        mgmt: { type: "vlan", vlan: "mgmt", addresses: ["10.0.10.3/24"] },
    },
});

const graph = graphOf([r1, r2, sw]);

const on = (layer: GraphEdge["layer"]) =>
    graph.edges.filter((edge) => edge.layer === layer).map((edge) => ({ ...edge, between: `${edge.from} ${edge.to}` }));

test("l1 draws each cable once, a LAG's cables as one, and marks a cable only one end names", () => {
    const cables = on("l1");

    expect(cables.map((edge) => [edge.between, edge.label, edge.oneSided ?? false])).toEqual([
        ["device:r1 device:sw", "core to uplink, 2 cables", false],
        ["device:r1 device:r2", "100g-1 to 100g-1", false],
        ["device:r2 device:sw", "25g-1 to 10g-3", false],
        ["device:r2 device:sw", "25g-2 to 10g-4", true],
    ]);
});

test("l2 holds the VLANs each cable carries, from the LAG when the port is in one", () => {
    const carried = on("l2").map((edge) => [edge.between, edge.vlans?.map((vlan) => `${vlan.id}${vlan.untagged ? " untagged" : ""}`)]);

    expect(carried).toEqual([
        ["device:r1 device:sw", ["10", "20"]],
        ["device:r2 device:sw", ["10 untagged"]],
    ]);
});

test("l3 draws a segment three devices share as a node, two ends as a line, and a point-to-point address to its peer", () => {
    const segment = graph.nodes.find((node) => node.id === "segment:10.0.10.0/24");
    expect(segment?.detail).toContain("VRRP 1 10.0.10.254 on r1, priority 200");

    const edges = on("l3").map((edge) => [edge.between, edge.label]);
    expect(edges).toEqual([
        ["device:r1 device:r2", "192.0.2.1 to 192.0.2.2"],
        ["device:r1 segment:10.0.10.0/24", "mgmt 10.0.10.1"],
        ["device:r2 segment:10.0.10.0/24", "mgmt 10.0.10.2"],
        ["device:sw segment:10.0.10.0/24", "mgmt 10.0.10.3"],
        ["device:r1 device:r2", "10.9.0.0/24"],
    ]);
});

test("bgp pairs the two ends of a session, and marks an internal session no device answers", () => {
    const sessions = on("bgp").map((edge) => [edge.between, edge.label, edge.oneSided ?? false]);

    expect(sessions).toEqual([
        ["device:r1 device:r2", "iBGP", false],
        ["device:r1 as:64501", "transit, provider", false],
        ["device:r1 as:64500", "stale", true],
    ]);
});

test("ospf joins two devices in one area on one prefix, and skips a passive interface", () => {
    expect(on("ospf").map((edge) => [edge.between, edge.label])).toEqual([["device:r1 device:r2", "area 0.0.0.0"]]);
});

test("tunnels pair GRE ends that mirror, a WireGuard peer that is another device, and gather peers that dial in", () => {
    expect(on("tunnels").map((edge) => [edge.between, edge.label])).toEqual([
        ["device:r1 device:r2", "GRE to-r2 to to-r1"],
        ["device:r1 device:r2", "WireGuard wg to wg"],
        ["device:r1 clients:r1:wg", "WireGuard wg"],
    ]);

    expect(graph.nodes.find((node) => node.id === "clients:r1:wg")?.label).toBe("1 client");
});

test("a cable to a device that is not in the network ends at a node of its own", () => {
    const lonely = defineDevice({
        name: "lonely",
        platform: "vrp",
        model: "CE6855-48S6Q-HI",
        connection: { host: "10.0.10.4", user: "admin" },
        users: { admin: { role: "admin", password: secret("LONELY_PASSWORD") } },
        ports: { "10g-1": { link: { device: "gone", port: "10g-1" } } },
    });
    const edges = graphOf([lonely]).edges;

    expect(edges.map((edge) => [edge.to, edge.oneSided ?? false])).toEqual([["missing:gone", true]]);
});

test("only keeps the layers asked for, and the edges that touch the devices named", () => {
    const bgp = only(graph, ["bgp"], ["r2"]);

    expect(bgp.edges.map((edge) => `${edge.from} ${edge.to}`)).toEqual(["device:r1 device:r2"]);
    expect(bgp.nodes.map((node) => node.id).sort()).toEqual(["device:r1", "device:r2"]);
});

test("the graph holds no secret, not even a reference to one", () => {
    expect(JSON.stringify(graph)).not.toContain("secret");
    expect(JSON.stringify(graph)).not.toContain("R1_WG_KEY");
});

test("mermaid and dot mark a device with an error, a device unlike its snapshot, and a line only one end declares", () => {
    const annotated = {
        ...only(graph, ["l1"]),
        findings: [{ level: "error" as const, device: "r1", message: "broken" }],
        drift: { r2: { status: "differs" as const, lines: ["/ip address"] } },
    };

    const chart = mermaid(annotated);
    expect(chart).toStartWith("graph LR\n");
    expect(chart).toContain('n0["r1<br/>routeros CCR2216-1G-12XS-2XQ"]');
    expect(chart).toContain('n1 -.-|"25g-2 to 10g-4"| n2');
    expect(chart).toContain("class n0 error");
    expect(chart).toContain("class n1 warning");

    const drawing = dot(annotated);
    expect(drawing).toContain('"device:r2" -- "device:sw" [label="25g-2 to 10g-4", style=dashed];');
    expect(drawing).toContain('color="#d1242f"');
});
