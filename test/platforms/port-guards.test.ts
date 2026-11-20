// BPDU guard, root guard, DHCP snooping, ARP inspection, and RA guard (RFC 6105). The RouterOS lines are as a CCR2216 with RouterOS 7.24.6 exported them, and the Junos statements as a QFX5100 with Junos 21.4R3 printed them after a commit. The VRP lines went into a CE6855's candidate (V200R005), which was cleared.

import { expect, test } from "bun:test";
import { Checks } from "../../src/checks";
import type { Device } from "../../src/model";
import { Platforms } from "../../src/platforms";

const options = { secrets: false, rollback: 10 };

/** A switch with an access port toward a host and a trunk toward the router, both guarded. */
function guarded(platform: string, model: string, access: string, trunk: string): Device {
    return {
        name: "sw-01",
        site: "dc-1",
        platform,
        model,
        connection: { host: "192.0.2.1", user: "operator" },
        switching: {
            stp: {},
            dhcp_snooping: true,
            ra_guard: true,
            vlans: { servers: { id: 100 }, storage: { id: 200 } },
        },
        interfaces: {
            ethernet: {
                [access]: { access_vlan: "servers", stp: { edge: true, bpdu_guard: true } },
                [trunk]: { trunk_vlans: ["servers", "storage"], stp: { guard: "root" }, dhcp_trusted: true, ra_trusted: true },
            },
        },
    } as Device;
}

const sent = (platform: string, desired: string, current: string) =>
    Platforms.get(platform)
        .plan(desired, current, options)
        .steps.flatMap((step) => step.send);

const messages = (device: Device) => Checks.run([device], undefined, { experimental: true }).map((finding) => finding.message);

test("RouterOS sets them on the bridge and its ports, and sets them back to no when they go", () => {
    const routeros = Platforms.get("routeros");
    const device = guarded("routeros", "CCR2216-1G-12XS-2XQ", "25g-3", "25g-4");
    const desired = routeros.render(device);

    expect(messages(device)).toEqual([]);
    expect(desired).toContain("add dhcp-snooping=yes name=bridge protocol-mode=rstp ra-guard=yes vlan-filtering=yes");
    expect(desired).toContain(
        "add bpdu-guard=yes bridge=bridge edge=yes frame-types=admit-only-untagged-and-priority-tagged interface=sfp28-3 pvid=100"
    );
    expect(desired).toContain(
        "add bridge=bridge frame-types=admit-only-vlan-tagged interface=sfp28-4 restricted-role=yes trusted=yes trusted-ra=yes"
    );
    expect(sent("routeros", desired, desired)).toEqual([]);

    const plain = structuredClone(device);
    plain.switching = { stp: {}, vlans: plain.switching!.vlans };
    plain.interfaces!.ethernet!["25g-3"] = { access_vlan: "servers" };
    plain.interfaces!.ethernet!["25g-4"] = { trunk_vlans: ["servers", "storage"] };

    expect(sent("routeros", routeros.render(plain), desired)).toEqual([
        "/interface bridge set [ find vlan-filtering=yes ] dhcp-snooping=no ra-guard=no",
        "/interface bridge port set [ find interface=sfp28-3 ] bpdu-guard=no edge=auto",
        "/interface bridge port set [ find interface=sfp28-4 ] restricted-role=no trusted=no trusted-ra=no",
    ]);
});

test("Junos guards each port and VLAN, and names every port's DHCP trust, as the switch prints them", () => {
    const junos = Platforms.get("junos");
    const device = guarded("junos", "QFX5100-48S-6Q", "10g-37", "10g-38");
    device.system = { users: { root: { role: "admin", password: { secret: "ROOT" } } } };
    const desired = junos.render(device);

    expect(messages(device)).toEqual([]);
    for (const line of [
        "set protocols rstp interface xe-0/0/36 edge",
        "set protocols layer2-control bpdu-block interface xe-0/0/36",
        "set protocols rstp interface xe-0/0/37 no-root-port",
        "set vlans servers forwarding-options dhcp-security group circuit-dhcp-untrusted overrides untrusted",
        "set vlans servers forwarding-options dhcp-security group circuit-dhcp-untrusted interface xe-0/0/36.0",
        "set vlans servers forwarding-options dhcp-security group circuit-dhcp-trusted overrides trusted",
        "set vlans servers forwarding-options dhcp-security group circuit-dhcp-trusted interface xe-0/0/37.0",
        "set vlans storage forwarding-options dhcp-security group circuit-dhcp-trusted interface xe-0/0/37.0",
        "set forwarding-options access-security router-advertisement-guard vlans servers",
        "set forwarding-options access-security router-advertisement-guard vlans storage",
        "set forwarding-options access-security router-advertisement-guard interface xe-0/0/36.0 mark-interface block",
        "set forwarding-options access-security router-advertisement-guard interface xe-0/0/37.0 mark-interface trusted",
    ])
        expect(desired).toContain(line);
    expect(sent("junos", desired, desired)).toEqual([]);
});

test("VRP sends them only with --experimental, guards every edge port or none, and has no RA guard", () => {
    const vrp = Platforms.get("vrp");
    const device = guarded("vrp", "CE6855-48S6Q-HI", "10g-40", "10g-41");
    const desired = vrp.render(device);

    expect(desired).toContain("stp bpdu-protection");
    expect(desired).toContain("dhcp enable\ndhcp snooping enable");
    expect(desired).toContain("interface 10GE1/0/40\n port default vlan 100\n stp edged-port enable\n dhcp snooping enable");
    expect(desired).toContain("port trunk allow-pass vlan 100 200\n stp root-protection\n dhcp snooping trusted");
    expect(vrp.experimental!(device)).toEqual([
        "switching.dhcp_snooping",
        "interfaces.ethernet.10g-40.stp.bpdu_guard",
        "interfaces.ethernet.10g-41.stp.guard",
        "interfaces.ethernet.10g-41.dhcp_trusted",
    ]);
    expect(vrp.unsupported(device)).toEqual([
        "switching.ra_guard, the platform has no RA guard command",
        "interfaces.ethernet.10g-41.ra_trusted, the platform has no RA guard command",
    ]);

    device.interfaces!.ethernet!["10g-42"] = { access_vlan: "servers", stp: { edge: true } };
    expect(vrp.unsupported(device)).toContain(
        "interfaces.ethernet.10g-42.stp without bpdu_guard, the platform guards every edge port or none: write it on each"
    );
});

test("Raisecom ROS sets root guard on the port, BPDU guard and DHCP snooping only with --experimental, and refuses RA guard", () => {
    const raisecom = Platforms.get("raisecom-ros");
    const device = guarded("raisecom-ros", "RAX721-C-6C48", "10g-1", "10g-2");
    const desired = raisecom.render(device);

    expect(raisecom.unsupported(device)).toEqual([
        "interfaces.ethernet.10g-2.stp, BPDU guard shuts down any port the switch finds to be an edge port: write edge: true or false",
        "switching.ra_guard, which only RouterOS and Junos build for now",
        "interfaces.ethernet.10g-2.ra_trusted, which only RouterOS and Junos build for now",
    ]);
    expect(raisecom.experimental?.(device)).toEqual([
        "switching.dhcp_snooping",
        "interfaces.ethernet.10g-1.stp.bpdu_guard",
        "interfaces.ethernet.10g-2.dhcp_trusted",
    ]);
    expect(desired).toContain("interface tengigabitethernet 1/3/1\nswitchport access vlan 100\nspanning-tree edged-port force-true\n!");
    expect(desired).toContain("spanning-tree rootguard enable\nip dhcp snooping trust\n!");
    expect(desired).toContain("spanning-tree enable\nspanning-tree bpduguard enable\nip dhcp snooping\n");
});

test("FortiOS refuses them", () => {
    expect(Platforms.get("fortios").unsupported(guarded("fortios", "FG-3700D", "10g-1", "10g-2"))).toEqual(
        expect.arrayContaining(["switching.dhcp_snooping, ports are routed", "interfaces.ethernet.10g-2.ra_trusted, ports are routed"])
    );
});

test("validate says what each guard needs", () => {
    const device = guarded("junos", "QFX5100-48S-6Q", "10g-37", "10g-38");
    device.system = { users: { root: { role: "admin", password: { secret: "ROOT" } } } };
    device.switching = { vlans: device.switching!.vlans };
    device.interfaces!.ethernet!["10g-37"] = { access_vlan: "servers", stp: { bpdu_guard: true } };
    device.interfaces!.ethernet!["10g-39"] = { in_lag: "uplink", dhcp_trusted: true };
    device.interfaces!.lag = { uplink: { trunk_vlans: ["servers"] } };

    expect(messages(device)).toEqual(
        expect.arrayContaining([
            "interfaces.ethernet.10g-37.stp.bpdu_guard is for a port that faces hosts: write edge: true beside it",
            "interfaces.ethernet.10g-37.stp guards a port while spanning tree is off on the device: write switching.stp",
            "interfaces.ethernet.10g-38.dhcp_trusted needs switching.dhcp_snooping: write dhcp_snooping: true there",
            "interfaces.ethernet.10g-38.ra_trusted needs switching.ra_guard: write ra_guard: true there",
            "interfaces.ethernet.10g-39.dhcp_trusted is on a member of uplink: write it on the LAG",
        ])
    );
});

test("ARP inspection checks each VLAN that Junos snoops, needs snooping, and is refused elsewhere", () => {
    const device = guarded("junos", "QFX5100-48S-6Q", "10g-37", "10g-38");
    device.system = { users: { root: { role: "admin", password: { secret: "ROOT" } } } };
    device.switching!.arp_inspection = true;
    const desired = Platforms.get("junos").render(device);

    expect(messages(device)).toEqual([]);
    expect(desired).toContain("set vlans servers forwarding-options dhcp-security arp-inspection");
    expect(desired).toContain("set vlans storage forwarding-options dhcp-security arp-inspection");
    expect(sent("junos", desired, desired)).toEqual([]);

    for (const [platform, model] of [
        ["routeros", "CCR2216-1G-12XS-2XQ"],
        ["vrp", "CE6855-48S6Q-HI"],
        ["raisecom-ros", "RAX721-C-6C48"],
        ["fortios", "FG-3700D"],
    ] as const) {
        const refused = Platforms.get(platform).unsupported({ ...device, platform, model });
        expect(refused.some((message) => message.startsWith("switching.arp_inspection, "))).toBe(true);
    }

    device.switching = { vlans: device.switching!.vlans, arp_inspection: true };
    device.interfaces!.ethernet!["10g-38"] = { trunk_vlans: ["servers", "storage"] };
    expect(messages(device)).toContain("switching.arp_inspection checks what DHCP snooping saw: write dhcp_snooping: true beside it");
});
