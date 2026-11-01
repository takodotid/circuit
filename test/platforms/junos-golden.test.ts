// Every Junos device of Circuit 0.x's examples, templates and use cases renders in v1 as 0.x rendered it, and is refused for the same fields, named by their v1 paths.

import { expect, test } from "bun:test";
import { Platforms } from "../../src/platforms";
import { Fixtures } from "../fixtures";

const platform = Platforms.get("junos");

/** Fixtures whose render differs from 0.x only in order, inside a section the plan treats as a set, each with why. None so far. */
const ORDER_ONLY: Record<string, string> = {};

/** The start of each path Junos names in 0.x and what v1 calls it, the longest first so a field is renamed before its group. */
const PATHS: [RegExp, string][] = [
    [/^users without root/, "system.users without root"],
    [/^users\./, "system.users."],
    [/^management\.native\./, "management.native_protocol."],
    [/^management\.snmp\./, "monitoring.snmp."],
    [/^system\.transceiver_monitoring/, "monitoring.transceivers"],
    [/^system\.dns\.serve/, "services.dns_server"],
    [/^system\.ip\./, "system.ip_stack."],
    [/^system\.ntp\.servers by name while not serving/, "system.ntp.servers by name without services.ntp_server"],
    [/^ports\.([^.]+)\.lag\b/, "interfaces.ethernet.$1.in_lag"],
    [/^ports\.([^.]+)\.acl\b/, "interfaces.ethernet.$1.ingress_acl"],
    [/^ports\.([^.]+)\.ethertypes with an acl/, "interfaces.ethernet.$1.ethertypes with an ingress_acl"],
    [/^ports\./, "interfaces.ethernet."],
    [/^acls\./, "switching.acls."],
    [/^interfaces, two LAGs/, "interfaces.lag, two LAGs"],
    [/^stp\./, "switching.stp."],
    [/^routing\.static /, "routing.static_routes "],
    [/^routing\.bgp\.neighbors\.([^.]+)\.families/, "routing.bgp.neighbors.$1.address_families"],
    [/^policies\.([^.]+)\.match\./, "routing.policies.$1.if."],
    [/^policies\./, "routing.policies."],
    [/^hardware_offload$/, "system.hardware_offload"],
    [/^certificates$/, "system.certificates"],
    [/^dhcp\./, "services.dhcp_server."],
    [/^dhcp_relay\./, "services.dhcp_relay."],
    [/^flow_export\./, "monitoring.flow_export."],
];

/** A 0.x path as v1 writes it. An interface's path gains its kind, which the device's v1 groups say. */
function v1Path(found: string, device: ReturnType<typeof Fixtures.device>): string {
    const iface = /^interfaces\.([^.,\s]+)(.*)$/s.exec(found);
    if (iface && iface[1] !== "ethernet") {
        const kind = Object.entries(device.interfaces ?? {}).find(([group, names]) => group !== "ethernet" && names?.[iface[1]!])?.[0];
        if (kind) return `interfaces.${kind}.${iface[1]}${iface[2]}`;
    }

    // Each 0.x path is renamed once, by the first that fits.
    for (const [old, now] of PATHS) if (old.test(found)) return found.replace(old, now);
    return found;
}

const fixtures = Fixtures.ofPlatform("junos");

test("there are Junos fixtures", () => {
    expect(fixtures.length).toBeGreaterThan(0);
});

for (const name of fixtures) {
    test(`${name} renders as 0.x did`, () => {
        const device = Fixtures.device(name);
        const rendered = platform.render(device);
        const before = Fixtures.render(name);

        if (!ORDER_ONLY[name]) {
            expect(rendered).toBe(before);
            return;
        }

        // Only the order differs, and the plan from one to the other changes nothing.
        expect(rendered.split("\n").sort()).toEqual(before.split("\n").sort());
        expect(platform.plan(rendered, before, { secrets: false, rollback: 10 })).toEqual({ steps: [], problems: [] });
    });

    test(`${name} is refused for what 0.x refused`, () => {
        const device = Fixtures.device(name);
        const before = Fixtures.unsupported(name).map((found) => v1Path(found, device));

        expect(platform.unsupported(device)).toEqual(before);
    });
}

test("each 0.x path is written as its v1 path", () => {
    const device = Fixtures.device(fixtures[0]!);

    expect(
        [
            "users.root.role, root is always admin",
            "ports.10g-1.lag, a management port only routes",
            "ports.10g-1.ethertypes with an acl, the port takes one filter",
            "interfaces.management.mac, which only RouterOS sets for now",
            "interfaces.uplink.mac_limit, on a port or LAG that switches no VLAN",
            "policies.transit-in[1].match.prefix with prefix_length",
            "routing.bgp.neighbors.customer-1.families ipv4 over an IPv6 session",
            "management.snmp.port",
            "dhcp.management.network, IPv6",
        ].map((found) => v1Path(found, device))
    ).toEqual([
        "system.users.root.role, root is always admin",
        "interfaces.ethernet.10g-1.in_lag, a management port only routes",
        "interfaces.ethernet.10g-1.ethertypes with an ingress_acl, the port takes one filter",
        "interfaces.vlan_interface.management.mac, which only RouterOS sets for now",
        "interfaces.lag.uplink.mac_limit, on a port or LAG that switches no VLAN",
        "routing.policies.transit-in[1].if.prefix with prefix_length",
        "routing.bgp.neighbors.customer-1.address_families ipv4 over an IPv6 session",
        "monitoring.snmp.port",
        "services.dhcp_server.management.network, IPv6",
    ]);
});
