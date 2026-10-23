// What a FortiGate 3700D on FortiOS 6.2.2 printed while a feature was proved on it, and what Circuit makes of it.

import { expect, test } from "bun:test";
import { Platforms } from "../../src/platforms";

const platform = Platforms.get("fortios");

test("circuit show may read what LLDP received", () => {
    for (const command of [
        "diagnose lldprx neighbor summary",
        "diagnose lldprx neighbor details",
        "diagnose lldprx port summary",
        "diagnose lldprx port details port5",
    ]) {
        expect(platform.readOnly(command)).toBe(true);
    }

    expect(platform.readOnly("diagnose lldprx")).toBe(false);
});
