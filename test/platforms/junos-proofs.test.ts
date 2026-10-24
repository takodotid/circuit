// What a QFX5100-48S-6Q on Junos 21.4R3 printed when each feature was proved on it, with names and addresses replaced.

import { expect, test } from "bun:test";
import aggregationSwitch from "../../examples/platforms/junos";
import { Platforms } from "../../src/platforms";
import { Junos } from "../../src/platforms/junos";
import type { Device } from "../../src/schema";

const platform = Platforms.get("junos");

// `show lldp neighbors detail | display xml`, trimmed of the TLVs Circuit does not read. 40G port 5 is `et-0/0/52`: the device counts from 0, after the 48 10G ports.
const LLDP_DETAIL = `<rpc-reply xmlns:junos="http://xml.juniper.net/junos/21.4R0/junos">
    <lldp-neighbors-information xmlns="http://xml.juniper.net/junos/21.4R0/lldp-mtx" junos:style="detail">
        <lldp-neighbor-information>
            <lldp-index>16</lldp-index>
            <lldp-ttl>120</lldp-ttl>
            <lldp-local-interface>et-0/0/52</lldp-local-interface>
            <lldp-local-parent-interface-name>-</lldp-local-parent-interface-name>
            <lldp-local-port-id>520</lldp-local-port-id>
            <lldp-local-port-ageout-count>0</lldp-local-port-ageout-count>
            <lldp-remote-chassis-id-subtype>Mac address</lldp-remote-chassis-id-subtype>
            <lldp-remote-chassis-id>02:00:00:00:00:01</lldp-remote-chassis-id>
            <lldp-remote-port-id-subtype>Interface name</lldp-remote-port-id-subtype>
            <lldp-remote-port-id>hundredgige1/1/4</lldp-remote-port-id>
            <lldp-remote-port-description>switch uplink</lldp-remote-port-description>
            <lldp-remote-system-name>Raisecom</lldp-remote-system-name>
            <lldp-system-description>
                <lldp-remote-system-description>Raisecom Operating System Software,RAX721-C-6C48,ROS,Copyright (c) 2006-2026 Raisecom Science &amp; Technology Development Co.,Ltd</lldp-remote-system-description>
            </lldp-system-description>
            <lldp-remote-management-address>192.0.2.10</lldp-remote-management-address>
        </lldp-neighbor-information>
    </lldp-neighbors-information>
    <cli>
        <banner>{master:0}</banner>
    </cli>
</rpc-reply>
`;

test("LLDP neighbors are read from the detail XML, on our port by Circuit's name", () => {
    expect(Junos.neighborsOf(aggregationSwitch, LLDP_DETAIL)).toEqual([
        { port: "40g-5", system: "Raisecom", remote_port: "hundredgige1/1/4" },
    ]);
});

test("a neighbor on a 10G cage holding a 1G optic is on that cage's port, and one without a system name is named by its chassis ID", () => {
    const xml = LLDP_DETAIL.replace("et-0/0/52", "ge-0/0/1").replace("<lldp-remote-system-name>Raisecom</lldp-remote-system-name>", "");

    expect(Junos.neighborsOf(aggregationSwitch, xml)).toEqual([
        { port: "10g-2", system: "02:00:00:00:00:01", remote_port: "hundredgige1/1/4" },
    ]);
});

// What the device printed after a commit of BFD on a static route, a multihop session and an OSPF interface: first with no timers, then with timers. Each plan after the apply was empty.
const BFD_DEFAULT = [
    "set routing-options static route 198.51.100.0/24 next-hop 192.0.2.1",
    "set routing-options static route 198.51.100.0/24 bfd-liveness-detection minimum-interval 300",
    "set protocols bgp group multihop-1 multihop",
    "set protocols bgp group multihop-1 bfd-liveness-detection minimum-interval 300",
    "set protocols ospf area 0.0.0.0 interface lo0.0 bfd-liveness-detection minimum-interval 300",
];

const BFD_TIMERS = [
    "set routing-options static route 198.51.100.0/24 bfd-liveness-detection minimum-interval 500",
    "set routing-options static route 198.51.100.0/24 bfd-liveness-detection multiplier 4",
    "set protocols bgp group multihop-1 bfd-liveness-detection minimum-interval 500",
    "set protocols bgp group multihop-1 bfd-liveness-detection multiplier 4",
    "set protocols ospf area 0.0.0.0 interface lo0.0 bfd-liveness-detection minimum-interval 500",
    "set protocols ospf area 0.0.0.0 interface lo0.0 bfd-liveness-detection multiplier 4",
];

const withBfd: Device = {
    ...aggregationSwitch,
    routing: {
        ...aggregationSwitch.routing,
        // The example sets timers of its own; this test is about the defaults.
        bfd: undefined,
        static: [...aggregationSwitch.routing!.static!, { prefix: "198.51.100.0/24", via: "192.0.2.1", bfd: true }],
        ospf: { areas: { "0.0.0.0": { interfaces: { loopback: { passive: true, bfd: true } } } } },
        bgp: {
            ...aggregationSwitch.routing!.bgp!,
            neighbors: {
                ...aggregationSwitch.routing!.bgp!.neighbors,
                "multihop-1": { address: "192.0.2.99", remote_as: 64512, multihop: true, bfd: true },
            },
        },
    },
};

test("BFD without timers renders every 300 ms, as the device printed it", () => {
    const rendered = platform.render(withBfd).split("\n");

    expect(rendered).toEqual(expect.arrayContaining(BFD_DEFAULT));
    expect(rendered.filter((line) => line.includes("bfd-liveness-detection multiplier"))).toEqual([]);
    expect(platform.unsupported(withBfd)).toEqual([]);
});

test("BFD timers render as the device printed them, and the plan from no timers changes only the timers", () => {
    const timed: Device = { ...withBfd, routing: { ...withBfd.routing, bfd: { interval: 500, multiplier: 4 } } };
    const rendered = platform.render(timed);

    expect(rendered.split("\n")).toEqual(expect.arrayContaining(BFD_TIMERS));
    expect(platform.unsupported(timed)).toEqual([]);

    const plan = platform.plan(rendered, platform.render(withBfd), { secrets: false, rollback: 10 });
    const sent = plan.steps.flatMap((step) => step.send);

    expect(sent.filter((line) => line.startsWith("set "))).toEqual(expect.arrayContaining(BFD_TIMERS));
    expect(sent.every((line) => line.includes("bfd-liveness-detection"))).toBe(true);
});

// What the device printed after a commit of a MAC limit and an ethertype filter on a switched port and on a LAG. The limit moves to the logical interface and splits in two.
const MAC_AND_ETHERTYPES = [
    "set interfaces xe-0/0/2 unit 0 family ethernet-switching filter input circuit-ethertypes-ipv4-ipv6-arp",
    "set interfaces ae1 unit 0 family ethernet-switching filter input circuit-ethertypes-ipv4-ipv6-arp",
    "set firewall family ethernet-switching filter circuit-ethertypes-ipv4-ipv6-arp term allowed from ether-type ipv4",
    "set firewall family ethernet-switching filter circuit-ethertypes-ipv4-ipv6-arp term allowed from ether-type ipv6",
    "set firewall family ethernet-switching filter circuit-ethertypes-ipv4-ipv6-arp term allowed from ether-type arp",
    "set firewall family ethernet-switching filter circuit-ethertypes-ipv4-ipv6-arp term allowed then accept",
    "set firewall family ethernet-switching filter circuit-ethertypes-ipv4-ipv6-arp term others then discard",
    "set switch-options interface xe-0/0/2.0 interface-mac-limit 1",
    "set switch-options interface xe-0/0/2.0 interface-mac-limit packet-action drop",
    "set switch-options interface ae1.0 interface-mac-limit 1",
    "set switch-options interface ae1.0 interface-mac-limit packet-action drop",
];

const filtered = { mac_limit: 1, ethertypes: ["arp", "ipv6", "ipv4"] } as const;

// The example without its own filtered port, so a removal deletes all of it.
const unfiltered: Device = {
    ...aggregationSwitch,
    ports: { ...aggregationSwitch.ports, "10g-2": { description: "Host on a 1G optic", access_vlan: "servers", speed: "1g", lldp: false } },
};

const withFilters: Device = {
    ...unfiltered,
    ports: { ...unfiltered.ports, "10g-3": { ...aggregationSwitch.ports!["10g-3"], ...filtered } },
    interfaces: {
        ...aggregationSwitch.interfaces,
        uplink: { ...aggregationSwitch.interfaces!.uplink!, ...filtered },
    } as Device["interfaces"],
};

test("a MAC limit and an ethertype filter render as the device printed them, and taking them away deletes them", () => {
    const rendered = platform.render(withFilters);

    expect(rendered.split("\n")).toEqual(expect.arrayContaining(MAC_AND_ETHERTYPES));
    expect(platform.unsupported(withFilters)).toEqual([]);

    const removal = platform.plan(platform.render(unfiltered), rendered, { secrets: false, rollback: 10 });
    const sent = removal.steps.flatMap((step) => step.send);

    expect(sent).toEqual(
        expect.arrayContaining([
            "delete switch-options",
            "delete firewall family ethernet-switching filter circuit-ethertypes-ipv4-ipv6-arp",
            "delete interfaces xe-0/0/2 unit 0 family ethernet-switching filter input",
            "delete interfaces ae1 unit 0 family ethernet-switching filter input",
        ])
    );
});

test("a MAC limit or an ethertype filter is refused where the switching family cannot hold it", () => {
    const device: Device = {
        ...aggregationSwitch,
        ports: {
            ...aggregationSwitch.ports,
            "10g-1": { ...aggregationSwitch.ports!["10g-1"], ethertypes: ["ipv4"] },
            "10g-48": { ...aggregationSwitch.ports!["10g-48"], mac_limit: 1 },
            "40g-1": { ...aggregationSwitch.ports!["40g-1"], mac_limit: 1 },
        },
    };

    expect(platform.unsupported(device)).toEqual(
        expect.arrayContaining([
            "ports.10g-1.ethertypes with an acl, the port takes one filter",
            "ports.10g-48.mac_limit, on a port or LAG that switches no VLAN",
            "ports.40g-1.mac_limit, on a LAG member: set it on the LAG",
        ])
    );
});

// The device sends a port's SNMP index, `520`, as its LLDP port ID until told otherwise; after this line a Raisecom neighbor read `PortIdSubtype: ifName` and `PortId: et-0/0/52`.
const PORT_ID_BY_NAME = "set protocols lldp port-id-subtype interface-name";

test("a device running LLDP sends each port's name as its port ID, and one without LLDP drops it with the rest", () => {
    const { lldp: _lldp, ...withoutLldp } = aggregationSwitch;
    const onOnePort: Device = { ...withoutLldp, ports: { ...withoutLldp.ports, "10g-3": { ...withoutLldp.ports!["10g-3"], lldp: true } } };

    expect(platform.render(aggregationSwitch).split("\n")).toContain(PORT_ID_BY_NAME);
    expect(platform.render(onOnePort).split("\n")).toContain(PORT_ID_BY_NAME);
    expect(platform.render(withoutLldp)).not.toContain("port-id-subtype");

    const removal = platform.plan(platform.render(withoutLldp), platform.render(aggregationSwitch), { secrets: false, rollback: 10 });
    // The example keeps LLDP off on one port, so the plan deletes only what goes.
    expect(removal.steps.flatMap((step) => step.send)).toEqual([
        "delete protocols lldp port-id-subtype",
        "delete protocols lldp interface all",
    ]);
});
