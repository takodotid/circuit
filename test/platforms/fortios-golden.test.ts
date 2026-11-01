// Every FortiOS device of Circuit 0.x's examples, templates and use cases, in the v1 model, renders what 0.x rendered, byte for byte, and is refused for what 0.x refused, each path written as v1 names it.

import { describe, expect, test } from "bun:test";
import { FortiOs } from "../../src/platforms/fortios";
import { Fixtures } from "../fixtures";

const platform = new FortiOs();

/** Each 0.x path, by its start, as v1 writes it. The longest start that matches is replaced. */
const PATHS: Record<string, string> = {
    "ports.": "interfaces.ethernet.",
    "users.": "system.users.",
    "certificates.": "system.certificates.",
    vdoms: "system.vdoms",
    "vlans.": "switching.vlans.",
    stp: "switching.stp",
    "lldp.": "switching.lldp.",
    "acls.": "switching.acls.",
    "dhcp.": "services.dhcp_server.",
    "dhcp_relay.": "services.dhcp_relay.",
    flow_export: "monitoring.flow_export",
    vrfs: "routing.vrfs",
    "policies.": "routing.policies.",
    "prefix_sets.": "routing.prefix_sets.",
    "system.ip.": "system.ip_stack.",
    "system.transceiver_monitoring": "monitoring.transceivers",
    "system.logging.remote": "monitoring.syslog",
    "management.snmp": "monitoring.snmp",
    "management.native": "management.native_protocol",
    "routing.static": "routing.static_routes",
    "routing.rules": "routing.policy_routing",
    "routing.bgp.groups.": "routing.bgp.neighbor_groups.",
    "firewall.helpers": "firewall.conntrack_helpers",
};

/** A 0.x path as v1 writes it. */
function v1Path(old: string): string {
    const start = Object.keys(PATHS)
        .filter((key) => old.startsWith(key))
        .sort((a, b) => b.length - a.length)[0];
    return start ? PATHS[start] + old.slice(start.length) : old;
}

/** Fixtures whose render differs from 0.x's only in the order of a section the platform treats as unordered, each with the reason. None so far. */
const REORDERED: Record<string, string> = {};

describe("0.x's FortiOS devices", () => {
    const names = Fixtures.ofPlatform("fortios");

    test("there are some", () => {
        expect(names).toEqual(["platforms--example-firewall", "platforms--example-transparent-firewall"]);
    });

    for (const name of names) {
        test(`${name} renders what 0.x rendered`, () => {
            const rendered = platform.render(Fixtures.device(name));

            if (!REORDERED[name]) {
                expect(rendered).toEqual(Fixtures.render(name));
                return;
            }

            const plan = platform.plan(rendered, Fixtures.render(name), { secrets: false, rollback: 10 });
            expect(plan.problems).toEqual([]);
            expect(plan.steps).toEqual([]);
        });

        test(`${name} is refused for what 0.x refused`, () => {
            expect(platform.unsupported(Fixtures.device(name))).toEqual(Fixtures.unsupported(name).map(v1Path));
        });
    }
});

test("a 0.x path is written as v1 names it", () => {
    expect(v1Path("ports.10g-1.speed 40g")).toBe("interfaces.ethernet.10g-1.speed 40g");
    expect(v1Path("system.ip.syn_cookies")).toBe("system.ip_stack.syn_cookies");
    expect(v1Path("routing.static 0.0.0.0/0.bfd")).toBe("routing.static_routes 0.0.0.0/0.bfd");
    expect(v1Path("routing.router_id")).toBe("routing.router_id");
});
