// Graceful restart on a BGP session (RFC 4724). Tested on a QFX5100 on Junos 21.4R3 and a FG-3700D on FortiOS 6.2.2 (TRAPS.md): each plan after the commit was empty.

import { expect, test } from "bun:test";
import type { Device, Neighbor } from "../../src/model";
import { Platforms } from "../../src/platforms";
import { Fixtures } from "../fixtures";

/** A fixture's device with these neighbors added. */
function withNeighbors(fixture: string, neighbors: Record<string, Neighbor>): Device {
    const device = Fixtures.device(fixture);
    const bgp = device.routing!.bgp!;
    return { ...device, routing: { ...device.routing, bgp: { ...bgp, neighbors: { ...bgp.neighbors, ...neighbors } } } };
}

/** A session with Hurricane Electric. */
const he: Neighbor = { address: "203.0.113.1", remote_as: 6939, graceful_restart: true };

test("RouterOS refuses it: every session offers it with a restart time of 0, and no setting changes that", () => {
    const device = withNeighbors("edge-router--edge-01", { "hurricane-electric": { ...he } });

    expect(Platforms.get("routeros").unsupported(device)).toContain(
        "routing.bgp.neighbors.hurricane-electric.graceful_restart, RouterOS 7.24 offers it on every session with a restart time of 0, so its neighbors drop its routes at once when it restarts, and no setting changes that"
    );
});

test("Junos turns it on for the whole router, so it is refused on only some neighbors and beside OSPF", () => {
    const junos = Platforms.get("junos");
    const base = Fixtures.device("platforms--example-aggregation-switch");
    const all: Device = {
        ...base,
        routing: {
            ...base.routing,
            ospf: undefined,
            bgp: { asn: 64500, neighbors: { "hurricane-electric": he, arelion: { ...he, address: "203.0.113.9", remote_as: 1299 } } },
        },
    };

    expect(junos.unsupported(all)).toEqual([]);
    expect(
        junos
            .render(all)
            .split("\n")
            .filter((line) => line.includes("graceful-restart"))
    ).toEqual(["set routing-options graceful-restart"]);

    const some = withNeighbors("platforms--example-aggregation-switch", { "hurricane-electric": he });
    const others = Object.keys(base.routing!.bgp!.neighbors!).join(", ");
    expect(junos.unsupported(some)).toEqual(
        expect.arrayContaining([
            `routing.bgp.neighbors.hurricane-electric.graceful_restart, but not on ${others}: Junos turns it on for every session at once. Set it on every neighbor or on none`,
        ])
    );

    const ospf: Device = { ...all, routing: { ...all.routing, ospf: { areas: { "0.0.0.0": { interfaces: { loopback: {} } } } } } };
    expect(junos.unsupported(ospf)).toContain(
        "routing.bgp.neighbors.hurricane-electric.graceful_restart with routing.ospf, Junos turns graceful restart on for OSPF too"
    );
});

test("FortiOS turns it on for the router and asks for it from each neighbor that has it, in each of its families", () => {
    const device = withNeighbors("platforms--example-firewall", {
        "hurricane-electric": he,
        "hurricane-electric-v6": { ...he, address: "2001:db8::1" },
        arelion: { address: "203.0.113.9", remote_as: 1299 },
    });
    const rendered = Platforms.get("fortios").render(device);
    const entry = (address: string) =>
        rendered.slice(rendered.indexOf(`edit "${address}"`), rendered.indexOf("next", rendered.indexOf(`edit "${address}"`)));

    expect(Platforms.get("fortios").unsupported(device)).toEqual([]);
    expect(rendered).toContain("    set graceful-restart enable\n");
    expect(entry("203.0.113.1")).toContain("set capability-graceful-restart enable");
    expect(entry("2001:db8::1")).toContain("set capability-graceful-restart6 enable");
    expect(entry("203.0.113.9")).not.toContain("graceful");
});

// What the FG-3700D printed for a neighbor with graceful restart and a prefix limit that only warns, its address replaced.
const PRINTED_BGP = `config router bgp
    set as 64500
    set graceful-restart enable
    config neighbor
        edit "203.0.113.1"
            set activate6 disable
            set capability-graceful-restart enable
            set maximum-prefix 1000
            set maximum-prefix-warning-only enable
            set remote-as 6939
            set route-map-in "circuit-reject-all"
            set route-map-out "circuit-reject-all"
        next
    end
    config redistribute "connected"
    end
end`;

test("FortiOS reads both back as the device printed them", () => {
    const fortios = Platforms.get("fortios");
    const device: Device = {
        name: "example-firewall",
        site: "lab",
        platform: "fortios",
        model: "FG-3700D",
        connection: { host: "192.0.2.10", user: "admin" },
        routing: { bgp: { asn: 64500, neighbors: { "hurricane-electric": { ...he, max_prefixes: { limit: 1000, warn_only: true } } } } },
    };
    const rendered = fortios.render(device);
    const start = rendered.indexOf("config router bgp\n");
    const end = rendered.indexOf("\nend", start) + "\nend".length;
    const printed = rendered.slice(0, start) + PRINTED_BGP + rendered.slice(end);

    expect(fortios.plan(rendered, printed, { secrets: false, rollback: 10 }).steps).toEqual([]);
    expect(
        fortios.plan(rendered, printed.replace("            set maximum-prefix-warning-only enable\n", ""), {
            secrets: false,
            rollback: 10,
        }).steps
    ).not.toEqual([]);
});
