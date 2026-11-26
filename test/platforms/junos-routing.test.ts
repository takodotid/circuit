// Routing on Junos that passed `commit check` in a private candidate on a QFX5100 with Junos 21.4R3-S8.5 (#410). Nothing was committed. The lines the candidate printed are fed to the adapter, with names and addresses replaced.

import { expect, test } from "bun:test";
import type { Device, StaticRoute } from "../../src/model";
import { Platforms } from "../../src/platforms";
import { Fixtures } from "../fixtures";

const junos = Platforms.get("junos");
const options = { secrets: false, rollback: 10 };

const sent = (desired: string, current: string) => junos.plan(desired, current, options).steps.flatMap((step) => step.send);

/** The aggregation switch with only these static routes. */
function withRoutes(static_routes: StaticRoute[]): Device {
    const device = Fixtures.device("platforms--example-aggregation-switch");
    return { ...device, routing: { ...device.routing, static_routes } };
}

/** A render with its static routes as the candidate printed them. */
const printed = (desired: string, routes: string) =>
    [...desired.split("\n").filter((line) => line && !/^set routing-options (rib inet6\.0 )?static /.test(line)), routes].join("\n");

test("Junos writes a next hop with its interface as a qualified next hop, beside a distance too, experimentally", () => {
    const device = withRoutes([
        { prefix: "2001:db8:4100::/48", next_hop: "fe80::2", interface: "management" },
        { prefix: "203.0.113.0/24", next_hop: "192.0.2.2", interface: "management" },
        { prefix: "203.0.113.0/25", next_hop: "192.0.2.3", interface: "management", distance: 5 },
    ]);
    const desired = junos.render(device);

    // As the candidate printed them: the preference before the interface, each on a line of its own.
    const routes = `set routing-options rib inet6.0 static route 2001:db8:4100::/48 qualified-next-hop fe80::2 interface irb.10
set routing-options static route 203.0.113.0/24 qualified-next-hop 192.0.2.2 interface irb.10
set routing-options static route 203.0.113.0/25 qualified-next-hop 192.0.2.3 preference 5
set routing-options static route 203.0.113.0/25 qualified-next-hop 192.0.2.3 interface irb.10`;

    for (const line of routes.split("\n")) expect(desired).toContain(line);
    expect(desired).not.toContain("next-hop fe80::2\n");
    expect(sent(desired, printed(desired, routes))).toEqual([]);

    expect(junos.unsupported(device).filter((gap) => gap.startsWith("routing.static_routes"))).toEqual([]);
    expect(junos.experimental!(device)).toEqual(
        expect.arrayContaining([
            "routing.static_routes 2001:db8:4100::/48 interface",
            "routing.static_routes 203.0.113.0/24 interface",
            "routing.static_routes 203.0.113.0/25 interface",
        ])
    );
});

test("Junos refuses a link-local next hop without its interface, which the switch fails in commit check", () => {
    const device = withRoutes([{ prefix: "2001:db8:4200::/48", next_hop: "fe80::2" }]);

    expect(junos.unsupported(device)).toContain(
        "routing.static_routes 2001:db8:4200::/48 next_hop fe80::2 without interface: write the interface that reaches it"
    );
});
