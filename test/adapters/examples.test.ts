// Every example validates, renders, and plans nothing against its own render. A plan that is not empty there means the reader and the renderer disagree on a form, which would show up as a change on every apply.

import { describe, expect, test } from "bun:test";
import { adapters } from "../../src/adapters/devices";
import { defineNetwork } from "../../src/core/define";
import { validate } from "../../src/core/validate";
import type { Device } from "../../src/schema";
import aggregationSwitch from "../../examples/aggregation-switch";
import coreSwitch from "../../examples/core-switch";
import firewall from "../../examples/firewall";
import router from "../../examples/router";
import switchDevice from "../../examples/switch";
import transparentFirewall from "../../examples/transparent-firewall";

const examples = [router, switchDevice, coreSwitch, aggregationSwitch, firewall, transparentFirewall];

describe("examples", () => {
    test("validate", () => {
        const findings = validate(defineNetwork({ devices: examples }));
        expect(findings).toEqual([]);
    });

    for (const device of examples) {
        test(`${device.name} plans nothing against its own render`, () => {
            const adapter = adapters[device.platform]!;
            const rendered = adapter.render(device);
            const plan = adapter.plan(rendered, rendered, { secrets: false, rollback: 10 });
            expect(plan.problems).toEqual([]);
            expect(plan.steps.flatMap((step) => step.show)).toEqual([]);
        });
    }
});

// Templates are what `circuit new` copies and what the pattern pages show; use cases are what the use case pages show; the full setup is one network with all of it at once. Each validates, with its own checks, and plans nothing against its own render.
describe("templates and use cases", () => {
    const configs = [
        ...["single-site", "edge-router", "colocation"].map((pattern) => `templates/${pattern}`),
        ...["ip-transit", "ix-transit", "internet-exchange", "virtual-exchange"].map((useCase) => `examples/use-cases/${useCase}`),
        "examples/full-setup",
    ];

    for (const directory of configs) {
        test(directory, async () => {
            const network = (await import(`../../${directory}/circuit.config.ts`)).default;
            const findings = validate(network).filter((finding) => finding.level === "error");
            expect(findings).toEqual([]);

            for (const device of network.devices) {
                const adapter = adapters[device.platform]!;
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
    const unsupported = (device: Device) => adapters[device.platform]!.unsupported(device);

    const switchGaps = (device: Device): Device => ({
        ...device,
        users: { ...device.users, operator: { ...device.users!.operator!, description: "Someone", ssh_keys: ["ssh-ed25519 AAAA key"] } },
        management: { ...device.management, ssh: { allow: ["198.51.100.0/24"], port: 2222 } },
        system: { ...device.system, ip: { syn_cookies: true } },
    });

    for (const device of [switchDevice, coreSwitch]) {
        expect(unsupported(switchGaps(device))).toEqual(
            expect.arrayContaining([
                "management.ssh.allow, every service takes management.allow",
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

test("a route through an AS is matched anywhere in its path", () => {
    const rule = { description: "Not through AS64496", match: { through_as: 64496 }, action: "reject" as const };

    const routeros = adapters["routeros"]!.render({
        ...router,
        policies: { ...router.policies, "UPSTREAM-IN": [rule, ...router.policies!["UPSTREAM-IN"]!] },
    });
    expect(routeros).toContain(`rule="if (bgp-as-path 64496) { reject }"`);

    const junos = adapters["junos"]!.render({
        ...aggregationSwitch,
        policies: { ...aggregationSwitch.policies, "transit-in": [rule, ...aggregationSwitch.policies!["transit-in"]!] },
    });
    expect(junos).toContain(`set policy-options as-path circuit-through-64496 ".* 64496 .*"`);
    expect(junos).toContain("as-path circuit-through-64496");
});
