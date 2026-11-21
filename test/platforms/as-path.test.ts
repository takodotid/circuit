// AS path and community list matches. Each was tested on a CCR2216 (RouterOS 7.24.6), a QFX5100 (Junos 21.4R3), and a FortiGate 3700D (FortiOS 6.2.2), as TRAPS.md says. On each, the rendered policy was sent, and the next plan was empty. Junos's matches were checked with `test policy` against static routes with AS paths and communities. RouterOS's AS path sets were checked with `/routing/filter/test-as-path-regexp`.

import { expect, test } from "bun:test";
import { presets } from "../../src/config/presets";
import type { Device, Neighbor, PolicyRule } from "../../src/model";
import { Platforms } from "../../src/platforms";
import { Derive } from "../../src/core/derive";
import { Fixtures } from "../fixtures";

const options = { secrets: false, rollback: 10 };

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

test("RouterOS anchors the first and the origin AS, and quotes a set, which the router refuses unquoted", () => {
    const rendered = Platforms.get("routeros").render(
        importing("edge-router--edge-01", [
            { if: { first_as: 64501, origin_as: [64501, { min: 64502, max: 64505 }] }, then: "accept" },
            { if: { as_path_contains: presets.bogon_asns }, then: "reject" },
            { if: { first_as: { min: 64512, max: 65534 } }, then: "reject" },
        ])
    );

    expect(rendered).toContain(`rule="if (bgp-as-path ^64501 && bgp-as-path \\"[64501 64502-64505]\\$\\") { accept }"`);
    expect(rendered).toContain(
        `rule="if (bgp-as-path \\"[0 23456 64496-64511 64512-65534 65535 65536-65551 65552-131071 4200000000-4294967294 4294967295]\\") { reject }"`
    );
    expect(rendered).toContain(`rule="if (bgp-as-path ^[64512-65534]) { reject }"`);
});

test("RouterOS matches any community of a list, and one with a * part by regular expression", () => {
    const rendered = Platforms.get("routeros").render(
        importing("edge-router--edge-01", [
            { if: { standard_community: "64500:1" }, set: { local_pref: 90 } },
            { if: { standard_community: ["64500:1", "64500:2"] }, set: { local_pref: 90 } },
            { if: { large_community: ["64500:1:*", "64500:2:6939"] }, then: "accept" },
        ])
    );

    expect(rendered).toContain(`rule="if (bgp-communities includes 64500:1) { set bgp-local-pref 90 }"`);
    expect(rendered).toContain(`rule="if (bgp-communities any 64500:1,64500:2) { set bgp-local-pref 90 }"`);
    expect(rendered).toContain(`rule="if (bgp-large-communities any-regexp \\"^(64500:1:[0-9]+|64500:2:6939)\\$\\") { accept }"`);
});

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

test("Junos matches the first and the origin AS with AS lists, and AS 0 or AS 4294967295, which an AS list refuses, by regular expression", () => {
    const device = importing("platforms--example-aggregation-switch", [
        { if: { first_as: [64501, { min: 6000, max: 7000 }], origin_as: [64502, { min: 170, max: 180 }] }, then: "accept" },
        { if: { first_as: [0, 64501] }, then: "accept" },
        { if: { as_path_contains: presets.bogon_asns }, then: "reject" },
    ]);
    const junos = lines("junos", device);

    expect(junos).toEqual(
        expect.arrayContaining([
            "set policy-options as-list circuit-as-64501-6000to7000 members 64501",
            "set policy-options as-list circuit-as-64501-6000to7000 members 6000-7000",
            "set policy-options policy-statement as64501-import term 1 from as-path-neighbors as-list circuit-as-64501-6000to7000",
            "set policy-options policy-statement as64501-import term 1 from as-path-origins as-list circuit-as-64502-170to180",
            'set policy-options as-path circuit-first-0-64501 "(0|64501) .*"',
            "set policy-options as-path circuit-through-0-23456-64496to64511-64512to65534-65535-65536to65551-65552to131071-4200000000to4294967294-4294967295 " +
                '".* (0|23456|64496-64511|64512-65534|65535|65536-65551|65552-131071|4200000000-4294967294|4294967295) .*"',
        ])
    );
    expect(
        Platforms.get("junos")
            .unsupported(device)
            .filter((line) => line.includes("as64501-import"))
    ).toEqual([]);

    // The device prints a member with a * unquoted, and a list's members one per line.
    const desired = Platforms.get("junos").render(device);
    expect(Platforms.get("junos").plan(desired, desired.replace(/members "([^"]*)"/g, "members $1"), options).steps).toEqual([]);
});

test("Junos refuses two AS path regular expressions in one rule", () => {
    const device = importing("platforms--example-aggregation-switch", [
        { if: { as_path_contains: presets.bogon_asns, as_path_length: { min: 101 } }, then: "reject" },
        { if: { as_path_contains: { min: 64512, max: 65534 }, as_path_length: { min: 101 } }, then: "reject" },
    ]);

    expect(Platforms.get("junos").unsupported(device)).toContain(
        "routing.policies.as64501-import[0].if.as_path_contains with as_path_length: Junos matches both by regular expression and joins two of those by OR. Leave AS 0 and AS 4294967295 out, which only a regular expression matches, or match each in a rule of its own"
    );
    expect(
        Platforms.get("junos")
            .unsupported(device)
            .filter((line) => line.includes("as64501-import[1]"))
    ).toEqual([]);
});

test("Junos lists each pair of a standard and a large community, since a term matches any community in its list, and a community needs all of its members", () => {
    const junos = lines(
        "junos",
        importing("platforms--example-aggregation-switch", [
            { if: { standard_community: ["64500:5", "64501:1"], large_community: "64500:1:*" }, then: "accept" },
        ])
    );

    expect(junos.filter((line) => line.includes("term 1 from community"))).toEqual([
        "set policy-options policy-statement as64501-import term 1 from community circuit-match-64500-5-large-64500-1-any",
        "set policy-options policy-statement as64501-import term 1 from community circuit-match-64501-1-large-64500-1-any",
    ]);
    expect(junos).toContain('set policy-options community circuit-match-64501-1-large-64500-1-any members "large:64500:1:*"');
});

test("FortiOS matches one AS path list per rule, a pattern for each number range, and refuses a second", () => {
    const device = importing("platforms--example-firewall", [
        { if: { origin_as: [64501, { min: 64502, max: 64505 }] }, then: "accept" },
        { if: { first_as: 64501 }, then: "accept" },
        { if: { as_path_length: { min: 101 } }, then: "reject" },
        { if: { as_path_length: { max: 3 } }, then: "accept" },
        { if: { first_as: 64501, as_path_length: { max: 3 } }, then: "accept" },
    ]);
    const fortios = Platforms.get("fortios");
    const rendered = fortios.render(device);

    const regexps = (list: string) =>
        rendered
            .split(`edit "${list}"`)[1]!
            .split("\n    next")[0]!
            .split("\n")
            .filter((line) => line.includes("set regexp"))
            .map((line) => line.trim());
    expect(regexps("as64501-import-1")).toEqual(['set regexp "_64501$"', 'set regexp "_6450[2-5]$"']);
    expect(regexps("as64501-import-2")).toEqual(['set regexp "^64501_"']);
    expect(regexps("as64501-import-3")).toEqual(['set regexp "^[0-9]+( [0-9]+){100}"']);
    expect(regexps("as64501-import-4")).toEqual(['set regexp "^$"', 'set regexp "^[0-9]+( [0-9]+){0,2}$"']);
    expect(rendered).toContain('set match-as-path "as64501-import-1"');

    expect(fortios.unsupported(device)).toContain(
        "routing.policies.as64501-import[4].if.first_as with as_path_length: a route map rule matches one AS path list. Match each in a rule of its own"
    );
    expect(fortios.experimental?.(device)).toEqual([]);
});

test("A number range is written as patterns as patterns that match exactly its numbers", () => {
    for (const [min, max] of [
        [0, 0],
        [9, 12],
        [64496, 64511],
        [64512, 65534],
        [65552, 131071],
    ] as const) {
        const pattern = new RegExp(`^(${Derive.numberPatterns(min, max).join("|")})$`);
        const wrong: number[] = [];
        for (let number = Math.max(0, min - 1000); number <= max + 1000; number++)
            if (pattern.test(String(number)) !== (number >= min && number <= max)) wrong.push(number);
        expect(wrong).toEqual([]);
    }

    expect(Derive.numberPatterns(4200000000, 4294967294)).toEqual([
        "42[0-8][0-9][0-9][0-9][0-9][0-9][0-9][0-9]",
        "429[0-3][0-9][0-9][0-9][0-9][0-9][0-9]",
        "4294[0-8][0-9][0-9][0-9][0-9][0-9]",
        "42949[0-5][0-9][0-9][0-9][0-9]",
        "429496[0-6][0-9][0-9][0-9]",
        "4294967[0-1][0-9][0-9]",
        "42949672[0-8][0-9]",
        "429496729[0-4]",
    ]);
});

test("FortiOS matches any community of a list, one permit rule each, and patterns with an expanded list", () => {
    const rendered = Platforms.get("fortios").render(
        importing("platforms--example-firewall", [
            { if: { standard_community: ["64500:1", "64500:2"] }, then: "accept" },
            { if: { standard_community: ["64500:*", "64501:7"] }, then: "reject" },
        ])
    );

    expect(rendered).toContain(
        [
            '    edit "as64501-import-1"',
            "        config rule",
            "            edit 1",
            "                set action permit",
            '                set match "64500:1"',
            "            next",
            "            edit 2",
            "                set action permit",
            '                set match "64500:2"',
            "            next",
            "        end",
            "    next",
            '    edit "as64501-import-2"',
            "        set type expanded",
            "        config rule",
            "            edit 1",
            "                set action permit",
            '                set regexp "^64500:[0-9]+$"',
        ].join("\n")
    );
});
