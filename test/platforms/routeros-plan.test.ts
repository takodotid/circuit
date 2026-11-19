import { expect, test } from "bun:test";
import { Checks } from "../../src/checks";
import { Platforms } from "../../src/platforms";
import type { Device, StaticRoute } from "../../src/model";
import { Fixtures } from "../fixtures";

const router = Fixtures.device("platforms--example-router");

test("a property whose value is a secret, such as a community's name, is left as the device holds it", () => {
    const desired = '/snmp community\nset [ find default=yes ] addresses=192.0.2.0/24 name="<secret:SNMP_COMMUNITY>"\n';
    const current = "/snmp community\nset [ find default=yes ] addresses=192.0.2.0/24 name=sesame-snmp\n";

    expect(Platforms.get("routeros").plan(desired, current, { secrets: false, rollback: 10 }).steps).toEqual([]);
    expect(
        Platforms.get("routeros")
            .plan(desired, current, { secrets: true, rollback: 10 })
            .steps.flatMap((step) => step.send)
    ).toEqual(['/snmp community set [ find default=yes ] name="<secret:SNMP_COMMUNITY>"']);
});

test("untracked prefixes skip connection tracking both ways, in their own family", async () => {
    const rendered = Platforms.get("routeros").render({
        ...router,
        firewall: { ...router.firewall, untracked: ["198.51.100.64/27", "2001:db8:100::/48"] },
    });

    // The web server a destination translation sends to is inside the IPv4 prefix, so it stays tracked.
    expect(rendered).toContain(
        [
            "/ip firewall raw",
            'add action=accept chain=prerouting comment="Tracked for NAT, to 198.51.100.70" dst-address=198.51.100.70',
            'add action=accept chain=prerouting comment="Tracked for NAT, from 198.51.100.70" src-address=198.51.100.70',
            'add action=notrack chain=prerouting comment="Untracked to 198.51.100.64/27" dst-address=198.51.100.64/27',
            'add action=notrack chain=prerouting comment="Untracked from 198.51.100.64/27" src-address=198.51.100.64/27',
        ].join("\n")
    );
    expect(rendered).toContain(
        [
            "/ipv6 firewall raw",
            'add action=notrack chain=prerouting comment="Untracked to 2001:db8:100::/48" dst-address=2001:db8:100::/48',
        ].join("\n")
    );

    const adapter = Platforms.get("routeros");
    expect(adapter.plan(rendered, rendered, { secrets: false, rollback: 10 }).steps.flatMap((step) => step.show)).toEqual([]);
});

// Tested on a CCR2216 on 7.23.5: the router took the two accepts before the notracks, counted packets on them, and printed them back as rendered.
test("an address NAT uses inside an untracked prefix stays tracked, before every notrack", () => {
    const rendered = Platforms.get("routeros").render({
        ...router,
        firewall: {
            ...router.firewall,
            untracked: ["198.51.100.32/27"],
            nat: {
                source: [{ if: { src: "10.101.0.0/24", out_interface: "uplink" }, then: "snat", to_address: "198.51.100.34" }],
                destination: [{ if: { protocol: "tcp", dst: "198.51.100.40/32", dst_port: 443 }, then: "dnat", to_address: "10.101.0.10" }],
            },
        },
    });

    expect(rendered).toContain(
        [
            "/ip firewall raw",
            'add action=accept chain=prerouting comment="Tracked for NAT, to 198.51.100.34" dst-address=198.51.100.34',
            'add action=accept chain=prerouting comment="Tracked for NAT, from 198.51.100.34" src-address=198.51.100.34',
            'add action=accept chain=prerouting comment="Tracked for NAT, to 198.51.100.40/32" dst-address=198.51.100.40/32',
            'add action=accept chain=prerouting comment="Tracked for NAT, from 198.51.100.40/32" src-address=198.51.100.40/32',
            'add action=notrack chain=prerouting comment="Untracked to 198.51.100.32/27" dst-address=198.51.100.32/27',
        ].join("\n")
    );
    // An address outside every untracked prefix needs nothing.
    expect(rendered).not.toContain("Tracked for NAT, to 10.101.0.10");
});

// The device keeps a dynamic fasttrack counter rule in the raw table, which it refuses to remove.
test("a rewrite of the raw table never selects a dynamic rule", () => {
    const adapter = Platforms.get("routeros");
    const before = adapter.render(router);
    const after = adapter.render({ ...router, firewall: { ...router.firewall, untracked: ["198.51.100.64/27"] } });
    const sent = adapter.plan(after, before, { secrets: false, rollback: 10 }).steps.flatMap((step) => step.send);

    expect(sent).toContain(":global frameworkOldRules [/ip firewall raw find where !dynamic]");
});

// 7.23 refuses a new BGP connection without its instance, and the export never prints the default one.
test("a new BGP connection names its instance, and an existing one plans nothing for it", () => {
    const adapter = Platforms.get("routeros");
    const rendered = adapter.render(router);
    const connections = rendered.split("\n").filter((line) => line.startsWith("add") && line.includes("remote.as="));

    expect(connections.length).toBeGreaterThan(0);
    expect(connections.every((line) => line.includes("instance=default"))).toBe(true);

    const exported = rendered.replace(/ instance=default/g, "");
    expect(adapter.plan(rendered, exported, { secrets: false, rollback: 10 }).steps.flatMap((step) => step.show)).toEqual([]);
});

// A CCR2216 on 7.23.5 prints `distance=1` on a blackhole route, the default, and nothing on a route through a gateway.
test("a blackhole route printed with its default distance plans nothing", () => {
    const adapter = Platforms.get("routeros");
    const rendered = adapter.render(router);
    const exported = rendered.replace(/^add blackhole (.*)$/gm, "add blackhole distance=1 $1");

    expect(exported).not.toBe(rendered);
    const plan = adapter.plan(rendered, exported, { secrets: false, rollback: 10 });
    expect(plan.problems).toEqual([]);
    expect(plan.steps.flatMap((step) => step.show)).toEqual([]);
});

// The family comes from each prefix, not from the set's first one.
test("a prefix set of both families is matched on each family's chain", () => {
    const adapter = Platforms.get("routeros");
    const routing = router.routing!;
    const rendered = adapter.render({
        ...router,
        routing: {
            ...routing,
            prefix_sets: { ...routing.prefix_sets, ours: { prefixes: ["198.51.100.0/24", "2001:db8:100::/48"] } },
            bgp: {
                ...routing.bgp!,
                neighbors: { ...routing.bgp!.neighbors, "as64501-v6": { address: "2001:db8:ffff::1", neighbor_group: "upstream" } },
            },
        },
    });
    const ours = (chain: string) => rendered.split("\n").filter((line) => line.includes(`chain=${chain} `) && line.includes("dst in ours"));

    expect(ours("UPSTREAM-OUT-V4")).toHaveLength(1);
    expect(ours("UPSTREAM-OUT-V6")).toHaveLength(1);
});

// A peer's name is unique on the device, so adding another peer under its name fails.
test("a new WireGuard key for a peer is set on it", () => {
    const adapter = Platforms.get("routeros");
    const line = (key: string) =>
        `/interface wireguard peers\nadd allowed-address=10.0.0.2/32 interface=wg1 name=wg1-alice public-key="${key}"\n`;
    const plan = adapter.plan(line("bmV3S2V5bmV3S2V5bmV3S2V5bmV3S2V5bmV3S2V5bmU="), line("b2xkS2V5b2xkS2V5b2xkS2V5b2xkS2V5b2xkS2V5b2w="), {
        secrets: false,
        rollback: 10,
    });
    const sent = plan.steps.flatMap((step) => step.send);

    expect(sent).toHaveLength(1);
    expect(sent[0]).toBe(
        '/interface wireguard peers set [ find name=wg1-alice ] public-key="bmV3S2V5bmV3S2V5bmV3S2V5bmV3S2V5bmV3S2V5bmU="'
    );
});

// Seen on 2026-10-23: a transit moved to a new VLAN and peer address, keeping its names. The device refused a second entry of a name, which restored the backup and restarted the router (#92).
test("a VLAN interface that keeps its name on a new VLAN ID is changed in place", () => {
    const adapter = Platforms.get("routeros");
    const vlan = (id: number) => `/interface vlan\nadd interface=bridge name=transit vlan-id=${id}\n`;
    const sent = adapter.plan(vlan(3845), vlan(325), { secrets: false, rollback: 10 }).steps.flatMap((step) => step.send);

    expect(sent).toEqual(["/interface vlan set [ find interface=bridge and vlan-id=325 ] vlan-id=3845"]);
});

test("a BGP connection that keeps its name on a new peer address is removed before it is added again", () => {
    const adapter = Platforms.get("routeros");
    const connection = (address: string) =>
        `/routing bgp connection\nadd instance=default local.role=ebgp name=transit-v4 remote.address=${address} remote.as=64501\n`;
    const sent = adapter
        .plan(connection("198.51.100.9"), connection("198.51.100.1"), { secrets: false, rollback: 10 })
        .steps.flatMap((step) => step.send);

    expect(sent).toEqual([
        "/routing bgp connection remove [ find remote.address=198.51.100.1 ]",
        "/routing bgp connection add instance=default local.role=ebgp name=transit-v4 remote.address=198.51.100.9 remote.as=64501",
    ]);
});

// A CCR2216 on 7.24.6 printed each TTL after another property of its group, and could not unset either (TRAPS.md).
test("BGP TTLs the config does not state are set back to what the router uses unset", () => {
    const adapter = Platforms.get("routeros");
    const connection = (local: string, remote: string) =>
        `/routing bgp connection\nadd instance=default local.role=ebgp${local} name=transit-v4 remote.address=198.51.100.1/32 .as=64501${remote}\n`;
    const sent = (current: string) =>
        adapter.plan(connection("", ""), current, { secrets: false, rollback: 10 }).steps.flatMap((step) => step.send);

    expect(sent(connection(" .ttl=255", " .ttl=255"))).toEqual([
        '/routing bgp connection set [ find remote.address="198.51.100.1/32" ] remote.ttl=1',
    ]);
    expect(sent(connection(" .ttl=255", " .ttl=1"))).toEqual([]);
});

// Set empty, hold-time became infinity, keepalive-time was refused, and output.network printed `""`. Unset, the export printed none (CHR, 7.23.5 and 7.24.6).
test("a BGP connection's timers and networks the config drops are unset", () => {
    const adapter = Platforms.get("routeros");
    const connection = (extra: string) =>
        `/routing bgp connection\nadd${extra} instance=default local.role=ebgp name=transit-v4 remote.address=198.51.100.1/32 .as=64501\n`;
    const sent = adapter
        .plan(connection(""), connection(" hold-time=1m30s keepalive-time=30s output.network=bgp-networks-v4"), {
            secrets: false,
            rollback: 10,
        })
        .steps.flatMap((step) => step.send);

    const selector = '[ find remote.address="198.51.100.1/32" ]';
    expect(sent).toEqual([
        `/routing bgp connection unset ${selector} hold-time`,
        `/routing bgp connection unset ${selector} keepalive-time`,
        `/routing bgp connection unset ${selector} output.network`,
    ]);
});

// Set empty, multihop and the limits were refused, and afi and local.address printed `""`. Unset, the export printed none. connect and listen refuse both, and print `yes` once set to it (CHR, 7.23.5 and 7.24.6).
test("the BGP connection properties a config drops are unset, and connect is set back to yes", () => {
    const adapter = Platforms.get("routeros");
    const connection = (extra: string) =>
        `/routing bgp connection\nadd${extra} instance=default local.role=ebgp name=transit-v4 remote.address=198.51.100.1/32 .as=64501\n`;
    const dropped =
        " afi=ipv6 connect=no input.limit-process-routes-ipv4=1000 .limit-process-routes-ipv6=1000 listen=yes local.address=192.0.2.1 multihop=yes";
    const options = { secrets: false, rollback: 10 };
    const sent = adapter.plan(connection(""), connection(dropped), options).steps.flatMap((step) => step.send);

    const selector = '[ find remote.address="198.51.100.1/32" ]';
    expect(sent).toEqual([
        `/routing bgp connection unset ${selector} multihop`,
        `/routing bgp connection unset ${selector} afi`,
        `/routing bgp connection unset ${selector} local.address`,
        `/routing bgp connection unset ${selector} input.limit-process-routes-ipv4`,
        `/routing bgp connection unset ${selector} input.limit-process-routes-ipv6`,
        `/routing bgp connection set ${selector} connect=yes`,
    ]);
    expect(adapter.plan(connection(""), connection(" connect=yes listen=yes"), options).steps).toEqual([]);
});

// A VLAN interface on the bridge adds a dynamic bridge VLAN entry beside the static one, which a set must not select.
test("a change to a bridge VLAN selects only its static entry", () => {
    const adapter = Platforms.get("routeros");
    const entry = (tagged: string) => `/interface bridge vlan\nadd bridge=bridge tagged=${tagged} vlan-ids=325\n`;
    const sent = adapter.plan(entry("bridge,ether1"), entry("ether1"), { secrets: false, rollback: 10 }).steps.flatMap((step) => step.send);

    expect(sent).toEqual(["/interface bridge vlan set [ find vlan-ids=325 and !dynamic ] tagged=bridge,ether1"]);
});

// RouterOS refuses a logging rule whose action does not exist yet: "input does not match any value of action".
test("a new remote logging action is added before the rules that use it", () => {
    const adapter = Platforms.get("routeros");
    const wanted =
        "/system logging action\nadd name=remote1 remote=10.0.0.1 target=remote\n/system logging\nadd action=remote1 topics=critical\n";
    const sent = adapter.plan(wanted, "", { secrets: false, rollback: 10 }).steps.flatMap((step) => step.send);

    const action = sent.findIndex((line) => line.startsWith("/system logging action add"));
    const rule = sent.findIndex((line) => line.startsWith("/system logging add"));
    expect(action).toBeGreaterThanOrEqual(0);
    expect(rule).toBeGreaterThan(action);
});

test("a round-robin LAG of EoIP tunnels renders with its ARP check, its CAKE queue and an MSS clamp each family", () => {
    const adapter = Platforms.get("routeros");
    const rendered = adapter.render({
        ...router,
        interfaces: {
            ...router.interfaces,
            eoip: {
                "home-eoip01": { local_address: "10.0.1.1", remote_address: "10.0.1.2", tunnel_id: 101, in_lag: "home-bond01" },
                "home-eoip02": { local_address: "10.0.2.1", remote_address: "10.0.2.2", tunnel_id: 102, in_lag: "home-bond01" },
            },
            lag: {
                ...router.interfaces?.lag,
                "home-bond01": {
                    mode: "round_robin",
                    link_check: { arp_targets: ["10.0.3.2"], interval_ms: 200 },
                    addresses: ["10.0.3.1/30"],
                    shaping: { algorithm: "cake", mbps: 180 },
                },
            },
        },
        firewall: { ...router.firewall, tcp_mss: [{ description: "home", if: { out_interface: "home-bond01" }, mss: "path_mtu" }] },
    });
    const lines = rendered.split("\n");

    expect(lines).toContain("add local-address=10.0.1.1 name=home-eoip01 remote-address=10.0.1.2 tunnel-id=101");
    expect(lines).toContain(
        'add arp-interval=200ms arp-ip-targets=10.0.3.2 link-monitoring=arp mode=balance-rr name=home-bond01 slaves="home-eoip01,home-eoip02"'
    );
    expect(lines).toContain("add kind=cake name=home-bond01-cake");
    expect(lines).toContain("add max-limit=180M name=home-bond01-cake packet-mark=home-bond01-cake parent=global queue=home-bond01-cake");
    const mark =
        'add action=mark-packet chain=postrouting comment="Shaping of home-bond01" new-packet-mark=home-bond01-cake out-interface=home-bond01';
    expect(lines.filter((line) => line === mark)).toHaveLength(2);

    const clamp =
        "add action=change-mss chain=forward comment=home new-mss=clamp-to-pmtu out-interface=home-bond01 protocol=tcp tcp-flags=syn";
    expect(lines.filter((line) => line === clamp)).toHaveLength(2);
    expect(rendered.indexOf("/interface eoip")).toBeLessThan(rendered.indexOf("/interface bonding"));
});

// A CCR2216 on 7.23.5 gives an EoIP tunnel a random MAC when it is created, and exports it.
test("an EoIP tunnel's MAC the device made up plans nothing", () => {
    const adapter = Platforms.get("routeros");
    const line = (mac: string) =>
        `/interface eoip\nadd local-address=10.0.1.1 ${mac}name=home-eoip01 remote-address=10.0.1.2 tunnel-id=101\n`;
    const plan = adapter.plan(line(""), line("mac-address=FE:D8:B5:B8:8F:13 "), { secrets: false, rollback: 10 });

    expect(plan.problems).toEqual([]);
    expect(plan.steps).toEqual([]);
});

// An RB5009 on 7.24.6 prints a service's sources as `available-from`, and still takes `address`, which the render writes.
test("a service's available-from on RouterOS 7.24 is its address", () => {
    const adapter = Platforms.get("routeros");
    const desired = ["/ip service", "set ssh address=192.168.77.0/24"].join("\n");
    const sameOnDevice = ["/ip service", "set ssh available-from=192.168.77.0/24"].join("\n");
    const otherOnDevice = ["/ip service", "set ssh available-from=192.168.77.0/24,10.99.0.128/27"].join("\n");

    const same = adapter.plan(desired, sameOnDevice, { secrets: false, rollback: 10 });
    expect(same.problems).toEqual([]);
    expect(same.steps).toEqual([]);

    const other = adapter.plan(desired, otherOnDevice, { secrets: false, rollback: 10 });
    expect(other.problems).toEqual([]);
    expect(other.steps.flatMap((step) => step.send)).toEqual(["/ip service set ssh address=192.168.77.0/24"]);
});

// RouterOS 7.24 prints the default neighbor discovery entry with `advertise-dns=yes` on a device nobody changed, under a comment that it is not started.
test("the default neighbor discovery entry printed with advertise-dns plans nothing", () => {
    const adapter = Platforms.get("routeros");
    const printed = [
        "/ipv6 nd",
        "# automatic dns option advertising is not started, re-apply dns config",
        "set [ find default=yes ] advertise-dns=yes",
    ].join("\n");

    const plan = adapter.plan("", printed, { secrets: false, rollback: 10 });
    expect(plan.problems).toEqual([]);
    expect(plan.steps).toEqual([]);
});

// An RB5009's default configuration shares a USB disk on its bridge. Circuit writes none of it.
test("an RB5009's disk sharing from its default configuration is reset", () => {
    const adapter = Platforms.get("routeros");
    const printed = ["/disk settings", "set auto-media-interface=bridge auto-media-sharing=yes auto-smb-sharing=yes"].join("\n");

    const plan = adapter.plan("", printed, { secrets: false, rollback: 10 });
    expect(plan.problems).toEqual([]);
    expect(plan.steps.flatMap((step) => step.send)).toEqual([
        "/disk settings set auto-media-interface=none auto-media-sharing=no auto-smb-sharing=no",
    ]);
});

// RouterOS 7.24 refuses `:local keep {}`, an empty list, as a syntax error.
test("a mangle table the config empties is removed chain by chain", () => {
    const adapter = Platforms.get("routeros");
    const printed = [
        "/ip firewall mangle",
        "add action=change-mss chain=forward new-mss=1338 out-interface=bond1 protocol=tcp tcp-flags=syn tcp-mss=1339-65535",
        "add action=mark-packet chain=postrouting new-packet-mark=up out-interface=bond1",
    ].join("\n");

    const plan = adapter.plan("", printed, { secrets: false, rollback: 10 });
    const sent = plan.steps.flatMap((step) => step.send);
    expect(sent).toEqual([
        '/ip firewall mangle remove [ find chain="forward" and !dynamic ]',
        '/ip firewall mangle remove [ find chain="postrouting" and !dynamic ]',
    ]);
    expect(sent.join("\n")).not.toContain("{}");
});

// Entries without a name, as an RB5009 on 7.24.6 held them: a selector by name matches nothing, `bad parameter name`.
test("UPnP interfaces are told apart by their interface", () => {
    const adapter = Platforms.get("routeros");
    const printed = ["/ip upnp interfaces", "add interface=bridge type=internal", "add interface=ether2 type=external"].join("\n");

    const plan = adapter.plan("", printed, { secrets: false, rollback: 10 });
    expect(plan.problems).toEqual([]);
    expect(plan.steps.flatMap((step) => step.send)).toEqual([
        "/ip upnp interfaces remove [ find interface=bridge ]",
        "/ip upnp interfaces remove [ find interface=ether2 ]",
    ]);
});

// On an RB5009 on 7.24.6, `find` matched a host route or an interface address only as a whole prefix. It matched a list such as `topics` only quoted, with `;` between its items.
test("a selector writes a host as a prefix and a list with semicolons", () => {
    const adapter = Platforms.get("routeros");
    const printed = [
        "/ip route",
        "add dst-address=192.0.2.82/32 gateway=198.51.100.1 routing-table=tun1",
        "/ip address",
        "add address=203.0.113.60 interface=lo1 network=203.0.113.60",
        "/system logging",
        "add action=disk topics=warning",
        "add action=disk topics=script,debug",
    ].join("\n");

    const sent = adapter.plan("", printed, { secrets: false, rollback: 10 }).steps.flatMap((step) => step.send);
    expect(sent).toContain(
        '/ip route remove [ find dst-address="192.0.2.82/32" and routing-table=tun1 and gateway=198.51.100.1 and !dynamic ]'
    );
    expect(sent).toContain('/ip address remove [ find address="203.0.113.60/32" and !dynamic ]');
    expect(sent).toContain('/system logging remove [ find action=disk and topics="warning" ]');
    expect(sent).toContain('/system logging remove [ find action=disk and topics="script;debug" ]');
});

/** The example router with only these static routes, rendered. */
const withRoutes = (routes: StaticRoute[]): string =>
    Platforms.get("routeros").render({ ...router, routing: { ...router.routing, static_routes: routes } });

/** What a RouterOS plan from `current` to `desired` sends, after checking it has no problem. */
const routerOsSends = (desired: string, current: string): string[] => {
    const plan = Platforms.get("routeros").plan(desired, current, { secrets: false, rollback: 10 });
    expect(plan.problems).toEqual([]);
    return plan.steps.flatMap((step) => step.send);
};

/** The selector of a route in the main table, as the plan writes it. */
const mainRoute = (prefix: string, gateway: string) =>
    `[ find dst-address="${prefix}" and (routing-table=main or !routing-table) and ${gateway} and !dynamic ]`;

// RouterOS keeps several static routes to one prefix in one table, told apart by their gateway (#212). Here the second link takes over at a higher distance when the first goes down.
for (const [menu, prefix, link1, link2] of [
    ["/ip route", "0.0.0.0/0", "192.0.2.1", "198.51.100.1"],
    ["/ipv6 route", "::/0", "2001:db8:1::1", "2001:db8:2::1"],
] as const) {
    test(`${menu}: two routes to one prefix in one table, through two gateways, are two routes`, () => {
        const first: StaticRoute = { prefix, next_hop: link1, description: "Through link 1" };
        const second: StaticRoute = { prefix, next_hop: link2, distance: 2, description: "Through link 2" };
        const both = withRoutes([first, second]);
        const one = withRoutes([first]);

        expect(routerOsSends(both, one)).toEqual([
            `${menu} add comment="Through link 2" distance=2 dst-address=${prefix} gateway=${link2}`,
        ]);
        expect(routerOsSends(both, both)).toEqual([]);
        expect(routerOsSends(one, both)).toEqual([`${menu} remove ${mainRoute(prefix, `gateway=${link2}`)}`]);
    });
}

// A blackhole route has no gateway, so it is found by having none.
test("a blackhole route and a route through a gateway to one prefix are two routes", () => {
    const customer: StaticRoute = { prefix: "198.51.100.0/24", next_hop: "192.0.2.10", description: "Customer" };
    const originate: StaticRoute = { prefix: "198.51.100.0/24", blackhole: true, distance: 254, description: "Originate" };
    const both = withRoutes([customer, originate]);

    expect(routerOsSends(both, withRoutes([customer]))).toEqual([
        "/ip route add blackhole comment=Originate distance=254 dst-address=198.51.100.0/24",
    ]);
    expect(routerOsSends(both, both)).toEqual([]);
    expect(routerOsSends(withRoutes([customer]), both)).toEqual([`/ip route remove ${mainRoute("198.51.100.0/24", "!gateway")}`]);
    expect(routerOsSends(withRoutes([originate]), both)).toEqual([
        `/ip route remove ${mainRoute("198.51.100.0/24", "gateway=192.0.2.10")}`,
    ]);
});

// A new gateway is another route. Adding it first means a default route is never missing, and neither is the session the apply runs over.
test("a route whose gateway changes is added before the old one is removed", () => {
    const before = withRoutes([
        { prefix: "0.0.0.0/0", next_hop: "192.0.2.1" },
        { prefix: "::/0", next_hop: "2001:db8:1::1" },
    ]);
    const after = withRoutes([
        { prefix: "0.0.0.0/0", next_hop: "198.51.100.1" },
        { prefix: "::/0", next_hop: "2001:db8:2::1" },
    ]);

    expect(routerOsSends(after, before)).toEqual([
        "/ip route add dst-address=0.0.0.0/0 gateway=198.51.100.1",
        "/ipv6 route add dst-address=::/0 gateway=2001:db8:2::1",
        `/ipv6 route remove ${mainRoute("::/0", "gateway=2001:db8:1::1")}`,
        `/ip route remove ${mainRoute("0.0.0.0/0", "gateway=192.0.2.1")}`,
    ]);
});

// A gateway is an address or an interface's name. An address is compared in one spelling.
test("a route through an interface is found by its name, and an IPv6 gateway in another spelling is the same route", () => {
    const throughPort = withRoutes([{ prefix: "192.0.2.0/24", interface: "25g-1" }]);
    expect(throughPort).toContain("\nadd dst-address=192.0.2.0/24 gateway=sfp28-1\n");
    expect(routerOsSends(withRoutes([]), throughPort)).toEqual([`/ip route remove ${mainRoute("192.0.2.0/24", "gateway=sfp28-1")}`]);

    const written = withRoutes([{ prefix: "::/0", next_hop: "2001:DB8:1:0::1" }]);
    expect(written).toContain("gateway=2001:DB8:1:0::1");
    expect(routerOsSends(written, written.replace("gateway=2001:DB8:1:0::1", "gateway=2001:db8:1::1"))).toEqual([]);

    // A gateway with its interface, which a person may have written on the device, is removed by it, quoted for its `%`.
    const linkLocal = ["/ipv6 route", "add dst-address=::/0 gateway=fe80::1%sfp28-1"].join("\n");
    expect(routerOsSends("", linkLocal)).toEqual([`/ipv6 route remove ${mainRoute("::/0", 'gateway="fe80::1%sfp28-1"')}`]);
});

// The render keeps the config's spelling of a destination, and the plan compares it in one.
test("a route's destination in another spelling is the same route", () => {
    const written = withRoutes([
        { prefix: "2001:DB8:0::/32", blackhole: true },
        { prefix: "2001:db8:1:0:0:0:0:1/128", next_hop: "2001:db8:1::2" },
    ]);
    expect(written).toContain("add blackhole dst-address=2001:DB8:0::/32\n");
    expect(written).toContain("add dst-address=2001:db8:1:0:0:0:0:1/128 gateway=2001:db8:1::2\n");

    const printed = written.replace("2001:DB8:0::/32", "2001:db8::/32").replace("2001:db8:1:0:0:0:0:1/128", "2001:db8:1::1/128");
    expect(routerOsSends(written, printed)).toEqual([]);

    expect(routerOsSends(withRoutes([]), written)).toEqual([
        `/ipv6 route remove ${mainRoute("2001:db8::/32", "!gateway")}`,
        `/ipv6 route remove ${mainRoute("2001:db8:1::1/128", "gateway=2001:db8:1::2")}`,
    ]);
});

// A link-local next hop is reached through one interface, and RouterOS takes the two together: `gateway=fe80::1%ether1` (tested on a CCR2216, 7.24.6).
test("a next hop with its interface is one gateway on RouterOS", () => {
    const routes: StaticRoute[] = [
        { prefix: "::/0", next_hop: "FE80:0::1", interface: "25g-1" },
        { prefix: "192.0.2.0/24", next_hop: "198.51.100.1", interface: "25g-2", distance: 2 },
    ];
    const written = withRoutes(routes);
    expect(written).toContain('\nadd dst-address=::/0 gateway="FE80:0::1%sfp28-1"\n');
    expect(written).toContain('\nadd distance=2 dst-address=192.0.2.0/24 gateway="198.51.100.1%sfp28-2"\n');

    // The device prints the address in its own spelling; the interface's name is compared as it is.
    const printed = written.replace('"FE80:0::1%sfp28-1"', "fe80::1%sfp28-1").replace('"198.51.100.1%sfp28-2"', "198.51.100.1%sfp28-2");
    expect(routerOsSends(written, printed)).toEqual([]);
    expect(routerOsSends(withRoutes([]), printed)).toEqual([
        `/ipv6 route remove ${mainRoute("::/0", 'gateway="fe80::1%sfp28-1"')}`,
        `/ip route remove ${mainRoute("192.0.2.0/24", 'gateway="198.51.100.1%sfp28-2"')}`,
    ]);

    // Another interface is another gateway: the new route is added before the old one goes.
    const moved = withRoutes([{ prefix: "::/0", next_hop: "fe80::1", interface: "25g-2" }]);
    expect(routerOsSends(moved, withRoutes([routes[0]!]))).toEqual([
        '/ipv6 route add dst-address=::/0 gateway="fe80::1%sfp28-2"',
        `/ipv6 route remove ${mainRoute("::/0", 'gateway="fe80::1%sfp28-1"')}`,
    ]);

    const device: Device = { ...router, routing: { ...router.routing, static_routes: routes } };
    const findings = Checks.run([device], undefined, {}).filter((finding) => finding.message.includes("next_hop with interface"));
    expect(findings).toEqual([]);
});

// RouterOS knows a route by its prefix, table, and gateway, so two routes alike in all three can't be told apart.
test("two routes to one prefix through one gateway in one table are refused on RouterOS", () => {
    const routes: StaticRoute[] = [
        { prefix: "0.0.0.0/0", next_hop: "192.0.2.1", description: "Through link 1" },
        { prefix: "0.0.0.0/0", next_hop: "192.0.2.1/30", distance: 2, description: "Through link 2" },
        { prefix: "0.0.0.0/0", next_hop: "192.0.2.1", vrf: "guests" },
        { prefix: "198.51.100.0/24", blackhole: true },
        { prefix: "198.51.100.0/24", blackhole: true, distance: 254 },
        { prefix: "2001:db8::/32", next_hop: "2001:db8:1::1" },
        { prefix: "2001:DB8::/32", next_hop: "2001:db8:1:0::1" },
        // A next hop with its interface is a gateway of its own: one link-local address on two ports is two gateways.
        { prefix: "::/0", next_hop: "fe80::1", interface: "25g-1" },
        { prefix: "::/0", next_hop: "fe80::1", interface: "25g-2" },
        { prefix: "::/0", next_hop: "FE80::1", interface: "25g-1", distance: 2 },
    ];
    const found = Platforms.get("routeros").unsupported({ ...router, routing: { ...router.routing, static_routes: routes } });

    expect(found.filter((message) => message.startsWith("routing.static_routes"))).toEqual([
        "routing.static_routes[1] 0.0.0.0/0, with the table and gateway of routing.static_routes[0]: RouterOS tells routes to one prefix apart by their gateway. Remove one, or give it its own next_hop",
        "routing.static_routes[4] 198.51.100.0/24, with the table and gateway of routing.static_routes[3]: RouterOS tells routes to one prefix apart by their gateway. Remove one, or give it its own next_hop",
        "routing.static_routes[6] 2001:DB8::/32, with the table and gateway of routing.static_routes[5]: RouterOS tells routes to one prefix apart by their gateway. Remove one, or give it its own next_hop",
        "routing.static_routes[9] ::/0, with the table and gateway of routing.static_routes[7]: RouterOS tells routes to one prefix apart by their gateway. Remove one, or give it its own next_hop",
    ]);
});

// Seen on an RB5009 on 7.24.6: a PPPoE client removed before the interface list member naming it left that member pointing at nothing.
test("a PPPoE client is removed after what names it, and its profile after it", () => {
    const adapter = Platforms.get("routeros");
    const printed = [
        "/ppp profile",
        "add name=wan-pppoe",
        "/interface pppoe-client",
        "add interface=ether2 name=pppoe-wan profile=wan-pppoe",
        "/interface list",
        "add name=WAN",
        "/interface list member",
        "add interface=pppoe-wan list=WAN",
    ].join("\n");

    const sent = adapter.plan("", printed, { secrets: false, rollback: 10 }).steps.flatMap((step) => step.send);
    expect(sent).toEqual([
        "/interface list member remove [ find list=WAN and interface=pppoe-wan ]",
        "/interface list remove [ find name=WAN ]",
        "/interface pppoe-client remove [ find name=pppoe-wan ]",
        "/ppp profile remove [ find name=wan-pppoe ]",
    ]);
});

// An RB5009 has no serial console: RouterOS 7.24.6 takes `enter-setup-on` on it, then prints and keeps nothing, so the plan never empties.
test("a model without a serial console gets no bootloader setup key", () => {
    const adapter = Platforms.get("routeros");
    const rb5009 = {
        name: "rb5009",
        site: "lab",
        platform: "routeros",
        model: "RB5009UG+S+",
        connection: { host: "192.0.2.1", user: "admin" },
    } as Device;
    const withConsole = { ...rb5009, connection: { ...rb5009.connection, console: { port: "/dev/ttyUSB0", baud: 115_200 } } } as Device;

    expect(adapter.render(router)).toContain("enter-setup-on=delete-key");
    expect(adapter.render(rb5009)).not.toContain("enter-setup-on");
    expect(adapter.unsupported(withConsole)).toContain("connection.console, the RB5009UG+S+ has no serial console");
});

// A CHR on 7.24.6 refuses `/system routerboard` with `bad command name routerboard`, and prints `disable-running-check=no` on every port as it ships.
test("a CHR gets no bootloader setup key, and keeps its ports' running check", () => {
    const adapter = Platforms.get("routeros");
    const chr = {
        name: "chr",
        site: "lab",
        platform: "routeros",
        model: "CHR",
        connection: { host: "192.0.2.1", user: "admin" },
    } as Device;
    const printed = ["/interface ethernet", "set [ find default-name=ether1 ] disable-running-check=no"].join("\n");

    expect(adapter.render(chr)).not.toContain("routerboard");
    expect(adapter.plan("", printed, { secrets: false, rollback: 10 })).toEqual({ steps: [], problems: [] });
});

// A CHR's ports are its machine's adapters, as many as it has. The read lists them, and the plan disables the ones the config leaves out.
test("a CHR's adapters that the config does not name are disabled", () => {
    const adapter = Platforms.get("routeros");
    const chr = {
        name: "chr",
        site: "lab",
        platform: "routeros",
        model: "CHR",
        connection: { host: "192.0.2.1", user: "admin" },
        interfaces: { ethernet: { "virtual-1": { description: "Management" }, "virtual-3": {} } },
    } as Device;
    const printed = [
        "/interface ethernet",
        "set [ find default-name=ether1 ] comment=Management",
        "# port ether1",
        "# port ether2",
        "# port ether3",
    ];
    const rendered = adapter.render(chr);

    expect(rendered).toContain("set [ find default-name=ether3 ]\n");
    expect(
        adapter
            .plan(rendered, printed.join("\n"), { secrets: false, rollback: 10 })
            .steps.filter((step) => step.title === "/interface ethernet")
    ).toEqual([
        {
            title: "/interface ethernet",
            show: ["~ set [ find default-name=ether2 ] disabled=yes"],
            send: ["/interface ethernet set [ find default-name=ether2 ] disabled=yes"],
        },
    ]);
});

// A CHR on 7.24.6 took `::ffff:0:0/96`, printed it as `::ffff:0.0.0.0/96`, and refused it again: `already have such entry`.
test("an IPv6 address the device prints with an IPv4 address in it is the same address", () => {
    const adapter = Platforms.get("routeros");
    const rendered = ["/ipv6 firewall address-list", "add address=::ffff:0:0/96 list=bogons-v6"].join("\n");
    const printed = ["/ipv6 firewall address-list", "add address=::ffff:0.0.0.0/96 list=bogons-v6"].join("\n");

    expect(adapter.plan(rendered, printed, { secrets: false, rollback: 10 })).toEqual({ steps: [], problems: [] });
});

// Tested on a CCR2216 with RouterOS 7.24.6: `bgp-path-prepend 1` changes nothing, as it counts the AS the session always sends.
test("RouterOS sends one AS more than a prepend asks for, and refuses 16", () => {
    const routeros = Platforms.get("routeros");
    const device = Fixtures.device("edge-router--edge-01");
    const withPrepend = (prepend: number): Device => ({
        ...device,
        routing: { ...device.routing, policies: { ...device.routing?.policies, OUT: [{ set: { prepend }, then: "accept" }] } },
    });

    expect(routeros.render(withPrepend(2))).toContain("set bgp-path-prepend 3");
    expect(routeros.unsupported(withPrepend(15)).filter((field) => field.includes("prepend"))).toEqual([]);
    expect(routeros.unsupported(withPrepend(16)).filter((field) => field.includes("prepend"))).toHaveLength(1);
});
