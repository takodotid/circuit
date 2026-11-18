// BGP aggregates. Tested on a FortiGate 3700D with FortiOS 6.2.2 and a QFX5100 with Junos 21.4R3, each in a session with a CCR2216 (TRAPS.md). On each, the next plan was empty.

import { expect, test } from "bun:test";
import type { Device, Prefix } from "../../src/model";
import { Platforms } from "../../src/platforms";
import { Fixtures } from "../fixtures";

type Aggregates = NonNullable<NonNullable<NonNullable<Device["routing"]>["bgp"]>["aggregates"]>;

/** A fixture's device with these aggregates, and these originated prefixes when given. */
function withAggregates(fixture: string, aggregates: Aggregates, originated?: readonly Prefix[]): Device {
    const device = Fixtures.device(fixture);
    const bgp = device.routing!.bgp!;
    return {
        ...device,
        routing: { ...device.routing, bgp: { ...bgp, aggregates, originated_prefixes: originated ?? bgp.originated_prefixes } },
    };
}

test("RouterOS refuses aggregates", () => {
    const device = withAggregates("edge-router--edge-01", [{ prefix: "198.51.100.0/24" }]);
    expect(Platforms.get("routeros").unsupported(device)).toContain("routing.bgp.aggregates, RouterOS 7 BGP has no aggregate routes");
});

test("FortiOS writes each aggregate in its family's table", () => {
    const device = withAggregates("platforms--example-firewall", [
        { prefix: "198.51.100.0/24", summary_only: true },
        { prefix: "2001:db8:100::/40" },
    ]);

    expect(Platforms.get("fortios").render(device)).toContain(
        [
            "    config aggregate-address",
            "        edit 1",
            "            set prefix 198.51.100.0 255.255.255.0",
            "            set summary-only enable",
            "        next",
            "    end",
            "    config aggregate-address6",
            "        edit 1",
            "            set prefix6 2001:db8:100::/40",
            "        next",
            "    end",
        ].join("\n")
    );
});

test("Junos counts only BGP's routes and the originated prefixes, rejects what an aggregate summarizes, and passes the aggregate on, a term per family", () => {
    const device = withAggregates(
        "platforms--example-aggregation-switch",
        [
            { prefix: "203.0.113.0/24", summary_only: true },
            { prefix: "2001:db8:100::/40", summary_only: true },
        ],
        ["203.0.113.64/26", "2001:db8:100::/48"]
    );
    const lines = Platforms.get("junos").render(device).split("\n");
    const origin = (term: string) =>
        lines.filter((line) => line.startsWith(`set policy-options policy-statement circuit-bgp-origin term ${term} `));

    expect(lines).toContain("set routing-options aggregate route 203.0.113.0/24 policy circuit-aggregate-contributors");
    expect(lines).toContain("set routing-options rib inet6.0 aggregate route 2001:db8:100::/40 policy circuit-aggregate-contributors");
    expect(lines.filter((line) => line.includes("circuit-aggregate-contributors term"))).toEqual([
        "set policy-options policy-statement circuit-aggregate-contributors term bgp from protocol bgp",
        "set policy-options policy-statement circuit-aggregate-contributors term bgp then accept",
        "set policy-options policy-statement circuit-aggregate-contributors term networks from route-filter 203.0.113.64/26 exact",
        "set policy-options policy-statement circuit-aggregate-contributors term networks then accept",
        "set policy-options policy-statement circuit-aggregate-contributors term networks-v6 from route-filter 2001:db8:100::/48 exact",
        "set policy-options policy-statement circuit-aggregate-contributors term networks-v6 then accept",
        "set policy-options policy-statement circuit-aggregate-contributors term others then reject",
    ]);

    // Before BGP's own routes, so a learned route inside an aggregate stays here too.
    expect(lines.findIndex((line) => line.includes("circuit-bgp-origin term summary-only "))).toBeLessThan(
        lines.findIndex((line) => line.includes("circuit-bgp-origin term bgp "))
    );
    expect(origin("summary-only-v6")).toEqual([
        "set policy-options policy-statement circuit-bgp-origin term summary-only-v6 from route-filter 2001:db8:100::/40 longer",
        "set policy-options policy-statement circuit-bgp-origin term summary-only-v6 then reject",
    ]);
    expect(origin("aggregates")).toEqual([
        "set policy-options policy-statement circuit-bgp-origin term aggregates from protocol aggregate",
        "set policy-options policy-statement circuit-bgp-origin term aggregates from route-filter 203.0.113.0/24 exact",
        "set policy-options policy-statement circuit-bgp-origin term aggregates then next policy",
    ]);
});
