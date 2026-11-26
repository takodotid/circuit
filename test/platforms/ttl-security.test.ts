// GTSM on a BGP session (RFC 5082). On RouterOS it was tested on a CCR2216 on 7.24.6 (TRAPS.md). A test connection was added, taken off GTSM, and put on it again. Each time, the next plan was empty. The router's lines are fed to the adapter, with names and addresses replaced.

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
    const current = bgp.neighbors?.[name];
    const address = settings.address ?? current?.address;
    if (!address) throw new Error(`${fixture} has no neighbor ${name}`);

    const neighbors = { ...bgp.neighbors, [name]: { ...current, ...settings, address } };
    return { ...device, routing: { ...device.routing, bgp: { ...bgp, neighbors } } };
}

const transit = (ttlSecurity?: true) => withNeighbor("edge-router--edge-01", "hurricane-electric", { ttl_security: ttlSecurity });

test("RouterOS sends with TTL 255 and accepts only 255, and reads both back as the router printed them", () => {
    const desired = routeros.render(transit(true));
    expect(desired).toContain("local.role=ebgp-customer local.ttl=255 name=hurricane-electric");
    expect(desired).toContain("remote.as=6939 remote.ttl=255");

    // Each after another property of its group: `local.role=ebgp .ttl=255`, `.as=64496 .ttl=255`.
    const printed = desired.replace(" local.ttl=255", " .ttl=255").replace("remote.as=6939 remote.ttl=255", ".as=6939 .ttl=255");
    expect(routeros.plan(desired, printed, options).steps).toEqual([]);
});

test("RouterOS takes GTSM off with remote.ttl=1, since neither TTL can be unset, and puts it on with remote.ttl=255", () => {
    const on = routeros.render(transit(true));
    const off = routeros.render(transit());
    const sent = (desired: string, current: string) => routeros.plan(desired, current, options).steps.flatMap((step) => step.send);

    expect(sent(off, on)).toEqual([
        '/routing bgp connection set [ find remote.address="203.0.113.1/32" and (vrf=main or !vrf) ] remote.ttl=1',
    ]);
    const printedOff = on.replace("remote.ttl=255", "remote.ttl=1");
    expect(sent(off, printedOff)).toEqual([]);

    // A session that never had them already sends with TTL 255.
    expect(sent(on, off)).toEqual([
        '/routing bgp connection set [ find remote.address="203.0.113.1/32" and (vrf=main or !vrf) ] remote.ttl=255',
    ]);
    expect(sent(on, printedOff)).toEqual([
        '/routing bgp connection set [ find remote.address="203.0.113.1/32" and (vrf=main or !vrf) ] remote.ttl=255',
    ]);
});

test("RouterOS refuses GTSM on an iBGP session, whose TTL it does not check", () => {
    const internal = withNeighbor("edge-router--edge-01", "edge-02", { address: "203.0.113.5", remote_as: 64500, ttl_security: true });

    expect(routeros.unsupported(internal)).toContain(
        "routing.bgp.neighbors.edge-02.ttl_security on an iBGP session, RouterOS checks the TTL of eBGP sessions only"
    );
});

test("Junos, FortiOS, and VRP refuse GTSM, and Raisecom ROS refuses BGP itself", () => {
    const junos = withNeighbor("platforms--example-aggregation-switch", "hurricane-electric", {
        address: "203.0.113.1",
        remote_as: 6939,
        ttl_security: true,
    });
    expect(Platforms.get("junos").unsupported(junos)).toContain(
        "routing.bgp.neighbors.hurricane-electric.ttl_security, Junos BGP sets only the TTL it sends, and has no setting that drops packets arriving with less than 255"
    );

    // On a FG-3700D with FortiOS 6.2.2, a neighbor's `set ttl-security-hops` was `command parse error`.
    const fortios = withNeighbor("platforms--example-firewall", "arelion", { address: "203.0.113.9", remote_as: 1299, ttl_security: true });
    expect(Platforms.get("fortios").unsupported(fortios)).toContain(
        "routing.bgp.neighbors.arelion.ttl_security, FortiOS BGP sets only the TTL it sends, and has no setting that drops packets arriving with less than 255"
    );

    const bgp: NonNullable<Device["routing"]>["bgp"] = {
        asn: 64500,
        neighbors: { transit: { address: "203.0.113.1", remote_as: 6939, ttl_security: true } },
    };
    const switchDevice = Fixtures.device("platforms--example-switch");
    expect(Platforms.get("vrp").unsupported({ ...switchDevice, routing: { ...switchDevice.routing, bgp } })).toContain(
        "routing.bgp.neighbors.transit.ttl_security, not built yet"
    );

    const coreSwitch = Fixtures.device("platforms--example-core-switch");
    expect(Platforms.get("raisecom-ros").unsupported({ ...coreSwitch, routing: { ...coreSwitch.routing, bgp } })).toContain("routing.bgp");
});
