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

// On Junos, as a QFX5100 on 21.4R3-S8.5 printed it in a private candidate, which passed `commit check`. Nothing was committed.
test("Junos sends with TTL 255 and drops BGP from the neighbor that arrives with less, in the loopback's filter, experimentally", () => {
    const junos = Platforms.get("junos");
    const v4 = withNeighbor("platforms--example-aggregation-switch", "hurricane-electric", {
        address: "203.0.113.1",
        remote_as: 6939,
        ttl_security: true,
    });
    const device = withNeighbor("platforms--example-aggregation-switch", "hurricane-electric-v6", {
        address: "2001:db8:31::2",
        remote_as: 6939,
        ttl_security: true,
    });
    device.routing!.bgp!.neighbors!["hurricane-electric"] = v4.routing!.bgp!.neighbors!["hurricane-electric"]!;
    const desired = junos.render(device);

    const printed = [
        "set protocols bgp group hurricane-electric ttl 255",
        "set firewall family inet filter circuit-services term gtsm from source-address 203.0.113.1/32",
        "set firewall family inet filter circuit-services term gtsm from protocol tcp",
        "set firewall family inet filter circuit-services term gtsm from ttl-except 255",
        "set firewall family inet filter circuit-services term gtsm from port 179",
        "set firewall family inet filter circuit-services term gtsm then discard",
        "set protocols bgp group hurricane-electric-v6 ttl 255",
        "set firewall family inet6 filter circuit-services-v6 term gtsm from source-address 2001:db8:31::2/128",
        "set firewall family inet6 filter circuit-services-v6 term gtsm from next-header tcp",
        "set firewall family inet6 filter circuit-services-v6 term gtsm from port 179",
        "set firewall family inet6 filter circuit-services-v6 term gtsm from hop-limit-except 255",
        "set firewall family inet6 filter circuit-services-v6 term gtsm then discard",
    ];
    for (const line of printed) expect(desired).toContain(line);

    // The term comes first in each filter, before the services' own.
    const terms = desired.split("\n").filter((line) => line.startsWith("set firewall family inet filter circuit-services term"));
    expect(terms[0]).toContain("term gtsm ");

    // The switch prints the TTL before the port.
    const inet = "set firewall family inet filter circuit-services term gtsm from";
    const asPrinted = desired.replace(`${inet} port 179\n${inet} ttl-except 255`, `${inet} ttl-except 255\n${inet} port 179`);
    expect(asPrinted).not.toEqual(desired);
    expect(junos.plan(desired, asPrinted, options).steps).toEqual([]);

    expect(junos.unsupported(device).filter((gap) => gap.includes("ttl_security"))).toEqual([]);
    expect(junos.experimental!(device)).toEqual(
        expect.arrayContaining([
            "routing.bgp.neighbors.hurricane-electric.ttl_security",
            "routing.bgp.neighbors.hurricane-electric-v6.ttl_security",
        ])
    );
});

test("Junos refuses GTSM on an iBGP session, as the switch fails ttl 255 there in commit check", () => {
    const internal = withNeighbor("platforms--example-aggregation-switch", "core-02", {
        address: "203.0.113.66",
        remote_as: 64500,
        ttl_security: true,
    });

    expect(Platforms.get("junos").unsupported(internal)).toContain(
        "routing.bgp.neighbors.core-02.ttl_security on an iBGP session, Junos sets TTL 255 on single-hop eBGP sessions only"
    );
});

test("FortiOS and VRP refuse GTSM, and Raisecom ROS refuses BGP itself", () => {
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
