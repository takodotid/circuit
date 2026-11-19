// BGP in a VRF, tested on a CCR2216 with RouterOS 7.24.6 and a QFX5100 with Junos 21.4R3 (TRAPS.md). On each, a session was added in a VRF, read back, and taken away. The lines each device printed are fed to the adapters, with names and addresses replaced.

import { expect, test } from "bun:test";
import { Checks } from "../../src/checks";
import type { Device, Neighbor } from "../../src/model";
import { Platforms } from "../../src/platforms";
import { Fixtures } from "../fixtures";

const options = { secrets: false, rollback: 10 };

/** A fixture's device with VRF `tsukaeru`, a loopback in it, and neighbor `tsukaeru-private` in it. */
function withVrf(fixture: string, settings: Partial<Neighbor> = {}): Device {
    const device = Fixtures.device(fixture);
    const neighbor: Neighbor = { address: "192.0.2.2", remote_as: 63997, vrf: "tsukaeru", ...settings };
    return {
        ...device,
        interfaces: {
            ...device.interfaces,
            loopback: { ...device.interfaces?.loopback, "tsukaeru-loopback": { addresses: ["192.0.2.1/32"], vrf: "tsukaeru" } },
        },
        routing: {
            ...device.routing,
            vrfs: { tsukaeru: {} },
            bgp: { ...device.routing!.bgp!, neighbors: { ...device.routing!.bgp!.neighbors, "tsukaeru-private": neighbor } },
        },
    };
}

const sent = (platform: string, desired: string, current: string) =>
    Platforms.get(platform)
        .plan(desired, current, options)
        .steps.flatMap((step) => step.send);

test("RouterOS puts a session in its VRF and the VRF's table, and plans nothing against how the router prints it", () => {
    const routeros = Platforms.get("routeros");
    const desired = routeros.render(withVrf("edge-router--edge-01"));

    expect(desired).toContain(
        "add as=64500 input.filter=REJECT-ALL-V4 instance=default local.role=ebgp name=tsukaeru-private output.filter-chain=REJECT-ALL-V4 output.network=bgp-networks-v4 remote.address=192.0.2.2/32 remote.as=63997 routing-table=tsukaeru vrf=tsukaeru"
    );

    // The router prints `remote.as` as `.as` and `output.network` as `.network`, after a property of the same group.
    const printed = desired.replace(
        "output.filter-chain=REJECT-ALL-V4 output.network=bgp-networks-v4 remote.address=192.0.2.2/32 remote.as=63997",
        "output.filter-chain=REJECT-ALL-V4 .network=bgp-networks-v4 remote.address=192.0.2.2/32 .as=63997"
    );
    expect(routeros.plan(desired, printed, options).steps).toEqual([]);
});

test("RouterOS waits for a new VRF's table before a session names it, since the router makes the table a moment later", () => {
    const routeros = Platforms.get("routeros");
    const without = routeros.render(Fixtures.device("edge-router--edge-01"));
    const lines = sent("routeros", routeros.render(withVrf("edge-router--edge-01")), without);

    const vrf = lines.indexOf("/ip vrf add interfaces=tsukaeru-loopback name=tsukaeru");
    const wait = lines.findIndex((line) => line.includes("[/routing table find name=tsukaeru]"));
    const session = lines.findIndex((line) => line.startsWith("/routing bgp connection add") && line.includes("vrf=tsukaeru"));
    expect(vrf).toBeGreaterThan(-1);
    expect(wait).toBe(vrf + 1);
    expect(session).toBeGreaterThan(wait);
});

test("RouterOS knows two sessions to one address in two VRFs apart", () => {
    const routeros = Platforms.get("routeros");
    const device = withVrf("edge-router--edge-01", { address: "203.0.113.1" });
    const before = routeros.render(Fixtures.device("edge-router--edge-01"));

    expect(sent("routeros", routeros.render(device), before)).toContainEqual(
        expect.stringMatching(/^\/routing bgp connection add .*remote.address=203.0.113.1\/32 .*vrf=tsukaeru$/)
    );
    expect(sent("routeros", before, routeros.render(device))).toContain(
        '/routing bgp connection remove [ find remote.address="203.0.113.1/32" and vrf=tsukaeru ]'
    );
});

test("RouterOS refuses a VRF with the name of an interface, since a VRF is an interface of its own", () => {
    const device = withVrf("edge-router--edge-01");
    const named = { ...device, routing: { ...device.routing, vrfs: { "tsukaeru-loopback": {} } } };
    expect(Platforms.get("routeros").unsupported(named)).toContain(
        "routing.vrfs.tsukaeru-loopback, the name of an interface: RouterOS makes an interface named after each VRF"
    );
});

test("Junos puts a session in the VRF's routing instance, with the router's ID, as the switch printed it", () => {
    const junos = Platforms.get("junos");
    const device = withVrf("platforms--example-aggregation-switch", { send_default_route: true });
    const desired = junos.render(device);

    // As `show configuration | display set` printed them, the router ID aside.
    for (const line of [
        "set routing-instances tsukaeru instance-type virtual-router",
        "set routing-instances tsukaeru routing-options aggregate route 0.0.0.0/0 preference 4294967295",
        "set routing-instances tsukaeru routing-options aggregate route 0.0.0.0/0 passive",
        "set routing-instances tsukaeru protocols bgp group tsukaeru-private type external",
        "set routing-instances tsukaeru protocols bgp group tsukaeru-private import circuit-reject-all",
        "set routing-instances tsukaeru protocols bgp group tsukaeru-private family inet unicast",
        "set routing-instances tsukaeru protocols bgp group tsukaeru-private export circuit-default-route",
        "set routing-instances tsukaeru protocols bgp group tsukaeru-private export circuit-reject-all",
        "set routing-instances tsukaeru protocols bgp group tsukaeru-private peer-as 63997",
        "set routing-instances tsukaeru protocols bgp group tsukaeru-private neighbor 192.0.2.2",
        `set routing-instances tsukaeru routing-options router-id ${device.routing!.router_id}`,
    ])
        expect(desired).toContain(line);
    expect(desired).not.toContain("set protocols bgp group tsukaeru-private");
});

test("Junos refuses a session in a VRF whose policy matches RPKI, since Circuit asks the validators in the main instance only", () => {
    const device = withVrf("platforms--example-aggregation-switch", { import_policy: "checked" });
    const checked = {
        ...device,
        routing: {
            ...device.routing,
            policies: { ...device.routing!.policies, checked: [{ if: { rpki: "invalid" as const }, then: "reject" as const }] },
        },
    };
    expect(Platforms.get("junos").unsupported(checked)).toContain(
        "routing.bgp.neighbors.tsukaeru-private.vrf with policy checked, which matches rpki: Circuit sets up route validation in the main routing instance only"
    );
});

test("FortiOS refuses a session in a VRF, since 6.2 runs BGP in the default VRF only", () => {
    expect(Platforms.get("fortios").unsupported(withVrf("platforms--example-firewall"))).toContain(
        "routing.bgp.neighbors.tsukaeru-private.vrf, FortiOS 6.2 runs BGP in the default VRF only"
    );
});

test("a session in a VRF and a table is refused, since it is in one of them", () => {
    const device = withVrf("edge-router--edge-01", { routing_table: "block-b" });
    const tabled = { ...device, routing: { ...device.routing, tables: { "block-b": {} } } };
    const messages = Checks.run([tabled], undefined).map((finding) => finding.message);
    expect(messages).toContain("routing.bgp.neighbors.tsukaeru-private has both vrf and routing_table; a session is in one of them");
});
