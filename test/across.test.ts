// Rules across devices: each mistake that spans two devices is found on the device that makes it, and a network where both ends agree passes.

import { expect, test } from "bun:test";
import { defineDevice, defineNetwork, secret } from "../src/core/define";
import { validate } from "../src/core/validate";
import type { Device } from "../src/schema";

const findings = (...devices: Device[]) =>
    validate(defineNetwork({ devices })).map((finding) => `${finding.level} ${finding.device}: ${finding.message}`);

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
