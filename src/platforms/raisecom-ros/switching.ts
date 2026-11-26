// Private VLANs, VLAN translation, the service tag, and ARP inspection on a RAX721. Each was applied to a spare port and read back; see TRAPS.md.

import { Derive } from "../../core/derive";
import type { Device, Port } from "../../model";

export class RaisecomRosSwitching {
    /** The TPID a port takes for 802.1ad's service tag, in hex without `0x`. 0x8100 is the switch's default and prints nothing. */
    private static readonly SERVICE_TAG = "88a8";

    /** Turns ARP inspection on for the whole switch, against what DHCP snooping saw. */
    static readonly ARP_INSPECTION = "ip arp-inspection dhcp-snooping";

    /** Each primary VLAN, by name, with its secondary VLANs. */
    static primaries(device: Device): Map<string, string[]> {
        const primaries = new Map<string, string[]>();

        for (const [name, vlan] of Object.entries(device.switching?.vlans ?? {})) {
            const primary = vlan?.private_vlan?.primary;
            if (primary) primaries.set(primary, [...(primaries.get(primary) ?? []), name]);
        }

        return primaries;
    }

    /** The private VLANs, for the whole switch: each primary, each secondary's kind, and which secondaries are a primary's. */
    static privateVlans(device: Device, vlanId: (name: string) => number, list: (ids: number[]) => string): string[] {
        const vlans = device.switching?.vlans ?? {};
        const primaries = RaisecomRosSwitching.primaries(device);
        const lines = [...primaries.keys()].map((primary) => `private-vlan primary vlan ${vlanId(primary)}`);

        // An isolated VLAN prints on a line of its own, and every community VLAN on one line.
        const secondaries = Object.entries(vlans).flatMap(([name, vlan]) => (vlan?.private_vlan ? [{ name, ...vlan.private_vlan }] : []));
        for (const { name } of secondaries.filter((each) => each.type === "isolated"))
            lines.push(`private-vlan isolated vlan ${vlanId(name)}`);
        const communities = secondaries.filter((each) => each.type === "community").map((each) => vlanId(each.name));
        if (communities.length) lines.push(`private-vlan community vlan ${list(communities)}`);

        for (const [primary, secondaries] of primaries)
            lines.push(`private-vlan association ${vlanId(primary)} ${list(secondaries.map(vlanId))}`);

        return lines;
    }

    /**
     * A port's private VLAN, VLAN translation, and TPID lines, after its VLANs. An access port in a secondary VLAN is a host there. An access port in a primary VLAN is promiscuous, and a trunk that carries a primary VLAN maps its secondaries too.
     */
    static portLines(device: Device, settings: Port, vlanId: (name: string) => number, list: (ids: number[]) => string): string[] {
        const lines: string[] = [];
        const primaries = RaisecomRosSwitching.primaries(device);
        const access = settings.access_vlan;
        const secondary = access ? device.switching?.vlans?.[access]?.private_vlan : undefined;

        if (access && secondary) {
            lines.push(
                "switchport mode private-vlan host",
                `switchport private-vlan host-association ${vlanId(secondary.primary)} ${vlanId(access)}`
            );
        } else if (access && primaries.has(access)) {
            lines.push(
                "switchport mode private-vlan promiscuous",
                `switchport private-vlan mapping ${vlanId(access)} ${list(primaries.get(access)!.map(vlanId))}`
            );
        }

        for (const vlan of settings.trunk_vlans ?? [])
            if (primaries.has(vlan))
                lines.push(`switchport private-vlan mapping ${vlanId(vlan)} ${list(primaries.get(vlan)!.map(vlanId))}`);

        for (const { from, to } of settings.vlan_translation ?? [])
            lines.push(`switchport vlan-mapping both outer ${from} translate ${vlanId(to)}`);

        if (settings.tpid === "0x88a8") lines.push(`tpid ${RaisecomRosSwitching.SERVICE_TAG}`);
        if (device.switching?.arp_inspection && settings.dhcp_trusted) lines.push("ip arp-inspection trust");

        return lines;
    }

    /** Applied to a spare port and read back, but no frame crossed it, and how a trunk or a VLAN interface reaches an isolated host is not known. ARP inspection's switch was only parsed: it turns on for every port at once. */
    static experimental(device: Device): string[] {
        const found: string[] = [];

        for (const [name, vlan] of Object.entries(device.switching?.vlans ?? {}))
            if (vlan?.private_vlan) found.push(`switching.vlans.${name}.private_vlan`);
        if (device.switching?.arp_inspection) found.push("switching.arp_inspection");

        return found;
    }

    /** What was tried on a port alone, or the switch can't do. */
    static unsupported(device: Device): string[] {
        const found: string[] = [];
        const primaries = RaisecomRosSwitching.primaries(device);
        const privateVlan = (vlan: string | undefined) =>
            vlan !== undefined && (primaries.has(vlan) || Boolean(device.switching?.vlans?.[vlan]?.private_vlan));

        for (const [name, lag] of Object.entries(device.interfaces?.lag ?? {})) {
            if (!lag) continue;
            const where = `interfaces.lag.${name}`;

            if (privateVlan(lag.access_vlan) || lag.trunk_vlans?.some((vlan) => primaries.has(vlan)))
                found.push(`${where}, a private VLAN on a LAG, tested on a port alone`);
            if (lag.vlan_translation) found.push(`${where}.vlan_translation, tested on a port alone`);
            if (lag.tpid === "0x88a8") found.push(`${where}.tpid, the switch sets a TPID on a port alone`);
            if (lag.dhcp_trusted && device.switching?.arp_inspection)
                found.push(`${where}.dhcp_trusted beside switching.arp_inspection, ARP inspection's trust was tested on a port alone`);
        }

        for (const { where, settings } of Derive.switchedHolders(device)) {
            const carried = (settings.trunk_vlans ?? []).filter((vlan) => primaries.has(vlan));
            if (carried.length > 1) found.push(`${where}.trunk_vlans, ${carried.length} primary VLANs: a trunk was tested with one`);
            if (settings.qinq_vlan && privateVlan(settings.qinq_vlan)) found.push(`${where}.qinq_vlan, a private VLAN`);
            if (settings.native_vlan && privateVlan(settings.native_vlan))
                found.push(`${where}.native_vlan, a private VLAN as a native VLAN, not tried`);
        }

        // ROS 6.5.2 refused a second tag after `interface vlan <id>`.
        const { innerVlans } = Derive.stackedTags(device);
        for (const where of innerVlans) found.push(`${where}, a VLAN interface here is on one VLAN ID`);

        return found;
    }
}
