// Features proved on a CE6855 on V200R005C00SPC800, against the lines it printed. Addresses are from documentation ranges.

import { expect, test } from "bun:test";
import switchDevice from "../../examples/platforms/vrp";
import { Platforms } from "../../src/platforms";
import type { Device } from "../../src/schema";

const vrp = Platforms.get("vrp");
const options = { secrets: false, rollback: 10 };

const sent = (desired: string, current: string) => vrp.plan(desired, current, options).steps.flatMap((step) => step.send);

const shown = (desired: string, current: string) => vrp.plan(desired, current, options).steps.flatMap((step) => step.show);

// SNMP with its own sources, and logs to collectors and the log files.
const logged: Device = {
    ...switchDevice,
    system: {
        ...switchDevice.system,
        logging: {
            local: { level: "warning", files: 5 },
            remote: [
                { address: "192.0.2.81", level: "info" },
                { address: "192.0.2.84", level: "debug", port: 5514 },
            ],
        },
    },
    management: { ...switchDevice.management, snmp: { ...switchDevice.management!.snmp, allow: ["192.0.2.82/32", "192.0.2.83/32"] } },
};

test("SNMP sources and logging render as the switch prints them", () => {
    const rendered = vrp.render(logged);
    const printed = [
        "info-center source default channel 9 log level warning",
        "info-center loghost 192.0.2.81 level informational",
        "info-center loghost 192.0.2.84 port 5514",
        "info-center max-logfile-number 5",
        "acl number 2001\n description SNMP access\n rule 5 permit source 192.0.2.82 0\n rule 10 permit source 192.0.2.83 0\n rule 15 deny\n#",
        "snmp-agent group v3 circuit privacy read-view all acl 2001",
    ];

    for (const line of printed) expect(rendered).toContain(line);
    expect(vrp.unsupported(logged)).toEqual([]);
});

test("the defaults the switch does not print are not rendered", () => {
    const quiet: Device = {
        ...switchDevice,
        system: { logging: { local: { level: "debug", files: 200 }, remote: [{ address: "192.0.2.81", level: "debug", port: 514 }] } },
    };
    const rendered = vrp.render(quiet);

    expect(rendered).toContain("info-center loghost 192.0.2.81\n");
    expect(rendered).not.toContain("channel 9");
    expect(rendered).not.toContain("max-logfile-number");
});

test("a log file length in lines, or a file count the switch refuses, is refused", () => {
    const refused: Device = { ...switchDevice, system: { logging: { local: { level: "info", files: 2, lines_per_file: 1000 } } } };

    expect(vrp.unsupported(refused)).toEqual([
        "system.logging.local.lines_per_file, the platform sizes a log file in megabytes",
        "system.logging.local.files, between 3 and 500 on the platform",
    ]);
});

test("an ACL still bound to SNMP is removed after the binding moves", () => {
    const current = [
        "acl number 2001",
        " description SNMP access",
        " rule 5 permit source 192.0.2.82 0",
        " rule 10 deny",
        "#",
        "snmp-agent group v3 circuit privacy read-view all acl 2001",
    ].join("\n");

    expect(sent("snmp-agent group v3 circuit privacy read-view all acl 2000\n", current)).toEqual([
        "snmp-agent group v3 circuit privacy read-view all acl 2000",
        "undo acl number 2001",
    ]);
});

test("an ACL rule that changes is undone first, as the switch merges a rule into the one it replaces", () => {
    const current = "acl number 2001\n rule 5 permit source 192.0.2.82 0\n rule 10 permit source 192.0.2.83 0\n rule 15 deny\n#\n";
    const desired = "acl number 2001\n rule 5 permit source 192.0.2.82 0\n rule 10 deny\n#\n";

    expect(sent(desired, current)).toEqual(["acl number 2001", "undo rule 15", "undo rule 10", "rule 10 deny", "quit"]);
});

test("a log host is undone by its address, and one at the default level is removed when another takes its place", () => {
    const current = "info-center loghost 192.0.2.81\ninfo-center loghost 192.0.2.84 port 5514\ninfo-center max-logfile-number 5\n";
    const desired = "info-center loghost 192.0.2.84 level error\ninfo-center loghost 192.0.2.85\n";

    expect(sent(desired, current).sort()).toEqual(
        [
            "info-center loghost 192.0.2.84 level error",
            "info-center loghost 192.0.2.85",
            "undo info-center loghost 192.0.2.81",
            "undo info-center loghost 192.0.2.84",
            "undo info-center max-logfile-number",
        ].sort()
    );
    expect(
        shown("info-center source default channel 9 log level warning\n", "info-center source default channel 9 log level warning\n")
    ).toEqual([]);
    expect(sent("", "info-center source default channel 9 log level informational\n")).toEqual([
        "undo info-center source default channel 9 log level",
    ]);
});

test("an alarm's severity renders as the switch prints it, with a capital", () => {
    const alarmed: Device = {
        ...switchDevice,
        system: { ...switchDevice.system, alarms: { hwOpticalUnAuthorized: { severity: "warning" } } },
    };

    expect(vrp.render(alarmed)).toContain("alarm\n alarm hwOpticalUnAuthorized severity Warning\n#");
    expect(vrp.unsupported(alarmed)).toEqual([]);
});

test("an alarm's severity changes in place, and the alarm view goes by undoing its lines", () => {
    const printed = "alarm\n alarm hwOpticalUnAuthorized severity Warning\n#\n";

    expect(sent("alarm\n alarm hwOpticalUnAuthorized severity Minor\n#\n", printed)).toEqual([
        "alarm",
        "alarm hwOpticalUnAuthorized severity Minor",
        "quit",
    ]);
    expect(sent("", printed)).toEqual(["alarm", "undo alarm hwOpticalUnAuthorized severity", "quit"]);
});
