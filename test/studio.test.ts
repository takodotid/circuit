// What studio shows is gathered from the config alone: each device as written, every port its model has, what it would run, its BGP sessions and cables, and the schema's description of each field.

import { expect, test } from "bun:test";
import { adapters } from "../src/adapters/devices";
import { graphOf } from "../src/core/graph";
import { studioData } from "../src/cli/studio/data";

test("studio gathers the colocation pattern's devices, sessions, cables and field descriptions", async () => {
    const network = (await import("../templates/colocation/circuit.config.ts")).default;
    const devices = network.devices;
    const data = studioData(devices, { ...graphOf(devices), findings: [], drift: {} }, (device) =>
        adapters[device.platform]!.render(device)
    );

    expect(data.devices.map((device) => device.name)).toEqual(["edge-01", "tor-01"]);
    expect(data.ports["tor-01"]).toHaveLength(54);
    expect(data.rendered["tor-01"]).toContain("sysname tor-01");

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
    const data = studioData(devices, { ...graphOf(devices), findings: [], drift: {} }, () => "");

    expect(data.sessions).toEqual([
        { device: "r1", name: "10.255.0.2", address: "10.255.0.2", remoteAs: 64500, far: "r2", oneSided: true },
    ]);
});
