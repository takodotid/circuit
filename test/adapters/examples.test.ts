// Every example validates, renders, and plans nothing against its own render. A plan that is not empty there means the reader and the renderer disagree on a form, which would show up as a change on every apply.

import { describe, expect, test } from "bun:test";
import { adapters } from "../../src/adapters/devices";
import { defineNetwork } from "../../src/core/define";
import { validate } from "../../src/core/validate";
import type { Device } from "../../src/schema";
import aggregationSwitch from "../../examples/aggregation-switch";
import coreSwitch from "../../examples/core-switch";
import router from "../../examples/router";
import switchDevice from "../../examples/switch";

const examples = [router, switchDevice, coreSwitch, aggregationSwitch];

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
});
