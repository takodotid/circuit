// What a RAX721 on ROS 6.5.2 printed when each feature was proved on it, with names and addresses changed.

import { expect, test } from "bun:test";
import coreSwitch from "../../examples/platforms/raisecom-ros";
import { Platforms } from "../../src/platforms";
import { RaisecomRos } from "../../src/platforms/raisecom-ros";
import type { Device } from "../../src/schema";

/** `show lldp remote detail`, cut to a few ports: a Junos neighbor that sends its port as a number, and a ROS neighbor that sends the port's name. */
const LLDP_REMOTE_DETAIL = `hundredgige1/1/3 has  0 remotes:
hundredgige1/1/4 has  1 remotes:
Remote 1
--------------------------------------------------------------------------------
ChassisIdSubtype:             macAddress
ChassisId:                    0200.0000.0100
PortIdSubtype:                local
PortId:                       520
PortDesc:                     core uplink
SysName:                      tor-1
SysDesc:                      Juniper Networks, Inc. qfx5100-48s-6q Ethernet Switc
                              h, kernel JUNOS 21.4R3-S8.5, Build date: 2024-07-13
                              03:18:52 UTC Copyright (c) 1996-2024 Juniper Network
                              s, Inc.
SysCapSupported:              Bridge/Switch,Router
SysCapEnabled:                Bridge/Switch,Router
Mgt address type:             MAC
Mgt address:                  0200.0000.0101
Expired time:                 118(s)
LLDPDU TTL:                   120

Port VLAN ID(PVID):           998
VLAN name of VLAN  100:       vlan-100
Auto-negotiation supported:   No
Auto-negotiation enabled:     No
OperMau:                      Unknown

Maximum frame Size:           1514

hundredgige1/1/5 has  0 remotes:
twenty-fivegige1/2/24 has  0 remotes:
tengigabitethernet1/3/3 has  1 remotes:
Remote 1
--------------------------------------------------------------------------------
ChassisIdSubtype:             macAddress
ChassisId:                    0200.0000.0200
PortIdSubtype:                ifName
PortId:                       tengigabitethernet1/3/10
PortDesc:                     NNI-EXAMPLE[CUSTOMER]
SysName:                      PROVIDER-SWITCH-1
SysDesc:                      Raisecom Operating System Software,RAX721-C-6C48-AC_
                              DC,ROS,Copyright (c) 2006-2026 Raisecom Science & Te
                              chnology Development Co.,Ltd
Mgt address type:             IPv4
Mgt address:                  192.0.2.28
Expired time:                 102(s)
LLDPDU TTL:                   120

tengigabitethernet1/3/4 has  0 remotes:
`;

test("LLDP neighbors come from the detail form, by Circuit's port names, with the far port as the neighbor sends it", () => {
    expect(RaisecomRos.lldpRemotes(LLDP_REMOTE_DETAIL.replace(/\n/g, "\r\n"), coreSwitch)).toEqual([
        { port: "100g-4", system: "tor-1", remote_port: "520" },
        { port: "10g-3", system: "PROVIDER-SWITCH-1", remote_port: "tengigabitethernet1/3/10" },
    ]);
});

test("a port with no remotes gives no neighbor", () => {
    expect(RaisecomRos.lldpRemotes("hundredgige1/1/1 has  0 remotes:\n", coreSwitch)).toEqual([]);
});

const platform = Platforms.get("raisecom-ros");
const example: Device = coreSwitch;
const snmpUsers = example.management?.snmp?.users;
const plain: Device = { ...example, management: { ...example.management, snmp: { users: snmpUsers } } };
const noLogs: Device = { ...plain, system: { ...plain.system, logging: undefined } };
const withLogs: Device = {
    ...example,
    system: {
        ...example.system,
        logging: {
            remote: [
                { address: "192.0.2.50", level: "info" },
                { address: "192.0.2.51", level: "warning", port: 5140 },
            ],
        },
    },
};
const sent = (desired: string, current: string) =>
    platform.plan(desired, current, { secrets: false, rollback: 0 }).steps.flatMap((step) => step.send);

test("a log host prints its level as a number and its UDP port as `udpport`, and neither when it is the default", () => {
    const rendered = platform.render(withLogs);

    expect(rendered).toContain("logging host 192.0.2.50\n");
    expect(rendered).toContain("logging host 192.0.2.51 4 udpport 5140\n");
    expect(sent(rendered, rendered)).toEqual([]);
});

test("a log host that is gone is removed by its address, even when another one takes its place", () => {
    // As the device printed them: `logging host 10.99.0.81` at the defaults, `... 7 udpport 515` otherwise.
    const current = platform.render(noLogs) + "logging host 192.0.2.60\nlogging host 192.0.2.61 7 udpport 515\n";

    expect(sent(platform.render(withLogs), current).filter((line) => line.includes("logging"))).toEqual([
        "no logging host 192.0.2.61",
        "no logging host 192.0.2.60",
        "logging host 192.0.2.50",
        "logging host 192.0.2.51 4 udpport 5140",
    ]);
});

test("SNMP with its own sources takes access-list 1001, bound before the old one is let go, since SNMP holds both", () => {
    const desired = platform.render(example);

    expect(desired).toContain("access-list 1001\n  description snmp\n  rule 10 permit 192.0.2.10 255.255.255.255\n  rule 100 deny any\n");
    expect(desired).toContain("snmp-server access-list 1001\n");
    expect(desired).not.toContain("snmp-server access-list 1000\n");
    expect(platform.unsupported(example)).toEqual([]);

    const steps = sent(desired, platform.render(plain));
    const created = steps.indexOf("exit", steps.indexOf("access-list 1001"));
    expect(steps.indexOf("snmp-server access-list 1001")).toBeGreaterThan(created);
    expect(steps.indexOf("no snmp-server access-list 1000")).toBeGreaterThan(steps.indexOf("snmp-server access-list 1001"));
});

test("a changed SNMP access-list is let go first, as it cannot change while in use, and a gone one is removed last", () => {
    const current = platform.render(example);
    const moved: Device = { ...example, management: { ...example.management, snmp: { users: snmpUsers, allow: ["198.51.100.0/24"] } } };

    expect(sent(platform.render(moved), current)).toEqual([
        "no snmp-server access-list 1001",
        "access-list 1001",
        "no rule 10",
        "rule 10 permit 198.51.100.0 255.255.255.0",
        "exit",
        "snmp-server access-list 1001",
    ]);

    const back = sent(platform.render(plain), current);
    expect(back[0]).toBe("snmp-server access-list 1000");
    expect(back.indexOf("no snmp-server access-list 1001")).toBeGreaterThan(0);
    expect(back.at(-1)).toBe("no access-list 1001");
});
