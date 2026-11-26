// DHCPv6 servers (RFC 8415) and the M and O flags. Tested on a CCR2216 with RouterOS 7.24.6, a QFX5100 with Junos 21.4R3, and a FortiGate 3700D with FortiOS 6.2.2. On each, the plan converged as a server was added, changed, and removed. The tests copy how each device prints them.

import { expect, test } from "bun:test";
import { Checks } from "../../src/checks";
import type { Device, Dhcpv6Server, RouterAdvertisement } from "../../src/model";
import { Platforms } from "../../src/platforms";
import { Fixtures } from "../fixtures";

const options = { secrets: false, rollback: 10 };

const FULL: Omit<Dhcpv6Server, "interface"> = {
    pool: ["2001:db8:20::1000", "2001:db8:20::1fff"],
    prefix_delegation: { pool: "2001:db8:20:8000::/49", prefix_length: 56 },
    dns: ["2001:db8:20::53", "2001:db8:20::54"],
    lease_time: 86_400,
};

/** A fixture's device with one DHCPv6 server on its VLAN interface `name`, which sends `ra`. */
function serving(
    fixture: string,
    name: string,
    server: Omit<Dhcpv6Server, "interface">,
    ra: true | RouterAdvertisement = { managed: true }
): Device {
    const device = structuredClone(Fixtures.device(fixture));
    device.interfaces!.vlan_interface![name]!.ipv6_ra = ra;
    device.services = { ...device.services, dhcpv6_server: { [name]: { interface: name, ...server } } };
    return device;
}

const sent = (platform: string, desired: string, current: string) =>
    Platforms.get(platform)
        .plan(desired, current, options)
        .steps.flatMap((step) => step.send);

const findings = (device: Device, level: "error" | "warning") =>
    Checks.run([device], undefined)
        .filter((finding) => finding.level === level)
        .map((finding) => finding.message);

test("RouterOS writes a pool for the addresses and one for the delegated prefixes, and the DNS servers as option 23", () => {
    const routeros = Platforms.get("routeros");
    const desired = routeros.render(serving("platforms--example-router", "servers", FULL, { managed: true, other_config: true }));

    expect(desired).toContain("add name=servers prefix=2001:db8:20::1000/116 prefix-length=128");
    expect(desired).toContain("add name=servers-pd prefix=2001:db8:20:8000::/49 prefix-length=56");
    expect(desired).toContain(`add code=23 name=servers-dns value="'2001:db8:20::53''2001:db8:20::54'"`);
    expect(desired).toContain(
        "add address-pool=servers dhcp-option=servers-dns interface=servers lease-time=1d name=servers prefix-pool=servers-pd"
    );
    expect(desired).toContain("add interface=servers managed-address-configuration=yes other-configuration=yes");
    expect(sent("routeros", desired, desired)).toEqual([]);
});

test("RouterOS takes a server back to options alone with the router's own defaults, before it removes the pools", () => {
    const routeros = Platforms.get("routeros");
    const full = routeros.render(serving("platforms--example-router", "servers", FULL));
    const stateless = routeros.render(
        serving("platforms--example-router", "servers", { dns: ["2001:db8:20::54"] }, { other_config: true })
    );

    const plan = sent("routeros", stateless, full);
    expect(plan).toContain(`/ipv6 dhcp-server option set [ find name=servers-dns ] value="'2001:db8:20::54'"`);
    const server = plan.findIndex((line) => line.startsWith("/ipv6 dhcp-server set [ find name=servers ]"));
    expect(plan[server]).toContain("address-pool=static-only");
    expect(plan[server]).toContain("prefix-pool=static-only");
    expect(plan[server]).toContain("lease-time=3d");
    expect(plan.indexOf("/ipv6 pool remove [ find name=servers ]")).toBeGreaterThan(server);
});

test("RouterOS refuses a pool that is not one prefix, and names one that is", () => {
    const device = serving("platforms--example-router", "servers", { pool: ["2001:db8:20::1000", "2001:db8:20::2000"] });
    expect(Platforms.get("routeros").unsupported(device)).toContain(
        "services.dhcpv6_server.servers.pool, RouterOS gives addresses from one whole prefix: write the first and last address of one, such as 2001:db8:20::1000 and 2001:db8:20::1fff (2001:db8:20::1000/116)"
    );
});

test("RouterOS relays to IPv6 servers in its IPv6 menu, and to IPv4 ones in its IPv4 menu", () => {
    const device = structuredClone(Fixtures.device("platforms--example-router"));
    device.services!.dhcp_relay = { guests: { interface: "guests", servers: ["198.51.100.66", "2001:db8:20::547"] } };
    const desired = Platforms.get("routeros").render(device);

    expect(desired).toContain("/ip dhcp-relay\nadd dhcp-server=198.51.100.66 disabled=no interface=guests name=guests");
    expect(desired).toContain("/ipv6 dhcp-relay\nadd dhcp-server=2001:db8:20::547 interface=guests name=guests");

    // RouterOS added the IPv4 relay disabled, and its export printed no `disabled` (TRAPS.md).
    const added = desired.replace("add dhcp-server=198.51.100.66 disabled=no", "add dhcp-server=198.51.100.66");
    expect(sent("routeros", desired, added)).toEqual(["/ip dhcp-relay set [ find name=guests ] disabled=no"]);
});

test("Junos writes a group, an address pool, and a pool of delegated prefixes, and plans nothing against how the switch prints them", () => {
    const junos = Platforms.get("junos");
    const desired = junos.render(
        serving("platforms--example-aggregation-switch", "management", { ...FULL, pool: ["2001:db8::1000", "2001:db8::1fff"] })
    );
    const pool = "set access address-assignment pool management-v6 family inet6";
    const delegated = "set access address-assignment pool management-pd family inet6";
    const group = "set system services dhcp-local-server dhcpv6 group management";

    expect(desired).toContain(`${pool} range management low 2001:db8::1000/128`);
    expect(desired).toContain(`${delegated} range management-pd prefix-length 56`);
    expect(desired).toContain(`${group} overrides process-inform pool management-v6`);
    expect(desired).toContain("set protocols router-advertisement interface irb.10 managed-configuration");

    // The switch prints a pool's lease time before its DNS servers, and a group's overrides before its interface.
    const printed = [
        ...desired.split("\n").filter((line) => !line.startsWith(pool) && !line.startsWith(delegated) && !line.startsWith(group)),
        `${group} overrides process-inform pool management-v6`,
        `${group} overrides delegated-pool management-pd`,
        `${group} interface irb.10`,
        `${pool} prefix 2001:db8::/64`,
        `${pool} range management low 2001:db8::1000/128`,
        `${pool} range management high 2001:db8::1fff/128`,
        `${pool} dhcp-attributes maximum-lease-time 86400`,
        `${pool} dhcp-attributes dns-server 2001:db8:20::53`,
        `${pool} dhcp-attributes dns-server 2001:db8:20::54`,
        `${delegated} prefix 2001:db8:20:8000::/49`,
        `${delegated} range management-pd prefix-length 56`,
        `${delegated} dhcp-attributes maximum-lease-time 86400`,
        `${delegated} dhcp-attributes dns-server 2001:db8:20::53`,
        `${delegated} dhcp-attributes dns-server 2001:db8:20::54`,
    ].join("\n");
    expect(sent("junos", desired, printed)).toEqual([]);
});

test("Junos refuses a server that gives only DNS servers", () => {
    const device = serving("platforms--example-aggregation-switch", "management", { dns: ["2001:db8::53"] });
    expect(Platforms.get("junos").unsupported(device)).toContain(
        "services.dhcpv6_server.management without pool or prefix_delegation: Junos takes the DNS servers it gives from a pool's settings. Write pool or prefix_delegation, or announce the DNS servers in ipv6_ra.dns_servers"
    );
});

test("FortiOS widens the subnet to hold the delegated prefixes, and plans nothing against how the firewall prints the server", () => {
    const fortios = Platforms.get("fortios");
    const device = serving("platforms--example-firewall", "servers", { ...FULL, pool: ["2001:db8:40::1000", "2001:db8:40::1fff"] });
    const desired = fortios.render(device);

    expect(desired).toContain("set subnet 2001:db8::/41");
    expect(desired).toContain("set start-prefix 2001:db8:20:8000::\n                set end-prefix 2001:db8:20:ff00::");
    expect(desired).toContain("set ip6-manage-flag enable");
    expect(fortios.experimental?.(device)).toContain("services.dhcpv6_server.servers.prefix_delegation");

    // The firewall prints the ranges before the DNS servers.
    const server = /config system dhcp6 server\n[\s\S]*?\nend\n/.exec(desired)![0];
    const printed = desired.replace(
        server,
        [
            "config system dhcp6 server",
            "    edit 1",
            "        set lease-time 86400",
            "        set subnet 2001:db8::/41",
            '        set interface "servers"',
            "        config prefix-range",
            "            edit 1",
            "                set start-prefix 2001:db8:20:8000::",
            "                set end-prefix 2001:db8:20:ff00::",
            "                set prefix-length 56",
            "            next",
            "        end",
            "        config ip-range",
            "            edit 1",
            "                set start-ip 2001:db8:40::1000",
            "                set end-ip 2001:db8:40::1fff",
            "            next",
            "        end",
            "        set dns-server1 2001:db8:20::53",
            "        set dns-server2 2001:db8:20::54",
            "    next",
            "end",
            "",
        ].join("\n")
    );
    expect(sent("fortios", desired, printed)).toEqual([]);
});

test("FortiOS refuses a server without a pool", () => {
    const device = serving("platforms--example-firewall", "servers", { dns: ["2001:db8:40::53"] });
    expect(Platforms.get("fortios").unsupported(device)).toContain(
        "services.dhcpv6_server.servers without pool: FortiOS 6.2 has no setting that keeps a DHCPv6 server from giving addresses. Write pool, or announce the DNS servers in ipv6_ra.dns_servers"
    );
});

test("validate stops an IPv6 network in dhcp_server, a server that gives nothing, and pools that don't fit", () => {
    const device = serving("platforms--example-router", "servers", {
        pool: ["2001:db8:21::1000", "2001:db8:21::1fff"],
        prefix_delegation: { pool: "2001:db8:20:8000::/49", prefix_length: 48 },
    });
    device.services!.dhcpv6_server!.guests = { interface: "servers" };
    device.services!.dhcp_server!.servers = { ...device.services!.dhcp_server!.servers!, network: "2001:db8:20::/64" };

    expect(findings(device, "error")).toEqual(
        expect.arrayContaining([
            "services.dhcp_server.servers.network 2001:db8:20::/64 is IPv6, and DHCPv6 gives no gateway: write it in services.dhcpv6_server",
            "services.dhcpv6_server.guests and services.dhcpv6_server.servers both answer on servers: write one server for it",
            "services.dhcpv6_server.guests gives nothing: write pool, prefix_delegation, or dns",
            "services.dhcpv6_server.servers.pool 2001:db8:21::1000 to 2001:db8:21::1fff is in no IPv6 network of servers: write addresses from one of 2001:db8:20::/64",
            "services.dhcpv6_server.servers.prefix_delegation.prefix_length 48 is not a whole number from 50 to 128: each prefix delegated is a part of pool, a /49",
        ])
    );
});

test("validate warns of a server whose interface's router advertisements don't send hosts to it", () => {
    const silent = serving("platforms--example-router", "servers", FULL);
    delete silent.interfaces!.vlan_interface!.servers!.ipv6_ra;
    expect(findings(silent, "warning")).toContain(
        "services.dhcpv6_server.servers: interfaces.vlan_interface.servers sends no router advertisements, so hosts find no gateway and don't ask the server. Write ipv6_ra: { managed: true } on it"
    );

    expect(findings(serving("platforms--example-router", "servers", FULL, true), "warning")).toContain(
        "services.dhcpv6_server.servers gives addresses, but interfaces.vlan_interface.servers.ipv6_ra has no managed: true, so hosts don't ask for one. Write it there"
    );
    expect(findings(serving("platforms--example-router", "servers", { dns: ["2001:db8:20::53"] }, true), "warning")).toContain(
        "services.dhcpv6_server.servers gives DNS servers, but interfaces.vlan_interface.servers.ipv6_ra has no other_config: true, so hosts don't ask for them. Write it there"
    );
    expect(
        findings(serving("platforms--example-router", "servers", FULL), "warning").filter((message) => message.includes("dhcpv6"))
    ).toEqual([]);
});

/** The single-site VRP switch with a VLAN interface on VLAN 3981, which no port carries, and its DHCPv6 server `ctest_v6a`. */
function vrpServing(server: Omit<Dhcpv6Server, "interface">): Device {
    const device = structuredClone(Fixtures.device("single-site--switch"));
    device.switching!.vlans = { ...device.switching!.vlans, "ctest-a": { id: 3981 } };
    device.interfaces!.vlan_interface = {
        ...device.interfaces!.vlan_interface,
        "ctest-a": { vlan: "ctest-a", addresses: ["192.0.2.1/28", "2001:db8:3981::1/64"], ipv6_ra: { managed: true, other_config: true } },
    };
    device.services = { dhcpv6_server: { ctest_v6a: { interface: "ctest-a", ...server } } };
    return device;
}

const VRP_SERVER: Omit<Dhcpv6Server, "interface"> = {
    pool: ["2001:db8:3981::100", "2001:db8:3981::1ff"],
    dns: ["2001:db8:3981::53", "2001:db8:3981::54"],
    lease_time: 7200,
};

test("VRP writes the smallest prefix that holds the pool, binds it to the VLAN interface, and plans nothing against how a CE6855 printed it", () => {
    const vrp = Platforms.get("vrp");
    const device = vrpServing(VRP_SERVER);
    const desired = vrp.render(device);

    expect(vrp.unsupported(device)).toEqual([]);
    expect(desired).toContain(
        "dhcpv6 pool ctest_v6a\n address prefix 2001:DB8:3981::100/120 life-time 7200 7200\n dns-server 2001:DB8:3981::53\n dns-server 2001:DB8:3981::54\n#\n"
    );
    expect(desired).toContain("dhcpv6 enable\n");

    // The switch ends the last DNS server with a space, and the pool's line on the interface with two tabs (V200R005C00SPC800).
    const printed = desired
        .replace("dns-server 2001:DB8:3981::54\n", "dns-server 2001:DB8:3981::54 \n")
        .replace(" dhcpv6 server ctest_v6a\n", " dhcpv6 server ctest_v6a\t\t\n");
    expect(printed).not.toBe(desired);
    expect(sent("vrp", desired, printed)).toEqual([]);
});

test("VRP leaves out the addresses of the prefix outside the pool, and takes an old prefix away after them", () => {
    const vrp = Platforms.get("vrp");
    const wider = vrp.render(vrpServing({ ...VRP_SERVER, pool: ["2001:db8:3981::100", "2001:db8:3981::2ff"], lease_time: 3600 }));
    expect(wider).toContain(
        " address prefix 2001:DB8:3981::/118 life-time 3600 3600\n excluded-address 2001:DB8:3981:: to 2001:DB8:3981::FF\n excluded-address 2001:DB8:3981::300 to 2001:DB8:3981::3FF\n"
    );

    // A new prefix overlaps the old one, which the switch refuses, so the old one goes first, after what it excluded.
    const back = sent("vrp", vrp.render(vrpServing(VRP_SERVER)), wider);
    expect(back.slice(0, 6)).toEqual([
        "dhcpv6 pool ctest_v6a",
        "undo excluded-address 2001:DB8:3981::300 to 2001:DB8:3981::3FF",
        "undo excluded-address 2001:DB8:3981:: to 2001:DB8:3981::FF",
        "undo address prefix 2001:DB8:3981::/118",
        "address prefix 2001:DB8:3981::100/120 life-time 7200 7200",
        "quit",
    ]);

    // A pool goes once its VLAN interface lets go of it.
    const gone = vrp.plan(vrp.render(Fixtures.device("single-site--switch")), wider, options).steps;
    expect(gone.at(-1)).toEqual({
        title: "DHCPv6 pools no longer used",
        show: ["- dhcpv6 pool ctest_v6a"],
        send: ["undo dhcpv6 pool ctest_v6a"],
    });
});

test("VRP refuses delegated prefixes, a pool name the switch refuses, and a pool that leaves out more than 1024 addresses", () => {
    const device = vrpServing({
        ...VRP_SERVER,
        pool: ["2001:db8:3981::401", "2001:db8:3981::bff"],
        prefix_delegation: FULL.prefix_delegation,
    });
    device.services!.dhcpv6_server = { "ctest-v6a": device.services!.dhcpv6_server!.ctest_v6a! };
    const where = "services.dhcpv6_server.ctest-v6a";

    expect(Platforms.get("vrp").unsupported(device)).toEqual(
        expect.arrayContaining([
            `${where}, a pool name of letters, digits, and '_', 31 characters at most: the switch refuses a '-'`,
            `${where}.prefix_delegation, V200R005 delegates no prefixes`,
            `${where}.pool, which leaves 2049 addresses of 2001:DB8:3981::/116 out: the switch gives the addresses of one prefix, and leaves 1024 out at most. Write a pool that fills a prefix, or nearly`,
        ])
    );
});
