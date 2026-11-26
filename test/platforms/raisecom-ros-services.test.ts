// DHCP, trap receivers, and users, as a RAX721 on ROS 6.5.2 printed them (tako-mmr-01, 2026-11-27, #419).

import { expect, test } from "bun:test";
import { Platforms } from "../../src/platforms";
import type { Device } from "../../src/model";
import { Fixtures } from "../fixtures";

const platform = Platforms.get("raisecom-ros");
const core = Fixtures.device("platforms--example-core-switch");

const served = {
    ...core,
    switching: { ...core.switching, vlans: { ...core.switching?.vlans, guests: { id: 3990 } } },
    interfaces: {
        ...core.interfaces,
        vlan_interface: { ...core.interfaces?.vlan_interface, guests: { vlan: "guests", addresses: ["198.51.100.1/24"] } },
    },
    services: {
        dhcp_server: {
            guests: {
                interface: "guests",
                network: "198.51.100.0/24",
                gateway: "198.51.100.1",
                dns: ["198.51.100.53", "198.51.100.54"],
                pool: ["198.51.100.100", "198.51.100.199"],
                lease_time: 36000,
                reservations: [{ address: "198.51.100.150", mac: "02:00:00:00:00:01" }],
            },
        },
    },
    monitoring: {
        ...core.monitoring,
        snmp: {
            ...core.monitoring?.snmp,
            traps: [
                { address: "192.0.2.162", user: "monitor", port: 1162 },
                { address: "2001:db8::162", user: "monitor" },
            ],
        },
    },
} as Device;

/** How the switch printed them, cut to the test's lines. */
const PRINTED = `ip dhcp server pool guests
  address 198.51.100.100 198.51.100.199 mask 255.255.255.0
  gateway 198.51.100.1
  dns-server 198.51.100.53
  dns-server 198.51.100.54 secondary
  lease expired 600
!
interface vlan 3990
ip address 198.51.100.1 255.255.255.0
ip dhcp server
!
snmp-server host 192.0.2.162 version 3 authpriv monitor udpport 1162
snmp-server host 2001:DB8::162 version 3 authpriv monitor
ip dhcp static-bind 198.51.100.150 0200.0000.0001 guests
`;

const blocks = (config: string) =>
    config
        .split("\n")
        .reduce<{ lines: string[]; keep: boolean }>(
            ({ lines, keep }, line) => {
                const opens = /^(ip dhcp server pool guests|interface vlan 3990)$/.test(line);
                const stays = opens || (keep && line !== "!");
                const single = /^(snmp-server host |ip dhcp static-bind )/.test(line);
                if (stays || single || (keep && line === "!")) lines.push(line);
                return { lines, keep: stays };
            },
            { lines: [], keep: false }
        )
        .lines.join("\n");

const sent = (desired: string, current: string) =>
    platform.plan(desired, current, { secrets: false, rollback: 0 }).steps.flatMap((step) => step.send);

test("a DHCP server's pool, its interface, a reservation, and trap receivers render as the switch printed them", () => {
    expect(platform.unsupported(served)).toEqual([]);
    expect(platform.experimental?.(served)).toContain("services.dhcp_server.guests");

    const rendered = blocks(platform.render(served));
    expect(rendered).toContain("snmp-server host 2001:DB8::162 version 3 authpriv monitor");
    expect(sent(rendered, blocks(PRINTED))).toEqual([]);

    // The reservation names the pool, so it comes after it.
    const fresh = sent(platform.render(served), platform.render(core));
    expect(fresh.indexOf("ip dhcp static-bind 198.51.100.150 0200.0000.0001 guests")).toBeGreaterThan(
        fresh.indexOf("ip dhcp server pool guests")
    );
});

test("a changed pool lets its reservations go first, as the switch refuses any change to a pool with one, and binds them again after", () => {
    const changed = structuredClone(served);
    changed.services!.dhcp_server!.guests!.pool = ["198.51.100.100", "198.51.100.149"];
    changed.services!.dhcp_server!.guests!.dns = ["198.51.100.53"];
    changed.services!.dhcp_server!.guests!.reservations = [{ address: "198.51.100.120", mac: "02:00:00:00:00:01" }];

    expect(sent(blocks(platform.render(changed)), blocks(PRINTED)).filter((line) => !line.startsWith("snmp-server"))).toEqual([
        "no ip dhcp static-bind 198.51.100.150 0200.0000.0001",
        "ip dhcp server pool guests",
        "no dns-server secondary",
        "address 198.51.100.100 198.51.100.149 mask 255.255.255.0",
        "exit",
        "ip dhcp static-bind 198.51.100.120 0200.0000.0001 guests",
    ]);
});

test("a gone trap receiver, pool, and reservation go by their address and name", () => {
    const steps = sent(blocks(platform.render(core)), blocks(PRINTED));

    expect(steps).toEqual(
        expect.arrayContaining([
            "no snmp-server host 192.0.2.162",
            "no snmp-server host 2001:DB8::162",
            "no ip dhcp static-bind 198.51.100.150 0200.0000.0001",
            "no ip dhcp server pool guests",
        ])
    );
    expect(steps.indexOf("no ip dhcp static-bind 198.51.100.150 0200.0000.0001")).toBeLessThan(
        steps.indexOf("no ip dhcp server pool guests")
    );
});

test("a community of version 2c prints in clear, and the read hides it", () => {
    const device = {
        ...served,
        monitoring: {
            ...served.monitoring,
            snmp: { ...served.monitoring?.snmp, traps: [{ address: "192.0.2.163", community: { secret: "TRAPS" } }] },
        },
    } as Device;

    const rendered = platform.render(device);
    expect(rendered).toContain("snmp-server host 192.0.2.163 version 2c <secret:TRAPS>\n");
    expect(platform.scrubOutput?.("snmp-server host 192.0.2.163 version 2c ctest-trap\n")).toBe(
        "snmp-server host 192.0.2.163 version 2c <redacted>\n"
    );
    // The same community, hidden by the read, plans nothing for the receiver.
    const printed = `${blocks(PRINTED).replace(/^snmp-server host .*\n?/gm, "")}\nsnmp-server host 192.0.2.163 version 2c <redacted>`;
    expect(sent(blocks(rendered), printed).filter((line) => line.includes("snmp-server host"))).toEqual([]);
});

test("users and the privileged password are set at the # prompt, as configuration mode refuses them, and a gone user goes by name", () => {
    const rendered = platform.render(core);
    const lines = rendered.split("\n").filter((line) => /^(user name|enable password) /.test(line));
    expect(lines.length).toBeGreaterThan(0);

    const steps = sent(
        rendered,
        rendered.replace(/^(user name|enable password) .*\n/gm, "").concat("user name old password cipher 0123\n")
    );
    expect(steps.slice(0, 1)).toEqual(["exit"]);
    expect(steps).toContain("no username old");
    for (const line of lines) expect(steps.indexOf(line)).toBeLessThan(steps.indexOf("config"));
});

test("a DHCP relay relays from its VLAN interface, and turns on for the switch after, with --experimental", () => {
    const device = {
        ...served,
        services: { dhcp_relay: { guests: { interface: "guests", servers: ["192.0.2.67", "192.0.2.68"], relay_agent_information: true } } },
    } as Device;

    const rendered = platform.render(device);
    expect(rendered).toContain(
        "interface vlan 3990\nip address 198.51.100.1 255.255.255.0\nip dhcp relay\nip dhcp relay target-ip 192.0.2.67\nip dhcp relay target-ip 192.0.2.68\n!"
    );
    expect(platform.experimental?.(device)).toContain("services.dhcp_relay.guests");

    const steps = sent(rendered, platform.render(served));
    expect(steps.slice(-2)).toEqual(["ip dhcp relay", "ip dhcp relay information option"]);
});

test("what the switch has none of, or was not tried, is refused with why", () => {
    const device = {
        ...served,
        services: {
            dhcp_server: {
                "guests-of-the-hall": {
                    ...served.services!.dhcp_server!.guests!,
                    interface: "10g-1",
                    dns: ["192.0.2.1", "192.0.2.2", "192.0.2.3"],
                    lease_time: 1000,
                    relay: "198.51.100.2",
                },
            },
            dhcp_relay: { guests: { interface: "guests", servers: ["2001:db8::67"] } },
            dhcpv6_server: { guests: { interface: "guests", prefix: "2001:db8::/64" } },
        },
        management: { ...served.management, http: {}, api_tls: {} },
        system: { ...served.system, certificates: { web: { certificate: "web.pem" } } },
    } as unknown as Device;

    expect(platform.unsupported(device)).toEqual(
        expect.arrayContaining([
            "services.dhcp_server.guests-of-the-hall, a pool name takes 16 characters at most, without spaces",
            "services.dhcp_server.guests-of-the-hall.dns, a pool gives 2 DNS servers at most",
            "services.dhcp_server.guests-of-the-hall.relay, a server for a relay's clients is not tried here",
            "services.dhcp_server.guests-of-the-hall.lease_time 1000, the switch takes whole minutes from 30 to 10080: 1800 to 604800 seconds",
            "services.dhcp_server.guests-of-the-hall.interface 10g-1, tested on a VLAN interface alone",
            "services.dhcp_relay.guests.servers 2001:db8::67, the switch relays to IPv4 servers here",
            "services.dhcpv6_server.guests, an interface here holds IPv4 addresses alone",
            "management.http, ROS 6.5.2 has no web interface",
            "management.api_tls, the switch's API is NETCONF over SSH, which Circuit does not manage yet",
            "system.certificates, ROS 6.5.2 has no certificate store",
        ])
    );
});
