// PPPoE clients toward a provider (RFC 2516), and IPv6 prefixes delegated over PPP (RFC 8415). The exports here copy how a CHR on 7.24.6 printed them, in test/platforms/routeros-chr-pppoe.test.ts.

import { expect, test } from "bun:test";
import { Checks } from "../../src/checks";
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

test("RouterOS refuses a client named as an IPv6 pool it writes", () => {
    const device = withPppoe({ "olt-1-pd": { ...ISP, interface: "1g-1" } }, { "olt-1": OLT });
    expect(routeros.unsupported(device)).toContain(
        "interfaces.pppoe_client.olt-1-pd, the name of an IPv6 pool of services.pppoe_server.olt-1: RouterOS keeps the delegated prefix in a pool named after the client. Give it another name"
    );
});

test("the other platforms refuse a PPPoE client, each with its reason", () => {
    for (const platform of ["junos", "vrp", "fortios", "raisecom-ros"]) {
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
        "interfaces.pppoe_client.backup.prefix_delegation.interfaces.guests: '::' is not the last 64 bits of an address, such as ::1. The first 64 bits come from the prefix",
        "interfaces.pppoe_client.fiber.prefix_delegation.interfaces.servers also takes a prefix from interfaces.pppoe_client.backup: give it one of them",
        "interfaces.pppoe_client.fiber.prefix_delegation.interfaces.25g-4 is switched, so it holds no address: give the prefix to the VLAN interface of its VLAN",
        "interfaces.pppoe_client.fiber.prefix_delegation.interfaces.25g-2 is in LAG uplink: give the prefix to the LAG",
    ]);
});

test("validate checks a PPPoE server's delegated prefixes as a DHCPv6 server's", () => {
    const device = withPppoe({}, { "olt-1": { ...OLT, prefix_delegation: { pool: "2001:db8:100:8000::/49", prefix_length: 48 } } });
    expect(errors(device)).toContain(
        "services.pppoe_server.olt-1.prefix_delegation.prefix_length 48 is not a whole number from 50 to 128: each prefix delegated is a part of pool, a /49"
    );
});
