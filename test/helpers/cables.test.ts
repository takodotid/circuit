// A cable between two of our devices written once: both ends' ports come from one entry, each with the far port's name as printed on the device.

import { expect, test } from "bun:test";
import { defineDevice, defineNetwork, secret } from "../../src/core/define";
import { Validator } from "../../src/core/validator";
import { Cables } from "../../src/helpers";

const router = { device: "router-1", platform: "routeros", model: "CCR2216-1G-12XS-2XQ" } as const;
const firewall = { device: "firewall-1", platform: "fortios", model: "FG-3700D" } as const;

test("Cables.lag builds both ends of a LAG from one list, each port named after the far port's label", () => {
    const lag = Cables.lag({
        a: { ...router, lag: "to-firewall" },
        b: { ...firewall, lag: "to-router" },
        cables: { "25g-1": "10g-2", "25g-2": "10g-1" },
    });

    expect(lag.a).toEqual({
        "25g-1": { description: "firewall-1 port6", link: { device: "firewall-1", port: "10g-2" }, lag: "to-firewall" },
        "25g-2": { description: "firewall-1 port5", link: { device: "firewall-1", port: "10g-1" }, lag: "to-firewall" },
    });
    expect(lag.b).toEqual({
        "10g-2": { description: "router-1 sfp28-1", link: { device: "router-1", port: "25g-1" }, lag: "to-router" },
        "10g-1": { description: "router-1 sfp28-2", link: { device: "router-1", port: "25g-2" }, lag: "to-router" },
    });
});

test("Cables.link builds one cable, with a carrier and a description of the project's own", () => {
    const cable = Cables.link({
        a: { ...router, port: "100g-1" },
        b: { ...firewall, port: "40g-1" },
        through: "Carrier A local loop",
        describe: (far) => `${far.device.toUpperCase()} ${far.label}`,
    });

    expect(cable).toEqual({
        a: {
            "100g-1": { description: "FIREWALL-1 port1", link: { device: "firewall-1", port: "40g-1", through: "Carrier A local loop" } },
        },
        b: {
            "40g-1": { description: "ROUTER-1 qsfp28-1-1", link: { device: "router-1", port: "100g-1", through: "Carrier A local loop" } },
        },
    });
});

test("the two ends built pass validate as they are", () => {
    const lag = Cables.lag({
        a: { ...router, lag: "to-firewall" },
        b: { ...firewall, lag: "to-router" },
        cables: { "25g-1": "10g-2", "25g-2": "10g-1" },
    });
    const users = { admin: { role: "admin" as const, password: secret("PASSWORD") } };

    const a = defineDevice({
        name: "router-1",
        platform: "routeros",
        model: "CCR2216-1G-12XS-2XQ",
        connection: { host: "192.0.2.1", user: "admin" },
        users,
        ports: { ...lag.a },
        interfaces: { "to-firewall": { type: "lag", mode: "lacp", addresses: ["198.51.100.1/30"] } },
    });
    const b = defineDevice({
        name: "firewall-1",
        platform: "fortios",
        model: "FG-3700D",
        connection: { host: "192.0.2.2", user: "admin" },
        users,
        ports: { ...lag.b },
        interfaces: { "to-router": { type: "lag", mode: "lacp", addresses: ["198.51.100.2/30"] } },
    });

    const linkFindings = Validator.run(defineNetwork({ devices: [a, b] })).filter((finding) => finding.message.includes("link"));
    expect(linkFindings).toEqual([]);
});

test("a far port cabled twice is refused, and a port the model does not have does not compile", () => {
    expect(() =>
        Cables.lag({ a: { ...router, lag: "x" }, b: { ...firewall, lag: "y" }, cables: { "25g-1": "10g-2", "25g-2": "10g-2" } })
    ).toThrow("Cables.lag: firewall-1 10g-2 is cabled to both 25g-1 and 25g-2 on router-1");

    // @ts-expect-error The CCR2216 has 12 25G ports.
    const missing = Cables.link({ a: { ...router, port: "25g-13" }, b: { ...firewall, port: "10g-1" } });
    // @ts-expect-error The FG-3700D has no 25G ports.
    const wrongSpeed = () => Cables.lag({ a: { ...router, lag: "x" }, b: { ...firewall, lag: "y" }, cables: { "25g-1": "25g-1" } });

    expect([missing, wrongSpeed]).toHaveLength(2);
});
