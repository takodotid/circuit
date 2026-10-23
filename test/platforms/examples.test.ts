// Every example validates, renders, and plans nothing against its own render. A plan that is not empty there means the reader and the renderer disagree on a form, which would show up as a change on every apply.

import { describe, expect, test } from "bun:test";
import { Platforms } from "../../src/platforms";
import { defineNetwork } from "../../src/core/define";
import { Validator } from "../../src/core/validator";
import type { Device } from "../../src/schema";
import aggregationSwitch from "../../examples/platforms/junos";
import coreSwitch from "../../examples/platforms/raisecom-ros";
import firewall from "../../examples/platforms/fortios";
import router from "../../examples/platforms/routeros";
import switchDevice from "../../examples/platforms/vrp";
import transparentFirewall from "../../examples/platforms/fortios-transparent";

const examples = [router, switchDevice, coreSwitch, aggregationSwitch, firewall, transparentFirewall];

describe("examples", () => {
    test("validate", () => {
        const findings = Validator.run(defineNetwork({ devices: examples }));
        expect(findings).toEqual([]);
    });

    for (const device of examples) {
        test(`${device.name} plans nothing against its own render`, () => {
            const adapter = Platforms.get(device.platform);
            const rendered = adapter.render(device);
            const plan = adapter.plan(rendered, rendered, { secrets: false, rollback: 10 });
            expect(plan.problems).toEqual([]);
            expect(plan.steps.flatMap((step) => step.show)).toEqual([]);
        });
    }
});

// Templates are what `circuit new` copies and what the pattern pages show; use cases are what the use case pages show; the regional provider is one network with all of it at once. Each validates, with its own checks, and plans nothing against its own render.
describe("templates and use cases", () => {
    const configs = [
        ...["single-site", "edge-router", "colocation"].map((pattern) => `templates/${pattern}`),
        ...["ip-transit", "ix-transit", "internet-exchange", "virtual-exchange", "regional-provider"].map(
            (useCase) => `examples/use-cases/${useCase}`
        ),
    ];

    for (const directory of configs) {
        test(directory, async () => {
            const network = (await import(`../../${directory}/circuit.config.ts`)).default;
            const findings = Validator.run(network).filter((finding) => finding.level === "error");
            expect(findings).toEqual([]);

            for (const device of network.devices) {
                const adapter = Platforms.get(device.platform);
                const rendered = adapter.render(device);
                const plan = adapter.plan(rendered, rendered, { secrets: false, rollback: 10 });
                expect(plan.problems).toEqual([]);
                expect(plan.steps.flatMap((step) => step.show)).toEqual([]);
            }
        });
    }
});

// A field the render leaves out is reported, so it never goes missing without a word.
test("a field a platform renders nothing for is unsupported", () => {
    const unsupported = (device: Device) => Platforms.get(device.platform).unsupported(device);

    const switchGaps = (device: Device): Device => ({
        ...device,
        users: { ...device.users, operator: { ...device.users!.operator!, description: "Someone", ssh_keys: ["ssh-ed25519 AAAA key"] } },
        management: {
            ...device.management,
            ssh: { allow: ["198.51.100.0/24"], port: 2222 },
            snmp: { ...device.management!.snmp!, allow: ["198.51.100.0/24"] },
        },
        system: { ...device.system, ip: { syn_cookies: true } },
    });

    for (const device of [switchDevice, coreSwitch]) {
        expect(unsupported(switchGaps(device))).toEqual(
            expect.arrayContaining([
                "management.ssh.allow, every service takes management.allow",
                // VRP and Raisecom ROS both give SNMP sources of their own, so neither refuses management.snmp.allow.
                "management.ssh.port",
                "users.operator.description",
                "users.operator.ssh_keys",
                "system.ip",
            ])
        );
    }

    const raisecom: Device = {
        ...coreSwitch,
        vlans: { ...coreSwitch.vlans, servers: { id: 20, description: "Servers" } },
        interfaces: {
            ...coreSwitch.interfaces,
            management: { type: "vlan", vlan: "management", addresses: ["192.0.2.3/24", "2001:db8::3/64"], mtu: 9000 },
        },
        routing: { static: [{ prefix: "2001:db8:1::/48", via: "2001:db8::1", description: "Away" }] },
    };
    expect(unsupported(raisecom)).toEqual(
        expect.arrayContaining([
            "vlans.servers.description",
            "interfaces.management.mtu",
            "interfaces.management.addresses 2001:db8::3/64, only IPv4 here",
            "routing.static 2001:db8:1::/48, only an IPv4 next hop in the default table",
            "routing.static 2001:db8:1::/48 description and distance",
        ])
    );

    const bgp = aggregationSwitch.routing!.bgp!;
    const junos: Device = {
        ...aggregationSwitch,
        users: { ...aggregationSwitch.users, operator: { role: "operator", password: { secret: "EXAMPLE_OPERATOR_PASSWORD" } } },
        ports: {
            ...aggregationSwitch.ports,
            "10g-4": { access_vlan: "servers", acl: "by-vlan", storm_control: { broadcast: { pps: 1000 } } },
        },
        acls: { "by-vlan": [{ match: { vlan: "servers" }, action: "drop" }] },
        dhcp_relay: { ...aggregationSwitch.dhcp_relay, management: { interface: "management", servers: ["192.0.2.67"] } },
        routing: {
            static: [{ prefix: "192.0.2.128/25", via: "192.0.2.1", description: "Away" }],
            bgp: {
                ...bgp,
                neighbors: { ...bgp.neighbors, "transit-1": { ...bgp.neighbors!["transit-1"]!, role: "provider", keepalive: 30 } },
            },
        },
    };
    expect(unsupported(junos)).toEqual(
        expect.arrayContaining([
            "users.operator, a name the platform keeps for a system account",
            "acls.by-vlan matching a VLAN, on port 10g-4",
            "ports.10g-4.storm_control in pps, the platform takes percent",
            "dhcp.management.interface, which a DHCP relay also uses",
            "routing.static 192.0.2.128/25 description",
            "routing.bgp.neighbors.transit-1.role, Junos 21 has no BGP roles",
            "routing.bgp.neighbors.transit-1.keepalive, the platform keeps it at a third of hold_time",
        ])
    );

    const bonded: Device = { ...router, interfaces: { ...router.interfaces, uplink: { type: "lag", stp: { cost: 10 } } } };
    expect(unsupported(bonded)).toContain("interfaces.uplink.stp, on a LAG");

    const fortios: Device = {
        ...firewall,
        ports: { ...firewall.ports, "10g-3": { access_vlan: "guests" }, "10g-4": { trunk_vlans: ["servers"] } },
        interfaces: {
            ...firewall.interfaces,
            tunnel: { type: "gre", local: "203.0.113.10", remote: "203.0.113.20", addresses: ["10.0.0.1/30"] },
            peers: { type: "wireguard", listen_port: 51820, private_key: { secret: "EXAMPLE_WIREGUARD_KEY" } },
        },
        management: { ...firewall.management, console: { password: { secret: "EXAMPLE_CONSOLE_PASSWORD" } } },
        firewall: {
            ...firewall.firewall,
            filter: { ...firewall.firewall!.filter, output: { default: "drop" } },
            untracked: ["198.51.100.0/24"],
        },
    };
    expect(unsupported(fortios)).toEqual(
        expect.arrayContaining([
            "ports.10g-3.access_vlan, ports are routed",
            "ports.10g-4.trunk_vlans servers, which another port or LAG also carries",
            "interfaces.servers, VLAN servers must be carried tagged by exactly one port or LAG",
            "interfaces.tunnel.addresses, an IPv4 address on a tunnel takes its peer",
            "interfaces.peers, a wireguard: the platform has no WireGuard",
            "management.console, the console logs in with the device's users",
            "firewall.filter.output, the platform filters no traffic it sends itself",
            "firewall.untracked, every session is tracked",
        ])
    );

    const fw = firewall.firewall!;
    const narrow: Device = {
        ...firewall,
        interfaces: {
            ...firewall.interfaces,
            partner: { ...firewall.interfaces!.partner!, addresses: [{ address: "2001:db8:ffee::1/127", peer: "2001:db8:ffee::" }] },
            bare: { type: "loopback" },
        },
        management: { ...firewall.management, native: { port: 8013 } },
        flow_export: { ...firewall.flow_export!, sampling: undefined, interfaces: ["uplink", "partner"] },
        routing: {
            ...firewall.routing,
            ospf: { ...firewall.routing!.ospf!, areas: { "0.0.0.0": { interfaces: { bare: {} } } } },
        },
        policies: { ...firewall.policies, MIXED: [{ match: { prefix: "192.0.2.0/24", prefix_set: "ours" }, action: "accept" }] },
        firewall: {
            ...fw,
            filter: {
                ...fw.filter,
                forward: { default: "drop", rules: [{ match: { src: "192.0.2.0/24", src_set: "management" }, action: "accept" }] },
            },
            nat: {
                ...fw.nat,
                source: [
                    { match: { src: "198.51.100.32/27", out_interface: "uplink" }, action: "snat", to: "203.0.113.11", to_port: 2000 },
                ],
            },
        },
    };
    expect(unsupported(narrow)).toEqual(
        expect.arrayContaining([
            "interfaces.partner.addresses, a peer on an IPv6 address",
            "management.native.port, FortiManager access listens on 541",
            "flow_export.sampling, required and from 10 to 99999: the platform samples",
            "flow_export.interfaces partner, a tunnel: the platform samples the interface it leaves through",
            "routing.ospf on bare, which has no IPv4 address for OSPF to run on",
            "policies.MIXED[0].match.prefix with prefix_set",
            "firewall.filter.forward[0].match, a prefix and a set on one side",
            "firewall.nat.source[0].to_port, without match.src_port",
        ])
    );
});

// A platform whose commands for a MAC limit or an ethertype filter are not proved on a device refuses both rather than guess. Each proved one has its own proofs test.
test("a platform that has not proved them refuses a MAC limit and an ethertype filter", () => {
    const proved = ["routeros", "raisecom-ros"];

    for (const device of examples.filter((example) => !proved.includes(example.platform))) {
        const [port, settings] = Object.entries(device.ports ?? {})[0]!;
        const filtered: Device = {
            ...device,
            ports: { ...device.ports, [port]: { ...settings, mac_limit: 1, ethertypes: ["ipv4", "ipv6", "arp"] } },
            interfaces: { ...device.interfaces, members: { type: "lag", mac_limit: 1 } },
        };

        expect(Platforms.get(device.platform).unsupported(filtered)).toEqual(
            expect.arrayContaining([
                `ports.${port}.mac_limit, not proved on a device yet`,
                `ports.${port}.ethertypes, not proved on a device yet`,
                "interfaces.members.mac_limit, not proved on a device yet",
            ])
        );
    }
});

test("a MAC limit is a whole number above 0, and an ethertype filter lets each kind in once", () => {
    const [port, settings] = Object.entries(router.ports ?? {})[0]!;
    const device: Device = {
        ...router,
        ports: { ...router.ports, [port]: { ...settings, mac_limit: 0, ethertypes: ["ipv4", "ipv4"] } },
        interfaces: { ...router.interfaces, members: { type: "lag", mac_limit: 1.5, ethertypes: [] } },
    };
    const messages = Validator.run(defineNetwork({ devices: [device] })).map((finding) => finding.message);

    expect(messages).toEqual(
        expect.arrayContaining([
            `port ${port} mac_limit 0 is not a whole number above 0`,
            `port ${port} ethertypes names a kind twice`,
            "LAG members mac_limit 1.5 is not a whole number above 0",
            "LAG members ethertypes is empty, so it would drop every frame",
        ])
    );
});

test("a route through an AS is matched anywhere in its path", () => {
    const rule = { description: "Not through AS64496", match: { through_as: 64496 }, action: "reject" as const };

    const routeros = Platforms.get("routeros").render({
        ...router,
        policies: { ...router.policies, "UPSTREAM-IN": [rule, ...router.policies!["UPSTREAM-IN"]!] },
    });
    expect(routeros).toContain(`rule="if (bgp-as-path 64496) { reject }"`);

    const junos = Platforms.get("junos").render({
        ...aggregationSwitch,
        policies: { ...aggregationSwitch.policies, "transit-in": [rule, ...aggregationSwitch.policies!["transit-in"]!] },
    });
    expect(junos).toContain(`set policy-options as-path circuit-through-64496 ".* 64496 .*"`);
    expect(junos).toContain("as-path circuit-through-64496");
});

test("a transparent FortiGate takes one management address outside its bridges", () => {
    const managed: Device = {
        ...transparentFirewall,
        connection: { ...transparentFirewall.connection, host: "192.0.2.70" },
        management: { allow: ["192.0.2.0/24"], https: {}, ssh: {} },
        vlans: { ...transparentFirewall.vlans, management: { id: 99 } },
        interfaces: {
            ...transparentFirewall.interfaces,
            router: { type: "lag", mode: "lacp", trunk_vlans: ["outside", "inside", "management"] },
            management: { type: "vlan", vlan: "management", addresses: ["192.0.2.70/24"] },
        },
        routing: { static: [{ prefix: "0.0.0.0/0", via: "192.0.2.1" }] },
    };
    const adapter = Platforms.get("fortios");

    expect(adapter.unsupported!(managed)).toEqual([]);
    const rendered = adapter.render(managed);
    expect(rendered).toContain("set manageip 192.0.2.70/255.255.255.0");
    expect(rendered).toMatch(/edit "management"[^]*?set allowaccess ping https ssh/);
    expect(rendered).not.toMatch(/edit "management"[^]*?set ip /);
    expect(rendered).toMatch(/config router static\n {4}edit 1\n {8}set gateway 192\.0\.2\.1\n {4}next/);

    const plan = adapter.plan(rendered, rendered, { secrets: false, rollback: 10 });
    expect(plan.steps.flatMap((step) => step.show)).toEqual([]);

    const twice = {
        ...managed,
        interfaces: { ...managed.interfaces, outside: { ...managed.interfaces!.outside!, addresses: ["198.51.100.1/24"] } },
    } as Device;
    expect(adapter.unsupported!(twice)).toContain(
        "interfaces.outside.addresses, in transparent mode, which a bridge needs: one IPv4 address in all, outside the bridges, for management"
    );
});

test("management services answer only on the interfaces listed", () => {
    const listed = { ...firewall, management: { ...firewall.management, interfaces: ["management"] } } as Device;
    const rendered = Platforms.get("fortios").render(listed);

    expect(rendered).toMatch(/edit "uplink"[^]*?set allowaccess ping\n/);
    expect(rendered).toMatch(/edit "management"[^]*?set allowaccess ping https ssh/);
    expect(
        Platforms.get("routeros").unsupported({ ...router, management: { ...router.management, interfaces: ["management"] } } as Device)
    ).toContain("management.interfaces, which only FortiOS builds for now");
});

// Nothing in these was proved on a device yet, so every platform refuses them rather than guess (#27).
test("BFD timers, BFD on a static route and BFD on a multihop session are refused until proved", () => {
    // RouterOS proved them, or refuses them for another reason: routeros-proofs.test.ts.
    for (const device of examples.filter((example) => example.platform !== "routeros")) {
        const bgp = device.routing?.bgp;
        const withBfd: Device = {
            ...device,
            routing: {
                ...device.routing,
                bfd: { interval: 300, multiplier: 3 },
                static: [...(device.routing?.static ?? []), { prefix: "198.51.100.128/25", via: "192.0.2.1", bfd: true }],
                bgp: {
                    asn: bgp?.asn ?? 64500,
                    ...bgp,
                    neighbors: { ...bgp?.neighbors, loopback: { address: "192.0.2.200", remote_as: 64500, multihop: true, bfd: true } },
                },
            },
        };

        // FortiOS proved timers and static routes (test/platforms/fortios-proofs.test.ts).
        const proved = device.platform === "fortios";

        expect(Platforms.get(device.platform).unsupported(withBfd)).toEqual(
            expect.arrayContaining([
                ...(proved
                    ? []
                    : [
                          "routing.bfd, BFD timers are not proved on a device yet",
                          "routing.static 198.51.100.128/25 bfd, BFD on a static route is not proved on a device yet",
                      ]),
                "routing.bgp.neighbors.loopback.bfd, BFD on a multihop session is not proved on a device yet",
            ])
        );
    }

    const viaInterface: Device = {
        ...router,
        routing: { ...router.routing, static: [{ prefix: "198.51.100.128/25", interface: "uplink", bfd: true }] },
    };
    const findings = Validator.run(defineNetwork({ devices: [viaInterface] })).map((finding) => finding.message);
    expect(findings).toContain("static route 198.51.100.128/25 has bfd without via, the address BFD watches");
});

// Proved on VRP only, in test/platforms/vrp-proofs.test.ts (#75).
test("an alarm's severity is refused until proved", () => {
    for (const device of examples.filter((example) => example.platform !== "vrp")) {
        const withAlarm: Device = { ...device, system: { ...device.system, alarms: { hwOpticalUnAuthorized: { severity: "warning" } } } };

        expect(Platforms.get(device.platform).unsupported(withAlarm)).toContain(
            "system.alarms.hwOpticalUnAuthorized, an alarm's severity is not proved on a device yet"
        );
    }
});
