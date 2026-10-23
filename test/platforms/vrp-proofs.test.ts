// Features proved on a CE6855 on V200R005C00SPC800, against the lines it printed. Addresses are from documentation ranges.

import { expect, test } from "bun:test";
import switchDevice from "../../examples/platforms/vrp";
import { Platforms } from "../../src/platforms";
import { Vrp } from "../../src/platforms/vrp/index";
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

// A watched route, and OSPF with BFD on a VLAN interface.
const watched: Device = {
    ...switchDevice,
    routing: {
        ...switchDevice.routing,
        bfd: { interval: 300, multiplier: 3 },
        static: [{ prefix: "198.51.100.0/24", via: "192.0.2.1", bfd: true, distance: 70, description: "proof" }],
    },
};

test("BFD timers and a watched static route render as the switch prints them", () => {
    const rendered = vrp.render(watched);

    expect(rendered).toContain("ip route-static bfd 192.0.2.1 local-address 192.0.2.2 min-tx-interval 300 min-rx-interval 300\n");
    expect(rendered).toContain("ip route-static 198.51.100.0 255.255.255.0 192.0.2.1 preference 70 description proof bfd enable\n");
    expect(rendered).toContain(" ospf bfd enable\n ospf bfd min-tx-interval 300 min-rx-interval 300\n");
    expect(rendered).toContain("\nbfd\n#");
    expect(vrp.unsupported(watched)).toEqual([]);

    const five: Device = { ...watched, routing: { ...watched.routing, bfd: { interval: 500, multiplier: 5 } } };
    expect(vrp.render(five)).toContain(" ospf bfd min-tx-interval 500 min-rx-interval 500 detect-multiplier 5\n");
});

test("BFD timers the switch refuses, and a watched route it cannot build, are refused", () => {
    const refused: Device = {
        ...switchDevice,
        routing: {
            bfd: { interval: 10, multiplier: 2 },
            static: [{ prefix: "198.51.100.0/24", via: "203.0.113.1", bfd: true }],
        },
    };

    expect(vrp.unsupported(refused)).toEqual([
        "routing.bfd.interval, between 50 and 1000 ms on the platform",
        "routing.bfd.multiplier, between 3 and 50 on the platform",
        "routing.static 198.51.100.0/24 bfd, the device has no address on the network of 203.0.113.1",
    ]);
});

test("OSPF BFD timers are undone before they change, a route's BFD template is replaced in place, and a route is undone by its next hop", () => {
    const current = [
        "interface Vlanif10",
        " ospf bfd enable",
        " ospf bfd min-tx-interval 300 min-rx-interval 300 detect-multiplier 50",
        "#",
        "ip route-static bfd 192.0.2.1 local-address 192.0.2.2 min-tx-interval 50 min-rx-interval 50 detect-multiplier 50",
        "ip route-static 198.51.100.0 255.255.255.0 192.0.2.1 preference 70 description proof bfd enable",
    ].join("\n");
    const desired = [
        "interface Vlanif10",
        " ospf bfd enable",
        " ospf bfd min-tx-interval 300 min-rx-interval 300",
        "#",
        "ip route-static bfd 192.0.2.1 local-address 192.0.2.2 min-tx-interval 300 min-rx-interval 300",
    ].join("\n");

    expect(sent(desired, current)).toEqual([
        "undo ip route-static 198.51.100.0 255.255.255.0 192.0.2.1",
        "ip route-static bfd 192.0.2.1 local-address 192.0.2.2 min-tx-interval 300 min-rx-interval 300",
        "interface Vlanif10",
        "undo ospf bfd min-tx-interval 300 min-rx-interval 300 detect-multiplier 50",
        "ospf bfd min-tx-interval 300 min-rx-interval 300",
        "quit",
    ]);
    expect(sent("", "ip route-static bfd 192.0.2.1 local-address 192.0.2.2\n")).toEqual(["undo ip route-static bfd 192.0.2.1"]);
});

// An exchange member port: one MAC address, and only IPv4, IPv6 and ARP.
const member: Device = {
    ...switchDevice,
    ports: {
        ...switchDevice.ports,
        "10g-4": { description: "Member", access_vlan: "servers", mac_limit: 1, ethertypes: ["ipv4", "ipv6", "arp"] },
        "10g-5": { description: "Member", access_vlan: "servers", ethertypes: ["ipv4", "arp"] },
    },
};

test("a MAC limit and an ethertype filter render as the switch prints them", () => {
    const rendered = vrp.render(member);

    expect(rendered).toContain(
        "acl number 4000\n rule 5 permit type ip\n rule 10 permit type ipv6\n rule 15 permit type arp\n rule 20 deny\n#"
    );
    expect(rendered).toContain("acl number 4001\n rule 5 permit type ip\n rule 10 permit type arp\n rule 15 deny\n#");
    expect(rendered).toContain(
        "interface 10GE1/0/4\n description Member\n port default vlan 20\n mac-address limit maximum 1\n traffic-filter acl 4000 inbound\n#"
    );
    expect(rendered).toContain("interface 10GE1/0/5\n description Member\n port default vlan 20\n traffic-filter acl 4001 inbound\n#");
    expect(vrp.unsupported(member)).toEqual([]);
});

test("a MAC limit is undone without its value, and a filter on a LAG or a LAG member is refused", () => {
    expect(sent("interface 10GE1/0/4\n#\n", "interface 10GE1/0/4\n mac-address limit maximum 1\n#\n")).toEqual([
        "interface 10GE1/0/4",
        "undo mac-address limit",
        "quit",
    ]);

    const onLag: Device = {
        ...switchDevice,
        ports: { ...switchDevice.ports, "40g-1": { ...switchDevice.ports!["40g-1"]!, mac_limit: 1 } },
        interfaces: {
            ...switchDevice.interfaces,
            uplink: { type: "lag", mode: "lacp", trunk_vlans: ["management", "servers", "guests"], ethertypes: ["ipv4"] },
        },
    };

    expect(vrp.unsupported(onLag)).toEqual([
        "ports.40g-1.mac_limit on a LAG member, set it on the LAG",
        "interfaces.uplink.ethertypes, on a LAG is not proved",
    ]);
});

// `display lldp neighbor` as the switch printed it, with the far switch's name, address and description changed.
test("LLDP neighbors are read by Circuit's port names", () => {
    const output = [
        "10GE1/0/2 has 1 neighbor(s):",
        "",
        "Neighbor index                     :1",
        "Chassis type                       :MAC Address",
        "Chassis ID                         :0000-5e00-5301",
        "Port ID subtype                    :Interface Name",
        "Port ID                            :XGigabitEthernet0/0/36",
        "Port description                   :Uplink   ",
        "System name                        :far-switch      ",
        "System description                 :Huawei Switch S6730-H48X6C",
        "Huawei Versatile Routing Platform Software",
        "Management address                 :192.0.2.29",
        "",
        "10GE1/0/3 has 0 neighbor(s)",
        "",
        "MEth0/0/0 has 1 neighbor(s):",
        "Port ID                            :ether1",
        "System name                        :lab-router",
        "",
        "40GE1/0/6 has 0 neighbor(s)",
    ].join("\r\n");

    expect(Vrp.neighborsOf(switchDevice, output)).toEqual([{ port: "10g-2", system: "far-switch", remote_port: "XGigabitEthernet0/0/36" }]);
});
