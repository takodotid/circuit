// Route reflection (RFC 4456), tested on a CCR2216 with RouterOS 7.24.6, a QFX5100 with Junos 21.4R3, and a FortiGate 3700D with FortiOS 6.2.2 (TRAPS.md). On each, a client and a cluster ID were set, then taken away. The lines each device printed are fed to the adapters, with names and addresses replaced.

import { expect, test } from "bun:test";
import type { Device, Neighbor } from "../../src/model";
import { Platforms } from "../../src/platforms";
import { Fixtures } from "../fixtures";

const options = { secrets: false, rollback: 10 };

/** A fixture's device whose BGP has only neighbor `edge-02`, and the cluster ID when one is given. */
function reflector(fixture: string, settings: Partial<Neighbor>, clusterId?: "192.0.2.1"): Device {
    const device = Fixtures.device(fixture);
    const neighbors: Record<string, Neighbor> = { "edge-02": { address: "192.0.2.2", remote_as: 64500, ...settings } };
    const bgp = { asn: device.routing!.bgp!.asn, neighbors, ...(clusterId ? { cluster_id: clusterId } : {}) };
    return { ...device, routing: { ...device.routing, bgp } };
}

const sent = (platform: string, desired: string, current: string) =>
    Platforms.get(platform)
        .plan(desired, current, options)
        .steps.flatMap((step) => step.send);

test("RouterOS writes a client as local.role=ibgp-rr and the cluster ID on the instance, as the router prints them", () => {
    const routeros = Platforms.get("routeros");
    const desired = routeros.render(reflector("edge-router--edge-01", { route_reflector_client: true }, "192.0.2.1"));

    expect(desired).toContain("add as=64500 cluster-id=192.0.2.1 name=default router-id=203.0.113.2");
    expect(desired).toContain("local.role=ibgp-rr name=edge-02");

    // The router prints `remote.as` as `.as`, after `remote.address` of the same group.
    const printed = desired.replace("remote.address=192.0.2.2/32 remote.as=64500", "remote.address=192.0.2.2/32 .as=64500");
    expect(routeros.plan(desired, printed, options).steps).toEqual([]);
});

test("RouterOS takes a cluster ID away with unset, since it refuses an empty one", () => {
    const routeros = Platforms.get("routeros");
    const on = routeros.render(reflector("edge-router--edge-01", { route_reflector_client: true }, "192.0.2.1"));
    const off = routeros.render(reflector("edge-router--edge-01", { route_reflector_client: true }));

    expect(sent("routeros", off, on)).toEqual(["/routing bgp instance unset [ find name=default ] cluster-id"]);
    expect(sent("routeros", on, off)).toEqual(["/routing bgp instance set [ find name=default ] cluster-id=192.0.2.1"]);
});

test("Junos makes a client with its session's cluster ID, and refuses a client or a cluster ID without the other", () => {
    const junos = Platforms.get("junos");
    const desired = junos.render(reflector("platforms--example-aggregation-switch", { route_reflector_client: true }, "192.0.2.1"));
    expect(desired).toContain("set protocols bgp group edge-02 cluster 192.0.2.1");

    const without = reflector("platforms--example-aggregation-switch", { route_reflector_client: true });
    expect(junos.unsupported(without)).toContain(
        "routing.bgp.neighbors.edge-02.route_reflector_client without routing.bgp.cluster_id: Junos needs a cluster ID, so write one"
    );

    const alone = reflector("platforms--example-aggregation-switch", {}, "192.0.2.1");
    expect(junos.unsupported(alone)).toContain(
        "routing.bgp.cluster_id without a route_reflector_client: Junos holds the cluster ID on its clients' sessions"
    );
});

test("FortiOS writes the cluster ID and a client in each family, and plans nothing against how the device prints them", () => {
    const fortios = Platforms.get("fortios");
    const device = reflector(
        "platforms--example-firewall",
        { route_reflector_client: true, address_families: ["ipv4", "ipv6"] },
        "192.0.2.1"
    );
    const bgp = /^config router bgp\n[\s\S]*?^end\n/m;
    const desired = fortios.render(device).match(bgp)![0];

    // In the device's own order, after the route maps.
    const printed = `config router bgp
    set as 64500
    set router-id 198.51.100.255
    set cluster-id 192.0.2.1
    config neighbor
        edit "192.0.2.2"
            set remote-as 64500
            set route-map-in "circuit-reject-all"
            set route-map-in6 "circuit-reject-all"
            set route-map-out "circuit-reject-all"
            set route-map-out6 "circuit-reject-all"
            set route-reflector-client enable
            set route-reflector-client6 enable
        next
    end
end
`;
    expect(sent("fortios", desired, printed)).toEqual([]);

    const off = fortios.render(reflector("platforms--example-firewall", { address_families: ["ipv4", "ipv6"] })).match(bgp)![0];
    expect(sent("fortios", off, printed)).toEqual([
        "config router bgp",
        "unset cluster-id",
        "config neighbor",
        'edit "192.0.2.2"',
        "unset route-reflector-client6",
        "unset route-reflector-client",
        "next",
        "end",
        "end",
    ]);
});
