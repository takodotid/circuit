// A plan sends only what changed, in the form each device accepts: what it prints differently is no change, and what it keeps for itself is never touched.

import { expect, test } from "bun:test";
import { adapters } from "../../src/adapters/devices";
import aggregationSwitch from "../../examples/aggregation-switch";
import coreSwitch from "../../examples/core-switch";
import router from "../../examples/router";

// The forms a Raisecom switch prints, seen on a RAX721: an access group with its notify view, an SNMPv3 user as localized keys, and `portswitch` on a switched LAG.
test("example-core-switch plans nothing against how the device prints it", () => {
    const adapter = adapters["raisecom-ros"]!;
    const rendered = adapter.render(coreSwitch);
    const printed = rendered
        .replace(
            /^snmp-server access (\S+) read internet usm authpriv$/m,
            "snmp-server access $1 read internet notify internet usm authpriv"
        )
        .replace(
            /^snmp-server user (\S+) authentication sha \S+ privacy aes128 \S+$/m,
            "snmp-server user $1 authkey sha <redacted> privkey  aes128 <redacted>"
        )
        .replace(/^interface port-channel (\d+)$/m, "interface port-channel $1\nportswitch");

    expect(printed).not.toEqual(rendered);

    const plan = adapter.plan(rendered, printed, { secrets: false, rollback: 10 });
    expect(plan.steps.flatMap((step) => step.show)).toEqual([]);
});

// Undoing a whole VLAN list line deletes VLANs still in use, which a switch refuses; only the change is sent.
test("a VLAN list change sends only the VLANs added and removed", () => {
    const options = { secrets: false, rollback: 10 };

    const vrp = adapters["vrp"]!.plan("vlan batch 10 20 to 21 127\n", "vlan batch 10 20 to 22 99\n", options);
    expect(vrp.steps.flatMap((step) => step.send)).toEqual(["undo vlan batch 22 99", "vlan batch 127"]);

    const raisecom = adapters["raisecom-ros"]!.plan("create vlan 10,20-21,127 active\n", "create vlan 10,20-22,99 active\n", options);
    expect(raisecom.steps.flatMap((step) => step.send)).toEqual(["no vlan 22", "no vlan 99", "create vlan 127 active"]);
});

test("untracked prefixes skip connection tracking both ways, in their own family", async () => {
    const rendered = adapters["routeros"]!.render({
        ...router,
        firewall: { ...router.firewall, untracked: ["198.51.100.64/27", "2001:db8:100::/48"] },
    });

    expect(rendered).toContain(
        [
            "/ip firewall raw",
            'add action=notrack chain=prerouting comment="Untracked to 198.51.100.64/27" dst-address=198.51.100.64/27',
            'add action=notrack chain=prerouting comment="Untracked from 198.51.100.64/27" src-address=198.51.100.64/27',
        ].join("\n")
    );
    expect(rendered).toContain(
        [
            "/ipv6 firewall raw",
            'add action=notrack chain=prerouting comment="Untracked to 2001:db8:100::/48" dst-address=2001:db8:100::/48',
        ].join("\n")
    );

    const adapter = adapters["routeros"]!;
    expect(adapter.plan(rendered, rendered, { secrets: false, rollback: 10 }).steps.flatMap((step) => step.show)).toEqual([]);
});

// The device keeps a dynamic fasttrack counter rule in the raw table, which it refuses to remove.
test("a rewrite of the raw table never selects a dynamic rule", () => {
    const adapter = adapters["routeros"]!;
    const before = adapter.render(router);
    const after = adapter.render({ ...router, firewall: { ...router.firewall, untracked: ["198.51.100.64/27"] } });
    const sent = adapter.plan(after, before, { secrets: false, rollback: 10 }).steps.flatMap((step) => step.send);

    expect(sent).toContain(":global frameworkOldRules [/ip firewall raw find where !dynamic]");
});

// 7.23 refuses a new BGP connection without its instance, and the export never prints the default one.
test("a new BGP connection names its instance, and an existing one plans nothing for it", () => {
    const adapter = adapters["routeros"]!;
    const rendered = adapter.render(router);
    const connections = rendered.split("\n").filter((line) => line.startsWith("add") && line.includes("remote.as="));

    expect(connections.length).toBeGreaterThan(0);
    expect(connections.every((line) => line.includes("instance=default"))).toBe(true);

    const exported = rendered.replace(/ instance=default/g, "");
    expect(adapter.plan(rendered, exported, { secrets: false, rollback: 10 }).steps.flatMap((step) => step.show)).toEqual([]);
});

// A peer's name is unique on the device, so a new key for the same peer must change the peer, not add another under its name.
test("a new WireGuard key for a peer is set on it", () => {
    const adapter = adapters["routeros"]!;
    const line = (key: string) =>
        `/interface wireguard peers\nadd allowed-address=10.0.0.2/32 interface=wg1 name=wg1-alice public-key="${key}"\n`;
    const plan = adapter.plan(line("bmV3S2V5bmV3S2V5bmV3S2V5bmV3S2V5bmV3S2V5bmU="), line("b2xkS2V5b2xkS2V5b2xkS2V5b2xkS2V5b2xkS2V5b2w="), {
        secrets: false,
        rollback: 10,
    });
    const sent = plan.steps.flatMap((step) => step.send);

    expect(sent).toHaveLength(1);
    expect(sent[0]).toBe(
        '/interface wireguard peers set [ find name=wg1-alice ] public-key="bmV3S2V5bmV3S2V5bmV3S2V5bmV3S2V5bmV3S2V5bmU="'
    );
});

// A VLAN interface on the bridge adds a dynamic bridge VLAN entry beside the static one, which a set must not select.
test("a change to a bridge VLAN selects only its static entry", () => {
    const adapter = adapters["routeros"]!;
    const entry = (tagged: string) => `/interface bridge vlan\nadd bridge=bridge tagged=${tagged} vlan-ids=325\n`;
    const sent = adapter.plan(entry("bridge,ether1"), entry("ether1"), { secrets: false, rollback: 10 }).steps.flatMap((step) => step.send);

    expect(sent).toEqual(["/interface bridge vlan set [ find vlan-ids=325 and !dynamic ] tagged=bridge,ether1"]);
});

// The forms a Junos switch prints, seen on a QFX5100 running 21.4: secrets hashed or encrypted, values quoted where the render does not quote them, the release and each user's number.
test("example-aggregation-switch plans nothing against how the device prints it", () => {
    const adapter = adapters["junos"]!;
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

// The device refuses `delete interfaces xe-0/0/1 unit`: a named list goes entry by entry, while a block the render does not hold goes whole.
test("a Junos removal stops at an entry of a named list, never at the list", () => {
    const adapter = adapters["junos"]!;
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

// A community is named by its value, which the read redacts: a new one is sent after the device's are deleted, each named in the session.
test("a rotated Junos community clears the device's communities first", () => {
    const adapter = adapters["junos"]!;
    const desired = "set snmp community <secret:COMMUNITY> authorization read-only\n";
    const current = "set snmp community <redacted> authorization read-only\n";

    expect(adapter.plan(desired, current, { secrets: false, rollback: 10 }).steps).toEqual([]);

    const sent = adapter.plan(desired, current, { secrets: true, rollback: 10 }).steps.flatMap((step) => step.send);
    expect(sent).toEqual(["delete snmp community <redacted>", "set snmp community <secret:COMMUNITY> authorization read-only"]);
});

test("a deactivated Junos statement the render wants is activated", () => {
    const adapter = adapters["junos"]!;
    const desired = "set protocols lldp interface all\n";
    const current = "set protocols lldp interface all\ndeactivate protocols lldp\n";

    const sent = adapter.plan(desired, current, { secrets: false, rollback: 10 }).steps.flatMap((step) => step.send);
    expect(sent).toEqual(["activate protocols lldp"]);
});

// Junos keeps a policy's terms in order and adds a new one at the end, so a rule inserted in the middle rewrites the policy whole.
test("a Junos policy that changes is deleted and set again in order", () => {
    const adapter = adapters["junos"]!;
    const term = (name: string, action: string) => `set policy-options policy-statement in term ${name} then ${action}`;
    const current = [term("1", "reject"), term("2", "accept")].join("\n");
    const desired = [term("1", "reject"), term('"2 New"', "reject"), term("3", "accept")].join("\n");

    const sent = adapter.plan(desired, current, { secrets: false, rollback: 10 }).steps.flatMap((step) => step.send);
    expect(sent).toEqual(["delete policy-options policy-statement in", ...desired.split("\n")]);
});

// A prefix list `refresh` fills keeps what the device holds, and the device prints an empty list only while it has no entries.
test("a Junos prefix list a registry fills keeps its entries", () => {
    const adapter = adapters["junos"]!;
    const desired = "set policy-options prefix-list customer\n# generated policy-options prefix-list customer\n";
    const current = "set policy-options prefix-list customer 198.18.0.0/16\nset policy-options prefix-list customer 198.19.0.0/16\n";

    expect(adapter.plan(desired, current, { secrets: false, rollback: 10 }).steps).toEqual([]);
});
