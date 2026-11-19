// QinQ ports. The Junos statements are as a QFX5100 with Junos 21.4R3 printed them after a commit, and the RouterOS line as a CCR2216 with RouterOS 7.24.6 exported it. The VRP lines went into a CE6855's candidate (V200R005), which was cleared.

import { expect, test } from "bun:test";
import { Checks } from "../../src/checks";
import type { Device } from "../../src/model";
import { Platforms } from "../../src/platforms";

const options = { secrets: false, rollback: 10 };

/** A switch with a customer's QinQ port, a trunk that carries the QinQ VLAN beside another VLAN, and one that carries the QinQ VLAN alone. */
function tunnel(platform: string, model: string, qinq: string, mixed: string, alone: string): Device {
    return {
        name: "sw-01",
        site: "dc-1",
        platform,
        model,
        connection: { host: "192.0.2.1", user: "operator" },
        switching: { vlans: { "hall-2": { id: 600 }, servers: { id: 100 } } },
        interfaces: {
            ethernet: {
                [qinq]: { qinq_vlan: "hall-2" },
                [mixed]: { trunk_vlans: ["hall-2", "servers"] },
                [alone]: { trunk_vlans: ["hall-2"] },
            },
        },
    } as Device;
}

const sent = (platform: string, desired: string, current: string) =>
    Platforms.get(platform)
        .plan(desired, current, options)
        .steps.flatMap((step) => step.send);

const messages = (device: Device) => Checks.run([device], undefined, { experimental: true }).map((finding) => finding.message);

test("Junos joins the QinQ VLAN with a unit of each port, tagged with its ID, and the QinQ VLAN has no ID of its own", () => {
    const device = tunnel("junos", "QFX5100-48S-6Q", "10g-37", "10g-38", "10g-39");
    device.system = { users: { root: { role: "admin", password: { secret: "ROOT" } } } };
    const desired = Platforms.get("junos").render(device);

    expect(messages(device)).toEqual([]);
    expect(desired).not.toContain("set vlans hall-2 vlan-id");
    for (const line of [
        "set interfaces xe-0/0/36 flexible-vlan-tagging",
        "set interfaces xe-0/0/36 encapsulation extended-vlan-bridge",
        "set interfaces xe-0/0/36 unit 600 vlan-id-list 1-4094",
        "set interfaces xe-0/0/36 unit 600 input-vlan-map push",
        "set interfaces xe-0/0/36 unit 600 output-vlan-map pop",
        "set interfaces xe-0/0/37 encapsulation flexible-ethernet-services",
        "set interfaces xe-0/0/37 unit 600 encapsulation vlan-bridge",
        "set interfaces xe-0/0/37 unit 600 vlan-id 600",
        "set interfaces xe-0/0/37 unit 0 family ethernet-switching vlan members servers",
        "set interfaces xe-0/0/38 unit 600 vlan-id 600",
        "set vlans hall-2 interface xe-0/0/36.600",
        "set vlans hall-2 interface xe-0/0/37.600",
        "set vlans hall-2 interface xe-0/0/38.600",
    ])
        expect(desired).toContain(line);
    expect(desired).not.toContain("xe-0/0/38 unit 0");
    expect(sent("junos", desired, desired)).toEqual([]);
});

test("RouterOS stacks the QinQ VLAN's tag on every frame of the port", () => {
    const routeros = Platforms.get("routeros");
    const device = tunnel("routeros", "CCR2216-1G-12XS-2XQ", "25g-3", "25g-4", "25g-5");
    const desired = routeros.render(device);

    expect(routeros.unsupported(device)).toEqual([]);
    expect(desired).toContain("add bridge=bridge interface=sfp28-3 pvid=600 tag-stacking=yes");
    expect(sent("routeros", desired, desired)).toEqual([]);

    device.switching!.dhcp_snooping = true;
    expect(routeros.unsupported(device)).toContain(
        "interfaces.ethernet.25g-3.qinq_vlan beside switching.dhcp_snooping, which the platform runs on every VLAN"
    );
});

test("VRP tunnels the port only with --experimental, and Raisecom ROS and FortiOS refuse it", () => {
    const vrp = Platforms.get("vrp");
    const device = tunnel("vrp", "CE6855-48S6Q-HI", "10g-40", "10g-41", "10g-42");

    expect(vrp.render(device)).toContain("interface 10GE1/0/40\n port link-type dot1q-tunnel\n port default vlan 600");
    expect(vrp.experimental!(device)).toEqual(["interfaces.ethernet.10g-40.qinq_vlan"]);
    expect(Platforms.get("raisecom-ros").unsupported(tunnel("raisecom-ros", "RAX721-C-6C48", "10g-1", "10g-2", "10g-3"))).toContain(
        "interfaces.ethernet.10g-1.qinq_vlan, which only RouterOS, Junos, and VRP build for now"
    );
    expect(Platforms.get("fortios").unsupported(tunnel("fortios", "FG-3700D", "10g-1", "10g-2", "10g-3"))).toContain(
        "interfaces.ethernet.10g-1.qinq_vlan, ports are routed"
    );
});

test("validate keeps a QinQ port to its one VLAN, and routes on another VLAN", () => {
    const device = tunnel("junos", "QFX5100-48S-6Q", "10g-37", "10g-38", "10g-39");
    device.system = { users: { root: { role: "admin", password: { secret: "ROOT" } } } };
    device.switching!.dhcp_snooping = true;
    device.interfaces!.ethernet!["10g-37"] = { qinq_vlan: "hall-2", access_vlan: "servers", dhcp_trusted: true };
    device.interfaces!.vlan_interface = { gateway: { vlan: "hall-2", addresses: ["198.51.100.1/24"] } };

    expect(messages(device)).toEqual(
        expect.arrayContaining([
            "interfaces.ethernet.10g-37 has qinq_vlan and access_vlan: write one of them",
            "interfaces.ethernet.10g-37.dhcp_trusted is on a QinQ port, whose frames carry the customer's own tags",
            "interfaces.vlan_interface.gateway is on hall-2, which carries customers' frames as a QinQ VLAN: route on another VLAN",
        ])
    );
});
