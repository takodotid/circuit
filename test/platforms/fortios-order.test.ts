// A FortiGate keeps each policy, static route, ACL entry and virtual IP under the number it was created with, whatever its place. A plan finds an entry by what it holds, or by its description, so adding or removing one changes no other, and every entry the config keeps stays on the device through the change.

import { expect, test } from "bun:test";
import firewall from "../../examples/platforms/fortios";
import { Platforms } from "../../src/platforms";
import { FortiOsBlock, FortiOsTree } from "../../src/platforms/fortios/tree";
import type { Plan } from "../../src/platforms/platform";
import type { AclRule, Device, FilterRule, NatRule, StaticRoute } from "../../src/schema";

const platform = Platforms.get("fortios");
const options = { secrets: false, rollback: 10 };

/** The tables whose policies deny unless told otherwise. */
const DENY_BY_DEFAULT = ["firewall policy", "firewall policy6", "firewall local-in-policy", "firewall local-in-policy6"];

/** The example without its management guards, so the input chain's first rule is the first local-in policy. */
const base: Device = { ...firewall, management: {} };

const NO_TELNET: FilterRule<string, string> = { description: "No telnet", match: { protocol: "tcp", dst_port: 23 }, action: "drop" };
const SNMP: FilterRule<string, string> = { description: "SNMP", match: { protocol: "udp", dst_port: 161 }, action: "accept" };
const LAB_OUT: NatRule<string, string> = {
    description: "Lab out",
    match: { src: "198.51.100.192/27", out_interface: "uplink" },
    action: "masquerade",
};
const LAB_WEB: NatRule<string, string> = {
    description: "Lab web",
    match: { protocol: "tcp", dst: "203.0.113.13/32", dst_port: 443, in_interface: "uplink" },
    action: "dnat",
    to: "198.51.100.44",
};
const LAB_ROUTE: StaticRoute<string, string, string> = { prefix: "192.0.2.128/25", via: "203.0.113.9", description: "Lab" };
const LAB_ROUTE6: StaticRoute<string, string, string> = { prefix: "2001:db8:100::/48", via: "2001:db8:fff0::1", description: "Lab" };
const NO_CHARGEN: AclRule<string> = { description: "No chargen", match: { protocol: "udp", dst_port: 19 }, action: "drop" };

/** The device with the rules of one chain changed. */
function withRules(device: Device, chain: "forward" | "input", change: (rules: FilterRule<string, string>[]) => void): Device {
    const filter = device.firewall?.filter;
    const rules = [...(filter?.[chain]?.rules ?? [])];
    change(rules);

    return { ...device, firewall: { ...device.firewall, filter: { ...filter, [chain]: { ...filter?.[chain], rules } } } };
}

/** The device with its source or destination NAT rules changed. */
function withNat(device: Device, direction: "source" | "destination", change: (rules: NatRule<string, string>[]) => void): Device {
    const nat = device.firewall?.nat;
    const rules = [...(nat?.[direction] ?? [])];
    change(rules);

    return { ...device, firewall: { ...device.firewall, nat: { ...nat, [direction]: rules } } };
}

/** The device with its static routes changed. */
function withRoutes(device: Device, change: (routes: StaticRoute<string, string, string>[]) => void): Device {
    const routes = [...(device.routing?.static ?? [])];
    change(routes);

    return { ...device, routing: { ...device.routing, static: routes } };
}

/** The device with the rules of its ACL `lab` changed. */
function withAcl(device: Device, change: (rules: AclRule<string>[]) => void): Device {
    const rules = [...(device.acls?.lab ?? [])];
    change(rules);

    return { ...device, acls: { ...device.acls, lab: rules } };
}

/** A device's config as a FortiGate prints it: a policy that denies does not print its action. */
function printed(device: Device): string {
    const root = FortiOsTree.parse(platform.render(device));

    for (const section of DENY_BY_DEFAULT) {
        for (const { block } of root.blocks.get(section)?.entries.values() ?? []) {
            if (block.settings.get("action") === "deny") block.settings.delete("action");
        }
    }

    return FortiOsTree.print(root);
}

/** What a FortiGate holds after it runs a plan. An entry it does not have is created at the end of its table. */
function applied(current: string, plan: Plan): string {
    const root = FortiOsTree.parse(current);
    const stack = [root];

    for (const line of plan.steps.flatMap((step) => step.send)) {
        const block = stack.at(-1)!;
        const [, verb, rest = ""] = /^(\S+)\s*(.*)$/.exec(line)!;

        switch (verb) {
            case "config":
                stack.push(block.block(rest));
                break;

            case "edit": {
                const key = FortiOsTree.bare(rest);
                if (!block.entries.has(key)) block.entries.set(key, { id: rest, block: new FortiOsBlock() });
                stack.push(block.entries.get(key)!.block);
                break;
            }

            case "next":
            case "end":
                stack.pop();
                break;

            case "set": {
                const [key] = rest.split(" ", 1);
                block.set(key!, rest.slice(key!.length + 1));
                break;
            }

            case "unset":
                block.settings.delete(rest);
                break;

            case "delete":
                block.entries.delete(FortiOsTree.bare(rest));
                break;

            case "move": {
                const [id, where, other] = rest.split(" ");
                const entries = [...block.entries];
                const moved = entries.splice(
                    entries.findIndex(([key]) => key === id),
                    1
                );
                const at = entries.findIndex(([key]) => key === other);
                entries.splice(where === "before" ? at : at + 1, 0, ...moved);

                block.entries.clear();
                for (const [key, entry] of entries) block.entries.set(key, entry);
                break;
            }
        }
    }

    return FortiOsTree.print(root);
}

/** Plan `after` against a device running `before`. Planned again against what the device then holds, nothing is left. */
function planned(before: Device, after: Device): Plan {
    const current = printed(before);
    const plan = platform.plan(platform.render(after), current, options);

    expect(plan.problems).toEqual([]);
    expect(platform.plan(platform.render(after), applied(current, plan), options).steps).toEqual([]);
    return plan;
}

/** The lines of a plan that create, edit, move or delete an entry of one table, the deletions at the end included. */
function entryLines(plan: Plan, section: string): string[] {
    return plan.steps
        .filter((step) => step.title === section || step.title === `${section}, removed`)
        .flatMap((step) => step.send)
        .filter((line) => /^(?:edit|move|delete) /.test(line));
}

// A FortiGate that ran an earlier Circuit holds its policies numbered by their place.
test("a FortiGate numbered by an earlier Circuit plans nothing", () => {
    expect(platform.plan(platform.render(firewall), printed(firewall), options).steps).toEqual([]);
    expect(platform.plan(platform.render(base), printed(base), options).steps).toEqual([]);
});

// Policies 1 to 5 and IPv6 policies 1 and 2: servers out, guests out, guests to resolvers, no SMTP out, web in; the IPv4 ones of these are only in `firewall policy`.
test("a forward rule added or removed changes no other policy", () => {
    const top = planned(
        base,
        withRules(base, "forward", (rules) => rules.unshift(NO_TELNET))
    );
    expect(entryLines(top, "firewall policy")).toEqual(["edit 6", "move 6 before 1"]);
    expect(entryLines(top, "firewall policy6")).toEqual(["edit 3", "move 3 before 1"]);

    const middle = planned(
        base,
        withRules(base, "forward", (rules) => rules.splice(2, 0, NO_TELNET))
    );
    expect(entryLines(middle, "firewall policy")).toEqual(["edit 6", "move 6 after 1"]);
    expect(entryLines(middle, "firewall policy6")).toEqual(["edit 3", "move 3 after 1"]);

    const removed = planned(
        base,
        withRules(base, "forward", (rules) => rules.splice(1, 1))
    );
    expect(entryLines(removed, "firewall policy")).toEqual(["delete 1"]);
    expect(entryLines(removed, "firewall policy6")).toEqual(["delete 1"]);
    expect(removed.steps.map((step) => step.title)).toEqual(["firewall policy6, removed", "firewall policy, removed"]);
});

// Local-in policies 1 to 6 in each family: management, VRRP, OSPF, BGP, ping, and the input chain's drop, which has no description.
test("an input rule added or removed changes no other local-in policy", () => {
    const top = planned(
        base,
        withRules(base, "input", (rules) => rules.unshift(SNMP))
    );
    expect(entryLines(top, "firewall local-in-policy")).toEqual(["edit 7", "move 7 before 1"]);
    expect(entryLines(top, "firewall local-in-policy6")).toEqual(["edit 7", "move 7 before 1"]);

    const middle = planned(
        base,
        withRules(base, "input", (rules) => rules.splice(4, 0, SNMP))
    );
    expect(entryLines(middle, "firewall local-in-policy")).toEqual(["edit 7", "move 7 after 3"]);
    expect(entryLines(middle, "firewall local-in-policy6")).toEqual(["edit 7", "move 7 after 3"]);

    const removed = planned(
        base,
        withRules(base, "input", (rules) => rules.splice(1, 1))
    );
    expect(entryLines(removed, "firewall local-in-policy")).toEqual(["delete 1"]);
    expect(entryLines(removed, "firewall local-in-policy6")).toEqual(["delete 1"]);
});

// Central SNAT rules 1 and 2: guests out, servers out.
test("a source NAT rule added or removed changes no other", () => {
    const top = planned(
        base,
        withNat(base, "source", (rules) => rules.unshift(LAB_OUT))
    );
    expect(entryLines(top, "firewall central-snat-map")).toEqual(["edit 3", "move 3 before 1"]);

    const middle = planned(
        base,
        withNat(base, "source", (rules) => rules.splice(1, 0, LAB_OUT))
    );
    expect(entryLines(middle, "firewall central-snat-map")).toEqual(["edit 3", "move 3 after 1"]);

    const removed = planned(
        base,
        withNat(base, "source", (rules) => rules.splice(0, 1))
    );
    expect(entryLines(removed, "firewall central-snat-map")).toEqual(["delete 1"]);
});

// The management guards come first: policies 1 to 4, then the input chain's rules from 5.
test("an input rule added at the top of the chain goes after the management guards", () => {
    const plan = planned(
        firewall,
        withRules(firewall, "input", (rules) => rules.unshift(SNMP))
    );
    expect(entryLines(plan, "firewall local-in-policy")).toEqual(["edit 11", "move 11 after 4"]);
});

test("a rule that changes is edited under its own number, found by its description", () => {
    const after = withRules(base, "forward", (rules) => {
        rules[2] = { ...rules[2]!, match: { src: "198.51.100.64/27", out_interface: "uplink" } };
        rules.unshift(NO_TELNET);
    });

    const plan = planned(base, after);
    expect(entryLines(plan, "firewall policy")).toEqual(["edit 6", "edit 2", "move 6 before 1"]);
    expect(plan.steps.find((step) => step.title === "firewall policy")!.show).toContain('+ 2: set srcaddr "198.51.100.64/27"');
});

// Which of two rules sharing a description changed cannot be told, so neither is edited into the other.
test("rules sharing a description are created again when they change, and the old ones deleted last", () => {
    const policy = (id: number, source: string) => [
        `    edit ${id}`,
        `        set srcaddr "${source}"`,
        "        set action accept",
        '        set comments "Same"',
        "    next",
    ];

    const desired = ["config firewall policy", ...policy(1, "c"), ...policy(2, "d"), "end"].join("\n") + "\n";
    const current = ["config firewall policy", ...policy(1, "a"), ...policy(2, "b"), "end"].join("\n") + "\n";

    const plan = platform.plan(desired, current, options);
    expect(plan.steps.map((step) => step.title)).toEqual(["firewall policy", "firewall policy, removed"]);
    expect(entryLines(plan, "firewall policy")).toEqual(["edit 3", "edit 4", "delete 1", "delete 2"]);
});

// Static routes 1 to 4: the default route, our space, a route with no description, and the guests' default route; IPv6 route 1 is the default route, and the lab's route is the second.
test("a static route added or removed changes no other", () => {
    const top = planned(
        base,
        withRoutes(base, (routes) => routes.unshift(LAB_ROUTE))
    );
    expect(entryLines(top, "router static")).toEqual(["edit 5"]);
    expect(entryLines(top, "router static6")).toEqual([]);

    const middle = planned(
        base,
        withRoutes(base, (routes) => routes.splice(3, 0, LAB_ROUTE))
    );
    expect(entryLines(middle, "router static")).toEqual(["edit 5"]);

    const removed = planned(
        base,
        withRoutes(base, (routes) => routes.splice(2, 1))
    );
    expect(entryLines(removed, "router static")).toEqual(["delete 2"]);

    const before = withRoutes(base, (routes) => routes.push(LAB_ROUTE6));
    const ipv6 = { prefix: "2001:db8:200::/48", via: "2001:db8:fff0::1" } as const;

    expect(
        entryLines(
            planned(
                before,
                withRoutes(before, (routes) => routes.unshift(ipv6))
            ),
            "router static6"
        )
    ).toEqual(["edit 3"]);
    expect(
        entryLines(
            planned(
                before,
                withRoutes(before, (routes) => routes.splice(2, 0, ipv6))
            ),
            "router static6"
        )
    ).toEqual(["edit 3"]);
    expect(
        entryLines(
            planned(
                before,
                withRoutes(before, (routes) => routes.splice(1, 1))
            ),
            "router static6"
        )
    ).toEqual(["delete 1"]);
});

// The device refuses a static route the same as another, so one that changes is deleted, then created again under its own number.
test("a static route that changes is created again under its own number, found by its description", () => {
    const after = withRoutes(base, (routes) => {
        routes[2] = { ...routes[2]!, prefix: "198.51.100.0/25" };
        routes.unshift(LAB_ROUTE);
    });

    const plan = planned(base, after);
    expect(entryLines(plan, "router static")).toEqual(["delete 2", "edit 5", "edit 2"]);
});

// Virtual IPs dnat-1 and dnat-2: the web server, and mail for partners.
test("a destination NAT rule added or removed changes no other virtual IP", () => {
    const top = planned(
        base,
        withNat(base, "destination", (rules) => rules.unshift(LAB_WEB))
    );
    expect(entryLines(top, "firewall vip")).toEqual(['edit "dnat-3"']);

    const middle = planned(
        base,
        withNat(base, "destination", (rules) => rules.splice(1, 0, LAB_WEB))
    );
    expect(entryLines(middle, "firewall vip")).toEqual(['edit "dnat-3"']);

    const removed = planned(
        base,
        withNat(base, "destination", (rules) => rules.splice(0, 1))
    );
    expect(entryLines(removed, "firewall vip")).toEqual(['delete "dnat-1"']);
});

test("a virtual IP without a description is found by the address it answers on", () => {
    const undescribed = withNat(base, "destination", (rules) =>
        rules.forEach((rule, index) => (rules[index] = { ...rule, description: undefined }))
    );
    const after = withNat(undescribed, "destination", (rules) => {
        rules[0] = { ...rules[0]!, to: "198.51.100.45" } as NatRule<string, string>;
        rules.unshift(LAB_WEB);
    });

    const plan = planned(undescribed, after);
    expect(entryLines(plan, "firewall vip")).toEqual(['edit "dnat-3"', 'edit "dnat-1"']);
    expect(plan.steps.find((step) => step.title === "firewall vip")!.show).toContain('+ dnat-1: set mappedip "198.51.100.45"');
});

// Only a virtual IP named the way Circuit names them is kept, even when another holds the same.
test("a virtual IP named by hand is deleted, and the config's own is created beside the others", () => {
    const current = printed(base).replace('edit "dnat-1"', 'edit "web"');
    const plan = platform.plan(platform.render(base), current, options);

    expect(entryLines(plan, "firewall vip")).toEqual(['edit "dnat-3"', 'delete "web"']);
    expect(platform.plan(platform.render(base), applied(current, plan), options).steps).toEqual([]);
});

// ACL entries 1 and 2: spoofed sources and memcached; IPv6 entry 1: memcached.
test("an ACL rule added or removed changes no other ACL entry", () => {
    const top = planned(
        base,
        withAcl(base, (rules) => rules.unshift(NO_CHARGEN))
    );
    expect(entryLines(top, "firewall acl")).toEqual(["edit 3"]);
    expect(entryLines(top, "firewall acl6")).toEqual(["edit 2"]);

    const middle = planned(
        base,
        withAcl(base, (rules) => rules.splice(1, 0, NO_CHARGEN))
    );
    expect(entryLines(middle, "firewall acl")).toEqual(["edit 3"]);
    expect(entryLines(middle, "firewall acl6")).toEqual(["edit 2"]);

    const first = planned(
        base,
        withAcl(base, (rules) => rules.splice(0, 1))
    );
    expect(entryLines(first, "firewall acl")).toEqual(["delete 1"]);

    const memcached = planned(
        base,
        withAcl(base, (rules) => rules.splice(1, 1))
    );
    expect(entryLines(memcached, "firewall acl")).toEqual(["delete 2"]);
    expect(entryLines(memcached, "firewall acl6")).toEqual(["delete 1"]);
});
