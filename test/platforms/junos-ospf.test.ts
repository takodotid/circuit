// OSPF's ranges, priorities, NBMA and point-to-multipoint links, and virtual links on Junos, which passed `commit check` in a private candidate on a QFX5100 with Junos 21.4R3-S8.5. Each was set, changed, and taken away there, and the plan against what the candidate printed was empty each time. Nothing was committed. The lines it printed are fed to the adapter, with names and addresses replaced.

import { expect, test } from "bun:test";
import type { Device, Ospf } from "../../src/model";
import { Platforms } from "../../src/platforms";
import { Fixtures } from "../fixtures";

const junos = Platforms.get("junos");
const options = { secrets: false, rollback: 10 };

/** The aggregation switch with only this OSPF. */
function withOspf(ospf: Ospf): Device {
    const device = Fixtures.device("platforms--example-aggregation-switch");
    return { ...device, routing: { ...device.routing, ospf } };
}

const sent = (desired: string, current: string) => junos.plan(desired, current, options).steps.flatMap((step) => step.send);

/** A border router whose transit port is NBMA to a carrier's service, joined to the backbone across area 1 too, and whose area 1 is summed up. Its tunnel is point-to-multipoint and finds its neighbors itself. */
const designed: Ospf = {
    areas: {
        "0.0.0.0": {
            virtual_links: [{ transit_area_id: "0.0.0.1", router_id: "192.0.2.1" }],
            interfaces: { "10g-48": { network: "non-broadcast", priority: 0, neighbors: ["198.51.100.4"] } },
        },
        "0.0.0.1": {
            ranges: [
                { prefix: "198.51.100.64/26", advertise: true, cost: 100 },
                { prefix: "203.0.113.0/24", advertise: false },
            ],
            interfaces: { management: { priority: 200 }, tunnel: { network: "point-to-multipoint" } },
        },
    },
};

/** `designed` as the candidate printed it, in the switch's order: the virtual link first, then the interfaces of the backbone. */
const DESIGNED_PRINTED = `set protocols ospf area 0.0.0.0 virtual-link neighbor-id 192.0.2.1 transit-area 0.0.0.1
set protocols ospf area 0.0.0.0 interface xe-0/0/47.0 interface-type nbma
set protocols ospf area 0.0.0.0 interface xe-0/0/47.0 priority 0
set protocols ospf area 0.0.0.0 interface xe-0/0/47.0 neighbor 198.51.100.4 eligible
set protocols ospf area 0.0.0.1 area-range 198.51.100.64/26 override-metric 100
set protocols ospf area 0.0.0.1 area-range 203.0.113.0/24 restrict
set protocols ospf area 0.0.0.1 interface irb.10 priority 200
set protocols ospf area 0.0.0.1 interface gr-0/0/0.0 interface-type p2mp
set protocols ospf area 0.0.0.1 interface gr-0/0/0.0 dynamic-neighbors`;

/** A render with its OSPF statements as the candidate printed them. */
const printed = (desired: string, ospf: string) =>
    [
        ...desired
            .split("\n")
            .filter((line) => line && !line.startsWith("set protocols ospf ") && !line.startsWith("set protocols ospf3 ")),
        ospf,
    ].join("\n");

test("Junos writes ranges, priorities, NBMA and point-to-multipoint links, and a virtual link, experimentally, and plans nothing against how the switch printed them", () => {
    const device = withOspf(designed);
    const desired = junos.render(device);

    for (const line of DESIGNED_PRINTED.split("\n")) expect(desired).toContain(line);
    expect(sent(desired, printed(desired, DESIGNED_PRINTED))).toEqual([]);

    expect(junos.unsupported(device).filter((gap) => gap.startsWith("routing.ospf"))).toEqual([]);
    expect(junos.experimental!(device)).toEqual(
        expect.arrayContaining([
            "routing.ospf.areas.0.0.0.0.virtual_links",
            "routing.ospf.areas.0.0.0.0.interfaces.10g-48.priority",
            "routing.ospf.areas.0.0.0.0.interfaces.10g-48.network non-broadcast",
            "routing.ospf.areas.0.0.0.0.interfaces.10g-48.neighbors",
            "routing.ospf.areas.0.0.0.1.ranges",
            "routing.ospf.areas.0.0.0.1.interfaces.management.priority",
            "routing.ospf.areas.0.0.0.1.interfaces.tunnel.network point-to-multipoint",
        ])
    );
});

test("Junos deletes a virtual link by its whole key and a range by its prefix, and takes a flag off a range or a neighbor alone", () => {
    const changed: Ospf = {
        areas: {
            "0.0.0.0": {
                virtual_links: [{ transit_area_id: "0.0.0.1", router_id: "192.0.2.2" }],
                interfaces: { "10g-48": { network: "point-to-multipoint", neighbors: ["198.51.100.4"] } },
            },
            "0.0.0.1": {
                ranges: [
                    { prefix: "198.51.100.64/26", advertise: true, cost: 200 },
                    { prefix: "203.0.113.0/24", advertise: true },
                ],
                interfaces: { management: {}, tunnel: { network: "point-to-multipoint", neighbors: ["192.0.2.66"] } },
            },
        },
    };
    const desired = junos.render(withOspf(designed));

    // `delete ... virtual-link` and `delete ... virtual-link neighbor-id 192.0.2.1` are syntax errors, and so is `delete ... area-range`.
    expect(sent(junos.render(withOspf(changed)), printed(desired, DESIGNED_PRINTED))).toEqual([
        "delete protocols ospf area 0.0.0.0 virtual-link neighbor-id 192.0.2.1 transit-area 0.0.0.1",
        "delete protocols ospf area 0.0.0.0 interface xe-0/0/47.0 interface-type nbma",
        "delete protocols ospf area 0.0.0.0 interface xe-0/0/47.0 priority",
        "delete protocols ospf area 0.0.0.0 interface xe-0/0/47.0 neighbor 198.51.100.4 eligible",
        "delete protocols ospf area 0.0.0.1 area-range 198.51.100.64/26 override-metric 100",
        "delete protocols ospf area 0.0.0.1 area-range 203.0.113.0/24 restrict",
        "delete protocols ospf area 0.0.0.1 interface irb.10 priority",
        "delete protocols ospf area 0.0.0.1 interface gr-0/0/0.0 dynamic-neighbors",
        "set protocols ospf area 0.0.0.0 virtual-link neighbor-id 192.0.2.2 transit-area 0.0.0.1",
        "set protocols ospf area 0.0.0.0 interface xe-0/0/47.0 interface-type p2mp",
        "set protocols ospf area 0.0.0.0 interface xe-0/0/47.0 neighbor 198.51.100.4",
        "set protocols ospf area 0.0.0.1 area-range 198.51.100.64/26 override-metric 200",
        "set protocols ospf area 0.0.0.1 area-range 203.0.113.0/24",
        "set protocols ospf area 0.0.0.1 interface irb.10",
        "set protocols ospf area 0.0.0.1 interface gr-0/0/0.0 neighbor 192.0.2.66",
    ]);

    const without: Ospf = { areas: { "0.0.0.1": { interfaces: { management: {} } } } };
    expect(sent(junos.render(withOspf(without)), printed(desired, DESIGNED_PRINTED))).toEqual([
        "delete protocols ospf area 0.0.0.0",
        "delete protocols ospf area 0.0.0.1 area-range 198.51.100.64/26",
        "delete protocols ospf area 0.0.0.1 area-range 203.0.113.0/24",
        "delete protocols ospf area 0.0.0.1 interface irb.10 priority",
        "delete protocols ospf area 0.0.0.1 interface gr-0/0/0.0",
        "set protocols ospf area 0.0.0.1 interface irb.10",
    ]);
});

test("Junos sends each range to the OSPF version of its family, and a virtual link and a priority to both, in a VRF too", () => {
    const both: Ospf = {
        vrf: "guests",
        address_families: ["ipv4", "ipv6"],
        areas: {
            "0.0.0.0": {
                virtual_links: [{ transit_area_id: "0.0.0.1", router_id: "192.0.2.1" }],
                interfaces: { guests: { priority: 20 } },
            },
            "0.0.0.1": {
                ranges: [
                    { prefix: "198.51.100.0/24", advertise: true, cost: 100 },
                    { prefix: "2001:db8:b::/48", advertise: true, cost: 100 },
                    { prefix: "2001:db8:c::/48", advertise: false },
                ],
                interfaces: {},
            },
        },
    };
    const ospf = junos
        .render(withOspf(both))
        .split("\n")
        .filter((line) => line.startsWith("set routing-instances guests protocols ospf"));

    // As the candidate printed them, in a virtual-router instance.
    expect(ospf).toEqual([
        "set routing-instances guests protocols ospf area 0.0.0.0 virtual-link neighbor-id 192.0.2.1 transit-area 0.0.0.1",
        "set routing-instances guests protocols ospf area 0.0.0.0 interface irb.30 priority 20",
        "set routing-instances guests protocols ospf area 0.0.0.1 area-range 198.51.100.0/24 override-metric 100",
        "set routing-instances guests protocols ospf3 area 0.0.0.0 virtual-link neighbor-id 192.0.2.1 transit-area 0.0.0.1",
        "set routing-instances guests protocols ospf3 area 0.0.0.0 interface irb.30 priority 20",
        "set routing-instances guests protocols ospf3 area 0.0.0.1 area-range 2001:db8:b::/48 override-metric 100",
        "set routing-instances guests protocols ospf3 area 0.0.0.1 area-range 2001:db8:c::/48 restrict",
    ]);
});

test("Junos refuses a range's cost of 0, which the switch refuses", () => {
    const free: Ospf = { areas: { "0.0.0.1": { ranges: [{ prefix: "198.51.100.64/26", advertise: true, cost: 0 }], interfaces: {} } } };
    expect(junos.unsupported(withOspf(free))).toContain(
        "routing.ospf.areas.0.0.0.1.ranges[0].cost 0, Junos announces a range at a cost from 1: write 1 or more"
    );
});
