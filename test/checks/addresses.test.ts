// The address arithmetic the checks rely on holds at the edges. 0.x's tests of `AddressSpace` (`circuit addresses`) wait for that module's port.

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
