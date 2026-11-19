import { Address } from "../../core/address";
import type { AclRule, Device, Ethertype, Family, FilterMatch, NatRule, PoolNatRule, Ports } from "../../model";
import { Derive } from "../../core/derive";
import type { RouterOsRender } from "./render";
import { RouterOsSyntax } from "./syntax";

/** One switch rule: the port it is on, the ACL rule it comes from, and the one source and destination port or range it takes. */
export type SwitchRule = { port: string; rule: AclRule; srcPort?: string; dstPort?: string };

/** The firewall and the switch chip's ACLs, added to one device's render. */
export class RouterOsFirewall {
    /** A kind of frame as a switch rule's `mac-protocol` names it. */
    private static readonly MAC_PROTOCOLS: Record<Ethertype, string> = { ipv4: "ip", ipv6: "ipv6", arp: "arp" };

    /** Helpers the platform has, all stated so that one the config does not list is off. */
    private static readonly HELPERS = ["ftp", "tftp", "irc", "h323", "sip", "pptp", "rtsp"] as const;

    private static readonly CHAINS = ["input", "forward", "output"] as const;

    /** The start of the name of each chain a NAT pool makes: `cgnat-198.51.100.0/27` for the pool, `cgnat-198.51.100.1` for one of its addresses. */
    private static readonly POOL_CHAIN = "cgnat";

    /** The protocols a NAT pool gives each subscriber a block of ports in. */
    private static readonly POOL_PROTOCOLS = ["tcp", "udp"] as const;

    private constructor(
        private readonly render: RouterOsRender,
        private readonly device: Device
    ) {}

    static render(render: RouterOsRender, device: Device): void {
        const firewall = new RouterOsFirewall(render, device);

        for (const family of ["ipv4", "ipv6"] as const) {
            firewall.untracked(family);
            firewall.filter(family);
            firewall.nat(family);
            firewall.tcpMss(family);
        }

        firewall.helpers();
        firewall.switchAcls();
    }

    /** A value of a match: the one written, or the only one of a list. `unsupported()` refuses a list of more. */
    private static one<T>(value: T | readonly T[] | undefined): T | undefined {
        return Array.isArray(value) ? (value as readonly T[])[0] : (value as T | undefined);
    }

    /** Each port or range of ports as the platform writes it: `53`, `0-52`. */
    private static eachPort(ports: Ports): string[] {
        return [ports].flat().map((port) => (typeof port === "number" ? String(port) : `${port.min}-${port.max}`));
    }

    /** One port, a range, or a list of them, as `53,0-52`. */
    private static portList(ports: Ports | undefined): string | undefined {
        if (ports === undefined) return undefined;

        return RouterOsFirewall.eachPort(ports).join(",");
    }

    /** A rate as the switch chip takes it: `2G` becomes `2.0Gbps`. */
    private static bitrate(rate: string): string {
        const match = /^([\d.]+)([kMG])$/.exec(rate);
        if (!match) return rate;

        const [, amount, unit] = match;
        const suffix = unit === "k" ? "kbps" : `${unit}bps`;
        return `${Number(amount).toFixed(1)}${suffix}`;
    }

    /** An IPv4 prefix with a dotted mask, as the switch chip takes it: `10.0.0.0/8` becomes `10.0.0.0/255.0.0.0`. */
    private static dottedMask(cidr: string): string {
        const { addr, len } = Address.split(cidr);
        const mask = len === 0 ? 0 : (0xffffffff << (32 - len)) >>> 0;
        const octets = [24, 16, 8, 0].map((shift) => (mask >>> shift) & 255);
        return `${addr}/${octets.join(".")}`;
    }

    /**
     * Untracked prefixes skip connection tracking in the raw table, both ways. An address NAT uses inside one stays tracked, by an `accept` in each direction before every `notrack`. A reply to it that skipped tracking would never be translated back (TRAPS.md).
     */
    private untracked(family: Family): void {
        const menu = family === "ipv4" ? "/ip firewall raw" : "/ipv6 firewall raw";
        const untracked = (this.device.firewall?.untracked ?? []).filter((prefix) => Address.family(prefix) === family);

        // A pool may hold an untracked prefix, or be inside one.
        const meets = (address: string) =>
            untracked.some((prefix) => Address.contains(prefix, address) || (address.includes("/") && Address.contains(address, prefix)));

        for (const address of RouterOsFirewall.natAddresses(this.device)) {
            if (Address.family(address) !== family || !meets(address)) continue;

            for (const [direction, property] of [
                ["to", "dst-address"],
                ["from", "src-address"],
            ] as const) {
                this.render.add(menu, "add", {
                    action: "accept",
                    chain: "prerouting",
                    comment: `Tracked for NAT, ${direction} ${address}`,
                    [property]: address,
                });
            }
        }

        for (const prefix of untracked) {
            for (const [direction, property] of [
                ["to", "dst-address"],
                ["from", "src-address"],
            ] as const) {
                this.render.add(menu, "add", {
                    action: "notrack",
                    chain: "prerouting",
                    comment: `Untracked ${direction} ${prefix}`,
                    [property]: prefix,
                });
            }
        }
    }

    /** Every address NAT translates to or from: each translation's target, a pool whole, and the address a destination translation matches. Once each, in rule order. */
    private static natAddresses(device: Device): string[] {
        const nat = device.firewall?.nat;
        const translatedTo = (rule: NatRule) => {
            if (rule.then === "masquerade") return [];
            return "to_pool" in rule ? [rule.to_pool] : [Address.host(rule.to_address)];
        };
        const addresses = [
            ...(nat?.source ?? []).flatMap(translatedTo),
            ...(nat?.destination ?? []).flatMap((rule) => {
                const matched = RouterOsFirewall.one(rule.if?.dst);
                return [...(matched ? [matched] : []), ...translatedTo(rule)];
            }),
        ];

        return [...new Set(addresses)];
    }

    /** The families a rule applies to: its `family`, its address's, or both. A rule naming an address set applies only to the families the set has members in. */
    private families(match: FilterMatch | undefined): Family[] {
        const sets = this.device.firewall?.address_sets ?? {};
        const address = RouterOsFirewall.one(match?.src) ?? RouterOsFirewall.one(match?.dst);

        let candidates: Family[] = ["ipv4", "ipv6"];
        if (match?.family) candidates = [match.family];
        else if (address) candidates = [Address.family(address)];

        const setHas = (set: string | undefined, family: Family) =>
            !set || (sets[set] ?? []).some((member) => Address.family(member) === family);
        return candidates.filter((family) => setHas(match?.src_address_set, family) && setHas(match?.dst_address_set, family));
    }

    /** The match properties of a rule, as the platform names them. */
    private matchProperties(match: FilterMatch | undefined, family: Family) {
        const protocol = match?.protocol === "icmp" && family === "ipv6" ? "icmpv6" : match?.protocol;
        const setFlags = match?.tcp_flags?.set ?? [];
        const unsetFlags = (match?.tcp_flags?.unset ?? []).map((flag) => `!${flag}`);
        const flags = match?.tcp_flags ? [...setFlags, ...unsetFlags].join(",") : undefined;
        const inInterface = RouterOsFirewall.one(match?.in_interface);
        const outInterface = RouterOsFirewall.one(match?.out_interface);
        return {
            "connection-nat-state": match?.connection_nat_state?.join(","),
            "connection-state": match?.connection_state?.join(","),
            "dst-address": RouterOsFirewall.one(match?.dst),
            "dst-address-list": match?.dst_address_set,
            "dst-port": RouterOsFirewall.portList(match?.dst_port),
            "in-interface": inInterface && this.render.name(inInterface),
            "out-interface": outInterface && this.render.name(outInterface),
            protocol,
            "src-address": RouterOsFirewall.one(match?.src),
            "src-address-list": match?.src_address_set,
            "src-port": RouterOsFirewall.portList(match?.src_port),
            "tcp-flags": flags,
        };
    }

    private filter(family: Family): void {
        const menu = family === "ipv4" ? "/ip firewall filter" : "/ipv6 firewall filter";

        for (const chain of RouterOsFirewall.CHAINS) {
            const settings = this.device.firewall?.filter?.[chain];
            if (!settings) continue;

            for (const rule of settings.rules ?? []) {
                if (!this.families(rule.if).includes(family)) continue;

                const match = this.matchProperties(rule.if, family);
                // The platform's fast path takes a flow only on IPv4. The accept below still applies on both.
                if (rule.fast_path && family === "ipv4") {
                    this.render.add(menu, "add", { action: "fasttrack-connection", chain, comment: rule.description, ...match });
                }

                this.render.add(menu, "add", { action: rule.then, chain, comment: rule.description, ...match });
            }

            if (settings.default_action === "drop") this.render.add(menu, "add", { action: "drop", chain, comment: "Default" });
        }
    }

    private nat(family: Family): void {
        const menu = family === "ipv4" ? "/ip firewall nat" : "/ipv6 firewall nat";
        const chains: [string, readonly NatRule[] | undefined][] = [
            ["srcnat", this.device.firewall?.nat?.source],
            ["dstnat", this.device.firewall?.nat?.destination],
        ];

        const pools = new Set<string>();

        for (const [chain, rules] of chains) {
            for (const rule of rules ?? []) {
                if (!this.families(rule.if).includes(family)) continue;

                if ("to_pool" in rule) {
                    if (Address.family(rule.to_pool) !== family) continue;

                    this.render.add(menu, "add", {
                        action: "jump",
                        chain,
                        comment: rule.description,
                        "jump-target": RouterOsFirewall.poolChain(rule.to_pool),
                        ...this.matchProperties(rule.if, family),
                    });
                    // Each interface of a set makes a rule of its own, all with the same pool.
                    if (!pools.has(rule.to_pool)) this.pool(menu, rule);
                    pools.add(rule.to_pool);
                    continue;
                }

                // A translation to an address belongs to that address's family.
                if (rule.then !== "masquerade" && Address.family(rule.to_address) !== family) continue;

                const action =
                    rule.then === "masquerade"
                        ? { action: "masquerade" }
                        : {
                              action: rule.then === "snat" ? "src-nat" : "dst-nat",
                              "to-addresses": Address.host(rule.to_address),
                              "to-ports": rule.to_port,
                          };
                this.render.add(menu, "add", { ...action, chain, comment: rule.description, ...this.matchProperties(rule.if, family) });
            }
        }
    }

    /** The chain a NAT pool's rule jumps to, or one of its addresses' chains. */
    private static poolChain(poolOrAddress: string): string {
        return `${RouterOsFirewall.POOL_CHAIN}-${poolOrAddress}`;
    }

    /**
     * A NAT pool, as MikroTik's NAT page writes RFC 7422: the pool's chain jumps to a chain for each pool address, by the subscribers that leave as it. There, each subscriber's TCP and UDP go to its block of ports, and anything else to the address alone.
     */
    private pool(menu: string, rule: PoolNatRule): void {
        const addresses = Derive.poolAddresses(rule);

        for (const { address, subscribers } of addresses) {
            this.render.add(menu, "add", {
                action: "jump",
                chain: RouterOsFirewall.poolChain(rule.to_pool),
                "jump-target": RouterOsFirewall.poolChain(address),
                "src-address": subscribers,
            });
        }

        for (const { address, blocks } of addresses) {
            const chain = RouterOsFirewall.poolChain(address);

            for (const { subscriber, ports } of blocks) {
                for (const protocol of RouterOsFirewall.POOL_PROTOCOLS) {
                    this.render.add(menu, "add", {
                        action: "src-nat",
                        chain,
                        protocol,
                        "src-address": subscriber,
                        "to-addresses": address,
                        "to-ports": `${ports.min}-${ports.max}`,
                    });
                }
            }

            this.render.add(menu, "add", { action: "src-nat", chain, "to-addresses": address });
        }
    }

    /** A TCP MSS clamp rewrites a routed SYN, either way, in the mangle table's forward chain. A fixed MSS only lowers one that offers more. */
    private tcpMss(family: Family): void {
        const menu = family === "ipv4" ? "/ip firewall mangle" : "/ipv6 firewall mangle";

        for (const rule of this.device.firewall?.tcp_mss ?? []) {
            if (!this.families(rule.if).includes(family)) continue;

            const fixed = rule.mss === "path_mtu" ? undefined : rule.mss;
            const properties = {
                action: "change-mss",
                chain: "forward",
                comment: rule.description,
                ...this.matchProperties({ ...rule.if, protocol: "tcp", tcp_flags: { set: ["syn"] } }, family),
                "new-mss": fixed ?? "clamp-to-pmtu",
                "tcp-mss": fixed === undefined ? undefined : `${fixed + 1}-65535`,
            };
            // In the order the device exports them, so the rule reads back the same.
            this.render.add(menu, "add", Object.fromEntries(Object.entries(properties).sort(([a], [b]) => a.localeCompare(b))));
        }
    }

    private helpers(): void {
        const enabled = this.device.firewall?.conntrack_helpers ?? [];

        for (const helper of RouterOsFirewall.HELPERS) {
            this.render.add("/ip firewall service-port", `set ${helper}`, { disabled: RouterOsSyntax.yesNo(!enabled.includes(helper)) });
        }
    }

    /**
     * ACLs run in the switch chip on the port traffic arrives on. The chip matches IPv4 addresses with a dotted mask, drops by forwarding to no port, and limits by rate. A rule takes one port or range, so a list becomes one rule for each.
     */
    private switchAcls(): void {
        for (const { port, rule, srcPort, dstPort } of RouterOsFirewall.switchRules(this.device)) {
            const match = rule.if ?? {};
            const src = RouterOsFirewall.one(match.src);
            const dst = RouterOsFirewall.one(match.dst);
            const vlan = RouterOsFirewall.one(match.vlan);
            const ipv6 = match.family === "ipv6" || [src, dst].some((address) => address && Address.family(address) === "ipv6");
            const address = (prefix: string | undefined) => (prefix && !ipv6 ? RouterOsFirewall.dottedMask(prefix) : prefix);

            this.render.add("/interface ethernet switch rule", "add", {
                comment: rule.description,
                [ipv6 ? "dst-address6" : "dst-address"]: address(dst),
                "dst-port": dstPort,
                "mac-protocol": ipv6 ? "ipv6" : "ip",
                "new-dst-ports": rule.then === "drop" ? "" : undefined,
                ports: this.render.name(port),
                protocol: match.protocol,
                rate: rule.rate && RouterOsFirewall.bitrate(rule.rate),
                [ipv6 ? "src-address6" : "src-address"]: address(src),
                "src-port": srcPort,
                switch: "switch1",
                "vlan-id": vlan && this.render.vlanId(vlan),
            });
        }

        this.ethertypeFilters();
    }

    /**
     * A port that takes only some kinds of frame: a rule that lets each kind through, then one that drops the rest. The chip takes the first rule that matches on the port. So these come after the port's ACL, whose rules match only IPv4 or IPv6.
     */
    private ethertypeFilters(): void {
        for (const { port, ethertypes } of RouterOsFirewall.ethertypeFilters(this.device)) {
            const name = this.render.name(port);

            for (const ethertype of ethertypes) {
                this.render.add("/interface ethernet switch rule", "add", {
                    comment: `${name} takes ${ethertype}`,
                    "mac-protocol": RouterOsFirewall.MAC_PROTOCOLS[ethertype],
                    ports: name,
                    switch: "switch1",
                });
            }

            this.render.add("/interface ethernet switch rule", "add", {
                comment: `${name} takes nothing else`,
                "new-dst-ports": "",
                ports: name,
                switch: "switch1",
            });
        }
    }

    /** The ports with an ethertype filter, with the kinds each takes. Each makes one switch rule per kind and one more. */
    static ethertypeFilters(device: Device): { port: string; ethertypes: readonly Ethertype[] }[] {
        return Derive.ports(device).flatMap(([port, settings]) => (settings.ethertypes ? [{ port, ethertypes: settings.ethertypes }] : []));
    }

    /** Every switch rule the ACLs make, in order: one per port with an ACL, per rule of it, and per source and destination port or range. */
    static switchRules(device: Device): SwitchRule[] {
        const each = (ports: Ports | undefined) => (ports === undefined ? [undefined] : RouterOsFirewall.eachPort(ports));
        const rules: SwitchRule[] = [];

        for (const [port, settings] of Derive.ports(device)) {
            if (!settings.ingress_acl) continue;

            for (const rule of device.switching?.acls?.[settings.ingress_acl] ?? []) {
                for (const srcPort of each(rule.if?.src_port)) {
                    for (const dstPort of each(rule.if?.dst_port)) rules.push({ port, rule, srcPort, dstPort });
                }
            }
        }

        return rules;
    }
}
