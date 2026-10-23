// Studio answers only the names it is reached by: this machine's own, and those it is told, so a page served on a network cannot be read through a name it was not given.

import { expect, test } from "bun:test";

test("Studio answers only the names it is reached by: this machine's own, and those it is told", async () => {
    const { StudioServer } = await import("../../src/studio/server");

    expect(StudioServer.hostAllowed("127.0.0.1:4600", 4600, [])).toBe(true);
    expect(StudioServer.hostAllowed("localhost:4600", 4600, [])).toBe(true);
    expect(StudioServer.hostAllowed("localhost:5000", 4600, [])).toBe(false);
    expect(StudioServer.hostAllowed("attacker.example:4600", 4600, [])).toBe(false);
    expect(StudioServer.hostAllowed(undefined, 4600, [])).toBe(false);

    expect(StudioServer.hostAllowed("studio.example.com", 4600, ["studio.example.com"])).toBe(true);
    expect(StudioServer.hostAllowed("Studio.Example.com:443", 4600, ["studio.example.com"])).toBe(true);
    expect(StudioServer.hostAllowed("studio.example.com:8443", 4600, ["studio.example.com:443"])).toBe(false);
    expect(StudioServer.hostAllowed("other.example.com", 4600, ["studio.example.com"])).toBe(false);

    expect([
        StudioServer.isLoopback("127.0.0.1"),
        StudioServer.isLoopback("localhost"),
        StudioServer.isLoopback("::1"),
        StudioServer.isLoopback("0.0.0.0"),
        StudioServer.isLoopback("10.0.0.5"),
    ]).toEqual([true, true, true, false, false]);
});
