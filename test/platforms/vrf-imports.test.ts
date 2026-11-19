// Routes one table takes from another. RouterOS's VPN entries and Junos's instance imports were tried by hand on a CCR2216 (7.24.6) and a QFX5100 (21.4R3), as TRAPS.md says. test/platforms/routeros-chr-vrf.test.ts applies them to a CHR.

import { expect, test } from "bun:test";
import { Checks } from "../../src/checks";
import type { Device, PolicyRule, Prefix } from "../../src/model";
import { Platforms } from "../../src/platforms";
import { Fixtures } from "../fixtures";

const options = { secrets: false, rollback: 10 };

/** A fixture's device with VRFs `tsukaeru` and `services`, a loopback in each, and these imports, each policy accepting one prefix. */
function withImports(fixture: string, imports: { from: string; to: string; policy: string }[]): Device {
    const device = Fixtures.device(fixture);
    const accepting = (prefix: Prefix): PolicyRule[] => [{ if: { prefix }, then: "accept" }, { then: "reject" }];
    return {
        ...device,
        interfaces: {
            ...device.interfaces,
            loopback: {
                ...device.interfaces?.loopback,
                "tsukaeru-loopback": { addresses: ["10.20.0.1/32"], vrf: "tsukaeru" },
                "services-loopback": { addresses: ["10.0.5.1/24"], vrf: "services" },
            },
        },
        routing: {
            ...device.routing,
            vrfs: { tsukaeru: {}, services: {} },
            vrf_imports: imports,
            policies: {
                ...device.routing!.policies,
                "management-network": accepting("10.0.0.0/24"),
                "monitoring-network": accepting("10.0.5.0/24"),
                "tsukaeru-private-network": accepting("10.20.0.1/32"),
            },
        },
    };
}

const BOTH_WAYS = [
    { from: "services", to: "tsukaeru", policy: "monitoring-network" },
    { from: "tsukaeru", to: "services", policy: "tsukaeru-private-network" },
];

const WITH_MAIN = [
    { from: "main", to: "tsukaeru", policy: "management-network" },
    { from: "tsukaeru", to: "main", policy: "tsukaeru-private-network" },
];

test("RouterOS hands routes over through the BGP VPN table, and plans nothing against how the router prints its entries", () => {
    const routeros = Platforms.get("routeros");
    const desired = routeros.render(withImports("edge-router--edge-01", BOTH_WAYS));

    expect(desired).toContain(`/routing bgp vpn
add export.filter-chain=monitoring-network-VRF export.redistribute="connected,static,ospf,bgp" export.route-targets=64500:1 instance=default label-allocation-policy=per-vrf name=services-to-tsukaeru route-distinguisher=64500:1 vrf=services
add export.filter-chain=tsukaeru-private-network-VRF export.redistribute="connected,static,ospf,bgp" export.route-targets=64500:2 instance=default label-allocation-policy=per-vrf name=tsukaeru-to-services route-distinguisher=64500:2 vrf=tsukaeru
add import.route-targets=64500:1 instance=default label-allocation-policy=per-vrf name=tsukaeru route-distinguisher=64500:3 vrf=tsukaeru
add import.route-targets=64500:2 instance=default label-allocation-policy=per-vrf name=services route-distinguisher=64500:4 vrf=services
`);
    // One chain takes both families, since an entry has one.
    expect(desired).toContain(`add chain=monitoring-network-VRF rule="if (afi ipv4) { jump monitoring-network-V4 }"
add chain=monitoring-network-VRF rule="if (afi ipv6) { jump monitoring-network-V6 }"
add chain=monitoring-network-VRF rule=reject
`);

    // As the router printed its entries: an export's targets and protocols after its chain, by their group.
    const printed = desired.replace(/export\.redistribute="([^"]+)" export\.route-targets=/g, ".redistribute=$1 .route-targets=");
    expect(routeros.plan(desired, printed, options).steps).toEqual([]);
});

test("RouterOS refuses an import with main, which took and gave nothing on a CHR", () => {
    const refused = Platforms.get("routeros").unsupported(withImports("edge-router--edge-01", WITH_MAIN));
    expect(refused).toContain(
        "routing.vrf_imports[0], with main: BGP's VPN table takes routes between VRFs only on RouterOS 7.24, and routes neither left main nor arrived there"
    );
});

test("RouterOS needs BGP to take routes between tables", () => {
    const device = withImports("platforms--example-router", BOTH_WAYS);
    const { bgp: _bgp, ...routing } = device.routing!;
    expect(Platforms.get("routeros").unsupported({ ...device, routing })).toContain(
        "routing.vrf_imports without routing.bgp: RouterOS takes routes between tables through BGP. Write bgp: {} in routing"
    );
});

test("Junos imports into each table through one policy, whose terms match the instance the routes come from", () => {
    const junos = Platforms.get("junos");
    const device = withImports("platforms--example-aggregation-switch", WITH_MAIN);
    const desired = junos.render(device);

    for (const line of [
        "set routing-options instance-import circuit-vrf-import-main",
        "set routing-instances tsukaeru routing-options instance-import circuit-vrf-import-tsukaeru",
        "set policy-options policy-statement circuit-vrf-import-tsukaeru term main from instance master",
        "set policy-options policy-statement circuit-vrf-import-tsukaeru term main from policy management-network",
        "set policy-options policy-statement circuit-vrf-import-tsukaeru term main then accept",
        "set policy-options policy-statement circuit-vrf-import-tsukaeru term others then reject",
        "set policy-options policy-statement circuit-vrf-import-main term tsukaeru from instance tsukaeru",
        "set policy-options policy-statement circuit-vrf-import-main term tsukaeru from policy tsukaeru-private-network",
    ])
        expect(desired).toContain(line);
    expect(desired).toContain("set policy-options policy-statement tsukaeru-private-network term");
    expect(junos.experimental?.(device)).toEqual(["routing.vrf_imports"]);
});

test("FortiOS, VRP, and Raisecom ROS refuse imports between tables", () => {
    for (const [platform, fixture] of [
        ["fortios", "platforms--example-firewall"],
        ["vrp", "platforms--example-switch"],
        ["raisecom-ros", "platforms--example-core-switch"],
    ] as const)
        expect(Platforms.get(platform).unsupported(withImports(fixture, BOTH_WAYS))).toContain(
            "routing.vrf_imports, which the platform does not build"
        );
});

test("a table that takes from itself, or two imports between the same tables, are refused", () => {
    const device = withImports("edge-router--edge-01", [
        { from: "tsukaeru", to: "tsukaeru", policy: "management-network" },
        { from: "main", to: "tsukaeru", policy: "management-network" },
        { from: "main", to: "tsukaeru", policy: "tsukaeru-private-network" },
    ]);
    const messages = Checks.run([device], undefined).map((finding) => finding.message);

    expect(messages).toContain("routing.vrf_imports[0] takes routes from tsukaeru into tsukaeru; give another table in to");
    expect(messages).toContain(
        "routing.vrf_imports[2] takes routes from main into tsukaeru, as routing.vrf_imports[1] does; write one import, and put the rules of both policies in its policy"
    );
});
