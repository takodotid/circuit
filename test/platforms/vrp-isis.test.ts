// IS-IS on VRP, tried on a CE6855 on V200R005C00SPC800 with a process that has no interface, so it formed no adjacency. Circuit's plan from nothing was committed with `commit trial`, and the plan after it was empty. A change and the removal went into a candidate during the trial, and were cleared. `PRINTED` is what the switch printed, with the names of this file.

import { expect, test } from "bun:test";
import { Checks } from "../../src/checks";
import type { Device, Isis, PolicyRule } from "../../src/model";
import { Platforms } from "../../src/platforms";
import { Vrp } from "../../src/platforms/vrp/index";
import { Fixtures } from "../fixtures";

const vrp = new Vrp();
const options = { secrets: false, rollback: 10 };
const base = Fixtures.device("single-site--switch");
const sent = (desired: string, current: string) => vrp.plan(desired, current, options).steps.flatMap((step) => step.send);

const leak: Isis = {
    net: "49.0001.1920.0000.2255.00",
    level_capability: "level-1-2",
    address_families: ["ipv4", "ipv6"],
    overload_bit: true,
    level2_to_level1: { import_policy: "loopbacks" },
    interfaces: {},
};

const policies: Record<string, PolicyRule[]> = {
    loopbacks: [{ if: { prefix_set: "loopbacks" }, then: "accept" }, { then: "reject" }],
    "other-loopbacks": [{ if: { prefix: "198.51.100.0/24" }, then: "accept" }, { then: "reject" }],
};

/** The single-site switch with this IS-IS. */
function routed(isis: Isis): Device {
    return {
        ...base,
        routing: {
            ...base.routing,
            prefix_sets: { loopbacks: { prefixes: ["192.0.2.0/24", "2001:db8:ffff::/48"] } },
            policies,
            isis,
        },
    };
}

/** The process as the switch printed it: IPv6 in a section of its own, after ` #`, and its prefixes in capitals. */
const PRINTED = `ip ip-prefix loopbacks index 10 permit 192.0.2.0 24 greater-equal 24 less-equal 32
ip ipv6-prefix loopbacks index 10 permit 2001:DB8:FFFF:: 48 greater-equal 48 less-equal 128
#
route-policy loopbacks permit node 10
 if-match ip-prefix loopbacks
 if-match ipv6 address prefix-list loopbacks
#
route-policy loopbacks deny node 20
#
isis 1
 cost-style wide
 network-entity 49.0001.1920.0000.2255.00
 import-route isis level-2 into level-1 filter-policy route-policy loopbacks
 set-overload
 #
 ipv6 enable topology standard
 ipv6 import-route isis level-2 into level-1 filter-policy route-policy loopbacks
 #
#
`;

/** The render with its IS-IS, policies, and lists as the switch printed them. */
const printed = (render: string) => `${render.replace(/^ip ip-prefix [\s\S]*?^isis 1\n[\s\S]*?^#\n/m, "")}${PRINTED}`;

test("VRP leaks level 2 routes into level 1 through the policy, and plans nothing against how the switch prints it", () => {
    const desired = vrp.render(routed(leak));

    expect(desired).toContain(
        [
            "isis 1",
            " cost-style wide",
            " network-entity 49.0001.1920.0000.2255.00",
            " import-route isis level-2 into level-1 filter-policy route-policy loopbacks",
            " set-overload",
            " ipv6 enable topology standard",
            " ipv6 import-route isis level-2 into level-1 filter-policy route-policy loopbacks",
            "#",
        ].join("\n")
    );
    expect(vrp.plan(desired, printed(desired), options).steps).toEqual([]);
    expect(vrp.unsupported(routed(leak))).toEqual([]);
    expect(vrp.experimental(routed(leak))).toEqual([]);
});

test("VRP writes the route-policy before the process, which refuses a policy that does not exist yet", () => {
    const before = vrp.render(base);

    expect(sent(vrp.render(routed(leak)), before)).toEqual([
        "ip ip-prefix loopbacks index 10 permit 192.0.2.0 24 greater-equal 24 less-equal 32",
        "ip ipv6-prefix loopbacks index 10 permit 2001:DB8:FFFF:: 48 greater-equal 48 less-equal 128",
        "route-policy loopbacks deny node 20",
        "quit",
        "route-policy loopbacks permit node 10",
        "if-match ip-prefix loopbacks",
        "if-match ipv6 address prefix-list loopbacks",
        "quit",
        "isis 1",
        "network-entity 49.0001.1920.0000.2255.00",
        "cost-style wide",
        "import-route isis level-2 into level-1 filter-policy route-policy loopbacks",
        "set-overload",
        "ipv6 enable topology standard",
        "ipv6 import-route isis level-2 into level-1 filter-policy route-policy loopbacks",
        "quit",
    ]);
});

test("VRP adds a new NET before it undoes the old one, changes a leak's policy and the topology in place, and removes the process before its policy", () => {
    const desired = vrp.render(routed(leak));
    const changed: Isis = {
        ...leak,
        net: "49.0002.1920.0000.2255.00",
        overload_bit: undefined,
        multi_topology: true,
        level2_to_level1: { import_policy: "other-loopbacks" },
    };

    expect(sent(vrp.render(routed(changed)), printed(desired))).toEqual([
        "ip ip-prefix circuit-prefix-198.51.100.0-24 index 10 permit 198.51.100.0 24",
        "ip ipv6-prefix circuit-no-ipv6 index 10 deny :: 0 less-equal 128",
        "route-policy other-loopbacks deny node 20",
        "quit",
        "route-policy other-loopbacks permit node 10",
        "if-match ip-prefix circuit-prefix-198.51.100.0-24",
        "if-match ipv6 address prefix-list circuit-no-ipv6",
        "quit",
        "isis 1",
        "network-entity 49.0002.1920.0000.2255.00",
        "undo set-overload",
        "undo network-entity 49.0001.1920.0000.2255.00",
        "import-route isis level-2 into level-1 filter-policy route-policy other-loopbacks",
        "ipv6 enable topology ipv6",
        "ipv6 import-route isis level-2 into level-1 filter-policy route-policy other-loopbacks",
        "quit",
        "undo route-policy loopbacks node 20",
        "undo route-policy loopbacks node 10",
    ]);

    // The switch asks before it deletes the process, and the apply answers yes.
    expect(sent(vrp.render(base), printed(desired))).toEqual([
        "undo isis 1",
        "undo route-policy loopbacks node 20",
        "undo route-policy loopbacks node 10",
        "undo ip ipv6-prefix loopbacks index 10",
        "undo ip ip-prefix loopbacks index 10",
    ]);

    const withoutLeak = vrp.render(routed({ ...leak, level2_to_level1: undefined, address_families: ["ipv4"] }));
    expect(sent(withoutLeak, printed(desired))).toEqual(
        expect.arrayContaining([
            "undo ipv6 import-route isis level-2 into level-1",
            "undo ipv6 enable",
            "undo import-route isis level-2 into level-1",
        ])
    );
});

test("VRP runs IS-IS on VLAN interfaces, which is experimental, and refuses what it does not build", () => {
    const isis: Isis = {
        ...leak,
        level_capability: "level-2",
        level2_to_level1: undefined,
        multi_topology: true,
        interfaces: { mgmt: { metric: 100, network: "point-to-point", passive: true } },
    };
    const desired = vrp.render(routed(isis));

    expect(desired).toContain(" is-level level-2\n");
    expect(desired).toContain(
        "interface Vlanif10\n ip address 192.168.10.2 255.255.255.0\n isis enable 1\n isis ipv6 enable 1\n isis circuit-type p2p\n isis cost 100\n isis ipv6 cost 100\n isis silent\n#"
    );
    expect(vrp.experimental(routed(isis))).toEqual(["routing.isis.interfaces.mgmt"]);
    // Each VLAN interface lets go of the process before it goes.
    expect(sent(vrp.render(base), desired)).toEqual([
        "interface Vlanif10",
        "undo isis silent",
        "undo isis ipv6 cost 100",
        "undo isis cost 100",
        "undo isis circuit-type",
        "undo isis ipv6 enable 1",
        "undo isis enable 1",
        "quit",
        "undo isis 1",
        "undo ip ipv6-prefix loopbacks index 10",
        "undo ip ip-prefix loopbacks index 10",
    ]);

    const refused: Isis = {
        ...isis,
        authentication: { algorithm: "hmac-md5", key: { secret: "ISIS_KEY" } },
        interfaces: { mgmt: { bfd: true }, "10g-2": {} },
    };
    expect(vrp.unsupported(routed(refused))).toEqual([
        "routing.isis.authentication, not built yet",
        "routing.isis.interfaces.mgmt.bfd, not built yet",
        "routing.isis.interfaces.10g-2, not a VLAN interface: the platform routes on VLAN interfaces",
    ]);
});

test("only a router on both levels leaks, through a policy that picks prefixes and sets nothing", () => {
    const device: Device = {
        ...routed({ ...leak, level_capability: "level-2" }),
        routing: {
            ...routed(leak).routing,
            isis: { ...leak, level_capability: "level-2" },
            policies: {
                ...policies,
                loopbacks: [{ if: { prefix_set: "loopbacks", as_path_length: { max: 2 } }, set: { med: 10 }, then: "accept" }],
            },
        },
    };

    const messages = Checks.run([device], undefined)
        .map((finding) => finding.message)
        .filter((message) => message.startsWith("routing.isis"));
    expect(messages).toEqual([
        'routing.isis.level2_to_level1: level_capability is level-2, and only a router on both levels leaks level 2 routes into level 1. Remove it, or write level_capability: "level-1-2"',
        "routing.isis.level2_to_level1.import_policy loopbacks: routing.policies.loopbacks[0].if has as_path_length, and a leak picks level 2 routes by their prefix only. Match family, prefix, prefix_set, prefix_length",
        'routing.isis.level2_to_level1.import_policy loopbacks: routing.policies.loopbacks[0].set, and a leaked route keeps what level 2 gave it. Remove set, and write then: "accept" or "reject"',
    ]);
});

test("RouterOS and FortiOS refuse leaking between levels", () => {
    const withLeak = (fixture: string, link: string): Device => {
        const device = Fixtures.device(fixture);
        return {
            ...device,
            routing: {
                ...device.routing,
                policies,
                isis: { ...leak, address_families: ["ipv4"], overload_bit: undefined, interfaces: { [link]: {} } },
            },
        };
    };

    expect(Platforms.get("routeros").unsupported(withLeak("platforms--example-router", "uplink"))).toContain(
        "routing.isis.level2_to_level1, RouterOS 7.24 leaks every level 2 route into level 1, and l1.out-filter-chain holds none back (TRAPS.md)"
    );
    expect(Platforms.get("fortios").unsupported(withLeak("platforms--example-firewall", "10g-2"))).toContain(
        "routing.isis.level2_to_level1, not built yet, since no device of the platform has run it"
    );
});
