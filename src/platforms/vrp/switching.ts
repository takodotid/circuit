// Layer 2 on VRP beyond VLANs and LAGs. That is the spanning tree guards, DHCP snooping, ARP inspection, RA guard, QinQ, VLAN translation, the TPID of a port's tags, private VLANs, and ports bound to their hosts. What a CE6855 on V200R005C00SPC800 did with each is in TRAPS.md.

import { Address } from "../../core/address";
import { Derive } from "../../core/derive";
import type { BoundHost, Device, Lag, Port } from "../../model";
import type { Group } from "../line-diff";
import type { Step } from "../platform";
import { VrpAcls } from "./acls";
import { VrpPolicies } from "./policies";

/** A port or LAG bound to its hosts: its name in the config, where it is written, and its settings. */
type Bound = { name: string; where: string; settings: Port | Lag };

export class VrpSwitching {
    /** The most addresses one prefix of a bound host holds: the switch binds a range's addresses one by one, each on a line of its own. */
    private static readonly BOUND_ADDRESSES = 256;

    /** The switch numbers an ACL's rules in steps of 5. */
    private static readonly RULE_STEP = 5;

    /** A bound host's lines: its bindings and its static MAC address. Each gives the port and its VLAN, which the switch checks as the line arrives. */
    private static readonly HOST_LINE = /^(user-bind static|mac-address static) /;

    /** Lines each undone and sent whole, rather than replaced by one that gives another VLAN: a bound host's, a port's VLAN mapping, and a MUX VLAN's. A port leaves a MUX VLAN before it may join another of the group. */
    private static readonly WHOLE = /^(user-bind static|mac-address static|port vlan-mapping|port mux-vlan enable|subordinate) /;

    /** A MUX VLAN's communities, as one list. */
    private static readonly COMMUNITIES = "subordinate group ";

    /** What the switch can't do, or does for every port at once. */
    static unsupported(device: Device): string[] {
        const found: string[] = [];

        // The CE6855 on V200R005 refused `ipv6 nd raguard`, `ipv6 raguard`, and `nd raguard` in every view.
        const noRaGuard = "the platform has no RA guard command";
        if (device.switching?.ra_guard) found.push(`switching.ra_guard, ${noRaGuard}`);
        const holders = Derive.switchedHolders(device).filter(({ settings }) => !("in_lag" in settings && settings.in_lag));
        for (const { where, settings } of holders) if (settings.ra_trusted) found.push(`${where}.ra_trusted, ${noRaGuard}`);
        // Snooping runs on each port, over all of its VLANs.
        for (const { where, settings } of device.switching?.dhcp_snooping ? Derive.switchedHolders(device) : [])
            if (settings.qinq_vlan) found.push(`${where}.qinq_vlan beside switching.dhcp_snooping, which the platform runs on every VLAN`);
        const { tpid, innerVlans } = Derive.stackedTags(device);
        for (const where of tpid) found.push(`${where}, which only RouterOS builds for now`);
        // A CE6855 refused `qinq termination` in a VLAN interface's view, and a sub-interface on a port that is not routed (TRAPS.md).
        for (const where of innerVlans)
            found.push(`${where}, a VLAN interface on V200R005 ends no inner VLAN, and a sub-interface needs a routed port`);
        found.push(...VrpSwitching.privateVlanGaps(device));

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
     * The spanning tree guards, DHCP snooping, and QinQ went into a candidate on a CE6855, so how the switch prints them is not known. The rest was committed with `commit trial` on a spare port and new VLANs, and printed back, but no packet crossed the port.
     */
    static experimental(device: Device): string[] {
        const found: string[] = [];
        if (device.switching?.dhcp_snooping) found.push("switching.dhcp_snooping");
        if (device.switching?.arp_inspection) found.push("switching.arp_inspection");

        for (const { where, settings } of Derive.switchedHolders(device)) {
            const stp = typeof settings.stp === "object" ? settings.stp : undefined;
            if (stp?.bpdu_guard) found.push(`${where}.stp.bpdu_guard`);
            if (stp?.guard) found.push(`${where}.stp.guard`);
            if (settings.dhcp_trusted) found.push(`${where}.dhcp_trusted`);
            if (settings.qinq_vlan) found.push(`${where}.qinq_vlan`);
            if (settings.bound_to) found.push(`${where}.bound_to`);
            if (settings.vlan_translation) found.push(`${where}.vlan_translation`);
        }

        for (const [name, vlan] of Object.entries(device.switching?.vlans ?? {}))
            if (vlan?.private_vlan) found.push(`switching.vlans.${name}.private_vlan`);
        return found;
    }

    /** A bound host's line, a VLAN mapping, and a MUX VLAN's lines are undone and sent whole. */
    static head(line: string): string | undefined {
        return VrpSwitching.WHOLE.test(line) ? line : undefined;
    }

    /**
     * A MUX VLAN's communities change by the VLANs added and removed, as a VLAN list does: the switch adds a list sent again to the one it has. A VLAN that goes takes its place in a MUX VLAN with it. Once the VLAN is gone, the switch refuses to undo that place: "The VLAN does not exist".
     */
    static muxChange(groups: Group[], parse: (list: string) => number[], format: (ids: number[]) => string): void {
        const prefix = VrpSwitching.COMMUNITIES;
        const top = groups.find((group) => group.path.length === 0);
        const batches = (top?.remove ?? []).filter((line) => line.startsWith("vlan batch "));
        const gone = batches.flatMap((line) => parse(line.slice("vlan batch ".length)));

        for (const group of groups) {
            if (!/^vlan \d+$/.test(group.path[0] ?? "")) continue;

            const old = group.remove.find((line) => line.startsWith(prefix));
            const fresh = group.add.find((line) => line.startsWith(prefix));
            const before = old ? parse(old.slice(prefix.length)) : [];
            const after = fresh ? parse(fresh.slice(prefix.length)) : [];
            const removed = before.filter((id) => !after.includes(id) && !gone.includes(id));
            const added = after.filter((id) => !before.includes(id));
            const separateGone = (line: string) => gone.some((id) => line === `subordinate separate ${id}`);

            group.remove = group.remove.filter((line) => line !== old && !separateGone(line));
            if (removed.length) group.remove.push(`${prefix}${format(removed)}`);
            group.add = group.add.filter((line) => line !== fresh);
            if (added.length) group.add.push(`${prefix}${format(added)}`);
        }
    }

    /** Each port that leaves a MUX VLAN does so first, taken out of its own step. The switch refuses to remove a VLAN a port is in: "Please disable MUX-VLAN on the port first". */
    static leaveMux(groups: Group[], current: string): Step[] {
        const leave = (header: string, lines: string[]): Step => ({
            title: `${header}, out of its MUX VLAN`,
            show: lines.map((line) => `- ${line}`),
            send: [header, ...lines.map((line) => `undo ${line}`), "quit"],
        });
        const isMux = (line: string) => line.startsWith("port mux-vlan enable ");
        const steps: Step[] = [];

        // A LAG that goes takes its lines with its header, so they are read from the device.
        const top = groups.find((group) => group.path.length === 0);
        for (const header of top?.remove.filter((line) => line.startsWith("interface Eth-Trunk")) ?? []) {
            const block = current.split(`\n${header}\n`)[1]?.split("\n#")[0] ?? "";
            const lines = block
                .split("\n")
                .map((line) => line.trim())
                .filter(isMux);
            if (lines.length) steps.push(leave(header, lines));
        }

        for (const group of groups) {
            const [header] = group.path;
            const lines = group.remove.filter(isMux);
            if (!header?.startsWith("interface ") || group.path.length !== 1 || !lines.length) continue;

            group.remove = group.remove.filter((line) => !lines.includes(line));
            steps.push(leave(header, lines));
        }

        return steps;
    }

    /** The VLANs a plan removes, a MUX VLAN's subordinate VLANs in a list before the rest. The switch refuses to remove a VLAN that still has them: "Delete the configurations of the subordinate VLAN first". */
    static subordinatesFirst(ids: readonly number[], current: string, parse: (list: string) => number[]): number[][] {
        const lists = [...current.matchAll(/^ subordinate (?:separate|group) (.+)$/gm)].map((match) => match[1]!.trim());
        const subordinates = new Set(lists.flatMap(parse));
        const first = ids.filter((id) => subordinates.has(id));
        const rest = ids.filter((id) => !subordinates.has(id));
        return [first, rest].filter((list) => list.length);
    }

    /**
     * A VLAN's own lines. A private VLAN's primary VLAN is a MUX VLAN, with its isolated VLAN as `subordinate separate` and its communities as `subordinate group`, a list written as `vlan batch` writes one. ARP inspection runs on a whole VLAN, and not on a port.
     */
    static vlanLines(device: Device, name: string, batch: (ids: number[]) => string): string[] {
        const lines: string[] = [];
        const secondaries = Object.values(device.switching?.vlans ?? {}).filter((vlan) => vlan?.private_vlan?.primary === name);

        if (secondaries.length) {
            const ofType = (type: string) => secondaries.flatMap((vlan) => (vlan?.private_vlan?.type === type ? [vlan.id] : []));
            const [isolated] = ofType("isolated");
            const communities = ofType("community");
            lines.push("mux-vlan");
            if (isolated !== undefined) lines.push(`subordinate separate ${isolated}`);
            if (communities.length) lines.push(`${VrpSwitching.COMMUNITIES}${batch(communities)}`);
        }

        if (device.switching?.arp_inspection) lines.push("arp anti-attack check user-bind enable");
        return lines;
    }

    /**
     * A port's or a LAG's own lines. A trunk maps each VLAN it translates, `port vlan-mapping vlan <on the cable> map-vlan <VLAN>`, which the switch does both ways. An access port of a private VLAN joins its MUX VLAN, and a bound port binds its hosts.
     */
    static portLines(device: Device, name: string, settings: Port | Lag): string[] {
        const lines: string[] = [];
        for (const { from, to } of settings.vlan_translation ?? [])
            lines.push(`port vlan-mapping vlan ${from} map-vlan ${device.switching?.vlans?.[to]?.id}`);

        const access = settings.access_vlan;
        const id = access ? device.switching?.vlans?.[access]?.id : undefined;
        if (access && VrpSwitching.inPrivateVlan(device, access)) lines.push(`port mux-vlan enable vlan ${id}`);

        return [...lines, ...VrpSwitching.boundPortLines(name, settings)];
    }

    /** A bound port learns no MAC address, and drops a frame from any MAC address but its static ones. It checks each IPv4 packet against its bindings, and each IPv6 packet against its ACL6. */
    private static boundPortLines(name: string, settings: Port | Lag): string[] {
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

    /**
     * A private VLAN is a MUX VLAN on access ports. Huawei's guide carries a MUX VLAN between switches on a trunk with each secondary VLAN on it too. How a trunk of the primary VLAN alone carries it is not known. Huawei's guide says a MAC limit on a port breaks a MUX VLAN, and a CE6855 refused a static MAC address in one.
     */
    private static privateVlanGaps(device: Device): string[] {
        const found: string[] = [];

        // A CE6855 refused `subordinate separate` for a VLAN with ARP inspection: "The VLAN has been configured to DAI attribute".
        for (const [name, vlan] of Object.entries(device.switching?.vlans ?? {}))
            if (vlan?.private_vlan && device.switching?.arp_inspection)
                found.push(
                    `switching.vlans.${name}.private_vlan beside switching.arp_inspection, as the switch takes no VLAN that inspects ARP into a MUX VLAN`
                );

        for (const { where, settings } of Derive.switchedHolders(device)) {
            for (const vlan of [...(settings.trunk_vlans ?? []), ...(settings.native_vlan ? [settings.native_vlan] : [])])
                if (VrpSwitching.inPrivateVlan(device, vlan))
                    found.push(
                        `${where}.trunk_vlans ${vlan}, a private VLAN on a trunk: VRP builds it as a MUX VLAN on access ports only, as how a trunk carries one is not known`
                    );

            if (!settings.access_vlan || !VrpSwitching.inPrivateVlan(device, settings.access_vlan)) continue;
            if (settings.mac_limit !== undefined) found.push(`${where}.mac_limit in a private VLAN, which a MAC limit breaks on VRP`);
            if (settings.bound_to) found.push(`${where}.bound_to in a private VLAN: the switch takes no static MAC address in a MUX VLAN`);
        }

        return found;
    }

    /** A private VLAN's primary VLAN, or one of its secondary VLANs. */
    private static inPrivateVlan(device: Device, name: string): boolean {
        const vlans = Object.values(device.switching?.vlans ?? {});
        return Boolean(device.switching?.vlans?.[name]?.private_vlan) || vlans.some((vlan) => vlan?.private_vlan?.primary === name);
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
