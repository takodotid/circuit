// A default route sent to one neighbor. Tested in sessions between a CCR2216 on RouterOS 7.24.6, a FortiGate 3700D on FortiOS 6.2.2, and a QFX5100 on Junos 21.4R3 (TRAPS.md). On each, the next plan was empty.

import { expect, test } from "bun:test";
import type { Device, Neighbor } from "../../src/model";
import { Platforms } from "../../src/platforms";
import { Fixtures } from "../fixtures";

const options = { secrets: false, rollback: 10 };
const routeros = Platforms.get("routeros");

/** A fixture's device with neighbor `name` changed by `settings`, or added with them. */
function withNeighbor(fixture: string, name: string, settings: Partial<Neighbor>): Device {
    const device = Fixtures.device(fixture);
    const bgp = device.routing!.bgp!;
    const neighbor = { ...bgp.neighbors?.[name], ...settings };
    if (!neighbor.address) throw new Error(`${fixture} has no neighbor ${name}`);

    const neighbors = { ...bgp.neighbors, [name]: { ...neighbor, address: neighbor.address } };
    return { ...device, routing: { ...device.routing, bgp: { ...bgp, neighbors } } };
}

const sent = (desired: string, current: string) => routeros.plan(desired, current, options).steps.flatMap((step) => step.send);

/** Novaram, AS34165, a customer that takes the default route. */
const novaram: Partial<Neighbor> = { address: "198.51.100.130", remote_as: 34165, role: "customer", export_policy: "OUT" };

test("RouterOS sends the default route through a chain that accepts it before the export's own, and reads it back as the router printed it", () => {
    const desired = routeros.render(withNeighbor("edge-router--edge-01", "novaram", { ...novaram, send_default_route: true }));

    expect(desired).toContain('add chain=OUT-DEFAULT-V4 rule="if (dst==0.0.0.0/0) { accept }"');
    expect(desired).toContain('add chain=OUT-DEFAULT-V4 rule="jump OUT-V4"');
    expect(desired).toContain("output.default-originate=always output.filter-chain=OUT-DEFAULT-V4");
    // The transit and route server sessions keep the export's chain.
    expect(desired).toContain("name=hurricane-electric output.filter-chain=OUT-V4");
    expect(desired).toContain("output.filter-chain=OUT-V6");

    // After another property of its group: `output.default-originate=always .filter-chain=OUT-DEFAULT-V4`.
    const printed = desired.replace("output.filter-chain=OUT-DEFAULT-V4", ".filter-chain=OUT-DEFAULT-V4");
    expect(sent(desired, printed)).toEqual([]);
});

test("RouterOS stops the default route with never, which the router then prints, and removes its chain", () => {
    const on = routeros.render(withNeighbor("edge-router--edge-01", "novaram", { ...novaram, send_default_route: true }));
    const off = routeros.render(withNeighbor("edge-router--edge-01", "novaram", novaram));

    const turnedOff = sent(off, on);
    expect(turnedOff).toContain(
        '/routing bgp connection set [ find remote.address="198.51.100.130/32" and (vrf=main or !vrf) ] output.filter-chain=OUT-V4 output.default-originate=never'
    );
    expect(turnedOff).toContain('/routing filter rule remove [ find chain="OUT-DEFAULT-V4" ]');

    const printedOff = off.replace(
        "name=novaram output.filter-chain=OUT-V4",
        "name=novaram output.default-originate=never output.filter-chain=OUT-V4"
    );
    expect(printedOff).not.toBe(off);
    expect(sent(off, printedOff)).toEqual([]);
});

test("FortiOS sends a default route in each family of the session", () => {
    const device = withNeighbor("platforms--example-firewall", "novaram", {
        ...novaram,
        address_families: ["ipv4", "ipv6"],
        send_default_route: true,
    });
    const desired = Platforms.get("fortios").render(device);

    expect(desired).toContain("set capability-default-originate enable");
    expect(desired).toContain("set capability-default-originate6 enable");
});

test("Junos sends the default route before the session's export, from a route that is always there and loses to any other default", () => {
    const device = withNeighbor("platforms--example-aggregation-switch", "as64501", {
        address: "192.0.2.31",
        remote_as: 64501,
        address_families: ["ipv4", "ipv6"],
        import_policy: "customer-in",
        export_policy: "customer-out",
        send_default_route: true,
    });
    const lines = Platforms.get("junos").render(device).split("\n");

    expect(lines.indexOf("set protocols bgp group as64501 export circuit-default-route")).toBeGreaterThan(-1);
    expect(lines.indexOf("set protocols bgp group as64501 export circuit-default-route")).toBeLessThan(
        lines.indexOf("set protocols bgp group as64501 export circuit-bgp-origin")
    );

    for (const [family, route] of [
        ["ipv4", "routing-options aggregate route 0.0.0.0/0"],
        ["ipv6", "routing-options rib inet6.0 aggregate route ::/0"],
    ]) {
        expect(lines).toContain(`set ${route} passive`);
        expect(lines).toContain(`set ${route} preference 4294967295`);
        expect(lines).toContain(`set policy-options policy-statement circuit-default-route term ${family} then next-hop self`);
        expect(lines).toContain(`set policy-options policy-statement circuit-default-route term ${family} then accept`);
    }
});
