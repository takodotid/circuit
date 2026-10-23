// Packet filtering as policies through the device and local-in policies to it, who reaches the device's own services, NAT as central source NAT and virtual IPs, and stateless ACLs on ports.

import { host } from "../../core/addr";
import type { AclRule, Device, Family, FilterMatch, FilterRule, NatRule, Ports, Protocol } from "../../schema";
import { familyOfPrefix, isTransparent, nameOf, network, subnet, withLength } from "./names";
import { Block, quote, quoteAll, UNSET } from "./tree";

/** IP protocol numbers, for a protocol the platform names only by number. */
export const PROTOCOL_NUMBER: Record<Protocol, number> = { tcp: 6, udp: 17, icmp: 1, gre: 47, esp: 50, ah: 51, ospf: 89, vrrp: 112 };

/** The device's own services, by the config's name, with the protocol and port each listens on unless the config moves it. */
const SERVICES = {
    ssh: { protocol: "tcp", port: 22 },
    https: { protocol: "tcp", port: 443 },
    http: { protocol: "tcp", port: 80 },
    telnet: { protocol: "tcp", port: 23 },
    snmp: { protocol: "udp", port: 161 },
    native: { protocol: "tcp", port: 541 },
} as const;

/** NAT rules of both directions, which central NAT needs turned on. */
export function natRules(device: Device): NatRule<string, string>[] {
    const nat = device.firewall?.nat;
    return [...(nat?.source ?? []), ...(nat?.destination ?? [])];
}

/** Which families a rule applies to: its own, its addresses', or both. */
export function familiesOf(device: Device, match: FilterMatch<string, string> | undefined): Family[] {
    if (match?.family) return [match.family];

    const prefixes = [match?.src, match?.dst].filter((prefix): prefix is string => prefix !== undefined);
    if (prefixes.length) return [...new Set(prefixes.map(familyOfPrefix))];

    let families: Family[] = ["ipv4", "ipv6"];

    for (const set of [match?.src_set, match?.dst_set]) {
        if (!set) continue;

        const present = new Set((device.firewall?.address_sets?.[set] ?? []).map(familyOfPrefix));
        families = families.filter((family) => present.has(family));
    }

    return families;
}

/** A port or ports as the platform writes them in a service: `22`, `1000-2000`. */
export function portList(ports: Ports | undefined): string[] {
    if (ports === undefined) return [];

    const list = Array.isArray(ports) ? ports : [ports as number | { min: number; max: number }];
    return list.map((port) => (typeof port === "number" ? String(port) : `${port.min}-${port.max}`));
}

/** Every protocol, as a service of Circuit's own, for a device in transparent mode. */
export const ALL_IN_TRANSPARENT = "circuit-all";

/** The service a rule matches, by name, with what it holds. `ALL` when the rule names no protocol and no port; ports without a protocol are TCP's and UDP's. */
export function serviceOf(match: FilterMatch<string, string> | undefined, family: Family): { name: string; block?: Block } {
    const protocol = match?.protocol;
    const destinations = portList(match?.dst_port);
    const sources = portList(match?.src_port);

    if (!protocol && !destinations.length && !sources.length) return { name: "ALL" };

    if (!protocol || protocol === "tcp" || protocol === "udp") {
        const ranges = (destinations.length ? destinations : ["1-65535"]).flatMap((destination) =>
            sources.length ? sources.map((source) => `${destination}:${source}`) : [destination]
        );

        const protocols = protocol ? [protocol] : (["tcp", "udp"] as const);
        const name = `${protocols.join("+")}/${destinations.join(",") || "any"}${sources.length ? ` from ${sources.join(",")}` : ""}`;
        const block = new Block();
        for (const each of protocols) block.set(`${each}-portrange`, ranges.join(" "));
        return { name, block };
    }

    if (protocol === "icmp") {
        const kind = family === "ipv4" ? "ICMP" : "ICMP6";
        return { name: kind.toLowerCase(), block: new Block().set("protocol", kind).set("icmptype", UNSET) };
    }

    const number = PROTOCOL_NUMBER[protocol];
    return { name: `protocol/${number}`, block: new Block().set("protocol", "IP").set("protocol-number", number) };
}

/** A rule the platform keeps without being told: replies to a session it let through, and packets that belong to one, pass on their own. */
export function isImplied(rule: FilterRule<string, string>): boolean {
    const state = rule.match?.state;
    return (
        rule.action === "accept" &&
        state !== undefined &&
        state.length > 0 &&
        state.every((one) => one === "established" || one === "related")
    );
}

/** The address objects, groups and services rules name, each created once. */
class Objects {
    constructor(
        private readonly root: Block,
        private readonly device: Device
    ) {}

    /** The address a rule names on one side: one prefix, a set, or everything. */
    address(prefix: string | undefined, set: string | undefined, family: Family): string {
        if (set) return this.group(set, this.device.firewall?.address_sets?.[set] ?? [], family);
        if (!prefix) return "all";

        return this.prefix(prefix, family);
    }

    private prefix(prefix: string, family: Family): string {
        const name = network(prefix);

        if (family === "ipv4") this.root.block("firewall address").entry(name).set("subnet", subnet(name));
        else this.root.block("firewall address6").entry(name).set("ip6", name);

        return name;
    }

    /** A group of the members of one family, named once for both families. */
    group(name: string, members: readonly string[], family: Family): string {
        const names = members.filter((member) => familyOfPrefix(member) === family).map((member) => this.prefix(member, family));

        const table = family === "ipv4" ? "firewall addrgrp" : "firewall addrgrp6";
        this.root
            .block(table)
            .entry(name)
            .set("member", quoteAll([...new Set(names)]));
        return name;
    }

    /** A pool of one address, for source NAT to it. */
    pool(address: string): void {
        this.root.block("firewall ippool").entry(address).set("startip", address).set("endip", address);
    }

    service(match: FilterMatch<string, string> | undefined, family: Family): string {
        const { name, block } = serviceOf(match, family);

        // Transparent mode deletes the factory's services, `ALL` with them, so every protocol is a service of Circuit's own there.
        if (name === "ALL" && isTransparent(this.device)) {
            this.root.block("firewall service custom").entry(ALL_IN_TRANSPARENT).set("protocol", "IP");
            return ALL_IN_TRANSPARENT;
        }

        if (!block) return name;

        const entry = this.root.block("firewall service custom").entry(name);
        for (const [key, value] of block.settings) entry.set(key, value);
        return name;
    }
}

/** Packet filtering, who reaches the device, NAT and stateless ACLs. */
export function firewall(root: Block, device: Device): void {
    const fw = device.firewall;
    const objects = new Objects(root, device);

    const forward = fw?.filter?.forward;
    const policies = { ipv4: 0, ipv6: 0 };

    for (const rule of forward?.rules ?? []) {
        if (isImplied(rule)) continue;

        for (const family of familiesOf(device, rule.match)) {
            const table = root.block(family === "ipv4" ? "firewall policy" : "firewall policy6");
            policy(table.entry(++policies[family]), objects, device, rule, family);
        }
    }

    // A packet no rule matched is accepted unless the chain drops it; the platform's own last word is deny.
    if (forward?.default !== "drop") {
        for (const family of ["ipv4", "ipv6"] as const) {
            const table = root.block(family === "ipv4" ? "firewall policy" : "firewall policy6");
            policy(table.entry(++policies[family]), objects, device, { action: "accept" }, family);
        }
    }

    const localIns = { ipv4: 0, ipv6: 0 };
    const localInEntry = (family: Family) =>
        root.block(family === "ipv4" ? "firewall local-in-policy" : "firewall local-in-policy6").entry(++localIns[family]);

    management(localInEntry, objects, device);

    const input = fw?.filter?.input;

    for (const rule of input?.rules ?? []) {
        if (isImplied(rule)) continue;

        for (const family of familiesOf(device, rule.match)) localIn(localInEntry(family), objects, device, rule, family);
    }

    if (input?.default === "drop") {
        for (const family of ["ipv4", "ipv6"] as const) localIn(localInEntry(family), objects, device, { action: "drop" }, family);
    }

    (fw?.nat?.source ?? []).forEach((rule, index) =>
        sourceNat(root.block("firewall central-snat-map").entry(index + 1), objects, device, rule)
    );
    (fw?.nat?.destination ?? []).forEach((rule, index) =>
        destinationNat(root.block("firewall vip").entry(`dnat-${index + 1}`), device, rule)
    );

    acls(root, objects, device);
}

/**
 * Who reaches the device's own services: each service with sources to allow accepts them and refuses everyone else, ahead of the input chain. Services sharing their sources share the policies, named after `management.allow` or the service.
 */
function management(entry: (family: Family) => Block, objects: Objects, device: Device): void {
    const config = device.management ?? {};
    const guards = new Map<string, { sources: readonly string[]; services: string[] }>();

    for (const [service, listener] of Object.entries(SERVICES) as [keyof typeof SERVICES, (typeof SERVICES)[keyof typeof SERVICES]][]) {
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
            const services = quoteAll(guard.services);

            if (guard.sources.some((source) => familyOfPrefix(source) === family)) {
                const accept = entry(family);
                accept.set("intf", quote("any"));
                accept.set("srcaddr", quote(objects.group(name, guard.sources, family)));
                accept.set("dstaddr", quote("all"));
                accept.set("action", "accept");
                accept.set("service", services);
                accept.set("schedule", quote("always"));
                accept.set("comments", quote("Management from allowed sources"));
            }

            const deny = entry(family);
            deny.set("intf", quote("any"));
            deny.set("srcaddr", quote("all"));
            deny.set("dstaddr", quote("all"));
            deny.set("action", "deny");
            deny.set("service", services);
            deny.set("schedule", quote("always"));
            deny.set("comments", quote("Management from anywhere else"));
        }
    }
}

/** A policy for traffic through the device. A rejection answers the sender; the platform's deny is silent otherwise. */
function policy(entry: Block, objects: Objects, device: Device, rule: FilterRule<string, string>, family: Family): void {
    const match = rule.match;

    entry.set("srcintf", quote(match?.in_interface ? nameOf(device, match.in_interface) : "any"));
    entry.set("dstintf", quote(match?.out_interface ? nameOf(device, match.out_interface) : "any"));
    entry.set("srcaddr", quote(objects.address(match?.src, match?.src_set, family)));
    entry.set("dstaddr", quote(objects.address(match?.dst, match?.dst_set, family)));
    entry.set("action", rule.action === "accept" ? "accept" : "deny");
    entry.set("schedule", quote("always"));
    entry.set("service", quote(objects.service(match, family)));

    // The device gives a deny policy `logtraffic disable` of its own accord.
    if (rule.action !== "accept") entry.set("logtraffic", "disable");
    if (rule.action === "accept" && !device.hardware_offload && !rule.offload) entry.set("auto-asic-offload", "disable");
    if (rule.description) entry.set("comments", quote(rule.description));
    if (rule.action === "reject") entry.set("send-deny-packet", "enable");
}

/** A local-in policy, for traffic to the device itself. */
function localIn(entry: Block, objects: Objects, device: Device, rule: FilterRule<string, string>, family: Family): void {
    const match = rule.match;

    entry.set("intf", quote(match?.in_interface ? nameOf(device, match.in_interface) : "any"));
    entry.set("srcaddr", quote(objects.address(match?.src, match?.src_set, family)));
    entry.set("dstaddr", quote(objects.address(match?.dst, match?.dst_set, family)));
    entry.set("action", rule.action === "accept" ? "accept" : "deny");
    entry.set("service", quote(objects.service(match, family)));
    entry.set("schedule", quote("always"));
    if (rule.description) entry.set("comments", quote(rule.description));
}

/** Source NAT: to the outgoing interface's address, or to a pool of one address. */
function sourceNat(entry: Block, objects: Objects, device: Device, rule: NatRule<string, string>): void {
    const match = rule.match;

    entry.set("orig-addr", quote(objects.address(match?.src, match?.src_set, "ipv4")));
    entry.set("srcintf", quote(match?.in_interface ? nameOf(device, match.in_interface) : "any"));
    entry.set("dst-addr", quote(objects.address(match?.dst, match?.dst_set, "ipv4")));
    entry.set("dstintf", quote(match?.out_interface ? nameOf(device, match.out_interface) : "any"));
    if (match?.protocol) entry.set("protocol", PROTOCOL_NUMBER[match.protocol]);

    const ports = portList(match?.src_port);

    if (rule.action === "snat") {
        objects.pool(rule.to);
        entry.set("nat-ippool", quote(rule.to));
        // A pool keeps the source port only when told which.
        if (ports.length) entry.set("orig-port", ports[0]!).set("nat-port", rule.to_port ?? ports[0]!);
    } else if (ports.length) {
        entry.set("orig-port", ports[0]!);
    }

    if (rule.description) entry.set("comments", quote(rule.description));
}

/** Destination NAT, as a virtual IP: the address it answers on, and the port it forwards when the rule names one. */
function destinationNat(entry: Block, device: Device, rule: NatRule<string, string>): void {
    if (rule.action !== "dnat") return;

    const match = rule.match;
    if (rule.description) entry.set("comment", quote(rule.description));
    if (match?.dst) entry.set("extip", host(withLength(match.dst)));
    entry.set("extintf", quote(match?.in_interface ? nameOf(device, match.in_interface) : "any"));

    const sources = match?.src ? [match.src] : match?.src_set ? (device.firewall?.address_sets?.[match.src_set] ?? []) : [];
    if (sources.length) entry.set("src-filter", quoteAll(sources.map(network)));

    const ports = portList(match?.dst_port);
    if (ports.length) entry.set("portforward", "enable");
    entry.set("mappedip", quote(rule.to));

    if (ports.length) {
        if (match?.protocol === "udp") entry.set("protocol", "udp");
        entry.set("extport", ports[0]!);
        entry.set("mappedport", rule.to_port ?? ports[0]!);
    }
}

/**
 * A port's ACL as the platform's stateless ACLs, which only drop: each rule that drops becomes one, of each family it applies to. What no rule drops passes, so the rules that accept after the last drop are already there; `unsupported()` refuses one before a drop.
 */
function acls(root: Block, objects: Objects, device: Device): void {
    const counters = { ipv4: 0, ipv6: 0 };

    for (const [port, settings] of Object.entries(device.ports ?? {})) {
        if (!settings?.acl) continue;

        for (const rule of device.acls?.[settings.acl] ?? []) {
            if (rule.action !== "drop") continue;

            const match = rule.match as FilterMatch<string, string> | undefined;

            for (const family of familiesOf(device, match)) {
                const entry = root.block(family === "ipv4" ? "firewall acl" : "firewall acl6").entry(++counters[family]);
                if (rule.description) entry.set("comments", quote(rule.description));
                entry.set("interface", quote(nameOf(device, port)));
                entry.set("srcaddr", quote(objects.address(match?.src, undefined, family)));
                entry.set("dstaddr", quote(objects.address(match?.dst, undefined, family)));
                entry.set("service", quote(objects.service(match, family)));
            }
        }
    }
}

/** Whether a port's ACL drops before it accepts: an accept before a drop is an exception the platform's ACLs cannot hold. */
export function acceptsBeforeDrop(rules: readonly AclRule<string>[]): boolean {
    const lastDrop = rules.map((rule) => rule.action).lastIndexOf("drop");
    return rules.slice(0, Math.max(0, lastDrop)).some((rule) => rule.action === "accept");
}
