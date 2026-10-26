// Packet filtering as policies through the device and local-in policies to it, who reaches the device's own services, NAT as central source NAT and virtual IPs, and stateless ACLs on ports.

import { Address } from "../../core/address";
import type { AclRule, Device, Family, FilterMatch, FilterRule, NatRule, Ports, Prefix, Protocol } from "../../schema";
import { FortiOsNames } from "./names";
import { FortiOsBlock, FortiOsTree } from "./tree";

/** The address objects, groups and services rules name, each created once. */
class Objects {
    constructor(
        private readonly root: FortiOsBlock,
        private readonly device: Device
    ) {}

    /** The address a rule names on one side: one prefix, a set, or everything. */
    address(prefix: string | undefined, set: string | undefined, family: Family): string {
        if (set) return this.group(set, this.device.firewall?.address_sets?.[set] ?? [], family);
        if (!prefix) return "all";

        return this.prefix(prefix, family);
    }

    private prefix(prefix: string, family: Family): string {
        const name = FortiOsNames.network(prefix);

        if (family === "ipv4") this.root.block("firewall address").entry(name).set("subnet", FortiOsNames.subnet(name));
        else this.root.block("firewall address6").entry(name).set("ip6", name);

        return name;
    }

    /** A group of the members of one family, named once for both families. */
    group(name: string, members: readonly string[], family: Family): string {
        const names = members
            .filter((member) => FortiOsNames.familyOfPrefix(member) === family)
            .map((member) => this.prefix(member, family));

        const table = family === "ipv4" ? "firewall addrgrp" : "firewall addrgrp6";
        this.root
            .block(table)
            .entry(name)
            .set("member", FortiOsTree.quoteAll([...new Set(names)]));
        return name;
    }

    /** A pool of one address, for source NAT to it. */
    pool(address: string): void {
        this.root.block("firewall ippool").entry(address).set("startip", address).set("endip", address);
    }

    service(match: FilterMatch<string, string> | undefined, family: Family): string {
        const { name, block } = FortiOsFirewall.serviceOf(match, family);

        // Transparent mode deletes the factory's services, `ALL` with them, so every protocol is a service of Circuit's own there.
        if (name === "ALL" && FortiOsNames.isTransparent(this.device)) {
            this.root.block("firewall service custom").entry(FortiOsFirewall.ALL_IN_TRANSPARENT).set("protocol", "IP");
            return FortiOsFirewall.ALL_IN_TRANSPARENT;
        }

        if (!block) return name;

        const entry = this.root.block("firewall service custom").entry(name);
        for (const [key, value] of block.settings) entry.set(key, value);
        return name;
    }
}

export class FortiOsFirewall {
    /** IP protocol numbers, for a protocol the platform names only by number. */
    static readonly PROTOCOL_NUMBER: Record<Protocol, number> = { tcp: 6, udp: 17, icmp: 1, gre: 47, esp: 50, ah: 51, ospf: 89, vrrp: 112 };

    /** The device's own services, by the config's name, with the protocol and port each listens on unless the config moves it. */
    private static readonly SERVICES = {
        ssh: { protocol: "tcp", port: 22 },
        https: { protocol: "tcp", port: 443 },
        http: { protocol: "tcp", port: 80 },
        telnet: { protocol: "tcp", port: 23 },
        snmp: { protocol: "udp", port: 161 },
        native: { protocol: "tcp", port: 541 },
    } as const;

    /** Every protocol, as a service of Circuit's own, for a device in transparent mode. */
    static readonly ALL_IN_TRANSPARENT = "circuit-all";

    /** NAT rules of both directions, which central NAT needs turned on. */
    static natRules(device: Device): NatRule<string, string>[] {
        const nat = device.firewall?.nat;
        return [...(nat?.source ?? []), ...(nat?.destination ?? [])];
    }

    /** Which families a rule applies to: its own, its addresses', or both. */
    static familiesOf(device: Device, match: FilterMatch<string, string> | undefined): Family[] {
        if (match?.family) return [match.family];

        const prefixes = [match?.src, match?.dst].filter((prefix): prefix is Prefix => prefix !== undefined);
        if (prefixes.length) return [...new Set(prefixes.map(FortiOsNames.familyOfPrefix))];

        let families: Family[] = ["ipv4", "ipv6"];

        for (const set of [match?.src_set, match?.dst_set]) {
            if (!set) continue;

            const present = new Set((device.firewall?.address_sets?.[set] ?? []).map(FortiOsNames.familyOfPrefix));
            families = families.filter((family) => present.has(family));
        }

        return families;
    }

    /** A port or ports as the platform writes them in a service: `22`, `1000-2000`. */
    static portList(ports: Ports | undefined): string[] {
        if (ports === undefined) return [];

        const list = Array.isArray(ports) ? ports : [ports as number | { min: number; max: number }];
        return list.map((port) => (typeof port === "number" ? String(port) : `${port.min}-${port.max}`));
    }

    /** The service a rule matches, by name, with what it holds. `ALL` when the rule names no protocol and no port; ports without a protocol are TCP's and UDP's. */
    static serviceOf(match: FilterMatch<string, string> | undefined, family: Family): { name: string; block?: FortiOsBlock } {
        const protocol = match?.protocol;
        const destinations = FortiOsFirewall.portList(match?.dst_port);
        const sources = FortiOsFirewall.portList(match?.src_port);

        if (!protocol && !destinations.length && !sources.length) return { name: "ALL" };

        if (!protocol || protocol === "tcp" || protocol === "udp") {
            const ranges = (destinations.length ? destinations : ["1-65535"]).flatMap((destination) =>
                sources.length ? sources.map((source) => `${destination}:${source}`) : [destination]
            );

            const protocols = protocol ? [protocol] : (["tcp", "udp"] as const);
            const name = `${protocols.join("+")}/${destinations.join(",") || "any"}${sources.length ? ` from ${sources.join(",")}` : ""}`;
            const block = new FortiOsBlock();
            for (const each of protocols) block.set(`${each}-portrange`, ranges.join(" "));
            return { name, block };
        }

        if (protocol === "icmp") {
            const kind = family === "ipv4" ? "ICMP" : "ICMP6";
            return { name: kind.toLowerCase(), block: new FortiOsBlock().set("protocol", kind).set("icmptype", FortiOsTree.UNSET) };
        }

        const number = FortiOsFirewall.PROTOCOL_NUMBER[protocol];
        return { name: `protocol/${number}`, block: new FortiOsBlock().set("protocol", "IP").set("protocol-number", number) };
    }

    /** A rule the platform keeps without being told: replies to a session it let through, and packets that belong to one, pass on their own. */
    static isImplied(rule: FilterRule<string, string>): boolean {
        const state = rule.match?.state;
        return (
            rule.action === "accept" &&
            state !== undefined &&
            state.length > 0 &&
            state.every((one) => one === "established" || one === "related")
        );
    }

    /** Who reaches the device's own services, alone: for a management VDOM, which routes no traffic of its own. */
    static managementOnly(root: FortiOsBlock, device: Device): void {
        const localIns = { ipv4: 0, ipv6: 0 };
        const localInEntry = (family: Family) =>
            root.block(family === "ipv4" ? "firewall local-in-policy" : "firewall local-in-policy6").entry(++localIns[family]);

        FortiOsFirewall.management(localInEntry, new Objects(root, device), device);
    }

    /** Packet filtering, who reaches the device, NAT and stateless ACLs. */
    static render(root: FortiOsBlock, device: Device): void {
        const fw = device.firewall;
        const objects = new Objects(root, device);

        const forward = fw?.filter?.forward;
        const policies = { ipv4: 0, ipv6: 0 };

        for (const rule of forward?.rules ?? []) {
            if (FortiOsFirewall.isImplied(rule)) continue;

            for (const family of FortiOsFirewall.familiesOf(device, rule.match)) {
                const table = root.block(family === "ipv4" ? "firewall policy" : "firewall policy6");
                FortiOsFirewall.policy(table.entry(++policies[family]), objects, device, rule, family);
            }
        }

        // A packet no rule matched is accepted unless the chain drops it; the platform's own last word is deny.
        if (forward?.default !== "drop") {
            for (const family of ["ipv4", "ipv6"] as const) {
                const table = root.block(family === "ipv4" ? "firewall policy" : "firewall policy6");
                FortiOsFirewall.policy(table.entry(++policies[family]), objects, device, { action: "accept" }, family);
            }
        }

        const localIns = { ipv4: 0, ipv6: 0 };
        const localInEntry = (family: Family) =>
            root.block(family === "ipv4" ? "firewall local-in-policy" : "firewall local-in-policy6").entry(++localIns[family]);

        FortiOsFirewall.management(localInEntry, objects, device);

        const input = fw?.filter?.input;

        for (const rule of input?.rules ?? []) {
            if (FortiOsFirewall.isImplied(rule)) continue;

            for (const family of FortiOsFirewall.familiesOf(device, rule.match)) {
                FortiOsFirewall.localIn(localInEntry(family), objects, device, rule, family);
            }
        }

        if (input?.default === "drop") {
            for (const family of ["ipv4", "ipv6"] as const) {
                FortiOsFirewall.localIn(localInEntry(family), objects, device, { action: "drop" }, family);
            }
        }

        (fw?.nat?.source ?? []).forEach((rule, index) =>
            FortiOsFirewall.sourceNat(root.block("firewall central-snat-map").entry(index + 1), objects, device, rule)
        );
        (fw?.nat?.destination ?? []).forEach((rule, index) =>
            FortiOsFirewall.destinationNat(root.block("firewall vip").entry(`dnat-${index + 1}`), device, rule)
        );

        FortiOsFirewall.acls(root, objects, device);
    }

    /**
     * Who reaches the device's own services: each service with sources to allow accepts them and refuses everyone else, ahead of the input chain. Services sharing their sources share the policies, named after `management.allow` or the service.
     */
    private static management(entry: (family: Family) => FortiOsBlock, objects: Objects, device: Device): void {
        type Services = typeof FortiOsFirewall.SERVICES;

        const config = device.management ?? {};
        const guards = new Map<string, { sources: readonly string[]; services: string[] }>();

        for (const [service, listener] of Object.entries(FortiOsFirewall.SERVICES) as [keyof Services, Services[keyof Services]][]) {
            const settings = config[service];
            const sources = settings?.allow ?? config.allow;
            if (!settings || !sources?.length) continue;

            const name = settings.allow ? `circuit-${service}` : "circuit-management";
            const guard = guards.get(name) ?? { sources, services: [] };
            guard.services.push(objects.service({ protocol: listener.protocol, dst_port: settings.port ?? listener.port }, "ipv4"));
            guards.set(name, guard);
        }

        for (const [name, guard] of guards) {
            for (const family of ["ipv4", "ipv6"] as const) {
                const services = FortiOsTree.quoteAll(guard.services);

                if (guard.sources.some((source) => FortiOsNames.familyOfPrefix(source) === family)) {
                    const accept = entry(family);
                    accept.set("intf", FortiOsTree.quote("any"));
                    accept.set("srcaddr", FortiOsTree.quote(objects.group(name, guard.sources, family)));
                    accept.set("dstaddr", FortiOsTree.quote("all"));
                    accept.set("action", "accept");
                    accept.set("service", services);
                    accept.set("schedule", FortiOsTree.quote("always"));
                    accept.set("comments", FortiOsTree.quote("Management from allowed sources"));
                }

                const deny = entry(family);
                deny.set("intf", FortiOsTree.quote("any"));
                deny.set("srcaddr", FortiOsTree.quote("all"));
                deny.set("dstaddr", FortiOsTree.quote("all"));
                deny.set("action", "deny");
                deny.set("service", services);
                deny.set("schedule", FortiOsTree.quote("always"));
                deny.set("comments", FortiOsTree.quote("Management from anywhere else"));
            }
        }
    }

    /** The interface a rule names on one side, or `any`, quoted. */
    private static interfaceOf(device: Device, name: string | undefined): string {
        return FortiOsTree.quote(name ? FortiOsNames.nameOf(device, name) : "any");
    }

    /** A policy for traffic through the device. A rejection answers the sender; the platform's deny is silent otherwise. */
    private static policy(entry: FortiOsBlock, objects: Objects, device: Device, rule: FilterRule<string, string>, family: Family): void {
        const match = rule.match;

        entry.set("srcintf", FortiOsFirewall.interfaceOf(device, match?.in_interface));
        entry.set("dstintf", FortiOsFirewall.interfaceOf(device, match?.out_interface));
        entry.set("srcaddr", FortiOsTree.quote(objects.address(match?.src, match?.src_set, family)));
        entry.set("dstaddr", FortiOsTree.quote(objects.address(match?.dst, match?.dst_set, family)));
        entry.set("action", rule.action === "accept" ? "accept" : "deny");
        entry.set("schedule", FortiOsTree.quote("always"));
        entry.set("service", FortiOsTree.quote(objects.service(match, family)));

        // The device gives a deny policy `logtraffic disable` of its own accord.
        if (rule.action !== "accept") entry.set("logtraffic", "disable");
        if (rule.action === "accept" && !device.hardware_offload && !rule.offload) entry.set("auto-asic-offload", "disable");
        if (rule.description) entry.set("comments", FortiOsTree.quote(rule.description));
        if (rule.action === "reject") entry.set("send-deny-packet", "enable");
    }

    /** A local-in policy, for traffic to the device itself. */
    private static localIn(entry: FortiOsBlock, objects: Objects, device: Device, rule: FilterRule<string, string>, family: Family): void {
        const match = rule.match;

        entry.set("intf", FortiOsFirewall.interfaceOf(device, match?.in_interface));
        entry.set("srcaddr", FortiOsTree.quote(objects.address(match?.src, match?.src_set, family)));
        entry.set("dstaddr", FortiOsTree.quote(objects.address(match?.dst, match?.dst_set, family)));
        entry.set("action", rule.action === "accept" ? "accept" : "deny");
        entry.set("service", FortiOsTree.quote(objects.service(match, family)));
        entry.set("schedule", FortiOsTree.quote("always"));
        if (rule.description) entry.set("comments", FortiOsTree.quote(rule.description));
    }

    /** Source NAT: to the outgoing interface's address, or to a pool of one address. */
    private static sourceNat(entry: FortiOsBlock, objects: Objects, device: Device, rule: NatRule<string, string>): void {
        const match = rule.match;

        entry.set("orig-addr", FortiOsTree.quote(objects.address(match?.src, match?.src_set, "ipv4")));
        entry.set("srcintf", FortiOsFirewall.interfaceOf(device, match?.in_interface));
        entry.set("dst-addr", FortiOsTree.quote(objects.address(match?.dst, match?.dst_set, "ipv4")));
        entry.set("dstintf", FortiOsFirewall.interfaceOf(device, match?.out_interface));
        if (match?.protocol) entry.set("protocol", FortiOsFirewall.PROTOCOL_NUMBER[match.protocol]);

        const ports = FortiOsFirewall.portList(match?.src_port);

        if (rule.action === "snat") {
            objects.pool(rule.to);
            entry.set("nat-ippool", FortiOsTree.quote(rule.to));
            // A pool keeps the source port only when told which.
            if (ports.length) entry.set("orig-port", ports[0]!).set("nat-port", rule.to_port ?? ports[0]!);
        } else if (ports.length) {
            entry.set("orig-port", ports[0]!);
        }

        if (rule.description) entry.set("comments", FortiOsTree.quote(rule.description));
    }

    /** Destination NAT, as a virtual IP: the address it answers on, and the port it forwards when the rule names one. */
    private static destinationNat(entry: FortiOsBlock, device: Device, rule: NatRule<string, string>): void {
        if (rule.action !== "dnat") return;

        const match = rule.match;
        if (rule.description) entry.set("comment", FortiOsTree.quote(rule.description));
        if (match?.dst) entry.set("extip", Address.host(FortiOsNames.withLength(match.dst)));
        entry.set("extintf", FortiOsFirewall.interfaceOf(device, match?.in_interface));

        const sources = match?.src ? [match.src] : match?.src_set ? (device.firewall?.address_sets?.[match.src_set] ?? []) : [];
        if (sources.length) entry.set("src-filter", FortiOsTree.quoteAll(sources.map(FortiOsNames.network)));

        const ports = FortiOsFirewall.portList(match?.dst_port);
        if (ports.length) entry.set("portforward", "enable");
        entry.set("mappedip", FortiOsTree.quote(rule.to));

        if (ports.length) {
            if (match?.protocol === "udp") entry.set("protocol", "udp");
            entry.set("extport", ports[0]!);
            entry.set("mappedport", rule.to_port ?? ports[0]!);
        }
    }

    /**
     * A port's ACL as the platform's stateless ACLs, which only drop: each rule that drops becomes one, of each family it applies to. What no rule drops passes, so the rules that accept after the last drop are already there; `unsupported()` refuses one before a drop.
     */
    private static acls(root: FortiOsBlock, objects: Objects, device: Device): void {
        const counters = { ipv4: 0, ipv6: 0 };

        for (const [port, settings] of Object.entries(device.ports ?? {})) {
            if (!settings?.acl) continue;

            for (const rule of device.acls?.[settings.acl] ?? []) {
                if (rule.action !== "drop") continue;

                const match = rule.match as FilterMatch<string, string> | undefined;

                for (const family of FortiOsFirewall.familiesOf(device, match)) {
                    const entry = root.block(family === "ipv4" ? "firewall acl" : "firewall acl6").entry(++counters[family]);
                    if (rule.description) entry.set("comments", FortiOsTree.quote(rule.description));
                    entry.set("interface", FortiOsTree.quote(FortiOsNames.nameOf(device, port)));
                    entry.set("srcaddr", FortiOsTree.quote(objects.address(match?.src, undefined, family)));
                    entry.set("dstaddr", FortiOsTree.quote(objects.address(match?.dst, undefined, family)));
                    entry.set("service", FortiOsTree.quote(objects.service(match, family)));
                }
            }
        }
    }

    /** Whether a port's ACL drops before it accepts: an accept before a drop is an exception the platform's ACLs cannot hold. */
    static acceptsBeforeDrop(rules: readonly AclRule<string>[]): boolean {
        const lastDrop = rules.map((rule) => rule.action).lastIndexOf("drop");
        return rules.slice(0, Math.max(0, lastDrop)).some((rule) => rule.action === "accept");
    }
}
