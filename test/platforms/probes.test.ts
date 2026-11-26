// ICMP probes. RouterOS's ran on the CI CHRs (7.24.6). Junos's passed `commit check` in a candidate on a QFX5100 (21.4R3-S8.5). FortiOS's were set, changed, and removed on a FortiGate 3700D (6.2.2). VRP's ran on a CE6855 (V200R005C00SPC800) committed with `commit trial`, and their change and removal went into a candidate. The lines each device printed are fed to the adapters.

import { expect, test } from "bun:test";
import { Checks } from "../../src/checks";
import type { Device, Probe } from "../../src/model";
import { Platforms } from "../../src/platforms";
import { Fixtures } from "../fixtures";

const options = { secrets: false, rollback: 10 };

/** A fixture's device with these probes. */
function probing(fixture: string, probes: Record<string, Probe>): Device {
    const device = Fixtures.device(fixture);
    return { ...device, monitoring: { ...device.monitoring, probes } };
}

const sent = (platform: string, desired: string, current: string) =>
    Platforms.get(platform)
        .plan(desired, current, options)
        .steps.flatMap((step) => step.send);

const PROBES: Record<string, Probe> = {
    "to-b": { target: "192.0.2.2", interval: 5 },
    "from-src": { target: "192.0.2.2", interval: 90, source_address: "192.0.2.1" },
    "in-vrf": { target: "192.0.2.6", interval: 3600, vrf: "lab" },
    v6: { target: "2001:0db8:0:1:0:0:0:2", interval: 10, source_address: "2001:db8:0:1::1" },
};

test("a probe pings an address, from one of its family, every whole number of seconds", () => {
    const device = probing("platforms--example-router", {
        half: { target: "192.0.2.2", interval: 1.5 },
        none: { target: "192.0.2.256", interval: 0 },
        mixed: { target: "2001:db8::2", interval: 10, source_address: "192.0.2.1" },
    });
    const found = Checks.run([device], undefined)
        .map((finding) => finding.message)
        .filter((message) => message.startsWith("monitoring.probes"));

    expect(found).toEqual([
        "monitoring.probes.half.interval 1.5: write a whole number of seconds, from 1",
        "monitoring.probes.none.target: '192.0.2.256' is not an address",
        "monitoring.probes.none.interval 0: write a whole number of seconds, from 1",
        "monitoring.probes.mixed.source_address 192.0.2.1 and target 2001:db8::2 differ in family",
    ]);
});

test("RouterOS runs each probe as a Netwatch ICMP probe, and plans nothing against how the CHR printed them", () => {
    const routeros = Platforms.get("routeros");
    const device = probing("platforms--example-router", PROBES);
    const desired = routeros.render(device);

    expect(desired).toContain(
        [
            "/tool netwatch",
            "add host=192.0.2.2 interval=5s name=to-b type=icmp",
            "add host=192.0.2.2 interval=1m30s name=from-src src-address=192.0.2.1 type=icmp",
            "add host=192.0.2.6@lab interval=1h name=in-vrf type=icmp",
            "add host=2001:db8:0:1::2 interval=10s name=v6 src-address=2001:db8:0:1::1 type=icmp",
        ].join("\n")
    );
    expect(routeros.unsupported(device)).toEqual(routeros.unsupported(Fixtures.device("platforms--example-router")));

    // As the CHR printed them in the 5 minutes after it booted, when Netwatch starts no probe.
    const waiting = "# Warning: probe waiting startup-delay=5m; 4m33s remaining";
    const printed = desired.replace(/^(add host=.* type=icmp)$/gm, `${waiting}\n$1`);
    expect(sent("routeros", desired, printed)).toEqual([]);

    // A source the config doesn't write is unset, as an empty one prints `src-address=""`.
    const sourced = desired.replace(
        "add host=192.0.2.2 interval=5s name=to-b",
        "add host=192.0.2.2 interval=5s name=to-b src-address=192.0.2.9"
    );
    expect(sent("routeros", desired, sourced)).toEqual(["/tool netwatch unset [ find name=to-b ] src-address"]);

    const gone = routeros.render(Fixtures.device("platforms--example-router"));
    expect(sent("routeros", gone, desired).filter((line) => line.startsWith("/tool netwatch"))).toEqual([
        "/tool netwatch remove [ find name=to-b ]",
        "/tool netwatch remove [ find name=from-src ]",
        "/tool netwatch remove [ find name=in-vrf ]",
        "/tool netwatch remove [ find name=v6 ]",
    ]);
});

test("Junos runs each probe as an RPM test of owner circuit, experimental, and plans nothing against the candidate's printout", () => {
    const junos = Platforms.get("junos");
    const device = probing("platforms--example-aggregation-switch", PROBES);
    const desired = junos.render(device);
    const tests = desired.split("\n").filter((line) => line.startsWith("set services rpm "));

    expect(tests).toEqual([
        "set services rpm probe circuit test to-b probe-type icmp-ping",
        "set services rpm probe circuit test to-b target address 192.0.2.2",
        "set services rpm probe circuit test to-b test-interval 5",
        "set services rpm probe circuit test from-src probe-type icmp-ping",
        "set services rpm probe circuit test from-src target address 192.0.2.2",
        "set services rpm probe circuit test from-src test-interval 90",
        "set services rpm probe circuit test from-src source-address 192.0.2.1",
        "set services rpm probe circuit test in-vrf probe-type icmp-ping",
        "set services rpm probe circuit test in-vrf target address 192.0.2.6",
        "set services rpm probe circuit test in-vrf test-interval 3600",
        "set services rpm probe circuit test in-vrf routing-instance lab",
        "set services rpm probe circuit test v6 probe-type icmp6-ping",
        "set services rpm probe circuit test v6 target inet6-address 2001:db8:0:1::2",
        "set services rpm probe circuit test v6 test-interval 10",
        "set services rpm probe circuit test v6 inet6-options source-address 2001:db8:0:1::1",
    ]);
    expect(junos.experimental!(device)).toEqual(expect.arrayContaining(Object.keys(PROBES).map((name) => `monitoring.probes.${name}`)));
    expect(sent("junos", desired, desired)).toEqual([]);

    // A test whose source and VRF go, as the QFX5100's candidate took it.
    const plain = probing("platforms--example-aggregation-switch", { ...PROBES, "from-src": { target: "192.0.2.2", interval: 90 } });
    expect(sent("junos", junos.render(plain), desired)).toEqual(["delete services rpm probe circuit test from-src source-address"]);

    const long = "a-test-name-of-thirty-three-chars";
    expect(junos.unsupported(probing("platforms--example-aggregation-switch", { [long]: PROBES["to-b"]! }))).toContain(
        `monitoring.probes.${long}, the platform takes a test name of 32 characters at most`
    );
});

test("FortiOS runs each probe as a link monitor that follows the routing table and changes nothing when it fails", () => {
    const fortios = Platforms.get("fortios");
    const { "in-vrf": _inVrf, ...probes } = PROBES;
    const device = probing("platforms--example-firewall", probes);
    const desired = fortios.render(device);

    expect(desired).toContain(`config system link-monitor
    edit "to-b"
        set server "192.0.2.2"
        set interval 5000
        set update-cascade-interface disable
        set update-static-route disable
    next
    edit "from-src"
        set server "192.0.2.2"
        set source-ip 192.0.2.1
        set interval 90000
        set update-cascade-interface disable
        set update-static-route disable
    next
    edit "v6"
        set addr-mode ipv6
        set server "2001:db8:0:1::2"
        set protocol ping6
        set source-ip6 2001:db8:0:1::1
        set interval 10000
        set update-cascade-interface disable
        set update-static-route disable
    next
end`);
    expect(fortios.unsupported(device)).toEqual(fortios.unsupported(Fixtures.device("platforms--example-firewall")));

    // As the FG-3700D printed an IPv6 link monitor: its source after the rest.
    const printed = desired.replace(
        "        set source-ip6 2001:db8:0:1::1\n        set interval 10000\n        set update-cascade-interface disable\n        set update-static-route disable\n",
        "        set interval 10000\n        set update-cascade-interface disable\n        set update-static-route disable\n        set source-ip6 2001:db8:0:1::1\n"
    );
    expect(printed).not.toEqual(desired);
    expect(sent("fortios", desired, printed)).toEqual([]);

    const refused = fortios.unsupported(
        probing("platforms--example-firewall", {
            "in-vrf": PROBES["in-vrf"]!,
            "a-link-monitor-name-of-36-characters": { target: "192.0.2.2", interval: 3601 },
        })
    );
    expect(refused.filter((gap) => gap.startsWith("monitoring.probes"))).toEqual([
        "monitoring.probes.in-vrf.vrf, the platform's link monitor has no VRF setting: it probes in the main table",
        "monitoring.probes.a-link-monitor-name-of-36-characters, the platform takes a link monitor name of 35 characters at most",
        "monitoring.probes.a-link-monitor-name-of-36-characters.interval 3601, from 1 to 3600 seconds",
    ]);
});

test("Raisecom ROS refuses a probe, and says why", () => {
    const raisecom = Platforms.get("raisecom-ros").unsupported(probing("platforms--example-core-switch", { "to-b": PROBES["to-b"]! }));
    expect(raisecom).toContain(
        "monitoring.probes.to-b, ROS 6.5.2 has no ICMP probe: its SLA operations measure Ethernet (Y.1731), MPLS, and TWAMP"
    );
});

/** VRP's tests of `VRP_PROBES`, as a CE6855 on V200R005C00SPC800 printed them, committed with `commit trial` and run. */
const VRP_PROBES: Record<string, Probe> = {
    from_src: { target: "198.51.100.1", interval: 60, source_address: "192.0.2.1" },
    in_vrf: { target: "192.0.2.40", interval: 30, vrf: "lab" },
};

const VRP_PRINTED = `nqa test-instance circuit from_src
 test-type icmp
 destination-address ipv4 198.51.100.1
 source-address ipv4 192.0.2.1
 frequency 60
 start now
#
nqa test-instance circuit in_vrf
 test-type icmp
 destination-address ipv4 192.0.2.40
 vpn-instance lab
 frequency 30
 start now
#
`;

test("VRP runs an NQA test for each probe, and plans nothing against how a CE6855 printed them", () => {
    const vrp = Platforms.get("vrp");
    const device = probing("platforms--example-switch", VRP_PROBES);
    device.routing = { ...device.routing, vrfs: { ...device.routing?.vrfs, lab: {} } };
    const desired = vrp.render(device);

    expect(vrp.unsupported(device)).toEqual([]);
    expect(desired).toContain(VRP_PRINTED);
    expect(sent("vrp", desired, desired)).toEqual([]);
});

test("VRP stops a test before it changes it and starts it again, and stops one before it deletes it, last", () => {
    const vrp = Platforms.get("vrp");
    const before = vrp.render(probing("platforms--example-switch", { from_src: VRP_PROBES.from_src! }));
    const changed = vrp.render(probing("platforms--example-switch", { from_src: { target: "198.51.100.3", interval: 90 } }));

    expect(sent("vrp", changed, before)).toEqual([
        "nqa test-instance circuit from_src",
        "undo start",
        "undo source-address",
        "destination-address ipv4 198.51.100.3",
        "frequency 90",
        "start now",
        "quit",
    ]);

    const steps = vrp.plan(vrp.render(Fixtures.device("platforms--example-switch")), before, options).steps;
    expect(steps.slice(-2)).toEqual([
        {
            title: "nqa test-instance circuit from_src",
            show: ["- start now"],
            send: ["nqa test-instance circuit from_src", "undo start", "quit"],
        },
        {
            title: "ICMP probes no longer used",
            show: ["- nqa test-instance circuit from_src"],
            send: ["undo nqa test-instance circuit from_src"],
        },
    ]);
});

test("VRP refuses a test name the switch refuses, and IPv6", () => {
    const refused = Platforms.get("vrp").unsupported(probing("platforms--example-switch", { "to-b": PROBES["to-b"]!, v6: PROBES.v6! }));
    expect(refused.filter((gap) => gap.startsWith("monitoring.probes"))).toEqual([
        "monitoring.probes.to-b, a test name of letters, digits, and '_', 32 characters at most: the switch refuses a '-'",
        "monitoring.probes.v6.target, IPv6 is not tested",
        "monitoring.probes.v6.source_address, IPv6 is not tested",
    ]);
});
