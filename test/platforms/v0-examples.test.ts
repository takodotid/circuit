// A plan that is not empty against its own render means the reader and the renderer disagree on a form, which shows up as a change on every apply. Validating them is in test/checks/v0-examples.test.ts.

import { describe, expect, test } from "bun:test";
import { Platforms } from "../../src/platforms";
import type { Device, StaticRoute } from "../../src/model";
import { Fixtures } from "../fixtures";

const router = Fixtures.device("platforms--example-router");
const switchDevice = Fixtures.device("platforms--example-switch");
const coreSwitch = Fixtures.device("platforms--example-core-switch");
const aggregationSwitch = Fixtures.device("platforms--example-aggregation-switch");
const firewall = Fixtures.device("platforms--example-firewall");
const transparentFirewall = Fixtures.device("platforms--example-transparent-firewall");

const examples = [router, switchDevice, coreSwitch, aggregationSwitch, firewall, transparentFirewall];

describe("plans nothing against its own render", () => {
    for (const name of Fixtures.names()) {
        test(name, () => {
            const device = Fixtures.device(name);
            const adapter = Platforms.get(device.platform);
            const rendered = adapter.render(device);
            const plan = adapter.plan(rendered, rendered, { secrets: false, rollback: 10 });

            expect(plan.problems).toEqual([]);
            expect(plan.steps.flatMap((step) => step.show)).toEqual([]);
        });
    }
});

// Each platform that tested them has its own proofs test.
test("a platform that has not proved them refuses a MAC limit and an ethertype filter", () => {
    const tested = ["routeros", "raisecom-ros", "vrp", "junos"];

    for (const device of examples.filter((example) => !tested.includes(example.platform))) {
        const [port, settings] = Object.entries(device.interfaces?.ethernet ?? {})[0]!;
        const filtered: Device = {
            ...device,
            interfaces: {
                ...device.interfaces,
                ethernet: { ...device.interfaces?.ethernet, [port]: { ...settings, mac_limit: 1, ethertypes: ["ipv4", "ipv6", "arp"] } },
                lag: { ...device.interfaces?.lag, members: { mac_limit: 1 } },
            },
        };

        expect(Platforms.get(device.platform).unsupported(filtered)).toEqual(
            expect.arrayContaining([
                `interfaces.ethernet.${port}.mac_limit, not tested on a device yet`,
                `interfaces.ethernet.${port}.ethertypes, not tested on a device yet`,
                "interfaces.lag.members.mac_limit, not tested on a device yet",
            ])
        );
    }
});

// Tested on Junos alone.
test("a platform that has not proved it refuses a port bound to its hosts", () => {
    for (const device of examples.filter((example) => example.platform !== "junos")) {
        const [port, settings] = Object.entries(device.interfaces?.ethernet ?? {})[0]!;
        const bound: Device = {
            ...device,
            interfaces: {
                ...device.interfaces,
                ethernet: {
                    ...device.interfaces?.ethernet,
                    [port]: { ...settings, bound_to: [{ mac: "02:00:00:00:00:01", addresses: ["192.0.2.10"] }] },
                },
            },
        };

        expect(Platforms.get(device.platform).unsupported(bound)).toContain(
            `interfaces.ethernet.${port}.bound_to, not tested on a device yet`
        );
    }
});

test("a route through an AS is matched anywhere in its path", () => {
    const rule = { description: "Not through AS64496", if: { as_path_contains: 64496 }, then: "reject" as const };

    const routeros = Platforms.get("routeros").render({
        ...router,
        routing: {
            ...router.routing,
            policies: { ...router.routing?.policies, "UPSTREAM-IN": [rule, ...router.routing!.policies!["UPSTREAM-IN"]!] },
        },
    });
    expect(routeros).toContain(`rule="if (bgp-as-path 64496) { reject }"`);

    const junos = Platforms.get("junos").render({
        ...aggregationSwitch,
        routing: {
            ...aggregationSwitch.routing,
            policies: {
                ...aggregationSwitch.routing?.policies,
                "transit-in": [rule, ...aggregationSwitch.routing!.policies!["transit-in"]!],
            },
        },
    });
    expect(junos).toContain("set policy-options as-list circuit-as-64496 members 64496");
    expect(junos).toContain("from as-path-transits as-list circuit-as-64496");
});

test("a transparent FortiGate takes one management address outside its bridges", () => {
    const managed: Device = {
        ...transparentFirewall,
        connection: { ...transparentFirewall.connection, host: "192.0.2.70" },
        management: { allow: ["192.0.2.0/24"], https: {}, ssh: {} },
        switching: { ...transparentFirewall.switching, vlans: { ...transparentFirewall.switching?.vlans, management: { id: 99 } } },
        interfaces: {
            ...transparentFirewall.interfaces,
            lag: { router: { mode: "lacp", trunk_vlans: ["outside", "inside", "management"] } },
            vlan_interface: {
                ...transparentFirewall.interfaces?.vlan_interface,
                management: { vlan: "management", addresses: ["192.0.2.70/24"] },
            },
        },
        routing: { static_routes: [{ prefix: "0.0.0.0/0", next_hop: "192.0.2.1" }] },
    };
    const adapter = Platforms.get("fortios");

    expect(adapter.unsupported(managed)).toEqual([]);
    const rendered = adapter.render(managed);
    expect(rendered).toContain("set manageip 192.0.2.70/255.255.255.0");
    expect(rendered).toMatch(/edit "management"[^]*?set allowaccess ping https ssh/);
    expect(rendered).not.toMatch(/edit "management"[^]*?set ip /);
    expect(rendered).toMatch(/config router static\n {4}edit 1\n {8}set gateway 192\.0\.2\.1\n {4}next/);

    const plan = adapter.plan(rendered, rendered, { secrets: false, rollback: 10 });
    expect(plan.steps.flatMap((step) => step.show)).toEqual([]);

    const vlanInterfaces = managed.interfaces!.vlan_interface!;
    const twice: Device = {
        ...managed,
        interfaces: {
            ...managed.interfaces,
            vlan_interface: { ...vlanInterfaces, outside: { ...vlanInterfaces.outside!, addresses: ["198.51.100.1/24"] } },
        },
    };
    expect(adapter.unsupported(twice)).toContain(
        "interfaces.vlan_interface.outside.addresses, in transparent mode, which a bridge needs: one IPv4 address in all, outside the bridges, for management"
    );
});

test("management services answer only on the interfaces listed", () => {
    const listed: Device = { ...firewall, management: { ...firewall.management, interfaces: ["management"] } };
    const rendered = Platforms.get("fortios").render(listed);

    expect(rendered).toMatch(/edit "uplink"[^]*?set allowaccess ping\n/);
    expect(rendered).toMatch(/edit "management"[^]*?set allowaccess ping https ssh/);
    expect(
        Platforms.get("routeros").unsupported({ ...router, management: { ...router.management, interfaces: ["management"] } })
    ).toContain("management.interfaces, which only FortiOS builds for now");
});

// See #27. BFD on a static route without a next_hop is in test/checks/device.test.ts.
test("BFD timers, BFD on a static route and BFD on a multihop session are refused until proved", () => {
    // RouterOS tested them, or refuses them for another reason: see routeros-proofs.test.ts.
    for (const device of examples.filter((example) => example.platform !== "routeros")) {
        const bgp = device.routing?.bgp;
        const withBfd: Device = {
            ...device,
            routing: {
                ...device.routing,
                bfd: { interval: 300, multiplier: 3 },
                static_routes: [
                    ...(device.routing?.static_routes ?? []),
                    { prefix: "198.51.100.128/25", next_hop: "192.0.2.1", bfd: true },
                ],
                bgp: {
                    asn: bgp?.asn ?? 64500,
                    ...bgp,
                    neighbors: { ...bgp?.neighbors, loopback: { address: "192.0.2.200", remote_as: 64500, multihop: true, bfd: true } },
                },
            },
        };

        // Each platform's proofs test holds what it tested on a device, such as vrp-proofs.test.ts.
        const tested: Record<string, readonly string[]> = {
            fortios: ["timers", "static", "multihop"],
            vrp: ["timers", "static"],
            junos: ["timers", "static", "multihop"],
            "raisecom-ros": ["static"],
        };
        const findings = {
            timers: "routing.bfd, BFD timers are not tested on a device yet",
            static: "routing.static_routes 198.51.100.128/25 bfd, BFD on a static route is not tested on a device yet",
            multihop: "routing.bgp.neighbors.loopback.bfd, BFD on a multihop session is not tested on a device yet",
        };
        const untested = Object.entries(findings)
            .filter(([feature]) => !(tested[device.platform] ?? []).includes(feature))
            .map(([, finding]) => finding);

        expect(Platforms.get(device.platform).unsupported(withBfd)).toEqual(expect.arrayContaining(untested));
    }
});

// Tested on VRP only, in test/platforms/vrp-proofs.test.ts (#75).
test("an alarm's severity is refused until proved", () => {
    for (const device of examples.filter((example) => example.platform !== "vrp")) {
        const withAlarm: Device = { ...device, system: { ...device.system, alarms: { hwOpticalUnAuthorized: { severity: "warning" } } } };

        expect(Platforms.get(device.platform).unsupported(withAlarm)).toContain(
            "system.alarms.hwOpticalUnAuthorized, an alarm's severity is not tested on a device yet"
        );
    }
});

test("a platform that doesn't build EoIP, round robin, shaping, MSS clamps or proxy ARP refuses each by name", () => {
    const junos = Platforms.get("junos");
    const device = { ...aggregationSwitch, firewall: { tcp_mss: [{ mss: 1400 as const }] } };

    expect(junos.unsupported(device)).toContain("firewall.tcp_mss, which the platform does not build");
});

// VRP and Junos would write the next hop alone and lose the interface.
test("a next hop with its interface is refused on VRP and Junos", () => {
    const route: StaticRoute = { prefix: "192.0.2.0/24", next_hop: "198.51.100.1", interface: "vlan10" };
    const refused = (fixture: string) => {
        const device = Fixtures.device(fixture);
        return Platforms.get(device.platform)
            .unsupported({ ...device, routing: { ...device.routing, static_routes: [route] } })
            .filter((field) => field.includes("next_hop with interface"));
    };

    expect(refused("platforms--example-switch")).toEqual([
        "routing.static_routes 192.0.2.0/24 next_hop with interface, write only one of them",
    ]);
    expect(refused("platforms--example-aggregation-switch")).toEqual([
        "routing.static_routes 192.0.2.0/24 next_hop with interface, write only one of them",
    ]);
});
