// Each Raisecom ROS device of Circuit 0.x's examples, templates and use cases renders in v1 exactly as 0.x rendered it, and is refused the same fields, by their v1 paths.

import { expect, test } from "bun:test";
import type { Device } from "../../src/model";
import { Platforms } from "../../src/platforms";
import { Derive } from "../../src/platforms/derive";
import { Fixtures } from "../fixtures";

const platform = Platforms.get("raisecom-ros");

/** What 0.x called unsupported, by its 0.x text, and the same in v1, where more than a path changed. */
const V1_PATHS: Record<string, string> = {
    "system.dns, logging.local, release_channel, banner and ntp.serve":
        "system.dns, system.logging.local, system.release_channel, system.banner, services.dns_server and services.ntp_server",
    "routing.ospf for IPv6": "routing.ospf.address_families ipv6, OSPF runs for IPv4 here",
};

/** A 0.x path at the start of a finding, and the v1 path it became. */
const V1_PREFIXES: [RegExp, string][] = [
    [/^ports\.(\S+)\.acl\b/, "interfaces.ethernet.$1.ingress_acl"],
    [/^ports\./, "interfaces.ethernet."],
    [/^users\./, "system.users."],
    [/^vlans\./, "switching.vlans."],
    [/^lldp\./, "switching.lldp."],
    [/^stp\./, "switching.stp."],
    [/^management\.snmp/, "monitoring.snmp"],
    [/^management\.native$/, "management.native_protocol"],
    [/^routing\.static (\S+), only an IPv4 next hop/, "routing.static_routes $1, only an IPv4 next_hop"],
    [/^routing\.static (\S+) table,/, "routing.static_routes $1 routing_table,"],
    [/^routing\.rules, routing rules are/, "routing.policy_routing, policy routing is"],
    [/^vdoms,/, "system.vdoms,"],
    [/^routing\.static /, "routing.static_routes "],
    [/^routing\.ospf\.areas\.(\S+?)\.(\S+),/, "routing.ospf.areas.$1.interfaces.$2,"],
    [/^system\.ip$/, "system.ip_stack"],
    [/^dhcp$/, "services.dhcp_server"],
    [/^dhcp_relay$/, "services.dhcp_relay"],
    [/^acls$/, "switching.acls"],
    [/^policies$/, "routing.policies"],
    [/^prefix_sets$/, "routing.prefix_sets"],
    [/^vrfs$/, "routing.vrfs"],
    [/^hardware_offload$/, "system.hardware_offload"],
    [/^certificates$/, "system.certificates"],
    [/^flow_export$/, "monitoring.flow_export"],
];

/** A 0.x finding in v1's words. An interface's path takes its group, which the device says; 0.x wrote a bridge's kind in the text instead. */
function v1Path(finding: string, device: Device): string {
    if (V1_PATHS[finding]) return V1_PATHS[finding];

    const iface = /^interfaces\.([^.,\s]+)(.*)$/.exec(finding);
    if (iface) {
        const kind = Derive.interfaces(device).find((entry) => entry.name === iface[1])?.kind;
        const rest = iface[2]!.replace(/^, a bridge,/, ",").replace(/^, a \w+$/, "");
        return `interfaces.${kind}.${iface[1]}${rest}`;
    }

    return V1_PREFIXES.reduce((text, [old, now]) => text.replace(old, now), finding);
}

/** Fixtures whose render differs from 0.x's only in order, inside a section the platform treats as unordered, each with why. None so far. */
const ORDER_ONLY: Record<string, string> = {};

const fixtures = Fixtures.ofPlatform("raisecom-ros");

test("every Raisecom ROS fixture is checked", () => {
    expect(fixtures.length).toBeGreaterThan(0);
});

for (const name of fixtures) {
    test(`${name} renders as 0.x did`, () => {
        const device = Fixtures.device(name);
        const rendered = platform.render(device);
        const old = Fixtures.render(name);

        if (ORDER_ONLY[name]) {
            const plan = platform.plan(rendered, old, { secrets: false, rollback: 10 });
            expect(plan.steps).toEqual([]);
            expect(plan.problems).toEqual([]);
        } else expect(rendered).toBe(old);
    });

    test(`${name} is refused what 0.x refused, by v1 paths`, () => {
        const device = Fixtures.device(name);
        expect(platform.unsupported(device)).toEqual(Fixtures.unsupported(name).map((finding) => v1Path(finding, device)));
    });
}

test("a v1 field 0.x did not have is refused unless it is Circuit's own, and paths are v1's", () => {
    const device = Fixtures.device("platforms--example-core-switch");
    const unsupported = (change: Partial<Device>) => platform.unsupported({ ...device, ...change } as Device);

    // Circuit's own: rendered nowhere, refused nowhere.
    expect(unsupported({ role: "core", switching: { ...device.switching, vlans: { native: { id: 999, untrusted: true } } } })).toEqual([]);

    expect(unsupported({ services: { dns_server: true } })).toEqual([
        "system.dns, system.logging.local, system.release_channel, system.banner, services.dns_server and services.ntp_server",
    ]);

    // Address sets alone build nothing; `management.allow` may name one.
    expect(unsupported({ firewall: { address_sets: { admins: ["192.0.2.0/24"] } } })).toEqual([]);
    expect(unsupported({ firewall: { filter: { input: { default_action: "drop" } } } })).toEqual(["firewall"]);

    const ports = { ...device.interfaces?.ethernet, "10g-1": { ingress_acl: "guests" } };
    expect(unsupported({ interfaces: { ...device.interfaces, ethernet: ports } })).toEqual(["interfaces.ethernet.10g-1.ingress_acl"]);
});

test("fields a Raisecom switch can't take are refused, not skipped", () => {
    const core = Fixtures.device("platforms--example-core-switch");
    const [port] = Object.keys(core.interfaces?.ethernet ?? {});
    const device = {
        ...core,
        interfaces: {
            ...core.interfaces,
            ethernet: { ...core.interfaces?.ethernet, [port!]: { ...core.interfaces?.ethernet?.[port!], ipv6_ra: true } },
        },
        routing: { ...core.routing, ospf: undefined, router_id: "192.0.2.1" },
    } as Device;

    const found = platform.unsupported(device);
    expect(found).toContain(`interfaces.ethernet.${port}.ipv6_ra`);
    expect(found).toContain("routing.router_id without routing.ospf, only OSPF uses it here");
});
