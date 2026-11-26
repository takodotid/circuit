// BGP in a VRF, tested on a CCR2216 with RouterOS 7.24.6 and a QFX5100 with Junos 21.4R3 (TRAPS.md). On each, a session was added in a VRF, read back, and taken away. The lines each device printed are fed to the adapters, with names and addresses replaced.

import { expect, test } from "bun:test";
import { Checks } from "../../src/checks";
import type { Device, Neighbor } from "../../src/model";
import { Platforms } from "../../src/platforms";
import { Fixtures } from "../fixtures";

const options = { secrets: false, rollback: 10 };

/** A fixture's device with VRF `terramix`, a loopback in it, and neighbor `terramix-private` in it. */
function withVrf(fixture: string, settings: Partial<Neighbor> = {}): Device {
    const device = Fixtures.device(fixture);
    const neighbor: Neighbor = { address: "192.0.2.2", remote_as: 274016, vrf: "terramix", ...settings };
    return {
        ...device,
        interfaces: {
            ...device.interfaces,
            loopback: { ...device.interfaces?.loopback, "terramix-loopback": { addresses: ["192.0.2.1/32"], vrf: "terramix" } },
        },
        routing: {
            ...device.routing,
            vrfs: { terramix: {} },
            bgp: { ...device.routing!.bgp!, neighbors: { ...device.routing!.bgp!.neighbors, "terramix-private": neighbor } },
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
        "add as=64500 input.filter=REJECT-ALL-V4 instance=default local.role=ebgp name=terramix-private output.filter-chain=REJECT-ALL-V4 output.network=bgp-networks-v4 remote.address=192.0.2.2/32 remote.as=274016 routing-table=terramix vrf=terramix"
    );

    // The router prints `remote.as` as `.as` and `output.network` as `.network`, after a property of the same group.
    const printed = desired.replace(
        "output.filter-chain=REJECT-ALL-V4 output.network=bgp-networks-v4 remote.address=192.0.2.2/32 remote.as=274016",
        "output.filter-chain=REJECT-ALL-V4 .network=bgp-networks-v4 remote.address=192.0.2.2/32 .as=274016"
    );
    expect(routeros.plan(desired, printed, options).steps).toEqual([]);
});

test("RouterOS waits for a new VRF's table before a session names it, since the router makes the table a moment later", () => {
    const routeros = Platforms.get("routeros");
    const without = routeros.render(Fixtures.device("edge-router--edge-01"));
    const lines = sent("routeros", routeros.render(withVrf("edge-router--edge-01")), without);

    const vrf = lines.indexOf("/ip vrf add interfaces=terramix-loopback name=terramix");
    const wait = lines.findIndex((line) => line.includes("[/routing table find name=terramix]"));
    const session = lines.findIndex((line) => line.startsWith("/routing bgp connection add") && line.includes("vrf=terramix"));
    expect(vrf).toBeGreaterThan(-1);
    expect(wait).toBe(vrf + 1);
    expect(session).toBeGreaterThan(wait);
});

test("RouterOS knows two sessions to one address in two VRFs apart", () => {
    const routeros = Platforms.get("routeros");
    const device = withVrf("edge-router--edge-01", { address: "203.0.113.1" });
    const before = routeros.render(Fixtures.device("edge-router--edge-01"));

    expect(sent("routeros", routeros.render(device), before)).toContainEqual(
        expect.stringMatching(/^\/routing bgp connection add .*remote.address=203.0.113.1\/32 .*vrf=terramix$/)
    );
    expect(sent("routeros", before, routeros.render(device))).toContain(
        '/routing bgp connection remove [ find remote.address="203.0.113.1/32" and vrf=terramix ]'
    );
});

test("RouterOS refuses a VRF with the name of an interface, since a VRF is an interface of its own", () => {
    const device = withVrf("edge-router--edge-01");
    const named = { ...device, routing: { ...device.routing, vrfs: { "terramix-loopback": {} } } };
    expect(Platforms.get("routeros").unsupported(named)).toContain(
        "routing.vrfs.terramix-loopback, the name of an interface: RouterOS makes an interface named after each VRF"
    );
});

test("Junos puts a session in the VRF's routing instance, with the router's ID, as the switch printed it", () => {
    const junos = Platforms.get("junos");
    const device = withVrf("platforms--example-aggregation-switch", { send_default_route: true });
    const desired = junos.render(device);

    // As `show configuration | display set` printed them, the router ID aside.
    for (const line of [
        "set routing-instances terramix instance-type virtual-router",
        "set routing-instances terramix routing-options aggregate route 0.0.0.0/0 preference 4294967295",
        "set routing-instances terramix routing-options aggregate route 0.0.0.0/0 passive",
        "set routing-instances terramix protocols bgp group terramix-private type external",
        "set routing-instances terramix protocols bgp group terramix-private import circuit-reject-all",
        "set routing-instances terramix protocols bgp group terramix-private family inet unicast",
        "set routing-instances terramix protocols bgp group terramix-private export circuit-default-route",
        "set routing-instances terramix protocols bgp group terramix-private export circuit-reject-all",
        "set routing-instances terramix protocols bgp group terramix-private peer-as 274016",
        "set routing-instances terramix protocols bgp group terramix-private neighbor 192.0.2.2",
        `set routing-instances terramix routing-options router-id ${device.routing!.router_id}`,
    ])
        expect(desired).toContain(line);
    expect(desired).not.toContain("set protocols bgp group terramix-private");
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
        "routing.bgp.neighbors.terramix-private.vrf with policy checked, which matches rpki: Circuit sets up route validation in the main routing instance only"
    );
});

// On tako-fwl-01 (FG-3700D, 6.2.2), a session through an interface in VRF 1 came up, but `get router info routing-table details` showed its routes in VRF 0, `inactive`.
test("FortiOS refuses a session in a VRF, since 6.2 runs BGP in the default VRF only", () => {
    expect(Platforms.get("fortios").unsupported(withVrf("platforms--example-firewall"))).toContain(
        "routing.bgp.neighbors.terramix-private.vrf, FortiOS 6.2 runs BGP in the default VRF only: BGP in a VRF needs 6.4"
    );
});

test("a session in a VRF and a table is refused, since it is in one of them", () => {
    const device = withVrf("edge-router--edge-01", { routing_table: "block-b" });
    const tabled = { ...device, routing: { ...device.routing, tables: { "block-b": {} } } };
    const messages = Checks.run([tabled], undefined).map((finding) => finding.message);
    expect(messages).toContain("routing.bgp.neighbors.terramix-private has both vrf and routing_table; a session is in one of them");
});
