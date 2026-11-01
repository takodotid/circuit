// The built-in checks a network turns on in `checks`: each finds what its doc describes, and only when it is on.

import { expect, test } from "bun:test";
import { Validation } from "../../src/checks";
import { BuiltInChecks } from "../../src/checks/built-in";
import type { Device, PolicyRule } from "../../src/model";
import { Fixtures } from "../fixtures";

const router = Fixtures.device("platforms--example-router");
const switchDevice = Fixtures.device("platforms--example-switch");

/** The router with its export to the upstreams, `UPSTREAM-OUT`, replaced. */
const withExport = (rules: PolicyRule[], device: Device = router): Device => ({
    ...device,
    routing: { ...device.routing, policies: { ...device.routing?.policies, "UPSTREAM-OUT": rules } },
});

/** The device with VLAN `guests` written `untrusted: true`. */
const guestsUntrusted = (device: Device): Device => ({
    ...device,
    switching: {
        ...device.switching,
        vlans: { ...device.switching?.vlans, guests: { ...device.switching!.vlans!.guests!, untrusted: true } },
    },
});

test("exports_end_in_reject finds an export that does not end in an unconditional reject", () => {
    const findings = BuiltInChecks.run([withExport([{ then: "accept" }])], { exports_end_in_reject: true });
    expect(findings.map((finding) => finding.message)).toContain(
        "routing.bgp.neighbors.upstream-1: export_policy UPSTREAM-OUT does not end in an unconditional reject"
    );

    // Off, it finds nothing, and Validation runs it only when the network turns it on.
    expect(BuiltInChecks.run([withExport([{ then: "accept" }])], {})).toEqual([]);
    expect(Validation.run([withExport([{ then: "accept" }])], { exports_end_in_reject: true }).map((finding) => finding.message)).toContain(
        "routing.bgp.neighbors.upstream-1: export_policy UPSTREAM-OUT does not end in an unconditional reject"
    );
});

test("untrusted_vlans finds an untrusted VLAN beside a trusted one away from a filtering device", () => {
    expect(BuiltInChecks.vlansOf({ access_vlan: "a", trunk_vlans: ["b"] })).toEqual(["a", "b"]);

    const check = { untrusted_vlans: { filtering_devices: ["example-router"] } };
    expect(BuiltInChecks.run([guestsUntrusted(switchDevice)], check).map((finding) => finding.message)).toEqual([
        "interfaces.lag.uplink carries an untrusted VLAN beside a trusted one and does not face one of filtering_devices",
        "interfaces.vlan_interface.guests puts an address on untrusted VLAN guests; only one of filtering_devices may",
    ]);
});

test("untrusted_vlans lets a mixed link between two switches extend a site", () => {
    const extension = (name: string, far: string): Device =>
        guestsUntrusted({
            ...switchDevice,
            name,
            interfaces: { ethernet: { "10g-1": { trunk_vlans: ["guests", "management"], link: { device: far, port: "10g-1" } } } },
        });
    const devices = [extension("near", "far"), extension("far", "near")];

    expect(BuiltInChecks.run(devices, { untrusted_vlans: { filtering_devices: [] } })).toHaveLength(2);
    expect(BuiltInChecks.run(devices, { untrusted_vlans: { filtering_devices: [], mixed_links: [["near", "far"]] } })).toEqual([]);
});

test("native_vlans_are_dead_ends keeps a native VLAN on one trunk and off every other port", () => {
    const withPorts = (ethernet: Record<string, object>, lag: Record<string, object> = {}): Device => ({
        ...switchDevice,
        name: "sw",
        interfaces: { ethernet, lag },
    });
    const run = (device: Device) => BuiltInChecks.run([device], { native_vlans_are_dead_ends: true });

    const alone = withPorts({ "10g-1": { trunk_vlans: ["servers"], native_vlan: "guests" }, "10g-2": { access_vlan: "servers" } });
    expect(run(alone)).toEqual([]);

    const shared = withPorts(
        { "10g-1": { trunk_vlans: ["servers"], native_vlan: "guests" }, "10g-2": { in_lag: "uplink" } },
        { uplink: { mode: "lacp", trunk_vlans: ["servers"], native_vlan: "guests" } }
    );
    expect(run(shared).map((finding) => finding.message)).toEqual([
        "native VLAN guests is native on interfaces.ethernet.10g-1, interfaces.lag.uplink: give each trunk its own",
    ]);

    const member = withPorts({
        "10g-1": { trunk_vlans: ["servers", "guests"], native_vlan: "guests" },
        "10g-2": { access_vlan: "guests" },
    });
    expect(run(member).map((finding) => finding.message)).toEqual([
        "native VLAN guests is also an access or tagged VLAN on interfaces.ethernet.10g-1",
        "native VLAN guests is also an access or tagged VLAN on interfaces.ethernet.10g-2",
    ]);
});

test("exports_end_in_reject leaves out an export to a customer", () => {
    const exported = withExport([{ then: "accept" }]);
    const bgp = exported.routing!.bgp!;
    const asCustomer: Device = {
        ...exported,
        routing: {
            ...exported.routing,
            bgp: { ...bgp, neighbor_groups: { upstream: { ...bgp.neighbor_groups!.upstream!, role: "customer" } } },
        },
    };
    const aboutUpstream = (devices: Device[]) =>
        BuiltInChecks.run(devices, { exports_end_in_reject: true }).filter((finding) =>
            finding.message.startsWith("routing.bgp.neighbors.upstream-1")
        );

    expect(aboutUpstream([exported])).toHaveLength(1);
    expect(aboutUpstream([asCustomer])).toEqual([]);
});

test("imports_end_in_accept_or_reject finds an import whose last rule has a match or no then", () => {
    const withImport = (rules: PolicyRule[]): Device => ({
        ...router,
        routing: { ...router.routing, policies: { ...router.routing?.policies, "UPSTREAM-IN": rules } },
    });
    const run = (rules: PolicyRule[]) =>
        BuiltInChecks.run([withImport(rules)], { imports_end_in_accept_or_reject: true }).map((finding) => finding.message);

    expect(run([{ if: { rpki: "invalid" }, then: "reject" }, { then: "accept" }])).toEqual([]);
    expect(run([{ if: { rpki: "invalid" }, then: "reject" }])).toContain(
        "routing.bgp.neighbors.upstream-1: import_policy UPSTREAM-IN does not end in an unconditional accept or reject"
    );
    expect(run([{ set: { local_pref: 200 } }])).toContain(
        "routing.bgp.neighbors.upstream-1: import_policy UPSTREAM-IN does not end in an unconditional accept or reject"
    );
});

test("tunnels_outside_offered finds a tunnel sourced from inside what a neighbor over it is offered", () => {
    const tunnelled: Device = {
        ...withExport([{ if: { prefix: "198.51.100.0/24" }, then: "accept" }, { then: "reject" }]),
        interfaces: {
            ...router.interfaces,
            gre: { tunnel: { local_address: "198.51.100.1", remote_address: "192.0.2.200", addresses: ["203.0.113.0/30"] } },
        },
    };
    const run = (device: Device) => BuiltInChecks.run([device], { tunnels_outside_offered: true }).map((finding) => finding.message);

    expect(run(tunnelled)).toEqual([
        "interfaces.gre.tunnel is sourced from 198.51.100.1, inside 198.51.100.0/24, which routing.bgp.neighbors.upstream-1 is offered",
    ]);
    expect(
        run({
            ...tunnelled,
            interfaces: { ...tunnelled.interfaces, gre: { tunnel: { ...tunnelled.interfaces!.gre!.tunnel!, local_address: "192.0.2.1" } } },
        })
    ).toEqual([]);
});

// The rules 0.x's `Bgp.announce` returned: an accept for each prefix at its length, then the reject.
test("an export that accepts each prefix and ends in a reject passes exports_end_in_reject", () => {
    const rules: PolicyRule[] = [
        { description: "Our IPv4", if: { prefix: "192.0.2.0/24" }, then: "accept" },
        { if: { prefix: "2001:db8::/32" }, then: "accept" },
        { description: "Nothing else", then: "reject" },
    ];

    expect(BuiltInChecks.run([withExport(rules)], { exports_end_in_reject: true })).toEqual([]);
});
