import { expect, test } from "bun:test";
import { Address } from "../../src/core/address";

test("Address.range and Address.prefixesBetween cover exactly what they are given", () => {
    const { first, last } = Address.range("198.51.100.77/24");
    expect([Address.fromNumber(first, "ipv4"), Address.fromNumber(last, "ipv4")]).toEqual(["198.51.100.0", "198.51.100.255"]);

    expect(Address.prefixesBetween(first + 72n, last, "ipv4")).toEqual([
        "198.51.100.72/29",
        "198.51.100.80/28",
        "198.51.100.96/27",
        "198.51.100.128/25",
    ]);
    expect(Address.prefixesBetween(0n, (1n << 32n) - 1n, "ipv4")).toEqual(["0.0.0.0/0"]);

    const v6 = Address.range("2001:db8::/126");
    expect(Address.prefixesBetween(v6.first + 1n, v6.last, "ipv6")).toEqual(["2001:db8::1/128", "2001:db8::2/127"]);
});

test("Address.canonical reads an IPv4 address at the end of an IPv6 one", () => {
    expect(Address.canonical("::ffff:0.0.0.0/96")).toBe("::ffff:0:0/96");
    expect(Address.canonical("2001:db8::192.0.2.1")).toBe("2001:db8::c000:201");
    expect(Address.isValid("2001:db8:1:2:3:4:5:192.0.2.1")).toBe(false);
});

test("Address.isGlobal follows IANA's special-purpose registries, where the longest block decides", () => {
    // IETF assignments, multicast, reserved, the limited broadcast, benchmarking, RFC 9637 documentation, SRv6, and the older ranges.
    const local = [
        "192.0.0.8",
        "224.0.0.5",
        "240.0.0.1",
        "255.255.255.255",
        "2001:2::1",
        "3fff::1",
        "5f00::1",
        "192.0.2.1",
        "2001:db8::1",
        "fd00::1",
    ];
    // The servers that sink stray reverse DNS queries (RFC 7534), anycast inside a block that is not global, and NAT64's well-known prefix, outside IPv6's global unicast space.
    const global = ["192.31.196.1", "192.0.0.9", "2620:4f:8000::1", "2001:1::1", "64:ff9b::c000:201"];

    expect(local.filter((address) => Address.isGlobal(address))).toEqual([]);
    expect(global.filter((address) => !Address.isGlobal(address))).toEqual([]);
});
