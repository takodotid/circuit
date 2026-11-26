// SNMP traps, syslog over TLS, and flow timeouts. They were tested on a CCR2216 with RouterOS 7.24.6, a QFX5100 with Junos 21.4R3, and a FortiGate 3700D with FortiOS 6.2.2. VRP's were tested on a CE6855 with V200R005C00SPC800. On each, receivers at documentation addresses were set, then taken away. The lines each device printed are fed to the adapters.

import { expect, test } from "bun:test";
import { Checks } from "../../src/checks";
import type { Device, FlowExport, SnmpTrapTarget, SyslogServer } from "../../src/model";
import { Platforms } from "../../src/platforms";
import { Fixtures } from "../fixtures";

const options = { secrets: false, rollback: 10 };
const COMMUNITY = { secret: "TRAP_COMMUNITY" };
const USER = {
    auth: "sha1",
    auth_password: { secret: "SNMP_AUTH" },
    privacy: "aes128",
    privacy_password: { secret: "SNMP_PRIVACY" },
} as const;

/** A fixture's device with SNMP user `noc`, these trap receivers, and the syslog collectors and flow export given. */
function monitored(
    fixture: string,
    traps: readonly SnmpTrapTarget[],
    more: { community?: typeof COMMUNITY; syslog?: readonly SyslogServer[]; flow_export?: FlowExport } = {}
): Device {
    const device = Fixtures.device(fixture);
    const { syslog, flow_export, community } = more;
    const snmp = { allow: ["192.0.2.0/24" as const], users: { noc: USER }, traps, ...(community ? { community } : {}) };
    return { ...device, monitoring: { snmp, ...(syslog ? { syslog } : {}), ...(flow_export ? { flow_export } : {}) } };
}

const sent = (platform: string, desired: string, current: string) =>
    Platforms.get(platform)
        .plan(desired, current, options)
        .steps.flatMap((step) => step.send);

const lines = (text: string, start: string) => text.split("\n").filter((line) => line.startsWith(start));

test("a trap receiver has a community or a user, and flow timeouts are whole seconds of flows", () => {
    const device: Device = {
        ...monitored("platforms--example-router", [
            { address: "192.0.2.10" },
            { address: "192.0.2.11", community: COMMUNITY, user: "noc" },
        ]),
    };
    const sflow: Device = {
        ...device,
        monitoring: {
            ...device.monitoring,
            flow_export: { protocol: "sflow", collectors: [{ address: "192.0.2.30" }], sampling: 1000, active_timeout: 1.5 },
        },
    };
    const found = Checks.run([sflow], undefined)
        .map((finding) => finding.message)
        .filter((message) => message.startsWith("monitoring."));

    expect(found).toEqual([
        "monitoring.snmp.traps[0]: write community for version 2c, or user for version 3, not both or neither",
        "monitoring.snmp.traps[1]: write community for version 2c, or user for version 3, not both or neither",
        "monitoring.flow_export.active_timeout 1.5: write a whole number of seconds, from 1",
        "monitoring.flow_export.active_timeout: sFlow sends packet samples, not flows. Remove it, or export netflow-v9 or ipfix",
    ]);
});

test("RouterOS sends every trap as one user, to the generators it has, and plans nothing against how it prints them", () => {
    const routeros = Platforms.get("routeros");
    const device = monitored("edge-router--edge-01", [
        { address: "192.0.2.10", user: "noc" },
        { address: "2001:db8::10", user: "noc" },
    ]);
    const desired = routeros.render(device);
    const snmp =
        "trap-community=noc trap-generators=interfaces,start-trap,temp-exception trap-interfaces=all trap-target=192.0.2.10,2001:db8::10 trap-version=3";

    expect(routeros.unsupported(device)).toEqual(routeros.unsupported(monitored("edge-router--edge-01", [])));

    // As the CCR2216 printed them, without its contact and location, which are empty.
    const printed = desired.replace(/^set contact="" enabled=yes location="" .*$/m, `set enabled=yes ${snmp}`);
    expect(printed).toContain(snmp);
    expect(sent("routeros", desired, printed)).toEqual([]);
    expect(sent("routeros", desired, desired.replace(/^set contact.*trap-community.*$/m, "set enabled=yes"))).toEqual([
        `/snmp set ${snmp}`,
    ]);

    // Without receivers, each is set back to what the device shipped with.
    expect(sent("routeros", routeros.render(monitored("edge-router--edge-01", [])), printed)).toEqual([
        '/snmp set trap-community=public trap-generators=temp-exception trap-interfaces="" trap-target="" trap-version=1',
    ]);
});

test("RouterOS sends version 2c traps with the read community, which it keeps as the device names it", () => {
    const routeros = Platforms.get("routeros");
    const device = monitored("edge-router--edge-01", [{ address: "192.0.2.10", community: COMMUNITY }], { community: COMMUNITY });
    const desired = routeros.render(device);

    expect(desired).toContain('trap-community="<secret:TRAP_COMMUNITY>"');
    expect(desired).toContain("trap-version=2");

    // The device prints the community by its value, which a plan without secrets leaves as it is.
    const printed = desired.replace(/<secret:TRAP_COMMUNITY>/g, "sesame-trap");
    expect(sent("routeros", desired, printed)).toEqual([]);
});

test("RouterOS refuses what it cannot send: another port, a second sender, a community of its own, and syslog over TLS", () => {
    const device = monitored(
        "edge-router--edge-01",
        [
            { address: "192.0.2.10", user: "noc", port: 1162 },
            { address: "192.0.2.11", community: COMMUNITY },
        ],
        { syslog: [{ address: "192.0.2.20", level: "info", transport_security: { ca_certificate: "noc-ca" } }] }
    );

    expect(Platforms.get("routeros").unsupported(device)).toEqual(
        expect.arrayContaining([
            "monitoring.snmp.traps[0].port, the platform sends traps to port 162",
            "monitoring.snmp.traps[1], with another community or user than traps[0]: the platform sends every trap with one",
            "monitoring.snmp.traps[1].community, other than monitoring.snmp.community: the platform sends traps with one of its communities",
            "monitoring.syslog[0].transport_security, RouterOS sends each message over TLS without the framing of RFC 5425, no length before it and no line feed after it (TRAPS.md)",
        ])
    );
});

test("RouterOS writes flow timeouts as durations, and sets them back to its own", () => {
    const routeros = Platforms.get("routeros");
    const flow = (timeouts: Partial<FlowExport>) =>
        monitored("edge-router--edge-01", [], {
            flow_export: { protocol: "ipfix", collectors: [{ address: "192.0.2.30" }], ...timeouts },
        });
    const on = routeros.render(flow({ active_timeout: 60, idle_timeout: 10 }));
    const off = routeros.render(flow({}));

    expect(on).toContain("set active-flow-timeout=1m enabled=yes inactive-flow-timeout=10s interfaces=all packet-sampling=no");
    expect(sent("routeros", off, on)).toEqual(["/ip traffic-flow set active-flow-timeout=30m inactive-flow-timeout=15s"]);
});

test("Junos names a version 2c trap group by its community and a version 3 receiver by its address, as the switch prints them", () => {
    const junos = Platforms.get("junos");
    const traps: SnmpTrapTarget[] = [
        { address: "192.0.2.10", community: COMMUNITY, port: 1162 },
        { address: "2001:db8::10", community: COMMUNITY, port: 1162 },
        { address: "192.0.2.11", user: "noc", port: 1162 },
        { address: "2001:db8::11", user: "noc" },
    ];
    const desired = junos.render(monitored("platforms--example-aggregation-switch", traps));

    expect(lines(desired, "set snmp trap-group")).toEqual([
        "set snmp trap-group <secret:TRAP_COMMUNITY> version v2",
        "set snmp trap-group <secret:TRAP_COMMUNITY> destination-port 1162",
        "set snmp trap-group <secret:TRAP_COMMUNITY> targets 192.0.2.10",
        "set snmp trap-group <secret:TRAP_COMMUNITY> targets 2001:db8::10",
    ]);
    expect(lines(desired, "set snmp v3 target-address 192.0.2.11")).toEqual([
        "set snmp v3 target-address 192.0.2.11 address 192.0.2.11",
        "set snmp v3 target-address 192.0.2.11 port 1162",
        "set snmp v3 target-address 192.0.2.11 tag-list circuit",
        "set snmp v3 target-address 192.0.2.11 target-parameters noc",
    ]);
    expect(desired).toContain("set snmp v3 target-parameters noc parameters security-name noc");
    expect(desired).toContain("set snmp v3 notify circuit tag circuit");
    expect(desired).toContain("security-level privacy notify-view all");

    // The read redacts the group's name, as it is the community.
    const printed = desired.replace(/<secret:TRAP_COMMUNITY>/g, "<redacted>").replace(/<secret:SNMP_\w+>/g, "<redacted>");
    expect(sent("junos", desired, printed)).toEqual([]);

    const without = junos.render(monitored("platforms--example-aggregation-switch", []));
    expect(sent("junos", without, printed).sort()).toEqual([
        "delete snmp trap-group <redacted>",
        "delete snmp v3 notify circuit",
        "delete snmp v3 target-address 192.0.2.11",
        "delete snmp v3 target-address 2001:db8::11",
        "delete snmp v3 target-parameters noc",
        "delete snmp v3 vacm access group circuit default-context-prefix security-model usm security-level privacy notify-view",
    ]);
});

test("Junos refuses a community's receivers on two ports, syslog over TLS, and flow timeouts", () => {
    const device = monitored(
        "platforms--example-aggregation-switch",
        [
            { address: "192.0.2.10", community: COMMUNITY },
            { address: "192.0.2.11", community: COMMUNITY, port: 1162 },
        ],
        {
            syslog: [{ address: "192.0.2.20", level: "info", transport_security: { ca_certificate: "noc-ca" } }],
            flow_export: { protocol: "ipfix", collectors: [{ address: "192.0.2.30" }], idle_timeout: 15 },
        }
    );

    expect(Platforms.get("junos").unsupported(device)).toEqual(
        expect.arrayContaining([
            "monitoring.snmp.traps[1].port, unlike another receiver of its community: a trap group has one port",
            "monitoring.syslog[0].transport_security, which needs its CA certificate on the switch: Junos loads one with an operational command, request security pki ca-certificate load, not a statement",
            "monitoring.flow_export.idle_timeout, a QFX5100 exports sFlow only, which has no flows: Juniper lists IPFIX for no QFX5100",
        ])
    );
});

test("FortiOS sends traps from a community of their own and from a user, and plans nothing against how it prints them", () => {
    const fortios = Platforms.get("fortios");
    const traps: SnmpTrapTarget[] = [
        { address: "192.0.2.10", community: COMMUNITY, port: 1162 },
        { address: "2001:db8::10", community: COMMUNITY, port: 1162 },
        { address: "192.0.2.11", user: "noc", port: 1162 },
        { address: "2001:db8::11", user: "noc", port: 1162 },
    ];
    const desired = fortios.render(monitored("platforms--example-firewall", traps));
    const section = (name: string, text: string) => text.match(new RegExp(`^config ${name}\\n[\\s\\S]*?^end\\n`, "m"))![0];

    // As the FortiGate printed them.
    const community = `config system snmp community
    edit 1
        set name "<redacted>"
        config hosts
            edit 1
                set ip 192.0.2.10 255.255.255.255
                set host-type trap
            next
        end
        config hosts6
            edit 1
                set ipv6 2001:db8::10/128
                set host-type trap
            next
        end
        set query-v1-status disable
        set query-v2c-status disable
        set trap-v1-status disable
        set trap-v2c-rport 1162
    next
end
`;
    const user = `config system snmp user
    edit "noc"
        set trap-rport 1162
        set notify-hosts 192.0.2.11
        set notify-hosts6 2001:db8::11
        set security-level auth-priv
        set auth-pwd ENC <redacted>
        set priv-pwd ENC <redacted>
    next
end
`;
    expect(sent("fortios", section("system snmp community", desired), community)).toEqual([]);
    expect(sent("fortios", section("system snmp user", desired), user)).toEqual([]);
});

test("FortiOS sends syslog over TLS on its own port after the settings that reset it, and refuses what it cannot set", () => {
    const fortios = Platforms.get("fortios");
    const collector = { address: "192.0.2.20", level: "info", transport_security: { ca_certificate: "noc-ca" } } as const;
    const device = monitored("platforms--example-firewall", [], {
        syslog: [{ ...collector, port: 10514 }],
        flow_export: { protocol: "netflow-v9", collectors: [{ address: "192.0.2.30" }], active_timeout: 90, idle_timeout: 5 },
    });
    const desired = fortios.render(device);

    expect(desired).toContain(`config log syslogd setting
    set status enable
    set server "192.0.2.20"
    set mode reliable
    set enc-algorithm high
    set port 10514
end`);
    expect(fortios.experimental!(device)).toContain("monitoring.syslog[0].transport_security");
    expect(fortios.unsupported(device)).toEqual(
        expect.arrayContaining([
            "monitoring.flow_export.active_timeout, from 60 to 3600 seconds in whole minutes: the platform sets it in minutes",
            "monitoring.flow_export.idle_timeout, from 10 to 600 seconds on the platform",
        ])
    );

    const timeouts = monitored("platforms--example-firewall", [], {
        flow_export: { protocol: "netflow-v9", collectors: [{ address: "192.0.2.30" }], active_timeout: 300, idle_timeout: 60 },
    });
    expect(fortios.render(timeouts)).toContain("    set active-flow-timeout 5\n    set inactive-flow-timeout 60\n");
});

test("Raisecom ROS refuses traps, syslog over TLS, and flow timeouts", () => {
    const device = monitored("platforms--example-core-switch", [{ address: "192.0.2.10", user: "noc" }], {
        syslog: [{ address: "192.0.2.20", level: "info", transport_security: { ca_certificate: "noc-ca" } }],
        flow_export: { protocol: "sflow", collectors: [{ address: "192.0.2.30" }], sampling: 1000, active_timeout: 60 },
    });

    expect(Platforms.get(device.platform).unsupported(device)).toEqual(
        expect.arrayContaining([
            "monitoring.snmp.traps, which the platform does not build",
            "monitoring.syslog[0].transport_security, which the platform does not build",
            "monitoring.flow_export.active_timeout, which the platform does not build",
        ])
    );
});

test("VRP sends every trap as a user, and plans nothing against how a CE6855 printed them", () => {
    const vrp = Platforms.get("vrp");
    const device = monitored("platforms--example-switch", [
        { address: "192.0.2.10", user: "noc" },
        { address: "192.0.2.11", port: 1162, user: "noc" },
    ]);
    const desired = vrp.render(device);

    expect(vrp.unsupported(device)).toEqual([]);
    expect(lines(desired, "snmp-agent t")).toEqual([
        "snmp-agent target-host trap address udp-domain 192.0.2.10 params securityname noc v3 privacy",
        "snmp-agent target-host trap address udp-domain 192.0.2.11 udp-port 1162 params securityname noc v3 privacy",
        "snmp-agent trap enable",
    ]);
    expect(sent("vrp", desired, desired)).toEqual([]);

    // A receiver is undone without its version.
    const left = monitored("platforms--example-switch", [{ address: "192.0.2.11", port: 1162, user: "noc" }]);
    expect(sent("vrp", vrp.render(left), desired)).toEqual([
        "undo snmp-agent target-host trap address udp-domain 192.0.2.10 params securityname noc",
    ]);
});

test("VRP refuses a community's receiver, which the switch takes away only by the community it can't show", () => {
    const device = monitored("platforms--example-switch", [{ address: "192.0.2.11", community: COMMUNITY }]);
    expect(Platforms.get("vrp").unsupported(device)).toContain(
        "monitoring.snmp.traps[0].community, the switch takes a receiver away only by its community, which it keeps as a cipher Circuit can't read back: write user"
    );
});

test("VRP exports NetFlow v9 of both families from the ports it watches, and plans nothing against how a CE6855 printed it", () => {
    const vrp = Platforms.get("vrp");
    const flow: FlowExport = {
        protocol: "netflow-v9",
        collectors: [{ address: "192.0.2.30" }, { address: "192.0.2.31", port: 9995 }],
        sampling: 4096,
        interfaces: ["10g-1"],
        active_timeout: 600,
        idle_timeout: 60,
    };
    const device = monitored("platforms--example-switch", [], { flow_export: flow });
    const desired = vrp.render(device);

    expect(vrp.unsupported(device)).toEqual([]);
    // No packet crossed a watched port, and Huawei lists no NetStream for the CE6855HI.
    expect(vrp.experimental!(device)).toContain("monitoring.flow_export");
    expect(lines(desired, "netstream")).toEqual([
        "netstream export ip version 9",
        "netstream export ip host 192.0.2.30 2055",
        "netstream export ip host 192.0.2.31 9995",
        "netstream timeout ip active 10",
        "netstream timeout ip inactive 60",
        "netstream export ipv6 version 9",
        "netstream export ipv6 host 192.0.2.30 2055",
        "netstream export ipv6 host 192.0.2.31 9995",
        "netstream timeout ipv6 active 10",
        "netstream timeout ipv6 inactive 60",
    ]);
    expect(desired).toContain(" netstream inbound ip\n netstream inbound ipv6\n netstream sampler random-packets 4096 inbound\n");

    // The switch prints the version with a space after it.
    const printed = desired.replace(/netstream export (ip|ipv6) version 9\n/g, "netstream export $1 version 9 \n");
    expect(sent("vrp", desired, printed)).toEqual([]);

    // Its own timeouts, 30 minutes and 30 seconds, are not printed. A new rate replaces the port's sampler.
    const plain = vrp.render(
        monitored("platforms--example-switch", [], { flow_export: { ...flow, sampling: 8192, active_timeout: 1800, idle_timeout: 30 } })
    );
    expect(lines(plain, "netstream timeout")).toEqual([]);
    expect(sent("vrp", plain, printed)).toEqual([
        "undo netstream timeout ipv6 inactive",
        "undo netstream timeout ipv6 active",
        "undo netstream timeout ip inactive",
        "undo netstream timeout ip active",
        "interface 10GE1/0/1",
        "netstream sampler random-packets 8192 inbound",
        "quit",
    ]);
});

test("VRP refuses syslog over TLS, whose CA the switch loads from a file", () => {
    const device = monitored("platforms--example-switch", [], {
        syslog: [{ address: "192.0.2.20", level: "info", transport_security: { ca_certificate: "noc-ca" } }],
    });
    expect(Platforms.get("vrp").unsupported(device)).toContain(
        "monitoring.syslog[0].transport_security, the switch loads a CA only from a file on its flash, which Circuit does not copy there"
    );
});

test("VRP refuses what NetStream can't do", () => {
    const device = monitored("platforms--example-switch", [], {
        flow_export: {
            protocol: "netflow-v9",
            collectors: [{ address: "192.0.2.30" }, { address: "192.0.2.31" }, { address: "2001:db8::30" }],
            interfaces: ["uplink"],
            active_timeout: 90,
            idle_timeout: 4,
        },
    });

    expect(Platforms.get("vrp").unsupported(device)).toEqual(
        expect.arrayContaining([
            "monitoring.flow_export.sampling, required and from 1 to 65535 on the platform: whether the switch keeps every packet without a sampler is not known",
            "monitoring.flow_export.collectors, 2 at most on the platform",
            "monitoring.flow_export.collectors 2001:db8::30, IPv6 is not tested",
            "monitoring.flow_export.interfaces uplink, the platform watches ports: NetStream elsewhere is not tested",
            "monitoring.flow_export.active_timeout, whole minutes from 60 to 3600 seconds on the platform",
            "monitoring.flow_export.idle_timeout, from 5 to 600 seconds on the platform",
        ])
    );
});
