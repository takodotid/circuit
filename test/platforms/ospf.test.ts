// OSPF area types, timers, and keys, tested on RouterOS 7.24.6, Junos 21.4R3, and FortiOS 6.2.2 (TRAPS.md). RouterOS's ranges, priorities, and NBMA and point-to-multipoint links ran on CHRs. Each was set, changed, and taken away. The lines each device printed are fed to the adapters, with names and addresses replaced.

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

/** An ABR whose uplink is point-to-multipoint and whose port to a carrier's service is NBMA, each with a neighbor, and whose area 1 is summarized. */
const designed: Ospf = {
    areas: {
        "0.0.0.0": {
            interfaces: {
                uplink: { network: "point-to-multipoint", neighbors: ["203.0.113.1"] },
                "1g-1": { network: "non-broadcast", priority: 0, neighbors: ["198.51.100.1"] },
            },
        },
        "0.0.0.1": {
            ranges: [
                { prefix: "198.51.100.64/26", advertise: true },
                { prefix: "192.0.2.0/24", advertise: false },
            ],
            interfaces: { servers: { priority: 200 }, management: { passive: true } },
        },
    },
};

/** The ranges, templates, and static neighbors of `designed`, as a CHR on 7.24.6 printed them: `advertise=yes` left out, and each neighbor's address unquoted. */
const DESIGNED_PRINTED = `/routing ospf area range
add area=ospf-v2-0.0.0.1 prefix=198.51.100.64/26
add advertise=no area=ospf-v2-0.0.0.1 prefix=192.0.2.0/24
/routing ospf interface-template
add area=ospf-v2-0.0.0.0 interfaces=uplink type=ptmp
add area=ospf-v2-0.0.0.0 interfaces=ether1 priority=0 type=nbma
add area=ospf-v2-0.0.0.1 interfaces=servers priority=200
add area=ospf-v2-0.0.0.1 interfaces=management passive
/routing ospf static-neighbor
add address=203.0.113.1%uplink area=ospf-v2-0.0.0.0
add address=198.51.100.1%ether1 area=ospf-v2-0.0.0.0`;

/** A RouterOS render of `designed`, with its OSPF ranges, templates, and neighbors as the router printed them. */
const designedPrinted = () =>
    Platforms.get("routeros")
        .render(withOspf("platforms--example-router", designed))
        .replace(/\/routing ospf area range\n[\s\S]*?(?=\n\/(?!routing ospf))/, DESIGNED_PRINTED);

test("RouterOS writes ranges, priorities, and point-to-multipoint and NBMA links with their neighbors, and plans nothing against how the router prints them", () => {
    const routeros = Platforms.get("routeros");
    const desired = routeros.render(withOspf("platforms--example-router", designed));

    for (const line of [
        "add advertise=yes area=ospf-v2-0.0.0.1 prefix=198.51.100.64/26",
        "add advertise=no area=ospf-v2-0.0.0.1 prefix=192.0.2.0/24",
        "add area=ospf-v2-0.0.0.0 interfaces=uplink type=ptmp",
        "add area=ospf-v2-0.0.0.0 interfaces=ether1 priority=0 type=nbma",
        "add area=ospf-v2-0.0.0.1 interfaces=servers priority=200",
        'add address="198.51.100.1%ether1" area=ospf-v2-0.0.0.0',
    ])
        expect(desired).toContain(line);

    expect(routeros.plan(desired, designedPrinted(), options).steps).toEqual([]);
});

test("RouterOS sets a range's advertise and a template's priority and type back, which unset refuses, and removes a static neighbor", () => {
    const plain: Ospf = {
        areas: {
            "0.0.0.0": { interfaces: { uplink: {}, "1g-1": {} } },
            "0.0.0.1": {
                ranges: [
                    { prefix: "198.51.100.64/26", advertise: true },
                    { prefix: "192.0.2.0/24", advertise: true },
                ],
                interfaces: { servers: {}, management: { passive: true } },
            },
        },
    };
    const desired = Platforms.get("routeros").render(withOspf("platforms--example-router", plain));

    expect(sent("routeros", desired, designedPrinted())).toEqual([
        '/routing ospf area range set [ find area=ospf-v2-0.0.0.1 and prefix="192.0.2.0/24" ] advertise=yes',
        "/routing ospf interface-template set [ find area=ospf-v2-0.0.0.0 and interfaces=uplink ] type=broadcast",
        "/routing ospf interface-template set [ find area=ospf-v2-0.0.0.0 and interfaces=ether1 ] priority=128 type=broadcast",
        "/routing ospf interface-template set [ find area=ospf-v2-0.0.0.1 and interfaces=servers ] priority=128",
        '/routing ospf static-neighbor remove [ find area=ospf-v2-0.0.0.0 and address="203.0.113.1%uplink" ]',
        '/routing ospf static-neighbor remove [ find area=ospf-v2-0.0.0.0 and address="198.51.100.1%ether1" ]',
    ]);
});

test("Junos, FortiOS, and Raisecom ROS refuse ranges, priorities, and point-to-multipoint and NBMA links until one of their devices runs them", () => {
    const fixtures = {
        junos: "platforms--example-aggregation-switch",
        fortios: "platforms--example-firewall",
        "raisecom-ros": "platforms--example-core-switch",
    };
    const untried = "not built yet, since no device of the platform has run it";
    for (const [platform, fixture] of Object.entries(fixtures))
        expect(Platforms.get(platform).unsupported(withOspf(fixture, designed))).toEqual(
            expect.arrayContaining([
                `routing.ospf.areas.0.0.0.0.interfaces.uplink.network point-to-multipoint, ${untried}`,
                `routing.ospf.areas.0.0.0.0.interfaces.uplink.neighbors, ${untried}`,
                `routing.ospf.areas.0.0.0.0.interfaces.1g-1.priority, ${untried}`,
                `routing.ospf.areas.0.0.0.0.interfaces.1g-1.network non-broadcast, ${untried}`,
                `routing.ospf.areas.0.0.0.1.ranges, ${untried}`,
            ])
        );
});

/** A border router with no link into the backbone, which a virtual link across area 1 joins to it. It sums area 2 into a range at a cost of its own. */
const cutOff: Ospf = {
    areas: {
        "0.0.0.0": { virtual_links: [{ transit_area_id: "0.0.0.1", router_id: "192.0.2.1" }], interfaces: {} },
        "0.0.0.1": { interfaces: { uplink: { network: "point-to-point" } } },
        "0.0.0.2": {
            ranges: [{ prefix: "198.51.100.0/24", advertise: true, cost: 100 }],
            interfaces: { servers: { passive: true } },
        },
    },
};

/** The OSPF of `cutOff` as a CHR on 7.24.6 printed it: the virtual link as an OSPF interface of its own, before the templates. */
const CUT_OFF_PRINTED = `/routing ospf instance
add name=ospf-v2 router-id=192.0.2.255
/routing ospf area
add instance=ospf-v2 name=ospf-v2-0.0.0.0
add area-id=0.0.0.1 instance=ospf-v2 name=ospf-v2-0.0.0.1
add area-id=0.0.0.2 instance=ospf-v2 name=ospf-v2-0.0.0.2
/routing ospf area range
add area=ospf-v2-0.0.0.2 cost=100 prefix=198.51.100.0/24
/routing ospf interface
add area=ospf-v2-0.0.0.0 type=virtual-link vlink-neighbor-id=192.0.2.1 vlink-transit-area=ospf-v2-0.0.0.1
/routing ospf interface-template
add area=ospf-v2-0.0.0.1 interfaces=uplink type=ptp
add area=ospf-v2-0.0.0.2 interfaces=servers passive`;

const cutOffPrinted = () =>
    Platforms.get("routeros")
        .render(withOspf("platforms--example-router", cutOff))
        .replace(/\/routing ospf instance\n[\s\S]*?(?=\n\/(?!routing ospf))/, CUT_OFF_PRINTED);

test("RouterOS writes a virtual link and a range's cost, and plans nothing against how the router prints them", () => {
    const routeros = Platforms.get("routeros");
    const desired = routeros.render(withOspf("platforms--example-router", cutOff));

    expect(desired).toContain(
        "/routing ospf interface\nadd area=ospf-v2-0.0.0.0 type=virtual-link vlink-neighbor-id=192.0.2.1 vlink-transit-area=ospf-v2-0.0.0.1"
    );
    expect(desired).toContain("add advertise=yes area=ospf-v2-0.0.0.2 cost=100 prefix=198.51.100.0/24");
    expect(routeros.plan(desired, cutOffPrinted(), options).steps).toEqual([]);
    expect(routeros.unsupported(withOspf("platforms--example-router", cutOff)).filter((gap) => gap.startsWith("routing.ospf"))).toEqual([]);
});

// On a CHR with 7.24.6, each version's virtual link ran alone, and with both, `print` marked each `duplicate config` and neither came up.
test("RouterOS refuses virtual links where OSPF runs for IPv4 and IPv6", () => {
    const both: Ospf = { ...cutOff, address_families: ["ipv4", "ipv6"] };
    const gaps = Platforms.get("routeros").unsupported(withOspf("platforms--example-router", both));
    expect(gaps.filter((gap) => gap.startsWith("routing.ospf"))).toEqual([
        "routing.ospf.areas.0.0.0.0.virtual_links with OSPF for IPv4 and IPv6, RouterOS 7.24 runs neither the OSPFv2 nor the OSPFv3 virtual link when it has both. Run OSPF for one family on this router",
    ]);
});

test("RouterOS unsets a range's cost, and removes a virtual link before its transit area", () => {
    const joined: Ospf = {
        areas: {
            "0.0.0.0": { interfaces: { uplink: { network: "point-to-point" } } },
            "0.0.0.2": { ranges: [{ prefix: "198.51.100.0/24", advertise: true }], interfaces: { servers: { passive: true } } },
        },
    };
    const desired = Platforms.get("routeros").render(withOspf("platforms--example-router", joined));

    expect(sent("routeros", desired, cutOffPrinted())).toEqual([
        '/routing ospf area range unset [ find area=ospf-v2-0.0.0.2 and prefix="198.51.100.0/24" ] cost',
        "/routing ospf interface-template add area=ospf-v2-0.0.0.0 interfaces=uplink type=ptp",
        "/routing ospf interface remove [ find area=ospf-v2-0.0.0.0 and vlink-transit-area=ospf-v2-0.0.0.1 and vlink-neighbor-id=192.0.2.1 and !dynamic ]",
        "/routing ospf interface-template remove [ find area=ospf-v2-0.0.0.1 and interfaces=uplink ]",
        "/routing ospf area remove [ find name=ospf-v2-0.0.0.1 ]",
    ]);
});

test("Junos, FortiOS, and Raisecom ROS refuse a virtual link and a range's cost until one of their devices runs them", () => {
    const fixtures = {
        junos: "platforms--example-aggregation-switch",
        fortios: "platforms--example-firewall",
        "raisecom-ros": "platforms--example-core-switch",
    };
    const untried = "not built yet, since no device of the platform has run it";
    for (const [platform, fixture] of Object.entries(fixtures))
        expect(Platforms.get(platform).unsupported(withOspf(fixture, cutOff))).toEqual(
            expect.arrayContaining([
                `routing.ospf.areas.0.0.0.0.virtual_links, ${untried}`,
                `routing.ospf.areas.0.0.0.2.ranges[0].cost, ${untried}`,
            ])
        );
});
