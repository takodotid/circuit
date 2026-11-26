// VRP and Raisecom ROS both plan with LineDiff.

import { expect, test } from "bun:test";
import { Platforms } from "../../src/platforms";
import { Fixtures } from "../fixtures";

const switchDevice = Fixtures.device("platforms--example-switch");
const coreSwitch = Fixtures.device("platforms--example-core-switch");

// Undoing a whole VLAN list line deletes VLANs still in use, which a switch refuses.
test("a VLAN list change sends only the VLANs added and removed", () => {
    const options = { secrets: false, rollback: 10 };

    const vrp = Platforms.get("vrp").plan("vlan batch 10 20 to 21 127\n", "vlan batch 10 20 to 22 99\n", options);
    expect(vrp.steps.flatMap((step) => step.send)).toEqual(["undo vlan batch 22 99", "vlan batch 127"]);

    const raisecom = Platforms.get("raisecom-ros").plan("create vlan 10,20-21,127 active\n", "create vlan 10,20-22,99 active\n", options);
    expect(raisecom.steps.flatMap((step) => step.send)).toEqual(["create vlan 127 active", "no vlan 22", "no vlan 99"]);
});

// A switch prints a secret as a cipher, so a rotated one compares equal (#93).
test("VRP and Raisecom send every secret again with --secrets, and none without", () => {
    for (const device of [switchDevice, coreSwitch]) {
        const adapter = Platforms.get(device.platform);
        const rendered = adapter.render(device);
        const secretLines = rendered.split("\n").filter((line) => line.includes("<secret:"));

        expect(secretLines.length).toBeGreaterThan(0);
        expect(adapter.plan(rendered, rendered, { secrets: false, rollback: 10 }).steps).toEqual([]);

        const sent = adapter.plan(rendered, rendered, { secrets: true, rollback: 10 }).steps.flatMap((step) => step.send);
        for (const line of secretLines) expect(sent).toContain(line.trim());
    }
});
