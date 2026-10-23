// What a FortiGate 3700D on FortiOS 6.2.2 printed while a feature was proved on it, and what Circuit makes of it.

import { expect, test } from "bun:test";
import firewall from "../../examples/platforms/fortios";
import { Platforms } from "../../src/platforms";
import type { Device } from "../../src/schema";

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

test("LLDP runs on an aggregate, and is refused on a VLAN interface, which has no LLDP settings", () => {
    const lldp = (name: string) =>
        platform.unsupported({ ...firewall, lldp: { interfaces: [name] } } as Device).filter((gap) => gap.startsWith("lldp"));

    expect(lldp("uplink")).toEqual([]);
    expect(lldp("guests")).toEqual(["lldp.interfaces guests, a vlan"]);
});
