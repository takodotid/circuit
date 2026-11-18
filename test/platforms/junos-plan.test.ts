import { expect, test } from "bun:test";
import { Platforms } from "../../src/platforms";
import { Fixtures } from "../fixtures";

const aggregationSwitch = Fixtures.device("platforms--example-aggregation-switch");

// Seen on a QFX5100 running 21.4: secrets hashed or encrypted, values quoted that the render leaves bare, the release, and each user's number.
test("example-aggregation-switch plans nothing against how the device prints it", () => {
    const adapter = Platforms.get("junos");
    const rendered = adapter.render(aggregationSwitch);
    const printed = [
        "set version 21.4R3-S8.5",
        "set system login user netops uid 2001",
        ...rendered
            .trim()
            .split("\n")
            .map((line) =>
                line
                    .replace(/plain-text-password-value \S+/, "encrypted-password <redacted>")
                    .replace(/authentication-password \S+/, "authentication-key <redacted>")
                    .replace(/privacy-password \S+/, "privacy-key <redacted>")
                    .replace(/^set snmp community \S+/, "set snmp community <redacted>")
                    .replace(/^set snmp contact (\S+)$/, 'set snmp contact "$1"')
            ),
    ].join("\n");

    expect(printed).not.toEqual(rendered);

    const plan = adapter.plan(rendered, printed, { secrets: false, rollback: 10 });
    expect(plan.steps.flatMap((step) => step.show)).toEqual([]);
});

// A service allowed only from IPv4 must not open to every IPv6 source.
test("a Junos service allowed from one family is discarded in the other", () => {
    const adapter = Platforms.get("junos");
    const rendered = adapter.render({ ...aggregationSwitch, management: { allow: ["192.0.2.0/24"], ssh: {} } });
    const v6 = rendered.split("\n").filter((line) => line.includes("circuit-services-v6 term ssh"));

    expect(v6.length).toBeGreaterThan(0);
    expect(v6.every((line) => line.includes("term ssh-others"))).toBe(true);
});

// The device refuses `delete interfaces xe-0/0/1 unit`: a named list goes entry by entry, while a block the render does not hold goes whole.
test("a Junos removal stops at an entry of a named list, never at the list", () => {
    const adapter = Platforms.get("junos");
    const desired = "set interfaces xe-0/0/1 description Host\n";
    const current = [
        "set interfaces xe-0/0/1 description Host",
        "set interfaces xe-0/0/1 unit 0 family ethernet-switching vlan members default",
        "set vlans default vlan-id 1",
        "set protocols lldp-med interface all",
    ].join("\n");

    const sent = adapter.plan(desired, current, { secrets: false, rollback: 10 }).steps.flatMap((step) => step.send);
    expect(sent).toEqual(["delete interfaces xe-0/0/1 unit 0", "delete vlans", "delete protocols"]);
});

// A community is named by its value, which the read redacts. So a new one is sent after the device's are deleted, each by its name in the session.
test("a rotated Junos community clears the device's communities first", () => {
    const adapter = Platforms.get("junos");
    const desired = "set snmp community <secret:COMMUNITY> authorization read-only\n";
    const current = "set snmp community <redacted> authorization read-only\n";

    expect(adapter.plan(desired, current, { secrets: false, rollback: 10 }).steps).toEqual([]);

    const sent = adapter.plan(desired, current, { secrets: true, rollback: 10 }).steps.flatMap((step) => step.send);
    expect(sent).toEqual(["delete snmp community <redacted>", "set snmp community <secret:COMMUNITY> authorization read-only"]);
});

test("a deactivated Junos statement the render wants is activated", () => {
    const adapter = Platforms.get("junos");
    const desired = "set protocols lldp interface all\n";
    const current = "set protocols lldp interface all\ndeactivate protocols lldp\n";

    const sent = adapter.plan(desired, current, { secrets: false, rollback: 10 }).steps.flatMap((step) => step.send);
    expect(sent).toEqual(["activate protocols lldp"]);
});

// Junos keeps a policy's terms in order and adds a new one at the end, so a rule inserted in the middle rewrites the policy whole.
test("a Junos policy that changes is deleted and set again in order", () => {
    const adapter = Platforms.get("junos");
    const term = (name: string, action: string) => `set policy-options policy-statement in term ${name} then ${action}`;
    const current = [term("1", "reject"), term("2", "accept")].join("\n");
    const desired = [term("1", "reject"), term('"2 New"', "reject"), term("3", "accept")].join("\n");

    const sent = adapter.plan(desired, current, { secrets: false, rollback: 10 }).steps.flatMap((step) => step.send);
    expect(sent).toEqual(["delete policy-options policy-statement in", ...desired.split("\n")]);
});

// The device prints an empty prefix list only while it has no entries.
test("a Junos prefix list a registry fills keeps its entries", () => {
    const adapter = Platforms.get("junos");
    const desired = "set policy-options prefix-list customer\n# generated policy-options prefix-list customer\n";
    const current = "set policy-options prefix-list customer 198.18.0.0/16\nset policy-options prefix-list customer 198.19.0.0/16\n";

    expect(adapter.plan(desired, current, { secrets: false, rollback: 10 }).steps).toEqual([]);
});

// A QFX5100 on 21.4 refused one term with both: `invalid prefix 2001:db8:217::/56 for family inet`.
test("the originated prefixes of each family get a term of their own", () => {
    const bgp = aggregationSwitch.routing!.bgp!;
    const originated = ["203.0.113.64/26", "2001:db8:100::/48"] as const;
    const device = { ...aggregationSwitch, routing: { ...aggregationSwitch.routing, bgp: { ...bgp, originated_prefixes: originated } } };
    const origin = Platforms.get("junos")
        .render(device)
        .split("\n")
        .filter((line) => line.includes("circuit-bgp-origin term networks"));

    expect(origin).toEqual([
        "set policy-options policy-statement circuit-bgp-origin term networks from route-filter 203.0.113.64/26 exact",
        "set policy-options policy-statement circuit-bgp-origin term networks then next policy",
        "set policy-options policy-statement circuit-bgp-origin term networks-v6 from route-filter 2001:db8:100::/48 exact",
        "set policy-options policy-statement circuit-bgp-origin term networks-v6 then next policy",
    ]);
});
