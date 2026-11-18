// A prefix limit that opens the session again after a time, or only warns. Tested on a QFX5100 on Junos 21.4R3 and a FG-3700D on FortiOS 6.2.2: each plan after the commit was empty.

import { expect, test } from "bun:test";
import type { Device, Neighbor } from "../../src/model";
import { Platforms } from "../../src/platforms";
import { Fixtures } from "../fixtures";

const options = { secrets: false, rollback: 10 };

/** A fixture's device with these neighbors added. */
function withNeighbors(fixture: string, neighbors: Record<string, Neighbor>): Device {
    const device = Fixtures.device(fixture);
    const bgp = device.routing!.bgp!;
    return { ...device, routing: { ...device.routing, bgp: { ...bgp, neighbors: { ...bgp.neighbors, ...neighbors } } } };
}

const he = (max_prefixes: Neighbor["max_prefixes"]): Record<string, Neighbor> => ({
    "hurricane-electric": { address: "203.0.113.1", remote_as: 6939, max_prefixes },
});

test("Junos only logs without teardown, and opens the session again after whole minutes", () => {
    const junos = Platforms.get("junos");
    const limits = (max: Neighbor["max_prefixes"]) =>
        junos
            .render(withNeighbors("platforms--example-aggregation-switch", he(max)))
            .split("\n")
            .filter((line) => line.startsWith("set protocols bgp group hurricane-electric family inet unicast prefix-limit"));
    const at = "set protocols bgp group hurricane-electric family inet unicast prefix-limit";

    expect(limits({ limit: 1000, warn_only: true })).toEqual([`${at} maximum 1000`]);
    expect(limits({ limit: 1000, restart_after: 300 })).toEqual([`${at} maximum 1000`, `${at} teardown idle-timeout 5`]);
    expect(limits(1000)).toEqual([`${at} maximum 1000`, `${at} teardown idle-timeout forever`]);

    const plan = junos.plan(
        junos.render(withNeighbors("platforms--example-aggregation-switch", he({ limit: 1000, warn_only: true }))),
        junos.render(withNeighbors("platforms--example-aggregation-switch", he(1000))),
        options
    );
    expect(plan.steps.flatMap((step) => step.send)).toEqual([
        `delete protocols bgp group hurricane-electric family inet unicast prefix-limit teardown`,
    ]);

    for (const restart_after of [90, 30, 144_060])
        expect(junos.unsupported(withNeighbors("platforms--example-aggregation-switch", he({ limit: 1000, restart_after })))).toContain(
            `routing.bgp.neighbors.hurricane-electric.max_prefixes.restart_after ${restart_after}, Junos waits whole minutes, up to 2400: write a multiple of 60`
        );
});

test("FortiOS only warns in each family, and refuses a restart", () => {
    const fortios = Platforms.get("fortios");
    const v6 = {
        "hurricane-electric-v6": { address: "2001:db8::1", remote_as: 6939, max_prefixes: { limit: 1000, warn_only: true } },
    } as const;
    const rendered = fortios.render(withNeighbors("platforms--example-firewall", { ...he({ limit: 1000, warn_only: true }), ...v6 }));

    expect(rendered).toContain("set maximum-prefix 1000\n            set maximum-prefix-warning-only enable");
    expect(rendered).toContain("set maximum-prefix6 1000\n            set maximum-prefix-warning-only6 enable");
    expect(fortios.unsupported(withNeighbors("platforms--example-firewall", he({ limit: 1000, restart_after: 300 })))).toContain(
        "routing.bgp.neighbors.hurricane-electric.max_prefixes.restart_after, FortiOS 6.2 keeps the session closed until it is cleared by hand"
    );
});

test("RouterOS refuses both: it always closes the session, until it is cleared by hand", () => {
    const routeros = Platforms.get("routeros");

    expect(routeros.unsupported(withNeighbors("edge-router--edge-01", he({ limit: 1000, warn_only: true })))).toContain(
        "routing.bgp.neighbors.hurricane-electric.max_prefixes.warn_only, RouterOS always closes the session at its limit"
    );
    expect(routeros.unsupported(withNeighbors("edge-router--edge-01", he({ limit: 1000, restart_after: 300 })))).toContain(
        "routing.bgp.neighbors.hurricane-electric.max_prefixes.restart_after, RouterOS keeps the session closed until it is cleared by hand"
    );
});
