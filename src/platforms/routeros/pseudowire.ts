import type { Device } from "../../model";
import { RouterOsSyntax } from "./syntax";

/** What a pseudowire on RouterOS cannot take. The render writes it as a VPLS interface on the bridge. */
export class RouterOsPseudowire {
    /** A pseudowire's L2MTU, the MTU it tells the far PE, when its `mtu` is left out, and the least `mtu` Circuit writes. */
    private static readonly MTU = 1500;

    /** The largest MTU of a VLAN interface on a bridge where a pseudowire runs: `MTU` less a VLAN tag (TRAPS.md). */
    private static readonly VLAN_MTU = 1496;

    static unsupported(device: Device): string[] {
        const found: string[] = [];
        const pseudowires = RouterOsSyntax.entries(device.interfaces?.pseudowire);
        for (const [name, pseudowire] of pseudowires) {
            if (device.switching?.vlans?.[pseudowire.access_vlan]?.private_vlan)
                found.push(
                    `interfaces.pseudowire.${name}.access_vlan ${pseudowire.access_vlan}, a private VLAN, not built for a pseudowire yet`
                );
            // A lower MTU would lower the bridge's VLAN interfaces with it, before which RouterOS refuses it (TRAPS.md).
            if (pseudowire.mtu !== undefined && pseudowire.mtu < RouterOsPseudowire.MTU)
                found.push(
                    `interfaces.pseudowire.${name}.mtu ${pseudowire.mtu}: RouterOS refuses a pseudowire MTU below a VLAN interface's on its bridge with a tag, and the plan does not lower those first. Write ${RouterOsPseudowire.MTU} or more`
                );
        }
        // A running pseudowire's L2MTU is the bridge's, so each VLAN interface on the bridge is lowered to it less a tag (TRAPS.md).
        for (const [name, iface] of pseudowires.length ? RouterOsSyntax.entries(device.interfaces?.vlan_interface) : [])
            if (iface.mtu === undefined || iface.mtu > RouterOsPseudowire.VLAN_MTU)
                found.push(
                    `interfaces.vlan_interface.${name}.mtu ${iface.mtu ?? "left out, 1500"} beside a pseudowire: RouterOS lowers it to ${RouterOsPseudowire.VLAN_MTU} once the pseudowire runs, and refuses more. Write mtu: ${RouterOsPseudowire.VLAN_MTU} or less`
                );
        return found;
    }
}
