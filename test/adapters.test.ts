// Every example validates, renders, and plans nothing against its own render. A plan that is not empty there means the reader and the renderer disagree on a form, which would show up as a change on every apply.

import { describe, expect, test } from "bun:test";
import { adapters } from "../src/adapters/devices";
import { defineNetwork } from "../src/core/define";
import { validate } from "../src/core/validate";
import coreSwitch from "../examples/core-switch";
import router from "../examples/router";
import switchDevice from "../examples/switch";

const examples = [router, switchDevice, coreSwitch];

describe("examples", () => {
    test("validate", () => {
        const findings = validate(defineNetwork({ devices: examples, state: "" }));
        expect(findings).toEqual([]);
    });

    for (const device of examples) {
        test(`${device.name} plans nothing against its own render`, () => {
            const adapter = adapters[device.platform]!;
            const rendered = adapter.render(device);
            const plan = adapter.plan(rendered, rendered, { secrets: false, rollback: 10 });
            expect(plan.problems).toEqual([]);
            expect(plan.steps.flatMap((step) => step.show)).toEqual([]);
        });
    }
});

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

// Presets are plain config: what they return is what a device holds.
test("presets build the rules they describe", async () => {
    const { antiSpoofing, badTcpFlags, bgpSanity, exportsEndInReject, MARTIANS } = await import("../src/presets");

    expect(antiSpoofing("ix", MARTIANS).map((rule) => rule.match?.src)).toEqual([...MARTIANS]);
    expect(badTcpFlags()).toHaveLength(6);
    expect(bgpSanity().map((rule) => rule.description)).toEqual([
        "IPv4 shorter than /8",
        "IPv4 longer than /24",
        "IPv6 shorter than /16",
        "IPv6 longer than /48",
        "RPKI invalid",
    ]);

    const findings = exportsEndInReject([{ ...router, policies: { ...router.policies, "UPSTREAM-OUT": [{ action: "accept" }] } }]);
    expect(findings.map((finding) => finding.message)).toContain("upstream-1: export UPSTREAM-OUT does not end in an unconditional reject");
});

test("trustBoundary finds an untrusted VLAN beside a trusted one away from a router", async () => {
    const { trustBoundary, vlansOf } = await import("../src/presets");

    expect(vlansOf({ access_vlan: "a", trunk_vlans: ["b"] })).toEqual(["a", "b"]);

    const check = trustBoundary({ untrusted: ["guests"], trusted: ["servers"], routers: ["example-router"] });
    expect(check([switchDevice]).map((finding) => finding.message)).toEqual([
        "LAG uplink carries an untrusted VLAN beside a trusted one and does not face a router",
        "interface guests puts an address on untrusted VLAN guests; only a router may",
    ]);
});

test("merge refuses a name two records hold", async () => {
    const { merge } = await import("../src/core/merge");

    expect(merge({ a: 1 }, { b: 2 })).toEqual({ a: 1, b: 2 });
    expect(() => merge({ a: 1 }, { a: 2 })).toThrow("merge: a is declared twice");
});
