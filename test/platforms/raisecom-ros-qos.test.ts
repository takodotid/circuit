// Classes and trust on Raisecom ROS, as a RAX721 on ROS 6.5.2 printed them on spare ports (tako-mmr-01, 2026-11-27, #419). One port was switched, one switched nothing, and one was routed. Circuit's plans applied, changed, and removed them, each plan after empty but for the ports in service, which the test left alone.

import { expect, test } from "bun:test";
import type { Device } from "../../src/model";
import { Platforms } from "../../src/platforms";
import { Fixtures } from "../fixtures";

const platform = Platforms.get("raisecom-ros");
const core = Fixtures.device("platforms--example-core-switch");

type Qos = NonNullable<Device["qos"]>;

const CLASSES: Qos = {
    classes: {
        "best-effort": { dscp: ["cs0"] },
        voice: { dscp: ["ef"] },
        video: { dscp: ["af41", "af42", "af43"] },
        network: { dscp: ["cs6", "cs7"] },
    },
    default_class: "best-effort",
};

/** The core switch with three spare ports, without its LAG: a switched port that trusts the DSCP, a port that trusts nothing, and a routed port that trusts both. */
function tested(qos: Qos | null = CLASSES, ethernet: object = {}): Device {
    return {
        ...core,
        switching: { ...core.switching, vlans: { ...core.switching?.vlans, ctest: { id: 3990 } } },
        interfaces: {
            vlan_interface: core.interfaces?.vlan_interface,
            ethernet: {
                "10g-12": { description: "ctest-trusted", access_vlan: "ctest", qos_trust: ["dscp"] },
                "10g-11": { description: "ctest-untrusted" },
                "10g-24": { description: "ctest-routed", addresses: ["198.51.100.1/30"], qos_trust: ["dscp", "pcp"] },
                ...ethernet,
            },
        },
        qos: qos ?? undefined,
    } as Device;
}

/** How the switch printed the maps and the three ports. The maps print one after the other, with no `!` between them. */
const PRINTED = `mls qos mapping dscp-to-local-priority 1
   dscp 8 to local-priority 0
   dscp 9 to local-priority 0
   dscp 10 to local-priority 0
   dscp 11 to local-priority 0
   dscp 12 to local-priority 0
   dscp 13 to local-priority 0
   dscp 14 to local-priority 0
   dscp 15 to local-priority 0
   dscp 16 to local-priority 0
   dscp 17 to local-priority 0
   dscp 18 to local-priority 0
   dscp 19 to local-priority 0
   dscp 20 to local-priority 0
   dscp 21 to local-priority 0
   dscp 22 to local-priority 0
   dscp 23 to local-priority 0
   dscp 24 to local-priority 0
   dscp 25 to local-priority 0
   dscp 26 to local-priority 0
   dscp 27 to local-priority 0
   dscp 28 to local-priority 0
   dscp 29 to local-priority 0
   dscp 30 to local-priority 0
   dscp 31 to local-priority 0
   dscp 32 to local-priority 0
   dscp 33 to local-priority 0
   dscp 34 to local-priority 2
   dscp 35 to local-priority 0
   dscp 36 to local-priority 2
   dscp 37 to local-priority 0
   dscp 38 to local-priority 2
   dscp 39 to local-priority 0
   dscp 40 to local-priority 0
   dscp 41 to local-priority 0
   dscp 42 to local-priority 0
   dscp 43 to local-priority 0
   dscp 44 to local-priority 0
   dscp 45 to local-priority 0
   dscp 46 to local-priority 1
   dscp 47 to local-priority 0
   dscp 48 to local-priority 3
   dscp 49 to local-priority 0
   dscp 50 to local-priority 0
   dscp 51 to local-priority 0
   dscp 52 to local-priority 0
   dscp 53 to local-priority 0
   dscp 54 to local-priority 0
   dscp 55 to local-priority 0
   dscp 56 to local-priority 3
   dscp 57 to local-priority 0
   dscp 58 to local-priority 0
   dscp 59 to local-priority 0
   dscp 60 to local-priority 0
   dscp 61 to local-priority 0
   dscp 62 to local-priority 0
   dscp 63 to local-priority 0
mls qos mapping dscp-to-local-priority 2
   dscp 8 to local-priority 0
   dscp 9 to local-priority 0
   dscp 10 to local-priority 0
   dscp 11 to local-priority 0
   dscp 12 to local-priority 0
   dscp 13 to local-priority 0
   dscp 14 to local-priority 0
   dscp 15 to local-priority 0
   dscp 16 to local-priority 0
   dscp 17 to local-priority 0
   dscp 18 to local-priority 0
   dscp 19 to local-priority 0
   dscp 20 to local-priority 0
   dscp 21 to local-priority 0
   dscp 22 to local-priority 0
   dscp 23 to local-priority 0
   dscp 24 to local-priority 0
   dscp 25 to local-priority 0
   dscp 26 to local-priority 0
   dscp 27 to local-priority 0
   dscp 28 to local-priority 0
   dscp 29 to local-priority 0
   dscp 30 to local-priority 0
   dscp 31 to local-priority 0
   dscp 32 to local-priority 0
   dscp 33 to local-priority 0
   dscp 34 to local-priority 0
   dscp 35 to local-priority 0
   dscp 36 to local-priority 0
   dscp 37 to local-priority 0
   dscp 38 to local-priority 0
   dscp 39 to local-priority 0
   dscp 40 to local-priority 0
   dscp 41 to local-priority 0
   dscp 42 to local-priority 0
   dscp 43 to local-priority 0
   dscp 44 to local-priority 0
   dscp 45 to local-priority 0
   dscp 46 to local-priority 0
   dscp 47 to local-priority 0
   dscp 48 to local-priority 0
   dscp 49 to local-priority 0
   dscp 50 to local-priority 0
   dscp 51 to local-priority 0
   dscp 52 to local-priority 0
   dscp 53 to local-priority 0
   dscp 54 to local-priority 0
   dscp 55 to local-priority 0
   dscp 56 to local-priority 0
   dscp 57 to local-priority 0
   dscp 58 to local-priority 0
   dscp 59 to local-priority 0
   dscp 60 to local-priority 0
   dscp 61 to local-priority 0
   dscp 62 to local-priority 0
   dscp 63 to local-priority 0
!
interface tengigabitethernet 1/3/11
description ctest-untrusted
mls qos dscp-to-local-priority 2
!
interface tengigabitethernet 1/3/12
portswitch
description ctest-trusted
switchport access vlan 3990
mls qos trust dscp
mls qos dscp-to-local-priority 1
speed auto
duplex auto
!
interface tengigabitethernet 1/3/24
description ctest-routed
ip address 198.51.100.1 255.255.255.252
mls qos dscp-to-local-priority 1
!
`;

/** The maps and the three ports, from a render or from what the switch printed. */
const blocks = (config: string) =>
    config
        .split("!\n")
        .filter((block) => /^(mls qos mapping|interface tengigabitethernet 1\/3\/(11|12|24)\n)/.test(block.trimStart()))
        .map((block) => `${block.trimStart()}!\n`)
        .join("");

const sent = (desired: string, current: string) =>
    platform.plan(desired, current, { secrets: false, rollback: 0 }).steps.flatMap((step) => step.send);

test("classes render as the switch printed them, and the next plan is empty", () => {
    expect(platform.unsupported(tested())).toEqual([]);
    expect(platform.experimental?.(tested())).toEqual([
        "qos.classes",
        "interfaces.ethernet.10g-12.qos_trust",
        "interfaces.ethernet.10g-24.qos_trust",
    ]);

    const rendered = platform.render(tested());
    expect(rendered).toContain("   dscp 46 to local-priority 1\n   dscp 47 to local-priority 0\n   dscp 48 to local-priority 3\n");
    // A switched port trusts the PCP until told, and a routed port the DSCP, which prints nothing.
    expect(blocks(rendered)).toContain(
        "interface tengigabitethernet 1/3/12\ndescription ctest-trusted\nswitchport access vlan 3990\nmls qos trust dscp\nmls qos dscp-to-local-priority 1\n"
    );
    expect(blocks(rendered)).toContain(
        "interface tengigabitethernet 1/3/11\ndescription ctest-untrusted\nmls qos dscp-to-local-priority 2\n"
    );
    expect(sent(blocks(rendered), blocks(PRINTED))).toEqual([]);
});

test("without classes, a port keeps the switch's own trust, and no map is written", () => {
    expect(platform.render(tested(null))).not.toContain("mls qos");
});

test("a map a port uses lets the port go before it changes, and the port takes it again after", () => {
    const changed = tested({ ...CLASSES, classes: { ...CLASSES.classes, video: { dscp: ["af41"] } } });
    expect(sent(blocks(platform.render(changed)), blocks(PRINTED))).toEqual([
        "interface tengigabitethernet 1/3/12",
        "no mls qos dscp-to-local-priority",
        "exit",
        "interface tengigabitethernet 1/3/24",
        "no mls qos dscp-to-local-priority",
        "exit",
        "mls qos mapping dscp-to-local-priority 1",
        "dscp 36 to local-priority 0",
        "dscp 38 to local-priority 0",
        "exit",
        "interface tengigabitethernet 1/3/12",
        "mls qos dscp-to-local-priority 1",
        "exit",
        "interface tengigabitethernet 1/3/24",
        "mls qos dscp-to-local-priority 1",
        "exit",
    ]);
});

test("a DSCP back in the switch's own queue is set to it, and a port that stops trusting takes the other map in place", () => {
    const changed = tested(
        { ...CLASSES, classes: { ...CLASSES.classes, video: { dscp: ["af41", "af42", "af43", "af31"] } } },
        { "10g-12": { description: "ctest-trusted", access_vlan: "ctest", qos_trust: ["pcp"] } }
    );
    const steps = sent(blocks(platform.render(changed)), blocks(PRINTED));
    expect(steps).toContain("dscp 26 to local-priority 2");
    expect(steps.slice(-3)).toEqual(["interface tengigabitethernet 1/3/12", "mls qos dscp-to-local-priority 2", "exit"]);
});

test("the maps go once no port uses them", () => {
    const steps = sent(blocks(platform.render(tested(null))), blocks(PRINTED));
    expect(steps.slice(-2)).toEqual(["no mls qos mapping dscp-to-local-priority 2", "no mls qos mapping dscp-to-local-priority 1"]);
    expect(steps).toContain("no mls qos trust");
});

test("what the switch can't do with classes is refused, with why", () => {
    const device = {
        ...tested({
            ...CLASSES,
            classes: { ...CLASSES.classes, phones: { pcp: [5] } },
            marking: [{ then: { dscp: "ef" } }],
            schedulers: { uplink: { queues: [{ class: "best-effort", share: 100 }] } },
        }),
        interfaces: {
            ...tested().interfaces,
            lag: { router: { trunk_vlans: ["ctest"] } },
            vlan_interface: { ctest: { vlan: "ctest", addresses: ["192.0.2.1/24"], qos_trust: ["dscp"] } },
        },
    } as Device;
    expect(platform.unsupported(device).filter((message) => /qos|scheduler/.test(message))).toEqual([
        "qos.classes.phones.pcp, a port here binds no PCP map: `mls qos mapping cos-to-local-priority` makes one, but no line on a port takes it",
        "qos.classes beside a LAG, not built yet: no LAG has taken the trust settings",
        "qos.schedulers.uplink, ROS 6.5.2 has no queue scheduler to set: a port's flow-queue profile shapes each queue alone, and `mls qos queue` is refused",
        "qos.marking, not built: the switch marks with a traffic policy on the port a packet arrives on, which marks what it switches within a VLAN as well as what it routes",
        "interfaces.vlan_interface.ctest.qos_trust on a VLAN interface: the switch sorts a packet on the port it arrives on. Write it on the VLAN's ports",
    ]);

    const nine = ["cs0", "cs1", "cs2", "cs3", "cs4", "cs5", "cs6", "cs7", "ef"];
    const many = tested({ classes: Object.fromEntries(nine.map((dscp) => [dscp, { dscp: [dscp] }])), default_class: "cs0" } as Qos);
    expect(platform.unsupported(many)).toEqual(["qos.classes, 9 of them: a port has 8 queues"]);
});
