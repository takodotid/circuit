// A FortiGate keeps each policy under the number it was created with, whatever its place. A plan finds a rule by what it holds, or by its description, so adding or removing a rule changes no other policy, and every rule the config keeps stays on the device through the change.

import { expect, test } from "bun:test";
import firewall from "../../examples/platforms/fortios";
import { Platforms } from "../../src/platforms";
import { FortiOsBlock, FortiOsTree } from "../../src/platforms/fortios/tree";
import type { Plan } from "../../src/platforms/platform";
import type { Device, FilterRule, NatRule } from "../../src/schema";

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

/** The device with the rules of one chain changed. */
function withRules(device: Device, chain: "forward" | "input", change: (rules: FilterRule<string, string>[]) => void): Device {
    const filter = device.firewall?.filter;
    const rules = [...(filter?.[chain]?.rules ?? [])];
    change(rules);

    return { ...device, firewall: { ...device.firewall, filter: { ...filter, [chain]: { ...filter?.[chain], rules } } } };
}

/** The device with its source NAT rules changed. */
function withSourceNat(device: Device, change: (rules: NatRule<string, string>[]) => void): Device {
    const nat = device.firewall?.nat;
    const source = [...(nat?.source ?? [])];
    change(source);

    return { ...device, firewall: { ...device.firewall, nat: { ...nat, source } } };
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
        withSourceNat(base, (rules) => rules.unshift(LAB_OUT))
    );
    expect(entryLines(top, "firewall central-snat-map")).toEqual(["edit 3", "move 3 before 1"]);

    const middle = planned(
        base,
        withSourceNat(base, (rules) => rules.splice(1, 0, LAB_OUT))
    );
    expect(entryLines(middle, "firewall central-snat-map")).toEqual(["edit 3", "move 3 after 1"]);

    const removed = planned(
        base,
        withSourceNat(base, (rules) => rules.splice(0, 1))
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
