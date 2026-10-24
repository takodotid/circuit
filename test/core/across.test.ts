// Rules across devices: each mistake that spans two devices is found on the device that makes it, and a network where both ends agree passes.

import { expect, test } from "bun:test";
import { defineDevice, defineNetwork, secret } from "../../src/core/define";
import { Validator } from "../../src/core/validator";
import type { Device, IP } from "../../src/schema";

const findings = (...devices: Device[]) =>
    Validator.run(defineNetwork({ devices })).map((finding) => `${finding.level} ${finding.device}: ${finding.message}`);

const users = { admin: { role: "admin" as const, password: secret("PASSWORD") } };

/** Two routers that agree on everything: a cable with a /30, VLANs, VRRP, iBGP between loopbacks, a GRE and a VXLAN tunnel. */
function routers(changes: { r1?: Partial<Device>; r2?: Partial<Device> } = {}): [Device, Device] {
    const router = (n: 1 | 2) =>
        defineDevice({
            name: `r${n}`,
            platform: "routeros",
            model: "CCR2216-1G-12XS-2XQ",
            connection: { host: `10.0.10.${n}`, user: "admin" },
            users,
            vlans: { mgmt: { id: 10 } },
            ports: {
                "100g-1": { addresses: [`10.0.0.${n}/30`], link: { device: `r${3 - n}`, port: "100g-1" } },
                "25g-1": { trunk_vlans: ["mgmt"], link: { device: `r${3 - n}`, port: "25g-1" } },
            },
            interfaces: {
                lo: { type: "loopback", addresses: [`10.255.0.${n}/32`] },
                mgmt: { type: "vlan", vlan: "mgmt", addresses: [`10.0.10.${n}/24`], vrrp: [{ id: 1, address: "10.0.10.254" }] },
                gre: { type: "gre", local: `10.255.0.${n}`, remote: `10.255.0.${3 - n}` },
                vxlan: { type: "vxlan", vni: 100, local: `10.255.0.${n}`, remote: `10.255.0.${3 - n}` },
            },
            routing: {
                bgp: {
                    asn: 64500,
                    neighbors: { [`r${3 - n}`]: { address: `10.255.0.${3 - n}`, remote_as: 64500, local_address: `10.255.0.${n}` } },
                },
            },
        });

    return [
        { ...router(1), ...changes.r1 },
        { ...router(2), ...changes.r2 },
    ];
}

test("two devices that agree pass", () => {
    expect(findings(...routers())).toEqual([]);
});

test("an address on two devices is an error, and on two loopbacks a warning, for anycast", () => {
    const [r1, r2] = routers();

    const clash = findings(r1, {
        ...r2,
        interfaces: { ...r2.interfaces, mgmt: { type: "vlan", vlan: "mgmt", addresses: ["10.0.10.1/24"] } },
    });
    expect(clash).toContain("error r2: 10.0.10.1 on mgmt is also on r1 mgmt");

    const anycast = findings(r1, { ...r2, interfaces: { ...r2.interfaces, lo: { type: "loopback", addresses: ["10.255.0.1/32"] } } });
    expect(anycast).toContain("warning r2: 10.255.0.1 on lo is also on r1 lo, which is right only for anycast");
});

test("the two ends of a cable agree on prefix, MTU and speed", () => {
    const [r1, r2] = routers();

    const changed = findings(r1, {
        ...r2,
        ports: {
            ...r2.ports,
            "100g-1": { addresses: ["10.0.0.2/31"], mtu: 9000, speed: "40g", link: { device: "r1", port: "100g-1" } },
        },
    });

    expect(changed).toContain(
        "error r1: port 100g-1 link: 100g-1 has 10.0.0.1/30, and r2 100g-1 has 10.0.0.2/31: not one prefix of one length"
    );
    expect(changed).toContain("error r1: port 100g-1 link: MTU 1500 on 100g-1, and r2 100g-1 has 9000");
    expect(changed.filter((line) => line.includes("speed"))).toEqual([]);

    const speeds = findings(
        { ...r1, ports: { ...r1.ports, "100g-1": { ...r1.ports!["100g-1"]!, speed: "100g" } } },
        { ...r2, ports: { ...r2.ports, "100g-1": { ...r2.ports!["100g-1"]!, speed: "40g" } } }
    );
    expect(speeds).toContain("error r1: port 100g-1 link: speed 100g, and r2 100g-1 is 40g");
});

test("both ends of a cable name the same carrier, or none", () => {
    const [r1, r2] = routers();
    const through = (device: Device, carrier: string): Device => ({
        ...device,
        ports: {
            ...device.ports,
            "100g-1": { ...device.ports!["100g-1"]!, link: { ...device.ports!["100g-1"]!.link!, through: carrier } },
        },
    });

    expect(findings(through(r1, "Carrier local loop"), through(r2, "Carrier local loop"))).toEqual([]);
    expect(findings(through(r1, "Carrier local loop"), r2)).toEqual([
        "error r1: port 100g-1 link: through Carrier local loop here, and direct on r2 100g-1",
        "error r2: port 100g-1 link: direct here, and through Carrier local loop on r1 100g-1",
    ]);
});

test("the two ends of a cable carry the same VLANs, and a LAG is compared by what the LAG carries", () => {
    const [r1, r2] = routers();
    const vlans = { mgmt: { id: 10 }, office: { id: 20 } };

    const trunks = findings(
        { ...r1, vlans, ports: { ...r1.ports, "25g-1": { trunk_vlans: ["mgmt", "office"], link: { device: "r2", port: "25g-1" } } } },
        r2
    );
    expect(trunks).toContain("error r1: port 25g-1 link: 25g-1 carries VLANs 10, 20 tagged, and r2 25g-1 carries VLAN 10 tagged");

    /** A router whose two ports to the other are one LAG carrying these VLANs. */
    const bonded = (router: Device, other: string, carried: ("mgmt" | "office")[]): Device => ({
        ...router,
        vlans,
        ports: {
            ...router.ports,
            "25g-1": { lag: "bond", link: { device: other, port: "25g-1" } },
            "25g-2": { lag: "bond", link: { device: other, port: "25g-2" } },
        },
        interfaces: { ...router.interfaces, bond: { type: "lag", trunk_vlans: carried } },
    });

    expect(findings(bonded(r1, "r2", ["mgmt"]), bonded(r2, "r1", ["mgmt"]))).toEqual([]);

    const lags = findings(bonded(r1, "r2", ["mgmt", "office"]), bonded(r2, "r1", ["mgmt"]));
    expect(lags).toContain("error r1: port 25g-1 link: bond carries VLANs 10, 20 tagged, and r2 bond carries VLAN 10 tagged");

    const oneSided = findings(bonded(r1, "r2", ["mgmt"]), {
        ...r2,
        ports: { ...r2.ports, "25g-2": { trunk_vlans: ["mgmt"], link: { device: "r1", port: "25g-2" } } },
    });
    expect(oneSided).toContain("error r1: port 25g-1 link: 25g-1 is in bond, and r2 25g-1 is in no LAG");
    expect(oneSided).toContain("error r2: port 25g-1 link: 25g-1 is in no LAG, and r1 25g-1 is in bond");
});

test("one address in two VRFs, on one device or two, is no clash, and two routers may run a VXLAN tunnel per VNI", () => {
    const [r1, r2] = routers();

    /** Two customers on one router, both given 10.9.0.1 in a VRF of their own. */
    const customers = (router: Device): Device => ({
        ...router,
        vrfs: { a: {}, b: {} },
        ports: {
            ...router.ports,
            "25g-2": { addresses: ["10.9.0.1/30"], vrf: "a" },
            "25g-3": { addresses: ["10.9.0.1/30"], vrf: "b" },
        },
    });

    expect(findings(customers(r1), r2)).toEqual([]);

    const sameVrf = findings(
        { ...customers(r1), ports: { ...customers(r1).ports, "25g-3": { addresses: ["10.9.0.1/30"], vrf: "a" } } },
        r2
    );
    expect(sameVrf).toContain("error r1: 10.9.0.1 is on both port 25g-2 and port 25g-3");

    /** A second tunnel between the two routers, for another customer. */
    const second = (router: Device, n: 1 | 2): Device => ({
        ...router,
        interfaces: {
            ...router.interfaces,
            "vxlan-b": { type: "vxlan", vni: 101, local: `10.255.0.${n}`, remote: `10.255.0.${3 - n}` },
        },
    });

    expect(findings(second(r1, 1), second(r2, 2))).toEqual([]);
});

test("one VLAN under two names across a cable is a warning", () => {
    const [r1, r2] = routers();

    const renamed = findings(r1, {
        ...r2,
        vlans: { management: { id: 10 } },
        ports: { ...r2.ports, "25g-1": { trunk_vlans: ["management"], link: { device: "r1", port: "25g-1" } } },
        interfaces: {
            ...r2.interfaces,
            mgmt: { type: "vlan", vlan: "management", addresses: ["10.0.10.2/24"], vrrp: [{ id: 1, address: "10.0.10.254" }] },
        },
    });

    expect(renamed).toEqual([
        "warning r1: port 25g-1 link: VLAN 10 is mgmt here and management on r2",
        "warning r2: port 25g-1 link: VLAN 10 is management here and mgmt on r1",
    ]);
});

test("a BGP session to another device needs its session back, in the AS it expects, from the address it names", () => {
    const [r1, r2] = routers();

    const wrongAs = findings(
        {
            ...r1,
            routing: { bgp: { asn: 64500, neighbors: { r2: { address: "10.255.0.2", remote_as: 64501, local_address: "10.255.0.1" } } } },
        },
        r2
    );
    expect(wrongAs).toContain("error r1: neighbor r2: expects AS64501, and r2 is AS64500");

    const noBack = findings(r1, { ...r2, routing: undefined });
    expect(noBack).toContain("error r1: neighbor r2: 10.255.0.2 is r2's, which runs no BGP");

    const wrongSource = findings(
        {
            ...r1,
            routing: { bgp: { asn: 64500, neighbors: { r2: { address: "10.255.0.2", remote_as: 64500, local_address: "10.0.0.1" } } } },
        },
        r2
    );
    expect(wrongSource).toContain("error r1: neighbor r2: starts from 10.0.0.1, and r2's session r1 expects 10.255.0.1");
});

test("a session per family is matched to the session back of its own family", () => {
    const dualStack = (n: 1 | 2): Device => {
        const [own, far] = [n, 3 - n];
        const router = routers()[n - 1];

        return {
            ...router,
            interfaces: { ...router.interfaces, lo: { type: "loopback", addresses: [`10.255.0.${own}/32`, `2001:db8::${own}/128`] } },
            routing: {
                bgp: {
                    asn: 64500,
                    neighbors: {
                        [`r${far}-v4`]: { address: `10.255.0.${far}`, remote_as: 64500, local_address: `10.255.0.${own}` },
                        [`r${far}-v6`]: { address: `2001:db8::${far}`, remote_as: 64500, local_address: `2001:db8::${own}` },
                    },
                },
            },
        };
    };

    expect(findings(dualStack(1), dualStack(2))).toEqual([]);

    // A session of the other family does not answer one.
    const onlyV4 = dualStack(2);
    const neighbors = { r1: { address: "10.255.0.1", remote_as: 64500, local_address: "10.255.0.2" } } as const;
    expect(findings(dualStack(1), { ...onlyV4, routing: { bgp: { asn: 64500, neighbors } } })).toEqual([
        "error r1: neighbor r2-v6: r2 has no session back to r1",
    ]);
});

test("on one segment, a VRRP id has one address and an address one id", () => {
    const [r1, r2] = routers();
    const mgmt = (vrrp: { id: number; address: IP }) => ({
        ...r2,
        interfaces: { ...r2.interfaces, mgmt: { type: "vlan" as const, vlan: "mgmt", addresses: ["10.0.10.2/24" as const], vrrp: [vrrp] } },
    });

    expect(findings(r1, mgmt({ id: 1, address: "10.0.10.253" }))).toContain(
        "error r1: VRRP 1 on mgmt is 10.0.10.254, and on r2 mgmt it is 10.0.10.253"
    );
    expect(findings(r1, mgmt({ id: 2, address: "10.0.10.254" }))).toContain(
        "error r1: VRRP address 10.0.10.254 is id 1 on r1 mgmt, and id 2 on r2 mgmt"
    );
});

test("a tunnel to another device needs one back, with the same VNI and port", () => {
    const [r1, r2] = routers();
    const { gre: _gre, ...withoutGre } = r2.interfaces!;

    expect(findings(r1, { ...r2, interfaces: withoutGre })).toContain(
        "error r1: interface gre: 10.255.0.2 is r2's, which has no GRE tunnel from there back to 10.255.0.1"
    );

    const otherVni = findings(r1, {
        ...r2,
        interfaces: { ...r2.interfaces, vxlan: { type: "vxlan", vni: 200, port: 8472, local: "10.255.0.2", remote: "10.255.0.1" } },
    });
    expect(otherVni).toContain("error r1: interface vxlan: VNI 100, and r2 vxlan has 200");
    expect(otherVni).toContain("error r1: interface vxlan: UDP port 4789, and r2 vxlan has 8472");
});
