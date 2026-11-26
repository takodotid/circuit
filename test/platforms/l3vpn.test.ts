// L3VPN: VRFs with route distinguishers and route targets, and the iBGP sessions that carry their routes over MPLS. RouterOS 7.24.6 ran it on three CHRs (test/platforms/routeros-chr-l3vpn.test.ts), and the lines it printed there are fed to the adapter here. Every other platform refuses it.

import { beforeAll, expect, test } from "bun:test";
import { DeviceChecks } from "../../src/checks/device";
import type { VrfRouteTargets } from "../../src/config/routing";
import type { Device, Neighbor, NeighborSettings } from "../../src/model";
import { Platforms } from "../../src/platforms";
import { Fixtures } from "../fixtures";

const options = { secrets: false, rollback: 10 };
const routeros = Platforms.get("routeros");

/** pe-01 of the MPLS core example, with its VRF bank and its VPN session to pe-02. */
let pe01: Device;

beforeAll(async () => {
    pe01 = (await Fixtures.example("mpls-core"))["pe-01"]!;
});

/** pe-01 with its session to pe-02 changed. */
function withSession(settings: Partial<Neighbor>): Device {
    const bgp = pe01.routing!.bgp!;
    const neighbor = { ...bgp.neighbors!["pe-02"]!, ...settings };
    return { ...pe01, routing: { ...pe01.routing, bgp: { ...bgp, neighbors: { "pe-02": neighbor } } } };
}

const errors = (device: Device) =>
    DeviceChecks.run(device)
        .filter((finding) => finding.level === "error")
        .map((finding) => finding.message);

test("the example validates, and RouterOS renders the VRF's VPN entry and a VPN session that takes VPN routes only", () => {
    expect(errors(pe01)).toEqual([]);
    expect(routeros.unsupported(pe01)).toEqual([]);

    const desired = routeros.render(pe01);
    expect(desired).toContain(
        '/routing bgp vpn\nadd export.filter-chain=bank-offices-VRF export.redistribute="connected,static,ospf,bgp" export.route-targets=64500:101 import.filter-chain=bank-offices-FROM-VPN import.route-targets=64500:101 instance=default label-allocation-policy=per-prefix name=bank route-distinguisher=64500:101 vrf=bank\n'
    );
    // A VRF hands its routes over as ipv4, and takes VPN routes as vpnv4, each with its prefix alone (TRAPS.md).
    expect(desired).toContain(
        'add chain=bank-offices-VRF rule="if (afi ipv4) { jump bank-offices-V4 }"\nadd chain=bank-offices-VRF rule="if (afi ipv6) { jump bank-offices-V6 }"\nadd chain=bank-offices-VRF rule=reject\n'
    );
    expect(desired).toContain(
        'add chain=bank-offices-FROM-VPN rule="if (afi vpnv4) { jump bank-offices-V4 }"\nadd chain=bank-offices-FROM-VPN rule="if (afi vpnv6) { jump bank-offices-V6 }"\nadd chain=bank-offices-FROM-VPN rule=reject\n'
    );
    expect(desired).toContain(
        'add chain=bank-offices-V4 rule="if (dst in bank-offices) { accept }"\nadd chain=bank-offices-V4 rule=reject\n'
    );
    expect(desired).toContain(
        'add afi="l2vpn,l2vpn-cisco,vpnv4" as=64500 comment="pe-02, VPN routes" input.filter=VPN instance=default local.address=10.255.0.1 local.role=ibgp name=pe-02 output.filter-chain=VPN remote.address=10.255.0.2/32 remote.as=64500'
    );
    // Its IPv6 routes go between the IPv6 loopbacks, on a session of their own, which takes them through the same chain.
    expect(desired).toContain(
        'add afi=vpnv6 as=64500 comment="pe-02, IPv6 VPN routes" input.filter=VPN instance=default local.address=2001:db8:100:ffff::1 local.role=ibgp name=pe-02-v6 output.filter-chain=VPN remote.address=2001:db8:100:ffff::2/128 remote.as=64500'
    );
    // The sessions carry the VPLS routes of the museum and the library too, which their own afi matches.
    expect(desired).toContain(
        'add chain=VPN rule="if (afi vpnv4) { accept }"\nadd chain=VPN rule="if (afi vpnv6) { accept }"\nadd chain=VPN rule="if (afi l2vpn) { accept }"\nadd chain=VPN rule="if (afi l2vpn-cisco) { accept }"\nadd chain=VPN rule=reject\n'
    );
    expect(desired).not.toContain("REJECT-ALL");

    // As the CHRs printed a connection and a VPN entry: `.role` and `.as` after a property of their group, and the VPN entry's properties in its own order.
    const printed = desired
        .replace(
            "local.role=ibgp name=pe-02 output.filter-chain=VPN remote.address=10.255.0.2/32 remote.as=64500",
            ".role=ibgp name=pe-02 output.filter-chain=VPN remote.address=10.255.0.2/32 .as=64500"
        )
        .replace(
            'export.filter-chain=bank-offices-VRF export.redistribute="connected,static,ospf,bgp" export.route-targets=64500:101 import.filter-chain=bank-offices-FROM-VPN import.route-targets=64500:101',
            "export.filter-chain=bank-offices-VRF .redistribute=connected,static,ospf,bgp .route-targets=64500:101 import.filter-chain=bank-offices-FROM-VPN .route-targets=64500:101"
        );
    expect(routeros.plan(desired, printed, options).steps).toEqual([]);
});

test("RouterOS takes a VRF's policy out of its VPN entry with unset, since it prints an empty chain as written", () => {
    const desired = routeros.render(pe01);
    const bank = pe01.routing!.vrfs!.bank!;
    const without: Device = {
        ...pe01,
        routing: { ...pe01.routing, vrfs: { bank: { ...bank, import_policy: undefined, export_policy: undefined } } },
    };

    expect(routeros.plan(routeros.render(without), desired, options).steps.flatMap((step) => step.send)).toEqual(
        expect.arrayContaining([
            "/routing bgp vpn unset [ find name=bank ] export.filter-chain",
            "/routing bgp vpn unset [ find name=bank ] import.filter-chain",
        ])
    );
});

test("RouterOS hands a session's ipv4 routes on to its policy's chain once it has taken its VPN routes", () => {
    const device = withSession({ address_families: ["ipv4", "vpnv4"], import_policy: undefined, export_policy: undefined });
    const desired = routeros.render(device);

    expect(desired).toContain('afi="ip,vpnv4"');
    expect(desired).toContain("input.filter=REJECT-ALL-V4-VPN");
    expect(desired).toContain("output.filter-chain=REJECT-ALL-V4-VPN");
    expect(desired).toContain(
        'add chain=REJECT-ALL-V4-VPN rule="if (afi vpnv4) { accept }"\nadd chain=REJECT-ALL-V4-VPN rule="jump REJECT-ALL-V4"\n'
    );
    expect(desired).toContain("add chain=REJECT-ALL-V4 rule=reject");
});

test("RouterOS takes a route target out of a VPN entry with unset, since it prints an empty list as nothing", () => {
    const desired = routeros.render(pe01);
    const vrfs = pe01.routing!.vrfs!;
    const importOnly: Device = {
        ...pe01,
        routing: { ...pe01.routing, vrfs: { ...vrfs, bank: { ...vrfs.bank, route_targets: { import: ["64500:101"] } } } },
    };
    const steps = routeros.plan(routeros.render(importOnly), desired, options).steps.flatMap((step) => step.send);

    expect(steps).toEqual([
        "/routing bgp vpn unset [ find name=bank ] export.redistribute",
        "/routing bgp vpn unset [ find name=bank ] export.route-targets",
    ]);
});

test("a VRF's policies pick among its VPN routes, so each needs the route targets of its way", () => {
    const bank = pe01.routing!.vrfs!.bank!;
    const withTargets = (route_targets: VrfRouteTargets): Device => ({
        ...pe01,
        routing: { ...pe01.routing, vrfs: { bank: { ...bank, route_targets } } },
    });

    expect(errors(withTargets({ export: ["64500:101"] }))).toEqual([
        "routing.vrfs.bank.import_policy bank-offices picks the VPN routes the VRF takes, and it takes none without import targets. Write route_targets.import, or remove import_policy",
    ]);
    expect(errors(withTargets({ import: ["64500:101"] }))).toEqual([
        "routing.vrfs.bank.export_policy bank-offices picks the routes the VRF sends as VPN routes, and it sends none without export targets. Write route_targets.export, or remove export_policy",
    ]);
});

test("RouterOS refuses vpnv6 over a session to an IPv4 address, vpnv4 to an IPv6 one, a limit beside VPN routes, and VRF imports beside an L3VPN", () => {
    expect(
        routeros.unsupported(
            withSession({ address: "2001:db8:100:ffff::2", local_address: "2001:db8:100:ffff::1", address_families: ["vpnv4", "vpnv6"] })
        )
    ).toEqual([
        "routing.bgp.neighbors.pe-02.address_families vpnv4, over a session to an IPv6 address, which Circuit's tests don't run on RouterOS. Carry vpnv4 on a session between the PEs' LSR IDs",
    ]);
    expect(routeros.unsupported(withSession({ address_families: ["vpnv4", "vpnv6"] }))).toEqual([
        "routing.bgp.neighbors.pe-02.address_families vpnv6, over a session to an IPv4 address: RouterOS 7.24 keeps the IPv6 VPN routes it learns there unreachable, since it does not resolve their IPv4-mapped next hop (RFC 4659). Carry vpnv6 on a session between the PEs' IPv6 transport addresses",
    ]);
    expect(routeros.unsupported(withSession({ max_prefixes: 1000 }))).toEqual([
        "routing.bgp.neighbors.pe-02.max_prefixes, with VPN routes: RouterOS limits only ipv4 and ipv6 routes",
    ]);

    const leaking: Device = {
        ...pe01,
        routing: {
            ...pe01.routing,
            vrfs: { ...pe01.routing!.vrfs, guest: {} },
            vrf_imports: [{ from: "bank", to: "guest", policy: "all" }],
            policies: { all: [{ then: "accept" }] },
        },
    };
    expect(routeros.unsupported(leaking)).toContain(
        "routing.vrf_imports beside an L3VPN: RouterOS takes routes between VRFs by route targets of its own, which its VPN sessions would carry to the other PEs. Not built yet"
    );
});

test("Junos, FortiOS, VRP, and Raisecom ROS refuse an L3VPN, each saying why", () => {
    const reasons: Record<string, string> = {
        junos: "L3VPN, not built for Junos yet: its MPLS is experimental, untested on a router that runs it",
        fortios: "L3VPN: FortiOS has no MPLS",
        vrp: "L3VPN: Huawei's guide says a CloudEngine switch can't be a PE on an MPLS network, and V200R005 asks to reset each session that starts to carry vpnv4, so it was not tried",
        "raisecom-ros": "L3VPN, not built yet",
    };
    const vpn: NeighborSettings = { address_families: ["vpnv4"] };

    for (const [platform, reason] of Object.entries(reasons)) {
        const device = Fixtures.device(Fixtures.ofPlatform(platform)[0]!);
        const bgp = device.routing?.bgp ?? {};
        const withVpn: Device = {
            ...device,
            routing: {
                ...device.routing,
                vrfs: { bank: { route_distinguisher: "64500:101", route_targets: { import: ["64500:101"] } } },
                bgp: { ...bgp, neighbor_groups: { ...bgp.neighbor_groups, pe: vpn } },
            },
        };
        const refused = Platforms.get(platform).unsupported(withVpn);
        for (const where of [
            "routing.vrfs.bank.route_distinguisher",
            "routing.vrfs.bank.route_targets",
            "routing.bgp.neighbor_groups.pe.address_families vpnv4",
        ])
            expect(refused).toContain(`${where}, ${reason}`);
    }
});
