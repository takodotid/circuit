// A plan sends only what changed, in the form each device accepts: what it prints differently is no change, and what it keeps for itself is never touched.

import { expect, test } from "bun:test";
import { Platforms } from "../../src/platforms";
import { FortiOsFirewall } from "../../src/platforms/fortios/firewall";
import { FortiOs } from "../../src/platforms/fortios/index";
import { FortiOsTree } from "../../src/platforms/fortios/tree";
import aggregationSwitch from "../../examples/aggregation-switch";
import coreSwitch from "../../examples/core-switch";
import firewall from "../../examples/firewall";
import router from "../../examples/router";

// The forms a Raisecom switch prints, seen on a RAX721: an access group with its notify view, an SNMPv3 user as localized keys, and `portswitch` on a switched LAG.
test("example-core-switch plans nothing against how the device prints it", () => {
    const adapter = Platforms.get("raisecom-ros");
    const rendered = adapter.render(coreSwitch);
    const printed = rendered
        .replace(
            /^snmp-server access (\S+) read internet usm authpriv$/m,
            "snmp-server access $1 read internet notify internet usm authpriv"
        )
        .replace(
            /^snmp-server user (\S+) authentication sha \S+ privacy aes128 \S+$/m,
            "snmp-server user $1 authkey sha <redacted> privkey  aes128 <redacted>"
        )
        .replace(/^interface port-channel (\d+)$/m, "interface port-channel $1\nportswitch");

    expect(printed).not.toEqual(rendered);

    const plan = adapter.plan(rendered, printed, { secrets: false, rollback: 10 });
    expect(plan.steps.flatMap((step) => step.show)).toEqual([]);
});

// The device refuses `no storm-control mode`, so a port leaving pps goes back to kbps, its default.
test("a Raisecom port leaving storm control in pps returns to kbps", () => {
    const adapter = Platforms.get("raisecom-ros");
    const current = ["interface tengigabitethernet 1/3/12", "storm-control mode pps", "storm-control broadcast pps 1000"].join("\n");
    const desired = ["interface tengigabitethernet 1/3/12", "shutdown"].join("\n");

    const sent = adapter.plan(desired, current, { secrets: false, rollback: 10 }).steps.flatMap((step) => step.send);
    expect(sent).toContain("storm-control mode kbps");
    expect(sent).not.toContain("no storm-control mode");
});

// A port set back to auto prints it, though auto is the default, and the device refuses `no duplex auto`.
test("a Raisecom port's speed and duplex at auto plan nothing", () => {
    const adapter = Platforms.get("raisecom-ros");
    const desired = ["interface tengigabitethernet 1/3/12", "shutdown"].join("\n");
    const current = ["interface tengigabitethernet 1/3/12", "duplex auto", "speed auto", "shutdown"].join("\n");

    expect(adapter.plan(desired, current, { secrets: false, rollback: 10 }).steps).toEqual([]);
});

// Undoing a whole VLAN list line deletes VLANs still in use, which a switch refuses; only the change is sent.
test("a VLAN list change sends only the VLANs added and removed", () => {
    const options = { secrets: false, rollback: 10 };

    const vrp = Platforms.get("vrp").plan("vlan batch 10 20 to 21 127\n", "vlan batch 10 20 to 22 99\n", options);
    expect(vrp.steps.flatMap((step) => step.send)).toEqual(["undo vlan batch 22 99", "vlan batch 127"]);

    const raisecom = Platforms.get("raisecom-ros").plan("create vlan 10,20-21,127 active\n", "create vlan 10,20-22,99 active\n", options);
    expect(raisecom.steps.flatMap((step) => step.send)).toEqual(["no vlan 22", "no vlan 99", "create vlan 127 active"]);
});

test("untracked prefixes skip connection tracking both ways, in their own family", async () => {
    const rendered = Platforms.get("routeros").render({
        ...router,
        firewall: { ...router.firewall, untracked: ["198.51.100.64/27", "2001:db8:100::/48"] },
    });

    expect(rendered).toContain(
        [
            "/ip firewall raw",
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

// A peer's name is unique on the device, so a new key for the same peer must change the peer, not add another under its name.
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

// Seen on a CE6855 on V200R005 after its first SNMPv3 user: an engine ID of its own, and the user's own line before its settings.
test("a VRP SNMPv3 user plans nothing against how the switch prints it", () => {
    const adapter = Platforms.get("vrp");
    const wanted = "snmp-agent\nsnmp-agent usm-user v3 monitoring\nsnmp-agent usm-user v3 monitoring group circuit\n";
    const printed =
        "snmp-agent\nsnmp-agent local-engineid 800007DB03E8ABF39705B1\nsnmp-agent usm-user v3 monitoring\nsnmp-agent usm-user v3 monitoring group circuit\n";

    expect(adapter.plan(wanted, printed, { secrets: false, rollback: 10 }).steps.flatMap((step) => step.show)).toEqual([]);
});

// The forms a Junos switch prints, seen on a QFX5100 running 21.4: secrets hashed or encrypted, values quoted where the render does not quote them, the release and each user's number.
test("example-aggregation-switch plans nothing against how the device prints it", () => {
    const adapter = Platforms.get("junos");
    const rendered = adapter.render(aggregationSwitch);
    const printed = [
        "set version 21.4R3-S8.5",
        "set system login user netops uid 2001",
        ...rendered
            .trim()
            .split("\n")
            .map((line) =>
                line
                    .replace(/plain-text-password-value \S+/, "encrypted-password <redacted>")
                    .replace(/authentication-password \S+/, "authentication-key <redacted>")
                    .replace(/privacy-password \S+/, "privacy-key <redacted>")
                    .replace(/^set snmp community \S+/, "set snmp community <redacted>")
                    .replace(/^set snmp contact (\S+)$/, 'set snmp contact "$1"')
            ),
    ].join("\n");

    expect(printed).not.toEqual(rendered);

    const plan = adapter.plan(rendered, printed, { secrets: false, rollback: 10 });
    expect(plan.steps.flatMap((step) => step.show)).toEqual([]);
});

// A service allowed only from IPv4 is refused over IPv6, not opened to every IPv6 source.
test("a Junos service allowed from one family is discarded in the other", () => {
    const adapter = Platforms.get("junos");
    const rendered = adapter.render({ ...aggregationSwitch, management: { allow: ["192.0.2.0/24"], ssh: {} } });
    const v6 = rendered.split("\n").filter((line) => line.includes("circuit-services-v6 term ssh"));

    expect(v6.length).toBeGreaterThan(0);
    expect(v6.every((line) => line.includes("term ssh-others"))).toBe(true);
});

// The device refuses `delete interfaces xe-0/0/1 unit`: a named list goes entry by entry, while a block the render does not hold goes whole.
test("a Junos removal stops at an entry of a named list, never at the list", () => {
    const adapter = Platforms.get("junos");
    const desired = "set interfaces xe-0/0/1 description Host\n";
    const current = [
        "set interfaces xe-0/0/1 description Host",
        "set interfaces xe-0/0/1 unit 0 family ethernet-switching vlan members default",
        "set vlans default vlan-id 1",
        "set protocols lldp-med interface all",
    ].join("\n");

    const sent = adapter.plan(desired, current, { secrets: false, rollback: 10 }).steps.flatMap((step) => step.send);
    expect(sent).toEqual(["delete interfaces xe-0/0/1 unit 0", "delete vlans", "delete protocols"]);
});

// A community is named by its value, which the read redacts: a new one is sent after the device's are deleted, each named in the session.
test("a rotated Junos community clears the device's communities first", () => {
    const adapter = Platforms.get("junos");
    const desired = "set snmp community <secret:COMMUNITY> authorization read-only\n";
    const current = "set snmp community <redacted> authorization read-only\n";

    expect(adapter.plan(desired, current, { secrets: false, rollback: 10 }).steps).toEqual([]);

    const sent = adapter.plan(desired, current, { secrets: true, rollback: 10 }).steps.flatMap((step) => step.send);
    expect(sent).toEqual(["delete snmp community <redacted>", "set snmp community <secret:COMMUNITY> authorization read-only"]);
});

test("a deactivated Junos statement the render wants is activated", () => {
    const adapter = Platforms.get("junos");
    const desired = "set protocols lldp interface all\n";
    const current = "set protocols lldp interface all\ndeactivate protocols lldp\n";

    const sent = adapter.plan(desired, current, { secrets: false, rollback: 10 }).steps.flatMap((step) => step.send);
    expect(sent).toEqual(["activate protocols lldp"]);
});

// Junos keeps a policy's terms in order and adds a new one at the end, so a rule inserted in the middle rewrites the policy whole.
test("a Junos policy that changes is deleted and set again in order", () => {
    const adapter = Platforms.get("junos");
    const term = (name: string, action: string) => `set policy-options policy-statement in term ${name} then ${action}`;
    const current = [term("1", "reject"), term("2", "accept")].join("\n");
    const desired = [term("1", "reject"), term('"2 New"', "reject"), term("3", "accept")].join("\n");

    const sent = adapter.plan(desired, current, { secrets: false, rollback: 10 }).steps.flatMap((step) => step.send);
    expect(sent).toEqual(["delete policy-options policy-statement in", ...desired.split("\n")]);
});

// A prefix list `refresh` fills keeps what the device holds, and the device prints an empty list only while it has no entries.
test("a Junos prefix list a registry fills keeps its entries", () => {
    const adapter = Platforms.get("junos");
    const desired = "set policy-options prefix-list customer\n# generated policy-options prefix-list customer\n";
    const current = "set policy-options prefix-list customer 198.18.0.0/16\nset policy-options prefix-list customer 198.19.0.0/16\n";

    expect(adapter.plan(desired, current, { secrets: false, rollback: 10 }).steps).toEqual([]);
});

// The forms a FortiGate prints, seen on a 3700D running 6.2.2: settings in an order of its own, passwords as ciphers, an object's UUID and an interface's SNMP index, a default it does not print, and factory objects beside ours.
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
    Platforms.get("fortios").plan(desired.join("\n") + "\n", current.join("\n") + "\n", { secrets, rollback: 10 });

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

// The device refuses a static route the same as another, `Duplicated entry`, so editing route 1 into what route 2 holds fails before route 2 moves on.
test("FortiOS deletes changing static routes before it creates any", () => {
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

    const sent = fortiosPlan(desired, current).steps.flatMap((step) => step.send);
    const firstCreate = sent.indexOf("edit 1");

    expect(sent.slice(0, 4)).toEqual(["config router static", "delete 1", "delete 2", "delete 3"]);
    expect(firstCreate).toBeGreaterThan(sent.indexOf("delete 3"));
});

// NTP refuses to delete its last server while it synchronises, and `unset type` hides the servers without deleting them.
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

// A password cannot be read back, so it is sent with a new user or when `secrets` asks for it.
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

// Who reaches the device's services is decided ahead of the input chain: each service accepts its sources and refuses everyone else.
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

// `refresh` fills a prefix list from a registry; a plan keeps what it put there.
test("a FortiOS prefix list a registry fills keeps its entries", () => {
    const list = (rules: string[]) => [
        "config router prefix-list",
        '    edit "upstream-origins"',
        '        set comments "Filled by circuit refresh from ripe-stat AS64501"',
        ...rules,
        "    next",
        "end",
    ];

    const current = list([
        "        config rule",
        "            edit 1",
        "                set prefix 198.18.0.0 255.254.0.0",
        "            next",
        "        end",
    ]);

    expect(fortiosPlan(list([]), current).steps).toEqual([]);

    // Until it is filled, the list refuses every prefix; once filled, each prefix matches what is more specific too.
    const rendered = FortiOsTree.parse(Platforms.get("fortios").render(firewall));
    const placeholder = rendered.blocks.get("router prefix-list")!.entries.get("upstream-origins")!.block.blocks.get("rule")!;
    expect([...placeholder.entries.values()].map(({ block }) => Object.fromEntries(block.settings))).toEqual([
        { prefix: "0.0.0.0 0.0.0.0", ge: FortiOsTree.UNSET, le: "32", action: "deny" },
    ]);
    expect(FortiOs.fillLines("upstream-origins", "ipv4", ["198.18.0.0/15"])).toContain("set le 32");
});

// A port given no protocol is matched on TCP and UDP alike.
test("a FortiOS service without a protocol covers TCP and UDP", () => {
    const service = FortiOsFirewall.serviceOf({ dst_port: 53 }, "ipv4");
    expect(service.name).toBe("tcp+udp/53");
    expect(Object.fromEntries(service.block!.settings)).toEqual({ "tcp-portrange": "53", "udp-portrange": "53" });
});

// Two interfaces that are up cannot hold overlapping subnets: an address leaves its old interface first.
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

// An OSPF area is refused while a network names it: `could not delete this area; it is used by network 1`.
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

// Between IPv6 endpoints a tunnel states its family first: until then the device knows no `remote-gw6` or `remote-ip6`.
test("a FortiOS tunnel between IPv6 endpoints states its family first", () => {
    const device = {
        ...firewall,
        interfaces: {
            ...firewall.interfaces,
            partner: { type: "gre", local: "2001:db8:fff0::2", remote: "2001:db8:ffff::220", addresses: ["2001:db8:ffee::1/64"] },
            stretch: { type: "vxlan", vni: 5000, local: "2001:db8:fff0::2", remote: "2001:db8:ffff::221" },
        },
    } as typeof firewall;

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

// NTP serves only on interfaces it names, `There aren't any interfaces with NTP server enabled`, and a DNS server entry is named after its interface.
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

// Leaving transparent mode needs an address and an interface the config does not give, so the plan stops and says so.
test("a FortiOS device leaving transparent mode is a problem, not a plan", () => {
    const transparent = ["config system settings", "    set opmode transparent", "    set manageip 169.254.0.1/255.255.255.255", "end"];
    const plan = fortiosPlan(["config system settings", "end"], transparent);
    expect(plan.problems.length).toBe(1);
});

// CloudEngine refuses `undo ssh server key-exchange` with the algorithms after it.
test("removing an SSH algorithm list on VRP sends the undo without the algorithms", () => {
    const options = { secrets: false, rollback: 10 };
    const current = "ssh server hmac sha2_256 sha1\nssh server key-exchange dh_group_exchange_sha1 ecdh_sha2_nistp256\n";

    const sent = Platforms.get("vrp")
        .plan("", current, options)
        .steps.flatMap((step) => step.send);
    expect(sent).toEqual(expect.arrayContaining(["undo ssh server hmac", "undo ssh server key-exchange"]));
});
