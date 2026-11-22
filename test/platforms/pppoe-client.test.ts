// PPPoE clients toward a provider (RFC 2516), and IPv6 prefixes delegated over PPP (RFC 8415). The exports here copy how a CHR on 7.24.6 printed them, in test/platforms/routeros-chr-pppoe.test.ts.

import { expect, test } from "bun:test";
import { Checks } from "../../src/checks";
import type { Prefix } from "../../src/config/common";
import type { Device, PppoeClient, PppoeServer } from "../../src/model";
import { Platforms } from "../../src/platforms";
import { Fixtures } from "../fixtures";

const options = { secrets: false, rollback: 10 };

/** A session over the routed port 1g-1, which gives a /64 of its prefix to two VLAN interfaces: `servers` sends router advertisements, `guests` doesn't. */
const ISP: PppoeClient = {
    interface: "1g-1",
    description: "Hurricane Electric",
    user: "branch-1",
    password: { secret: "ISP_PASSWORD" },
    service_name: "as6939",
    mtu: 1492,
    prefix_delegation: { interfaces: { servers: "::1", guests: "::1" } },
};

const OLT: PppoeServer = {
    interfaces: ["servers"],
    local_address: "100.64.0.1",
    pool: ["100.64.0.2", "100.64.63.254"],
    mtu: 1492,
    radius: [{ address: "192.0.2.10", secret_key: { secret: "RADIUS" } }],
    prefix_delegation: { pool: "2001:db8:100:8000::/49", prefix_length: 56 },
};

/** The example router with these PPPoE clients and servers. */
function withPppoe(clients: Record<string, PppoeClient>, servers: Record<string, PppoeServer> = {}): Device {
    const device = structuredClone(Fixtures.device("platforms--example-router"));
    device.interfaces = { ...device.interfaces, pppoe_client: clients };
    device.services = { ...device.services, pppoe_server: servers };
    return device;
}

const routeros = Platforms.get("routeros");

const sent = (desired: string, current: string) => routeros.plan(desired, current, options).steps.flatMap((step) => step.send);

const errors = (device: Device) =>
    Checks.run([device], undefined)
        .filter((finding) => finding.level === "error")
        .map((finding) => finding.message);

test("RouterOS writes an enabled client that takes no DNS servers and adds no route, and a DHCPv6 client that asks for a prefix", () => {
    const desired = routeros.render(withPppoe({ internet: ISP }));

    expect(desired).toContain(
        '/interface pppoe-client\nadd comment="Hurricane Electric" disabled=no interface=ether1 max-mru=1492 max-mtu=1492 name=internet password="<secret:ISP_PASSWORD>" service-name=as6939 user=branch-1'
    );
    expect(desired).toContain("/ipv6 dhcp-client\nadd interface=internet pool-name=internet request=prefix use-peer-dns=no");
    expect(desired).toContain("add address=::1 advertise=yes from-pool=internet interface=servers");
    expect(desired).toContain("add address=::1 advertise=no from-pool=internet interface=guests");
    expect(sent(desired, desired)).toEqual([]);
});

test("RouterOS finds nothing to change before or after the session holds its prefix, whichever /64 each interface took", () => {
    const desired = routeros.render(withPppoe({ internet: ISP }));
    const servers = "add address=::1 advertise=yes from-pool=internet interface=servers";
    const guests = "add address=::1 advertise=no from-pool=internet interface=guests";

    // While the session is down, the CHR printed an address as it was sent, after the pool's error.
    const down = desired
        .replace(servers, "# address pool error: pool not found: internet (4)\nadd address=::1/64 from-pool=internet interface=servers")
        .replace(
            guests,
            "# address pool error: pool not found: internet (4)\nadd address=::1/64 advertise=no from-pool=internet interface=guests"
        );
    // Once it was up, the part after the delegated prefix: `guests` took the second /64.
    const up = desired
        .replace(servers, "add address=::1 from-pool=internet interface=servers")
        .replace(guests, "add address=0:0:0:1::1 advertise=no from-pool=internet interface=guests");

    for (const printed of [down, up]) {
        expect(printed).not.toBe(desired);
        expect(sent(desired, printed)).toEqual([]);
    }
    expect(sent(desired, up.replace("0:0:0:1::1", "0:0:0:1::2"))).toEqual([
        "/ipv6 address set [ find from-pool=internet and interface=guests and !dynamic ] address=::1",
    ]);
});

test("RouterOS asks for a prefix length with a hint, and takes the hint back once the config has none", () => {
    const hinted = withPppoe({ internet: { ...ISP, prefix_delegation: { ...ISP.prefix_delegation!, prefix_length: 56 } } });
    const desired = routeros.render(hinted);

    expect(desired).toContain(
        "/ipv6 dhcp-client\nadd interface=internet pool-name=internet prefix-hint=::/56 request=prefix use-peer-dns=no"
    );
    expect(sent(desired, desired)).toEqual([]);
    expect(sent(routeros.render(withPppoe({ internet: ISP })), desired)).toEqual([
        "/ipv6 dhcp-client set [ find interface=internet ] prefix-hint=::/0",
    ]);
});

test("RouterOS asks for a whole prefix with a hint, as RFC 5952 writes it, and changes the hint in place", () => {
    const asking = (prefix: Prefix) => withPppoe({ internet: { ...ISP, prefix_delegation: { ...ISP.prefix_delegation!, prefix } } });
    const desired = routeros.render(asking("2001:DB8:100:A500:0::/56"));

    expect(desired).toContain(
        "/ipv6 dhcp-client\nadd interface=internet pool-name=internet prefix-hint=2001:db8:100:a500::/56 request=prefix use-peer-dns=no"
    );
    expect(sent(desired, desired)).toEqual([]);
    expect(sent(routeros.render(asking("2001:db8:100:b600::/56")), desired)).toEqual([
        "/ipv6 dhcp-client set [ find interface=internet ] prefix-hint=2001:db8:100:b600::/56",
    ]);
    expect(sent(routeros.render(withPppoe({ internet: ISP })), desired)).toEqual([
        "/ipv6 dhcp-client set [ find interface=internet ] prefix-hint=::/0",
    ]);
});

test("RouterOS adds the client before what names it, and removes it after", () => {
    const device = withPppoe({ internet: ISP });
    device.routing = { ...device.routing, static_routes: [{ prefix: "::/0", interface: "internet" }] };
    const added = sent(routeros.render(device), routeros.render(withPppoe({})));
    const removed = sent(routeros.render(withPppoe({})), routeros.render(device));
    const at = (plan: string[], start: string) => plan.findIndex((line) => line.startsWith(start));

    for (const named of ["/ipv6 dhcp-client", "/ipv6 address", "/ipv6 route"]) {
        expect(at(added, "/interface pppoe-client add"), named).toBeLessThan(at(added, `${named} add`));
        expect(at(removed, "/interface pppoe-client remove"), named).toBeGreaterThan(at(removed, `${named} remove`));
    }
});

test("RouterOS puts a client with a VRF in that VRF, with the routes through it, and takes it out once the config drops it", () => {
    const { prefix_delegation: _delegation, ...client } = ISP;
    const inVrf = (vrf: string | undefined) => {
        const device = withPppoe({ internet: { ...client, vrf } });
        device.routing = { ...device.routing, static_routes: [{ prefix: "0.0.0.0/0", interface: "internet", vrf }] };
        return routeros.render(device);
    };
    const desired = inVrf("guests");

    expect(desired).toContain('add comment="Kept apart from everything else" interfaces="guests,internet" name=guests');
    // A gateway without its VRF stays inactive (CHR, 7.24.6).
    expect(desired).toContain("add dst-address=0.0.0.0/0 gateway=internet@guests routing-table=guests");
    expect(sent(desired, desired)).toEqual([]);

    const plan = sent(inVrf(undefined), desired);
    expect(plan).toContain("/ip vrf set [ find name=guests ] interfaces=guests");
    expect(plan).toContain("/ip route add dst-address=0.0.0.0/0 gateway=internet");
});

test("RouterOS refuses a VRF with no interface, which it can't hold", () => {
    const device = withPppoe({});
    device.routing = { ...device.routing, vrfs: { ...device.routing?.vrfs, wan: { description: "The provider's internet" } } };
    expect(routeros.unsupported(device)).toContain(
        "routing.vrfs.wan, a VRF with no interface: RouterOS needs one in each. Give it its interfaces with vrf, or leave the VRF out"
    );
});

test("validate wants a route through a client in the client's VRF", () => {
    const device = withPppoe({ internet: { ...ISP, vrf: "guests" }, backup: { ...ISP, interface: "25g-3" } });
    device.routing = {
        ...device.routing,
        static_routes: [
            { prefix: "0.0.0.0/0", interface: "internet" },
            { prefix: "::/0", interface: "backup", vrf: "guests" },
        ],
    };

    expect(errors(device).filter((message) => message.startsWith("routing.static_routes"))).toEqual([
        'routing.static_routes 0.0.0.0/0 leaves through interfaces.pppoe_client.internet, which routes in VRF guests: write vrf: "guests" on the route',
        'routing.static_routes ::/0 is in VRF guests, but interfaces.pppoe_client.backup routes in the main table: write vrf: "guests" on the client, or take vrf off the route',
    ]);
});

test("RouterOS delegates a PPPoE server's prefixes from a pool its profile names, and clears one set by hand", () => {
    const desired = routeros.render(withPppoe({}, { "olt-1": OLT }));

    expect(desired).toContain("add name=olt-1-pd prefix=2001:db8:100:8000::/49 prefix-length=56");
    expect(desired).toContain("add dhcpv6-pd-pool=olt-1-pd local-address=100.64.0.1 name=olt-1 remote-address=olt-1");

    const plan = sent(desired, routeros.render(withPppoe({})));
    const at = (start: string) => plan.findIndex((line) => line.startsWith(start));
    expect(at("/ipv6 pool add name=olt-1-pd")).toBeLessThan(at("/ppp profile add"));

    const stray = `${desired}/ppp profile\nset *0 dhcpv6-pd-pool=olt-1-pd remote-ipv6-prefix-pool=olt-1-pd\n`;
    expect(sent(desired, stray)).toEqual(['/ppp profile set *0 dhcpv6-pd-pool="" remote-ipv6-prefix-pool=""']);
});

test("RouterOS gives each session a /64 from a pool its profile names, announced by the default ND entry, which stays on", () => {
    const slaac: PppoeServer = { ...OLT, slaac: { pool: "2001:db8:100:1000::/52" } };
    const desired = routeros.render(withPppoe({}, { "olt-1": slaac }));

    expect(desired).toContain("add name=olt-1-slaac prefix=2001:db8:100:1000::/52 prefix-length=64");
    expect(desired).toContain("local-address=100.64.0.1 name=olt-1 remote-address=olt-1 remote-ipv6-prefix-pool=olt-1-slaac");
    expect(sent(desired, desired)).toEqual([]);
    // The example router's `servers` sends router advertisements of its own, which turns the default entry off without a PPPoE server.
    expect(desired).not.toContain("set [ find default=yes ] disabled=yes");
    expect(routeros.render(withPppoe({}))).toContain("set [ find default=yes ] disabled=yes");

    const dropped = sent(routeros.render(withPppoe({}, { "olt-1": OLT })), desired);
    expect(dropped).toContain('/ppp profile set [ find name=olt-1 ] remote-ipv6-prefix-pool=""');
    expect(dropped).toContain("/ipv6 pool remove [ find name=olt-1-slaac ]");
});

test("RouterOS has a client take router advertisements on the session alone, and sets that back once the config drops it", () => {
    const desired = routeros.render(withPppoe({ internet: { ...ISP, slaac: true } }));

    expect(desired).toContain("add name=slaac");
    expect(desired).toContain("add interface=internet list=slaac");
    expect(desired).toContain("/ipv6 settings\nset accept-router-advertisements=yes accept-router-advertisements-on=slaac");
    expect(sent(desired, desired)).toEqual([]);

    // The export says the change waits for a restart, though a session takes it when it next comes up (CHR, 7.24.6).
    const printed = desired.replace(
        "/ipv6 settings\n",
        "/ipv6 settings\n# ipv6 *accept router advertisements* configuration has changed, please restart device to apply settings\n"
    );
    expect(sent(desired, printed)).toEqual([]);

    const dropped = sent(routeros.render(withPppoe({ internet: ISP })), desired);
    expect(dropped).toContain(
        "/ipv6 settings set accept-router-advertisements=yes-if-forwarding-disabled accept-router-advertisements-on=all"
    );
    expect(dropped).toContain("/interface list remove [ find name=slaac ]");
});

test("RouterOS refuses a client named as an IPv6 pool it writes", () => {
    const device = withPppoe({ "olt-1-pd": { ...ISP, interface: "1g-1" } }, { "olt-1": OLT });
    expect(routeros.unsupported(device)).toContain(
        "interfaces.pppoe_client.olt-1-pd, the name of an IPv6 pool of services.pppoe_server.olt-1: RouterOS keeps the delegated prefix in a pool named after the client. Give it another name"
    );
});

test("the other platforms but FortiOS refuse a PPPoE client, each with its reason", () => {
    for (const platform of ["junos", "vrp", "raisecom-ros"]) {
        const [fixture] = Fixtures.ofPlatform(platform);
        const device = structuredClone(Fixtures.device(fixture ?? ""));
        const port = Object.keys(device.interfaces?.ethernet ?? {})[0]!;
        const { prefix_delegation: _delegation, ...client } = ISP;
        device.interfaces = { ...device.interfaces, pppoe_client: { internet: { ...client, interface: port } } };

        const refused = Platforms.get(platform)
            .unsupported(device)
            .filter((path) => path.startsWith("interfaces.pppoe_client.internet"));
        expect(refused[0], platform).toMatch(/^interfaces\.pppoe_client\.internet, a PPPoE client.+/);
    }
});

test("validate checks the login, the port the session runs over, the MTU, and where the prefix goes", () => {
    const device = withPppoe({
        internet: {
            ...ISP,
            user: " ",
            interface: "25g-1",
            mtu: 1500,
            prefix_delegation: { interfaces: { internet: "::1", "25g-1": "::1" } },
        },
        backup: { ...ISP, interface: "25g-3", prefix_delegation: { interfaces: { servers: "2001:db8::1", guests: "::" } } },
        fiber: { ...ISP, interface: "uplink", prefix_delegation: { interfaces: { servers: "::1", "25g-4": "::1", "25g-2": "::1" } } },
    });

    expect(errors(device).filter((message) => message.startsWith("interfaces.pppoe_client"))).toEqual([
        "interfaces.pppoe_client.internet.user is empty: write the name the provider gave you",
        "interfaces.pppoe_client.internet.interface 25g-1 is in LAG uplink: write the LAG instead",
        "interfaces.pppoe_client.internet.mtu 1500 is not a whole number from 576 to 1492, the most RFC 2516 allows",
        "interfaces.pppoe_client.internet.prefix_delegation.interfaces.internet is the session's own way to the provider: give the prefix to an interface toward your hosts",
        "interfaces.pppoe_client.internet.prefix_delegation.interfaces.25g-1 is the session's own way to the provider: give the prefix to an interface toward your hosts",
        "interfaces.pppoe_client.backup.interface 25g-3 is switched: run the client on a routed port, or on a VLAN interface of the VLAN that reaches the provider",
        "interfaces.pppoe_client.backup.prefix_delegation.interfaces.servers: '2001:db8::1' is not the last 64 bits of an address, such as ::1. The first 64 bits come from the prefix",
        "interfaces.pppoe_client.backup.prefix_delegation.interfaces.guests routes in guests, but the session in the main table, where the prefix's route is: put both in one VRF",
        "interfaces.pppoe_client.backup.prefix_delegation.interfaces.guests: '::' is not the last 64 bits of an address, such as ::1. The first 64 bits come from the prefix",
        "interfaces.pppoe_client.fiber.prefix_delegation.interfaces.servers also takes a prefix from interfaces.pppoe_client.backup: give it one of them",
        "interfaces.pppoe_client.fiber.prefix_delegation.interfaces.25g-4 is switched, so it holds no address: give the prefix to the VLAN interface of its VLAN",
        "interfaces.pppoe_client.fiber.prefix_delegation.interfaces.25g-2 is in LAG uplink: give the prefix to the LAG",
    ]);
});

test("validate wants a prefix hint that holds a /64 for each interface listed", () => {
    const hint = (prefix_length: number) => ({ ...ISP, prefix_delegation: { ...ISP.prefix_delegation!, prefix_length } });
    const device = withPppoe({
        internet: hint(64),
        backup: { ...hint(0), interface: "25g-2" },
        fiber: { ...hint(63), interface: "25g-3" },
    });

    expect(errors(device).filter((message) => message.includes("prefix_length"))).toEqual([
        "interfaces.pppoe_client.internet.prefix_delegation.prefix_length 64 is not a whole number from 1 to 63, the longest prefix that holds a /64 for each interface listed",
        "interfaces.pppoe_client.backup.prefix_delegation.prefix_length 0 is not a whole number from 1 to 63, the longest prefix that holds a /64 for each interface listed",
    ]);
});

test("validate wants a whole prefix hint alone, an IPv6 prefix without bits past its length, that holds a /64 for each interface listed", () => {
    const asking = (prefix_delegation: Partial<NonNullable<PppoeClient["prefix_delegation"]>>, port: string) => ({
        ...ISP,
        interface: port,
        prefix_delegation: { ...ISP.prefix_delegation!, ...prefix_delegation },
    });
    const device = withPppoe({
        internet: asking({ prefix: "2001:db8:100:a500::/56" }, "1g-1"),
        both: asking({ prefix: "2001:db8:100:a500::/56", prefix_length: 56 }, "25g-2"),
        legacy: asking({ prefix: "100.64.0.0/10" }, "25g-3"),
        bits: asking({ prefix: "2001:db8:100:a501::/56" }, "25g-4"),
        long: asking({ prefix: "2001:db8:100:a500::/64" }, "uplink"),
    });

    expect(errors(device).filter((message) => message.includes(".prefix_delegation") && !message.includes(".interfaces."))).toEqual([
        "interfaces.pppoe_client.both.prefix_delegation has both prefix and prefix_length: write prefix alone, which holds its length",
        "interfaces.pppoe_client.legacy.prefix_delegation.prefix '100.64.0.0/10' is not an IPv6 prefix with its length, such as 2001:db8:100:a500::/56",
        "interfaces.pppoe_client.bits.prefix_delegation.prefix 2001:db8:100:a501::/56 has bits past its length: write 2001:db8:100:a500::/56",
        "interfaces.pppoe_client.long.prefix_delegation.prefix 2001:db8:100:a500::/64 is a /64: ask for a /1 to a /63, the longest prefix that holds a /64 for each interface listed",
    ]);
});

test("validate checks a PPPoE server's delegated prefixes as a DHCPv6 server's", () => {
    const device = withPppoe({}, { "olt-1": { ...OLT, prefix_delegation: { pool: "2001:db8:100:8000::/49", prefix_length: 48 } } });
    expect(errors(device)).toContain(
        "services.pppoe_server.olt-1.prefix_delegation.prefix_length 48 is not a whole number from 50 to 128: each prefix delegated is a part of pool, a /49"
    );
});

test("validate wants the sessions' /64s from an IPv6 prefix shorter than a /64, apart from the delegated prefixes", () => {
    const device = withPppoe(
        {},
        {
            "olt-1": { ...OLT, slaac: { pool: "2001:db8:100:8000::/52" } },
            "olt-2": { ...OLT, interfaces: ["guests"], slaac: { pool: "2001:db8:100:1001::/64" } },
            "olt-3": { ...OLT, interfaces: ["25g-3"], slaac: { pool: "100.64.0.0/10" } },
        }
    );
    expect(errors(device).filter((message) => message.includes(".slaac."))).toEqual([
        "services.pppoe_server.olt-1.slaac.pool 2001:db8:100:8000::/52 overlaps prefix_delegation.pool 2001:db8:100:8000::/49: give each its own prefix",
        "services.pppoe_server.olt-2.slaac.pool 2001:db8:100:1001::/64 holds no more than one /64: write a shorter prefix, which holds a /64 for each session",
        "services.pppoe_server.olt-3.slaac.pool '100.64.0.0/10' is not an IPv6 prefix, such as 2001:db8:100:1000::/52",
    ]);
});
