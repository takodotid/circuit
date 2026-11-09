// Rules one device has to satisfy, on the example router.

import { expect, test } from "bun:test";
import { Validation } from "../../src/checks";
import type { Device } from "../../src/model";
import { Fixtures } from "../fixtures";

const router = Fixtures.device("platforms--example-router");

const messages = (device: Device) => Validation.run([device], undefined).map((finding) => finding.message);

test("a MAC limit is a whole number above 0, and an ethertype filter lets each kind in once", () => {
    const [port, settings] = Object.entries(router.interfaces?.ethernet ?? {})[0]!;
    const device: Device = {
        ...router,
        interfaces: {
            ...router.interfaces,
            ethernet: { ...router.interfaces?.ethernet, [port]: { ...settings, mac_limit: 0, ethertypes: ["ipv4", "ipv4"] } },
            lag: { ...router.interfaces?.lag, members: { mac_limit: 1.5, ethertypes: [] } },
        },
    };

    expect(messages(device)).toEqual(
        expect.arrayContaining([
            `interfaces.ethernet.${port}.mac_limit 0 is not a whole number above 0`,
            `interfaces.ethernet.${port}.ethertypes names a kind twice`,
            "interfaces.lag.members.mac_limit 1.5 is not a whole number above 0",
            "interfaces.lag.members.ethertypes is empty, so it would drop every frame",
        ])
    );
});

test("a bound port is an access port, with each MAC address and each address written once and well", () => {
    const [port, settings] = Object.entries(router.interfaces?.ethernet ?? {})[0]!;
    const device: Device = {
        ...router,
        interfaces: {
            ...router.interfaces,
            ethernet: {
                ...router.interfaces?.ethernet,
                [port]: {
                    ...settings,
                    bound_to: [
                        { mac: "02:00:00:00:00:01", addresses: ["192.0.2.10", "192.0.2.9/29", "fe80::1"] },
                        { mac: "02:00:00:00:00:01", addresses: ["192.0.2.10"] },
                        { mac: "01:00:5e:00:00:01", addresses: [] },
                        { mac: "02:00:00:00:00:0g", addresses: [] },
                    ],
                },
            },
            lag: { ...router.interfaces?.lag, members: { access_vlan: "lan", bound_to: [] } },
        },
    };
    const where = `interfaces.ethernet.${port}.bound_to`;

    expect(messages(device)).toEqual(
        expect.arrayContaining([
            `${where} is on a port that is not an access port: bind the hosts of one VLAN`,
            `${where}[0].addresses 192.0.2.9/29 has bits past its length: write 192.0.2.8/29`,
            `${where}[0].addresses fe80::1 is link-local, which a bound host may always send from`,
            `${where}[1].mac 02:00:00:00:00:01 is listed twice`,
            `${where}[1].addresses 192.0.2.10 is listed twice on the port`,
            `${where}[2].mac 01:00:5e:00:00:01 is a multicast address, which no host sends from`,
            `${where}[3].mac '02:00:00:00:00:0g' is not a MAC address, such as 02:00:00:00:00:01`,
            "interfaces.lag.members.bound_to is empty, so it would drop every frame",
        ])
    );
});

test("a static route with bfd needs next_hop, the address BFD watches", () => {
    const viaInterface: Device = {
        ...router,
        routing: { ...router.routing, static_routes: [{ prefix: "198.51.100.128/25", interface: "uplink", bfd: true }] },
    };

    expect(messages(viaInterface)).toContain("routing.static_routes 198.51.100.128/25 has bfd without next_hop, the address BFD watches");
});
