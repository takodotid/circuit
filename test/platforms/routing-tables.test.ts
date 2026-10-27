// Routing tables beside the main one and the rules that pick them, proved on a CCR2216 on 7.23.5: a BGP session with `routing-table` installed what it learned in that table and not in main, and announced only what that table held; a new `routing-table` on a running session took effect only when it restarted; a rule sent traffic from a block to its table, and `lookup-only-in-table` dropped what the table had no route for where `lookup` fell back to main. Each test feeds the router's own lines to the adapter, with names and addresses replaced.

import { expect, test } from "bun:test";
import { Validator } from "../../src/core/validator";
import { Upstreams } from "../../src/helpers/upstreams";
import { Platforms } from "../../src/platforms";
import type { Device } from "../../src/schema";
import edge from "../../templates/edge-router/edge-01";

const platform = Platforms.get("routeros");
const options = { secrets: false, rollback: 10 };

/** The edge router with a block that leaves only through its own transit: a table, the rules that send the block's traffic to it, the transit's session installing in it, and the block's route in main and in the table, so both announce it. The transit's export accepts our own block too, which its table lacks. */
function withBlockB(): Device {
    const routing = edge.routing!;
    return {
        ...edge,
        policies: {
            ...edge.policies,
            // What it announces: block B, and our own block, which its table then lacks.
            "TRANSIT-P-OUT": [
                { description: "Block B", match: { prefix: "2001:db8:200::/48" }, action: "accept" },
                { description: "Our IPv6", match: { prefix: "2001:db8:100::/48" }, action: "accept" },
                { description: "Nothing else", action: "reject" },
            ],
        },
        routing: {
            ...routing,
            tables: { "block-b": { description: "Block B's own way out" } },
            rules: [
                { description: "Our own networks", match: { dst: "2001:db8::/32" }, table: "main" },
                { description: "Block B leaves through its transit", match: { src: "2001:db8:200::/48" }, table: "block-b" },
            ],
            static: [
                ...routing.static!,
                { prefix: "2001:db8:200::/48", blackhole: true, description: "Block B" },
                { prefix: "2001:db8:200::/48", blackhole: true, table: "block-b", description: "Block B" },
            ],
            bgp: {
                ...routing.bgp!,
                networks: [...routing.bgp!.networks!, "2001:db8:200::/48"],
                neighbors: {
                    ...routing.bgp!.neighbors,
                    "transit-p": {
                        address: "2001:db8:fffe::1",
                        remote_as: 64510,
                        role: "provider",
                        import: "TRANSIT-IN",
                        export: "TRANSIT-P-OUT",
                        table: "block-b",
                    },
                },
            },
        },
    };
}

const errors = (device: Device) =>
    Validator.run({ devices: [device] })
        .filter((finding) => finding.level === "error")
        .map((finding) => finding.message);

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
    const rules = device.routing!.rules!;
    const desired = platform.render({
        ...device,
        routing: {
            ...device.routing!,
            rules: [...rules, { match: { src: "198.51.100.0/24", in_interface: "25g-2" }, table: "block-b", fallback: "main" }],
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
    const { table: _, ...inMain } = neighbors["transit-p"]!;
    const moved: Device = {
        ...device,
        routing: {
            ...device.routing!,
            tables: undefined,
            rules: undefined,
            static: edge.routing!.static,
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

test("a session in a table announces from it: none of networks there is an error, one missing a warning", () => {
    const findings = (device: Device) => (platform.checks?.(device) ?? []).map((finding) => `${finding.level} ${finding.message}`);
    const device = withBlockB();
    const routing = device.routing!;

    expect(findings(device)).toEqual([
        'warning routing.bgp.neighbors.transit-p does not announce 2001:db8:100::/48: On RouterOS a session announces from its own table, block-b, which has no route for it. If its export should announce it, add { prefix: "2001:db8:100::/48", blackhole: true, table: "block-b" } to routing.static',
    ]);

    // The block's route only in main, as on the router where the session then announced nothing at all.
    const onlyInMain: Device = { ...device, routing: { ...routing, static: routing.static!.filter((route) => !route.table) } };
    expect(findings(onlyInMain)).toEqual([
        'error routing.bgp.neighbors.transit-p would announce nothing: On RouterOS a session announces from its own table, block-b, which has no route for any of networks. Add the routes it announces to block-b too, such as { prefix: "2001:db8:100::/48", blackhole: true, table: "block-b" } in routing.static',
    ]);
    expect(errors(onlyInMain)).toContain(findings(onlyInMain)[0]!.slice("error ".length));
});

test("validate: a table named main or like a VRF, one nothing installs in, an unknown table, a rule nothing reaches", () => {
    expect(errors(withBlockB())).toEqual([]);

    const device = withBlockB();
    const routing = device.routing!;
    const broken: Device = {
        ...device,
        vrfs: { oob: {} },
        routing: {
            ...routing,
            tables: { ...routing.tables, main: {}, oob: {}, empty: {} },
            rules: [
                { description: "Everything", table: "block-b" },
                { match: { src: "192.0.2.0/24", dst: "2001:db8::/32" }, table: "nope" },
                { match: { dst: "2001:db8::/32" }, table: "main", fallback: "main" },
            ],
            static: [{ prefix: "192.0.2.0/24", blackhole: true, vrf: "oob", table: "block-b" }],
        },
    };

    expect(errors(broken)).toEqual([
        "static route 192.0.2.0/24 has both vrf and table; a route is in one of them",
        "routing.tables has main, the main table every device has; give the table another name",
        "routing.tables oob has the name of a VRF; give the table another name",
        'routing.tables oob: nothing installs routes in it; give a static route or a BGP neighbor table: "oob", or remove the table',
        'routing.tables empty: nothing installs routes in it; give a static route or a BGP neighbor table: "empty", or remove the table',
        "routing.rules 1 (Everything) matches every packet, so the rules after it never run; give it a match, or move it last",
        "routing.rules 2 table 'nope' is not declared",
        "routing.rules 2: src and dst differ in family, so no packet matches both",
        "routing.rules 3 looks up main and has fallback; fallback is for another table, so remove it",
        // Its static routes replaced, block-b has no route for any of networks.
        'routing.bgp.neighbors.transit-p would announce nothing: On RouterOS a session announces from its own table, block-b, which has no route for any of networks. Add the routes it announces to block-b too, such as { prefix: "2001:db8:100::/48", blackhole: true, table: "block-b" } in routing.static',
    ]);
});

test("a platform that has not proved routing tables refuses them, by the field", () => {
    const { name, connection, users, routing, policies } = withBlockB();
    const device: Device = { name, connection, users, routing, policies, platform: "junos", model: "QFX5100-48S-6Q" };
    const refused = Platforms.get("junos")
        .unsupported(device)
        .filter((field) => /table|rules/.test(field));

    expect(refused).toEqual([
        "routing.static 2001:db8:200::/48 table, a routing table beside the main one is not proved on a device yet",
        "routing.tables, a routing table beside the main one is not proved on a device yet",
        "routing.rules, routing rules are not proved on a device yet",
        "routing.bgp.neighbors.transit-p.table, a routing table beside the main one is not proved on a device yet",
    ]);
    expect(platform.unsupported(withBlockB())).toEqual([]);
});

test("an upstream's table goes on its group, or on each session when it has none", () => {
    const upstreams = Upstreams.define({
        p: {
            asn: 64510,
            role: "provider",
            table: "block-b",
            group: "transit-p",
            sessions: { "p-a": { address: "2001:db8:fffe::1" } },
            export: { name: "P-OUT", rules: [] },
        },
        q: {
            asn: 64511,
            role: "provider",
            table: "block-b",
            sessions: { "q-a": { address: "2001:db8:fffd::1" } },
            export: { name: "Q-OUT", rules: [] },
        },
    });

    expect(upstreams.groups()["transit-p"].table).toBe("block-b");
    expect(upstreams.neighbors()["p-a"]).toEqual({ group: "transit-p", address: "2001:db8:fffe::1" });
    expect(upstreams.neighbors()["q-a"]?.table).toBe("block-b");
});

test("main written out is the main table: it renders, validates and is accepted everywhere as if left out", () => {
    const routing = edge.routing!;
    const written: Device = {
        ...edge,
        routing: {
            ...routing,
            static: routing.static!.map((route) => ({ ...route, table: "main" })),
            bgp: {
                ...routing.bgp!,
                neighbors: Object.fromEntries(
                    Object.entries(routing.bgp!.neighbors!).map(([name, neighbor]) => [name, { ...neighbor, table: "main" }])
                ),
            },
        },
    };

    expect(platform.render(written)).toBe(platform.render(edge));
    expect(errors(written)).toEqual([]);
    expect(platform.checks?.(written) ?? []).toEqual([]);

    const { name, connection, users, policies } = written;
    const junos: Device = { name, connection, users, routing: written.routing, policies, platform: "junos", model: "QFX5100-48S-6Q" };
    expect(
        Platforms.get("junos")
            .unsupported(junos)
            .filter((field) => /table/.test(field))
    ).toEqual([]);
});

test("a network the session's export rejects anyway needs no route in its table, so no warning", () => {
    const device = withBlockB();
    const onlyBlockB: Device = {
        ...device,
        policies: {
            ...device.policies,
            "BLOCK-B-OUT": [
                { description: "Block B", match: { prefix: "2001:db8:200::/48" }, action: "accept" },
                { description: "Nothing else", action: "reject" },
            ],
        },
        routing: {
            ...device.routing!,
            bgp: {
                ...device.routing!.bgp!,
                neighbors: {
                    ...device.routing!.bgp!.neighbors,
                    "transit-p": { ...device.routing!.bgp!.neighbors!["transit-p"]!, export: "BLOCK-B-OUT" },
                },
            },
        },
    };

    expect(platform.checks?.(onlyBlockB) ?? []).toEqual([]);
});
