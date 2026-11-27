// Routed ports on VRP, tried on a CE6855 on V200R005C00SPC800 on spare port 10GE1/0/48, with `vlan reserved for main-interface 3950 to 3951`. Each plan was committed with `commit trial`, and the plan after it was empty. A change and the removal went into a candidate during the trial. `PRINTED` is what the switch printed for the port.

import { expect, test } from "bun:test";
import type { Device } from "../../src/model";
import { Platforms } from "../../src/platforms";
import { Vrp } from "../../src/platforms/vrp/index";
import { Fixtures } from "../fixtures";

const vrp = new Vrp();
const options = { secrets: false, rollback: 10 };
const base = Fixtures.device("single-site--switch");
const plan = (desired: string, current: string) => vrp.plan(desired, current, options);
const RANGE = "vlan reserved for main-interface 3950 to 3951";

/** The single-site switch with spare port 10g-48 routed, OSPF on it, and VLANs 3950 to 3951 reserved. */
function routed(port: Record<string, unknown> = {}, reserved: { min: number; max: number } | null = { min: 3950, max: 3951 }): Device {
    return {
        ...base,
        switching: { ...base.switching, ...(reserved ? { reserved_vlans: reserved } : {}) },
        interfaces: {
            ...base.interfaces,
            ethernet: {
                ...base.interfaces!.ethernet,
                "10g-48": {
                    description: "ctest routed port",
                    addresses: ["192.0.2.1/29", "2001:db8:3950::1/64"],
                    vrrp: [{ id: 1, address: "192.0.2.6", priority: 120 }],
                    ipv6_ra: { managed: true },
                    lldp: false,
                    ...port,
                },
            },
        },
        routing: { ...base.routing, ospf: { areas: { "0.0.0.0": { interfaces: { "10g-48": { cost: 10 } } } } } },
    };
}

/** What the switch printed for the port, in its order. */
const PRINTED = `interface 10GE1/0/48
 undo portswitch
 description ctest routed port
 ipv6 enable
 ip address 192.0.2.1 255.255.255.248
 ipv6 address 2001:DB8:3950::1/64
 vrrp vrid 1 virtual-ip 192.0.2.6
 vrrp vrid 1 priority 120
 vrrp vrid 1 preempt disable
 ospf cost 10
 ipv6 nd ra halt disable
 ipv6 nd autoconfig managed-address-flag
 lldp disable
#
`;

/** The render, with the port and the range as the switch printed them: the range in a block of its own before `vlan batch`. */
function printed(device: Device): string {
    const rendered = vrp.render(device).replace(`${RANGE}\n#\n`, "");
    const port = /interface 10GE1\/0\/48\n(?: .*\n)*#\n/;
    return rendered.replace(port, PRINTED).replace("vlan batch ", `${RANGE}\n#\nvlan batch `);
}

test("a routed port leaves layer 2 first, and plans empty against what the switch printed", () => {
    const device = routed();
    const rendered = vrp.render(device);

    expect(rendered).toContain(`${RANGE}\n#\n`);
    expect(rendered).toContain("interface 10GE1/0/48\n undo portswitch\n description ctest routed port\n");
    expect(vrp.unsupported(device)).toEqual([]);
    expect(vrp.experimental(device)).toEqual([]);
    expect(plan(rendered, printed(device)).steps).toEqual([]);

    // The range comes before the port that takes a VLAN of it, and the port leaves layer 2 before it takes an address.
    const steps = plan(rendered, vrp.render(base)).steps;
    const titles = steps.map((step) => step.title);
    expect(titles.indexOf("(top level)")).toBeLessThan(titles.indexOf("interface 10GE1/0/48"));
    expect(steps.find((step) => step.title === "(top level)")!.send).toContain(RANGE);
    expect(steps.find((step) => step.title === "interface 10GE1/0/48")!.send.slice(0, 4)).toEqual([
        "interface 10GE1/0/48",
        "undo shutdown",
        "undo portswitch",
        "description ctest routed port",
    ]);
});

test("a routed port lets go of its layer 3 settings before it switches again, and the range goes after it", () => {
    const steps = plan(vrp.render(base), printed(routed())).steps;
    const port = steps.find((step) => step.title === "interface 10GE1/0/48")!.send;

    // The switch refuses `portswitch` while the port holds anything else, and the range's undo while a port is on a VLAN of it.
    expect(port.slice(-3)).toEqual(["portswitch", "shutdown", "quit"]);
    expect(steps.at(-1)).toEqual({ title: "Reserved VLANs no longer used", show: [`- ${RANGE}`], send: [`undo ${RANGE}`] });
});

test("a routed port leaves its VRF by the VRF's name, and the VRF goes after the port", () => {
    const inVrf: Device = {
        ...routed({ vrf: "ctest", vrrp: undefined, ipv6_ra: undefined }),
        routing: { ...base.routing, vrfs: { ctest: {} } },
    };
    const rendered = vrp.render(inVrf);
    expect(rendered).toContain("interface 10GE1/0/48\n undo portswitch\n description ctest routed port\n ip binding vpn-instance ctest\n");

    // Undoing the VRF first took the port's addresses, and the switch then refused their undos. Without its name, the binding's undo was `Incomplete command`.
    const steps = plan(vrp.render(base), rendered).steps;
    expect(steps.find((step) => step.title === "interface 10GE1/0/48")!.send).toContain("undo ip binding vpn-instance ctest");
    expect(steps.slice(-2).map((step) => step.send)).toEqual([["undo ip vpn-instance ctest"], [`undo ${RANGE}`]]);
});

test("the range changes in one plan only while no port stays routed on it", () => {
    const moved = routed({}, { min: 3952, max: 3953 });
    expect(plan(vrp.render(moved), printed(routed())).problems).toEqual([
        "switching.reserved_vlans changes while 10GE1/0/48 routes on a VLAN of the old range, which the switch keeps until no routed port is on it. Apply the config without routed ports first, then with the new range and them",
    ]);

    // Without a routed port, the old range is undone before the new one, which may overlap it.
    const alone = (min: number, max: number): Device => ({ ...base, switching: { ...base.switching, reserved_vlans: { min, max } } });
    const top = plan(vrp.render(alone(3950, 3953)), vrp.render(alone(3950, 3951))).steps[0]!;
    expect(top.send).toEqual([`undo ${RANGE}`, "vlan reserved for main-interface 3950 to 3953"]);
});

test("a BGP session or a static route may go through a routed port, by its name on the switch", () => {
    const device: Device = {
        ...routed(),
        routing: {
            ...routed().routing,
            router_id: "192.0.2.254",
            static_routes: [{ prefix: "198.51.100.0/24", next_hop: "192.0.2.2", interface: "10g-48" }],
            bgp: { asn: 64500, neighbors: { ctest: { address: "192.0.2.2", remote_as: 64501, local_address: "192.0.2.1" } } },
        },
    };
    const rendered = vrp.render(device);

    expect(rendered).toContain(" peer 192.0.2.2 connect-interface 10GE1/0/48 192.0.2.1\n");
    expect(rendered).toContain("ip route-static 198.51.100.0 255.255.255.0 10GE1/0/48 192.0.2.2\n");
    expect(vrp.unsupported(device)).toEqual([]);
});

test("VRP refuses a routed port without the range, a range it doesn't take, too many routed ports, and layer 2 on a routed port", () => {
    expect(vrp.unsupported(routed({}, null))).toEqual([
        "interfaces.ethernet.10g-48.addresses, a routed port: the switch routes a port only on a VLAN it reserves for routed ports. Write switching.reserved_vlans, such as { min: 4000, max: 4063 }, a range no VLAN of the switch is in",
    ]);
    expect(vrp.unsupported(routed({}, { min: 1, max: 4094 }))).toEqual([
        "switching.reserved_vlans, from 2 to 4063 on the platform: VLAN 1 is the switch's default VLAN, and it keeps 4064 to 4094 for its own services",
    ]);
    expect(vrp.unsupported(routed({}, { min: 3950, max: 3950 }))).toEqual([
        "switching.reserved_vlans, one VLAN: the switch takes a range of two at least",
    ]);

    const two: Device = routed({ stp: false, storm_control: { broadcast: { percent: 1 } } }, { min: 3950, max: 3951 });
    two.interfaces!.ethernet!["10g-47"] = { addresses: ["192.0.2.9/30"] };
    two.interfaces!.ethernet!["10g-46"] = { addresses: ["192.0.2.13/30"] };
    two.interfaces!.ethernet!["10g-45"] = { vrf: "ctest" };
    two.routing = { ...two.routing, vrfs: { ctest: {} } };
    expect(vrp.unsupported(two)).toEqual([
        "switching.reserved_vlans, 2 VLANs for 3 routed ports: the switch takes a VLAN of the range for each routed port. Widen it",
        "interfaces.ethernet.10g-48.stp, on a routed port, which switches no frame",
        "interfaces.ethernet.10g-48.storm_control, on a routed port, which switches no frame",
        "interfaces.ethernet.10g-45.vrf, on a port without addresses: a port routes once it has them",
    ]);
});

test("a platform without reserved VLANs refuses them", () => {
    for (const platform of ["routeros", "junos", "fortios", "raisecom-ros"] as const) {
        const [name] = Fixtures.ofPlatform(platform);
        const device = Fixtures.device(name!);
        const reserved = { ...device, switching: { ...device.switching, reserved_vlans: { min: 4000, max: 4063 } } };
        expect(
            Platforms.get(platform)
                .unsupported(reserved)
                .filter((field) => field.startsWith("switching.reserved_vlans"))
        ).toHaveLength(1);
    }
});
