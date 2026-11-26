import { Catalog } from "../../core/catalog";
import { Derive } from "../../core/derive";
import type { Device, Port } from "../../model";
import type { RouterOsRender } from "./render";
import { RouterOsSyntax } from "./syntax";
import { RouterOsVlanTags } from "./vlan-tags";

/** One VLAN a port translates. It holds where it is written, the port as the device names it, and the ID on its cable. Then the VLAN it means, and the VLAN interface that translates it. */
type Translation = { where: string; port: string; settings: Port; from: number; to: string; name: string };

/**
 * VLAN translation, IEEE 802.1Q's VID translation. The bridge changes no VLAN ID. So a VLAN interface on the port takes the frames of the ID on its cable before the bridge does. It joins the bridge untagged in the VLAN they mean (TRAPS.md).
 */
export class RouterOsVlanTranslation {
    /** Each translation of a port outside a LAG, in the order the ports and their translations are written. */
    static of(device: Device): Translation[] {
        return Derive.ports(device).flatMap(([key, settings]) => {
            if (settings.in_lag || !settings.vlan_translation) return [];
            const port = Catalog.spell(device.platform, device.model, key);
            return settings.vlan_translation.map(({ from, to }) => ({
                where: `interfaces.ethernet.${key}`,
                port,
                settings,
                from,
                to,
                name: `${port}-vlan${from}`,
            }));
        });
    }

    /** The VLAN interfaces on the ports, which go before the bridge ports that name them. */
    static vlanInterfaces(render: RouterOsRender, device: Device): void {
        for (const { port, from, name } of RouterOsVlanTranslation.of(device))
            render.add("/interface vlan", "add", { interface: port, name, "vlan-id": from });
    }

    /** Each VLAN interface is a bridge port, untagged in the VLAN it means, and trusted as its port is. */
    static bridgePorts(render: RouterOsRender, device: Device): void {
        for (const { settings, to, name } of RouterOsVlanTranslation.of(device))
            render.add("/interface bridge port", "add", {
                bridge: RouterOsVlanTags.BRIDGE,
                "frame-types": "admit-only-untagged-and-priority-tagged",
                interface: name,
                pvid: render.vlanId(to),
                trusted: RouterOsSyntax.yesWhen(settings.dhcp_trusted),
                "trusted-ra": RouterOsSyntax.yesWhen(settings.ra_trusted),
            });
    }

    /**
     * What was not tried: a LAG, and a switch rule, which sees the ID on the cable. What can't work: spanning tree, since the VLAN interface sends BPDUs of its own, which `stp: false` doesn't stop (TRAPS.md). A VLAN interface's name another interface has.
     */
    static unsupported(device: Device): string[] {
        const found: string[] = [];

        for (const [name, lag] of RouterOsSyntax.entries(device.interfaces?.lag))
            if (lag.vlan_translation) found.push(`interfaces.lag.${name}.vlan_translation, on a LAG, which is not tested on a device yet`);

        for (const [name, port] of Derive.ports(device)) {
            if (!port.vlan_translation) continue;
            const where = `interfaces.ethernet.${name}`;
            if (port.in_lag) found.push(`${where}.vlan_translation, on a LAG member, which is not tested on a device yet`);
            if (device.switching?.stp)
                found.push(
                    `${where}.vlan_translation beside switching.stp: RouterOS translates with a VLAN interface on the port, which sends BPDUs of its own, tagged with the ID on the cable, even with stp: false. Remove one of them`
                );
            for (const field of ["ethertypes", "ingress_acl"] as const)
                if (port[field] !== undefined) found.push(`${where}.${field} beside vlan_translation, not tested on a device yet`);
        }

        const taken = new Set([
            ...Derive.interfaces(device).map(({ name }) => name),
            ...Catalog.devicePorts(device).map((port) => Catalog.spell(device.platform, device.model, port)),
        ]);
        for (const { where, from, name } of RouterOsVlanTranslation.of(device))
            if (taken.has(name))
                found.push(
                    `${where}.vlan_translation from ${from}: RouterOS names the VLAN interface that translates it ${name}, which another interface has. Rename that one`
                );

        return found;
    }
}
