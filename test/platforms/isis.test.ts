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

test("FortiOS refuses passive, and another link type on a loopback; Raisecom ROS refuses IS-IS", () => {
    const fortios = withIsis("platforms--example-firewall", core({ passive: true, network: "point-to-point" }, "10g-2"));
    expect(Platforms.get("fortios").unsupported(fortios)).toEqual(
        expect.arrayContaining([
            "routing.isis.interfaces.loopback.passive, FortiOS has none: only a loopback forms no adjacency",
            "routing.isis.interfaces.loopback.network, a loopback's link type is loopback on FortiOS",
        ])
    );

    const isis = core({}, "management");
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
/** HMAC-MD5 with the key. */
const md5 = { algorithm: "hmac-md5", key } as const;

test("Junos signs each level it runs with the level's key or the one for every level, and plans nothing against the cipher it prints", () => {
    const junos = Platforms.get("junos");
    const levels: Isis["levels"] = {
        1: { authentication: { algorithm: "hmac-md5", key: { secret: "ISIS_L1_KEY" } } },
        2: { authentication: md5 },
    };
    const desired = junos.render(withIsis("platforms--example-aggregation-switch", { ...both("10g-48"), levels }));

    for (const statement of [
        "set protocols isis level 1 authentication-key <secret:ISIS_L1_KEY>",
        "set protocols isis level 1 authentication-type md5",
        "set protocols isis level 2 authentication-key <secret:ISIS_KEY>",
        "set protocols isis level 2 authentication-type md5",
    ])
        expect(desired).toContain(statement);

    // A level 2 router signs level 2 only.
    const instance = junos.render(withIsis("platforms--example-aggregation-switch", { ...core({}, "10g-48"), authentication: md5 }));
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
    const desired = render({ ...core({}, "10g-2"), authentication: md5 });

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

    expect(refused({ authentication: md5 })).toContain("routing.isis.authentication, RouterOS 7.24 has no IS-IS authentication");
    expect(refused({ levels: { 2: { authentication: md5 } } })).toContain(
        "routing.isis.levels.2.authentication, RouterOS 7.24 has no IS-IS authentication"
    );
});

test("a level's settings are for a level the device runs, and its key is written once", () => {
    const device = withIsis("platforms--example-router", {
        ...core({}, "uplink"),
        authentication: md5,
        levels: { 1: {}, 2: { authentication: md5 } },
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

test("validate warns that RouterOS on both levels leaks every level 2 route into level 1, as no setting holds one back", () => {
    const warnings = (isis: Isis) =>
        Checks.run([withIsis("platforms--example-router", isis)], undefined)
            .filter((finding) => finding.level === "warning" && finding.message.startsWith("routing.isis"))
            .map((finding) => finding.message);

    expect(warnings(both("uplink"))).toEqual([
        "routing.isis.level_capability is level-1-2: on RouterOS 7.24, a router on both levels leaks every level 2 route into level 1, and nothing holds one back. The level 1 routers of its area learn every route of level 2, and no default route from it",
    ]);
    expect(warnings(core({ passive: true }, "uplink"))).toEqual([]);
    // With `level2_to_level1`, RouterOS refuses the leak itself, which says the same.
    expect(warnings({ ...both("uplink"), level2_to_level1: { import_policy: "loopbacks" } })).toEqual([]);
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

/** The firewall fixture with this IS-IS, and a policy that leaks its loopbacks of each family, a prefix of its own, and nothing else. */
function fortiosLeaking(isis: Isis): Device {
    const fixture = Fixtures.device("platforms--example-firewall");
    return {
        ...fixture,
        routing: {
            ...fixture.routing,
            prefix_sets: {
                ...fixture.routing?.prefix_sets,
                "loopbacks-v4": { prefixes: ["192.0.2.0/25"] },
                "loopbacks-v6": { prefixes: ["2001:db8:2::/48"] },
            },
            policies: {
                ...fixture.routing?.policies,
                loopbacks: [
                    { if: { prefix_set: "loopbacks-v4" }, then: "accept" },
                    { if: { prefix: "198.51.100.128/26" }, then: "accept" },
                    { if: { prefix_set: "loopbacks-v6" }, then: "accept" },
                    { then: "reject" },
                ],
            },
            isis,
        },
    };
}

/** The leak's access lists, and IS-IS on both levels and families, as the firewall printed them: `permit` and `exact-match disable` left out. */
const FORTIOS_LEAK_PRINTED = `config router access-list
    edit "loopbacks"
        config rule
            edit 1
                set prefix 192.0.2.0 255.255.255.128
            next
            edit 2
                set prefix 198.51.100.128 255.255.255.192
                set exact-match enable
            next
            edit 3
                set action deny
                set prefix any
            next
        end
    next
end
config router access-list6
    edit "loopbacks"
        config rule
            edit 1
                set prefix6 2001:db8:2::/48
            next
            edit 2
                set action deny
                set prefix6 any
            next
        end
    next
end
config router isis
    set metric-style wide
    set redistribute-l2 enable
    set redistribute-l2-list "loopbacks"
    set redistribute6-l2 enable
    set redistribute6-l2-list "loopbacks"
    config isis-net
        edit 1
            set net 49.0001.1920.0000.2255.00
        next
    end
    config isis-interface
        edit "loopback"
            set status enable
            set status6 enable
            set network-type loopback
            set wide-metric-l1 50
            set wide-metric-l2 50
        next
        edit "port6"
            set status enable
            set status6 enable
            set wide-metric-l1 200
            set wide-metric-l2 200
        next
    end
end
`;

// A FG-3700D on 6.2.2 took a prefix list for the leak as `entry not found in datasource`. No IS-IS neighbor sent it a level 2 route: IS-IS takes neither a link between VDOMs nor a GRE tunnel.
test("FortiOS leaks level 2 routes into level 1 through an access list for each family, experimentally, and plans nothing against how the firewall printed them", () => {
    const fortios = Platforms.get("fortios");
    const sections = /^config router (?:access-list6?|isis)\n[\s\S]*?^end\n/gm;
    const render = (isis: Isis) => fortios.render(fortiosLeaking(isis)).match(sections)!.join("");
    const device = fortiosLeaking({ ...both("10g-2"), level2_to_level1: { import_policy: "loopbacks" } });

    expect(fortios.experimental!(device)).toContain("routing.isis.level2_to_level1");
    expect(fortios.unsupported(device).filter((gap) => gap.startsWith("routing.isis"))).toEqual([]);
    expect(sent("fortios", render({ ...both("10g-2"), level2_to_level1: { import_policy: "loopbacks" } }), FORTIOS_LEAK_PRINTED)).toEqual(
        []
    );

    // Without IPv6, its leak goes, then its list. The firewall took each line, and planned nothing after.
    const ipv4: Isis = { ...both("10g-2"), address_families: ["ipv4"], level2_to_level1: { import_policy: "loopbacks" } };
    expect(sent("fortios", render(ipv4), FORTIOS_LEAK_PRINTED)).toEqual([
        "config router isis",
        "unset redistribute6-l2-list",
        "unset redistribute6-l2",
        "config isis-interface",
        'edit "loopback"',
        "unset status6",
        "next",
        'edit "port6"',
        "unset status6",
        "next",
        "end",
        "end",
        "config router access-list6",
        'delete "loopbacks"',
        "end",
    ]);

    // Without the leak, both lists go after it.
    expect(sent("fortios", render(both("10g-2")), FORTIOS_LEAK_PRINTED)).toEqual([
        "config router isis",
        "unset redistribute6-l2-list",
        "unset redistribute6-l2",
        "unset redistribute-l2-list",
        "unset redistribute-l2",
        "end",
        "config router access-list6",
        'delete "loopbacks"',
        "end",
        "config router access-list",
        'delete "loopbacks"',
        "end",
    ]);
});

test("FortiOS refuses a prefix length in the leak's policy, which an access list can't match", () => {
    const device = fortiosLeaking({ ...both("10g-2"), level2_to_level1: { import_policy: "loopbacks" } });
    const policies = {
        ...device.routing?.policies,
        loopbacks: [{ call: "short" }],
        short: [{ if: { prefix_length: { max: 24 } }, then: "accept" as const }],
    };

    expect(Platforms.get("fortios").unsupported({ ...device, routing: { ...device.routing, policies } })).toContain(
        "routing.policies.short[0].if.prefix_length, in routing.isis.level2_to_level1: FortiOS leaks through an access list, which matches no prefix length. Match prefix or prefix_set"
    );
});

test("Junos routes IPv6 in a topology of its own with the interface's one metric, experimentally, and plans nothing against how the switch printed it", () => {
    const junos = Platforms.get("junos");
    const single: Isis = { ...core({ passive: true }, "10g-48"), address_families: ["ipv4", "ipv6"] };
    const device = withIsis("platforms--example-aggregation-switch", { ...single, multi_topology: true });
    const desired = junos.render(device);
    expect(junos.experimental!(device)).toContain("routing.isis.multi_topology");

    // As `show protocols isis | display set` printed them in the candidate of a `commit check` on a QFX5100. Nothing was committed.
    const printed = `set protocols isis interface xe-0/0/47.0 level 2 metric 100
set protocols isis interface xe-0/0/47.0 level 2 ipv6-unicast-metric 100
set protocols isis interface xe-0/0/47.0 point-to-point
set protocols isis interface lo0.0 passive
set protocols isis level 1 disable
set protocols isis level 2 wide-metrics-only
set protocols isis topologies ipv6-unicast
`;
    const others = desired
        .split("\n")
        .filter((line) => !line.startsWith("set protocols isis "))
        .join("\n");
    expect(sent("junos", desired, `${others}\n${printed}`)).toEqual([]);

    expect(sent("junos", junos.render(withIsis("platforms--example-aggregation-switch", single)), desired)).toEqual([
        "delete protocols isis topologies",
        "delete protocols isis interface xe-0/0/47.0 level 2 ipv6-unicast-metric",
    ]);
});

test("RouterOS and FortiOS refuse multi-topology, Raisecom ROS refuses IS-IS, and IS-IS needs IPv6 for it", () => {
    const isis: Isis = { ...core({}, "uplink"), address_families: ["ipv4", "ipv6"], multi_topology: true };
    expect(Platforms.get("routeros").unsupported(withIsis("platforms--example-router", isis))).toContain(
        "routing.isis.multi_topology, RouterOS 7.24 routes IPv6 in IPv4's topology only"
    );
    const fortios = withIsis("platforms--example-firewall", { ...isis, interfaces: { "10g-2": {} } });
    expect(Platforms.get("fortios").unsupported(fortios)).toContain(
        "routing.isis.multi_topology, FortiOS routes IPv6 in IPv4's topology only"
    );
    expect(Platforms.get("raisecom-ros").unsupported(withIsis("platforms--example-core-switch", isis))).toContain("routing.isis");

    const ipv4Only = withIsis("platforms--example-router", { ...core({}, "uplink"), multi_topology: true });
    const findings = Checks.run([ipv4Only], undefined).filter((finding) => finding.message.startsWith("routing.isis"));
    expect(findings.map((finding) => finding.message)).toEqual([
        "routing.isis.multi_topology is on, but IS-IS routes no IPv6 to put in a topology of its own. Add ipv6 to address_families, or remove multi_topology",
    ]);
});

test("Junos leaks level 2 routes into level 1 through an IS-IS export policy that runs the leak's policy, experimentally, and plans nothing against how the switch printed it", () => {
    const junos = Platforms.get("junos");
    const fixture = Fixtures.device("platforms--example-aggregation-switch");
    const leaking = (isis: Isis): Device => ({
        ...fixture,
        routing: {
            ...fixture.routing,
            prefix_sets: { ...fixture.routing?.prefix_sets, loopbacks: { prefixes: ["192.0.2.0/24"] } },
            policies: {
                ...fixture.routing?.policies,
                loopbacks: [{ if: { prefix_set: "loopbacks" }, then: "accept" }, { then: "reject" }],
            },
            isis,
        },
    });
    const isis: Isis = { ...both("10g-48"), address_families: ["ipv4"] };
    const device = leaking({ ...isis, level2_to_level1: { import_policy: "loopbacks" } });
    const desired = junos.render(device);
    expect(junos.experimental!(device)).toContain("routing.isis.level2_to_level1");
    expect(junos.unsupported(device).filter((field) => field.startsWith("routing.isis"))).toEqual([]);

    // As `show | display set` printed them in the candidate of a `commit check` on a QFX5100 (21.4R3-S8.5). Nothing was committed.
    const printed = `set policy-options policy-statement circuit-isis-level2-to-level1 from protocol isis
set policy-options policy-statement circuit-isis-level2-to-level1 from level 2
set policy-options policy-statement circuit-isis-level2-to-level1 from policy loopbacks
set policy-options policy-statement circuit-isis-level2-to-level1 to protocol isis
set policy-options policy-statement circuit-isis-level2-to-level1 to level 1
set policy-options policy-statement circuit-isis-level2-to-level1 then accept
set policy-options policy-statement loopbacks term 1 from prefix-list-filter loopbacks orlonger
set policy-options policy-statement loopbacks term 1 then accept
set policy-options policy-statement loopbacks term 2 then reject
set protocols isis export circuit-isis-level2-to-level1
`;
    const leak = /circuit-isis-level2-to-level1|policy-statement loopbacks /;
    const others = desired
        .split("\n")
        .filter((line) => !leak.test(line))
        .join("\n");
    expect(sent("junos", desired, `${others}\n${printed}`)).toEqual([]);

    // Without the leak, its export goes, and so do its policy and the leak's own, which nothing else uses. The commit checks them together.
    expect(sent("junos", junos.render(leaking(isis)), desired)).toEqual([
        "delete policy-options policy-statement circuit-isis-level2-to-level1",
        "delete policy-options policy-statement loopbacks",
        "delete protocols isis export",
    ]);
});

/** HMAC-SHA-1 with the key under key ID 1. */
const sha1 = { algorithm: "hmac-sha-1", key_id: 1, key } as const;

test("Junos signs a level with HMAC-SHA-1 from a key chain, experimentally, and plans nothing against how the switch printed it", () => {
    const junos = Platforms.get("junos");
    const device = withIsis("platforms--example-aggregation-switch", {
        ...both("10g-48"),
        levels: { 1: { authentication: md5 }, 2: { authentication: sha1 } },
    });
    const desired = junos.render(device);
    expect(junos.experimental!(device)).toContain("routing.isis.levels.2.authentication.algorithm hmac-sha-1");

    const chain = "set security authentication-key-chains key-chain circuit-isis-l2-keys key 1";
    for (const statement of [
        "set protocols isis level 1 authentication-key <secret:ISIS_KEY>",
        "set protocols isis level 1 authentication-type md5",
        "set protocols isis level 2 authentication-key-chain circuit-isis-l2-keys",
        `${chain} secret <secret:ISIS_KEY>`,
        `${chain} start-time 2001-1-1.00:00:00`,
        `${chain} algorithm hmac-sha-1`,
        `${chain} options isis-enhanced`,
    ])
        expect(desired).toContain(statement);

    // As the switch printed them in the candidate of a `commit check` (21.4R3-S8.5): each key as a `$9$` cipher, and the start time in the switch's time zone. Nothing was committed.
    const printed = desired
        .replace("authentication-key <secret:ISIS_KEY>", 'authentication-key "$9$HmPQtpBRclP5hreMN-qmfT36tu1SyKO1"')
        .replace("secret <secret:ISIS_KEY>", 'secret "$9$OtF6REyXxdw2aEcYoJU.m1RhSevX7Vg4Z"')
        .replace("start-time 2001-1-1.00:00:00", 'start-time "2001-1-1.00:00:00 +0700"');
    expect(sent("junos", desired, printed)).toEqual([]);

    // From HMAC-MD5 to HMAC-SHA-1 on level 1: the level's own key goes, and a key chain of its own comes.
    const changed = junos.render(
        withIsis("platforms--example-aggregation-switch", {
            ...both("10g-48"),
            levels: { 1: { authentication: sha1 }, 2: { authentication: sha1 } },
        })
    );
    expect(sent("junos", changed, printed)).toEqual([
        "delete protocols isis level 1 authentication-key",
        "delete protocols isis level 1 authentication-type",
        "set protocols isis level 1 authentication-key-chain circuit-isis-l1-keys",
        "set security authentication-key-chains key-chain circuit-isis-l1-keys key 1 secret <secret:ISIS_KEY>",
        "set security authentication-key-chains key-chain circuit-isis-l1-keys key 1 start-time 2001-1-1.00:00:00",
        "set security authentication-key-chains key-chain circuit-isis-l1-keys key 1 algorithm hmac-sha-1",
        "set security authentication-key-chains key-chain circuit-isis-l1-keys key 1 options isis-enhanced",
    ]);
});

test("Junos 21.4 refuses HMAC-SHA2 and a key ID over 63, FortiOS 6.2 signs IS-IS with HMAC-MD5 only, and a key ID is two octets", () => {
    const sha256 = { algorithm: "hmac-sha-256", key_id: 64, key } as const;
    const junos = withIsis("platforms--example-aggregation-switch", { ...core({}, "10g-48"), levels: { 2: { authentication: sha256 } } });
    expect(Platforms.get("junos").unsupported(junos)).toEqual(
        expect.arrayContaining([
            "routing.isis.levels.2.authentication.algorithm hmac-sha-256, Junos 21.4 signs IS-IS with hmac-md5 or hmac-sha-1 only",
            "routing.isis.levels.2.authentication.key_id 64, a Junos key chain numbers its keys from 0 to 63",
        ])
    );

    const fortios = withIsis("platforms--example-firewall", { ...core({}, "10g-2"), authentication: sha1 });
    expect(Platforms.get("fortios").unsupported(fortios)).toContain(
        "routing.isis.authentication.algorithm hmac-sha-1, FortiOS 6.2 signs IS-IS with hmac-md5 only"
    );

    const device = withIsis("platforms--example-router", { ...core({}, "uplink"), authentication: { ...sha1, key_id: 65_536 } });
    const findings = Checks.run([device], undefined).filter((finding) => finding.message.startsWith("routing.isis"));
    expect(findings.map((finding) => finding.message)).toEqual([
        "routing.isis.authentication.key_id is 65536: write a whole number from 0 to 65535",
    ]);
});
