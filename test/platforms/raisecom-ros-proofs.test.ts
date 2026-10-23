// What a RAX721 on ROS 6.5.2 printed when each feature was proved on it, with names and addresses changed.

import { expect, test } from "bun:test";
import coreSwitch from "../../examples/platforms/raisecom-ros";
import { RaisecomRos } from "../../src/platforms/raisecom-ros";

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
