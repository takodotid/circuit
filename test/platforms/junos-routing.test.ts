// Routing on Junos that passed `commit check` in a private candidate on a QFX5100 with Junos 21.4R3-S8.5 (#410): next hops with their interface, tables, and policy routing. Each was set, changed, and removed there, and each plan against what the candidate printed was empty. Nothing was committed. The lines it printed are fed to the adapter, with names and addresses replaced.

import { expect, test } from "bun:test";
import type { Device, StaticRoute } from "../../src/model";
import { Platforms } from "../../src/platforms";
import { Fixtures } from "../fixtures";

const junos = Platforms.get("junos");
const options = { secrets: false, rollback: 10 };

const sent = (desired: string, current: string) => junos.plan(desired, current, options).steps.flatMap((step) => step.send);

/** The aggregation switch with only these static routes. */
function withRoutes(static_routes: StaticRoute[]): Device {
    const device = Fixtures.device("platforms--example-aggregation-switch");
    return { ...device, routing: { ...device.routing, static_routes } };
}

/** A render with its static routes as the candidate printed them. */
const printed = (desired: string, routes: string) =>
    [...desired.split("\n").filter((line) => line && !/^set routing-options (rib inet6\.0 )?static /.test(line)), routes].join("\n");

test("Junos writes a next hop with its interface as a qualified next hop, beside a distance too, experimentally", () => {
    const device = withRoutes([
        { prefix: "2001:db8:4100::/48", next_hop: "fe80::2", interface: "management" },
        { prefix: "203.0.113.0/24", next_hop: "192.0.2.2", interface: "management" },
        { prefix: "203.0.113.0/25", next_hop: "192.0.2.3", interface: "management", distance: 5 },
    ]);
    const desired = junos.render(device);

    // As the candidate printed them: the preference before the interface, each on a line of its own.
    const routes = `set routing-options rib inet6.0 static route 2001:db8:4100::/48 qualified-next-hop fe80::2 interface irb.10
set routing-options static route 203.0.113.0/24 qualified-next-hop 192.0.2.2 interface irb.10
set routing-options static route 203.0.113.0/25 qualified-next-hop 192.0.2.3 preference 5
set routing-options static route 203.0.113.0/25 qualified-next-hop 192.0.2.3 interface irb.10`;

    for (const line of routes.split("\n")) expect(desired).toContain(line);
    expect(desired).not.toContain("next-hop fe80::2\n");
    expect(sent(desired, printed(desired, routes))).toEqual([]);

    expect(junos.unsupported(device).filter((gap) => gap.startsWith("routing.static_routes"))).toEqual([]);
    expect(junos.experimental!(device)).toEqual(
        expect.arrayContaining([
            "routing.static_routes 2001:db8:4100::/48 interface",
            "routing.static_routes 203.0.113.0/24 interface",
            "routing.static_routes 203.0.113.0/25 interface",
        ])
    );
});

test("Junos refuses a link-local next hop without its interface, which the switch fails in commit check", () => {
    const device = withRoutes([{ prefix: "2001:db8:4200::/48", next_hop: "fe80::2" }]);

    expect(junos.unsupported(device)).toContain(
        "routing.static_routes 2001:db8:4200::/48 next_hop fe80::2 without interface: write the interface that reaches it"
    );
});

/** The aggregation switch with these tables, routes in them, and policy routing rules, and without its routed port's ACL, as an interface takes one filter of each family. */
function withPolicyRouting(routing: Partial<NonNullable<Device["routing"]>>): Device {
    const device = structuredClone(Fixtures.device("platforms--example-aggregation-switch"));
    delete device.interfaces!.ethernet!["10g-48"]!.ingress_acl;
    return { ...device, routing: { ...device.routing, static_routes: [], ...routing } };
}

/** A table for guests out a second uplink, in both families, and one for a lab whose rule falls back to main. */
const POLICY_ROUTING: Partial<NonNullable<Device["routing"]>> = {
    tables: { uplink2: { description: "Second uplink" }, lab: {} },
    static_routes: [
        { prefix: "0.0.0.0/0", next_hop: "192.0.2.2", routing_table: "uplink2" },
        { prefix: "::/0", next_hop: "2001:db8::2", routing_table: "uplink2" },
        { prefix: "198.51.100.0/24", next_hop: "192.0.2.3", routing_table: "lab" },
    ],
    policy_routing: [
        {
            description: "guests out the second uplink",
            match: { src: "192.0.2.128/25", in_interface: "management" },
            routing_table: "uplink2",
        },
        { match: { dst: "198.51.100.0/24" }, routing_table: "lab", fallback: "main" },
        { match: { src: "2001:db8::/64" }, routing_table: "uplink2" },
    ],
};

/** The tables as the candidate printed them: a description after the static routes, and the fallback first among them. */
const TABLES_PRINTED = `set routing-instances uplink2 instance-type virtual-router
set routing-instances uplink2 routing-options rib uplink2.inet6.0 static route ::/0 next-hop 2001:db8::2
set routing-instances uplink2 routing-options static route 0.0.0.0/0 next-hop 192.0.2.2
set routing-instances uplink2 description "Second uplink"
set routing-instances lab instance-type virtual-router
set routing-instances lab routing-options static route 0.0.0.0/0 next-table inet.0
set routing-instances lab routing-options static route 198.51.100.0/24 next-hop 192.0.2.3
set routing-options interface-routes rib-group inet circuit-tables
set routing-options interface-routes rib-group inet6 circuit-tables-v6
set routing-options rib-groups circuit-tables import-rib inet.0
set routing-options rib-groups circuit-tables import-rib uplink2.inet.0
set routing-options rib-groups circuit-tables import-rib lab.inet.0
set routing-options rib-groups circuit-tables-v6 import-rib inet6.0
set routing-options rib-groups circuit-tables-v6 import-rib uplink2.inet6.0
set routing-options rib-groups circuit-tables-v6 import-rib lab.inet6.0`;

test("Junos writes a table as a virtual router with the main table's interface routes, and policy routing as a filter on each interface, experimentally", () => {
    const device = withPolicyRouting(POLICY_ROUTING);
    const desired = junos.render(device);

    for (const line of [
        ...TABLES_PRINTED.split("\n"),
        // The interface a rule names takes a filter of its own, with the rules for every interface too.
        "set interfaces irb unit 10 family inet filter input circuit-policy-routing-irb-10",
        'set firewall family inet filter circuit-policy-routing-irb-10 term "1 guests out the second uplink" from source-address 192.0.2.128/25',
        'set firewall family inet filter circuit-policy-routing-irb-10 term "1 guests out the second uplink" then routing-instance uplink2',
        "set firewall family inet filter circuit-policy-routing-irb-10 term 2 from destination-address 198.51.100.0/24",
        "set firewall family inet filter circuit-policy-routing-irb-10 term 2 then routing-instance lab",
        "set firewall family inet filter circuit-policy-routing-irb-10 term circuit-default then accept",
        "set interfaces irb unit 10 family inet6 filter input circuit-policy-routing-v6-irb-10",
        "set firewall family inet6 filter circuit-policy-routing-v6-irb-10 term 3 then routing-instance uplink2",
        // The others share one, on routed ports and tunnels of the main table.
        "set interfaces xe-0/0/47 unit 0 family inet filter input circuit-policy-routing",
        "set interfaces xe-0/0/47 unit 0 family inet6 filter input circuit-policy-routing-v6",
        "set interfaces gr-0/0/0 unit 0 family inet filter input circuit-policy-routing",
        "set firewall family inet filter circuit-policy-routing term 2 then routing-instance lab",
        "set firewall family inet6 filter circuit-policy-routing-v6 term 3 from source-address 2001:db8::/64",
    ])
        expect(desired).toContain(line);

    // No interface of a VRF, no loopback, and no management port.
    expect(desired).not.toContain("irb unit 30 family inet filter input circuit-policy-routing");
    expect(desired).not.toMatch(/lo0 unit \d+ family inet filter input circuit-policy-routing/);
    expect(desired).not.toContain("routing-instances lab routing-options rib lab.inet6.0 static route ::/0 next-table");

    const printed = [
        ...desired
            .split("\n")
            .filter((line) => line && !/^set routing-(instances (uplink2|lab)|options (interface-routes|rib-groups)) /.test(line)),
        TABLES_PRINTED,
    ].join("\n");
    expect(sent(desired, printed)).toEqual([]);

    expect(junos.unsupported(device).filter((gap) => gap.startsWith("routing."))).toEqual([]);
    expect(junos.experimental!(device)).toEqual(
        expect.arrayContaining([
            "routing.tables.uplink2",
            "routing.tables.lab",
            "routing.policy_routing",
            "routing.static_routes 0.0.0.0/0 routing_table",
            "routing.static_routes ::/0 routing_table",
        ])
    );
});

test("Junos refuses a BGP session's table, a rule on a VRF's interface, two fallbacks for one table, and a table's own default route beside its fallback", () => {
    const device = withPolicyRouting({
        ...POLICY_ROUTING,
        static_routes: [...POLICY_ROUTING.static_routes!, { prefix: "0.0.0.0/0", next_hop: "192.0.2.3", routing_table: "lab" }],
        policy_routing: [
            ...POLICY_ROUTING.policy_routing!,
            { match: { src: "198.51.100.128/26", in_interface: "guests" }, routing_table: "lab" },
        ],
    });
    const bgp = device.routing!.bgp!;
    device.routing!.bgp = {
        ...bgp,
        neighbors: { ...bgp.neighbors, "hurricane-electric": { address: "198.51.100.4", remote_as: 6939, routing_table: "lab" } },
    };

    expect(junos.unsupported(device).filter((gap) => gap.startsWith("routing."))).toEqual([
        "routing.bgp.neighbors.hurricane-electric.routing_table, not built for Junos: a session of the main instance puts its routes in another table only through a RIB group, untried",
        "routing.policy_routing[3].match.in_interface guests, where no routed packet of the main table arrives: Junos policy-routes on VLAN interfaces, routed ports and LAGs, and tunnels of the main table, with an address",
        "routing.policy_routing[3].fallback none, unlike routing.policy_routing[1] to table lab: Junos falls back for a whole table, so give each rule to it one fallback",
        "routing.static_routes 0.0.0.0/0 in table lab, whose rules fall back to main: Junos falls back through the table's default route, so remove the route or the fallback",
    ]);
});

test("Junos refuses policy routing beside marking and beside a routed port's ACL, as an interface takes one filter of each family", () => {
    const device = withPolicyRouting(POLICY_ROUTING);
    device.interfaces!.ethernet!["10g-48"]!.ingress_acl = "transit-in";
    device.qos = { marking: [{ if: { dst: "192.0.2.0/24" }, then: { dscp: "ef" } }] };

    expect(junos.unsupported(device)).toEqual(
        expect.arrayContaining([
            "routing.policy_routing beside qos.marking: an interface takes one input filter of each family, and both need it",
            "interfaces.ethernet.10g-48.ingress_acl beside routing.policy_routing: a routed port takes one filter of each family",
        ])
    );
});
