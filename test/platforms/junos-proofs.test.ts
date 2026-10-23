// What a QFX5100-48S-6Q on Junos 21.4R3 printed when each feature was proved on it, with names and addresses replaced.

import { expect, test } from "bun:test";
import aggregationSwitch from "../../examples/platforms/junos";
import { Junos } from "../../src/platforms/junos";

// `show lldp neighbors detail | display xml`, trimmed of the TLVs Circuit does not read. 40G port 5 is `et-0/0/52`: the device counts from 0, after the 48 10G ports.
const LLDP_DETAIL = `<rpc-reply xmlns:junos="http://xml.juniper.net/junos/21.4R0/junos">
    <lldp-neighbors-information xmlns="http://xml.juniper.net/junos/21.4R0/lldp-mtx" junos:style="detail">
        <lldp-neighbor-information>
            <lldp-index>16</lldp-index>
            <lldp-ttl>120</lldp-ttl>
            <lldp-local-interface>et-0/0/52</lldp-local-interface>
            <lldp-local-parent-interface-name>-</lldp-local-parent-interface-name>
            <lldp-local-port-id>520</lldp-local-port-id>
            <lldp-local-port-ageout-count>0</lldp-local-port-ageout-count>
            <lldp-remote-chassis-id-subtype>Mac address</lldp-remote-chassis-id-subtype>
            <lldp-remote-chassis-id>02:00:00:00:00:01</lldp-remote-chassis-id>
            <lldp-remote-port-id-subtype>Interface name</lldp-remote-port-id-subtype>
            <lldp-remote-port-id>hundredgige1/1/4</lldp-remote-port-id>
            <lldp-remote-port-description>switch uplink</lldp-remote-port-description>
            <lldp-remote-system-name>Raisecom</lldp-remote-system-name>
            <lldp-system-description>
                <lldp-remote-system-description>Raisecom Operating System Software,RAX721-C-6C48,ROS,Copyright (c) 2006-2026 Raisecom Science &amp; Technology Development Co.,Ltd</lldp-remote-system-description>
            </lldp-system-description>
            <lldp-remote-management-address>192.0.2.10</lldp-remote-management-address>
        </lldp-neighbor-information>
    </lldp-neighbors-information>
    <cli>
        <banner>{master:0}</banner>
    </cli>
</rpc-reply>
`;

test("LLDP neighbors are read from the detail XML, on our port by Circuit's name", () => {
    expect(Junos.neighborsOf(aggregationSwitch, LLDP_DETAIL)).toEqual([
        { port: "40g-5", system: "Raisecom", remote_port: "hundredgige1/1/4" },
    ]);
});

test("a neighbor on a 10G cage holding a 1G optic is on that cage's port, and one without a system name is named by its chassis ID", () => {
    const xml = LLDP_DETAIL.replace("et-0/0/52", "ge-0/0/1").replace("<lldp-remote-system-name>Raisecom</lldp-remote-system-name>", "");

    expect(Junos.neighborsOf(aggregationSwitch, xml)).toEqual([
        { port: "10g-2", system: "02:00:00:00:00:01", remote_port: "hundredgige1/1/4" },
    ]);
});
