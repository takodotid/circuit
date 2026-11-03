// VRP on the v1 model renders every 0.x device as 0.x did, byte for byte, and refuses what 0.x refused, by its v1 path.

import { expect, test } from "bun:test";
import type { Device } from "../../src/model";
import { Derive } from "../../src/platforms/derive";
import { Vrp } from "../../src/platforms/vrp/index";
import { Fixtures } from "../fixtures";

const vrp = new Vrp();

/** Fixtures whose render differs from 0.x only in order, inside a section the platform treats as unordered, with why. None so far. */
const ORDER_ONLY: Record<string, string> = {};

/** A path 0.x wrote, and how v1 writes it. The first that matches is used. An interface's path also takes its group, from the device. */
const PATHS: [RegExp, string][] = [
    [/^ports\.([^.\s,]+)\.acl\b/, "interfaces.ethernet.$1.ingress_acl"],
    [/^ports\./, "interfaces.ethernet."],
    [/^vrfs\./, "routing.vrfs."],
    [/^routing\.static\b/, "routing.static_routes"],
    [/^routing\.rules\b/, "routing.policy_routing"],
    [/^routing\.bgp\.groups\./, "routing.bgp.neighbor_groups."],
    [/^dhcp_relay\./, "services.dhcp_relay."],
    [/^dhcp$/, "services.dhcp_server"],
    [/^acls$/, "switching.acls"],
    [/^policies$/, "routing.policies"],
    [/^prefix_sets$/, "routing.prefix_sets"],
    [/^hardware_offload$/, "system.hardware_offload"],
    [/^certificates$/, "system.certificates"],
    [/^users\./, "system.users."],
    [/^management\.native\b/, "management.native_protocol"],
    [/^management\.snmp\b/, "monitoring.snmp"],
    [/^lldp\.interfaces\b/, "switching.lldp.interfaces"],
    [/^system\.logging\.remote\b/, "monitoring.syslog"],
    [/^system\.transceiver_monitoring\b/, "monitoring.transceivers"],
    [/^system\.ip\b/, "system.ip_stack"],
    [/^flow_export\./, "monitoring.flow_export."],
];

/** Field names 0.x wrote inside a message, and v1's. */
const FIELDS: [RegExp, string][] = [
    [/ needs an IPv4 via$/, " needs an IPv4 next_hop"],
    [/ (\S+) table, /, " $1 routing_table, "],
    [/\.table, /, ".routing_table, "],
];

/** A message of 0.x, with each old path and field name written as v1 writes it. */
function inV1(message: string, device: Device): string {
    const kinds = new Map(Derive.interfaces(device).map(({ name, kind }) => [name, kind]));
    const iface = /^interfaces\.([^.\s,]+)/.exec(message);
    let renamed = iface ? message.replace(/^interfaces\./, `interfaces.${kinds.get(iface[1]!)}.`) : message;

    const path = PATHS.find(([old]) => old.test(renamed));
    if (path) renamed = renamed.replace(path[0], path[1]);

    for (const [old, now] of FIELDS) renamed = renamed.replace(old, now);
    return renamed;
}

const names = Fixtures.ofPlatform("vrp");

test("every 0.x VRP device is a fixture", () => {
    expect(names.length).toBeGreaterThan(0);
});

for (const name of names) {
    test(`${name} renders as 0.x rendered it`, () => {
        const device = Fixtures.device(name);
        const rendered = vrp.render(device);
        const old = Fixtures.render(name);

        if (!ORDER_ONLY[name]) {
            expect(rendered).toBe(old);
            return;
        }

        // Only the order differs: the platform plans nothing between the two.
        expect(rendered).not.toBe(old);
        expect(vrp.plan(rendered, old, { secrets: false, rollback: 10 })).toEqual({ steps: [], problems: [] });
    });

    test(`${name} refuses what 0.x refused, by its v1 path`, () => {
        const device = Fixtures.device(name);
        expect(vrp.unsupported(device)).toEqual(Fixtures.unsupported(name).map((message) => inV1(message, device)));
    });
}

test("a 0.x message is written with v1's paths and field names", () => {
    const device = {
        name: "x",
        site: "x",
        platform: "vrp",
        model: "CE6855-48S6Q-HI",
        connection: { user: "x" },
        interfaces: { loopback: { lo: {} }, lag: { uplink: {} } },
    } as Device;

    expect(inV1("ports.10g-1.acl, ports are switched; use a VLAN interface", device)).toBe(
        "interfaces.ethernet.10g-1.ingress_acl, ports are switched; use a VLAN interface"
    );
    expect(inV1("interfaces.lo, a loopback", device)).toBe("interfaces.loopback.lo, a loopback");
    expect(inV1("interfaces.uplink.ethertypes, on a LAG is not proved", device)).toBe(
        "interfaces.lag.uplink.ethertypes, on a LAG is not proved"
    );
    expect(inV1("routing.static 198.51.100.0/24 bfd, needs an IPv4 via", device)).toBe(
        "routing.static_routes 198.51.100.0/24 bfd, needs an IPv4 next_hop"
    );
    expect(inV1("system.logging.remote 2001:db8::1, IPv6 is not proved", device)).toBe("monitoring.syslog 2001:db8::1, IPv6 is not proved");
    expect(inV1("dhcp", device)).toBe("services.dhcp_server");
});

test("fields a VRP switch can't take are refused, not skipped", () => {
    const tor = Fixtures.device("colocation--tor-01");
    const [port] = Object.keys(tor.interfaces?.ethernet ?? {});
    const device = {
        ...tor,
        interfaces: {
            ...tor.interfaces,
            ethernet: { ...tor.interfaces?.ethernet, [port!]: { ...tor.interfaces?.ethernet?.[port!], ipv6_ra: true } },
        },
        routing: { ...tor.routing, ospf: undefined, router_id: "192.0.2.1" },
    } as Device;

    const found = vrp.unsupported(device);
    expect(found).toContain(`interfaces.ethernet.${port}.ipv6_ra, ports are switched; use a VLAN interface`);
    expect(found).toContain("routing.router_id without routing.ospf, only OSPF uses it here");
});
