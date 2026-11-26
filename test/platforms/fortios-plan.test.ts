import { expect, spyOn, test } from "bun:test";
import { Registries } from "../../src/core/registries";
import { Platforms } from "../../src/platforms";
import { FortiOsFirewall } from "../../src/platforms/fortios/firewall";
import { FortiOs } from "../../src/platforms/fortios/index";
import { FortiOsTree } from "../../src/platforms/fortios/tree";
import type { Device, IPv4 } from "../../src/model";
import { Fixtures } from "../fixtures";

const firewall = Fixtures.device("platforms--example-firewall");

// Seen on a 3700D running 6.2.2. It prints settings in its own order, passwords as ciphers, object UUIDs, and interface SNMP indexes. It leaves out a default and adds factory objects.
test("example-firewall plans nothing against how the device prints it", () => {
    const adapter = Platforms.get("fortios");
    const rendered = adapter.render(firewall);

    const tree = FortiOsTree.parse(rendered);
    const reverse = (block: ReturnType<typeof FortiOsTree.parse>) => {
        const settings = [...block.settings].reverse();
        block.settings.clear();
        for (const [key, value] of settings) block.settings.set(key, value);
        for (const child of block.blocks.values()) reverse(child);
        for (const { block: entry } of block.entries.values()) reverse(entry);
    };
    reverse(tree);

    const printed = FortiOsTree.print(tree)
        .replace(/set password "<secret:\w+>"/g, "set password ENC <redacted>")
        .replace(/set name "<secret:\w+>"/, 'set name "<redacted>"')
        .replace(/\n\s*set dns-service specify/, "")
        .replace("config system global\n", 'config system global\n    set alias "FortiGate-3700D"\n    set cfg-save revert\n')
        .replace('edit "port7"\n', 'edit "port7"\n        set snmp-index 7\n')
        .replace(
            "config firewall address\n",
            'config firewall address\n    edit "all"\n        set uuid 9474dcc4-c3e9-51f1-9b0c-39298bc2c34a\n    next\n'
        )
        .replace("config system interface\n", 'config system interface\n    edit "modem"\n        set mode pppoe\n    next\n');

    expect(printed).not.toEqual(rendered);

    const plan = adapter.plan(rendered, printed, { secrets: false, rollback: 10 });
    expect(plan.steps.flatMap((step) => step.show)).toEqual([]);
});

const fortiosPlan = (desired: string[], current: string[], secrets = false) =>
    Platforms.get("fortios").plan(`${desired.join("\n")}\n`, `${current.join("\n")}\n`, { secrets, rollback: 10 });

// A port joins an aggregate only while nothing names it: the device answers `entry not found in datasource`.
test("a FortiOS port joining a LAG is first freed of what names it", () => {
    const route = (device: string) => [
        "config router static",
        "    edit 1",
        "        set gateway 203.0.113.9",
        `        set device "${device}"`,
        "    next",
        "end",
    ];
    const port = ['    edit "port1"', '        set vdom "root"', "        set type physical", "    next"];

    const desired = [
        "config system interface",
        ...port,
        '    edit "uplink"',
        '        set vdom "root"',
        "        set type aggregate",
        '        set member "port1"',
        "    next",
        "end",
        ...route("uplink"),
    ];
    const current = ["config system interface", ...port, "end", ...route("port1")];

    const sent = fortiosPlan(desired, current).steps.flatMap((step) => step.send);
    expect(sent.slice(0, 3)).toEqual(["config router static", "delete 1", "end"]);
    expect(sent.indexOf('set member "port1"')).toBeLessThan(sent.indexOf('set device "uplink"'));
});

// Seen on a FG-3700D on 6.2.2. The device refused a renamed VLAN interface while the old one held its VLAN ID and parent: "vlanid and underlying interface must be a unique pair".
test("a FortiOS VLAN interface renamed goes first, with what names it, and comes back under its new name", () => {
    const vlan = (name: string) => [
        `    edit "${name}"`,
        '        set vdom "root"',
        "        set ip 10.0.0.2 255.255.255.252",
        '        set interface "lag1"',
        "        set vlanid 3900",
        "    next",
    ];
    const route = (device: string) => [
        "config router static",
        "    edit 1",
        "        set gateway 10.0.0.1",
        `        set device "${device}"`,
        "    next",
        "end",
    ];

    const desired = ["config system interface", ...vlan("p2p-new"), "end", ...route("p2p-new")];
    const current = ["config system interface", ...vlan("transit"), "end", ...route("transit")];

    const sent = fortiosPlan(desired, current).steps.flatMap((step) => step.send);
    const deleted = sent.findIndex((line, i) => line === 'delete "transit"' && sent.slice(0, i).includes("config system interface"));

    expect(deleted).toBeGreaterThan(-1);
    expect(sent.indexOf("delete 1")).toBeLessThan(deleted);
    expect(deleted).toBeLessThan(sent.indexOf('edit "p2p-new"'));
    expect(sent.indexOf('edit "p2p-new"')).toBeLessThan(sent.indexOf('set device "p2p-new"'));
});

// The device refuses a static route the same as another, `Duplicated entry`. Editing route 1 into what route 2 holds failed before route 2 moved on. A kept route is found by what it holds, whatever its number.
test("FortiOS leaves kept static routes alone, and deletes changing ones before it creates any", () => {
    const route = (id: number, dst: string, gateway: string, device: string) => [
        `    edit ${id}`,
        `        set dst ${dst}`,
        `        set gateway ${gateway}`,
        `        set device "${device}"`,
        "    next",
    ];

    const current = [
        "config router static",
        "    edit 1",
        "        set gateway 192.168.100.1",
        '        set device "port1"',
        "    next",
        ...route(2, "10.0.0.0 255.255.255.0", "192.0.2.1", "mgmt1"),
        ...route(3, "10.0.1.0 255.255.255.0", "192.0.2.1", "mgmt1"),
        "end",
    ];
    const desired = [
        "config router static",
        ...route(1, "10.0.0.0 255.255.255.0", "192.0.2.1", "mgmt1"),
        ...route(2, "10.0.1.0 255.255.255.0", "192.0.2.1", "mgmt1"),
        "end",
    ];

    expect(fortiosPlan(desired, current).steps.flatMap((step) => step.send)).toEqual(["config router static", "delete 1", "end"]);

    const changed = [
        "config router static",
        ...route(1, "10.0.0.0 255.255.255.0", "192.0.2.2", "mgmt1"),
        ...route(2, "10.0.1.0 255.255.255.0", "192.0.2.1", "mgmt1"),
        "end",
    ];

    expect(fortiosPlan(changed, current).steps.flatMap((step) => step.send)).toEqual([
        "config router static",
        "delete 1",
        "delete 2",
        "edit 4",
        "set dst 10.0.0.0 255.255.255.0",
        "set gateway 192.0.2.2",
        'set device "mgmt1"',
        "next",
        "end",
    ]);
});

// NTP refuses to delete its last server while it synchronizes, and `unset type` hides the servers without deleting them.
test("FortiOS stops NTP before deleting its servers, and hides them last", () => {
    const current = [
        "config system ntp",
        "    set ntpsync enable",
        "    set type custom",
        "    config ntpserver",
        "        edit 1",
        '            set server "192.0.2.1"',
        "        next",
        "    end",
        "end",
    ];

    const sent = fortiosPlan(["config system ntp", "end"], current).steps.flatMap((step) => step.send);
    expect(sent).toEqual(["config system ntp", "unset ntpsync", "config ntpserver", "delete 1", "end", "unset type", "end"]);
});

// The factory numbers its helpers its own way; a helper the config keeps is left where it is.
test("FortiOS session helpers are matched by what they hold", () => {
    const helper = (id: number, name: string, protocol: number, port: number) => [
        `    edit ${id}`,
        `        set name ${name}`,
        `        set protocol ${protocol}`,
        `        set port ${port}`,
        "    next",
    ];

    const desired = ["config system session-helper", ...helper(1, "ftp", 6, 21), "end"];
    const current = ["config system session-helper", ...helper(9, "ftp", 6, 21), ...helper(13, "sip", 17, 5060), "end"];

    const sent = fortiosPlan(desired, current).steps.flatMap((step) => step.send);
    expect(sent).toEqual(["config system session-helper", "delete 13", "end"]);
});

// A password can't be read back.
test("a FortiOS password is sent only for a new user or a rotation", () => {
    const admin = (password: string) => ["config system admin", '    edit "netops"', `        set password ${password}`, "    next", "end"];
    const desired = admin('"<secret:NETOPS_PASSWORD>"');
    const current = admin("ENC <redacted>");

    expect(fortiosPlan(desired, current).steps).toEqual([]);
    expect(fortiosPlan(desired, current, true).steps.flatMap((step) => step.send)).toContain('set password "<secret:NETOPS_PASSWORD>"');
});

// The device keeps policies in an order of its own, which `move` changes.
test("a FortiOS policy table is put back in the render's order", () => {
    const policy = (id: number) => [`    edit ${id}`, `        set comments "Rule ${id}"`, "    next"];

    const desired = ["config firewall policy", ...policy(1), ...policy(2), "end"];
    const current = ["config firewall policy", ...policy(2), ...policy(1), "end"];

    const plan = fortiosPlan(desired, current);
    expect(plan.steps.flatMap((step) => step.send)).toEqual(["config firewall policy", "move 1 before 2", "end"]);
    expect(plan.steps.flatMap((step) => step.show)).toEqual(["+ move 1 before 2"]);
});

// A port's speed cannot change while it is in a LAG: `Interface speed cannot be set for aggregated interfaces`.
test("a FortiOS LAG lets its ports go before they change", () => {
    const port = (name: string, speed?: string) => [
        `    edit "${name}"`,
        '        set vdom "root"',
        "        set type physical",
        ...(speed ? [`        set speed ${speed}`] : []),
        "    next",
    ];
    const lag = (members: string) => [
        '    edit "uplink"',
        '        set vdom "root"',
        "        set type aggregate",
        `        set member ${members}`,
        "    next",
    ];
    const route = ["config router static", "    edit 1", '        set device "uplink"', "    next", "end"];

    const current = [
        "config system interface",
        ...port("port1", "40000full"),
        ...port("port2", "40000full"),
        ...lag('"port1" "port2"'),
        "end",
        ...route,
    ];

    const gone = fortiosPlan(
        ["config system interface", ...port("port1"), ...port("port2"), "end", "config router static", "end"],
        current
    );
    const sent = gone.steps.flatMap((step) => step.send);
    expect(sent.slice(0, 6)).toEqual(["config router static", "delete 1", "end", "config system interface", 'delete "uplink"', "end"]);
    expect(sent.indexOf("unset speed")).toBeGreaterThan(sent.indexOf('delete "uplink"'));

    const shrunk = fortiosPlan(
        ["config system interface", ...port("port1"), ...port("port2", "40000full"), ...lag('"port2"'), "end", ...route],
        current
    );
    expect(shrunk.steps[0]!.send).toEqual(["config system interface", 'edit "uplink"', 'set member "port2"', "next", "end"]);

    // A port that stays changes its speed outside the LAG and joins again.
    const kept = ["config system interface", ...port("port1"), ...port("port2", "40000full"), ...lag('"port1" "port2"'), "end", ...route];
    const sent2 = fortiosPlan(kept, current).steps.flatMap((step) => step.send);
    expect(sent2.slice(0, 5)).toEqual(["config system interface", 'edit "uplink"', 'set member "port2"', "next", "end"]);
    expect(sent2.indexOf("unset speed")).toBeLessThan(sent2.indexOf('set member "port1" "port2"'));
});

// Local-in policies run ahead of the input chain. Each service accepts its sources and refuses everyone else.
test("FortiOS guards the management services with local-in policies", () => {
    const rendered = FortiOsTree.parse(Platforms.get("fortios").render(firewall));
    const policies = [...rendered.blocks.get("firewall local-in-policy")!.entries.values()].map(({ block }) =>
        ["srcaddr", "action", "service"].map((key) => block.settings.get(key) ?? "").join(" ")
    );

    expect(policies.slice(0, 4)).toEqual([
        '"circuit-management" accept "tcp/2222" "tcp/8443" "tcp/541"',
        '"all" deny "tcp/2222" "tcp/8443" "tcp/541"',
        '"circuit-snmp" accept "udp/161"',
        '"all" deny "udp/161"',
    ]);
});

// A tunnel's interface exists only once its tunnel does.
test("a FortiOS tunnel's interface is set after its tunnel", () => {
    const desired = [
        "config system gre-tunnel",
        '    edit "partner"',
        '        set interface "uplink"',
        "        set remote-gw 203.0.113.220",
        "        set local-gw 203.0.113.10",
        "    next",
        "end",
        "config system interface",
        '    edit "partner"',
        '        set vdom "root"',
        "        set type tunnel",
        '        set interface "uplink"',
        "        set ip 192.0.2.249 255.255.255.255",
        "        set remote-ip 192.0.2.250 255.255.255.252",
        "    next",
        "end",
    ];

    const titles = fortiosPlan(desired, []).steps.map((step) => step.title);
    expect(titles).toEqual(["system gre-tunnel", "system interface, tunnels"]);
    expect(fortiosPlan(desired, []).steps[1]!.send[0]).toBe("config system interface");
});

// The device prints a certificate's key encrypted and folds its text its own way.
test("a FortiOS certificate is compared by its text, and its key is a secret", () => {
    const certificate = (text: string, key: string) => [
        "config vpn certificate local",
        '    edit "web"',
        `        set private-key ${key}`,
        `        set certificate "${text}"`,
        "    next",
        "end",
    ];

    const desired = certificate("-----BEGIN CERTIFICATE-----\nMIIBabc\ndef==\n-----END CERTIFICATE-----", '"<secret:WEB_KEY>"');
    const current = certificate("-----BEGIN CERTIFICATE-----\nMIIBabcdef==\n-----END CERTIFICATE-----", '"<redacted>"');

    expect(fortiosPlan(desired, current).steps).toEqual([]);
    expect(fortiosPlan(desired, current, true).steps.flatMap((step) => step.send)).toContain('set private-key "<secret:WEB_KEY>"');
});

// Studio renders a device without fetching its prefix sets from a registry.
test("a FortiOS prefix list from a registry that the render did not fetch stays as the device holds it", async () => {
    const adapter = Platforms.get("fortios");
    const rules = (list: string) =>
        FortiOsTree.parse(list).blocks.get("router prefix-list")!.entries.get("upstream-origins")!.block.blocks.get("rule")!;
    const settings = (list: string) => [...rules(list).entries.values()].map(({ block }) => Object.fromEntries(block.settings));

    // Without its prefixes, the list refuses every prefix.
    expect(settings(adapter.render(firewall))).toEqual([{ prefix: "0.0.0.0 0.0.0.0", ge: FortiOsTree.UNSET, le: "32", action: "deny" }]);

    const list = (lines: string[]) => ["config router prefix-list", '    edit "upstream-origins"', ...lines, "    next", "end"];
    const unfetched = list([
        '        set comments "Fetched by circuit diff and apply from ripe-stat AS64501"',
        "        config rule",
        "            edit 1",
        "                set prefix 0.0.0.0 0.0.0.0",
        "                unset ge",
        "                set le 32",
        "                set action deny",
        "            next",
        "        end",
    ]);
    const held = list([
        "        config rule",
        "            edit 1",
        "                set prefix 198.18.0.0 255.254.0.0",
        "            next",
        "        end",
    ]);
    expect(fortiosPlan(unfetched, held).steps).toEqual([]);

    // Fetched, each prefix matches what is more specific too.
    const fetch = spyOn(Registries, "prefixes").mockResolvedValue(["198.18.0.0/15"]);
    try {
        expect(settings(adapter.render(await Registries.resolve(firewall)))).toEqual([
            { prefix: "198.18.0.0 255.254.0.0", ge: FortiOsTree.UNSET, le: "32" },
        ]);
    } finally {
        fetch.mockRestore();
    }
});

test("a FortiOS service without a protocol covers TCP and UDP", () => {
    const service = FortiOsFirewall.serviceOf({ dst_port: 53 }, "ipv4");
    expect(service.name).toBe("tcp+udp/53");
    expect(Object.fromEntries(service.block!.settings)).toEqual({ "tcp-portrange": "53", "udp-portrange": "53" });
});

// Two interfaces that are up can't hold overlapping subnets.
test("a FortiOS address moving between interfaces leaves the first before it joins the second", () => {
    const iface = (name: string, ip?: string) => [
        `    edit "${name}"`,
        '        set vdom "root"',
        "        set type loopback",
        ...(ip ? [`        set ip ${ip}`] : []),
        "    next",
    ];

    const desired = ["config system interface", ...iface("lo-a"), ...iface("lo-b", "192.0.2.1 255.255.255.255"), "end"];
    const current = ["config system interface", ...iface("lo-a", "192.0.2.1 255.255.255.255"), ...iface("lo-b"), "end"];

    const sent = fortiosPlan(desired, current).steps.flatMap((step) => step.send);
    expect(sent.indexOf("unset ip")).toBeGreaterThan(-1);
    expect(sent.indexOf("unset ip")).toBeLessThan(sent.indexOf("set ip 192.0.2.1 255.255.255.255"));
});

// A route map filters one family at a time: a rule limited to the other family is left out of it.
test("a FortiOS policy becomes a route map for each family", () => {
    const rendered = FortiOsTree.parse(Platforms.get("fortios").render(firewall));
    const maps = rendered.blocks.get("router route-map")!;
    const rules = (name: string) => maps.entries.get(name)?.block.blocks.get("rule")?.entries.size;

    expect(rules("UPSTREAM-OUT")).toBe(2);
    expect(rules("UPSTREAM-OUT-v6")).toBe(2);
    expect(maps.entries.get("UPSTREAM-OUT-v6")!.block.blocks.get("rule")!.entries.get("2")!.block.settings.get("set-community")).toBe(
        '"64501:100"'
    );
});

// A 3700D on 6.2.2 kept its decisions on a neighbor's routes after a policy or a list changed, until a soft clear (TRAPS.md).
test("FortiOS soft-clears each neighbor whose policy, or a list it uses, changes, in that direction", () => {
    const adapter = Platforms.get("fortios");
    const current = adapter.render(firewall);
    const policies = firewall.routing!.policies!;
    const withPolicy = (name: string, rules: (typeof policies)[string]) =>
        adapter.render({ ...firewall, routing: { ...firewall.routing, policies: { ...policies, [name]: rules } } });
    // The last step, after every change and removal.
    const clears = (desired: string) => {
        const last = adapter.plan(desired, current, { secrets: false, rollback: 10 }).steps.at(-1);
        return last?.title === "router bgp, soft clear" ? last.send : [];
    };

    // Only the prefix list of its third rule changes, which only the IPv4 import uses.
    const [first, second, , fourth] = policies["UPSTREAM-IN"]!;
    const narrower = withPolicy("UPSTREAM-IN", [
        first!,
        second!,
        { if: { prefix: "192.0.2.0/24" }, set: { local_pref: 200, add_standard_communities: ["64500:100"] }, then: "accept" },
        fourth!,
    ]);
    expect(clears(narrower)).toEqual(["execute router clear bgp ip 203.0.113.9 soft in"]);

    // A policy both exports call.
    expect(clears(withPolicy("NOT-TO-UPSTREAMS", [{ if: { standard_community: "64500:998" }, then: "reject" }]))).toEqual([
        "execute router clear bgp ip 203.0.113.9 soft out",
        "execute router clear bgp ipv6 2001:db8:fff0::1 soft out",
    ]);

    expect(clears(current)).toEqual([]);
});

// `diff` and `apply` fetch a prefix set from a registry before the render, so a list that changes there changes in the plan.
test("FortiOS soft-clears the import of a neighbor whose prefix set from a registry fetches other prefixes", async () => {
    const adapter = Platforms.get("fortios");
    const renderWith = async (prefixes: string[]) => {
        const fetch = spyOn(Registries, "prefixes").mockResolvedValue(prefixes);
        try {
            return adapter.render(await Registries.resolve(firewall));
        } finally {
            fetch.mockRestore();
        }
    };

    const current = await renderWith(["192.0.2.0/25"]);
    const steps = adapter.plan(await renderWith(["192.0.2.0/25", "192.0.2.128/25"]), current, { secrets: false, rollback: 10 }).steps;

    expect(steps.map((step) => step.title)).toEqual(["router prefix-list", "router bgp, soft clear"]);
    expect(steps.at(-1)!.send).toEqual(["execute router clear bgp ip 203.0.113.9 soft in"]);
});

// The device refuses to delete an OSPF area while a network names it: `could not delete this area; it is used by network 1`.
test("FortiOS empties OSPF's networks before its areas", () => {
    const current = [
        "config router ospf",
        "    config area",
        "        edit 0.0.0.0",
        "        next",
        "    end",
        "    config network",
        "        edit 1",
        "            set prefix 192.0.2.128 255.255.255.192",
        "        next",
        "    end",
        "end",
    ];

    const sent = fortiosPlan(["config router ospf", "end"], current).steps.flatMap((step) => step.send);
    expect(sent.indexOf("delete 1")).toBeLessThan(sent.indexOf("delete 0.0.0.0"));
});

// Until a tunnel states its family, the device knows no `remote-gw6` or `remote-ip6`.
test("a FortiOS tunnel between IPv6 endpoints states its family first", () => {
    const device: Device = {
        ...firewall,
        interfaces: {
            ...firewall.interfaces,
            gre: {
                ...firewall.interfaces?.gre,
                partner: { local_address: "2001:db8:fff0::2", remote_address: "2001:db8:ffff::220", addresses: ["2001:db8:ffee::1/64"] },
            },
            vxlan: {
                ...firewall.interfaces?.vxlan,
                stretch: { vni: 5000, local_address: "2001:db8:fff0::2", remote_address: "2001:db8:ffff::221" },
            },
        },
    };

    const rendered = FortiOsTree.parse(Platforms.get("fortios").render(device));
    const settings = (section: string, name: string) => [...rendered.blocks.get(section)!.entries.get(name)!.block.settings.keys()];

    expect(settings("system gre-tunnel", "partner")).toEqual(["interface", "ip-version", "remote-gw6", "local-gw6"]);
    expect(settings("system vxlan", "stretch")).toEqual(["interface", "vni", "ip-version", "remote-ip6"]);
    expect(Platforms.get("fortios").unsupported(device)).toEqual([]);
});

// A PEM file saved on Windows ends its lines with CR LF; the CLI takes each CR as a line of its own and refuses the key.
test("a FortiOS secret is sent with plain line endings", () => {
    process.env.CIRCUIT_TEST_PEM = "-----BEGIN PRIVATE KEY-----\r\nMIIE\r\n-----END PRIVATE KEY-----\r\n";
    expect(FortiOs.withSecrets('set private-key "<secret:CIRCUIT_TEST_PEM>"')).toBe(
        'set private-key "-----BEGIN PRIVATE KEY-----\nMIIE\n-----END PRIVATE KEY-----\n"'
    );
    delete process.env.CIRCUIT_TEST_PEM;
});

// NTP serves only on the interfaces it lists: `There aren't any interfaces with NTP server enabled`. A DNS server entry is named after its interface.
test("FortiOS lets go of an interface named by NTP or by a DNS server entry before it joins a LAG", () => {
    const port = ['    edit "port1"', '        set vdom "root"', "        set type physical", "    next"];
    const lag = ['    edit "uplink"', '        set vdom "root"', "        set type aggregate", '        set member "port1"', "    next"];
    const ntp = (name: string) => ["config system ntp", "    set server-mode enable", `    set interface "${name}"`, "end"];

    const dns = (name: string) => ["config system dns-server", `    edit "${name}"`, "    next", "end"];

    const desired = ["config system interface", ...port, ...lag, "end", ...dns("uplink"), ...ntp("uplink")];
    const current = ["config system interface", ...port, "end", ...dns("port1"), ...ntp("port1")];

    const sent = fortiosPlan(desired, current).steps.flatMap((step) => step.send);
    expect(sent.slice(0, 6)).toEqual([
        "config system ntp",
        "unset server-mode",
        "end",
        "config system dns-server",
        'delete "port1"',
        "end",
    ]);
    expect(sent).toContain("set server-mode enable");
});

// Leaving transparent mode needs an address and an interface the config doesn't give.
test("a FortiOS device leaving transparent mode is a problem, not a plan", () => {
    const transparent = ["config system settings", "    set opmode transparent", "    set manageip 169.254.0.1/255.255.255.255", "end"];
    const plan = fortiosPlan(["config system settings", "end"], transparent);
    expect(plan.problems.length).toBe(1);
});

// An address taken out of a FortiGate's subnet and routed elsewhere. The FortiGate answers ARP for it there.
test("a FortiOS proxy ARP entry is rendered only when written, and removed when the config drops it", () => {
    const adapter = Platforms.get("fortios");
    const [name, iface] = Object.entries(firewall.interfaces!.vlan_interface!)[0]!;
    const address = (iface!.addresses![0] as string).replace(/\/\d+$/, "") as IPv4;
    const withProxy = adapter.render({
        ...firewall,
        interfaces: {
            ...firewall.interfaces,
            vlan_interface: { ...firewall.interfaces!.vlan_interface, [name]: { ...iface!, proxy_arp: [address] } },
        },
    });
    const without = adapter.render(firewall);

    expect(without).not.toContain("config system proxy-arp");
    expect(withProxy).toContain("config system proxy-arp");
    expect(withProxy).toContain(`set ip ${address}`);

    const removal = adapter.plan(without, withProxy, { secrets: false, rollback: 10 }).steps.flatMap((step) => step.send);
    expect(removal).toContain("config system proxy-arp");
    expect(removal).toContain("delete 1");
});
