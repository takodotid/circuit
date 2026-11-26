// VLAN translation. The Junos statements are as a QFX5100 with Junos 21.4R3 printed them in the candidate of a `commit check`, which was rolled back: nothing was committed. The RouterOS lines are as a CHR with RouterOS 7.24.6 exported them.

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

const messages = (device: Device) => Checks.run([device], undefined, { experimental: true }).map((finding) => finding.message);

test("Junos translates on the trunk's unit, with the VLAN still a member, experimentally, and plans nothing against how the switch printed it", () => {
    const junos = Platforms.get("junos");
    const device = translating("junos", "QFX5100-48S-6Q", "10g-21");
    const desired = junos.render(device);

    expect(messages(device)).toEqual([
        "interfaces.ethernet.10g-21.vlan_translation is not tested on a real device yet. Sent because of --experimental: try it on a lab device first.",
    ]);
    expect(junos.unsupported(device)).toEqual([]);
    expect(junos.experimental!(device)).toEqual(["interfaces.ethernet.10g-21.vlan_translation"]);
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

test("RouterOS translates with a VLAN interface on the port, a bridge port of its own, off the switch chip, and plans nothing as a CHR printed it", () => {
    const routeros = Platforms.get("routeros");
    const device = translating("routeros", "CCR2216-1G-12XS-2XQ", "25g-3", { native_vlan: "hall-2" });
    const desired = routeros.render(device);

    expect(messages(device)).toEqual([]);
    expect(routeros.unsupported(device)).toEqual([]);
    for (const line of [
        "/interface vlan\nadd interface=sfp28-3 name=sfp28-3-vlan300 vlan-id=300\n",
        "add bridge=bridge hw=no interface=sfp28-3 pvid=600\n",
        "add bridge=bridge frame-types=admit-only-untagged-and-priority-tagged interface=sfp28-3-vlan300 pvid=3901\n",
        "/interface bridge vlan\nadd bridge=bridge tagged=sfp28-3 vlan-ids=100\n",
    ])
        expect(desired).toContain(line);
    expect(desired).not.toContain("vlan-ids=3901");
    expect(sent("routeros", desired, desired)).toEqual([]);

    const plain = routeros.render(
        translating("routeros", "CCR2216-1G-12XS-2XQ", "25g-3", { native_vlan: "hall-2", vlan_translation: undefined })
    );
    expect(sent("routeros", plain, desired)).toEqual(
        expect.arrayContaining([
            "/interface bridge port set [ find interface=sfp28-3 ] hw=yes",
            "/interface bridge vlan add bridge=bridge tagged=sfp28-3 vlan-ids=3901",
            "/interface bridge port remove [ find interface=sfp28-3-vlan300 ]",
        ])
    );
});

test("RouterOS refuses translation beside spanning tree, which its VLAN interface's BPDUs break, on a LAG, beside a switch rule, and under a taken name", () => {
    const routeros = Platforms.get("routeros");
    const device = translating("routeros", "CCR2216-1G-12XS-2XQ", "25g-3", { ingress_acl: "edge" });
    device.switching = { ...device.switching, stp: {}, acls: { edge: [{ then: "accept" }] } };
    device.interfaces!.lag = { uplink: { trunk_vlans: ["bank"], vlan_translation: [{ from: 300, to: "bank" }] } };
    device.interfaces!.vlan_interface = { "sfp28-3-vlan300": { vlan: "servers" } };

    expect(routeros.unsupported(device)).toEqual(
        expect.arrayContaining([
            "interfaces.lag.uplink.vlan_translation, on a LAG, which is not tested on a device yet",
            "interfaces.ethernet.25g-3.vlan_translation beside switching.stp: RouterOS translates with a VLAN interface on the port, which sends BPDUs of its own, tagged with the ID on the cable, even with stp: false. Remove one of them",
            "interfaces.ethernet.25g-3.ingress_acl beside vlan_translation, not tested on a device yet",
            "interfaces.ethernet.25g-3.vlan_translation from 300: RouterOS names the VLAN interface that translates it sfp28-3-vlan300, which another interface has. Rename that one",
        ])
    );
});

test("FortiOS refuses translation, and Raisecom ROS builds it on a port", () => {
    expect(Platforms.get("raisecom-ros").unsupported(translating("raisecom-ros", "RAX721-C-6C48", "10g-1"))).toEqual([]);

    const refusals: [string, string, string, string][] = [["fortios", "FG-3700D", "10g-1", "ports are routed"]];
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
