// VRP's layer 2 security and tagging, as a CE6855 on V200R005C00SPC800 printed them after `commit trial`. It ran on spare port 10GE1/0/48, a LAG of it, and new VLANs no other port carries. The plan after each was empty, and a change and the removal went into a candidate. No packet crossed the port, so each is experimental.

import { expect, test } from "bun:test";
import type { Device, Lag, Port } from "../../src/model";
import { Vrp } from "../../src/platforms/vrp/index";

const vrp = new Vrp();
const options = { secrets: false, rollback: 10 };
const plan = (desired: string, current: string) => vrp.plan(desired, current, options).steps;
const sent = (desired: string, current: string) => plan(desired, current).flatMap((step) => step.send);

/** A switch with VLANs 3981 to 3986, spare port 10g-48, and the ports and LAGs given. */
function device(ethernet: Record<string, Port>, lag: Record<string, Lag> = {}, switching: Device["switching"] = {}): Device {
    return {
        name: "sw-01",
        site: "dc-1",
        platform: "vrp",
        model: "CE6855-48S6Q-HI",
        connection: { host: "192.0.2.1", user: "operator" },
        switching: {
            stp: {},
            vlans: {
                "ctest-a": { id: 3981 },
                "ctest-b": { id: 3982 },
                "ctest-p": { id: 3983 },
                "ctest-i": { id: 3984 },
                "ctest-c1": { id: 3985 },
                "ctest-c2": { id: 3986 },
            },
            ...switching,
        },
        interfaces: { ethernet, lag },
    } as Device;
}

test("VRP binds a port to its hosts with a static MAC address, IP source guard for IPv4, and an ACL6 for IPv6, as a CE6855 printed them", () => {
    const host = { mac: "02:00:00:00:00:0A", addresses: ["192.0.2.10", "198.51.100.0/30", "2001:db8:3981::10"] } as const;
    const bound = device({ "10g-48": { access_vlan: "ctest-a", ethertypes: ["ipv4", "ipv6", "arp"], bound_to: [host] } });
    const desired = vrp.render(bound);

    for (const part of [
        "acl ipv6 name bound-10g-48 advance\n rule 5 permit ipv6 source 2001:DB8:3981::10/128\n rule 10 permit ipv6 source FE80::/10\n rule 15 permit ipv6 source ::/128\n rule 20 deny ipv6\n#\n",
        "user-bind static ip-address 192.0.2.10 mac-address 0200-0000-000a interface 10GE1/0/48 vlan 3981\n",
        "user-bind static ip-address 198.51.100.3 mac-address 0200-0000-000a interface 10GE1/0/48 vlan 3981\n",
        "mac-address static 0200-0000-000a 10GE1/0/48 vlan 3981\n",
        " mac-address learning disable action discard\n ip source check user-bind enable\n traffic-filter ipv6 acl bound-10g-48 inbound\n",
    ])
        expect(desired).toContain(part);
    expect(desired.match(/^user-bind static /gm)).toHaveLength(5);
    expect(vrp.unsupported(bound)).toEqual([]);
    expect(vrp.experimental(bound)).toEqual(["interfaces.ethernet.10g-48.bound_to"]);
    expect(sent(desired, desired)).toEqual([]);

    // The switch takes a static MAC address only for a port already in its VLAN, and a binding only to a LAG that exists.
    const added = plan(desired, vrp.render(device({}))).map((step) => step.title);
    expect(added.slice(-2)).toEqual(["interface 10GE1/0/48", "Hosts of bound ports"]);

    // The hosts go first, and learning is turned on by its keyword: with `action discard`, `Too many parameters`.
    const removed = plan(vrp.render(device({})), desired);
    expect(removed[0]!.title).toBe("Hosts of bound ports, removed");
    expect(removed[0]!.send).toContain("undo mac-address static 0200-0000-000a 10GE1/0/48 vlan 3981");
    expect(removed[0]!.send).toContain(
        "undo user-bind static ip-address 192.0.2.10 mac-address 0200-0000-000a interface 10GE1/0/48 vlan 3981"
    );
    expect(removed.flatMap((step) => step.send)).toContain("undo mac-address learning disable");
});

test("VRP binds a LAG to its hosts by its Eth-Trunk", () => {
    const hosts = [
        { mac: "02:00:00:00:00:01", addresses: ["192.0.2.11"] },
        { mac: "02:00:00:00:00:02", addresses: ["192.0.2.12"] },
    ] as const;
    const bound = device({ "10g-48": { in_lag: "ctest-lag" } }, { "ctest-lag": { id: 39, access_vlan: "ctest-a", bound_to: hosts } });
    const desired = vrp.render(bound);

    expect(desired).toContain("user-bind static ip-address 192.0.2.12 mac-address 0200-0000-0002 interface Eth-Trunk39 vlan 3981\n");
    expect(desired).toContain("mac-address static 0200-0000-0001 Eth-Trunk39 vlan 3981\n");
    expect(desired).toContain(
        "interface Eth-Trunk39\n mode lacp-static\n port default vlan 3981\n mac-address learning disable action discard\n"
    );
    expect(vrp.unsupported(bound)).toEqual([]);
    expect(sent(desired, desired)).toEqual([]);
});

test("VRP inspects ARP in the view of each VLAN, as a CE6855 printed it", () => {
    const inspected = device(
        { "10g-48": { access_vlan: "ctest-a", dhcp_trusted: true } },
        {},
        { dhcp_snooping: true, arp_inspection: true }
    );
    const desired = vrp.render(inspected);

    expect(desired).toContain("vlan 3981\n name ctest-a\n arp anti-attack check user-bind enable\n#\n");
    expect(desired.match(/^ arp anti-attack check user-bind enable$/gm)).toHaveLength(6);
    expect(vrp.unsupported(inspected)).toEqual([]);
    expect(vrp.experimental(inspected)).toEqual([
        "switching.dhcp_snooping",
        "switching.arp_inspection",
        "interfaces.ethernet.10g-48.dhcp_trusted",
    ]);
    expect(sent(desired, desired)).toEqual([]);
});

test("VRP builds a private VLAN as a MUX VLAN on access ports, as a CE6855 printed it", () => {
    const vlans = {
        "ctest-a": { id: 3981 },
        "ctest-p": { id: 3983 },
        "ctest-i": { id: 3984, private_vlan: { primary: "ctest-p", type: "isolated" } },
        "ctest-c1": { id: 3985, private_vlan: { primary: "ctest-p", type: "community" } },
        "ctest-c2": { id: 3986, private_vlan: { primary: "ctest-p", type: "community" } },
    } as const;
    const muxed = device({ "10g-47": { access_vlan: "ctest-p" }, "10g-48": { access_vlan: "ctest-i" } }, {}, { vlans });
    const desired = vrp.render(muxed);

    expect(desired).toContain("vlan 3983\n name ctest-p\n mux-vlan\n subordinate separate 3984\n subordinate group 3985 to 3986\n#\n");
    expect(desired).toContain("interface 10GE1/0/47\n port default vlan 3983\n port mux-vlan enable vlan 3983\n");
    expect(desired).toContain("interface 10GE1/0/48\n port default vlan 3984\n port mux-vlan enable vlan 3984\n");
    expect(vrp.unsupported(muxed)).toEqual([]);
    expect(vrp.experimental(muxed)).toEqual([
        "switching.vlans.ctest-i.private_vlan",
        "switching.vlans.ctest-c1.private_vlan",
        "switching.vlans.ctest-c2.private_vlan",
    ]);
    expect(sent(desired, desired)).toEqual([]);

    // The switch refuses `port mux-vlan enable` until the VLAN is a MUX VLAN, and a MUX VLAN lists its secondary VLANs.
    const titles = plan(desired, vrp.render(device({}))).map((step) => step.title);
    expect(titles.indexOf("vlan 3983")).toBeGreaterThan(titles.indexOf("vlan 3986"));
    expect(titles.indexOf("interface 10GE1/0/48")).toBeGreaterThan(titles.indexOf("vlan 3983"));

    const trunked = device(
        { "10g-48": { trunk_vlans: ["ctest-p"], mac_limit: 1 }, "10g-47": { access_vlan: "ctest-c1", mac_limit: 1 } },
        {},
        { vlans }
    );
    expect(vrp.unsupported(trunked)).toEqual([
        "interfaces.ethernet.10g-48.trunk_vlans ctest-p, a private VLAN on a trunk: VRP builds it as a MUX VLAN on access ports only, as how a trunk carries one is not known",
        "interfaces.ethernet.10g-47.mac_limit in a private VLAN, which a MAC limit breaks on VRP",
    ]);

    const inspected = device({ "10g-48": { access_vlan: "ctest-i" } }, {}, { vlans, dhcp_snooping: true, arp_inspection: true });
    expect(vrp.unsupported(inspected)).toContain(
        "switching.vlans.ctest-i.private_vlan beside switching.arp_inspection, as the switch takes no VLAN that inspects ARP into a MUX VLAN"
    );
});

test("VRP changes and removes a MUX VLAN in the order a CE6855 took", () => {
    const isolated = { primary: "ctest-p", type: "isolated" } as const;
    const community = { primary: "ctest-p", type: "community" } as const;
    const vlans = {
        "ctest-p": { id: 3983 },
        "ctest-i": { id: 3984, private_vlan: isolated },
        "ctest-c1": { id: 3985, private_vlan: community },
        "ctest-c2": { id: 3986, private_vlan: community },
    };
    const muxed = vrp.render(device({ "10g-48": { access_vlan: "ctest-i" } }, {}, { vlans }));

    // A port leaves its VLAN of the MUX VLAN before it joins another, and a new community joins the list.
    const moved = device(
        { "10g-48": { access_vlan: "ctest-c1" } },
        {},
        { vlans: { ...vlans, "ctest-c3": { id: 3987, private_vlan: community } } }
    );
    expect(sent(vrp.render(moved), muxed)).toEqual([
        "interface 10GE1/0/48",
        "undo port mux-vlan enable vlan 3984",
        "quit",
        "vlan 3987",
        "name ctest-c3",
        "quit",
        "vlan 3983",
        "subordinate group 3987",
        "quit",
        "vlan batch 3987",
        "interface 10GE1/0/48",
        "port default vlan 3985",
        "port mux-vlan enable vlan 3985",
        "quit",
    ]);

    // A community that goes takes its place in the list with it.
    const { "ctest-c2": _gone, ...fewer } = vlans;
    expect(sent(vrp.render(device({ "10g-48": { access_vlan: "ctest-i" } }, {}, { vlans: fewer })), muxed)).toEqual([
        "undo vlan batch 3986",
    ]);

    // The port leaves first, then the subordinate VLANs go, then the MUX VLAN.
    expect(sent(vrp.render(device({}, {}, { vlans: { "ctest-a": { id: 3981 } } })), muxed).slice(0, 5)).toEqual([
        "interface 10GE1/0/48",
        "undo port mux-vlan enable vlan 3984",
        "quit",
        "undo vlan batch 3984 to 3986",
        "undo vlan batch 3983",
    ]);

    // A LAG that goes leaves first too.
    const lag = vrp.render(device({ "10g-48": { in_lag: "ctest-lag" } }, { "ctest-lag": { id: 39, access_vlan: "ctest-p" } }, { vlans }));
    expect(plan(vrp.render(device({}, {}, { vlans: { "ctest-a": { id: 3981 } } })), lag)[0]).toEqual({
        title: "interface Eth-Trunk39, out of its MUX VLAN",
        show: ["- port mux-vlan enable vlan 3983"],
        send: ["interface Eth-Trunk39", "undo port mux-vlan enable vlan 3983", "quit"],
    });
});

test("VRP refuses what a bound port can't hold, and says why", () => {
    const hosts = [
        { mac: "02:00:00:00:00:01", addresses: ["192.0.2.11", "2001:db8:3981::11", "10.0.0.0/23"] },
        { mac: "02:00:00:00:00:02", addresses: ["192.0.2.12"] },
    ] as const;
    const bound = device(
        { "10g-48": { access_vlan: "ctest-a", bound_to: hosts, mac_limit: 2, ingress_acl: "servers" } },
        {},
        { acls: { servers: [{ if: { src: "2001:db8::/32" }, then: "drop" }] } }
    );

    expect(vrp.unsupported(bound)).toEqual([
        "interfaces.ethernet.10g-48.bound_to, IPv6 addresses on a port of more than one host: V200R005 ties no IPv6 address to a MAC address, so bind one host",
        "interfaces.ethernet.10g-48.bound_to[0].addresses 10.0.0.0/23, over 256 addresses: the switch binds each address on a line of its own",
        "interfaces.ethernet.10g-48.mac_limit beside bound_to, as a bound port learns no MAC address",
        "interfaces.ethernet.10g-48.ingress_acl with IPv6 rules beside bound_to, as the port takes one ACL6, its hosts'",
    ]);
});
