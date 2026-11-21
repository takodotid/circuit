// NAT64 (RFC 6146) is a VDOM's `system nat64`, with its prefix, and a NAT64 policy for each rule. The VDOM's DNS server is DNS64 (RFC 6147) whenever NAT64 is on there.

import type { Device, Finding, NatRule } from "../../model";
import { FortiOsFirewall } from "./firewall";
import { FortiOsNames } from "./names";
import type { FortiOsNode } from "./tree";
import { FortiOsTree } from "./tree";

/** A NAT64 rule, to one address or to a pool. */
type Nat64Rule = NatRule & { then: "nat64" };

export class FortiOsNat64 {
    /** The one NAT64 prefix length FortiOS 6.2 translates, as its CLI reference says of `nat64-prefix`: "must be ::/96". */
    private static readonly PREFIX_LENGTH = 96;

    /** The NAT64 rules of `firewall.nat.source`, each with its place in the list. */
    static rules(device: Device): { rule: Nat64Rule; index: number }[] {
        return (device.firewall?.nat?.source ?? []).flatMap((rule, index) =>
            rule.then === "nat64" ? [{ rule: rule as Nat64Rule, index }] : []
        );
    }

    /** The NAT64 prefix of a rule: its `if.dst`. */
    private static prefixOf(rule: Nat64Rule): string | undefined {
        const dst = FortiOsNames.single(rule.if?.dst);
        return dst && FortiOsNames.network(dst);
    }

    /** The prefixes the config gives NAT64 and DNS64, once each. */
    private static prefixes(device: Device): string[] {
        const dns64 = device.services?.dns64?.prefix;
        const all = [...FortiOsNat64.rules(device).map(({ rule }) => FortiOsNat64.prefixOf(rule)), dns64 && FortiOsNames.network(dns64)];
        return [...new Set(all.filter((prefix): prefix is string => prefix !== undefined))];
    }

    /**
     * NAT64 on, with the prefix, and a NAT64 policy for each rule, in order. Each policy also lets its traffic through: FortiOS checks NAT64 traffic against NAT64 policies alone. DNS64 answers as RFC 6147 asks, with a real AAAA record when the name has one.
     */
    static render(root: FortiOsNode, device: Device): void {
        const [prefix] = FortiOsNat64.prefixes(device);
        if (!prefix) return;

        const settings = root.block("system nat64").set("status", "enable").set("nat64-prefix", prefix);
        if (device.services?.dns64) settings.set("always-synthesize-aaaa-record", "disable");

        const rules = FortiOsNat64.rules(device);
        if (!rules.length) return;

        const objects = FortiOsFirewall.objects(root, device);
        const policies = root.block("firewall policy64");

        rules.forEach(({ rule }, number) => {
            const match = rule.if;
            const entry = policies.entry(number + 1);
            const pool = "to_pool" in rule ? objects.blockPool(rule) : objects.pool(rule.to_address);

            entry.set("srcintf", FortiOsFirewall.interfaceOf(device, FortiOsNames.single(match?.in_interface)));
            entry.set("dstintf", FortiOsFirewall.interfaceOf(device, FortiOsNames.single(match?.out_interface)));
            entry.set("srcaddr", FortiOsTree.quote(objects.address(FortiOsNames.single(match?.src), match?.src_address_set, "ipv6")));
            // The IPv4 destination is whatever the address in the prefix holds.
            entry.set("dstaddr", FortiOsTree.quote("all"));
            entry.set("action", "accept");
            entry.set("schedule", FortiOsTree.quote("always"));
            entry.set("service", FortiOsTree.quote("ALL"));
            // Pools on, then the pool's name: the order the FG-3700D took.
            entry.set("ippool", "enable");
            entry.set("poolname", FortiOsTree.quote(pool));
            if (rule.description) entry.set("comments", FortiOsTree.quote(rule.description));
        });
    }

    /** What FortiOS can't express of NAT64 and DNS64. A pool's limits are `firewall.nat.source`'s. */
    static gaps(device: Device): string[] {
        const found: string[] = [];
        const rules = FortiOsNat64.rules(device);

        for (const { rule, index } of rules) {
            const where = `firewall.nat.source[${index}]`;
            const prefix = FortiOsNat64.prefixOf(rule);
            if (prefix && !prefix.endsWith(`/${FortiOsNat64.PREFIX_LENGTH}`))
                found.push(`${where}.if.dst ${prefix}, FortiOS 6.2 takes a NAT64 prefix of /${FortiOsNat64.PREFIX_LENGTH} only`);

            for (const field of ["protocol", "src_port", "dst_port"] as const)
                if (rule.if?.[field] !== undefined) found.push(`${where}.if.${field}, a NAT64 policy here translates every protocol`);
        }

        const dns64 = device.services?.dns64;
        if (dns64 && !FortiOsNames.network(dns64.prefix).endsWith(`/${FortiOsNat64.PREFIX_LENGTH}`))
            found.push(`services.dns64.prefix ${dns64.prefix}, FortiOS 6.2 takes a NAT64 prefix of /${FortiOsNat64.PREFIX_LENGTH} only`);

        const prefixes = FortiOsNat64.prefixes(device);
        const holders = dns64 ? "firewall.nat.source and services.dns64" : "firewall.nat.source";
        if (prefixes.length > 1)
            found.push(
                `${holders}, NAT64 prefixes ${prefixes.join(", ")}: a VDOM has one, which NAT64 and DNS64 share. Write the same prefix in each`
            );

        // The DNS server builds AAAA records whenever NAT64 is on, which only DNS64 says.
        if (rules.length && device.services?.dns_server && !dns64)
            found.push(
                `services.dns_server beside a nat64 rule, without services.dns64: FortiOS's DNS server is DNS64 whenever NAT64 is on. Write services.dns64 with the rule's prefix`
            );

        return found;
    }

    /** The forward chain's rules don't see NAT64 traffic here, which a NAT64 policy alone lets through (Fortinet's 6.0 handbook, NAT64 and DNS64). */
    static warnings(device: Device): Finding[] {
        const forward = device.firewall?.filter?.forward;
        const filters = Boolean(forward?.rules?.length) || forward?.default_action === "drop";
        if (!filters || !FortiOsNat64.rules(device).length) return [];

        return [
            {
                level: "warning",
                device: device.name,
                message:
                    "firewall.nat.source, nat64: FortiOS checks NAT64 traffic against NAT64 policies alone, so firewall.filter.forward doesn't filter it. A nat64 rule lets through what its if matches.",
            },
        ];
    }

    /** No traffic crossed a NAT64 policy, and no host asked the DNS server, on the FG-3700D where the config was applied. */
    static experimental(device: Device): string[] {
        const found = FortiOsNat64.rules(device).map(({ index }) => `firewall.nat.source[${index}].then nat64`);
        if (device.services?.dns64) found.push("services.dns64");
        return found;
    }
}
