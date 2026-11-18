// OSPF area types, timers, and keys, tested on RouterOS 7.24.6, Junos 21.4R3, and FortiOS 6.2.2 (TRAPS.md). On each, a stub area and an NSSA, timers, and a key were set, changed, and taken away. The lines each device printed are fed to the adapters, with names and addresses replaced.

import { expect, test } from "bun:test";
import type { Device, Ospf } from "../../src/model";
import { Platforms } from "../../src/platforms";
import { Fixtures } from "../fixtures";

const options = { secrets: false, rollback: 10 };
const key = { secret: "OSPF_KEY" };

/** A fixture's device with only this OSPF. */
function withOspf(fixture: string, ospf: Ospf): Device {
    const device = Fixtures.device(fixture);
    return { ...device, routing: { ...device.routing, ospf } };
}

/** An ABR: `backbone` in area 0 with timers and a key, `other` alone in a totally NSSA. */
const abr = (backbone: string, other: string, algorithm: "md5" | "hmac-sha-256" = "md5"): Ospf => ({
    areas: {
        "0.0.0.0": { interfaces: { [backbone]: { hello_interval: 5, dead_interval: 20, authentication: { algorithm, key_id: 7, key } } } },
        "0.0.0.10": { type: "nssa", no_summaries: true, stub_default_cost: 15, interfaces: { [other]: { passive: true } } },
    },
});

const sent = (platform: string, desired: string, current: string) =>
    Platforms.get(platform)
        .plan(desired, current, options)
        .steps.flatMap((step) => step.send);

/** The OSPF menus of a RouterOS render, as the router printed them: defaults left out, flags last, no key. */
const ROUTEROS_PRINTED = `/routing ospf instance
add name=ospf-v2 router-id=192.0.2.255
/routing ospf area
add instance=ospf-v2 name=ospf-v2-0.0.0.0
add area-id=0.0.0.10 default-cost=15 instance=ospf-v2 name=ospf-v2-0.0.0.10 no-summaries type=nssa
/routing ospf interface-template
add area=ospf-v2-0.0.0.0 auth=sha256 auth-id=7 dead-interval=20s hello-interval=5s interfaces=uplink
add area=ospf-v2-0.0.0.10 interfaces=management passive`;

const routerosOspf = (render: string) => render.replace(/\/routing ospf instance\n[\s\S]*?(?=\n\/(?!routing ospf))/, ROUTEROS_PRINTED);

test("RouterOS writes the area type and the template's timers and key, and plans nothing against how the router prints them", () => {
    const routeros = Platforms.get("routeros");
    const desired = routeros.render(withOspf("platforms--example-router", abr("uplink", "management", "hmac-sha-256")));

    expect(desired).toContain("add no-summaries area-id=0.0.0.10 default-cost=15 instance=ospf-v2 name=ospf-v2-0.0.0.10 type=nssa");
    expect(desired).toContain('auth=sha256 auth-id=7 auth-key="<secret:OSPF_KEY>" dead-interval=20s hello-interval=5s interfaces=uplink');
    expect(routeros.plan(desired, routerosOspf(desired), options).steps).toEqual([]);
});

test("RouterOS changes a flag in place, unsets a default cost before the area becomes normal, and sends the key with a new auth", () => {
    const routeros = Platforms.get("routeros");
    const ospf: Ospf = {
        areas: {
            "0.0.0.0": { interfaces: { uplink: {} } },
            "0.0.0.10": { interfaces: { management: { authentication: { algorithm: "md5", key_id: 3, key } } } },
        },
    };
    const desired = routeros.render(withOspf("platforms--example-router", ospf));

    expect(sent("routeros", desired, routerosOspf(desired))).toEqual([
        "/routing ospf area unset [ find name=ospf-v2-0.0.0.10 ] default-cost",
        "/routing ospf area set [ find name=ospf-v2-0.0.0.10 ] !no-summaries type=default",
        "/routing ospf interface-template unset [ find area=ospf-v2-0.0.0.0 and interfaces=uplink ] auth",
        "/routing ospf interface-template unset [ find area=ospf-v2-0.0.0.0 and interfaces=uplink ] auth-id",
        "/routing ospf interface-template set [ find area=ospf-v2-0.0.0.0 and interfaces=uplink ] dead-interval=40s hello-interval=10s",
        '/routing ospf interface-template set [ find area=ospf-v2-0.0.0.10 and interfaces=management ] !passive auth=md5 auth-id=3 auth-key="<secret:OSPF_KEY>"',
    ]);
});

test("Junos writes the area type and the interface's timers and key, and plans nothing against how the switch prints them", () => {
    const junos = Platforms.get("junos");
    const device = withOspf("platforms--example-aggregation-switch", abr("10g-48", "loopback"));
    const desired = junos.render(device);

    for (const statement of [
        "set protocols ospf area 0.0.0.0 interface xe-0/0/47.0 hello-interval 5",
        "set protocols ospf area 0.0.0.0 interface xe-0/0/47.0 dead-interval 20",
        "set protocols ospf area 0.0.0.0 interface xe-0/0/47.0 authentication md5 7 key <secret:OSPF_KEY>",
        "set protocols ospf area 0.0.0.10 nssa no-summaries",
        "set protocols ospf area 0.0.0.10 nssa default-lsa default-metric 15",
    ])
        expect(desired).toContain(statement);

    // The switch prints the key encrypted, and `nssa` only through what it holds.
    const printed = desired
        .replace("key <secret:OSPF_KEY>", 'key "$9$DniP59Apu1Rk.Qn9A0OdbwYaZk"')
        .replace("set protocols ospf area 0.0.0.10 nssa\n", "");
    expect(junos.plan(desired, printed, options).steps).toEqual([]);

    const stub: Ospf = { areas: { "0.0.0.10": { type: "stub", stub_default_cost: 20, interfaces: { loopback: { passive: true } } } } };
    const changed = junos.render(withOspf("platforms--example-aggregation-switch", stub));
    expect(sent("junos", changed, printed)).toEqual(
        expect.arrayContaining(["delete protocols ospf area 0.0.0.10 nssa", "set protocols ospf area 0.0.0.10 stub default-metric 20"])
    );
});

test("Junos and FortiOS refuse HMAC-SHA, and FortiOS and VRP a key ID of 0", () => {
    const sha = (fixture: string, backbone: string, other: string) => withOspf(fixture, abr(backbone, other, "hmac-sha-256"));

    expect(Platforms.get("junos").unsupported(sha("platforms--example-aggregation-switch", "10g-48", "loopback"))).toContain(
        "routing.ospf.areas.0.0.0.0.interfaces.10g-48.authentication.algorithm hmac-sha-256, Junos 21 signs OSPF with md5 only"
    );
    expect(Platforms.get("fortios").unsupported(sha("platforms--example-firewall", "management", "loopback"))).toContain(
        "routing.ospf.areas.0.0.0.0.interfaces.management.authentication.algorithm hmac-sha-256, FortiOS 6.2 signs OSPF with md5 only"
    );

    const zero: Ospf = { areas: { "0.0.0.0": { interfaces: { management: { authentication: { algorithm: "md5", key_id: 0, key } } } } } };
    expect(Platforms.get("fortios").unsupported(withOspf("platforms--example-firewall", zero))).toContain(
        "routing.ospf.areas.0.0.0.0.interfaces.management.authentication.key_id 0, FortiOS numbers keys from 1"
    );
    expect(Platforms.get("vrp").unsupported(withOspf("platforms--example-switch", zero))).toContain(
        "routing.ospf.areas.0.0.0.0.interfaces.management.authentication.key_id 0, the platform numbers keys from 1"
    );
});

test("FortiOS announces an NSSA's default route as a type-7 LSA of its own, and plans nothing against how the firewall prints the area", () => {
    const fortios = Platforms.get("fortios");
    const nssa: Ospf = {
        areas: {
            "0.0.0.0": {
                interfaces: { management: { hello_interval: 5, dead_interval: 20, authentication: { algorithm: "md5", key_id: 7, key } } },
            },
            "0.0.0.10": { type: "nssa", stub_default_cost: 15, interfaces: { loopback: { passive: true } } },
        },
    };
    const section = /^config router ospf\n[\s\S]*?^end\n/m;
    const desired = fortios.render(withOspf("platforms--example-firewall", nssa)).match(section)![0];

    // In the firewall's own order, with the key encrypted.
    const printed = `config router ospf
    set router-id 198.51.100.255
    config area
        edit 0.0.0.0
        next
        edit 0.0.0.10
            set type nssa
            set nssa-default-information-originate always
            set nssa-default-information-originate-metric 15
        next
    end
    config ospf-interface
        edit "management"
            set interface "management"
            set authentication md5
            set dead-interval 20
            set hello-interval 5
            config md5-keys
                edit 7
                    set key-string ENC 1lddpZHv29p/0fNXvRQ46VKF1dS8kpujvZI9h5Eyy4HOqVN4
                next
            end
        next
    end
${desired.slice(desired.indexOf("    config network"), desired.lastIndexOf("end"))}    set passive-interface "loopback"
end
`;
    expect(sent("fortios", desired, printed)).toEqual([]);
});

test("VRP renders the new keys behind --experimental, and Raisecom ROS refuses them", () => {
    const vrp = Platforms.get("vrp");
    const device = withOspf("platforms--example-switch", {
        areas: {
            "0.0.0.0": { interfaces: { management: { hello_interval: 5, authentication: { algorithm: "hmac-sha-256", key_id: 7, key } } } },
            "0.0.0.10": { type: "nssa", stub_default_cost: 15, interfaces: {} },
        },
    });
    const desired = vrp.render(device);

    expect(desired).toContain(" ospf authentication-mode hmac-sha256 7 cipher <secret:OSPF_KEY>");
    expect(desired).toContain(" area 0.0.0.10\n  nssa default-route-advertise\n  default-cost 15");
    expect(vrp.experimental!(device)).toEqual([
        "routing.ospf.areas.0.0.0.0.interfaces.management.hello_interval",
        "routing.ospf.areas.0.0.0.0.interfaces.management.authentication",
        "routing.ospf.areas.0.0.0.10.type",
        "routing.ospf.areas.0.0.0.10.stub_default_cost",
    ]);

    const raisecom = withOspf("platforms--example-core-switch", {
        areas: { "0.0.0.10": { type: "stub", interfaces: { management: { dead_interval: 40 } } } },
    });
    expect(Platforms.get("raisecom-ros").unsupported(raisecom)).toEqual(
        expect.arrayContaining([
            "routing.ospf.areas.0.0.0.10.type, not tested on the platform",
            "routing.ospf.areas.0.0.0.10.interfaces.management.dead_interval, not tested on the platform",
        ])
    );
});
