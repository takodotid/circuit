// What a model's hardware holds, from the catalog: a LAG with too many members is an error, more switch rules than the chip held a warning. A model without limits takes anything.

import { expect, test } from "bun:test";
import { Validation } from "../../src/checks";
import type { AclRule, Device } from "../../src/model";
import { Catalog } from "../../src/platforms/catalog";
import { Platforms } from "../../src/platforms";
import { Fixtures } from "../fixtures";

const router = Fixtures.device("platforms--example-router");
const switchDevice = Fixtures.device("platforms--example-switch");

const findings = (device: Device) =>
    Validation.run([device], undefined).map((finding) => `${finding.level} ${finding.device}: ${finding.message}`);

/** A LAG `uplink` with `count` member ports, from the model's own ports. */
const withLag = (device: Device, count: number): Device => {
    const ports = Catalog.ports(device.platform, device.model).slice(0, count);
    return {
        ...device,
        interfaces: {
            ethernet: Object.fromEntries(ports.map((port) => [port, { in_lag: "uplink" }])),
            lag: { uplink: { mode: "lacp", addresses: ["203.0.113.2/30"] } },
        },
    };
};

test("a CCR2216 holds at most 8 members in a LAG; a model without the limit takes more", () => {
    expect(Catalog.limits("routeros", "CCR2216-1G-12XS-2XQ").lag_members).toBe(8);
    expect(Catalog.limits("vrp", "CE6855-48S6Q-HI")).toEqual({});

    expect(findings(withLag(router, 8)).filter((finding) => finding.includes("members"))).toEqual([]);
    expect(findings(withLag(router, 9))).toContain(
        "error example-router: interfaces.lag.uplink has 9 members; CCR2216-1G-12XS-2XQ holds at most 8"
    );
    expect(findings(withLag(switchDevice, 12)).filter((finding) => finding.includes("members"))).toEqual([]);
});

test("switch rules are counted as the render makes them, and more than a CCR2216 held is a warning", () => {
    const rule = (n: number): AclRule => ({ description: `Rule ${n}`, if: { protocol: "udp", src_port: n }, then: "drop" });
    const withRules = (rules: AclRule[], ports: string[]): Device => ({
        ...router,
        interfaces: {
            ...router.interfaces,
            // Only the ACLs given here count: the example's own ethertype filter makes switch rules too.
            ethernet: {
                ...Object.fromEntries(
                    Object.entries(router.interfaces?.ethernet ?? {}).map(([name, port]) => [name, { ...port, ethertypes: undefined }])
                ),
                ...Object.fromEntries(ports.map((port) => [port, { access_vlan: "servers", ingress_acl: "edge" }])),
            },
        },
        switching: { ...router.switching, acls: { edge: rules } },
    });

    // The CCR2216 held 70 switch rules with two distinct ranges (tako-bdr-01, 2026-10-24), so the count alone gives no warning: 25 rules on three ports are 75.
    const rules = Array.from({ length: 25 }, (_, n) => rule(n + 1));
    const warnings = (device: Device) => findings(device).filter((finding) => finding.startsWith("warning"));

    expect(warnings(withRules(rules, ["100g-1", "25g-3", "25g-4"]))).toEqual([]);

    // A list of ports is one switch rule for each, and a range counts once however often it is used.
    const ranges = [1, 2, 3, 4, 5, 6].map((n) => ({ min: n * 100, max: n * 100 + 9 }));
    const listed: AclRule = { description: "Listed", if: { protocol: "udp", dst_port: [53, ...ranges] }, then: "drop" };
    const device = withRules([listed, listed], ["100g-1"]);

    expect(Platforms.get("routeros").switchRules?.(device)).toEqual({ count: 14, ranges: 6 });
    expect(
        Platforms.get("routeros")
            .render(device)
            .match(/^add .*switch=switch1/gm)
    ).toHaveLength(14);
    expect(warnings(device)).toEqual([
        "warning example-router: switching.acls use 6 distinct port ranges; a CCR2216-1G-12XS-2XQ held 5. A rule it cannot hold is invalid, and so is every rule after it",
    ]);
});
