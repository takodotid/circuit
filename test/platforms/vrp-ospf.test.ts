// OSPF on VRP, tried on a CE6855 on V200R005C00SPC800 with VLAN interfaces of VLANs no port carries. Circuit's plan was committed with `commit trial`, and the plan after it was empty. A change and the removal went into a candidate during the trial. `PRINTED` is what the switch printed.

import { expect, test } from "bun:test";
import type { Device, Ospf } from "../../src/model";
import { Vrp } from "../../src/platforms/vrp/index";
import { Fixtures } from "../fixtures";

const vrp = new Vrp();
const options = { secrets: false, rollback: 10 };
const base = Fixtures.device("single-site--switch");
const sent = (desired: string, current: string) => vrp.plan(desired, current, options).steps.flatMap((step) => step.send);

/** The single-site switch with four VLAN interfaces, on VLANs no port carries, and this OSPF. */
function routed(ospf: Ospf): Device {
    return {
        ...base,
        switching: {
            ...base.switching,
            vlans: {
                ...base.switching!.vlans,
                "nbma-a": { id: 3991 },
                p2mp: { id: 3992 },
                "nbma-b": { id: 3993 },
                lan: { id: 3994 },
            },
        },
        interfaces: {
            ...base.interfaces,
            vlan_interface: {
                ...base.interfaces!.vlan_interface,
                "nbma-a": { vlan: "nbma-a", addresses: ["192.0.2.1/28"] },
                p2mp: { vlan: "p2mp", addresses: ["198.51.100.1/28"] },
                "nbma-b": { vlan: "nbma-b", addresses: ["203.0.113.1/28"] },
                lan: { vlan: "lan", addresses: ["192.0.2.17/28"] },
            },
        },
        routing: { ...base.routing, router_id: "192.0.2.1", ospf },
    };
}

const committed: Ospf = {
    areas: {
        "0.0.0.0": {
            interfaces: { "nbma-a": { network: "non-broadcast", neighbors: ["192.0.2.2"], priority: 1 } },
            virtual_links: [{ transit_area_id: "0.0.0.1", router_id: "198.51.100.3" }],
        },
        "0.0.0.1": {
            ranges: [
                { prefix: "198.51.100.0/24", advertise: true, cost: 0 },
                { prefix: "203.0.113.0/24", advertise: true, cost: 16777214 },
                { prefix: "100.64.0.0/10", advertise: false },
            ],
            interfaces: {
                p2mp: { network: "point-to-multipoint" },
                "nbma-b": { network: "non-broadcast", neighbors: ["203.0.113.2"], priority: 7 },
                lan: { priority: 5 },
            },
        },
    },
};

/** The process and the VLAN interfaces as the switch printed them. Priority 1, the default, is not printed. */
const PRINTED = `interface Vlanif3991
 ip address 192.0.2.1 255.255.255.240
 ospf network-type nbma
#
interface Vlanif3992
 ip address 198.51.100.1 255.255.255.240
 ospf network-type p2mp
#
interface Vlanif3993
 ip address 203.0.113.1 255.255.255.240
 ospf network-type nbma
 ospf dr-priority 7
#
interface Vlanif3994
 ip address 192.0.2.17 255.255.255.240
 ospf dr-priority 5
#
ospf 1 router-id 192.0.2.1
 peer 192.0.2.2
 peer 203.0.113.2
 area 0.0.0.0
  network 192.0.2.0 0.0.0.15
 area 0.0.0.1
  abr-summary 203.0.113.0 255.255.255.0 cost 16777214
  abr-summary 198.51.100.0 255.255.255.0 cost 0
  abr-summary 100.64.0.0 255.192.0.0 not-advertise
  network 192.0.2.16 0.0.0.15
  network 198.51.100.0 0.0.0.15
  network 203.0.113.0 0.0.0.15
  vlink-peer 198.51.100.3
#
`;

/** The render with the four VLAN interfaces and the process as the switch printed them. */
const printed = (render: string) =>
    `${render.replace(/^interface Vlanif399\d\n[\s\S]*?^#\n/gm, "").replace(/^ospf 1 [\s\S]*?^#\n/m, "")}${PRINTED}`;

test("VRP writes ranges, priorities, NBMA and point-to-multipoint links, and virtual links as the switch prints them", () => {
    const desired = vrp.render(routed(committed));

    expect(desired).toContain("interface Vlanif3991\n ip address 192.0.2.1 255.255.255.240\n ospf network-type nbma\n#");
    expect(desired).toContain(" area 0.0.0.1\n  abr-summary 198.51.100.0 255.255.255.0 cost 0\n");
    expect(desired).toContain("  vlink-peer 198.51.100.3\n#");
    expect(vrp.plan(desired, printed(desired), options).steps).toEqual([]);
    expect(vrp.unsupported(routed(committed))).toEqual([]);
    expect(vrp.experimental(routed(committed))).toEqual([]);
});

test("VRP undoes a range by its address and mask, a priority and a network type by their keyword, and the process by its number", () => {
    const current = printed(vrp.render(routed(committed)));
    const changed: Ospf = {
        areas: {
            "0.0.0.0": {
                interfaces: { "nbma-a": { network: "non-broadcast", neighbors: ["192.0.2.2", "192.0.2.3"] } },
                virtual_links: [{ transit_area_id: "0.0.0.1", router_id: "198.51.100.2" }],
            },
            "0.0.0.1": {
                ranges: [
                    { prefix: "198.51.100.0/24", advertise: true, cost: 100 },
                    { prefix: "203.0.113.0/24", advertise: false },
                ],
                interfaces: { p2mp: { network: "point-to-multipoint" }, "nbma-b": { priority: 0 }, lan: {} },
            },
        },
    };

    expect(sent(vrp.render(routed(changed)), current)).toEqual([
        "interface Vlanif3993",
        "undo ospf network-type",
        "ospf dr-priority 0",
        "quit",
        "interface Vlanif3994",
        "undo ospf dr-priority",
        "quit",
        "ospf 1 router-id 192.0.2.1",
        "undo peer 203.0.113.2",
        "peer 192.0.2.3",
        "quit",
        "ospf 1 router-id 192.0.2.1",
        "area 0.0.0.1",
        "undo vlink-peer 198.51.100.3",
        "undo abr-summary 100.64.0.0 255.192.0.0",
        "undo abr-summary 198.51.100.0 255.255.255.0",
        "undo abr-summary 203.0.113.0 255.255.255.0",
        "abr-summary 198.51.100.0 255.255.255.0 cost 100",
        "abr-summary 203.0.113.0 255.255.255.0 not-advertise",
        "vlink-peer 198.51.100.2",
        "quit",
        "quit",
    ]);

    // The switch asks before it deletes the VLANs and the process, and the apply answers yes.
    expect(sent(vrp.render(base), current)).toEqual([
        "undo interface Vlanif3991",
        "undo interface Vlanif3992",
        "undo interface Vlanif3993",
        "undo interface Vlanif3994",
        "undo vlan batch 3991 to 3994",
        "undo ospf 1",
    ]);
});

// The CE6855 committed `before` with `commit trial`, and the plan after it was empty. The move went into a candidate, and the plan against `display configuration candidate merge` was empty.
test("VRP keys each passive interface and each redistributed source by itself, so a move undoes the old one", () => {
    const before: Ospf = {
        redistribute: ["connected"],
        areas: { "0.0.0.0": { interfaces: { "nbma-a": { passive: true }, p2mp: {} } } },
    };
    const after: Ospf = {
        redistribute: ["static"],
        areas: { "0.0.0.0": { interfaces: { "nbma-a": {}, p2mp: { passive: true } } } },
    };

    expect(sent(vrp.render(routed(after)), vrp.render(routed(before)))).toEqual([
        "ospf 1 router-id 192.0.2.1",
        "undo silent-interface Vlanif3991",
        "undo import-route direct",
        "import-route static",
        "silent-interface Vlanif3992",
        "quit",
    ]);
});

test("VRP refuses the neighbors of a point-to-multipoint link", () => {
    const multicast: Ospf = {
        areas: { "0.0.0.0": { interfaces: { p2mp: { network: "point-to-multipoint", neighbors: ["198.51.100.2"] } } } },
    };

    expect(vrp.unsupported(routed(multicast))).toEqual([
        "routing.ospf.areas.0.0.0.0.interfaces.p2mp.neighbors on a point-to-multipoint link: the platform sends its hellos there by multicast, as `peer` is for NBMA links, and V200R005 has no `p2mp-peer`",
    ]);
});
