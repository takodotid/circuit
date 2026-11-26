// Layer 2 on VRP beyond VLANs and LAGs: the spanning tree guards, DHCP snooping, ARP inspection, RA guard, QinQ, VLAN translation, the TPID of a port's tags, and private VLANs. What a CE6855 on V200R005C00SPC800 did with each is in TRAPS.md.

import { Derive } from "../../core/derive";
import type { Device, Lag, Port } from "../../model";

export class VrpSwitching {
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

        return found;
    }

    /** The spanning tree guards, DHCP snooping, and QinQ went into a candidate on a CE6855, so how the switch prints them is not known. */
    static experimental(device: Device): string[] {
        const found: string[] = [];
        if (device.switching?.dhcp_snooping) found.push("switching.dhcp_snooping");

        for (const { where, settings } of Derive.switchedHolders(device)) {
            const stp = typeof settings.stp === "object" ? settings.stp : undefined;
            if (stp?.bpdu_guard) found.push(`${where}.stp.bpdu_guard`);
            if (stp?.guard) found.push(`${where}.stp.guard`);
            if (settings.dhcp_trusted) found.push(`${where}.dhcp_trusted`);
            if (settings.qinq_vlan) found.push(`${where}.qinq_vlan`);
        }

        return found;
    }
}
