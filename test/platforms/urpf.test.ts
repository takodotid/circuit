// Unicast reverse path forwarding (RFC 3704), tested on a QFX5100 with Junos 21.4R3: a VLAN interface was given `rpf-check` in each family, read back, and taken away. FortiOS's defaults were read on a FortiGate 3700D with FortiOS 6.2.2. RouterOS is applied on a CHR in CI (routeros-chr.test.ts).

import { expect, test } from "bun:test";
import { Checks } from "../../src/checks";
import { Derive } from "../../src/core/derive";
import type { Device, Family, Routed } from "../../src/model";
import { Platforms } from "../../src/platforms";
import { Fixtures } from "../fixtures";

type Urpf = NonNullable<Routed["urpf"]>;

const options = { secrets: false, rollback: 10 };

/** A fixture's device with `urpf` on each port and interface that has an address, but those `skip` names. */
function checked(fixture: string, urpf: Urpf, skip: readonly string[] = []): Device {
    const device = structuredClone(Fixtures.device(fixture));
    for (const { name, kind, settings } of Derive.holders(device)) {
        if (kind === "loopback" || skip.includes(name)) continue;
        const own = Object.fromEntries(Object.entries(urpf).filter(([family]) => Derive.hasFamily(settings, family as Family)));
        if (Object.keys(own).length) settings.urpf = own;
    }
    return device;
}

const sent = (platform: string, desired: string, current: string) =>
    Platforms.get(platform)
        .plan(desired, current, options)
        .steps.flatMap((step) => step.send);

test("RouterOS sets one mode for the whole router, and takes it back to the default", () => {
    const routeros = Platforms.get("routeros");
    const strict = routeros.render(checked("edge-router--edge-01", { ipv4: "strict" }));
    const none = routeros.render(Fixtures.device("edge-router--edge-01"));

    expect(strict).toContain("set rp-filter=strict send-redirects=no");
    expect(sent("routeros", strict, strict)).toEqual([]);
    expect(sent("routeros", none, strict)).toEqual(["/ip settings set rp-filter=no"]);
});

test("RouterOS refuses IPv6, and IPv4 that not every interface with an IPv4 address shares", () => {
    const routeros = Platforms.get("routeros");
    const device = checked("edge-router--edge-01", { ipv4: "strict", ipv6: "strict" }, ["1g-1"]);

    expect(routeros.unsupported(device).filter((field) => field.includes("urpf"))).toEqual([
        "interfaces.vlan_interface.ix.urpf.ipv6, RouterOS checks IPv4 sources only",
        "interfaces.vlan_interface.transit.urpf.ipv4, RouterOS has one mode for the whole router: write the same on every interface with an IPv4 address (missing on 1g-1)",
        "interfaces.vlan_interface.ix.urpf.ipv4, RouterOS has one mode for the whole router: write the same on every interface with an IPv4 address (missing on 1g-1)",
    ]);
});

test("Junos checks each family in strict mode, as the switch prints it, and refuses loose", () => {
    const junos = Platforms.get("junos");
    const device = checked("platforms--example-aggregation-switch", { ipv4: "strict", ipv6: "strict" }, ["1g-1", "tunnel"]);
    const desired = junos.render(device);

    expect(desired).toContain("set interfaces irb unit 10 family inet rpf-check");
    expect(desired).toContain("set interfaces irb unit 10 family inet6 rpf-check");
    expect(desired).toContain("set interfaces xe-0/0/47 unit 0 family inet6 rpf-check");

    // The switch prints `rpf-check` before the family's address.
    const lines = desired.split("\n");
    const printed = [...lines.filter((line) => line.includes("rpf-check")), ...lines.filter((line) => !line.includes("rpf-check"))];
    expect(sent("junos", desired, printed.join("\n"))).toEqual([]);
    expect(sent("junos", junos.render(Fixtures.device("platforms--example-aggregation-switch")), desired)).toContain(
        "delete interfaces irb unit 10 family inet rpf-check"
    );

    const loose = checked("platforms--example-aggregation-switch", { ipv4: "loose" }, ["1g-1", "tunnel"]);
    expect(junos.unsupported(loose)).toContain(
        "interfaces.vlan_interface.management.urpf.ipv4 loose, which Juniper doesn't list for the QFX5100 (TRAPS.md): write strict"
    );
    expect(junos.unsupported(checked("platforms--example-aggregation-switch", { ipv4: "strict" }))).toEqual(
        expect.arrayContaining([
            "interfaces.ethernet.1g-1.urpf on a management port, which the platform does not build",
            "interfaces.gre.tunnel.urpf on a tunnel, which the platform does not build",
        ])
    );
});

test("FortiOS sets strict for the whole VDOM only when every interface with an address checks strict, and not without --experimental", () => {
    const fortios = Platforms.get("fortios");
    const device = checked("platforms--example-firewall", { ipv4: "strict", ipv6: "strict" });

    expect(fortios.unsupported(device).filter((field) => field.includes("urpf"))).toEqual([]);
    expect(fortios.render(device)).toContain("set strict-src-check enable");
    expect(fortios.experimental!(device)).toContain("interfaces.vlan_interface.servers.urpf");

    const partly = checked("platforms--example-firewall", { ipv4: "strict" });
    expect(fortios.render(partly)).not.toContain("strict-src-check");
    expect(fortios.unsupported(partly)).toContain(
        "interfaces.lag.uplink.urpf, FortiOS checks strict for the whole VDOM and both families: write strict for each family on every interface in it with an address of that family (missing: IPv6 on uplink, management, servers, partner)"
    );

    const loose = checked("platforms--example-firewall", { ipv4: "loose" });
    expect(fortios.unsupported(loose)).toContain(
        "interfaces.vlan_interface.guests.urpf.ipv4 loose, FortiOS has no loose mode: it checks feasible paths unless strict"
    );
});

test("VRP checks a VLAN interface in loose mode, built from Huawei's documentation, and refuses the rest", () => {
    const vrp = Platforms.get("vrp");
    const loose = checked("platforms--example-switch", { ipv4: "loose" });

    expect(vrp.render(loose)).toMatch(/interface Vlanif\d+\n(?: .*\n)* ip urpf enable/);
    expect(vrp.experimental!(loose)).toEqual([
        "interfaces.vlan_interface.management.urpf.ipv4",
        "interfaces.vlan_interface.guests.urpf.ipv4",
    ]);
    expect(vrp.unsupported(checked("platforms--example-switch", { ipv4: "strict" }))).toContain(
        "interfaces.vlan_interface.guests.urpf.ipv4 strict, the CE6855 checks in loose mode only"
    );
});

test("Raisecom ROS refuses uRPF, and a check refuses it where its family has no address", () => {
    const device = checked("platforms--example-core-switch", { ipv4: "strict" });
    expect(Platforms.get("raisecom-ros").unsupported(device)).toContain(
        "interfaces.vlan_interface.management.urpf, which the platform does not build"
    );

    const management = device.interfaces!.vlan_interface!.management!;
    const ipv6 = {
        ...device,
        interfaces: { ...device.interfaces, vlan_interface: { management: { ...management, urpf: { ipv6: "strict" } } } },
    };
    expect(Checks.run([ipv6 as Device], undefined).map(({ message }) => message)).toContain(
        "interfaces.vlan_interface.management has urpf.ipv6 but no IPv6 address: write it on the interface that holds the address"
    );
});

// MikroTik once warned that strict mode doesn't work with routing tables, and no device test has shown it does.
test("RouterOS strict rp-filter beside a routing table is experimental, and loose is not", () => {
    const routeros = Platforms.get("routeros");
    const withTable = (device: Device): Device => ({ ...device, routing: { ...device.routing, tables: { "circuit-test": {} } } });

    expect(routeros.experimental?.(withTable(checked("edge-router--edge-01", { ipv4: "strict" }))).length).toBeGreaterThan(0);
    expect(routeros.experimental?.(withTable(checked("edge-router--edge-01", { ipv4: "loose" })))).toEqual([]);
    expect(routeros.experimental?.(checked("edge-router--edge-01", { ipv4: "strict" }))).toEqual([]);
});
