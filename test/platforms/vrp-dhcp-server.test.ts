// DHCP servers on VRP, against what a CE6855 on V200R005C00SPC800 printed for a pool. Addresses are from documentation ranges.

import { expect, test } from "bun:test";
import type { Device, DhcpServer } from "../../src/model";
import { Vrp } from "../../src/platforms/vrp/index";
import { Fixtures } from "../fixtures";

const vrp = new Vrp();
const switchDevice = Fixtures.device("platforms--example-switch");
const options = { secrets: false, rollback: 10 };

const sent = (desired: string, current: string) => vrp.plan(desired, current, options).steps.flatMap((step) => step.send);

/** The example switch without its DHCP relay, serving `servers` itself. */
const serving = (servers: Record<string, DhcpServer>): Device => ({
    ...switchDevice,
    services: { dhcp_server: servers },
});

const management: DhcpServer = {
    interface: "management",
    network: "192.0.2.0/24",
    gateway: "192.0.2.254",
    dns: ["192.0.2.53", "192.0.2.54"],
    pool: ["192.0.2.100", "192.0.2.200"],
    lease_time: 43200,
    reservations: [
        { address: "192.0.2.50", mac: "02:00:5E:00:53:02" },
        { address: "192.0.2.150", mac: "02:00:5e:00:53:01" },
        { address: "192.0.2.3", mac: "02:00:5e:00:53:03" },
    ],
};

test("a DHCP server renders as the pool the switch prints, outside its range excluded but for the gateway and reservations", () => {
    const device = serving({ management });
    const rendered = vrp.render(device);

    expect(rendered).toContain(
        [
            "ip pool management",
            " gateway-list 192.0.2.254",
            " network 192.0.2.0 mask 255.255.255.0",
            " static-bind ip-address 192.0.2.50 mac-address 0200-5e00-5302",
            " static-bind ip-address 192.0.2.150 mac-address 0200-5e00-5301",
            " static-bind ip-address 192.0.2.3 mac-address 0200-5e00-5303",
            " excluded-ip-address 192.0.2.1 192.0.2.2",
            " excluded-ip-address 192.0.2.4 192.0.2.49",
            " excluded-ip-address 192.0.2.51 192.0.2.99",
            " excluded-ip-address 192.0.2.201 192.0.2.253",
            " lease day 0 hour 12 minute 0",
            " dns-list 192.0.2.53 192.0.2.54",
            "#",
        ].join("\n")
    );
    expect(rendered).toContain("\ndhcp enable\n");
    expect(vrp.unsupported(device)).toEqual([]);
    expect(vrp.experimental(device)).toEqual(["services.dhcp_server.management"]);
});

test("a pool in a VRF names it first, a one-address exclusion is the address alone, and a lease of a day is the switch's own", () => {
    const rendered = vrp.render(
        serving({
            guests: {
                interface: "guests",
                network: "198.51.100.128/26",
                gateway: "198.51.100.130",
                pool: ["198.51.100.132", "198.51.100.190"],
                lease_time: 86400,
            },
        })
    );

    expect(rendered).toContain(
        [
            "ip pool guests",
            " vpn-instance guests",
            " gateway-list 198.51.100.130",
            " network 198.51.100.128 mask 255.255.255.192",
            " excluded-ip-address 198.51.100.129",
            " excluded-ip-address 198.51.100.131",
            "#",
        ].join("\n")
    );
});

// The pools a CE6855 printed after `commit trial`, its trailing spaces kept. It prints static bindings by address.
const printed = [
    "ip pool ctest",
    " gateway-list 192.0.2.1 ",
    " network 192.0.2.0 mask 255.255.255.0",
    " static-bind ip-address 192.0.2.3 mac-address 0200-5e00-5303",
    " static-bind ip-address 192.0.2.50 mac-address 0200-5e00-5302",
    " static-bind ip-address 192.0.2.150 mac-address 0200-5e00-5301",
    " excluded-ip-address 192.0.2.2",
    " excluded-ip-address 192.0.2.4 192.0.2.49",
    " excluded-ip-address 192.0.2.51 192.0.2.99",
    " excluded-ip-address 192.0.2.201 192.0.2.254",
    " lease day 0 hour 12 minute 0",
    " dns-list 192.0.2.53 192.0.2.54 ",
    "#",
    "ip pool ctest-vrf",
    " vpn-instance ctest-vrf",
    " gateway-list 198.51.100.1 ",
    " network 198.51.100.0 mask 255.255.255.0",
    " excluded-ip-address 198.51.100.2 198.51.100.9",
    "#",
].join("\n");

test("the pools the switch printed plan nothing against the render", () => {
    const servers = {
        ctest: { ...management, gateway: "192.0.2.1" },
        "ctest-vrf": {
            interface: "guests",
            network: "198.51.100.0/24",
            gateway: "198.51.100.1",
            pool: ["198.51.100.10", "198.51.100.254"],
            lease_time: 86400,
        },
    } satisfies Record<string, DhcpServer>;
    const device: Device = {
        ...serving(servers),
        routing: { vrfs: { "ctest-vrf": {} } },
        interfaces: {
            ...switchDevice.interfaces,
            vlan_interface: {
                ...switchDevice.interfaces!.vlan_interface,
                guests: { vlan: "guests", vrf: "ctest-vrf", addresses: ["198.51.100.1/24"] },
            },
        },
    };
    const rendered = vrp.render(device);
    const pools = rendered.slice(rendered.indexOf("ip pool ctest\n"), rendered.indexOf("#", rendered.indexOf("ip pool ctest-vrf")) + 1);

    expect(vrp.unsupported(device)).toEqual([]);
    expect(vrp.plan(pools, printed, options).steps).toEqual([]);
});

test("a pool whose gateway changes is removed and written again, as the switch changes a gateway only once the network is gone", () => {
    const desired = printed.replace(/192\.0\.2\.1 \n/, "192.0.2.254\n").replace("192.0.2.201 192.0.2.254", "192.0.2.201 192.0.2.253");

    expect(sent(desired, printed)).toEqual([
        "undo ip pool ctest",
        "ip pool ctest",
        "gateway-list 192.0.2.254",
        "network 192.0.2.0 mask 255.255.255.0",
        "static-bind ip-address 192.0.2.3 mac-address 0200-5e00-5303",
        "static-bind ip-address 192.0.2.50 mac-address 0200-5e00-5302",
        "static-bind ip-address 192.0.2.150 mac-address 0200-5e00-5301",
        "excluded-ip-address 192.0.2.2",
        "excluded-ip-address 192.0.2.4 192.0.2.49",
        "excluded-ip-address 192.0.2.51 192.0.2.99",
        "excluded-ip-address 192.0.2.201 192.0.2.253",
        "lease day 0 hour 12 minute 0",
        "dns-list 192.0.2.53 192.0.2.54",
        "quit",
    ]);
});

test("a pool that changes undoes each changed line whole before it sends the new one", () => {
    const current = [
        "ip pool management",
        " gateway-list 192.0.2.254",
        " network 192.0.2.0 mask 255.255.255.0",
        " static-bind ip-address 192.0.2.50 mac-address 0200-5e00-5302",
        " excluded-ip-address 192.0.2.1 192.0.2.49",
        " excluded-ip-address 192.0.2.51 192.0.2.99",
        " lease day 0 hour 12 minute 0",
        " dns-list 192.0.2.53 192.0.2.54",
        "#",
    ].join("\n");
    const desired = [
        "ip pool management",
        " gateway-list 192.0.2.254",
        " network 192.0.2.0 mask 255.255.255.0",
        " excluded-ip-address 192.0.2.1 192.0.2.99",
        " dns-list 192.0.2.53",
        "#",
    ].join("\n");

    expect(sent(desired, current)).toEqual([
        "ip pool management",
        "undo dns-list 192.0.2.53 192.0.2.54",
        "undo lease",
        "undo excluded-ip-address 192.0.2.51 192.0.2.99",
        "undo excluded-ip-address 192.0.2.1 192.0.2.49",
        "undo static-bind ip-address 192.0.2.50",
        "excluded-ip-address 192.0.2.1 192.0.2.99",
        "dns-list 192.0.2.53",
        "quit",
    ]);
    expect(sent("", `${current}\ndhcp enable\n`)).toEqual(["undo dhcp enable", "undo ip pool management"]);
});

test("what a pool can't hold is refused", () => {
    const device = serving({
        "on a port": { ...management, interface: "10g-1" },
        elsewhere: { ...management, network: "203.0.113.0/24" },
        "many-resolvers": {
            ...management,
            dns: ["192.0.2.1", "192.0.2.2", "192.0.2.3", "192.0.2.4", "192.0.2.5", "192.0.2.6", "192.0.2.7", "192.0.2.8", "192.0.2.9"],
        },
        ipv6: { ...management, dns: ["2001:db8::53"] },
        seconds: { ...management, lease_time: 90 },
        described: { ...management, reservations: [{ address: "192.0.2.50", mac: "02:00:5e:00:53:02", description: "Printer" }] },
    });

    expect(vrp.unsupported(device)).toEqual([
        "services.dhcp_server.on a port, a pool name of letters, digits, '-', '_' and '.', 64 characters at most",
        "services.dhcp_server.on a port.interface, the switch serves DHCP on VLAN interfaces",
        "services.dhcp_server.elsewhere.interface, which has no address in 203.0.113.0/24: the switch picks a pool by that address",
        "services.dhcp_server.many-resolvers.dns, 8 servers at most",
        "services.dhcp_server.ipv6.dns, IPv6, which DHCP gives no client",
        "services.dhcp_server.seconds.lease_time, whole minutes up to 999 days on the platform",
        "services.dhcp_server.described.reservations[0].description, which a static binding on the switch has no place for",
    ]);
});
