import { Derive } from "../core/derive";
import type { Device } from "../model";

type Report = (message: string) => void;

/** VLAN translation as IEEE 802.1Q's VID translation table allows it: one ID on the cable for each VLAN, and each way back unique. */
export class VlanTranslationChecks {
    /** The highest VLAN ID (IEEE 802.1Q): 4095 is reserved. */
    private static readonly MAX_VLAN_ID = 4094;

    static check(device: Device, report: Report): void {
        const vlans = device.switching?.vlans ?? {};

        for (const { where, settings } of Derive.switchedHolders(device)) {
            const translations = settings.vlan_translation;
            if (!translations) continue;
            if (!translations.length)
                report(`${where}.vlan_translation is empty: write each VLAN and the ID it has on this port, or remove it`);

            const trunk = settings.trunk_vlans ?? [];
            // The VLANs the port carries with an ID, by that ID: on the cable, `from` would mean two VLANs at once.
            const carried = new Map(
                [settings.native_vlan, ...trunk].flatMap((name) => (name && vlans[name] ? [[vlans[name].id, name] as const] : []))
            );
            const froms = new Set<number>();
            const tos = new Set<string>();

            translations.forEach(({ from, to }, index) => {
                const at = `${where}.vlan_translation[${index}]`;
                if (!Number.isInteger(from) || from < 1 || from > VlanTranslationChecks.MAX_VLAN_ID)
                    report(`${at}.from ${from} is outside 1-${VlanTranslationChecks.MAX_VLAN_ID}`);
                if (froms.has(from)) report(`${at}.from ${from} is translated twice on the port: write it once`);
                froms.add(from);

                if (!trunk.includes(to))
                    report(`${at}.to ${to} is not in trunk_vlans: the port carries its trunk VLANs only. Add it there`);
                if (tos.has(to)) report(`${at}.to ${to} has two IDs on the port: write it once`);
                tos.add(to);

                const owner = carried.get(from);
                if (owner) report(`${at}.from ${from} is the ID of ${owner}, which the port carries: pick another ID`);
            });
        }
    }
}
