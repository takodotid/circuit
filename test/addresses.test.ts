// Every address the config uses, by prefix, and what is free: each kind of use is found, owned space is split into what is used and what is not, and the arithmetic holds at the edges.

import { expect, test } from "bun:test";
import { formatAddress, prefixesBetween, rangeOf } from "../src/core/addr";
import { addressesOf, freeOfLength } from "../src/core/addresses";
import { defineDevice, secret } from "../src/core/define";

test("rangeOf and prefixesBetween cover exactly what they are given", () => {
    const { first, last } = rangeOf("198.51.100.77/24");
    expect([formatAddress(first, "ipv4"), formatAddress(last, "ipv4")]).toEqual(["198.51.100.0", "198.51.100.255"]);

    expect(prefixesBetween(first + 72n, last, "ipv4")).toEqual([
        "198.51.100.72/29",
        "198.51.100.80/28",
        "198.51.100.96/27",
        "198.51.100.128/25",
    ]);
    expect(prefixesBetween(0n, (1n << 32n) - 1n, "ipv4")).toEqual(["0.0.0.0/0"]);

    const v6 = rangeOf("2001:db8::/126");
    expect(prefixesBetween(v6.first + 1n, v6.last, "ipv6")).toEqual(["2001:db8::1/128", "2001:db8::2/127"]);
});

const edge = defineDevice({
    name: "edge",
    platform: "routeros",
    model: "CCR2216-1G-12XS-2XQ",
    connection: { host: "10.0.0.1", user: "admin" },
    users: { admin: { role: "admin", password: secret("PASSWORD") } },
    vlans: { lan: { id: 10 } },
    ports: {
        "1g-1": { addresses: ["10.0.0.1/24"] },
        "25g-1": { addresses: ["203.0.113.2/30"] },
        "25g-2": { addresses: ["198.51.100.1/26"], vrf: "customers" },
    },
    interfaces: {
        lo: { type: "loopback", addresses: ["198.51.100.255/32"] },
        lan: { type: "vlan", vlan: "lan", addresses: ["198.51.100.65/27"], vrrp: [{ id: 1, address: "198.51.100.94" }] },
        wg: {
            type: "wireguard",
            listen_port: 51820,
            addresses: ["10.9.0.1/24"],
            private_key: secret("WG_KEY"),
            peers: [
                { name: "laptop", public_key: "laptop-key", allowed_addresses: ["10.9.0.10/32"] },
                { name: "branch", public_key: "branch-key", allowed_addresses: ["10.9.0.2/32", "198.51.100.128/28"] },
            ],
        },
    },
    vrfs: { customers: {} },
    dhcp: {
        lan: {
            interface: "lan",
            network: "198.51.100.64/27",
            gateway: "198.51.100.65",
            pool: ["198.51.100.70", "198.51.100.79"],
            reservations: [{ address: "198.51.100.80", mac: "00:00:5e:00:53:01", description: "printer" }],
        },
    },
    routing: {
        static: [
            { prefix: "0.0.0.0/0", via: "203.0.113.1" },
            { prefix: "198.51.100.0/24", blackhole: true },
            { prefix: "198.51.100.160/29", via: "198.51.100.2" },
        ],
        bgp: { asn: 64500, networks: ["198.51.100.0/24"], neighbors: { transit: { address: "203.0.113.1", remote_as: 64501 } } },
    },
});

test("owned space lists each segment's uses, the blocks handed out, and the free rest", () => {
    const [space] = addressesOf([edge]).spaces;

    expect(space?.prefix).toBe("198.51.100.0/24");
    expect(space?.owner).toBe("originated by edge");

    const lan = space?.segments.find((segment) => segment.prefix === "198.51.100.64/27");
    expect(lan?.uses).toEqual([
        { address: "198.51.100.65", what: "edge lan" },
        { address: "198.51.100.70-198.51.100.79", what: "DHCP pool lan on edge" },
        { address: "198.51.100.80", what: "reserved for printer by edge" },
        { address: "198.51.100.94", what: "VRRP 1 on edge" },
    ]);
    expect(lan?.free).toBe("17");
    expect(lan?.next).toBe("198.51.100.66");

    const customers = space?.segments.find((segment) => segment.prefix === "198.51.100.0/26");
    expect(customers?.uses).toEqual([
        { address: "198.51.100.1", what: "edge 25g-2, VRF customers" },
        { address: "198.51.100.2", what: "next hop for 198.51.100.160/29 on edge" },
    ]);

    expect(space?.blocks).toEqual([
        { prefix: "198.51.100.128/28", what: "WireGuard peer branch on edge wg" },
        { prefix: "198.51.100.160/29", what: "routed via 198.51.100.2 by edge" },
        { prefix: "198.51.100.255/32", what: "edge lo" },
    ]);

    expect(space?.free).toEqual([
        "198.51.100.96/27",
        "198.51.100.144/28",
        "198.51.100.168/29",
        "198.51.100.176/28",
        "198.51.100.192/27",
        "198.51.100.224/28",
        "198.51.100.240/29",
        "198.51.100.248/30",
        "198.51.100.252/31",
        "198.51.100.254/32",
    ]);
});

test("what is outside owned space is listed apart, with the next hops and neighbors in it", () => {
    const { elsewhere } = addressesOf([edge]);

    expect(elsewhere.segments.map((segment) => segment.prefix)).toEqual(["10.0.0.0/24", "10.9.0.0/24", "203.0.113.0/30"]);

    const transit = elsewhere.segments.find((segment) => segment.prefix === "203.0.113.0/30");
    expect(transit?.uses.map((use) => use.what)).toEqual(["next hop for 0.0.0.0/0 on edge", "edge 25g-1"]);
    expect(transit?.free).toBe("0");
    expect(transit?.next).toBeUndefined();

    const tunnel = elsewhere.segments.find((segment) => segment.prefix === "10.9.0.0/24");
    expect(tunnel?.uses.map((use) => use.address)).toEqual(["10.9.0.1", "10.9.0.2", "10.9.0.10"]);
});

test("a prefix asked for is the one space, with only what falls inside it", () => {
    const report = addressesOf([edge], "10.0.0.0/8");

    expect(report.spaces.map((space) => [space.prefix, space.owner])).toEqual([["10.0.0.0/8", "asked for"]]);
    expect(report.spaces[0]?.segments.map((segment) => segment.prefix)).toEqual(["10.0.0.0/24", "10.9.0.0/24"]);
    expect(report.elsewhere).toEqual({ segments: [], blocks: [] });
});

test("freeOfLength lists free prefixes of one length, up to a limit, and counts them all", () => {
    expect(freeOfLength(["10.0.1.0/24", "10.0.2.0/23"], 24, 2)).toEqual({ prefixes: ["10.0.1.0/24", "10.0.2.0/24"], total: 3n });
    expect(freeOfLength(["10.0.0.0/30"], 24, 10)).toEqual({ prefixes: [], total: 0n });
});
