// A port's spanning tree, storm control, rate limits, QinQ, and LLDP on Raisecom ROS. The printed blocks are what a RAX721-C-6C48 with ROS 6.5.2 (P300R003C00) printed for a spare port and an unused LAG on 2026-11-20. They were applied in three rounds, with the port kept shut down, and the description is changed.

import { expect, test } from "bun:test";
import { Checks } from "../../src/checks";
import type { Device, Lag, Port } from "../../src/model";
import { Platforms } from "../../src/platforms";
import { Fixtures } from "../fixtures";

const platform = Platforms.get("raisecom-ros");
const coreSwitch = Fixtures.device("platforms--example-core-switch");
const options = { secrets: false, rollback: 0 };

const PORT = "interface tengigabitethernet 1/3/12";
const LAG = "interface port-channel 8";

/** The port before the proof: switched by an earlier one, shut down, and set back to auto speed. */
const BEFORE = `${PORT}
portswitch
shutdown
speed auto
duplex auto
!
`;

/** Round 1: an access port with each setting, and a LAG with no members. */
const PRINTED_1 = `${PORT}
portswitch
description proof
shutdown
switchport access vlan 3999
rate-limit ingress cir 10000
rate-limit egress cir 20000 cbs 100
ip dhcp snooping trust
lldp disable
spanning-tree rootguard enable
spanning-tree edged-port force-true
spanning-tree instance 0 priority 64
speed auto
duplex auto
storm-control mode pps
storm-control broadcast pps 500
storm-control dlf pps 300
!
${LAG}
rate-limit ingress cir 10000
rate-limit egress cir 20000 cbs 100
!
`;

/** Round 2: each setting changed, and the port a QinQ port. */
const PRINTED_2 = `${PORT}
portswitch
description proof
shutdown
switchport access vlan 3999
rate-limit ingress cir 10000
rate-limit egress cir 30000
ip dhcp snooping trust
lldp disable
spanning-tree rootguard enable
spanning-tree edged-port force-false
spanning-tree instance 0 priority 32
dot1q-tunnel
speed auto
duplex auto
storm-control mode pps
storm-control broadcast pps 400
!
${LAG}
rate-limit ingress cir 5000
!
`;

const ROUND_1: Port = {
    description: "proof",
    access_vlan: "proof",
    lldp: false,
    stp: { edge: true, priority: 64, guard: "root" },
    storm_control: { broadcast: { pps: 500 }, unknown_unicast: { pps: 300 } },
    rate_limit: { input: "10M", output: { cir: "20M", bc: 100_000 } },
    dhcp_trusted: true,
};
const LAG_1: Lag = { id: 8, rate_limit: { input: "10M", output: { cir: "20M", bc: 100_000 } } };

const ROUND_2: Port = {
    description: "proof",
    qinq_vlan: "proof",
    lldp: false,
    stp: { edge: false, priority: 32, guard: "root" },
    storm_control: { broadcast: { pps: 400 } },
    rate_limit: { input: { cir: "10M", bc: 1_250_000 }, output: "30M" },
    dhcp_trusted: true,
};
const LAG_2: Lag = { id: 8, rate_limit: { input: "5M" } };

/** The core switch with only these ports and LAGs, and VLAN 3999. */
function device(ports: Record<string, Port>, lags: Record<string, Lag> = {}, switching: Device["switching"] = {}): Device {
    return {
        ...coreSwitch,
        switching: { ...coreSwitch.switching, vlans: { ...coreSwitch.switching?.vlans, proof: { id: 3999 } }, ...switching },
        interfaces: { ...coreSwitch.interfaces, ethernet: ports, lag: lags },
    } as Device;
}

/** The blocks of the spare port and the LAG. The port stayed shut down through the proof, so its block keeps `shutdown`. */
function blocks(config: string): string {
    const lines = config.split("\n");
    const block = (header: string) => {
        const at = lines.indexOf(header);
        return at === -1 ? [] : lines.slice(at, lines.indexOf("!", at) + 1);
    };
    const port = block(PORT);
    if (!port.includes("shutdown")) port.splice(1, 0, "shutdown");
    return `${[...port, ...block(LAG)].join("\n")}\n`;
}

const sent = (desired: string, current: string) => platform.plan(desired, current, options).steps.flatMap((step) => step.send);

test("each setting renders as the switch printed it, so the plan after it is empty", () => {
    const first = device({ "10g-12": ROUND_1 }, { proof: LAG_1 });
    expect(platform.unsupported(first)).toEqual([]);
    expect(sent(blocks(platform.render(first)), PRINTED_1)).toEqual([]);

    const second = device({ "10g-12": ROUND_2 }, { proof: LAG_2 });
    expect(platform.unsupported(second)).toEqual([]);
    expect(sent(blocks(platform.render(second)), PRINTED_2)).toEqual([]);
});

test("the plans sent in the proof: settings added, changed in place or taken back first, and all removed", () => {
    expect(sent(blocks(platform.render(device({ "10g-12": ROUND_1 }, { proof: LAG_1 }))), BEFORE)).toEqual([
        LAG,
        "rate-limit ingress cir 10000",
        "rate-limit egress cir 20000 cbs 100",
        "exit",
        PORT,
        "portswitch",
        "description proof",
        "switchport access vlan 3999",
        "lldp disable",
        "spanning-tree edged-port force-true",
        "spanning-tree instance 0 priority 64",
        "spanning-tree rootguard enable",
        "storm-control mode pps",
        "storm-control broadcast pps 500",
        "storm-control dlf pps 300",
        "rate-limit ingress cir 10000",
        "rate-limit egress cir 20000 cbs 100",
        "ip dhcp snooping trust",
        "exit",
    ]);

    // A setting with a new value is sent over the old one. A burst the same as the switch's own, 1250 kB for 10000 kbit/s, prints nothing.
    expect(sent(blocks(platform.render(device({ "10g-12": ROUND_2 }, { proof: LAG_2 }))), PRINTED_1)).toEqual([
        LAG,
        "no rate-limit egress",
        "rate-limit ingress cir 5000",
        "exit",
        PORT,
        "no storm-control dlf",
        "no rate-limit egress",
        "dot1q-tunnel",
        "spanning-tree edged-port force-false",
        "spanning-tree instance 0 priority 32",
        "storm-control broadcast pps 400",
        "rate-limit egress cir 30000",
        "exit",
    ]);

    // `no` is refused for root guard and the edge setting, and kbps is storm control's default mode.
    expect(sent(`${PORT}\nshutdown\n!\n`, PRINTED_2)).toEqual([
        PORT,
        "no storm-control broadcast",
        "storm-control mode kbps",
        "no dot1q-tunnel",
        "no spanning-tree instance 0 priority",
        "spanning-tree edged-port auto",
        "spanning-tree rootguard disable",
        "lldp enable",
        "no ip dhcp snooping trust",
        "no rate-limit egress",
        "no rate-limit ingress",
        "no switchport access vlan",
        "no description",
        "exit",
        "no interface port-channel 8",
    ]);
});

test("a rate is in whole kbit/s up to the port's speed, and a burst in whole kB up to 4096 kB, printed only when not the switch's own", () => {
    const limited = device({
        "10g-1": { access_vlan: "servers", rate_limit: { input: { cir: "1G", bc: 4_096_000 }, output: { cir: "1G", bc: 2_000_000 } } },
    });
    // One second at the rate, at most 4096 kB.
    expect(platform.render(limited)).toContain("rate-limit ingress cir 1000000\nrate-limit egress cir 1000000 cbs 2000\n");

    const wrong = device({
        "10g-1": { access_vlan: "servers", rate_limit: { input: "1500.5k", output: "20G" } },
        "10g-2": { access_vlan: "servers", rate_limit: { input: { cir: "1G", bc: 1500 }, output: { cir: "1G", bc: 5_000_000 } } },
    });
    expect(platform.unsupported(wrong)).toEqual([
        "interfaces.ethernet.10g-1.rate_limit.input, the platform takes a rate in whole kbit/s",
        "interfaces.ethernet.10g-1.rate_limit.output 20G, above the port's speed: the platform refuses it",
        "interfaces.ethernet.10g-2.rate_limit.input.bc 1500, the platform takes a burst in whole kB of 1000 bytes, 1000 to 4096000",
        "interfaces.ethernet.10g-2.rate_limit.output.bc 5000000, the platform takes a burst in whole kB of 1000 bytes, 1000 to 4096000",
    ]);

    const onVlan = { ...coreSwitch.interfaces?.vlan_interface?.["management"], vlan: "management", rate_limit: { input: "10M" } };
    const vlanLimited = { ...limited, interfaces: { ...limited.interfaces, vlan_interface: { management: onVlan } } } as Device;
    expect(platform.unsupported(vlanLimited)).toContain(
        "interfaces.vlan_interface.management.rate_limit, the platform limits ports and LAGs"
    );
});

test("storm control takes broadcast and unknown unicast in pps, 1 to 262143", () => {
    const stormy = device({
        "10g-1": { access_vlan: "servers", storm_control: { broadcast: { percent: 1 }, unknown_unicast: { pps: 262_144 } } },
        "10g-2": { access_vlan: "servers", storm_control: { multicast: { pps: 1000 } } },
    });
    expect(platform.unsupported(stormy)).toEqual([
        "interfaces.ethernet.10g-1.storm_control.broadcast.percent, the platform takes pps",
        "interfaces.ethernet.10g-1.storm_control.unknown_unicast 262144 pps, the platform takes 1 to 262143",
        "interfaces.ethernet.10g-2.storm_control.multicast, it is not known whether the platform limits all multicast or only unknown groups",
    ]);
});

test("LLDP runs on the listed ports and LAGs, or on one port alone, and is turned off on every other declared port", () => {
    const listed = device(
        {
            "10g-1": { access_vlan: "servers" },
            "10g-2": { access_vlan: "servers" },
            "25g-1": { in_lag: "uplink" },
            "25g-2": { in_lag: "uplink", description: "second" },
        },
        { uplink: { trunk_vlans: ["servers"] } },
        { lldp: { interfaces: ["10g-1", "uplink"] } }
    );
    const rendered = platform.render(listed);

    expect(platform.unsupported(listed)).toEqual([]);
    expect(rendered).toContain("\nlldp enable\n");
    expect(rendered).toContain("interface tengigabitethernet 1/3/1\nswitchport access vlan 20\n!");
    expect(rendered).toContain("interface tengigabitethernet 1/3/2\nswitchport access vlan 20\nlldp disable\n!");
    expect(rendered).toContain("interface twenty-fivegige 1/2/2\ndescription second\nport-channel 1\n!");

    const alone = device({ "10g-1": { access_vlan: "servers", lldp: true }, "10g-2": { access_vlan: "servers" } }, {}, { lldp: undefined });
    expect(platform.render(alone)).toContain("\nlldp enable\n");
    expect(platform.render(alone)).toContain("interface tengigabitethernet 1/3/2\nswitchport access vlan 20\nlldp disable\n!");

    const onVlan = device({}, {}, { lldp: { interfaces: ["management"] } });
    expect(platform.unsupported(onVlan)).toContain("switching.lldp.interfaces management, LLDP runs on ports and LAGs here");
});

test("a port's spanning tree needs the switch's, and its cost is refused", () => {
    const off = device({ "10g-1": { access_vlan: "servers", stp: { edge: true, cost: 2000 } } }, {}, { stp: undefined });
    expect(platform.unsupported(off)).toEqual([
        "interfaces.ethernet.10g-1.stp, a port runs spanning tree here only with switching.stp",
        "interfaces.ethernet.10g-1.stp.cost, the platform has a path cost inside the MST region and another outside it",
    ]);
});

test("BPDU guard is one setting for the switch, only with --experimental, and each port that runs spanning tree says whether it is an edge port", () => {
    const guarded = device(
        {
            "10g-1": { access_vlan: "servers", stp: { edge: true, bpdu_guard: true } },
            "10g-2": { access_vlan: "servers", stp: { edge: false } },
            "10g-3": { trunk_vlans: ["servers"], stp: false },
        },
        {},
        { stp: {} }
    );
    expect(platform.render(guarded)).toContain("spanning-tree enable\nspanning-tree bpduguard enable\n");
    expect(platform.unsupported(guarded)).toEqual([]);
    expect(platform.experimental?.(guarded)).toEqual(["interfaces.ethernet.10g-1.stp.bpdu_guard"]);

    const unsaid = device(
        {
            "10g-1": { access_vlan: "servers", stp: { edge: true, bpdu_guard: true } },
            "10g-2": { access_vlan: "servers" },
            "10g-4": { access_vlan: "servers", stp: { edge: true } },
        },
        { uplink: { trunk_vlans: ["servers"] } },
        { stp: {} }
    );
    expect(platform.unsupported(unsaid)).toEqual([
        "interfaces.ethernet.10g-2.stp, BPDU guard shuts down any port the switch finds to be an edge port: write edge: true or false",
        "interfaces.ethernet.10g-4.stp without bpdu_guard, the platform guards every edge port or none: write it on each",
        "interfaces.lag.uplink, BPDU guard shuts down any LAG the switch finds to be an edge port, and Circuit sets no edge on a LAG here",
    ]);
});

test("DHCP snooping, only with --experimental, turns on for the switch once its trusted ports are set", () => {
    const snooping = device(
        { "10g-1": { access_vlan: "servers" }, "10g-2": { trunk_vlans: ["servers"], dhcp_trusted: true } },
        {},
        { dhcp_snooping: true }
    );
    expect(platform.unsupported(snooping)).toEqual([]);
    expect(platform.experimental?.(snooping)).toEqual(["switching.dhcp_snooping", "interfaces.ethernet.10g-2.dhcp_trusted"]);

    const plain = platform.render(device({ "10g-1": { access_vlan: "servers" }, "10g-2": { trunk_vlans: ["servers"] } }));
    const steps = sent(platform.render(snooping), plain);
    expect(steps.indexOf("ip dhcp snooping")).toBeGreaterThan(steps.indexOf("ip dhcp snooping trust"));
    expect(steps.at(-1)).toBe("ip dhcp snooping");
});

test("the switch answers time queries while it takes time from servers, so services.ntp_server writes nothing, and system.ntp alone warns", () => {
    const serving = { ...coreSwitch, services: { ntp_server: true } } as Device;
    expect(platform.unsupported(serving)).toEqual([]);
    expect(platform.render(serving)).toBe(platform.render(coreSwitch));
    expect(Checks.run([serving], undefined).filter((finding) => finding.level === "warning")).toEqual([]);

    expect(Checks.run([coreSwitch], undefined).map((finding) => finding.message)).toContain(
        "system.ntp: the switch also answers time queries from others, and Raisecom ROS has no setting to stop it. Write services.ntp_server: true to say so"
    );

    const noClient = { ...serving, system: { ...coreSwitch.system, ntp: undefined } } as Device;
    expect(platform.unsupported(noClient)).toContain(
        "services.ntp_server without system.ntp, the switch answers time queries only while it takes time from servers"
    );
});

test("SSH keys are refused: a key belongs to no user, and one setting turns password logins off for all", () => {
    const keyed = {
        ...coreSwitch,
        system: {
            ...coreSwitch.system,
            users: { operator: { role: "admin", password: { secret: "P" }, ssh_keys: ["ssh-ed25519 AAAA operator"] } },
        },
    } as Device;
    expect(platform.unsupported(keyed)).toEqual([
        "system.users.operator.ssh_keys, a key here belongs to no user, and one setting turns password logins off for all",
    ]);
});
