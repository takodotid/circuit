// Routed ports on VRP. A port with addresses leaves layer 2 with `undo portswitch`, and the switch gives it a VLAN of its own from the range `switching.reserved_vlans` reserves. What a CE6855 on V200R005C00SPC800 did with each is in TRAPS.md.

import { Address } from "../../core/address";
import { Derive } from "../../core/derive";
import type { Device, Port } from "../../model";
import { LineDiff } from "../line-diff";
import type { Dialect, Group } from "../line-diff";
import type { Step } from "../platform";

export class VrpRoutedPorts {
    /** The line that reserves VLANs for routed ports, before its range: `vlan reserved for main-interface 4000 to 4063`. */
    static readonly RESERVED = "vlan reserved for main-interface ";

    /** A CE6855 refused VLAN 1, its default VLAN, and 4064 to 4094, which it keeps for its own services. */
    private static readonly RANGE = { min: 2, max: 4063 };

    /** The layer 3 settings a port has only when it routes. */
    private static readonly ROUTED = ["urpf", "vrrp", "vrf", "ipv6_ra"] as const;

    /** The layer 2 settings, which a routed port has no use for. */
    private static readonly SWITCHED = [
        "stp",
        "storm_control",
        "mac_limit",
        "ethertypes",
        "bound_to",
        "dhcp_trusted",
        "ra_trusted",
        "tpid",
        "vlan_translation",
    ] as const;

    /** Whether a port routes: it has an address. */
    static routes(port: Port): boolean {
        return Boolean(port.addresses?.length);
    }

    /** The routed port of that name, or undefined when it is none. */
    static port(device: Device, name: string): Port | undefined {
        const port = device.interfaces?.ethernet?.[name];
        return port && VrpRoutedPorts.routes(port) ? port : undefined;
    }

    /** The range the switch reserves for routed ports, or nothing without one. */
    static lines(device: Device): string[] {
        const range = device.switching?.reserved_vlans;
        return range ? [`${VrpRoutedPorts.RESERVED}${range.min} to ${range.max}`] : [];
    }

    /** What the switch refuses: a routed port without a range, more routed ports than it holds, a range it doesn't take, and layer 2 on a routed port. */
    static unsupported(device: Device): string[] {
        const found: string[] = [];
        const range = device.switching?.reserved_vlans;
        const { min, max } = VrpRoutedPorts.RANGE;
        // A CE6855 refused `vlan reserved for main-interface 1 to 2`, `4060 to 4070`, and `3950 to 3950`.
        if (range && (range.min < min || range.max > max))
            found.push(
                `switching.reserved_vlans, from ${min} to ${max} on the platform: VLAN 1 is the switch's default VLAN, and it keeps 4064 to 4094 for its own services`
            );
        if (range && range.min === range.max) found.push("switching.reserved_vlans, one VLAN: the switch takes a range of two at least");

        const routed = Derive.ports(device).filter(([, port]) => VrpRoutedPorts.routes(port));
        const size = range ? range.max - range.min + 1 : 0;
        if (range && routed.length > size)
            found.push(
                `switching.reserved_vlans, ${size} VLANs for ${routed.length} routed ports: the switch takes a VLAN of the range for each routed port. Widen it`
            );

        for (const [name, port] of Derive.ports(device)) {
            const where = `interfaces.ethernet.${name}`;
            if (!VrpRoutedPorts.routes(port)) {
                for (const field of VrpRoutedPorts.ROUTED)
                    if (port[field] !== undefined)
                        found.push(`${where}.${field}, on a port without addresses: a port routes once it has them`);
                continue;
            }

            if (!range)
                found.push(
                    `${where}.addresses, a routed port: the switch routes a port only on a VLAN it reserves for routed ports. Write switching.reserved_vlans, such as { min: 4000, max: 4063 }, a range no VLAN of the switch is in`
                );
            for (const field of VrpRoutedPorts.SWITCHED)
                if (port[field] !== undefined) found.push(`${where}.${field}, on a routed port, which switches no frame`);
            for (const group of port.vrrp ?? []) if (Address.family(group.address) === "ipv6") found.push(`${where}.vrrp for IPv6`);
        }

        return found;
    }

    /** A routed port that sFlow samples: no switch has sampled one yet. */
    static experimental(device: Device): string[] {
        const flow = device.monitoring?.flow_export;
        if (flow?.protocol !== "sflow") return [];

        return Derive.ports(device)
            .filter(([name, port]) => VrpRoutedPorts.routes(port) && (!flow.interfaces || flow.interfaces.includes(name)))
            .map(([name]) => `monitoring.flow_export on the routed port ${name}`);
    }

    /**
     * A range that goes is undone once no routed port is on it, as the switch refuses to let go of a range a routed port has a VLAN of. Such a port keeps its VLAN. So a range changes in one apply only while no port routes, or while the ports stop routing and the new range is apart from the old.
     */
    static order(groups: Group[], desired: string, current: string, dialect: Dialect): { last: Step[]; problems: string[] } {
        const top = groups.find((group) => group.path.length === 0);
        if (!top) return { last: [], problems: [] };

        // A VRF goes once the ports and interfaces let go of it: undoing it first takes their addresses, and the switch then refuses their own undos.
        const vrfs = VrpRoutedPorts.taken(top, "VRFs no longer used", (line) => /^ip vpn-instance \S+$/.test(line));
        const gone = top.remove.filter((line) => line.startsWith(VrpRoutedPorts.RESERVED));
        const routedNow = VrpRoutedPorts.routedIn(current, dialect);
        if (!gone.length || !routedNow.length) return { last: vrfs, problems: [] };

        const added = top.add.filter((line) => line.startsWith(VrpRoutedPorts.RESERVED));
        const overlaps = gone.some((old) => added.some((fresh) => VrpRoutedPorts.overlap(old, fresh)));
        if (overlaps || VrpRoutedPorts.routedIn(desired, dialect).length)
            return {
                last: [],
                problems: [
                    `switching.reserved_vlans changes while ${routedNow.join(", ")} routes on a VLAN of the old range, which the switch keeps until no routed port is on it. Apply the config without routed ports first, then with the new range and them`,
                ],
            };

        const ranges = VrpRoutedPorts.taken(top, "Reserved VLANs no longer used", (line) => line.startsWith(VrpRoutedPorts.RESERVED));
        return { last: [...vrfs, ...ranges], problems: [] };
    }

    /** The top level's removals that `which` matches, taken out of it into a step of their own. None when nothing goes. */
    private static taken(top: Group, title: string, which: (line: string) => boolean): Step[] {
        const gone = top.remove.filter(which);
        top.remove = top.remove.filter((line) => !which(line));
        return gone.length ? [{ title, show: gone.map((line) => `- ${line}`), send: gone.map((line) => `undo ${line}`) }] : [];
    }

    /** The ports a config routes: each `interface` block with `undo portswitch`. */
    private static routedIn(text: string, dialect: Dialect): string[] {
        return LineDiff.entries(text, dialect)
            .filter((entry) => entry.line === "undo portswitch" && entry.path.length === 1)
            .map((entry) => entry.path[0]!.replace(/^interface /, ""));
    }

    /** Whether two ranges share a VLAN. */
    private static overlap(one: string, other: string): boolean {
        const [first = 0, last = 0] = VrpRoutedPorts.bounds(one);
        const [otherFirst = 0, otherLast = 0] = VrpRoutedPorts.bounds(other);
        return first <= otherLast && otherFirst <= last;
    }

    private static bounds(line: string): number[] {
        return line.slice(VrpRoutedPorts.RESERVED.length).split(" to ").map(Number);
    }
}
