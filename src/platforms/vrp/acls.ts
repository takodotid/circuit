// Hardware ACLs: an advanced ACL and an ACL6, each named after the ACL, and `traffic-filter` on each port that takes it. The switch checks what arrives on the port, switched or routed, against the ACL's rules in order, and lets through what no rule matches.

import { Address } from "../../core/address";
import type { AclRule, Device, Family, Ports, Protocol } from "../../model";
import { VrpPolicies } from "./policies";

/** One rule as the switch prints it: its match, then its description. */
type Printed = { match: string; description?: string };

export class VrpAcls {
    /** The switch numbers rules in steps of 5. */
    private static readonly STEP = 5;

    /** The longest ACL name the switch takes. */
    private static readonly NAME_LENGTH = 32;

    /** The highest TCP or UDP port. */
    private static readonly LAST_PORT = 65535;

    /** A protocol as each family's ACL prints it. */
    private static readonly PROTOCOL: Record<Family, Record<Protocol, string>> = {
        ipv4: { tcp: "tcp", udp: "udp", icmp: "icmp", gre: "gre", esp: "50", ah: "51", ospf: "ospf", vrrp: "112" },
        ipv6: { tcp: "tcp", udp: "udp", icmp: "icmpv6", gre: "gre", esp: "ipv6-esp", ah: "ipv6-ah", ospf: "ospf", vrrp: "112" },
    };

    /** What a rule without a protocol matches. */
    private static readonly ANY: Record<Family, string> = { ipv4: "ip", ipv6: "ipv6" };

    /** The ports a rule prints by name, of either family, as a CE6855 on V200R005C00SPC800 printed them. */
    private static readonly PORT_NAMES: Record<"tcp" | "udp", Record<number, string>> = {
        tcp: {
            7: "echo",
            9: "discard",
            13: "daytime",
            19: "chargen",
            20: "ftp-data",
            21: "ftp",
            23: "telnet",
            25: "smtp",
            37: "time",
            43: "whois",
            49: "tacacs",
            53: "domain",
            70: "gopher",
            79: "finger",
            80: "www",
            101: "hostname",
            109: "pop2",
            110: "pop3",
            111: "sunrpc",
            119: "nntp",
            179: "bgp",
            194: "irc",
            512: "exec",
            513: "login",
            514: "cmd",
            515: "lpd",
            517: "talk",
            540: "uucp",
            543: "klogin",
            544: "kshell",
        },
        udp: {
            7: "echo",
            9: "discard",
            37: "time",
            42: "nameserver",
            53: "dns",
            65: "tacacs-ds",
            67: "bootps",
            68: "bootpc",
            69: "tftp",
            90: "dnsix",
            111: "sunrpc",
            123: "ntp",
            137: "netbios-ns",
            138: "netbios-dgm",
            139: "netbios-ssn",
            161: "snmp",
            162: "snmptrap",
            177: "xdmcp",
            434: "mobilip-ag",
            435: "mobilip-mn",
            512: "biff",
            513: "who",
            514: "syslog",
            517: "talk",
            520: "rip",
        },
    };

    /** Each ACL's blocks, an advanced ACL for its IPv4 rules and an ACL6 for its IPv6 rules. A family without rules has no block. */
    static blocks(device: Device): string[] {
        const lines: string[] = [];

        for (const [name, rules] of Object.entries(device.switching?.acls ?? {})) {
            for (const family of ["ipv4", "ipv6"] as const) {
                const printed = VrpAcls.rulesOf(rules ?? [], family);
                if (!printed.length) continue;

                lines.push(`${VrpAcls.header(family)} name ${name} advance`);
                printed.forEach(({ match, description }, index) => {
                    const id = (index + 1) * VrpAcls.STEP;
                    lines.push(` rule ${id} ${match}`);
                    if (description) lines.push(` rule ${id} description ${description}`);
                });
                lines.push("#");
            }
        }

        return lines;
    }

    /** A port's filters: its ACL for each family the ACL has rules of. */
    static portLines(device: Device, acl: string | undefined): string[] {
        const rules = acl ? device.switching?.acls?.[acl] : undefined;
        if (!acl || !rules) return [];

        return (["ipv4", "ipv6"] as const)
            .filter((family) => VrpAcls.rulesOf(rules, family).length)
            .map((family) => `traffic-filter ${family === "ipv4" ? "acl" : "ipv6 acl"} ${acl} inbound`);
    }

    /** What the switch's ACLs can't hold. */
    static unsupported(device: Device): string[] {
        const found: string[] = [];

        for (const [name, rules] of Object.entries(device.switching?.acls ?? {})) {
            const where = `switching.acls.${name}`;
            if (name.length > VrpAcls.NAME_LENGTH || /^\d+$/.test(name) || !/^[A-Za-z0-9]/.test(name))
                found.push(`${where}, a name the switch refuses: up to ${VrpAcls.NAME_LENGTH} characters, starting with a letter or digit`);

            (rules ?? []).forEach((rule, index) => {
                const at = `${where}[${index}]`;
                if (rule.rate) found.push(`${at}.rate, a traffic filter only permits or denies`);
                if (rule.if?.vlan) found.push(`${at}.if.vlan, an IP ACL on the switch matches no VLAN`);

                const protocol = rule.if?.protocol;
                const ported = rule.if?.src_port !== undefined || rule.if?.dst_port !== undefined;
                if (ported && protocol && protocol !== "tcp" && protocol !== "udp")
                    found.push(`${at}.if, ports with protocol ${protocol}: only TCP and UDP have ports`);
            });
        }

        for (const [port, settings] of Object.entries(device.interfaces?.ethernet ?? {})) {
            if (!settings?.ingress_acl) continue;

            const where = `interfaces.ethernet.${port}.ingress_acl`;
            if (settings.in_lag) found.push(`${where} on a LAG member: the switch filters no port of a LAG`);
            if (settings.ethertypes) found.push(`${where} with ethertypes, which the switch filters with a layer 2 ACL of its own`);
        }

        return found;
    }

    private static header(family: Family): string {
        return family === "ipv4" ? "acl" : "acl ipv6";
    }

    /**
     * A family's rules as the switch prints them, without their numbers. A list in a match is one rule per value: source, then destination, then source port, then destination port. A port without a protocol is a TCP rule and a UDP rule. A rule that repeats an earlier one's match is left out: the switch refuses it, and the earlier one decides anyway.
     */
    private static rulesOf(rules: readonly AclRule[], family: Family): Printed[] {
        const printed: Printed[] = [];
        const seen = new Set<string>();

        for (const rule of rules) {
            for (const words of VrpAcls.matchesOf(rule, family)) {
                if (seen.has(words)) continue;

                seen.add(words);
                printed.push({ match: `${rule.then === "accept" ? "permit" : "deny"} ${words}`, description: rule.description });
            }
        }

        return printed;
    }

    /** What one rule matches in a family, one line for each combination of the values in its lists, or none when the rule is the other family's. */
    static matchesOf(rule: AclRule, family: Family): string[] {
        const match = rule.if;
        if (match?.family && match.family !== family) return [];

        const sources = VrpAcls.addressesOf(match?.src, family);
        const destinations = VrpAcls.addressesOf(match?.dst, family);
        if (!sources || !destinations) return [];

        const ported = match?.src_port !== undefined || match?.dst_port !== undefined;
        const protocols: (Protocol | undefined)[] = match?.protocol ? [match.protocol] : ported ? ["tcp", "udp"] : [undefined];

        return protocols.flatMap((protocol) =>
            sources.flatMap((source) =>
                destinations.flatMap((destination) =>
                    VrpAcls.portsOf(match?.src_port).flatMap((sourcePort) =>
                        VrpAcls.portsOf(match?.dst_port).map((destinationPort) =>
                            [
                                protocol ? VrpAcls.PROTOCOL[family][protocol] : VrpAcls.ANY[family],
                                ...(source ? ["source", VrpAcls.address(source)] : []),
                                ...(sourcePort ? ["source-port", VrpAcls.port(sourcePort, protocol)] : []),
                                ...(destination ? ["destination", VrpAcls.address(destination)] : []),
                                ...(destinationPort ? ["destination-port", VrpAcls.port(destinationPort, protocol)] : []),
                            ].join(" ")
                        )
                    )
                )
            )
        );
    }

    /** The match's addresses of one family, `[undefined]` for any, or nothing when the match has addresses of the other family only. Every address is any address, so it is left out. */
    private static addressesOf(value: string | readonly string[] | undefined, family: Family): (string | undefined)[] | undefined {
        if (value === undefined) return [undefined];

        const ofFamily = [value].flat().filter((prefix) => Address.family(Address.host(prefix)) === family);
        if (!ofFamily.length) return undefined;

        return ofFamily.map((prefix) => (prefix.includes("/") && Address.split(prefix).len === 0 ? undefined : prefix));
    }

    /** An IPv4 prefix with its wildcard, `0` for one address. An IPv6 prefix with its length, in capitals. */
    private static address(prefix: string): string {
        const length = prefix.includes("/") ? Address.split(prefix).len : Address.bits(Address.family(prefix));

        if (Address.family(Address.host(prefix)) === "ipv6")
            return VrpPolicies.spell(Address.prefixOf(`${Address.host(prefix)}/${length}`));

        const network = Address.host(Address.prefixOf(`${Address.host(prefix)}/${length}`));
        return `${network} ${length === Address.bits("ipv4") ? "0" : Address.wildcard(length)}`;
    }

    /** Each port or range, `[undefined]` for any. Every port is any port, so it is left out, as the switch prints it. */
    private static portsOf(ports: Ports | undefined): ({ min: number; max: number } | undefined)[] {
        if (ports === undefined) return [undefined];

        return [ports]
            .flat()
            .map((port) => (typeof port === "number" ? { min: port, max: port } : port))
            .map((range) => (range.min === 0 && range.max === VrpAcls.LAST_PORT ? undefined : range));
    }

    /** A port or a range as the switch prints it. A well-known port is printed by its name, a range from 0 as `lt`, and one up to the last port as `gt`. */
    private static port({ min, max }: { min: number; max: number }, protocol: Protocol | undefined): string {
        const names = protocol === "tcp" || protocol === "udp" ? VrpAcls.PORT_NAMES[protocol] : {};

        if (min === max) return `eq ${names[min] ?? min}`;
        if (min === 0) return `lt ${max + 1}`;
        if (max === VrpAcls.LAST_PORT) return `gt ${min - 1}`;
        return `range ${min} ${max}`;
    }
}
