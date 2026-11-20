// VLAN translation. The Junos statements are as a QFX5100 with Junos 21.4R3 printed them in the candidate of a `commit check`, which was rolled back: nothing was committed.

import { expect, test } from "bun:test";
import { Checks } from "../../src/checks";
import type { Device, Port } from "../../src/model";
import { Platforms } from "../../src/platforms";

const options = { secrets: false, rollback: 10 };

/** A switch whose port `port` carries `bank` tagged 300 on its cable, and `servers` as its own ID. */
function translating(platform: string, model: string, port: string, settings: Port = {}): Device {
    return {
        name: "sw-01",
        site: "dc-1",
        platform,
        model,
        connection: { host: "192.0.2.1", user: "operator" },
        system: { users: { root: { role: "admin", password: { secret: "ROOT" } } } },
        switching: { vlans: { bank: { id: 3901 }, servers: { id: 100 }, "hall-2": { id: 600 } } },
        interfaces: {
            ethernet: {
                [port]: { trunk_vlans: ["bank", "servers"], vlan_translation: [{ from: 300, to: "bank" }], ...settings },
            },
        },
    } as Device;
}

const sent = (platform: string, desired: string, current: string) =>
    Platforms.get(platform)
        .plan(desired, current, options)
        .steps.flatMap((step) => step.send);

const messages = (device: Device) => Checks.run([device], undefined).map((finding) => finding.message);

test("Junos translates on the trunk's unit, with the VLAN still a member, and plans nothing against how the switch printed it", () => {
    const junos = Platforms.get("junos");
    const device = translating("junos", "QFX5100-48S-6Q", "10g-21");
    const desired = junos.render(device);

    expect(messages(device)).toEqual([]);
    expect(junos.unsupported(device)).toEqual([]);
    const printed = `set interfaces xe-0/0/20 unit 0 family ethernet-switching interface-mode trunk
set interfaces xe-0/0/20 unit 0 family ethernet-switching vlan members bank
set interfaces xe-0/0/20 unit 0 family ethernet-switching vlan members servers
set interfaces xe-0/0/20 unit 0 family ethernet-switching vlan-rewrite translate 300 3901
`;
    for (const line of printed.trim().split("\n")) expect(desired).toContain(line);
    expect(sent("junos", desired, desired)).toEqual([]);

    const plain = junos.render(translating("junos", "QFX5100-48S-6Q", "10g-21", { vlan_translation: undefined }));
    expect(sent("junos", plain, desired)).toEqual(["delete interfaces xe-0/0/20 unit 0 family ethernet-switching vlan-rewrite"]);
});

test("Junos refuses translation beside a native VLAN, which the switch warns about, and to a QinQ VLAN", () => {
    const junos = Platforms.get("junos");
    const native = translating("junos", "QFX5100-48S-6Q", "10g-21", { native_vlan: "servers" });
    expect(junos.unsupported(native)).toContain(
        "interfaces.ethernet.10g-21.vlan_translation beside native_vlan, which the switch warns a trunk should not have"
    );

    const qinq = translating("junos", "QFX5100-48S-6Q", "10g-21", {
        trunk_vlans: ["hall-2"],
        vlan_translation: [{ from: 300, to: "hall-2" }],
    });
    qinq.interfaces!.ethernet!["10g-22"] = { qinq_vlan: "hall-2" };
    expect(junos.unsupported(qinq)).toContain(
        "interfaces.ethernet.10g-21.vlan_translation to hall-2, a QinQ VLAN, which a trunk joins on a unit of its own"
    );
});

test("RouterOS, VRP, Raisecom ROS, and FortiOS refuse translation", () => {
    const refusals: [string, string, string, string][] = [
        ["routeros", "CCR2216-1G-12XS-2XQ", "25g-3", "RouterOS changes a VLAN ID only as a frame comes in"],
        ["vrp", "CE6855-48S6Q-HI", "10g-40", "which only Junos builds for now"],
        ["raisecom-ros", "RAX721-C-6C48", "10g-1", "which only Junos builds for now"],
        ["fortios", "FG-3700D", "10g-1", "ports are routed"],
    ];
    for (const [platform, model, port, reason] of refusals)
        expect(Platforms.get(platform).unsupported(translating(platform, model, port))).toContain(
            `interfaces.ethernet.${port}.vlan_translation, ${reason}`
        );
});

test("validate gives each translated VLAN one ID on the cable, from the port's trunk VLANs, and no ID of a VLAN the port carries", () => {
    const device = translating("junos", "QFX5100-48S-6Q", "10g-21", {
        trunk_vlans: ["bank", "servers"],
        vlan_translation: [
            { from: 300, to: "bank" },
            { from: 300, to: "hall-2" },
            { from: 4095, to: "bank" },
            { from: 100, to: "servers" },
        ],
    });

    expect(messages(device)).toEqual(
        expect.arrayContaining([
            "interfaces.ethernet.10g-21.vlan_translation[1].from 300 is translated twice on the port: write it once",
            "interfaces.ethernet.10g-21.vlan_translation[1].to hall-2 is not in trunk_vlans: the port carries its trunk VLANs only. Add it there",
            "interfaces.ethernet.10g-21.vlan_translation[2].from 4095 is outside 1-4094",
            "interfaces.ethernet.10g-21.vlan_translation[2].to bank has two IDs on the port: write it once",
            "interfaces.ethernet.10g-21.vlan_translation[3].from 100 is the ID of servers, which the port carries: pick another ID",
        ])
    );
    expect(messages(translating("junos", "QFX5100-48S-6Q", "10g-21", { vlan_translation: [] }))).toContain(
        "interfaces.ethernet.10g-21.vlan_translation is empty: write each VLAN and the ID it has on this port, or remove it"
    );
});
