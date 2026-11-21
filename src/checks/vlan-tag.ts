import { Derive } from "../core/derive";
import type { Device, Lag, Port } from "../model";

type Report = (message: string) => void;

/** How a port or LAG tags its VLANs beyond a plain trunk: QinQ, its TPID, and VLAN translation as IEEE 802.1Q's VID translation table allows it. A VLAN interface's inner VLAN. */
export class VlanTagChecks {
    /** The highest VLAN ID (IEEE 802.1Q): 4095 is reserved. */
    private static readonly MAX_VLAN_ID = 4094;

    static check(device: Device, report: Report): void {
        for (const { where, settings } of Derive.switchedHolders(device)) {
            VlanTagChecks.qinq(where, settings, device, report);
            VlanTagChecks.translation(where, settings, device, report);
            VlanTagChecks.tpid(where, settings, report);
        }
        VlanTagChecks.innerVlans(device, report);
    }

    /** A TPID is that of the tags a switched port or LAG carries. A LAG's members carry the LAG's. */
    private static tpid(where: string, settings: Port | Lag, report: Report): void {
        if (settings.tpid === undefined) return;

        const lag = (settings as Port).in_lag;
        if (lag) report(`${where}.tpid is on a member of ${lag}: write it on the LAG`);
        else if (!settings.access_vlan && !settings.trunk_vlans && !settings.qinq_vlan)
            report(`${where}.tpid is on a port that switches no VLAN: write it where access_vlan, trunk_vlans, or qinq_vlan is`);
    }

    /** An inner VLAN ID is a VLAN ID, and one VLAN interface ends each inner VLAN of an outer one. */
    private static innerVlans(device: Device, report: Report): void {
        const ended = new Map<string, string>();

        for (const [name, iface] of Object.entries(device.interfaces?.vlan_interface ?? {})) {
            const id = iface?.inner_vlan_id;
            if (!iface || id === undefined) continue;

            const where = `interfaces.vlan_interface.${name}`;
            if (!Number.isInteger(id) || id < 1 || id > VlanTagChecks.MAX_VLAN_ID)
                report(`${where}.inner_vlan_id ${id} is outside 1-${VlanTagChecks.MAX_VLAN_ID}`);

            const pair = `${iface.vlan} ${id}`;
            const other = ended.get(pair);
            if (other) report(`${where} ends inner VLAN ${id} of ${iface.vlan}, as interfaces.vlan_interface.${other} does: keep one`);
            ended.set(pair, name);
        }
    }

    /** A QinQ port is in its one VLAN, outside any private VLAN, and looks into no frame, since each carries the customer's own tags. */
    private static qinq(where: string, settings: Port | Lag, device: Device, report: Report): void {
        const vlan = settings.qinq_vlan;
        if (!vlan) return;

        for (const field of ["access_vlan", "trunk_vlans"] as const)
            if (settings[field]) report(`${where} has qinq_vlan and ${field}: write one of them`);
        for (const field of ["dhcp_trusted", "ra_trusted", "ethertypes", "ingress_acl"] as const)
            if ((settings as Port)[field] !== undefined)
                report(`${where}.${field} is on a QinQ port, whose frames carry the customer's own tags`);

        const vlans = Object.values(device.switching?.vlans ?? {});
        if (device.switching?.vlans?.[vlan]?.private_vlan || vlans.some((other) => other?.private_vlan?.primary === vlan))
            report(`${where}.qinq_vlan ${vlan} is in a private VLAN: give the QinQ port a VLAN of its own`);
    }

    /** One ID on the cable for each translated VLAN, from the port's trunk VLANs, and each way back unique. */
    private static translation(where: string, settings: Port | Lag, device: Device, report: Report): void {
        const translations = settings.vlan_translation;
        if (!translations) return;
        if (!translations.length)
            report(`${where}.vlan_translation is empty: write each VLAN and the ID it has on this port, or remove it`);

        const vlans = device.switching?.vlans ?? {};
        const trunk = settings.trunk_vlans ?? [];
        // The VLANs the port carries with an ID, by that ID: on the cable, `from` would mean two VLANs at once.
        const carried = new Map(
            [settings.native_vlan, ...trunk].flatMap((name) => (name && vlans[name] ? [[vlans[name].id, name] as const] : []))
        );
        const froms = new Set<number>();
        const tos = new Set<string>();

        translations.forEach(({ from, to }, index) => {
            const at = `${where}.vlan_translation[${index}]`;
            if (!Number.isInteger(from) || from < 1 || from > VlanTagChecks.MAX_VLAN_ID)
                report(`${at}.from ${from} is outside 1-${VlanTagChecks.MAX_VLAN_ID}`);
            if (froms.has(from)) report(`${at}.from ${from} is translated twice on the port: write it once`);
            froms.add(from);

            if (!trunk.includes(to)) report(`${at}.to ${to} is not in trunk_vlans: the port carries its trunk VLANs only. Add it there`);
            if (tos.has(to)) report(`${at}.to ${to} has two IDs on the port: write it once`);
            tos.add(to);

            const owner = carried.get(from);
            if (owner) report(`${at}.from ${from} is the ID of ${owner}, which the port carries: pick another ID`);
        });
    }
}
