// Hardware ACLs: an extended IPv4 list and an extended IPv6 list for each ACL, named after it with `-v4` and `-v6`, and `filter ingress access-list` on each switched port that takes it. Rules run in the order of their numbers. Each list ends with a rule that permits the rest, so what no rule matches is let through, whatever the firmware's own end is.

import { Address } from "../../core/address";
import { Derive } from "../../core/derive";
import type { AclRule, Device, Family, Ports, Protocol } from "../../model";

export class RaisecomRosAcls {
    /** The first number of each family's extended lists. The lists below take other kinds: 1000 standard IPv4, 3000 MAC, 6000 standard IPv6. */
    private static readonly FIRST: Record<Family, number> = { ipv4: 2001, ipv6: 7001 };

    /** The most lists of a kind, 2001 to 2999 and 7001 to 7999. */
    static readonly MAX_LISTS = 999;

    /** Rules are numbered in steps of 10, and the rule that permits the rest has the highest number the switch takes. */
    private static readonly STEP = 10;
    private static readonly LAST_RULE = 65_535;

    /** The longest list name the switch takes. Names are one for every list, so each family's list adds its own to the ACL's. */
    private static readonly NAME_LENGTH = 32;
    private static readonly SUFFIX: Record<Family, string> = { ipv4: "-v4", ipv6: "-v6" };

    /** A protocol as each family's list prints it: the switch prints 6, 17, 1, and 58 by name, and the rest as numbers. */
    private static readonly PROTOCOL: Record<Family, Record<Protocol, string>> = {
        ipv4: { tcp: "tcp", udp: "udp", icmp: "icmp", gre: "47", esp: "50", ah: "51", ospf: "89", vrrp: "112" },
        ipv6: { tcp: "tcp", udp: "udp", icmp: "icmpv6", gre: "47", esp: "50", ah: "51", ospf: "89", vrrp: "112" },
    };

    /** What a rule without a protocol matches. */
    private static readonly ANY: Record<Family, string> = { ipv4: "ip", ipv6: "ipv6" };

    /** The highest TCP or UDP port. */
    private static readonly LAST_PORT = 65_535;

    /** The list of `family` an ACL has, by its place in `switching.acls`, or none when it holds no rule of the family. */
    static number(device: Device, acl: string, family: Family): number | undefined {
        const names = Object.keys(device.switching?.acls ?? {});
        const rules = device.switching?.acls?.[acl];
        if (!rules || !RaisecomRosAcls.rulesOf(rules, family).length) return undefined;
        return RaisecomRosAcls.FIRST[family] + names.indexOf(acl);
    }

    /** Each ACL's lists, its IPv4 rules and then its IPv6 rules. */
    static blocks(device: Device): string[] {
        const lines: string[] = [];

        for (const [name, rules] of Object.entries(device.switching?.acls ?? {})) {
            for (const family of ["ipv4", "ipv6"] as const) {
                const number = RaisecomRosAcls.number(device, name, family);
                if (number === undefined) continue;

                const matches = RaisecomRosAcls.rulesOf(rules ?? [], family);
                lines.push(`access-list ${number} name ${name}${RaisecomRosAcls.SUFFIX[family]}`);
                matches.forEach((match, index) => lines.push(`  rule ${(index + 1) * RaisecomRosAcls.STEP} ${match}`));
                // The rest is let through. A rule that already matches every packet decides it, and the switch refuses a second one.
                const everything = `${RaisecomRosAcls.ANY[family]} any any`;
                if (!matches.some((match) => match.split(" ").slice(1).join(" ") === everything))
                    lines.push(`  rule ${RaisecomRosAcls.LAST_RULE} permit ${everything}`);
                lines.push("!");
            }
        }

        return lines;
    }

    /** A port's filters: each list of its ACL. */
    static portLines(device: Device, acl: string | undefined): string[] {
        if (!acl) return [];

        return (["ipv4", "ipv6"] as const).flatMap((family) => {
            const number = RaisecomRosAcls.number(device, acl, family);
            return number === undefined ? [] : [`filter ingress access-list ${number}`];
        });
    }

    /** What the switch's lists can't hold. */
    static unsupported(device: Device): string[] {
        const found: string[] = [];
        const acls = Object.entries(device.switching?.acls ?? {});

        if (acls.length > RaisecomRosAcls.MAX_LISTS)
            found.push(`switching.acls, ${acls.length} ACLs: the switch has ${RaisecomRosAcls.MAX_LISTS} extended lists of each family`);

        for (const [name, rules] of acls) {
            const where = `switching.acls.${name}`;
            const longest = RaisecomRosAcls.NAME_LENGTH - RaisecomRosAcls.SUFFIX.ipv4.length;
            if (name.length > longest || /\s/.test(name))
                found.push(`${where}, a name here takes ${longest} characters at most, without spaces: the switch adds -v4 or -v6`);

            (rules ?? []).forEach((rule, index) => {
                const at = `${where}[${index}]`;
                if (rule.description) found.push(`${at}.description, a rule here takes no description`);
                if (rule.rate) found.push(`${at}.rate, a list here only permits or denies`);
                if (rule.if?.vlan) found.push(`${at}.if.vlan, an IP list on the switch matches no VLAN`);

                const protocol = rule.if?.protocol;
                const ported = rule.if?.src_port !== undefined || rule.if?.dst_port !== undefined;
                if (ported && protocol && protocol !== "tcp" && protocol !== "udp")
                    found.push(`${at}.if, ports with protocol ${protocol}: only TCP and UDP have ports`);

                for (const key of ["src_port", "dst_port"] as const)
                    if (RaisecomRosAcls.portsOf(rule.if?.[key]).some((port) => port && port.min !== port.max))
                        found.push(`${at}.if.${key}, a rule here matches one port: write each port`);
            });
        }

        for (const [port, settings] of Derive.ports(device)) {
            if (!settings.ingress_acl) continue;

            const where = `interfaces.ethernet.${port}.ingress_acl`;
            if (settings.in_lag) found.push(`${where} on a LAG member, tested on a port alone`);
            else if (!settings.access_vlan && !settings.trunk_vlans && !settings.qinq_vlan)
                found.push(`${where} on a port that does not switch, tested on switched ports alone`);
            if (settings.ethertypes)
                found.push(`${where} with ethertypes, whose MAC list the switch checks beside it in an order not known`);
        }

        return found;
    }

    /** A family's rules as the switch prints them, without their numbers. A rule whose match repeats an earlier one's is left out: the switch refuses it, `Conflict with previous rule of current ACL.`, and the earlier one decides anyway. */
    private static rulesOf(rules: readonly AclRule[], family: Family): string[] {
        const printed: string[] = [];
        const seen = new Set<string>();

        for (const rule of rules) {
            for (const words of RaisecomRosAcls.matchesOf(rule, family)) {
                if (seen.has(words)) continue;

                seen.add(words);
                printed.push(`${rule.then === "accept" ? "permit" : "deny"} ${words}`);
            }
        }

        return printed;
    }

    /** What one rule matches in a family: one line for each combination of the values in its lists, or none when the rule is the other family's. A port without a protocol is a TCP rule and a UDP rule. */
    private static matchesOf(rule: AclRule, family: Family): string[] {
        const match = rule.if;
        if (match?.family && match.family !== family) return [];

        const sources = RaisecomRosAcls.addressesOf(match?.src, family);
        const destinations = RaisecomRosAcls.addressesOf(match?.dst, family);
        if (!sources || !destinations) return [];

        const ported = match?.src_port !== undefined || match?.dst_port !== undefined;
        const protocols: (Protocol | undefined)[] = match?.protocol ? [match.protocol] : ported ? ["tcp", "udp"] : [undefined];

        return protocols.flatMap((protocol) =>
            sources.flatMap((source) =>
                RaisecomRosAcls.portsOf(match?.src_port).flatMap((sourcePort) =>
                    destinations.flatMap((destination) =>
                        RaisecomRosAcls.portsOf(match?.dst_port).map((destinationPort) =>
                            [
                                protocol ? RaisecomRosAcls.PROTOCOL[family][protocol] : RaisecomRosAcls.ANY[family],
                                RaisecomRosAcls.address(source, family),
                                ...(sourcePort ? [`${sourcePort.min}`] : []),
                                RaisecomRosAcls.address(destination, family),
                                ...(destinationPort ? [`${destinationPort.min}`] : []),
                            ].join(" ")
                        )
                    )
                )
            )
        );
    }

    /** The match's prefixes of one family, `[undefined]` for any, or nothing when the match has prefixes of the other family only. */
    private static addressesOf(value: string | readonly string[] | undefined, family: Family): (string | undefined)[] | undefined {
        if (value === undefined) return [undefined];

        const ofFamily = [value].flat().filter((prefix) => Address.family(Address.host(prefix)) === family);
        if (!ofFamily.length) return undefined;

        return ofFamily.map((prefix) => (prefix.includes("/") && Address.split(prefix).len === 0 ? undefined : Address.withLength(prefix)));
    }

    /** An IPv4 prefix with its mask, and an IPv6 prefix with its length in capitals, as the switch prints them. */
    private static address(prefix: string | undefined, family: Family): string {
        if (!prefix) return "any";

        const { len } = Address.split(prefix);
        const network = Address.prefixOf(prefix);
        if (family === "ipv6") return network.toUpperCase();
        return `${Address.host(network)} ${Address.netmask(len)}`;
    }

    /** Each port or range, `[undefined]` for any. Every port is any port, so it is left out. */
    private static portsOf(ports: Ports | undefined): ({ min: number; max: number } | undefined)[] {
        if (ports === undefined) return [undefined];

        return [ports]
            .flat()
            .map((port) => (typeof port === "number" ? { min: port, max: port } : port))
            .map((range) => (range.min === 0 && range.max === RaisecomRosAcls.LAST_PORT ? undefined : range));
    }
}
