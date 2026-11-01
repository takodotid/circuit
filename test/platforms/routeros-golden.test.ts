// Every RouterOS device of Circuit 0.x's examples, templates and use cases, in the v1 model, renders what 0.x rendered and is refused for what 0.x refused.

import { describe, expect, test } from "bun:test";
import type { Device } from "../../src/model";
import { Platforms } from "../../src/platforms";
import { Fixtures } from "../fixtures";

const platform = Platforms.get("routeros");
const options = { secrets: false, rollback: 10 };

/**
 * Fixtures whose render differs from 0.x's only in order, inside menus the plan treats as unordered. v1 groups interfaces by kind, and the
 * loopback comes after the VLAN interfaces, so its addresses move down `/ip address` and `/ipv6 address`, which are keyed by address.
 */
const ORDER_ONLY: Record<string, string> = {
    "platforms--example-router": "the loopback's address comes after every VLAN interface's in /ip address",
    "regional-provider--edge-a1":
        "the loopback's and the tunnels' addresses come after every VLAN interface's in /ip address, the loopback's in /ipv6 address",
    "regional-provider--edge-a2":
        "the loopback's and the tunnels' addresses come after every VLAN interface's in /ip address, the loopback's in /ipv6 address",
    "regional-provider--edge-b1":
        "the loopback's and the tunnels' addresses come after every VLAN interface's in /ip address, the loopback's in /ipv6 address",
};

/** A 0.x path in an unsupported message and its v1 path, first match wins. `$<kind>` is the group of `interfaces` the named interface is in. */
const PATHS: [RegExp, string][] = [
    [/^ports\./, "interfaces.ethernet."],
    [/^interfaces\.([^.,\s]+)/, "interfaces.$<kind>.$1"],
    [/^management\.snmp\./, "monitoring.snmp."],
    [/^system\.transceiver_monitoring/, "monitoring.transceivers"],
    [/^flow_export\./, "monitoring.flow_export."],
    [/^vdoms/, "system.vdoms"],
    [/^routing\.static (\S+) table/, "routing.static_routes $1 routing_table"],
    [/^routing\.static /, "routing.static_routes "],
    [/^routing\.rules/, "routing.policy_routing"],
    [/^routing\.bgp\.groups\.([^.]+)\.table/, "routing.bgp.neighbor_groups.$1.routing_table"],
    [/^routing\.bgp\.neighbors\.([^.]+)\.table/, "routing.bgp.neighbors.$1.routing_table"],
    [/^routing\.bgp\.neighbors\.([^.]+)\.families/, "routing.bgp.neighbors.$1.address_families"],
];

/** A 0.x unsupported message with its path written as v1's. */
function toV1(message: string, device: Device): string {
    for (const [old, now] of PATHS) {
        const match = old.exec(message);
        if (!match) continue;

        const name = match[1] ?? "";
        const kind = Object.entries(device.interfaces ?? {}).find(
            ([group, members]) => group !== "ethernet" && name in (members ?? {})
        )?.[0];
        return message.replace(old, now.replace("$<kind>", kind ?? "?"));
    }

    return message;
}

describe("RouterOS renders each 0.x device as 0.x did", () => {
    const names = Fixtures.ofPlatform("routeros");

    test("there are fixtures, and each order-only exception is one of them", () => {
        expect(names.length).toBeGreaterThan(0);
        for (const name of Object.keys(ORDER_ONLY)) expect(names).toContain(name);
    });

    for (const name of names) {
        test(name, () => {
            const device = Fixtures.device(name);
            const rendered = platform.render(device);
            const old = Fixtures.render(name);

            expect(platform.unsupported(device)).toEqual(Fixtures.unsupported(name).map((message) => toV1(message, device)));

            if (!(name in ORDER_ONLY)) {
                expect(rendered).toBe(old);
                return;
            }

            // The same lines, and nothing for the plan to do between the two.
            expect(rendered).not.toBe(old);
            expect(rendered.split("\n").sort()).toEqual(old.split("\n").sort());

            const plan = platform.plan(rendered, old, options);
            expect(plan.steps).toEqual([]);
            expect(plan.problems).toEqual([]);
        });
    }
});

test("what v1 writes and the platform does not render is refused, by its v1 path", () => {
    const edge = Fixtures.device("edge-router--edge-01");
    const device = {
        ...edge,
        management: { ...edge.management, allow: "admins" },
        firewall: {
            address_sets: { admins: ["192.0.2.0/24"] },
            interface_sets: { uplinks: ["25g-1"] },
            filter: {
                input: { rules: [{ if: { src: ["192.0.2.0/24", "198.51.100.0/24"], in_interface_set: "uplinks" }, then: "accept" }] },
            },
        },
        switching: { ...edge.switching, acls: { ...edge.switching?.acls, extra: [{ if: { vlan: ["ix", "transit"] }, then: "drop" }] } },
        routing: { ...edge.routing, policies: { ...edge.routing?.policies, TAGS: [{ communities: "import" }] } },
    } as Device;

    expect(platform.unsupported(device)).toEqual([
        "firewall.interface_sets, which the platform does not build yet",
        "firewall.filter.input.rules[0].if.src, a list: write one rule for each",
        "firewall.filter.input.rules[0].if.in_interface_set, which the platform does not build yet",
        "switching.acls.extra[0].if.vlan, a list: write one rule for each",
        "management.allow admins, an address set by name: write its prefixes",
        "routing.policies.TAGS[0].communities import",
    ]);
});

test("a session in its own table that would announce nothing names v1's fields", () => {
    const edge = Fixtures.device("edge-router--edge-01");
    const bgp = edge.routing!.bgp!;
    const device: Device = {
        ...edge,
        routing: {
            ...edge.routing,
            tables: { transit: {} },
            bgp: { ...bgp, neighbors: { "hurricane-electric": { ...bgp.neighbors!["hurricane-electric"]!, routing_table: "transit" } } },
        },
    };

    const [finding, ...rest] = platform.checks!(device);
    expect(rest).toEqual([]);
    expect(finding?.level).toBe("error");
    expect(finding?.message).toStartWith("routing.bgp.neighbors.hurricane-electric would announce nothing");
    expect(finding?.message).toContain('routing_table: "transit" }');
    expect(finding?.message).toEndWith("in routing.static_routes");
});

test("0.x paths are written as v1's", () => {
    const device = { interfaces: { lag: { members: {} } } } as unknown as Device;

    expect(toV1("ports.25g-2.mac_limit, no limit", device)).toBe("interfaces.ethernet.25g-2.mac_limit, no limit");
    expect(toV1("interfaces.members.ethertypes, on a LAG", device)).toBe("interfaces.lag.members.ethertypes, on a LAG");
    expect(toV1("routing.static 192.0.2.0/24 bfd, why", device)).toBe("routing.static_routes 192.0.2.0/24 bfd, why");
    expect(toV1("routing.bgp.neighbors.x.families, one", device)).toBe("routing.bgp.neighbors.x.address_families, one");
    expect(toV1("management.snmp.port", device)).toBe("monitoring.snmp.port");
});
