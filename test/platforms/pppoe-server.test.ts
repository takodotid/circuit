// PPPoE servers for subscribers (RFC 2516), checked by RADIUS. The exports here copy how a CHR on 7.24.6 printed them, in test/platforms/routeros-chr-pppoe.test.ts.

import { expect, test } from "bun:test";
import { Checks } from "../../src/checks";
import type { Device, PppoeServer } from "../../src/model";
import { Platforms } from "../../src/platforms";
import { Fixtures } from "../fixtures";

const options = { secrets: false, rollback: 10 };

const OLT: PppoeServer = {
    interfaces: ["servers"],
    service_name: "as64500",
    local_address: "100.64.0.1",
    pool: ["100.64.0.2", "100.64.63.254"],
    dns: ["192.0.2.53", "192.0.2.54"],
    mtu: 1492,
    radius: [{ address: "192.0.2.10", secret_key: { secret: "RADIUS" } }],
    acct_interim_interval: 300,
    dynamic_authorization: true,
};

/** The example router with these PPPoE servers. */
function serving(servers: Record<string, PppoeServer>): Device {
    const device = structuredClone(Fixtures.device("platforms--example-router"));
    device.services = { ...device.services, pppoe_server: servers };
    return device;
}

const sent = (desired: string, current: string) =>
    Platforms.get("routeros")
        .plan(desired, current, options)
        .steps.flatMap((step) => step.send);

const findings = (device: Device, level: "error" | "warning") =>
    Checks.run([device], undefined)
        .filter((finding) => finding.level === level && finding.message.startsWith("services.pppoe_server"))
        .map((finding) => finding.message);

test("RouterOS writes a pool, a profile, and an enabled server for each interface, then RADIUS for PPP", () => {
    const desired = Platforms.get("routeros").render(serving({ "olt-1": OLT }));

    expect(desired).toContain("add name=olt-1 ranges=100.64.0.2-100.64.63.254");
    expect(desired).toContain(
        '/ppp profile\nadd dns-server="192.0.2.53,192.0.2.54" local-address=100.64.0.1 name=olt-1 remote-address=olt-1'
    );
    expect(desired).toContain(
        "/interface pppoe-server server\nadd default-profile=olt-1 disabled=no interface=servers max-mru=1492 max-mtu=1492 service-name=as64500"
    );
    expect(desired).toContain('add address=192.0.2.10 secret="<secret:RADIUS>" service=ppp');
    expect(desired).toContain("/ppp aaa\nset interim-update=5m use-radius=yes");
    expect(desired).toContain("/radius incoming\nset accept=yes");
    expect(sent(desired, desired)).toEqual([]);
});

test("RouterOS adds the pool before the profile, and the profile before the server", () => {
    const routeros = Platforms.get("routeros");
    const plan = sent(routeros.render(serving({ "olt-1": OLT })), routeros.render(serving({})));
    const at = (start: string) => plan.findIndex((line) => line.startsWith(start));

    expect(at("/ip pool add name=olt-1")).toBeLessThan(at("/ppp profile add"));
    expect(at("/ppp profile add")).toBeLessThan(at("/interface pppoe-server server add"));
});

test("RouterOS makes a set the sessions join an interface list, which the profile and the firewall name", () => {
    const routeros = Platforms.get("routeros");
    const joining = (set: string | undefined) => {
        const device = serving({ "olt-1": { ...OLT, interface_set: set } });
        device.firewall = {
            ...(set ? { interface_sets: { [set]: ["guests"] } } : {}),
            filter: { input: { rules: [{ if: { family: "ipv4", in_interface_set: set, protocol: "icmp" }, then: "drop" }] } },
        };
        return routeros.render(device);
    };
    const desired = joining("subscribers");

    expect(desired).toContain("add name=subscribers\n/interface list member");
    expect(desired).toContain("add interface=guests list=subscribers");
    expect(desired).toContain("interface-list=subscribers local-address=100.64.0.1 name=olt-1");
    expect(desired).toContain("add action=drop chain=input in-interface-list=subscribers protocol=icmp");
    expect(sent(desired, desired)).toEqual([]);

    // The list exists before the profile points to it, and its member comes after the interface it holds.
    const added = sent(desired, routeros.render(serving({})));
    const at = (start: string) => added.findIndex((line) => line.startsWith(start));
    expect(at("/interface list add")).toBeLessThan(at("/ppp profile add"));
    expect(at("/interface list member add")).toBeGreaterThan(at("/interface vlan"));

    const removed = sent(joining(undefined), desired);
    expect(removed).toContain("/ppp profile unset [ find name=olt-1 ] interface-list");
    const after = (start: string) => removed.findIndex((line) => line.startsWith(start));
    expect(after("/interface list remove")).toBeGreaterThan(after("/ppp profile unset"));
});

test("RouterOS removes what the config doesn't hold: local secrets, profiles, servers, and a subscriber's static interface", () => {
    const routeros = Platforms.get("routeros");
    const desired = routeros.render(serving({ "olt-1": OLT }));
    const current = `${desired}/interface pppoe-server
add name=pppoe-static service=as64500 user=stray
/ppp profile
set *0 local-address=10.9.9.9 only-one=yes rate-limit=10M/10M
add name=stray-profile
set *FFFFFFFE only-one=yes
/interface pppoe-server server
add interface=ether3 service-name=stray
/ppp secret
add name=stray service=pppoe
`;
    const plan = sent(desired, current);

    expect(plan).toContain("/ppp profile unset *0 local-address");
    expect(plan).toContain("/ppp profile unset *0 rate-limit");
    expect(plan).toContain("/ppp profile set *0 only-one=default");
    expect(plan.indexOf("/ppp profile set *0 only-one=default")).toBeGreaterThan(plan.indexOf("/ppp profile unset *0 rate-limit"));
    expect(plan).toContain("/ppp profile set *FFFFFFFE only-one=default");
    const removed = [
        "/interface pppoe-server remove [ find name=pppoe-static ]",
        "/interface pppoe-server server remove [ find interface=ether3 and service-name=stray ]",
        "/ppp secret remove [ find name=stray ]",
        "/ppp profile remove [ find name=stray-profile ]",
    ];
    expect(removed.map((line) => plan.indexOf(line))).toEqual([...removed.map((line) => plan.indexOf(line))].sort((a, b) => a - b));
    expect(removed.every((line) => plan.includes(line))).toBe(true);
    expect(plan.filter((line) => line.includes("olt-1"))).toEqual([]);
});

test("RouterOS sets a server's MTU back to auto once the config has none", () => {
    const routeros = Platforms.get("routeros");
    const { mtu: _mtu, ...withoutMtu } = OLT;
    const plan = sent(routeros.render(serving({ "olt-1": withoutMtu })), routeros.render(serving({ "olt-1": OLT })));

    expect(plan).toContain(
        "/interface pppoe-server server set [ find interface=servers and service-name=as64500 ] max-mru=auto max-mtu=auto"
    );
});

test("RouterOS sets back the router-wide PPP settings once no server needs them", () => {
    const routeros = Platforms.get("routeros");
    const plan = sent(routeros.render(serving({})), routeros.render(serving({ "olt-1": OLT })));

    expect(plan).toContain("/ppp aaa set interim-update=0s use-radius=no");
    expect(plan).toContain("/radius incoming set accept=no");
    expect(plan.indexOf("/ip pool remove [ find name=olt-1 ]")).toBe(plan.length - 1);
});

test("RouterOS takes RADIUS requests in the VRF its servers are reached through", () => {
    const radius = [{ address: "192.0.2.10" as const, secret_key: { secret: "RADIUS" }, vrf: "guests" }];
    const desired = Platforms.get("routeros").render(serving({ "olt-1": { ...OLT, radius } }));

    expect(desired).toContain('add address=192.0.2.10@guests secret="<secret:RADIUS>" service=ppp');
    expect(desired).toContain("/radius incoming\nset accept=yes vrf=guests");
});

test("RouterOS refuses servers that differ in what the router has one setting for, and names it shares with others", () => {
    const device = serving({
        "olt-1": OLT,
        "olt-2": { ...OLT, interfaces: ["guests"], acct_interim_interval: 600 },
        servers: { ...OLT, interfaces: ["management"] },
        default: { ...OLT, interfaces: ["management"], service_name: "other" },
    });
    const refused = Platforms.get("routeros").unsupported(device);

    expect(refused).toContain(
        "services.pppoe_server.olt-2, RouterOS has one RADIUS setting for all its PPPoE servers: write the radius, acct_interim_interval, and dynamic_authorization of services.pppoe_server.olt-1"
    );
    expect(refused).toContain(
        "services.pppoe_server.servers, named as services.dhcp_server.servers: RouterOS names the address pool of each after it. Give each its own name"
    );
    expect(refused).toContain("services.pppoe_server.default, the name of a PPP profile RouterOS has itself: give it another name");
});

test("RouterOS refuses dynamic authorization from RADIUS servers in different VRFs", () => {
    const radius = [
        { address: "192.0.2.10" as const, secret_key: { secret: "RADIUS" } },
        { address: "192.0.2.11" as const, secret_key: { secret: "RADIUS" }, vrf: "guests" },
    ];
    expect(Platforms.get("routeros").unsupported(serving({ "olt-1": { ...OLT, radius } }))).toContain(
        "services.pppoe_server.olt-1.dynamic_authorization, with RADIUS servers in different VRFs: RouterOS takes their requests in one VRF"
    );
});

test("the other platforms refuse a PPPoE server, each with its reason", () => {
    for (const platform of ["junos", "vrp", "fortios", "raisecom-ros"]) {
        const [fixture] = Fixtures.ofPlatform(platform);
        const device = structuredClone(Fixtures.device(fixture ?? ""));
        const port = Object.keys(device.interfaces?.ethernet ?? {})[0]!;
        device.services = { ...device.services, pppoe_server: { "olt-1": { ...OLT, interfaces: [port] } } };

        const refused = Platforms.get(platform)
            .unsupported(device)
            .filter((path) => path.startsWith("services.pppoe_server"));
        expect(refused.length, platform).toBe(1);
        expect(refused[0], platform).toMatch(/^services\.pppoe_server, .+/);
    }
});

test("validate checks the addresses, the sizes, and that each interface answers once for a service name", () => {
    const device = serving({
        "olt-1": { ...OLT, local_address: "100.64.0.9", mtu: 1500, acct_interim_interval: 30 },
        "olt-2": { ...OLT, pool: ["100.64.1.9", "100.64.1.2"], dns: ["2001:db8::53" as never], radius: [] },
    });

    expect(findings(device, "error")).toEqual([
        "services.pppoe_server.olt-1.local_address 100.64.0.9 is in pool: write a pool without it",
        "services.pppoe_server.olt-1.mtu 1500 is not a whole number from 576 to 1492, the most RFC 2516 allows",
        "services.pppoe_server.olt-1.acct_interim_interval 30 is not a whole number of seconds from 60, the least RFC 2869 allows",
        "services.pppoe_server.olt-2 and services.pppoe_server.olt-1 both answer on servers: give each its own service_name",
        "services.pppoe_server.olt-2.dns: '2001:db8::53' is not an IPv4 address, such as 192.0.2.1",
        "services.pppoe_server.olt-2.pool starts at 100.64.1.9, after its last address 100.64.1.2",
        "services.pppoe_server.olt-2.radius is empty: write the RADIUS servers that check subscribers",
    ]);
});

test("validate warns of a server without mtu", () => {
    const { mtu: _mtu, ...withoutMtu } = OLT;
    expect(findings(serving({ "olt-1": withoutMtu }), "warning")).toContain(
        "services.pppoe_server.olt-1 has no mtu, so the platform picks one, which may be below the 1492 RFC 2516 allows. Write mtu: 1492"
    );
});
