// The arithmetic behind `circuit addresses` holds at the edges.

import { expect, test } from "bun:test";
import { formatAddress, prefixesBetween, rangeOf } from "../src/core/addr";

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
