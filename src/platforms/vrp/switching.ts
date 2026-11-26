// Layer 2 on VRP beyond VLANs and LAGs. That is the spanning tree guards, DHCP snooping, ARP inspection, RA guard, QinQ, VLAN translation, the TPID of a port's tags, private VLANs, and ports bound to their hosts. What a CE6855 on V200R005C00SPC800 did with each is in TRAPS.md.

import { Address } from "../../core/address";
import { Derive } from "../../core/derive";
import type { BoundHost, Device, Lag, Port } from "../../model";
import type { Group } from "../line-diff";
import { VrpAcls } from "./acls";
import { VrpPolicies } from "./policies";

/** A port or LAG bound to its hosts: its name in the config, where it is written, and its settings. */
type Bound = { name: string; where: string; settings: Port | Lag };

export class VrpSwitching {
    /** The most addresses one prefix of a bound host holds: the switch binds a range's addresses one by one, each on a line of its own. */
    private static readonly BOUND_ADDRESSES = 256;

    /** The switch numbers an ACL's rules in steps of 5. */
    private static readonly RULE_STEP = 5;

    /** A bound host's lines: its bindings and its static MAC address. Each gives the port and its VLAN, which the switch checks as the line arrives, and each is undone and sent whole. */
    private static readonly HOST_LINE = /^(user-bind static|mac-address static) /;

    /** What the switch can't do, or does for every port at once. */
    static unsupported(device: Device): string[] {
        const found: string[] = [];

        // The CE6855 on V200R005 refused `ipv6 nd raguard`, `ipv6 raguard`, and `nd raguard` in every view.
        const noRaGuard = "the platform has no RA guard command";
        if (device.switching?.ra_guard) found.push(`switching.ra_guard, ${noRaGuard}`);
        const holders = Derive.switchedHolders(device).filter(({ settings }) => !("in_lag" in settings && settings.in_lag));
        for (const { where, settings } of holders) if (settings.ra_trusted) found.push(`${where}.ra_trusted, ${noRaGuard}`);
        // The CE6855 took `arp anti-attack check user-bind enable` in a VLAN's view only (TRAPS.md).
        if (device.switching?.arp_inspection)
            found.push("switching.arp_inspection, the platform checks a whole VLAN, and whether it passes dhcp_trusted ports is not known");
        // Snooping runs on each port, over all of its VLANs.
        for (const { where, settings } of device.switching?.dhcp_snooping ? Derive.switchedHolders(device) : [])
            if (settings.qinq_vlan) found.push(`${where}.qinq_vlan beside switching.dhcp_snooping, which the platform runs on every VLAN`);
        for (const { where, settings } of Derive.switchedHolders(device))
            if (settings.vlan_translation) found.push(`${where}.vlan_translation, which only Junos builds for now`);
        const { tpid, innerVlans } = Derive.stackedTags(device);
        for (const where of tpid) found.push(`${where}, which only RouterOS builds for now`);
        // A CE6855 refused `qinq termination` in a VLAN interface's view, and a sub-interface on a port that is not routed (TRAPS.md).
        for (const where of innerVlans)
            found.push(`${where}, a VLAN interface on V200R005 ends no inner VLAN, and a sub-interface needs a routed port`);
        // MUX VLAN, the platform's counterpart, went into a CE6855's candidate, but how a trunk carries it is not known (TRAPS.md).
        for (const [name, vlan] of Object.entries(device.switching?.vlans ?? {}))
            if (vlan?.private_vlan) found.push(`switching.vlans.${name}.private_vlan, which only Junos and RouterOS build for now`);

        // `stp bpdu-protection` guards every edge port at once.
        const stpOf = (settings: Port | Lag) => (typeof settings.stp === "object" ? settings.stp : undefined);
        const edges = holders.filter(({ settings }) => stpOf(settings)?.edge);
        if (edges.some(({ settings }) => stpOf(settings)?.bpdu_guard)) {
            for (const { where, settings } of edges)
                if (!stpOf(settings)?.bpdu_guard)
                    found.push(`${where}.stp without bpdu_guard, the platform guards every edge port or none: write it on each`);
        }

        found.push(...VrpSwitching.boundGaps(device));
        return found;
    }

    /**
     * The spanning tree guards, DHCP snooping, and QinQ went into a candidate on a CE6855, so how the switch prints them is not known. A bound port was committed with `commit trial` on a spare port and printed back, but no packet crossed it.
     */
    static experimental(device: Device): string[] {
        const found: string[] = [];
        if (device.switching?.dhcp_snooping) found.push("switching.dhcp_snooping");

        for (const { where, settings } of Derive.switchedHolders(device)) {
            const stp = typeof settings.stp === "object" ? settings.stp : undefined;
            if (stp?.bpdu_guard) found.push(`${where}.stp.bpdu_guard`);
            if (stp?.guard) found.push(`${where}.stp.guard`);
            if (settings.dhcp_trusted) found.push(`${where}.dhcp_trusted`);
            if (settings.qinq_vlan) found.push(`${where}.qinq_vlan`);
            if (settings.bound_to) found.push(`${where}.bound_to`);
        }

        return found;
    }

    /** A binding and a static MAC address are undone and sent whole, rather than replaced by a line that gives another VLAN. */
    static head(line: string): string | undefined {
        return VrpSwitching.HOST_LINE.test(line) ? line : undefined;
    }

    /** A bound port learns no MAC address, and drops a frame from any MAC address but its static ones. It checks each IPv4 packet against its bindings, and each IPv6 packet against its ACL6. */
    static boundPortLines(name: string, settings: Port | Lag): string[] {
        if (!settings.bound_to) return [];

        return [
            "mac-address learning disable action discard",
            "ip source check user-bind enable",
            `traffic-filter ipv6 acl ${VrpSwitching.boundAcl(name)} inbound`,
        ];
    }

    /**
     * Each host's IPv4 addresses bound to its MAC address, its port, and its VLAN, a prefix's address by address. Then the MAC address as a static one. Each is as the switch prints it: `user-bind static ip-address 192.0.2.10 mac-address 0200-0000-000a interface 10GE1/0/48 vlan 3981`. `0.0.0.0`, which a host sends DHCP from, is bound to nothing.
     */
    static boundLines(device: Device, nameOf: (name: string) => string): string[] {
        const lines: string[] = [];

        for (const { name, settings } of VrpSwitching.bound(device)) {
            const vlan = device.switching?.vlans?.[settings.access_vlan ?? ""]?.id;
            const iface = nameOf(name);

            for (const host of settings.bound_to ?? []) {
                const mac = VrpSwitching.mac(host.mac);
                for (const address of VrpSwitching.ipv4Of(host))
                    lines.push(`user-bind static ip-address ${address} mac-address ${mac} interface ${iface} vlan ${vlan}`);
                lines.push(`mac-address static ${mac} ${iface} vlan ${vlan}`);
            }
        }

        return lines;
    }

    /** Each bound port's ACL6, named after it: the IPv6 sources its hosts may send from, then nothing else. */
    static boundAcls(device: Device): string[] {
        const lines: string[] = [];

        for (const { name, settings } of VrpSwitching.bound(device)) {
            const sources = [...new Set((settings.bound_to ?? []).flatMap((host) => Derive.boundSources(host).ipv6))];
            const rules = [...sources.map((source) => `permit ipv6 source ${VrpPolicies.spell(Address.prefixOf(source))}`), "deny ipv6"];
            lines.push(
                `acl ipv6 name ${VrpSwitching.boundAcl(name)} advance`,
                ...rules.map((rule, index) => ` rule ${(index + 1) * VrpSwitching.RULE_STEP} ${rule}`),
                "#"
            );
        }

        return lines;
    }

    /**
     * The bound hosts' lines the top level adds and removes, taken out of it. They go once their LAGs exist and their ports are in their VLANs, and go away before anything else (`VrpRoutes.place`). The switch refuses a binding to a LAG that does not exist yet, and a static MAC address for a port outside its VLAN.
     */
    static hostLines(top: Group | undefined): { add: string[]; remove: string[] } {
        if (!top) return { add: [], remove: [] };

        const isHost = (line: string) => VrpSwitching.HOST_LINE.test(line);
        const taken = { add: top.add.filter(isHost), remove: top.remove.filter(isHost) };
        top.add = top.add.filter((line) => !isHost(line));
        top.remove = top.remove.filter((line) => !isHost(line));
        return taken;
    }

    /** What a bound port can't hold here. */
    private static boundGaps(device: Device): string[] {
        const found: string[] = [];
        const isIpv4 = (address: string) => Address.family(Address.host(address)) === "ipv4";

        for (const { where, settings } of VrpSwitching.bound(device)) {
            const hosts = settings.bound_to ?? [];
            // A CE6855 refused `ipv6 source check user-bind enable` in a port's and in a VLAN's view: only the port's ACL6 checks an IPv6 source, whichever host sends it.
            if (hosts.length > 1 && hosts.some((host) => host.addresses.some((address) => !isIpv4(address))))
                found.push(
                    `${where}.bound_to, IPv6 addresses on a port of more than one host: V200R005 ties no IPv6 address to a MAC address, so bind one host`
                );

            hosts.forEach((host, index) => {
                for (const address of host.addresses.filter(isIpv4))
                    if (VrpSwitching.count(address) > VrpSwitching.BOUND_ADDRESSES)
                        found.push(
                            `${where}.bound_to[${index}].addresses ${address}, over ${VrpSwitching.BOUND_ADDRESSES} addresses: the switch binds each address on a line of its own`
                        );
            });

            if (settings.mac_limit !== undefined) found.push(`${where}.mac_limit beside bound_to, as a bound port learns no MAC address`);
            const acl = "ingress_acl" in settings ? settings.ingress_acl : undefined;
            if (VrpAcls.portLines(device, acl).some((line) => line.includes(" ipv6 acl ")))
                found.push(`${where}.ingress_acl with IPv6 rules beside bound_to, as the port takes one ACL6, its hosts'`);
        }

        return found;
    }

    /** The ports and LAGs bound to their hosts. */
    private static bound(device: Device): Bound[] {
        const ports = Derive.ports(device).map(([name, settings]): Bound => ({ name, where: `interfaces.ethernet.${name}`, settings }));
        const lags = Object.entries(device.interfaces?.lag ?? {}).flatMap(([name, settings]): Bound[] =>
            settings ? [{ name, where: `interfaces.lag.${name}`, settings }] : []
        );
        return [...ports, ...lags].filter(({ settings }) => settings.bound_to);
    }

    /** A bound port's ACL6, named after it: `bound-10g-48`. */
    private static boundAcl(name: string): string {
        return `bound-${name}`;
    }

    /** A MAC address as the switch prints it: `0200-0000-000a`. */
    private static mac(mac: string): string {
        const hex = mac.toLowerCase().replace(/[^0-9a-f]/g, "");
        return [hex.slice(0, 4), hex.slice(4, 8), hex.slice(8)].join("-");
    }

    /** How many addresses an address or a prefix holds. */
    private static count(address: string): bigint {
        const { first, last } = Address.range(Address.withLength(address));
        return last - first + 1n;
    }

    /** A host's IPv4 addresses, a prefix's one by one. A prefix `unsupported()` refuses for its size gives none. */
    private static ipv4Of(host: BoundHost): string[] {
        return host.addresses
            .filter((address) => Address.family(Address.host(address)) === "ipv4")
            .flatMap((address) => {
                if (VrpSwitching.count(address) > VrpSwitching.BOUND_ADDRESSES) return [];

                const { first, last } = Address.range(Address.withLength(address));
                const each: string[] = [];
                for (let value = first; value <= last; value++) each.push(Address.fromNumber(value, "ipv4"));
                return each;
            });
    }
}
