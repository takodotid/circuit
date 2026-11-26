import { expect, test } from "bun:test";
import { Checks } from "../../src/checks";
import { Platforms } from "../../src/platforms";
import type { Device, Prefix, StaticRoute } from "../../src/model";
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

test("a firewall rule writes ESP and AH as ipsec-esp and ipsec-ah, as RouterOS takes them", () => {
    const rendered = Platforms.get("routeros").render({
        ...router,
        firewall: {
            filter: {
                input: {
                    rules: [
                        { description: "ESP", if: { protocol: "esp" }, then: "accept" },
                        { description: "AH", if: { protocol: "ah" }, then: "accept" },
                    ],
                },
            },
        },
    });

    expect(rendered).toContain("add action=accept chain=input comment=ESP protocol=ipsec-esp");
    expect(rendered).toContain("add action=accept chain=input comment=AH protocol=ipsec-ah");
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

test("a pool jumps by subscribers to a chain for each pool address, which gives each subscriber its block of ports, and stays tracked whole", () => {
    const rendered = Platforms.get("routeros").render({
        ...router,
        firewall: {
            ...router.firewall,
            untracked: ["198.51.100.0/31"],
            nat: {
                source: [
                    {
                        description: "CGNAT",
                        if: { src: "100.64.0.0/30", out_interface: "uplink" },
                        then: "snat",
                        to_pool: "198.51.100.0/31",
                        port_allocation: "deterministic",
                        port_set_size: 32256,
                    },
                ],
            },
        },
    });

    expect(rendered).toContain(
        [
            "/ip firewall raw",
            'add action=accept chain=prerouting comment="Tracked for NAT, to 198.51.100.0/31" dst-address=198.51.100.0/31',
        ].join("\n")
    );
    expect(rendered).toContain(
        [
            "/ip firewall nat",
            "add action=jump chain=srcnat comment=CGNAT jump-target=cgnat-198.51.100.0/31 out-interface=uplink src-address=100.64.0.0/30",
            "add action=jump chain=cgnat-198.51.100.0/31 jump-target=cgnat-198.51.100.0 src-address=100.64.0.0/31",
            "add action=jump chain=cgnat-198.51.100.0/31 jump-target=cgnat-198.51.100.1 src-address=100.64.0.2/31",
            "add action=src-nat chain=cgnat-198.51.100.0 protocol=tcp src-address=100.64.0.0 to-addresses=198.51.100.0 to-ports=1024-33279",
            "add action=src-nat chain=cgnat-198.51.100.0 protocol=udp src-address=100.64.0.0 to-addresses=198.51.100.0 to-ports=1024-33279",
            "add action=src-nat chain=cgnat-198.51.100.0 protocol=tcp src-address=100.64.0.1 to-addresses=198.51.100.0 to-ports=33280-65535",
            "add action=src-nat chain=cgnat-198.51.100.0 protocol=udp src-address=100.64.0.1 to-addresses=198.51.100.0 to-ports=33280-65535",
            "add action=src-nat chain=cgnat-198.51.100.0 to-addresses=198.51.100.0",
            "add action=src-nat chain=cgnat-198.51.100.1 protocol=tcp src-address=100.64.0.2 to-addresses=198.51.100.1 to-ports=1024-33279",
        ].join("\n")
    );

    const adapter = Platforms.get("routeros");
    expect(adapter.plan(rendered, rendered, { secrets: false, rollback: 10 }).steps).toEqual([]);
});

// A /20 of subscribers, 8449 rules, took 89 s to apply on a CHR. A /18 took 340 s, and its export passed 2 MiB (7.24.6, #312).
test("a pool with more subscribers than a /20 is a warning on RouterOS", () => {
    const pool = (src: Prefix, to_pool: `${number}.${number}.${number}.${number}/${number}`) =>
        ({ if: { src }, then: "snat", to_pool, port_allocation: "deterministic", port_set_size: 1008 }) as const;
    const device: Device = {
        ...router,
        firewall: {
            ...router.firewall,
            nat: { source: [pool("100.64.0.0/20", "198.51.100.0/25"), pool("100.64.64.0/18", "203.0.113.0/24")] },
        },
    };

    expect(Platforms.get("routeros").checks!(device)).toEqual([
        {
            level: "warning",
            device: router.name,
            message:
                "firewall.nat.source, to_pool 203.0.113.0/24: if.src 100.64.64.0/18 has 16384 subscribers, which take about 33281 firewall rules on RouterOS. The largest pool proven is a /20 of 4096 subscribers, whose apply took 89 s on a CHR. Try this one on a lab device first, or split the subscribers among routers.",
        },
    ]);
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
        "/routing bgp connection remove [ find remote.address=198.51.100.1 and (vrf=main or !vrf) ]",
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
        '/routing bgp connection set [ find remote.address="198.51.100.1/32" and (vrf=main or !vrf) ] remote.ttl=1',
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

    const selector = '[ find remote.address="198.51.100.1/32" and (vrf=main or !vrf) ]';
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

    const selector = '[ find remote.address="198.51.100.1/32" and (vrf=main or !vrf) ]';
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

// The plan kept only the first prefix's length: `10.0.2.0/24,198.51.100.0/30` went out as `10.0.2.0/24,198.51.100.0`, which a CHR took as the one host `198.51.100.0/32` (7.24.6, #313).
test("each prefix of a service's sources keeps its length, sent and compared", () => {
    const adapter = Platforms.get("routeros");
    const options = { secrets: false, rollback: 10 };
    const desired = (length: number) => `/ip service\nset ssh address=10.0.2.0/24,198.51.100.0/${length}\n`;
    const printed = (last: string) => `/ip service\nset ssh available-from=10.0.2.0/24,${last}\n`;
    const sent = (plan: ReturnType<typeof adapter.plan>) => plan.steps.flatMap((step) => step.send);

    expect(sent(adapter.plan(desired(30), printed("198.51.100.0/32"), options))).toEqual([
        "/ip service set ssh address=10.0.2.0/24,198.51.100.0/30",
    ]);
    expect(adapter.plan(desired(30), printed("198.51.100.0/30"), options).steps).toEqual([]);
    expect(sent(adapter.plan(desired(29), printed("198.51.100.0/30"), options))).toEqual([
        "/ip service set ssh address=10.0.2.0/24,198.51.100.0/29",
    ]);
});

// As a CHR printed them (7.24.6): in the order sent, IPv6 lowercase, and a host with /32 or /128.
test("a WireGuard peer's and an SNMP community's lists of prefixes compare item by item", () => {
    const adapter = Platforms.get("routeros");
    const options = { secrets: false, rollback: 10 };
    const key = 'public-key="bmV3S2V5bmV3S2V5bmV3S2V5bmV3S2V5bmV3S2V5bmU="';
    const peer = (allowed: string) => `/interface wireguard peers\nadd allowed-address=${allowed} interface=wg1 name=wg1-alice ${key}\n`;
    const printedPeer = [
        "/interface wireguard peers",
        'add allowed-address="10.9.0.0/24,198.51.100.4/32,2001:db8::/48,2001:db8:1::1/128,2001:db8:2::/64" \\',
        `    interface=wg1 name=wg1-alice ${key}`,
    ].join("\n");

    const allowed = "10.9.0.0/24,198.51.100.4/32,2001:db8::/48,2001:db8:1::1/128,2001:DB8:2::/64";
    expect(adapter.plan(peer(allowed), printedPeer, options).steps).toEqual([]);
    expect(
        adapter.plan(peer(allowed.replace("2001:db8::/48", "2001:db8::/56")), printedPeer, options).steps.flatMap((step) => step.send)
    ).toEqual([
        "/interface wireguard peers set [ find name=wg1-alice ] allowed-address=10.9.0.0/24,198.51.100.4,2001:db8::/56,2001:db8:1::1/128,2001:db8:2::/64",
    ]);

    const community = (addresses: string) => `/snmp community\nset [ find default=yes ] addresses=${addresses}\n`;
    const printedCommunity = community("10.0.2.0/24,198.51.100.4/32,2001:db8::/32");
    expect(adapter.plan(community("10.0.2.0/24,198.51.100.4/32,2001:DB8::/32"), printedCommunity, options).steps).toEqual([]);
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

// A new CHR's own keymat provider comes and goes by itself. RouterOS prints it with `add`, and refuses that `add` as printed (CHR, 7.24.6).
test("the device's own keymat provider plans nothing, printed or not, and is changed in place, never removed", () => {
    const adapter = Platforms.get("routeros");
    const options = { secrets: false, rollback: 10 };
    const printed = "/system keymat-provider\nadd disabled=yes key-size=0 name=default qkd-cache-size=0 qkd-certificate=*0 type=qkd\n";

    expect(adapter.plan("", printed, options)).toEqual({ steps: [], problems: [] });
    expect(adapter.plan("", "", options)).toEqual({ steps: [], problems: [] });

    const changed = printed.replace("qkd-cache-size=0", "qkd-cache-size=16");
    expect(routerOsSends("", changed)).toEqual(["/system keymat-provider set default qkd-cache-size=0"]);

    // A provider of the person's own is removed, as anything else the config does not hold.
    const another = `${printed}add name=qkd-lab qkd-address=192.0.2.10:443 type=qkd\n`;
    expect(routerOsSends("", another)).toEqual(["/system keymat-provider remove [ find name=qkd-lab ]"]);
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

// A CHR on 7.24.6 printed a published ARP entry as it was sent, and kept one address on two interfaces apart.
test("an address for proxy ARP is a published ARP entry of its VLAN interface, which plans nothing once printed, and goes with it", () => {
    const adapter = Platforms.get("routeros");
    const [name, iface] = Object.entries(router.interfaces!.vlan_interface!).find(([, settings]) => settings?.addresses?.length)!;
    const withProxy: Device = {
        ...router,
        interfaces: {
            ...router.interfaces,
            vlan_interface: { ...router.interfaces!.vlan_interface, [name]: { ...iface!, proxy_arp: ["192.0.2.50"] } },
        },
    };
    const entry = `add address=192.0.2.50 interface=${name} published=yes`;
    const printed = ["/ip arp", entry, "add address=192.0.2.50 interface=ether2 published=yes"].join("\n");

    expect(adapter.unsupported(withProxy).filter((gap) => gap.includes("proxy_arp"))).toEqual([]);
    expect(adapter.render(withProxy)).toContain(`/ip arp\n${entry}\n`);
    expect(adapter.plan(`/ip arp\n${entry}\n`, printed, { secrets: false, rollback: 10 }).steps.flatMap((step) => step.send)).toEqual([
        "/ip arp remove [ find address=192.0.2.50 and interface=ether2 and !dynamic ]",
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

// RouterOS looks a gateway up in main unless it ends in a VRF. A route in a VRF without it stayed inactive through a port, a VLAN interface, a tunnel, and to a next hop (CHR, 7.24.6).
test("a route in a VRF ends its gateway in the VRF, and one the device holds without it is replaced", () => {
    const written = withRoutes([
        { prefix: "0.0.0.0/0", next_hop: "198.51.100.130", vrf: "guests" },
        { prefix: "192.0.2.0/24", interface: "25g-1", vrf: "guests" },
        { prefix: "192.0.2.0/24", next_hop: "198.51.100.131", interface: "guests", vrf: "guests" },
        { prefix: "::/0", next_hop: "2001:DB8:0::1", vrf: "guests" },
        { prefix: "2001:db8:1::/48", next_hop: "fe80::1", interface: "guests", vrf: "guests" },
        { prefix: "203.0.113.0/24", blackhole: true, vrf: "guests" },
    ]);
    for (const route of [
        "dst-address=0.0.0.0/0 gateway=198.51.100.130@guests",
        "dst-address=192.0.2.0/24 gateway=sfp28-1@guests",
        'dst-address=192.0.2.0/24 gateway="198.51.100.131%guests@guests"',
        "dst-address=::/0 gateway=2001:DB8:0::1@guests",
        'dst-address=2001:db8:1::/48 gateway="fe80::1%guests@guests"',
        "blackhole dst-address=203.0.113.0/24",
    ])
        expect(written).toContain(`\nadd ${route} routing-table=guests\n`);

    // The device prints each gateway as written, but an address in its own spelling.
    const printed = written
        .replace("2001:DB8:0::1@guests", "2001:db8::1@guests")
        .replace('"198.51.100.131%guests@guests"', "198.51.100.131%guests@guests")
        .replace('"fe80::1%guests@guests"', "fe80::1%guests@guests");
    expect(routerOsSends(written, printed)).toEqual([]);

    // A route as Circuit wrote it before, without the VRF, is another route. The new one is added before the old one goes.
    const before = printed
        .replace("gateway=198.51.100.130@guests", "gateway=198.51.100.130")
        .replace("gateway=2001:db8::1@guests", "gateway=2001:db8::1");
    expect(routerOsSends(written, before)).toEqual([
        "/ip route add dst-address=0.0.0.0/0 gateway=198.51.100.130@guests routing-table=guests",
        "/ipv6 route add dst-address=::/0 gateway=2001:DB8:0::1@guests routing-table=guests",
        '/ipv6 route remove [ find dst-address="::/0" and routing-table=guests and gateway=2001:db8::1 and !dynamic ]',
        '/ip route remove [ find dst-address="0.0.0.0/0" and routing-table=guests and gateway=198.51.100.130 and !dynamic ]',
    ]);
    expect(routerOsSends(withRoutes([]), printed)).toContain(
        '/ip route remove [ find dst-address="192.0.2.0/24" and routing-table=guests and gateway="sfp28-1@guests" and !dynamic ]'
    );
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
test("a PPPoE client is removed after what names it, its profile after it, and an interface list a profile may name last", () => {
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
        "/interface pppoe-client remove [ find name=pppoe-wan ]",
        "/ppp profile remove [ find name=wan-pppoe ]",
        "/interface list remove [ find name=WAN ]",
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

// Seen on a CHR with RouterOS 7.24.6: `/interface bridge add name=lo` was refused, `already have interface with name lo`.
test("an interface named lo is refused on RouterOS, which has a loopback of its own by that name", () => {
    const withLoopbacks = (...names: string[]): Device => ({
        ...router,
        interfaces: { ...router.interfaces, loopback: Object.fromEntries(names.map((name) => [name, { addresses: ["192.0.2.1/32"] }])) },
    });
    const named = (device: Device) =>
        Platforms.get("routeros")
            .unsupported(device)
            .filter((field) => field.includes("own loopback"));

    expect(named(withLoopbacks("lo"))).toEqual([
        "interfaces.loopback.lo, the name of RouterOS's own loopback interface: write another name, such as loopback",
    ]);
    expect(named(withLoopbacks("loopback", "lo0"))).toEqual([]);
});

// Seen on a CHR with RouterOS 7.24.6: a LAG that takes a bridge port is refused, `ether3 already in bridge`. The bridge takes a LAG's member at once, inactive until the LAG lets it go.
test("a port leaves the bridge before a LAG takes it, and joins the bridge from a LAG before the LAG lets it go", () => {
    const bridge = "/interface bridge\nadd name=bridge vlan-filtering=yes\n";
    const lag = (slaves: string) => `/interface bonding\nadd mode=802.3ad name=lag-1 slaves=${slaves}\n`;
    const ports = (...names: string[]) =>
        `/interface bridge port\n${names.map((name) => `add bridge=bridge interface=${name}\n`).join("")}`;
    const sends = (desired: string, current: string) =>
        Platforms.get("routeros")
            .plan(desired, current, { secrets: false, rollback: 10 })
            .steps.flatMap((step) => step.send);

    const inBridge = bridge + ports("ether3", "ether4");
    const inLag = bridge + lag("ether3,ether4") + ports("lag-1");
    expect(sends(inLag, inBridge)).toEqual([
        "/interface bridge port remove [ find interface=ether3 ]",
        "/interface bridge port remove [ find interface=ether4 ]",
        "/interface bonding add mode=802.3ad name=lag-1 slaves=ether3,ether4",
        "/interface bridge port add bridge=bridge interface=lag-1",
    ]);
    expect(sends(inBridge, inLag)).toEqual([
        "/interface bridge port add bridge=bridge interface=ether3",
        "/interface bridge port add bridge=bridge interface=ether4",
        "/interface bridge port remove [ find interface=lag-1 ]",
        "/interface bonding remove [ find name=lag-1 ]",
    ]);

    // A LAG that stays takes a port from the bridge, then lets it go back.
    const oneInLag = bridge + lag("ether3") + ports("lag-1", "ether4");
    expect(sends(inLag, oneInLag)).toEqual([
        "/interface bridge port remove [ find interface=ether4 ]",
        "/interface bonding set [ find name=lag-1 ] slaves=ether3,ether4",
    ]);
    expect(sends(oneInLag, inLag)).toEqual([
        "/interface bonding set [ find name=lag-1 ] slaves=ether3",
        "/interface bridge port add bridge=bridge interface=ether4",
    ]);
});

// Seen on a CHR with RouterOS 7.24.6: a VRF that lets a bridge port or a LAG member go, or is removed, keeps it bound. Once out of the bridge or LAG, it routes nothing.
test("a port that leaves a VRF joins a bridge or a LAG only after the VRF steps", () => {
    const bridge = "/interface bridge\nadd name=bridge vlan-filtering=yes\n";
    const lag = (slaves: string) => `/interface bonding\nadd mode=802.3ad name=lag-1 slaves=${slaves}\n`;
    const vrf = (interfaces: string) => `/ip vrf\nadd interfaces=${interfaces} name=lab\n`;
    const plan = (desired: string, current: string) => Platforms.get("routeros").plan(desired, current, { secrets: false, rollback: 10 });
    const sends = (desired: string, current: string) => plan(desired, current).steps.flatMap((step) => step.send);

    // The VRF goes, and its port joins the bridge.
    const address = "/ip address\nadd address=192.0.2.5/30 interface=ether3\n";
    const access = `${bridge}/interface bridge port\nadd bridge=bridge interface=ether3 pvid=200\n`;
    expect(sends(access, bridge + vrf("ether3") + address)).toEqual([
        '/ip address remove [ find address="192.0.2.5/30" and !dynamic ]',
        "/ip vrf remove [ find name=lab ]",
        "/interface bridge port add bridge=bridge interface=ether3 pvid=200",
    ]);

    // The VRF keeps one port, and lets the other go to a new LAG, beside a port that was in no VRF.
    expect(sends(lag("ether3,ether5") + vrf("ether4"), vrf("ether3,ether4"))).toEqual([
        "/interface bonding add mode=802.3ad name=lag-1 slaves=ether5",
        "/ip vrf set [ find name=lab ] interfaces=ether4",
        "/interface bonding set [ find name=lag-1 ] slaves=ether3,ether5",
    ]);

    // A LAG that stays keeps its member until the port is out of the VRF.
    expect(sends(lag("ether3"), lag("ether5") + vrf("ether3"))).toEqual([
        "/ip vrf remove [ find name=lab ]",
        "/interface bonding set [ find name=lag-1 ] slaves=ether3",
    ]);

    // A new LAG of such ports alone would have no member until then, which RouterOS refuses.
    expect(plan(lag("ether3"), vrf("ether3")).problems).toEqual([
        "/interface bonding lag-1: each of its members, ether3, leaves a VRF, which would keep it bound (TRAPS.md). Apply once with these ports out of their VRF and of the LAG, then with the LAG",
    ]);
});
