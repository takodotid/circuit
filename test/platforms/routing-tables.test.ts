// Routing tables beside the main one and the rules that pick them, proved on a CCR2216 on 7.23.5: a BGP session with `routing-table` installed what it learned in that table and not in main, and announced only what that table held; a new `routing-table` on a running session took effect only when it restarted; a rule sent traffic from a block to its table, and `lookup-only-in-table` dropped what the table had no route for where `lookup` fell back to main. Each test feeds the router's own lines to the adapter, with names and addresses replaced.

import { expect, test } from "bun:test";
import { Validation } from "../../src/checks";
import type { Device } from "../../src/model";
import { Platforms } from "../../src/platforms";
import { Fixtures } from "../fixtures";

const edge = Fixtures.device("edge-router--edge-01");
const platform = Platforms.get("routeros");
const options = { secrets: false, rollback: 10 };

/** The edge router with a block that leaves only through its own transit: a table, the rules that send the block's traffic to it, the transit's session installing in it, and the block's route in main and in the table, so both announce it. The transit's export accepts our own block too, which its table lacks. */
function withBlockB(): Device {
    const routing = edge.routing!;
    return {
        ...edge,
        routing: {
            ...routing,
            policies: {
                ...routing.policies,
                // What it announces: block B, and our own block, which its table then lacks.
                "TRANSIT-P-OUT": [
                    { description: "Block B", if: { prefix: "2001:db8:200::/48" }, then: "accept" },
                    { description: "Our IPv6", if: { prefix: "2001:db8:100::/48" }, then: "accept" },
                    { description: "Nothing else", then: "reject" },
                ],
            },
            tables: { "block-b": { description: "Block B's own way out" } },
            policy_routing: [
                { description: "Our own networks", match: { dst: "2001:db8::/32" }, routing_table: "main" },
                { description: "Block B leaves through its transit", match: { src: "2001:db8:200::/48" }, routing_table: "block-b" },
            ],
            static_routes: [
                ...routing.static_routes!,
                { prefix: "2001:db8:200::/48", blackhole: true, description: "Block B" },
                { prefix: "2001:db8:200::/48", blackhole: true, routing_table: "block-b", description: "Block B" },
            ],
            bgp: {
                ...routing.bgp!,
                originated_prefixes: [...routing.bgp!.originated_prefixes!, "2001:db8:200::/48"],
                neighbors: {
                    ...routing.bgp!.neighbors,
                    "transit-p": {
                        address: "2001:db8:fffe::1",
                        remote_as: 64510,
                        role: "provider",
                        import_policy: "TRANSIT-IN",
                        export_policy: "TRANSIT-P-OUT",
                        routing_table: "block-b",
                    },
                },
            },
        },
    };
}

const errors = (device: Device) =>
    Validation.run([device], undefined)
        .filter((finding) => finding.level === "error")
        .map((finding) => finding.message);

/** The device on Junos, with only what the routing tables need: the platform's own checks then refuse nothing else. */
const onJunos = ({ name, site, connection, system, routing }: Device): Device => ({
    name,
    site,
    connection,
    system: { users: system?.users },
    routing,
    platform: "junos",
    model: "QFX5100-48S-6Q",
});

test("a table, its rules, a route in it and a session installing in it render as the router printed them", () => {
    const desired = platform.render(withBlockB());

    expect(desired).toContain('/routing table\nadd fib comment="Block B\'s own way out" name=block-b\n');
    expect(desired).toContain(
        [
            "/routing rule",
            'add action=lookup comment="Our own networks" dst-address=2001:db8::/32 table=main',
            'add action=lookup-only-in-table comment="Block B leaves through its transit" src-address=2001:db8:200::/48 table=block-b',
        ].join("\n")
    );
    expect(desired).toContain('add blackhole comment="Block B" dst-address=2001:db8:200::/48 routing-table=block-b\n');
    expect(desired).toMatch(/add as=64500 .*name=transit-p .*remote.as=64510 routing-table=block-b\n/);

    // The export as the router printed it: the flag between the properties, and the rules and routes as the render writes them.
    const printed = desired.replace(
        'add fib comment="Block B\'s own way out" name=block-b',
        'add comment="Block B\'s own way out" fib name=block-b'
    );
    expect(printed).not.toBe(desired);
    expect(platform.plan(desired, printed, options).steps).toEqual([]);
});

test("a rule that falls back to main is a lookup, and one in an interface's traffic names it as the router spells it", () => {
    const device = withBlockB();
    const rules = device.routing!.policy_routing!;
    const desired = platform.render({
        ...device,
        routing: {
            ...device.routing!,
            policy_routing: [
                ...rules,
                { match: { src: "198.51.100.0/24", in_interface: "25g-2" }, routing_table: "block-b", fallback: "main" },
            ],
        },
    });

    expect(desired).toContain("add action=lookup interface=sfp28-2 src-address=198.51.100.0/24 table=block-b\n");
});

test("the table comes first, its rules are rewritten in order, and removing it removes what uses it before the table", () => {
    const before = platform.render(edge);
    const after = platform.render(withBlockB());

    const adding = platform.plan(after, before, options);
    expect(adding.problems).toEqual([]);
    const sent = adding.steps.flatMap((step) => step.send);
    const at = (prefix: string) => sent.findIndex((line) => line.startsWith(prefix));

    expect(sent[at("/routing table")]).toBe('/routing table add fib comment="Block B\'s own way out" name=block-b');
    expect(at("/routing table")).toBeLessThan(at("/routing rule add"));
    expect(at("/routing rule add")).toBeLessThan(at("/routing bgp connection add"));
    expect(at("/routing table")).toBeLessThan(at("/ipv6 route add"));

    const removing = platform.plan(before, after, options).steps.flatMap((step) => step.send);
    const tableRemoved = removing.findIndex((line) => line.startsWith("/routing table remove"));
    expect(removing[tableRemoved]).toBe("/routing table remove [ find name=block-b ]");
    expect(tableRemoved).toBe(removing.length - 1);
});

test("a session moved to another table is restarted, since a running session takes a new routing-table only when it restarts", () => {
    const device = withBlockB();
    const neighbors = device.routing!.bgp!.neighbors!;
    const { routing_table: _, ...inMain } = neighbors["transit-p"]!;
    const moved: Device = {
        ...device,
        routing: {
            ...device.routing!,
            tables: undefined,
            policy_routing: undefined,
            static_routes: edge.routing!.static_routes,
            bgp: { ...device.routing!.bgp!, neighbors: { ...neighbors, "transit-p": inMain } },
        },
    };

    const toMain = platform.plan(platform.render(moved), platform.render(device), options).steps;
    const selector = '[ find remote.address="2001:db8:fffe::1/128" ]';
    expect(toMain.flatMap((step) => step.send)).toContain(`/routing bgp connection set ${selector} disabled=yes routing-table=main`);
    expect(toMain.flatMap((step) => step.send)).toContain(`/routing bgp connection set ${selector} disabled=no`);
    expect(toMain.flatMap((step) => step.show)).toContain(
        '~ {"remote.address":"2001:db8:fffe::1/128"} routing-table=main, restarting the session: it takes a new routing-table only when it restarts'
    );

    const toTable = platform.plan(platform.render(device), platform.render(moved), options).steps.flatMap((step) => step.send);
    const restart = toTable.indexOf(`/routing bgp connection set ${selector} disabled=yes routing-table=block-b`);
    expect(restart).toBeGreaterThan(-1);
    expect(toTable[restart + 1]).toBe(`/routing bgp connection set ${selector} disabled=no`);

    // Any other change to a session is sent as it was, with no restart.
    const limited = platform.render({
        ...device,
        routing: {
            ...device.routing!,
            bgp: { ...device.routing!.bgp!, neighbors: { ...neighbors, "transit-p": { ...neighbors["transit-p"]!, max_prefixes: 10 } } },
        },
    });
    expect(platform.plan(limited, platform.render(device), options).steps.flatMap((step) => step.send)).toEqual([
        `/routing bgp connection set ${selector} input.limit-process-routes-ipv6=10`,
    ]);
});

test("a session in a table announces from it: none of originated_prefixes there is an error, one missing a warning", () => {
    const findings = (device: Device) => (platform.checks?.(device) ?? []).map((finding) => `${finding.level} ${finding.message}`);
    const device = withBlockB();
    const routing = device.routing!;

    expect(findings(device)).toEqual([
        'warning routing.bgp.neighbors.transit-p does not announce 2001:db8:100::/48: On RouterOS a session announces from its own table, block-b, which has no route for it. If its export should announce it, add { prefix: "2001:db8:100::/48", blackhole: true, routing_table: "block-b" } to routing.static_routes',
    ]);

    // The block's route only in main, as on the router where the session then announced nothing at all.
    const onlyInMain: Device = {
        ...device,
        routing: { ...routing, static_routes: routing.static_routes!.filter((route) => !route.routing_table) },
    };
    expect(findings(onlyInMain)).toEqual([
        'error routing.bgp.neighbors.transit-p would announce nothing: On RouterOS a session announces from its own table, block-b, which has no route for any of originated_prefixes. Add the routes it announces to block-b too, such as { prefix: "2001:db8:100::/48", blackhole: true, routing_table: "block-b" } in routing.static_routes',
    ]);
    expect(errors(onlyInMain)).toContain(findings(onlyInMain)[0]!.slice("error ".length));
});

// A rule naming a table the device does not declare stops the project when it is read (`readProject`), so validation does not report it again.
test("validate: a table named main or like a VRF, one nothing installs in, a rule nothing reaches", () => {
    expect(errors(withBlockB())).toEqual([]);

    const device = withBlockB();
    const routing = device.routing!;
    const broken: Device = {
        ...device,
        routing: {
            ...routing,
            vrfs: { oob: {} },
            tables: { ...routing.tables, main: {}, oob: {}, empty: {} },
            policy_routing: [
                { description: "Everything", routing_table: "block-b" },
                { match: { src: "192.0.2.0/24", dst: "2001:db8::/32" }, routing_table: "nope" },
                { match: { dst: "2001:db8::/32" }, routing_table: "main", fallback: "main" },
            ],
            static_routes: [{ prefix: "192.0.2.0/24", blackhole: true, vrf: "oob", routing_table: "block-b" }],
        },
    };

    expect(errors(broken)).toEqual([
        "routing.static_routes 192.0.2.0/24 has both vrf and routing_table; a route is in one of them",
        "routing.tables has main, the main table every device has; give the table another name",
        "routing.tables oob has the name of a VRF; give the table another name",
        'routing.tables oob: nothing installs routes in it; give a static route or a BGP neighbor routing_table: "oob", or remove the table',
        'routing.tables empty: nothing installs routes in it; give a static route or a BGP neighbor routing_table: "empty", or remove the table',
        "routing.policy_routing[0] (Everything) matches every packet, so the rules after it never run; give it a match, or move it last",
        "routing.policy_routing[1]: src and dst differ in family, so no packet matches both",
        "routing.policy_routing[2] looks up main and has fallback; fallback is for another table, so remove it",
        // Its static routes replaced, block-b has no route for any of originated_prefixes.
        'routing.bgp.neighbors.transit-p would announce nothing: On RouterOS a session announces from its own table, block-b, which has no route for any of originated_prefixes. Add the routes it announces to block-b too, such as { prefix: "2001:db8:100::/48", blackhole: true, routing_table: "block-b" } in routing.static_routes',
    ]);
});

test("a platform that has not proved routing tables refuses them, by the field", () => {
    const refused = Platforms.get("junos")
        .unsupported(onJunos(withBlockB()))
        .filter((field) => /table|policy_routing/.test(field));

    expect(refused).toEqual([
        "routing.static_routes 2001:db8:200::/48 routing_table, a routing table beside the main one is not proved on a device yet",
        "routing.tables, a routing table beside the main one is not proved on a device yet",
        "routing.policy_routing, policy routing is not proved on a device yet",
        "routing.bgp.neighbors.transit-p.routing_table, a routing table beside the main one is not proved on a device yet",
    ]);
    expect(platform.unsupported(withBlockB())).toEqual([]);
});

// 0.x's `Upstreams` helper put an upstream's table on its group, or on each session when it had none. v1 writes both out: a group's table reaches each session in it.
test("a table on a neighbor group installs its sessions in it, as a table on the session does", () => {
    const device = withBlockB();
    const routing = device.routing!;
    const { "transit-p": _, ...neighbors } = routing.bgp!.neighbors!;
    const grouped: Device = {
        ...device,
        routing: {
            ...routing,
            bgp: {
                ...routing.bgp!,
                neighbor_groups: {
                    "transit-p": {
                        remote_as: 64510,
                        role: "provider",
                        import_policy: "TRANSIT-IN",
                        export_policy: "TRANSIT-P-OUT",
                        routing_table: "block-b",
                    },
                },
                neighbors: {
                    ...neighbors,
                    "p-a": { neighbor_group: "transit-p", address: "2001:db8:fffe::1" },
                    "q-a": {
                        address: "2001:db8:fffd::1",
                        remote_as: 64511,
                        role: "provider",
                        import_policy: "TRANSIT-IN",
                        export_policy: "TRANSIT-P-OUT",
                        routing_table: "block-b",
                    },
                },
            },
        },
    };

    const rendered = platform.render(grouped);
    expect(rendered).toMatch(/add as=64500 .*name=p-a .*remote.as=64510 routing-table=block-b\n/);
    expect(rendered).toMatch(/add as=64500 .*name=q-a .*remote.as=64511 routing-table=block-b\n/);
    expect(errors(grouped)).toEqual([]);
});

test("main written out is the main table: it renders, validates and is accepted everywhere as if left out", () => {
    const routing = edge.routing!;
    const written: Device = {
        ...edge,
        routing: {
            ...routing,
            static_routes: routing.static_routes!.map((route) => ({ ...route, routing_table: "main" })),
            bgp: {
                ...routing.bgp!,
                neighbors: Object.fromEntries(
                    Object.entries(routing.bgp!.neighbors!).map(([name, neighbor]) => [name, { ...neighbor!, routing_table: "main" }])
                ),
            },
        },
    };

    expect(platform.render(written)).toBe(platform.render(edge));
    expect(errors(written)).toEqual([]);
    expect(platform.checks?.(written) ?? []).toEqual([]);

    expect(
        Platforms.get("junos")
            .unsupported(onJunos(written))
            .filter((field) => /table/.test(field))
    ).toEqual([]);
});

test("a network the session's export rejects anyway needs no route in its table, so no warning", () => {
    const device = withBlockB();
    const routing = device.routing!;
    const onlyBlockB: Device = {
        ...device,
        routing: {
            ...routing,
            policies: {
                ...routing.policies,
                "BLOCK-B-OUT": [
                    { description: "Block B", if: { prefix: "2001:db8:200::/48" }, then: "accept" },
                    { description: "Nothing else", then: "reject" },
                ],
            },
            bgp: {
                ...routing.bgp!,
                neighbors: {
                    ...routing.bgp!.neighbors,
                    "transit-p": { ...routing.bgp!.neighbors!["transit-p"]!, export_policy: "BLOCK-B-OUT" },
                },
            },
        },
    };

    expect(platform.checks?.(onlyBlockB) ?? []).toEqual([]);
});
