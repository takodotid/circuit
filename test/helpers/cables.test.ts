// A cable between two of our devices written once: both ends' ports come from one entry, and each port is described from its far end, by the far device's own platform and model.

import { expect, test } from "bun:test";
import { Cabling } from "../../src/core/cabling";
import { defineDevice, defineNetwork, secret } from "../../src/core/define";
import { Validator } from "../../src/core/validator";
import { Cables } from "../../src/helpers";
import type { Device } from "../../src/schema";

const users = { admin: { role: "admin" as const, password: secret("PASSWORD") } };

/** A router and a firewall joined by the LAG `lag` builds. */
const pair = (lag: ReturnType<typeof Cables.lag<"to-firewall", "to-router", Record<string, string>>>): Device[] => [
    defineDevice({
        name: "router-1",
        platform: "routeros",
        model: "CCR2216-1G-12XS-2XQ",
        connection: { host: "192.0.2.1", user: "admin" },
        users,
        ports: { ...lag.a },
        interfaces: { "to-firewall": { type: "lag", mode: "lacp", addresses: ["198.51.100.1/30"] } },
    }),
    defineDevice({
        name: "firewall-1",
        platform: "fortios",
        model: "FG-3700D",
        connection: { host: "192.0.2.2", user: "admin" },
        users,
        ports: { ...lag.b },
        interfaces: { "to-router": { type: "lag", mode: "lacp", addresses: ["198.51.100.2/30"] } },
    }),
];

test("Cables.lag builds both ends of a LAG from one list, by device name only", () => {
    const lag = Cables.lag({
        a: { device: "router-1", lag: "to-firewall" },
        b: { device: "firewall-1", lag: "to-router" },
        cables: { "25g-1": "10g-2", "25g-2": "10g-1" },
    });

    expect(lag.a).toEqual({
        "25g-1": { link: { device: "firewall-1", port: "10g-2" }, lag: "to-firewall" },
        "25g-2": { link: { device: "firewall-1", port: "10g-1" }, lag: "to-firewall" },
    });
    expect(lag.b).toEqual({
        "10g-2": { link: { device: "router-1", port: "25g-1" }, lag: "to-router" },
        "10g-1": { link: { device: "router-1", port: "25g-2" }, lag: "to-router" },
    });
});

test("each end is described from the far device's own file, so the label is never written twice", () => {
    const lag = Cables.lag({
        a: { device: "router-1", lag: "to-firewall" },
        b: { device: "firewall-1", lag: "to-router" },
        cables: { "25g-1": "10g-2", "25g-2": "10g-1" },
    });
    const [router, firewall] = Cabling.describeLinks(pair(lag));

    expect(router!.ports!["25g-1"]!.description).toBe("firewall-1 port6");
    expect(firewall!.ports!["10g-2"]!.description).toBe("router-1 sfp28-1");

    const findings = Validator.run(defineNetwork({ devices: pair(lag) })).filter((finding) => finding.level === "error");
    expect(findings).toEqual([]);
});

test("Cables.link builds one cable, with a carrier and a description of the project's own", () => {
    const cable = Cables.link({
        a: { device: "router-1", port: "100g-1" },
        b: { device: "firewall-1", port: "40g-1" },
        through: "Carrier A local loop",
        describe: (far) => `${far.device.toUpperCase()} ${far.port}`,
    });

    expect(cable).toEqual({
        a: {
            "100g-1": { link: { device: "firewall-1", port: "40g-1", through: "Carrier A local loop" }, description: "FIREWALL-1 40g-1" },
        },
        b: { "40g-1": { link: { device: "router-1", port: "100g-1", through: "Carrier A local loop" }, description: "ROUTER-1 100g-1" } },
    });
});

test("a far port cabled twice is refused, and a port the model does not have fails validate", () => {
    expect(() =>
        Cables.lag({
            a: { device: "router-1", lag: "x" },
            b: { device: "firewall-1", lag: "y" },
            cables: { "25g-1": "10g-2", "25g-2": "10g-2" },
        })
    ).toThrow("Cables.lag: firewall-1 10g-2 is cabled to both 25g-1 and 25g-2 on router-1");

    const lag = Cables.lag({
        a: { device: "router-1", lag: "to-firewall" },
        b: { device: "firewall-1", lag: "to-router" },
        cables: { "25g-13": "10g-2" },
    });
    const messages = Validator.run(defineNetwork({ devices: pair(lag) })).map(
        (finding) => `${finding.level} ${finding.device}: ${finding.message}`
    );

    expect(messages.some((message) => message.startsWith("error router-1:") && message.includes("25g-13"))).toBe(true);
});
