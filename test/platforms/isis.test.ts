// IS-IS, tested on RouterOS 7.24.6, Junos 21.4R3, and FortiOS 6.2.2 (TRAPS.md). On each, a passive loopback and a point-to-point link were set, changed to both levels, both families, and broadcast links with metrics, and set back. The lines each device printed are fed to the adapters, with names and addresses replaced.

import { expect, test } from "bun:test";
import { Checks } from "../../src/checks";
import type { Device } from "../../src/model";
import { Platforms } from "../../src/platforms";
import { Fixtures } from "../fixtures";

type Isis = NonNullable<NonNullable<Device["routing"]>["isis"]>;

const options = { secrets: false, rollback: 10 };

/** A fixture's device with only this IS-IS. */
function withIsis(fixture: string, isis: Isis): Device {
    const device = Fixtures.device(fixture);
    return { ...device, routing: { ...device.routing, isis } };
}

/** A level 2 router for IPv4: a passive loopback, and `link` point-to-point. */
const core = (loopback: Isis["interfaces"][string], link: string): Isis => ({
    net: "49.0001.1920.0000.2255.00",
    level_capability: "level-2",
    address_families: ["ipv4"],
    interfaces: { loopback, [link]: { network: "point-to-point", metric: 100 } },
});

/** The same router on both levels and both families, its links broadcast with metrics. */
const both = (link: string): Isis => ({
    net: "49.0001.1920.0000.2255.00",
    level_capability: "level-1-2",
    address_families: ["ipv4", "ipv6"],
    interfaces: { loopback: { metric: 50 }, [link]: { metric: 200 } },
});

const sent = (platform: string, desired: string, current: string) =>
    Platforms.get(platform)
        .plan(desired, current, options)
        .steps.flatMap((step) => step.send);

/** The IS-IS menus of a RouterOS render, as the router printed them: flags last, `ptp` metrics under `ptp`. */
const ROUTEROS_PRINTED = `/routing isis instance
add afi=ip areas=49.0001 metric-type=wide name=isis system-id=1920.0000.2255
/routing isis interface-template
add instance=isis interfaces=loopback levels=l2 passive
add instance=isis interfaces=uplink levels=l2 ptp ptp.l2.metric=100
`;

const routerosIsis = (render: string) => render.replace(/\/routing isis instance\n[\s\S]*?(?=\/(?!routing isis))/, ROUTEROS_PRINTED);

test("RouterOS writes the NET as areas and a system ID, and plans nothing against how the router prints it", () => {
    const routeros = Platforms.get("routeros");
    const desired = routeros.render(withIsis("platforms--example-router", core({ passive: true }, "uplink")));

    expect(desired).toContain("add afi=ip areas=49.0001 metric-type=wide name=isis system-id=1920.0000.2255");
    expect(desired).toContain("add ptp instance=isis interfaces=uplink levels=l2 ptp.l2.metric=100");
    expect(routeros.plan(desired, routerosIsis(desired), options).steps).toEqual([]);
});

test("RouterOS unsets a metric before a template's link type or passive changes, which the router refuses beside it", () => {
    const routeros = Platforms.get("routeros");
    const desired = routeros.render(withIsis("platforms--example-router", core({ passive: true }, "uplink")));
    const changed = routeros.render(withIsis("platforms--example-router", both("uplink")));

    expect(sent("routeros", changed, routerosIsis(desired))).toEqual([
        "/routing isis instance set [ find name=isis ] afi=ip,ipv6",
        "/routing isis interface-template set [ find instance=isis and interfaces=loopback ] !passive levels=l1,l2 bcast.l1.metric=50 bcast.l2.metric=50",
        "/routing isis interface-template unset [ find instance=isis and interfaces=uplink ] ptp.l2.metric",
        "/routing isis interface-template set [ find instance=isis and interfaces=uplink ] !ptp levels=l1,l2 bcast.l1.metric=200 bcast.l2.metric=200",
    ]);
    expect(routeros.unsupported(withIsis("platforms--example-router", core({ passive: true, metric: 10 }, "uplink")))).toContain(
        "routing.isis.interfaces.loopback.metric with passive, RouterOS refuses a metric on a passive interface"
    );
});

test("Junos puts the NET on lo0.0 and the ISO family on each interface, and runs wide metrics on its levels only", () => {
    const junos = Platforms.get("junos");
    const desired = junos.render(withIsis("platforms--example-aggregation-switch", core({ passive: true }, "10g-48")));

    for (const statement of [
        "set interfaces lo0 unit 0 family iso address 49.0001.1920.0000.2255.00",
        "set interfaces xe-0/0/47 unit 0 family iso",
        "set protocols isis level 1 disable",
        "set protocols isis level 2 wide-metrics-only",
        "set protocols isis no-ipv6-routing",
        "set protocols isis interface lo0.0 passive",
        "set protocols isis interface xe-0/0/47.0 point-to-point",
        "set protocols isis interface xe-0/0/47.0 level 2 metric 100",
    ])
        expect(desired).toContain(statement);

    const changed = junos.render(withIsis("platforms--example-aggregation-switch", both("10g-48")));
    expect(sent("junos", changed, desired)).toEqual([
        "delete protocols isis level 1 disable",
        "delete protocols isis no-ipv6-routing",
        "delete protocols isis interface lo0.0 passive",
        "delete protocols isis interface xe-0/0/47.0 point-to-point",
        "delete protocols isis interface xe-0/0/47.0 level 2 metric 100",
        "set protocols isis level 1 wide-metrics-only",
        "set protocols isis interface lo0.0 level 1 metric 50",
        "set protocols isis interface lo0.0 level 2 metric 50",
        "set protocols isis interface xe-0/0/47.0 level 1 metric 200",
        "set protocols isis interface xe-0/0/47.0 level 2 metric 200",
    ]);

    // An interface's levels are named: `delete ... level` alone is a syntax error, so each goes on its own.
    const plain = { ...core({}, "10g-48"), interfaces: { loopback: {}, "10g-48": {} } };
    const withoutMetric = junos.render(withIsis("platforms--example-aggregation-switch", plain));
    expect(sent("junos", withoutMetric, changed)).toEqual(
        expect.arrayContaining([
            "delete protocols isis interface xe-0/0/47.0 level 1",
            "delete protocols isis interface xe-0/0/47.0 level 2",
            "delete protocols isis interface lo0.0 level 1",
            "delete protocols isis interface lo0.0 level 2",
        ])
    );
});

test("FortiOS writes a loopback's link type as loopback, and plans nothing against how the firewall prints IS-IS", () => {
    const fortios = Platforms.get("fortios");
    const section = /^config router isis\n[\s\S]*?^end\n/m;
    const desired = fortios.render(withIsis("platforms--example-firewall", core({}, "10g-2"))).match(section)![0];

    // As the firewall printed it, with the empty lists it prints for every protocol it redistributes.
    const redistributed = ["connected", "rip", "ospf", "bgp", "static"];
    const printed = `config router isis
    set is-type level-2-only
    set metric-style wide
    config isis-net
        edit 1
            set net 49.0001.1920.0000.2255.00
        next
    end
    config isis-interface
        edit "loopback"
            set status enable
            set network-type loopback
        next
        edit "port6"
            set status enable
            set network-type point-to-point
            set wide-metric-l2 100
        next
    end
${["redistribute", "redistribute6"].flatMap((list) => redistributed.map((source) => `    config ${list} "${source}"\n    end\n`)).join("")}end
`;
    expect(sent("fortios", desired, printed)).toEqual([]);

    const changed = fortios.render(withIsis("platforms--example-firewall", both("10g-2"))).match(section)![0];
    expect(sent("fortios", changed, printed)).toEqual([
        "config router isis",
        "set is-type level-1-2",
        "config isis-interface",
        'edit "loopback"',
        "set status6 enable",
        "set wide-metric-l1 50",
        "set wide-metric-l2 50",
        "next",
        'edit "port6"',
        "unset network-type",
        "set status6 enable",
        "set wide-metric-l1 200",
        "set wide-metric-l2 200",
        "next",
        "end",
        "end",
    ]);
});

test("FortiOS refuses passive, and another link type on a loopback; VRP and Raisecom ROS refuse IS-IS", () => {
    const fortios = withIsis("platforms--example-firewall", core({ passive: true, network: "point-to-point" }, "10g-2"));
    expect(Platforms.get("fortios").unsupported(fortios)).toEqual(
        expect.arrayContaining([
            "routing.isis.interfaces.loopback.passive, FortiOS has none: only a loopback forms no adjacency",
            "routing.isis.interfaces.loopback.network, a loopback's link type is loopback on FortiOS",
        ])
    );

    const isis = core({}, "management");
    expect(Platforms.get("vrp").unsupported(withIsis("platforms--example-switch", isis))).toContain("routing.isis");
    expect(Platforms.get("raisecom-ros").unsupported(withIsis("platforms--example-core-switch", isis))).toContain("routing.isis");
});

test("a NET ends in 00 after a system ID of three groups, a metric is wide, and IS-IS stays out of VRFs", () => {
    const device = withIsis("platforms--example-router", {
        net: "49.0001.1920.0000.2255" as Isis["net"],
        level_capability: "level-2",
        address_families: [],
        interfaces: { uplink: { metric: 16_777_215 }, guests: {} },
    });
    const findings = Checks.run([device], undefined).filter((finding) => finding.message.startsWith("routing.isis"));

    expect(findings.map((finding) => finding.message)).toEqual([
        "routing.isis.net is '49.0001.1920.0000.2255': write the area, the system ID of three groups of four hex digits, and 00, such as 49.0001.0102.5500.1001.00",
        "routing.isis.address_families is empty: write ipv4, ipv6, or both",
        "routing.isis.interfaces.uplink.metric is 16777215: write a whole number from 1 to 16777214",
        "routing.isis.interfaces.guests: guests routes in VRF guests, and IS-IS runs in the main table. Remove it from routing.isis.interfaces",
    ]);
});

const key = { secret: "ISIS_KEY" };

test("Junos signs each level it runs with the level's key or the one for every level, and plans nothing against the cipher it prints", () => {
    const junos = Platforms.get("junos");
    const levels = { 1: { authentication: { key: { secret: "ISIS_L1_KEY" } } }, 2: { authentication: { key } } };
    const desired = junos.render(withIsis("platforms--example-aggregation-switch", { ...both("10g-48"), levels }));

    for (const statement of [
        "set protocols isis level 1 authentication-key <secret:ISIS_L1_KEY>",
        "set protocols isis level 1 authentication-type md5",
        "set protocols isis level 2 authentication-key <secret:ISIS_KEY>",
        "set protocols isis level 2 authentication-type md5",
    ])
        expect(desired).toContain(statement);

    // A level 2 router signs level 2 only.
    const instance = junos.render(withIsis("platforms--example-aggregation-switch", { ...core({}, "10g-48"), authentication: { key } }));
    expect(instance).toContain("set protocols isis level 2 authentication-key <secret:ISIS_KEY>");
    expect(instance).not.toContain("level 1 authentication");

    // As the switch printed it in the candidate of a `commit check`, each key as a `$9$` cipher. Nothing was committed.
    const printed = desired
        .replace("authentication-key <secret:ISIS_L1_KEY>", 'authentication-key "$9$OtF6REyXxdw2aEcYoJU.m1RhSevX7Vg4Z"')
        .replace("authentication-key <secret:ISIS_KEY>", 'authentication-key "$9$HmPQtpBRclP5hreMN-qmfT36tu1SyKO1"');
    expect(sent("junos", desired, printed)).toEqual([]);
});

test("FortiOS keeps each level's key in a key chain, which MD5 needs, and unsets a chain before its MD5 mode", () => {
    const fortios = Platforms.get("fortios");
    const sections = /^config router (?:key-chain|isis)\n[\s\S]*?^end\n/gm;
    const render = (isis: Isis) => fortios.render(withIsis("platforms--example-firewall", isis)).match(sections)!.join("");
    const desired = render({ ...core({}, "10g-2"), authentication: { key } });

    // As the firewall printed it, with the key the read redacts: the firewall prints it in clear.
    const signed = `
            set auth-keychain-l2 "circuit-isis-l2"
            set auth-mode-l2 md5`;
    const printed = `config router key-chain
    edit "circuit-isis-l2"
        config key
            edit "1"
                set accept-lifetime 00:00:00 01 01 2001 infinite
                set send-lifetime 00:00:00 01 01 2001 infinite
                set key-string "<redacted>"
            next
        end
    next
end
config router isis
    set is-type level-2-only
    set auth-mode-l2 md5
    set auth-keychain-l2 "circuit-isis-l2"
    set metric-style wide
    config isis-net
        edit 1
            set net 49.0001.1920.0000.2255.00
        next
    end
    config isis-interface
        edit "loopback"
            set status enable
            set network-type loopback${signed}
        next
        edit "port6"
            set status enable
            set network-type point-to-point${signed}
            set wide-metric-l2 100
        next
    end
end
`;
    expect(sent("fortios", desired, printed)).toEqual([]);

    // The firewall refuses `unset auth-keychain-l2` once the MD5 mode is gone.
    const unsigned = render(core({}, "10g-2"));
    const undo = ["unset auth-keychain-l2", "unset auth-mode-l2"];
    expect(sent("fortios", unsigned, printed)).toEqual([
        "config router isis",
        ...undo,
        "config isis-interface",
        'edit "loopback"',
        ...undo,
        "next",
        'edit "port6"',
        ...undo,
        "next",
        "end",
        "end",
        "config router key-chain",
        'delete "circuit-isis-l2"',
        "end",
    ]);
});

test("RouterOS refuses IS-IS authentication, which 7.24 has none of", () => {
    const routeros = Platforms.get("routeros");
    const refused = (isis: Partial<Isis>) =>
        routeros.unsupported(withIsis("platforms--example-router", { ...core({}, "uplink"), ...isis }));

    expect(refused({ authentication: { key } })).toContain("routing.isis.authentication, RouterOS 7.24 has no IS-IS authentication");
    expect(refused({ levels: { 2: { authentication: { key } } } })).toContain(
        "routing.isis.levels.2.authentication, RouterOS 7.24 has no IS-IS authentication"
    );
});

test("a level's settings are for a level the device runs, and its key is written once", () => {
    const device = withIsis("platforms--example-router", {
        ...core({}, "uplink"),
        authentication: { key },
        levels: { 1: {}, 2: { authentication: { key } } },
    });
    const findings = Checks.run([device], undefined).filter((finding) => finding.message.startsWith("routing.isis"));

    expect(findings.map((finding) => finding.message)).toEqual([
        "routing.isis.levels.1: level_capability is level-2, so the device doesn't run level 1. Remove it",
        "routing.isis.levels.2.authentication: routing.isis.authentication signs every level already. Remove one of them",
    ]);
});

test("Junos sets the overload bit, and runs BFD on an interface for each family, as the switch printed them", () => {
    const junos = Platforms.get("junos");
    const isis: Isis = { ...both("10g-48"), overload_bit: true, interfaces: { "10g-48": { network: "point-to-point", bfd: true } } };
    const device = withIsis("platforms--example-aggregation-switch", isis);
    const desired = junos.render(device);

    // As `show protocols isis | display set` printed them in the candidate of a `commit check`. Nothing was committed.
    for (const statement of [
        "set protocols isis overload",
        "set protocols isis interface xe-0/0/47.0 family inet bfd-liveness-detection minimum-interval 300",
        "set protocols isis interface xe-0/0/47.0 family inet6 bfd-liveness-detection minimum-interval 300",
    ])
        expect(desired).toContain(statement);

    const timed = junos.render({ ...device, routing: { ...device.routing, bfd: { interval: 100, multiplier: 5 } } });
    expect(timed).toContain("set protocols isis interface xe-0/0/47.0 family inet bfd-liveness-detection minimum-interval 100");
    expect(timed).toContain("set protocols isis interface xe-0/0/47.0 family inet bfd-liveness-detection multiplier 5");

    const plain = junos.render(
        withIsis("platforms--example-aggregation-switch", { ...both("10g-48"), interfaces: { "10g-48": { network: "point-to-point" } } })
    );
    expect(sent("junos", plain, desired)).toEqual([
        "delete protocols isis overload",
        "delete protocols isis interface xe-0/0/47.0 family inet",
        "delete protocols isis interface xe-0/0/47.0 family inet6",
    ]);
});

test("RouterOS refuses the overload bit and BFD, which its IS-IS has neither of", () => {
    const isis: Isis = { ...core({}, "uplink"), overload_bit: true, interfaces: { uplink: { bfd: true } } };
    expect(Platforms.get("routeros").unsupported(withIsis("platforms--example-router", isis))).toEqual(
        expect.arrayContaining([
            "routing.isis.overload_bit, RouterOS 7.24 has no IS-IS overload bit",
            "routing.isis.interfaces.uplink.bfd, RouterOS 7.24 has no BFD for IS-IS",
        ])
    );
});

test("FortiOS sets the overload bit, and refuses BFD, which its IS-IS has none of", () => {
    const fortios = Platforms.get("fortios");
    const section = /^config router isis\n[\s\S]*?^end\n/m;
    const render = (isis: Isis) => fortios.render(withIsis("platforms--example-firewall", isis)).match(section)![0];
    const desired = render({ ...core({}, "10g-2"), overload_bit: true });

    // As the firewall printed it.
    const printed = `config router isis
    set is-type level-2-only
    set overload-bit enable
    set metric-style wide
    config isis-net
        edit 1
            set net 49.0001.1920.0000.2255.00
        next
    end
    config isis-interface
        edit "loopback"
            set status enable
            set network-type loopback
        next
        edit "port6"
            set status enable
            set network-type point-to-point
            set wide-metric-l2 100
        next
    end
end
`;
    expect(sent("fortios", desired, printed)).toEqual([]);
    expect(sent("fortios", render(core({}, "10g-2")), printed)).toEqual(["config router isis", "unset overload-bit", "end"]);

    const bfd = withIsis("platforms--example-firewall", { ...core({}, "10g-2"), interfaces: { "10g-2": { bfd: true } } });
    expect(fortios.unsupported(bfd)).toContain("routing.isis.interfaces.10g-2.bfd, FortiOS 6.2 has no BFD for IS-IS");
});
