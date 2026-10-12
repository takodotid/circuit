// What studio shows is gathered from the config alone: each device as written, every port its model has, what it would run, its BGP sessions and cables, and the schema's description of each field.

import { expect, test } from "bun:test";
import { adapters } from "../src/adapters/devices";
import { graphOf } from "../src/core/graph";
import { studioData } from "../src/studio/data";

test("studio gathers the colocation pattern's devices, sessions, cables and field descriptions", async () => {
    const network = (await import("../templates/colocation/circuit.config.ts")).default;
    const devices = network.devices;
    const data = studioData(
        devices,
        { ...graphOf(devices), findings: [], drift: {} },
        {
            render: (device) => adapters[device.platform]!.render(device),
            snapshot: (device) => (device.name === "tor-01" ? "sysname tor-01\n" : undefined),
            files: (device) => ({ source: `${device.name}.ts` }),
        }
    );

    expect(data.devices.map((device) => device.name)).toEqual(["edge-01", "tor-01"]);
    expect(data.ports["tor-01"]).toHaveLength(54);
    expect(data.rendered["tor-01"]).toContain("sysname tor-01");
    expect(data.snapshots).toEqual({ "tor-01": "sysname tor-01\n" });
    expect(data.files["edge-01"]).toEqual({ source: "edge-01.ts" });

    expect(data.sessions.find((session) => session.name === "hurricane-electric")).toMatchObject({
        device: "edge-01",
        remoteAs: 6939,
        role: "provider",
        far: "AS6939",
    });

    expect(data.cables).toEqual([
        {
            device: "edge-01",
            port: "100g-1",
            farDevice: "tor-01",
            farPort: "40g-1",
            description: "tor-01",
            vlans: ["mgmt (99)", "acme-internet (1001)"],
        },
    ]);

    expect(data.docs.Port?.fields.description?.description).toBe("What is plugged in.");
    expect(data.docs.Port?.includes).toContain("Routed");
});

test("a session to another of our devices names it, and says when that device has no session back", () => {
    const device = (name: string, own: string, peer: string, neighbors: boolean) => ({
        name,
        platform: "routeros",
        model: "CCR2216-1G-12XS-2XQ",
        connection: { host: own, user: "admin" },
        interfaces: { lo: { type: "loopback" as const, addresses: [`${own}/32`] } },
        routing: { bgp: { asn: 64500, neighbors: neighbors ? { [peer]: { address: peer, remote_as: 64500 } } : {} } },
    });

    const devices = [device("r1", "10.255.0.1", "10.255.0.2", true), device("r2", "10.255.0.2", "10.255.0.1", false)];
    const data = studioData(
        devices,
        { ...graphOf(devices), findings: [], drift: {} },
        { render: () => "", snapshot: () => undefined, files: () => ({}) }
    );

    expect(data.sessions).toEqual([
        { device: "r1", name: "10.255.0.2", address: "10.255.0.2", remoteAs: 64500, far: "r2", oneSided: true },
    ]);
});

test("a session back must be of the same family: a v4 session back does not answer a v6 session", () => {
    const device = (name: string, v4: string, v6: string, neighbors: Record<string, { address: string; remote_as: number }>) => ({
        name,
        platform: "routeros",
        model: "CCR2216-1G-12XS-2XQ",
        connection: { host: v4, user: "admin" },
        interfaces: { lo: { type: "loopback" as const, addresses: [`${v4}/32`, `${v6}/128`] } },
        routing: { bgp: { asn: 64500, neighbors } },
    });

    const devices = [
        device("r1", "10.255.0.1", "2001:db8::1", {
            "r2-v4": { address: "10.255.0.2", remote_as: 64500 },
            "r2-v6": { address: "2001:db8::2", remote_as: 64500 },
        }),
        device("r2", "10.255.0.2", "2001:db8::2", { "r1-v4": { address: "10.255.0.1", remote_as: 64500 } }),
    ];
    const data = studioData(
        devices,
        { ...graphOf(devices), findings: [], drift: {} },
        { render: () => "", snapshot: () => undefined, files: () => ({}) }
    );

    expect(data.sessions.filter((session) => session.oneSided).map((session) => `${session.device} ${session.name}`)).toEqual(["r1 r2-v6"]);
});

test("studio answers only the names it is reached by: this machine's own, and those it is told", async () => {
    const { hostAllowed, isLoopback } = await import("../src/studio/server");

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
