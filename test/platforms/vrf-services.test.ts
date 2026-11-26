// The device's own services in a VRF. RouterOS was tested on the CI CHRs (test/platforms/routeros-chr-vrf-services.test.ts). On a QFX5100 with Junos 21.4R3, a syslog collector in a VRF was committed and read back, and NTP, RADIUS, and a DHCP server in one passed `commit check`.

import { expect, test } from "bun:test";
import type { Device } from "../../src/model";
import { Platforms } from "../../src/platforms";
import { Fixtures } from "../fixtures";

/** A fixture's device with its `management` VLAN interface in VRF `mgmt`, and every service of its own there. */
function inVrf(fixture: string): Device {
    const device = Fixtures.device(fixture);
    const vrf = "mgmt";
    const management = device.interfaces!.vlan_interface!.management!;
    return {
        ...device,
        interfaces: { ...device.interfaces, vlan_interface: { ...device.interfaces!.vlan_interface, management: { ...management, vrf } } },
        system: {
            ...device.system,
            ntp: { servers: ["192.0.2.1"], vrf },
            dns: { servers: ["192.0.2.53"], vrf },
            aaa: { radius: [{ address: "192.0.2.11", secret_key: { secret: "RADIUS_KEY" }, vrf }], remote_role: "read-only" },
        },
        management: { ...device.management, ssh: { vrf } },
        monitoring: {
            ...device.monitoring,
            snmp: { ...device.monitoring!.snmp, vrf },
            syslog: [{ address: "192.0.2.14", level: "warning", vrf }],
        },
        routing: { ...device.routing, vrfs: { mgmt: {} } },
    };
}

test("RouterOS puts each service in the VRF, and a server's address names it", () => {
    const desired = Platforms.get("routeros").render(inVrf("platforms--example-router"));

    for (const line of [
        /^set ssh .*vrf=mgmt$/m,
        /^\/snmp\nset .*vrf=mgmt/m,
        /^\/system ntp client\nset enabled=yes vrf=mgmt$/m,
        /^set .*servers=192\.0\.2\.53@mgmt/m,
        /^add name=remote1 remote=192\.0\.2\.14 target=remote vrf=mgmt$/m,
        /^add address=192\.0\.2\.11@mgmt /m,
    ])
        expect(desired).toMatch(line);
});

test("RouterOS refuses FTP in a VRF", () => {
    const device = inVrf("platforms--example-router");
    const ftp = { ...device, management: { ...device.management, ftp: { vrf: "mgmt" } } };
    expect(Platforms.get("routeros").unsupported(ftp)).toContain("management.ftp.vrf, the platform answers FTP in the main table only");
});

test("Junos reaches syslog, NTP, and RADIUS servers through the routing instance, and serves DHCP in it", () => {
    const junos = Platforms.get("junos");
    const device = inVrf("platforms--example-aggregation-switch");
    const desired = junos.render(device);

    for (const line of [
        "set system syslog host 192.0.2.14 routing-instance mgmt",
        "set system ntp server 192.0.2.1 routing-instance mgmt",
        "set system radius-server 192.0.2.11 routing-instance mgmt",
        "set routing-instances mgmt system services dhcp-local-server group management interface irb.1",
        "set routing-instances mgmt access address-assignment pool management family inet network 192.0.2.0/24",
    ])
        expect(desired).toContain(line);

    expect(junos.experimental!(device)).toEqual([
        "system.ntp.vrf",
        "system.aaa.radius[0].vrf",
        "services.dhcp_server.management.interface",
    ]);
    expect(junos.unsupported(device)).toEqual(
        expect.arrayContaining([
            "management.ssh.vrf, Junos runs it in the main table only: of the management services, only the REST API takes a routing instance",
            "system.dns.vrf, Junos 21.4 reaches a resolver through mgmt_junos only",
            "monitoring.snmp.vrf, as a manager in a routing instance sends Junos the community <instance>@<community>, not the one written",
        ])
    );
});

// As a QFX5100 on 21.4R3-S8.5 printed it in a private candidate, which passed `commit check`. Nothing was committed.
test("Junos runs the REST API in a VRF, experimentally, as the only management service with a routing instance", () => {
    const junos = Platforms.get("junos");
    const device = inVrf("platforms--example-aggregation-switch");
    device.management = { ...device.management, ssh: {}, api: { vrf: "mgmt" } };

    expect(junos.render(device)).toContain("set system services rest routing-instance mgmt");
    expect(junos.experimental!(device)).toContain("management.api.vrf");
    expect(junos.unsupported(device).filter((gap) => gap.startsWith("management."))).toEqual([]);
});

// On a FG-3700D with 6.2.2, SSH answered on an interface in VRF 1 of a test VDOM, and not on one in VRF 0 without it. A RADIUS server's request with a source address in VRF 1 left by VRF 0's route.
test("FortiOS answers SSH, and SNMP experimentally, on the interfaces of their VRF, and refuses the rest of the services in a VRF", () => {
    const fortios = Platforms.get("fortios");
    const device = inVrf("platforms--example-firewall");
    const desired = fortios.render(device);
    const access = (name: string) =>
        new RegExp(`edit "${name}"\\n(?:(?! {4}next)[^\\n]*\\n)*? {8}set allowaccess ([^\\n]*)\\n`).exec(desired)?.[1];

    // `management` is in VRF mgmt, with SSH and SNMP; `servers` in the main table, with HTTPS and FortiManager's protocol.
    expect(access("management")).toBe("ping ssh snmp");
    expect(access("servers")).toBe("ping https fgfm");
    expect(fortios.experimental!(device)).toContain("monitoring.snmp.vrf");
    expect(fortios.unsupported(device).filter((gap) => /vrf|traps/.test(gap))).toEqual([
        "system.ntp.vrf, FortiOS 6.2 has no VRF setting for it: vrf-select comes in 7.6.1",
        "system.dns.vrf, FortiOS 6.2 has no VRF setting for it: vrf-select comes in 7.6.1",
        "monitoring.syslog[0].vrf, FortiOS 6.2 has no VRF setting for it: vrf-select comes in 7.6.1",
        "system.aaa.radius[0].vrf, FortiOS 6.2 has no VRF setting for it: vrf-select comes in 7.6.1",
    ]);

    const trapping: Device = {
        ...device,
        monitoring: { ...device.monitoring, snmp: { ...device.monitoring!.snmp!, traps: [{ address: "192.0.2.15" }] } },
    };
    expect(fortios.unsupported(trapping)).toContain(
        "monitoring.snmp.traps, beside monitoring.snmp.vrf: FortiOS 6.2 has no VRF setting for traps, only a source address"
    );
});

test("VRP refuses each service in a VRF", () => {
    expect(Platforms.get("vrp").unsupported(inVrf("platforms--example-switch"))).toEqual(
        expect.arrayContaining(["management.ssh.vrf, not built yet", "system.dns.vrf, not built yet"])
    );
});
