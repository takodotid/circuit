// Circuit 0.x's examples, templates and use cases validated with no error, with the built-in checks each network turned on. Each still does in v1, what its
// platform cannot express included. And a field a platform renders nothing for is an error, so it never goes missing without a word.

import { expect, test } from "bun:test";
import { Validation, type NetworkChecks } from "../../src/checks";
import type { Device } from "../../src/model";
import { Fixtures } from "../fixtures";

/** The built-in checks each 0.x network turned on, and the VLANs its `trustBoundary` called untrusted, which v1 writes `untrusted: true`. */
const CHECKS: Record<string, { checks: NetworkChecks; untrusted: string[] }> = {
    colocation: {
        checks: { exports_end_in_reject: true, native_vlans_are_dead_ends: true, untrusted_vlans: { filtering_devices: ["edge-01"] } },
        untrusted: ["transit", "ix"],
    },
    "edge-router": {
        checks: { exports_end_in_reject: true, untrusted_vlans: { filtering_devices: ["edge-01"] } },
        untrusted: ["transit", "ix"],
    },
    "ip-transit": {
        checks: { exports_end_in_reject: true, untrusted_vlans: { filtering_devices: ["edge-01"] } },
        untrusted: ["transit", "ix"],
    },
    "ix-transit": {
        checks: { exports_end_in_reject: true, untrusted_vlans: { filtering_devices: ["edge-01"] } },
        untrusted: ["transit", "ix"],
    },
    "regional-provider": {
        checks: {
            exports_end_in_reject: true,
            tunnels_outside_offered: true,
            native_vlans_are_dead_ends: true,
            untrusted_vlans: { filtering_devices: ["edge-a1", "edge-a2", "edge-b1"] },
        },
        untrusted: ["transit-a", "transit-b", "transit-c", "ix"],
    },
};

/** The device with each of these VLANs written `untrusted: true`, as v1 marks them. */
const markUntrusted = (device: Device, untrusted: readonly string[]): Device => ({
    ...device,
    switching: device.switching && {
        ...device.switching,
        vlans: Object.fromEntries(
            Object.entries(device.switching.vlans ?? {}).map(([name, vlan]) => [
                name,
                untrusted.includes(name) ? { ...vlan!, untrusted: true } : vlan,
            ])
        ),
    },
});

/** Each fixture group, the part of a fixture's name before `--`, with its fixtures. */
const groups = new Map<string, string[]>();
for (const name of Fixtures.names()) {
    const group = name.split("--")[0]!;
    groups.set(group, [...(groups.get(group) ?? []), name]);
}

for (const [group, names] of groups) {
    test(`${group} validates with no error`, () => {
        const { checks, untrusted } = CHECKS[group] ?? { checks: undefined, untrusted: [] };
        const devices = names.map((name) => markUntrusted(Fixtures.device(name), untrusted));

        const errors = Validation.run(devices, checks).filter((finding) => finding.level === "error");
        expect(errors).toEqual([]);
    });
}

// Each path is 0.x's in v1's groups and names (`scripts/from-v0.ts`), and each reason as 0.x wrote it, a field it names in v1's name.
test("a field a platform renders nothing for is unsupported", () => {
    const router = Fixtures.device("platforms--example-router");
    const switchDevice = Fixtures.device("platforms--example-switch");
    const coreSwitch = Fixtures.device("platforms--example-core-switch");
    const aggregationSwitch = Fixtures.device("platforms--example-aggregation-switch");
    const firewall = Fixtures.device("platforms--example-firewall");

    /** What validation says the device's platform cannot express. */
    const unsupported = (device: Device) =>
        Validation.run([device], undefined)
            .filter((finding) => finding.device === device.name && finding.message.startsWith(`${device.platform} cannot express `))
            .map((finding) => finding.message.slice(`${device.platform} cannot express `.length));

    const switchGaps = (device: Device): Device => ({
        ...device,
        system: {
            ...device.system,
            users: {
                ...device.system?.users,
                operator: { ...device.system!.users!.operator!, description: "Someone", ssh_keys: ["ssh-ed25519 AAAA key"] },
            },
            ip_stack: { syn_cookies: true },
        },
        management: { ...device.management, ssh: { allow: ["198.51.100.0/24"], port: 2222 } },
        monitoring: { ...device.monitoring, snmp: { ...device.monitoring!.snmp!, allow: ["198.51.100.0/24"] } },
    });

    for (const device of [switchDevice, coreSwitch]) {
        expect(unsupported(switchGaps(device))).toEqual(
            expect.arrayContaining([
                "management.ssh.allow, every service takes management.allow",
                // VRP and Raisecom ROS both give SNMP sources of their own, so neither refuses monitoring.snmp.allow.
                "management.ssh.port",
                "system.users.operator.description",
                "system.ip_stack",
            ])
        );
        // Raisecom ROS takes no key; VRP takes RSA only, and this one is ed25519.
        expect(unsupported(switchGaps(device))).toContain(
            device.platform === "vrp"
                ? "system.users.operator.ssh_keys[0], not RSA: the platform takes RSA keys only"
                : "system.users.operator.ssh_keys"
        );
    }

    const raisecom: Device = {
        ...coreSwitch,
        switching: { ...coreSwitch.switching, vlans: { ...coreSwitch.switching?.vlans, servers: { id: 20, description: "Servers" } } },
        interfaces: {
            ...coreSwitch.interfaces,
            vlan_interface: {
                ...coreSwitch.interfaces?.vlan_interface,
                management: { vlan: "management", addresses: ["192.0.2.3/24", "2001:db8::3/64"], mtu: 9000 },
            },
        },
        routing: { static_routes: [{ prefix: "2001:db8:1::/48", next_hop: "2001:db8::1", description: "Away" }] },
    };
    expect(unsupported(raisecom)).toEqual(
        expect.arrayContaining([
            "switching.vlans.servers.description",
            "interfaces.vlan_interface.management.mtu",
            "interfaces.vlan_interface.management.addresses 2001:db8::3/64, only IPv4 here",
            "routing.static_routes 2001:db8:1::/48, only an IPv4 next_hop in the default table",
            "routing.static_routes 2001:db8:1::/48 description and distance",
        ])
    );

    const routing = aggregationSwitch.routing!;
    const bgp = routing.bgp!;
    const junos: Device = {
        ...aggregationSwitch,
        system: {
            ...aggregationSwitch.system,
            users: {
                ...aggregationSwitch.system?.users,
                operator: { role: "operator", password: { secret: "EXAMPLE_OPERATOR_PASSWORD" } },
            },
        },
        interfaces: {
            ...aggregationSwitch.interfaces,
            ethernet: {
                ...aggregationSwitch.interfaces?.ethernet,
                "10g-4": { access_vlan: "servers", ingress_acl: "by-vlan", storm_control: { broadcast: { pps: 1000 } } },
            },
        },
        switching: { ...aggregationSwitch.switching, acls: { "by-vlan": [{ if: { vlan: "servers" }, then: "drop" }] } },
        services: {
            ...aggregationSwitch.services,
            dhcp_relay: { ...aggregationSwitch.services?.dhcp_relay, management: { interface: "management", servers: ["192.0.2.67"] } },
        },
        routing: {
            ...routing,
            static_routes: [{ prefix: "192.0.2.128/25", next_hop: "192.0.2.1", description: "Away" }],
            bgp: {
                ...bgp,
                neighbors: { ...bgp.neighbors, "transit-1": { ...bgp.neighbors!["transit-1"]!, role: "provider", keepalive: 30 } },
            },
        },
    };
    expect(unsupported(junos)).toEqual(
        expect.arrayContaining([
            "system.users.operator, a name the platform keeps for a system account",
            "switching.acls.by-vlan matching a VLAN, on port 10g-4",
            "interfaces.ethernet.10g-4.storm_control in pps, the platform takes percent",
            "services.dhcp_server.management.interface, which a DHCP relay also uses",
            "routing.static_routes 192.0.2.128/25 description",
            "routing.bgp.neighbors.transit-1.role, Junos 21 has no BGP roles",
            "routing.bgp.neighbors.transit-1.keepalive, the platform keeps it at a third of hold_time",
        ])
    );

    const bonded: Device = {
        ...router,
        interfaces: { ...router.interfaces, lag: { ...router.interfaces?.lag, uplink: { stp: { cost: 10 } } } },
    };
    expect(unsupported(bonded)).toContain("interfaces.lag.uplink.stp, on a LAG");

    const fortios: Device = {
        ...firewall,
        interfaces: {
            ...firewall.interfaces,
            ethernet: { ...firewall.interfaces?.ethernet, "10g-3": { access_vlan: "guests" }, "10g-4": { trunk_vlans: ["servers"] } },
            gre: {
                ...firewall.interfaces?.gre,
                tunnel: { local_address: "203.0.113.10", remote_address: "203.0.113.20", addresses: ["10.0.0.1/30"] },
            },
            wireguard: { peers: { listen_port: 51820, private_key: { secret: "EXAMPLE_WIREGUARD_KEY" } } },
        },
        management: { ...firewall.management, console: { password: { secret: "EXAMPLE_CONSOLE_PASSWORD" } } },
        firewall: {
            ...firewall.firewall,
            filter: { ...firewall.firewall!.filter, output: { default_action: "drop" } },
            untracked: ["198.51.100.0/24"],
        },
    };
    expect(unsupported(fortios)).toEqual(
        expect.arrayContaining([
            "interfaces.ethernet.10g-3.access_vlan, ports are routed",
            "interfaces.ethernet.10g-4.trunk_vlans servers, which another port or LAG also carries",
            "interfaces.vlan_interface.servers, VLAN servers must be carried tagged by exactly one port or LAG",
            "interfaces.gre.tunnel.addresses, an IPv4 address on a tunnel takes its peer",
            "interfaces.wireguard.peers, a wireguard: the platform has no WireGuard",
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
            gre: {
                ...firewall.interfaces?.gre,
                partner: {
                    ...firewall.interfaces!.gre!.partner!,
                    addresses: [{ address: "2001:db8:ffee::1/127", peer_address: "2001:db8:ffee::" }],
                },
            },
            loopback: { ...firewall.interfaces?.loopback, bare: {} },
        },
        management: { ...firewall.management, native_protocol: { port: 8013 } },
        monitoring: {
            ...firewall.monitoring,
            flow_export: { ...firewall.monitoring!.flow_export!, sampling: undefined, interfaces: ["uplink", "partner"] },
        },
        routing: {
            ...firewall.routing,
            ospf: { ...firewall.routing!.ospf!, areas: { "0.0.0.0": { interfaces: { bare: {} } } } },
            policies: { ...firewall.routing?.policies, MIXED: [{ if: { prefix: "192.0.2.0/24", prefix_set: "ours" }, then: "accept" }] },
        },
        firewall: {
            ...fw,
            filter: {
                ...fw.filter,
                forward: {
                    default_action: "drop",
                    rules: [{ if: { src: "192.0.2.0/24", src_address_set: "management" }, then: "accept" }],
                },
            },
            nat: {
                ...fw.nat,
                source: [
                    { if: { src: "198.51.100.32/27", out_interface: "uplink" }, then: "snat", to_address: "203.0.113.11", to_port: 2000 },
                ],
            },
        },
    };
    expect(unsupported(narrow)).toEqual(
        expect.arrayContaining([
            "interfaces.gre.partner.addresses, a peer on an IPv6 address",
            "management.native_protocol.port, FortiManager access listens on 541",
            "monitoring.flow_export.sampling, required and from 10 to 99999: the platform samples",
            "monitoring.flow_export.interfaces partner, a tunnel: the platform samples the interface it leaves through",
            "routing.ospf on bare, which has no IPv4 address for OSPF to run on",
            "routing.policies.MIXED[0].if.prefix with prefix_set",
            "firewall.filter.forward.rules[0].if, a prefix and a set on one side",
            "firewall.nat.source[0].to_port, without if.src_port",
        ])
    );
});
