// DHCP servers that ask RADIUS about each lease (IPoE). The exports here copy how a CHR on 7.24.6 printed them, in test/platforms/routeros-chr-ipoe.test.ts.

import { expect, test } from "bun:test";
import { Checks } from "../../src/checks";
import type { Device, DhcpServer, RadiusServer } from "../../src/model";
import { Platforms } from "../../src/platforms";
import { Fixtures } from "../fixtures";

const options = { secrets: false, rollback: 10 };

const RADIUS: RadiusServer[] = [{ address: "192.0.2.10", secret_key: { secret: "RADIUS" } }];

/** The example router's DHCP server on `servers`, which asks RADIUS. */
const HOMES: DhcpServer = {
    interface: "servers",
    network: "198.51.100.64/26",
    gateway: "198.51.100.65",
    pool: ["198.51.100.100", "198.51.100.120"],
    radius: RADIUS,
    acct_interim_interval: 300,
};

/** The example router with these DHCP servers. */
function serving(servers: Record<string, DhcpServer>): Device {
    const device = structuredClone(Fixtures.device("platforms--example-router"));
    device.services = { ...device.services, dhcp_server: servers };
    return device;
}

const routeros = Platforms.get("routeros");

const sent = (desired: string, current: string) => routeros.plan(desired, current, options).steps.flatMap((step) => step.send);

const errors = (device: Device) =>
    Checks.run([device], undefined)
        .filter((finding) => finding.level === "error" && finding.message.startsWith("services.dhcp_server"))
        .map((finding) => finding.message);

test("RouterOS has the server ask RADIUS, and writes RADIUS for DHCP and the interim interval of every server", () => {
    const desired = routeros.render(serving({ homes: HOMES }));

    expect(desired).toContain("add address-pool=homes interface=servers name=homes use-radius=yes");
    expect(desired).toContain('add address=192.0.2.10 secret="<secret:RADIUS>" service=dhcp');
    expect(desired).toContain("/ip dhcp-server config\nset interim-update=5m");
    expect(sent(desired, desired)).toEqual([]);
});

test("RouterOS writes the same RADIUS server once for PPP and once for DHCP, each service's list on its own", () => {
    const device = serving({ homes: HOMES });
    device.services = {
        ...device.services,
        pppoe_server: {
            "olt-1": { interfaces: ["guests"], local_address: "100.64.0.1", pool: ["100.64.0.2", "100.64.63.254"], radius: RADIUS },
        },
    };
    const desired = routeros.render(device);

    expect(desired).toContain(
        '/radius\nadd address=192.0.2.10 secret="<secret:RADIUS>" service=dhcp\nadd address=192.0.2.10 secret="<secret:RADIUS>" service=ppp'
    );
    expect(sent(desired, desired)).toEqual([]);
});

test("RouterOS sets the router-wide DHCP settings back once no server asks RADIUS", () => {
    const { radius: _radius, acct_interim_interval: _interval, ...plain } = HOMES;
    const plan = sent(routeros.render(serving({ homes: plain })), routeros.render(serving({ homes: HOMES })));

    expect(plan).toContain("/ip dhcp-server set [ find name=homes ] use-radius=no");
    expect(plan).toContain("/ip dhcp-server config set interim-update=0s");
    expect(plan.some((line) => line.includes("/radius remove"))).toBe(true);
});

test("RouterOS refuses DHCP servers that ask RADIUS with other settings", () => {
    const refused = routeros.unsupported(
        serving({ homes: HOMES, guests: { ...HOMES, interface: "guests", network: "198.51.100.128/26", acct_interim_interval: 600 } })
    );
    expect(refused).toContain(
        "services.dhcp_server.guests, RouterOS has one RADIUS setting for all its DHCP servers: write the radius and acct_interim_interval of services.dhcp_server.homes"
    );
});

test("the other platforms refuse a lease checked by RADIUS", () => {
    for (const [platform, os] of [
        ["junos", "Junos"],
        ["vrp", "VRP"],
        ["fortios", "FortiOS"],
    ] as const) {
        const [fixture] = Fixtures.ofPlatform(platform);
        const device = structuredClone(Fixtures.device(fixture ?? ""));
        const [iface] = Object.keys(device.interfaces?.vlan_interface ?? device.interfaces?.ethernet ?? {});
        device.services = { ...device.services, dhcp_server: { homes: { ...HOMES, interface: iface! } } };

        expect(Platforms.get(platform).unsupported(device), platform).toContain(
            `services.dhcp_server.homes.radius, a lease checked by RADIUS, not built for ${os}`
        );
    }
});

test("validate wants RADIUS servers before an interim interval, and an interval RFC 2869 allows", () => {
    const { radius: _radius, ...withoutRadius } = HOMES;
    const device = serving({
        homes: { ...HOMES, radius: [], acct_interim_interval: 30 },
        guests: { ...withoutRadius, interface: "guests" },
    });

    expect(errors(device)).toEqual([
        "services.dhcp_server.homes.radius is empty: write the RADIUS servers that check each lease, or leave it out",
        "services.dhcp_server.homes.acct_interim_interval 30 is not a whole number of seconds from 60, the least RFC 2869 allows",
        "services.dhcp_server.guests.acct_interim_interval without radius: write the RADIUS servers that get the reports, or leave it out",
    ]);
});
