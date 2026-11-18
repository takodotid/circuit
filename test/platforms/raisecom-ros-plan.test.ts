import { expect, test } from "bun:test";
import { Platforms } from "../../src/platforms";
import { Fixtures } from "../fixtures";

const coreSwitch = Fixtures.device("platforms--example-core-switch");

// Seen on a RAX721: an access group with its notify view, an SNMPv3 user as localized keys, and `portswitch` on a switched LAG.
test("example-core-switch plans nothing against how the device prints it", () => {
    const adapter = Platforms.get("raisecom-ros");
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

// The device refuses `no storm-control mode`, and kbps is its default.
test("a Raisecom port leaving storm control in pps returns to kbps", () => {
    const adapter = Platforms.get("raisecom-ros");
    const current = ["interface tengigabitethernet 1/3/12", "storm-control mode pps", "storm-control broadcast pps 1000"].join("\n");
    const desired = ["interface tengigabitethernet 1/3/12", "shutdown"].join("\n");

    const sent = adapter.plan(desired, current, { secrets: false, rollback: 10 }).steps.flatMap((step) => step.send);
    expect(sent).toContain("storm-control mode kbps");
    expect(sent).not.toContain("no storm-control mode");
});

// A port set back to auto prints it, though auto is the default. The device refuses `no duplex auto`.
test("a Raisecom port's speed and duplex at auto plan nothing", () => {
    const adapter = Platforms.get("raisecom-ros");
    const desired = ["interface tengigabitethernet 1/3/12", "shutdown"].join("\n");
    const current = ["interface tengigabitethernet 1/3/12", "duplex auto", "speed auto", "shutdown"].join("\n");

    expect(adapter.plan(desired, current, { secrets: false, rollback: 10 }).steps).toEqual([]);
});
