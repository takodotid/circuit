// AS path matches, tested on a QFX5100 (Junos 21.4R3), as TRAPS.md says. The rendered policy was sent, and the next plan was empty. Its matches were checked with `test policy` against static routes with AS paths.

import { expect, test } from "bun:test";
import type { Device, Neighbor, PolicyRule } from "../../src/model";
import { Platforms } from "../../src/platforms";
import { Fixtures } from "../fixtures";

/** A fixture's device whose BGP has one neighbor, AS64501, which imports with `rules`. */
function importing(fixture: string, rules: readonly PolicyRule[]): Device {
    const device = Fixtures.device(fixture);
    const neighbors: Record<string, Neighbor> = { as64501: { address: "192.0.2.2", remote_as: 64501, import_policy: "as64501-import" } };
    return {
        ...device,
        routing: {
            ...device.routing,
            bgp: { asn: device.routing!.bgp!.asn, neighbors },
            policies: { ...device.routing?.policies, "as64501-import": rules },
        },
    };
}

const lines = (platform: string, device: Device) => Platforms.get(platform).render(device).split("\n");

test("Junos joins an AS path length and an AS in the path by AND: two AS path regular expressions in one term would join by OR", () => {
    const junos = lines(
        "junos",
        importing("platforms--example-aggregation-switch", [
            { if: { as_path_contains: 64501, as_path_length: { min: 3 } }, then: "accept" },
        ])
    );

    const from = junos.filter((line) => line.includes("policy-statement as64501-import term 1 from"));
    expect(from).toEqual([
        "set policy-options policy-statement as64501-import term 1 from as-path circuit-path-length-3-any",
        "set policy-options policy-statement as64501-import term 1 from as-path-transits as-list circuit-as-64501",
    ]);
    expect(junos).toContain("set policy-options as-list circuit-as-64501 members 64501");
});

test("Junos refuses AS 0 in the path with a path length: an AS list refuses AS 0, and two regular expressions join by OR", () => {
    const device = importing("platforms--example-aggregation-switch", [
        { if: { as_path_contains: 0, as_path_length: { min: 101 } }, then: "reject" },
        { if: { as_path_contains: 0 }, then: "reject" },
    ]);

    expect(Platforms.get("junos").unsupported(device)).toContain(
        "routing.policies.as64501-import[0].if.as_path_contains with as_path_length: Junos matches both by regular expression and joins two of those by OR. Leave AS 0 and AS 4294967295 out, which only a regular expression matches, or match each in a rule of its own"
    );
    expect(lines("junos", device)).toContain('set policy-options as-path circuit-through-0 ".* 0 .*"');
});
