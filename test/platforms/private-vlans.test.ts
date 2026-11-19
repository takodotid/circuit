// Private VLANs (RFC 5517). The Junos statements are as a QFX5100 with Junos 21.4R3 printed them after a commit, and the RouterOS line as a CCR2216 with RouterOS 7.24.6 exported it.

import { expect, test } from "bun:test";
import { Checks } from "../../src/checks";
import type { Device } from "../../src/model";
import { Platforms } from "../../src/platforms";

const options = { secrets: false, rollback: 10 };

/** A switch whose hosts share VLAN `shared`: one isolated, one in the community `kapsi`, and an uplink that carries the primary VLAN. */
function shared(platform: string, model: string, isolated: string, community: string, uplink: string): Device {
    return {
        name: "sw-01",
        site: "dc-1",
        platform,
        model,
        connection: { host: "192.0.2.1", user: "operator" },
        switching: {
            vlans: {
                shared: { id: 500 },
                "shared-isolated": { id: 501, private_vlan: { primary: "shared", type: "isolated" } },
                kapsi: { id: 502, private_vlan: { primary: "shared", type: "community" } },
            },
        },
        interfaces: {
            ethernet: {
                [isolated]: { access_vlan: "shared-isolated" },
                [community]: { access_vlan: "kapsi" },
                [uplink]: { trunk_vlans: ["shared"] },
            },
        },
    } as Device;
}

const sent = (platform: string, desired: string, current: string) =>
    Platforms.get(platform)
        .plan(desired, current, options)
        .steps.flatMap((step) => step.send);

const messages = (device: Device) => Checks.run([device], undefined, { experimental: true }).map((finding) => finding.message);

test("Junos names each secondary VLAN's type, and the primary VLAN names its secondary VLANs", () => {
    const device = shared("junos", "QFX5100-48S-6Q", "10g-33", "10g-34", "10g-35");
    device.system = { users: { root: { role: "admin", password: { secret: "ROOT" } } } };
    const desired = Platforms.get("junos").render(device);

    expect(messages(device)).toEqual([]);
    for (const line of [
        "set vlans shared-isolated private-vlan isolated",
        "set vlans shared isolated-vlan shared-isolated",
        "set vlans kapsi private-vlan community",
        "set vlans shared community-vlans kapsi",
        "set interfaces xe-0/0/32 unit 0 family ethernet-switching vlan members shared-isolated",
        "set interfaces xe-0/0/34 unit 0 family ethernet-switching vlan members shared",
    ])
        expect(desired).toContain(line);
    expect(sent("junos", desired, desired)).toEqual([]);
});

test("RouterOS puts an isolated port in the primary VLAN behind a split horizon, and refuses a community", () => {
    const routeros = Platforms.get("routeros");
    const device = shared("routeros", "CCR2216-1G-12XS-2XQ", "25g-3", "25g-4", "25g-5");
    expect(routeros.unsupported(device)).toEqual([
        "switching.vlans.kapsi.private_vlan, a community: the platform keeps isolated ports apart, but has no communities",
    ]);

    delete device.switching!.vlans!.kapsi;
    delete device.interfaces!.ethernet!["25g-4"];
    const desired = routeros.render(device);

    expect(routeros.unsupported(device)).toEqual([]);
    expect(desired).toContain("add bridge=bridge frame-types=admit-only-untagged-and-priority-tagged horizon=1 interface=sfp28-3 pvid=500");
    expect(sent("routeros", desired, desired)).toEqual([]);

    device.interfaces!.ethernet!["25g-3"] = { access_vlan: "shared" };
    expect(sent("routeros", routeros.render(device), desired)).toEqual([
        "/interface bridge port set [ find interface=sfp28-3 ] horizon=none",
    ]);
});

test("VRP, Raisecom ROS, and FortiOS refuse them", () => {
    for (const [platform, model, refusal] of [
        ["vrp", "CE6855-48S6Q-HI", "which only Junos and RouterOS build for now"],
        ["raisecom-ros", "RAX721-C-6C48", "which only Junos and RouterOS build for now"],
        ["fortios", "FG-3700D", "ports are routed"],
    ] as const) {
        const device = shared(platform, model, "10g-1", "10g-2", "10g-3");
        expect(Platforms.get(platform).unsupported(device)).toContain(`switching.vlans.shared-isolated.private_vlan, ${refusal}`);
    }
});

test("validate keeps a secondary VLAN on access ports, under a primary VLAN with one isolated VLAN at most", () => {
    const device = shared("junos", "QFX5100-48S-6Q", "10g-33", "10g-34", "10g-35");
    device.system = { users: { root: { role: "admin", password: { secret: "ROOT" } } } };
    device.switching!.vlans!.more = { id: 503, private_vlan: { primary: "shared", type: "isolated" } };
    device.switching!.vlans!.nested = { id: 504, private_vlan: { primary: "kapsi", type: "community" } };
    device.interfaces!.ethernet!["10g-35"] = { trunk_vlans: ["shared", "kapsi"] };
    device.interfaces!.vlan_interface = { gateway: { vlan: "shared-isolated", addresses: ["198.51.100.1/24"] } };

    expect(messages(device)).toEqual(
        expect.arrayContaining([
            "switching.vlans.more.private_vlan: shared-isolated is already the isolated VLAN of shared, which has one at most",
            "switching.vlans.nested.private_vlan.primary kapsi is a secondary VLAN itself: name its primary VLAN",
            "interfaces.ethernet.10g-35 carries kapsi, a secondary VLAN, on a trunk: a trunk carries its primary VLAN shared",
            "interfaces.vlan_interface.gateway is on shared-isolated, a secondary VLAN: put it on shared",
        ])
    );
});
