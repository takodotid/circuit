// IEEE 802.1ad's TPID on ports, and VLAN interfaces that end an inner VLAN. The RouterOS lines are as a CHR with RouterOS 7.24.6 exported them (routeros-chr-qinq.test.ts).

import { expect, test } from "bun:test";
import { Checks } from "../../src/checks";
import type { Device, Port } from "../../src/model";
import { Platforms } from "../../src/platforms";

const options = { secrets: false, rollback: 10 };

/** A switch with a customer's QinQ port and a trunk toward a BNG, both with `tpid`, and a VLAN interface that ends the customer's VLAN 1001 inside hall-2. */
function provider(platform: string, model: string, ports: [string, string], tpid: Port["tpid"] = "0x88a8"): Device {
    const [qinq, trunk] = ports;
    return {
        name: "sw-01",
        site: "dc-1",
        platform,
        model,
        connection: { host: "192.0.2.1", user: "operator" },
        system: { users: { root: { role: "admin", password: { secret: "ROOT" } } } },
        switching: { vlans: { "hall-2": { id: 600 }, servers: { id: 100 } } },
        interfaces: {
            ethernet: {
                [qinq]: { qinq_vlan: "hall-2", tpid },
                [trunk]: { trunk_vlans: ["hall-2", "servers"], tpid },
            },
            vlan_interface: {
                "cust-1001": { vlan: "hall-2", inner_vlan_id: 1001, addresses: ["198.51.100.1/30"] },
                servers: { vlan: "servers", addresses: ["198.51.100.65/26"] },
            },
        },
    } as Device;
}

const routeros = Platforms.get("routeros");
const ccr = (tpid?: Port["tpid"]) => provider("routeros", "CCR2216-1G-12XS-2XQ", ["25g-3", "25g-4"], tpid);

const sent = (desired: string, current: string) => routeros.plan(desired, current, options).steps.flatMap((step) => step.send);

const messages = (devices: Device[]) => Checks.run(devices, undefined, { experimental: true }).map((finding) => finding.message);

test("RouterOS sets 802.1ad's TPID on its bridge, and each VLAN interface on the bridge uses the service tag", () => {
    const device = ccr();
    const desired = routeros.render(device);

    expect(routeros.unsupported(device)).toEqual([]);
    for (const line of [
        "add ether-type=0x88a8 name=bridge protocol-mode=none vlan-filtering=yes",
        "add interface=bridge name=servers use-service-tag=yes vlan-id=100",
        "add interface=bridge name=hall-2 use-service-tag=yes vlan-id=600",
        "add interface=hall-2 name=cust-1001 vlan-id=1001",
        "add bridge=bridge interface=sfp28-3 pvid=600 tag-stacking=yes",
    ])
        expect(desired).toContain(line);
    expect(sent(desired, desired)).toEqual([]);

    // Back to 802.1Q: the bridge and the VLAN interfaces are set, not rebuilt.
    const plain = routeros.render(ccr("0x8100"));
    expect(plain).toContain("add interface=hall-2 name=cust-1001 vlan-id=1001");
    expect(sent(plain, desired)).toEqual(
        expect.arrayContaining([
            "/interface bridge set [ find vlan-filtering=yes ] ether-type=0x8100",
            "/interface vlan set [ find interface=bridge and vlan-id=600 ] use-service-tag=no",
        ])
    );
});

test("RouterOS ends an inner VLAN on the VLAN's own VLAN interface when there is one, and under its MAC", () => {
    const device = ccr("0x8100");
    device.interfaces!.vlan_interface!["hall-2-gw"] = { vlan: "hall-2", mac: "02:00:00:00:06:00" };
    const desired = routeros.render(device);

    expect(desired).toContain("add interface=hall-2-gw-vlan name=cust-1001 vlan-id=1001");
    expect(desired).not.toContain("name=hall-2 ");
    expect(desired.indexOf("name=hall-2-gw-vlan")).toBeLessThan(desired.indexOf("name=cust-1001"));
});

test("RouterOS removes a VLAN interface on another before that one, which it would leave on nothing", () => {
    const current = `/interface vlan
add interface=bridge name=hall-2 vlan-id=600
add interface=hall-2 name=cust-1001 vlan-id=1001
`;
    expect(sent("/interface vlan\n", current)).toEqual([
        "/interface vlan remove [ find interface=hall-2 and vlan-id=1001 ]",
        "/interface vlan remove [ find interface=bridge and vlan-id=600 ]",
    ]);
});

test("RouterOS wants one TPID on every switched port, and refuses what is untested on an 802.1ad bridge", () => {
    const mixed = ccr();
    mixed.interfaces!.ethernet!["25g-5"] = { access_vlan: "servers", stp: false };
    mixed.switching!.dhcp_snooping = true;

    expect(routeros.unsupported(mixed)).toEqual(
        expect.arrayContaining([
            `interfaces.ethernet.25g-5 without tpid 0x88a8, RouterOS has one TPID for every switched port and LAG, its bridge's ether-type, and interfaces.ethernet.25g-3 has 0x88a8: write tpid: "0x88a8" here too`,
            "switching.dhcp_snooping, not tested on a bridge with tpid 0x88a8 yet",
            "interfaces.ethernet.25g-5.stp false, not tested on a bridge with tpid 0x88a8 yet",
        ])
    );
});

test("RouterOS refuses an inner VLAN interface with a MAC, and a VLAN whose name another interface has", () => {
    const device = ccr("0x8100");
    device.interfaces!.vlan_interface!["cust-1001"]!.mac = "02:00:00:00:10:01";
    device.interfaces!.loopback = { "hall-2": { addresses: ["192.0.2.1/32"] } };

    expect(routeros.unsupported(device)).toEqual([
        "interfaces.vlan_interface.cust-1001.mac beside inner_vlan_id, not tested on a device yet",
        "switching.vlans.hall-2: RouterOS names the VLAN interface of its outer tag after the VLAN, and interfaces.loopback.hall-2 has that name. Rename one, or write a plain VLAN interface on hall-2",
    ]);

    const own = ccr("0x8100");
    own.switching!.vlans = { lo: { id: 600 }, servers: { id: 100 } };
    own.interfaces!.ethernet!["25g-3"] = { qinq_vlan: "lo" };
    own.interfaces!.ethernet!["25g-4"] = { trunk_vlans: ["lo", "servers"] };
    own.interfaces!.vlan_interface!["cust-1001"]!.vlan = "lo";
    expect(routeros.unsupported(own)).toEqual([
        "switching.vlans.lo: RouterOS names the VLAN interface of its outer tag after the VLAN, and RouterOS's own loopback has that name. Rename one, or write a plain VLAN interface on lo",
    ]);
});

test("Junos can't set the TPID on 21.4, VRP ends no inner VLAN, and no other platform builds either key yet", () => {
    const junos = provider("junos", "QFX5100-48S-6Q", ["10g-1", "10g-2"]);
    expect(Platforms.get("junos").unsupported(junos)).toEqual(
        expect.arrayContaining([
            "interfaces.ethernet.10g-1.tpid 0x88a8, which Junos 21.4 on a QFX5100 can't set: Juniper lists it from 22.4R1",
            "interfaces.vlan_interface.cust-1001.inner_vlan_id, which a QFX5100 doesn't route: Juniper supports two tags with family inet on no QFX5000 switch",
        ])
    );
    expect(Platforms.get("vrp").unsupported(provider("vrp", "CE6855-48S6Q-HI", ["10g-1", "10g-2"]))).toEqual(
        expect.arrayContaining([
            "interfaces.ethernet.10g-2.tpid, which only RouterOS builds for now",
            "interfaces.vlan_interface.cust-1001.inner_vlan_id, a VLAN interface on V200R005 ends no inner VLAN, and a sub-interface needs a routed port",
        ])
    );
    for (const [platform, model] of [
        ["raisecom-ros", "RAX721-C-6C48"],
        ["fortios", "FG-3700D"],
    ] as const) {
        const device = provider(platform, model, ["10g-1", "10g-2"]);
        expect(Platforms.get(platform).unsupported(device)).toEqual(
            expect.arrayContaining([
                "interfaces.ethernet.10g-2.tpid, which only RouterOS builds for now",
                "interfaces.vlan_interface.cust-1001.inner_vlan_id, which only RouterOS builds for now",
            ])
        );
    }
    // 802.1Q's TPID is every platform's own, so it writes nothing there.
    expect(Platforms.get("junos").unsupported(provider("junos", "QFX5100-48S-6Q", ["10g-1", "10g-2"], "0x8100"))).not.toContain(
        "interfaces.ethernet.10g-1.tpid 0x88a8, which Junos 21.4 on a QFX5100 can't set: Juniper lists it from 22.4R1"
    );
});

test("validate keeps a TPID to switched ports, and one VLAN interface to each inner VLAN", () => {
    const device = ccr();
    device.interfaces!.ethernet!["25g-5"] = { addresses: ["192.0.2.9/30"], tpid: "0x88a8" };
    device.interfaces!.ethernet!["25g-6"] = { in_lag: "uplink", tpid: "0x88a8" };
    device.interfaces!.lag = { uplink: { trunk_vlans: ["servers"], tpid: "0x88a8" } };
    device.interfaces!.vlan_interface!.again = { vlan: "hall-2", inner_vlan_id: 1001 };
    device.interfaces!.vlan_interface!.huge = { vlan: "hall-2", inner_vlan_id: 4095 };

    expect(messages([device])).toEqual(
        expect.arrayContaining([
            "interfaces.ethernet.25g-5.tpid is on a port that switches no VLAN: write it where access_vlan, trunk_vlans, or qinq_vlan is",
            "interfaces.ethernet.25g-6.tpid is on a member of uplink: write it on the LAG",
            "interfaces.vlan_interface.again ends inner VLAN 1001 of hall-2, as interfaces.vlan_interface.cust-1001 does: keep one",
            "interfaces.vlan_interface.huge.inner_vlan_id 4095 is outside 1-4094",
        ])
    );
    // An inner VLAN interface may end a customer's VLAN on a QinQ VLAN of its own device.
    expect(messages([ccr()])).toEqual([]);
});

test("validate wants the same TPID at both ends of a link", () => {
    const near = ccr();
    const far = ccr("0x8100");
    far.name = "sw-02";
    near.interfaces!.ethernet!["25g-4"]!.link = { device: "sw-02", port: "25g-4" };
    far.interfaces!.ethernet!["25g-4"]!.link = { device: "sw-01", port: "25g-4" };
    near.interfaces!.ethernet!["25g-4"]!.description = "sw-02 sfp28-4";
    far.interfaces!.ethernet!["25g-4"]!.description = "sw-01 sfp28-4";

    expect(messages([near, far])).toContain(
        "interfaces.ethernet.25g-4.link: interfaces.ethernet.25g-4 tags with TPID 0x88a8, and sw-02 interfaces.ethernet.25g-4 with 0x8100: write the same tpid at both ends"
    );
});
