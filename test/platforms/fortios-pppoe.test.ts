// PPPoE clients on FortiOS. The device's answers copy tako-fwl-01 (FG-3700D, 6.2.2), in a VDOM of its own over an aggregate with no ports.

import { expect, test } from "bun:test";
import type { Device, PppoeClient } from "../../src/model";
import { FortiOs } from "../../src/platforms/fortios";

const platform = new FortiOs();
const options = { secrets: false, rollback: 10 };

const INTERNET: PppoeClient = {
    interface: "10g-1",
    description: "Hurricane Electric",
    user: "branch-1",
    password: { secret: "ISP_PASSWORD" },
    service_name: "as6939",
};

/** A firewall with these PPPoE clients and their default route, and a management VDOM when asked. */
function firewall(clients: Record<string, PppoeClient>, management = false): Device {
    return {
        name: "fw-01",
        site: "lab",
        platform: "fortios",
        model: "FG-3700D",
        connection: { host: "127.0.0.1", user: "netops" },
        system: {
            users: { netops: { role: "admin", password: { secret: "EXAMPLE_NETOPS_PASSWORD" } } },
            ...(management && { vdoms: { management: { name: "mgmt", interfaces: ["1g-1"] } } }),
        },
        interfaces: {
            ethernet: {
                "1g-1": { description: "Out-of-band", addresses: ["192.0.2.4/24"] },
                "10g-1": { description: "ONT" },
                "10g-2": { description: "Office", addresses: ["198.51.100.1/24"] },
            },
            pppoe_client: clients,
        },
        routing: {
            vrfs: { internet: {} },
            static_routes: Object.entries(clients).map(([name, client]) => ({
                prefix: "0.0.0.0/0",
                interface: name,
                ...(client.vrf && { vrf: client.vrf }),
            })),
        },
    };
}

test("a client is an entry of system pppoe-interface, whose interface takes no default route from the server", () => {
    const rendered = platform.render(firewall({ internet: { ...INTERNET, slaac: true, vrf: "internet" } }));

    expect(rendered).toContain(
        [
            "config system pppoe-interface",
            '    edit "internet"',
            "        set ipv6 enable",
            '        set device "port5"',
            '        set username "branch-1"',
            '        set password "<secret:ISP_PASSWORD>"',
            '        set service-name "as6939"',
            "    next",
            "end",
        ].join("\n")
    );
    expect(rendered).toContain(
        [
            '    edit "internet"',
            '        set vdom "root"',
            "        set vrf 1",
            "        set mode pppoe",
            "        set type tunnel",
            '        set description "Hurricane Electric"',
            "        set defaultgw disable",
            '        set interface "port5"',
            "        set icmp-send-redirect disable",
            "        config ipv6",
            "            set autoconf enable",
            "        end",
            "    next",
        ].join("\n")
    );
    expect(rendered).toContain('config router static\n    edit 1\n        set device "internet"');
    expect(platform.experimental(firewall({ internet: INTERNET }))).toContain("interfaces.pppoe_client.internet");
    expect(platform.unsupported(firewall({ internet: INTERNET }))).toEqual([]);
});

test("the client's interface is changed after the entry makes it, and goes with the entry, after the route through it", () => {
    const desired = platform.render(firewall({ internet: INTERNET }));
    const current = platform.render(firewall({}));

    const added = platform.plan(desired, current, options);
    expect(added.steps.map((step) => step.title)).toEqual(["system pppoe-interface", "system interface, tunnels", "router static"]);
    expect(added.steps[1]!.send).toContain("set defaultgw disable");
    expect(platform.plan(desired, desired, options).steps).toEqual([]);

    const removed = platform.plan(current, desired, options);
    expect(removed.steps.map((step) => step.title)).toEqual(["router static", "system pppoe-interface, removed"]);
    expect(removed.steps[1]!.send).toEqual(["config system pppoe-interface", 'delete "internet"', "end"]);
});

test("with several VDOMs the entry is root's and its interface global, as on tako-fwl-01", () => {
    const desired = platform.render(firewall({ internet: INTERNET }, true));
    const current = platform.render(firewall({}, true));

    const plan = platform.plan(desired, current, options);
    expect(plan.problems).toEqual([]);
    expect(plan.steps.map((step) => step.title)).toEqual([
        "root: system pppoe-interface",
        "root: router static",
        "system interface, tunnels",
    ]);
    expect(plan.steps[0]!.send.slice(0, 3)).toEqual(["config vdom", "edit root", "config system pppoe-interface"]);
    expect(plan.steps[2]!.send.slice(0, 2)).toEqual(["config global", "config system interface"]);
    expect(platform.plan(desired, desired, options).steps).toEqual([]);
});

test("IPv6 turned off on a session is turned off on the entry alone: the device hides the interface's IPv6 settings then", () => {
    const desired = platform.render(firewall({ internet: INTERNET }));
    const current = platform.render(firewall({ internet: { ...INTERNET, slaac: true } }));

    const sent = platform.plan(desired, current, options).steps.flatMap((step) => step.send);
    expect(sent).toEqual(["config system pppoe-interface", 'edit "internet"', "unset ipv6", "next", "end"]);
});

test("FortiOS refuses an MTU, a delegated prefix, an IPv6 route through a client, a long name, and a client in the management VDOM", () => {
    const device = firewall(
        {
            internet: { ...INTERNET, mtu: 1492, prefix_delegation: { interfaces: { "10g-2": "::1" } } },
            "hurricane-electric": INTERNET,
            oob: { ...INTERNET, interface: "1g-1" },
        },
        true
    );
    device.routing!.static_routes = [{ prefix: "::/0", interface: "internet" }];

    expect(platform.unsupported(device)).toEqual([
        "interfaces.pppoe_client.hurricane-electric, a name longer than 15 characters",
        "interfaces.pppoe_client.internet.mtu, FortiOS's PPPoE interface takes no MTU: `set mtu` is `command parse error`",
        "interfaces.pppoe_client.internet.prefix_delegation, not built for FortiOS: it gives an interface a /64 of a delegated prefix only by the /64's place in the prefix, `ip6-subnet`, which the config doesn't write",
        "interfaces.pppoe_client.oob, 1g-1 in system.vdoms.management: a PPPoE client goes in root",
        "routing.static_routes ::/0, through interfaces.pppoe_client.internet: FortiOS 6.2 takes no IPv6 route through a PPPoE interface",
    ]);
});
