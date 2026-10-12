// Studio answers only the names it is reached by: this machine's own, and those it is told, so a page served on a network cannot be read through a name it was not given.

import { expect, test } from "bun:test";

test("Studio answers only the names it is reached by: this machine's own, and those it is told", async () => {
    const { hostAllowed, isLoopback } = await import("../../src/studio/server");

    expect(hostAllowed("127.0.0.1:4600", 4600, [])).toBe(true);
    expect(hostAllowed("localhost:4600", 4600, [])).toBe(true);
    expect(hostAllowed("localhost:5000", 4600, [])).toBe(false);
    expect(hostAllowed("attacker.example:4600", 4600, [])).toBe(false);
    expect(hostAllowed(undefined, 4600, [])).toBe(false);

    expect(hostAllowed("studio.example.com", 4600, ["studio.example.com"])).toBe(true);
    expect(hostAllowed("Studio.Example.com:443", 4600, ["studio.example.com"])).toBe(true);
    expect(hostAllowed("studio.example.com:8443", 4600, ["studio.example.com:443"])).toBe(false);
    expect(hostAllowed("other.example.com", 4600, ["studio.example.com"])).toBe(false);

    expect([isLoopback("127.0.0.1"), isLoopback("localhost"), isLoopback("::1"), isLoopback("0.0.0.0"), isLoopback("10.0.0.5")]).toEqual([
        true,
        true,
        true,
        false,
        false,
    ]);
});
