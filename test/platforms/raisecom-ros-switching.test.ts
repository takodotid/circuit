// Private VLANs, VLAN translation, the service tag, and hardware ACLs, as a RAX721 on ROS 6.5.2 printed them on spare ports (tako-mmr-01, 2026-11-27, #417).

import { expect, test } from "bun:test";
import { Platforms } from "../../src/platforms";
import type { Device } from "../../src/model";
import { Fixtures } from "../fixtures";

const platform = Platforms.get("raisecom-ros");
const core = Fixtures.device("platforms--example-core-switch");

const tested = {
    ...core,
    switching: {
        ...core.switching,
        vlans: {
            ...core.switching?.vlans,
            primary: { id: 3990 },
            isolated: { id: 3991, private_vlan: { primary: "primary", type: "isolated" } },
            community: { id: 3992, private_vlan: { primary: "primary", type: "community" } },
            other: { id: 3993, private_vlan: { primary: "primary", type: "community" } },
            translated: { id: 3994 },
        },
        acls: {
            edge: [
                { if: { protocol: "tcp", src: "192.0.2.0/24", dst_port: [80, 443] }, then: "accept" },
                { if: { src: "192.0.2.0/24" }, then: "drop" },
                { if: { protocol: "udp", src_port: 53, dst: "198.51.100.1", dst_port: 53 }, then: "accept" },
                { if: { protocol: "esp" }, then: "drop" },
                { if: { protocol: "ah", family: "ipv4" }, then: "drop" },
                { if: { protocol: "gre", family: "ipv6" }, then: "drop" },
                { if: { protocol: "ospf" }, then: "accept" },
                { if: { protocol: "vrrp" }, then: "accept" },
                { if: { protocol: "icmp" }, then: "accept" },
                { if: { protocol: "tcp", src: "2001:db8::/32", dst_port: 443 }, then: "accept" },
                { if: { src: "2001:db8::/32" }, then: "drop" },
            ],
        },
    },
    interfaces: {
        ...core.interfaces,
        ethernet: {
            "10g-9": { description: "community", access_vlan: "community" },
            "10g-10": {
                description: "trunk",
                trunk_vlans: ["primary", "translated"],
                vlan_translation: [{ from: 3995, to: "translated" }],
                tpid: "0x88a8",
                ingress_acl: "edge",
            },
            "10g-11": { description: "promiscuous", access_vlan: "primary" },
            "10g-12": { description: "isolated", access_vlan: "isolated" },
        },
    },
} as Device;

/** How the switch printed them, cut to the test's blocks. */
const PRINTED = `create vlan 10,20,200,999,3990-3994 active
private-vlan primary vlan 3990
private-vlan isolated vlan 3991
private-vlan community vlan 3992-3993
private-vlan association 3990 3991-3993
!
access-list 2001 name edge-v4
  rule 10 permit tcp 192.0.2.0 255.255.255.0 any 80
  rule 20 permit tcp 192.0.2.0 255.255.255.0 any 443
  rule 30 deny ip 192.0.2.0 255.255.255.0 any
  rule 40 permit udp any 53 198.51.100.1 255.255.255.255 53
  rule 50 deny 50 any any
  rule 60 deny 51 any any
  rule 70 permit 89 any any
  rule 80 permit 112 any any
  rule 90 permit icmp any any
  rule 65535 permit ip any any
!
access-list 7001 name edge-v6
  rule 10 deny 50 any any
  rule 20 deny 47 any any
  rule 30 permit 89 any any
  rule 40 permit 112 any any
  rule 50 permit icmpv6 any any
  rule 60 permit tcp 2001:DB8::/32 any 443
  rule 70 deny ipv6 2001:DB8::/32 any
  rule 65535 permit ipv6 any any
!
interface tengigabitethernet 1/3/9
portswitch
description community
switchport access vlan 3992
switchport mode private-vlan host
switchport private-vlan host-association 3990 3992
!
interface tengigabitethernet 1/3/10
portswitch
description trunk
tpid 88a8
switchport trunk allowed vlan 3990,3994
switchport mode trunk
filter ingress access-list 2001
filter ingress access-list 7001
switchport vlan-mapping both outer 3995 translate 3994
switchport private-vlan mapping 3990 3991-3993
!
interface tengigabitethernet 1/3/11
portswitch
description promiscuous
switchport access vlan 3990
switchport mode private-vlan promiscuous
switchport private-vlan mapping 3990 3991-3993
!
interface tengigabitethernet 1/3/12
portswitch
description isolated
switchport access vlan 3991
switchport mode private-vlan host
speed auto
duplex auto
switchport private-vlan host-association 3990 3991
!
`;

/** The render's lines for the same blocks: the VLANs and private VLANs, the lists, and the four ports. */
const blocks = (config: string) =>
    config
        .split("!\n")
        .filter((block) => /^(create vlan|access-list [27]001|interface tengigabitethernet 1\/3\/(9|1[012]))\b/.test(block.trimStart()))
        .map((block) => `${block.trimStart()}!\n`)
        .join("");

const sent = (desired: string, current: string) =>
    platform.plan(desired, current, { secrets: false, rollback: 0 }).steps.flatMap((step) => step.send);

test("private VLANs, VLAN translation, the service tag, and an ACL render as the switch printed them", () => {
    expect(platform.unsupported(tested)).toEqual([]);
    expect(platform.experimental?.(tested)).toEqual([
        "switching.vlans.isolated.private_vlan",
        "switching.vlans.community.private_vlan",
        "switching.vlans.other.private_vlan",
    ]);

    const rendered = blocks(platform.render(tested));
    expect(rendered).toContain("private-vlan community vlan 3992-3993\n");
    expect(rendered).toContain("access-list 7001 name edge-v6\n");
    expect(sent(rendered, blocks(PRINTED))).toEqual([]);
});

test("a gone private VLAN goes after its ports, its secondaries first, and its VLANs last", () => {
    const steps = sent(blocks(platform.render(core)).replace(/\n$/, ""), blocks(PRINTED));

    const port = steps.indexOf("no switchport private-vlan host-association");
    expect(port).toBeGreaterThanOrEqual(0);
    expect(steps.slice(steps.indexOf("no access-list 7001"))).toEqual([
        "no access-list 7001",
        "no access-list 2001",
        "no private-vlan association 3990",
        "no private-vlan community vlan 3992-3993",
        "no private-vlan isolated vlan 3991",
        "no private-vlan primary vlan 3990",
        "no vlan 3990",
        "no vlan 3991",
        "no vlan 3992",
        "no vlan 3993",
        "no vlan 3994",
    ]);
    expect(steps).toContain("no switchport vlan-mapping both outer 3995");
    expect(steps).toContain("no tpid");
    expect(steps).toContain("switchport mode access");
});

test("a changed ACL lets its port go first, and a host moves to another community in place", () => {
    const changed = {
        ...tested,
        switching: { ...tested.switching, acls: { edge: tested.switching!.acls!.edge!.filter((rule) => rule.if?.protocol !== "vrrp") } },
        interfaces: {
            ...tested.interfaces,
            ethernet: { ...tested.interfaces!.ethernet, "10g-9": { description: "community", access_vlan: "other" } },
        },
    } as Device;

    const steps = sent(blocks(platform.render(changed)), blocks(PRINTED));
    expect(steps.slice(0, 3)).toEqual(["interface tengigabitethernet 1/3/10", "no filter ingress access-list 2001", "exit"]);
    expect(steps).toContain("switchport private-vlan host-association 3990 3993");
    expect(steps).not.toContain("no switchport private-vlan host-association");
});

test("a rule that repeats an earlier match is left out, and so is the last rule when one already matches everything", () => {
    const device = {
        ...tested,
        switching: {
            ...tested.switching,
            acls: {
                edge: [
                    { if: { family: "ipv4" }, then: "drop" },
                    { if: { family: "ipv4" }, then: "accept" },
                ],
            },
        },
    } as Device;

    expect(platform.render(device)).toContain("access-list 2001 name edge-v4\n  rule 10 deny ip any any\n!\n");
});

test("what the switch can't do is refused, with why", () => {
    const device = {
        ...tested,
        switching: {
            ...tested.switching,
            ra_guard: true,
            acls: {
                edge: [{ description: "web", if: { protocol: "tcp", dst_port: { min: 80, max: 90 }, vlan: "primary" }, then: "accept" }],
            },
        },
        interfaces: {
            ...tested.interfaces,
            bridge: { lan: { member_interfaces: [] } },
            ethernet: {
                ...tested.interfaces!.ethernet,
                "10g-1": { access_vlan: "translated", bound_to: [{ mac: "02:00:00:00:00:01", addresses: ["192.0.2.10"] }] },
                "10g-2": { ingress_acl: "edge" },
            },
            lag: { uplink: { trunk_vlans: ["translated"], tpid: "0x88a8", vlan_translation: [{ from: 3995, to: "translated" }] } },
            vlan_interface: { customer: { vlan: "translated", inner_vlan_id: 100 } },
        },
        routing: undefined,
    } as Device;

    expect(platform.unsupported(device)).toEqual([
        "interfaces.bridge.lan, the switch has no bridge interface",
        "switching.ra_guard, ROS 6.5.2 has no RA guard: its ND snooping checks router solicitations, not advertisements",
        "interfaces.ethernet.10g-1.bound_to, IP source guard here is one setting for the whole switch, which drops IP on every other port unless it is trusted, and checks no ARP: not tried on a switch in service",
        "interfaces.lag.uplink.vlan_translation, tested on a port alone",
        "interfaces.lag.uplink.tpid, the switch sets a TPID on a port alone",
        "interfaces.vlan_interface.customer.inner_vlan_id, a VLAN interface here is on one VLAN ID",
        "switching.acls.edge[0].description, a rule here takes no description",
        "switching.acls.edge[0].if.vlan, an IP list on the switch matches no VLAN",
        "switching.acls.edge[0].if.dst_port, a rule here matches one port: write each port",
        "interfaces.ethernet.10g-2.ingress_acl on a port that does not switch, tested on switched ports alone",
    ]);
});

test("ARP inspection trusts the ports DHCP snooping trusts, and turns on after them", () => {
    const device = {
        ...core,
        switching: { ...core.switching, dhcp_snooping: true, arp_inspection: true },
        interfaces: { ...core.interfaces, ethernet: { "10g-12": { access_vlan: "servers", dhcp_trusted: true } } },
    } as Device;

    const rendered = platform.render(device);
    expect(rendered).toContain("ip arp-inspection trust\nip dhcp snooping trust\n");
    expect(platform.experimental?.(device)).toContain("switching.arp_inspection");

    const steps = sent(rendered, platform.render(core));
    const on = steps.indexOf("ip dhcp snooping");
    expect(steps[on + 1]).toBe("ip arp-inspection dhcp-snooping");
    expect(steps.indexOf("ip arp-inspection trust")).toBeLessThan(on);
});

test("a QinQ port takes the service tag too, as a spare port took `tpid 88a8` beside `dot1q-tunnel`", () => {
    const device = {
        ...core,
        interfaces: { ...core.interfaces, ethernet: { "10g-12": { qinq_vlan: "servers", tpid: "0x88a8" } } },
        routing: undefined,
    } as Device;

    expect(platform.unsupported(device)).toEqual([]);
    expect(platform.render(device)).toContain("interface tengigabitethernet 1/3/12\nswitchport access vlan 20\ndot1q-tunnel\ntpid 88a8\n!");
});
