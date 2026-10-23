// What a model's hardware holds, from the catalog: a LAG with too many members is an error, more switch rules than the chip held a warning. A model without limits takes anything.

import { expect, test } from "bun:test";
import { defineNetwork } from "../../src/core/define";
import { Validator } from "../../src/core/validator";
import { Catalog } from "../../src/platforms/catalog";
import { Platforms } from "../../src/platforms";
import type { Device } from "../../src/schema";
import router from "../../examples/platforms/routeros";
import switchDevice from "../../examples/platforms/vrp";

const findings = (device: Device) =>
    Validator.run(defineNetwork({ devices: [device] })).map((finding) => `${finding.level} ${finding.device}: ${finding.message}`);

/** A LAG `uplink` with `count` member ports, from the model's own ports. */
const withLag = (device: Device, count: number): Device => {
    const ports = Catalog.ports(device.platform, device.model).slice(0, count);
    return {
        ...device,
        ports: Object.fromEntries(ports.map((port) => [port, { lag: "uplink" }])),
        interfaces: { uplink: { type: "lag", mode: "lacp", addresses: ["203.0.113.2/30"] } },
    } as Device;
};

test("a CCR2216 holds at most 8 members in a LAG; a model without the limit takes more", () => {
    expect(Catalog.limits("routeros", "CCR2216-1G-12XS-2XQ").lag_members).toBe(8);
    expect(Catalog.limits("vrp", "CE6855-48S6Q-HI")).toEqual({});

    expect(findings(withLag(router, 8)).filter((finding) => finding.includes("members"))).toEqual([]);
    expect(findings(withLag(router, 9))).toContain("error example-router: LAG uplink has 9 members; CCR2216-1G-12XS-2XQ holds at most 8");
    expect(findings(withLag(switchDevice, 12)).filter((finding) => finding.includes("members"))).toEqual([]);
});

test("switch rules are counted as the render makes them, and more than a CCR2216 held is a warning", () => {
    const rule = (n: number) => ({ description: `Rule ${n}`, match: { protocol: "udp" as const, src_port: n }, action: "drop" as const });
    const withRules = (rules: object[], ports: string[]): Device =>
        ({
            ...router,
            ports: { ...router.ports, ...Object.fromEntries(ports.map((port) => [port, { access_vlan: "servers", acl: "edge" }])) },
            acls: { edge: rules },
        }) as Device;

    // 25 rules on two ports are 50 switch rules, as many as the chip held; on three ports they are 75.
    const rules = Array.from({ length: 25 }, (_, n) => rule(n + 1));
    const warnings = (device: Device) => findings(device).filter((finding) => finding.startsWith("warning"));

    expect(warnings(withRules(rules, ["100g-1", "25g-3"]))).toEqual([]);
    expect(warnings(withRules(rules, ["100g-1", "25g-3", "25g-4"]))).toEqual([
        "warning example-router: ACLs make 75 switch rules; a CCR2216-1G-12XS-2XQ held about 50. A rule it cannot hold is invalid, and so is every rule after it",
    ]);

    // A list of ports is one switch rule for each, and a range counts once however often it is used.
    const ranges = [1, 2, 3, 4, 5, 6].map((n) => ({ min: n * 100, max: n * 100 + 9 }));
    const listed = { description: "Listed", match: { protocol: "udp" as const, dst_port: [53, ...ranges] }, action: "drop" as const };
    const device = withRules([listed, listed], ["100g-1"]);

    expect(Platforms.get("routeros").switchRules?.(device)).toEqual({ count: 14, ranges: 6 });
    expect(
        Platforms.get("routeros")
            .render(device)
            .match(/^add .*switch=switch1/gm)
    ).toHaveLength(14);
    expect(warnings(device)).toEqual([
        "warning example-router: ACLs use 6 distinct port ranges; a CCR2216-1G-12XS-2XQ held 5. A rule it cannot hold is invalid, and so is every rule after it",
    ]);
});
