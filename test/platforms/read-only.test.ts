// Which commands `circuit show` may send on each platform: only what reads, and never a `?` where a script's `?` is run.

import { expect, test } from "bun:test";
import { Platforms } from "../../src/platforms";

/** Each platform's commands that only read, and some that change something or print a secret. */
const cases: Record<string, { reads: string[]; refused: string[] }> = {
    routeros: {
        reads: [
            "/ip route print where dst-address=0.0.0.0/0",
            "/interface monitor-traffic sfp28-1 once",
            "/ping 192.0.2.1 count=5",
            "/tool torch interface=sfp28-1 duration=10",
            "/tool sniffer quick interface=sfp28-1 duration=5",
            "/export terse",
            ":put [/system resource get version]",
            ":foreach i in=[/interface find] do={ :put [/interface get $i name] }",
        ],
        refused: [
            "/ip address add address=192.0.2.1/24 interface=ether1",
            "/interface set sfp28-1 disabled=yes",
            "/export file=everything",
            "/export show-sensitive",
            "/system reboot",
            "/ip route print; /ip route remove 0",
            "/system script run cleanup",
        ],
    },
    vrp: {
        reads: ["display version", "display interface brief"],
        refused: ["display ?", "display interface ?", "system-view", "undo info-center enable", "save"],
    },
    "raisecom-ros": {
        reads: ["show version", "show interface port 1"],
        refused: ["show ?", "config", "write", "no interface port 1"],
    },
    junos: {
        reads: ["show route 192.0.2.0/24", "show interfaces terse"],
        refused: ["configure", "request system reboot", "clear bgp neighbor all"],
    },
    fortios: {
        reads: [
            "get system status",
            "show system interface",
            "diagnose sys session filter dst 192.0.2.1",
            "diagnose sys session list",
            "diagnose hardware deviceinfo nic port1",
            "execute ping 192.0.2.1",
        ],
        refused: ["diagnose sys session clear", "execute reboot", "config system global", "diagnose debug enable"],
    },
};

test("every platform has a list of commands that only read", () => {
    expect(Object.keys(cases).sort()).toEqual(Platforms.names().sort());
});

for (const [name, { reads, refused }] of Object.entries(cases)) {
    test(`${name} takes commands that only read and refuses the rest`, () => {
        const platform = Platforms.get(name);

        expect(reads.filter((command) => !platform.readOnly(command))).toEqual([]);
        expect(refused.filter((command) => platform.readOnly(command))).toEqual([]);
    });
}
