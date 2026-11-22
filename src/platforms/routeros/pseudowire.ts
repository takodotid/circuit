import type { Device } from "../../model";
import type { RouterOsRender } from "./render";
import { RouterOsSyntax } from "./syntax";
import { RouterOsVlanTags } from "./vlan-tags";

/** Pseudowires on RouterOS: what they cannot take, and the VPLSs whose PEs BGP finds. The render writes each pseudowire as a VPLS interface on the bridge. */
export class RouterOsPseudowire {
    /** The split horizon of every pseudowire, so a frame from one never leaves by another (RFC 4762, section 4.4; RFC 4761, section 4). */
    static readonly HORIZON = 2;

    /** A pseudowire's L2MTU, the MTU it tells the far PE when its `mtu` is left out, and the least `mtu` Circuit writes. */
    private static readonly MTU = 1500;

    /** The largest MTU of a VLAN interface on a bridge where a pseudowire runs: `MTU` less a VLAN tag (TRAPS.md). */
    private static readonly VLAN_MTU = 1496;

    /**
     * A VLAN with `vpls` is a BGP VPLS entry named after the VLAN. Each pseudowire it sets up is a port of the VLAN, untagged, in the pseudowires' split horizon. With `vpls_id`, MikroTik's `cisco-id` is the PE's address, its LSR ID, and the VPLS-id (RFC 6074, section 3.2.1).
     */
    static render(render: RouterOsRender, device: Device): void {
        const lsrId = device.routing?.mpls?.ldp?.lsr_id;
        for (const [name, vlan] of RouterOsSyntax.entries(device.switching?.vlans)) {
            const vpls = vlan.vpls;
            if (!vpls) continue;

            render.add("/routing bgp vpls", "add", {
                bridge: RouterOsVlanTags.BRIDGE,
                "bridge-horizon": RouterOsPseudowire.HORIZON,
                "bridge-pvid": vlan.id,
                "cisco-id": vpls.vpls_id && `${lsrId}&${vpls.vpls_id}`,
                "export-route-targets": vpls.route_targets.export?.join(","),
                "import-route-targets": vpls.route_targets.import?.join(","),
                name,
                rd: vpls.route_distinguisher,
                "site-id": vpls.site_id,
            });
        }
    }

    /** The VLANs in a VPLS whose PEs BGP finds. */
    static vplsVlans(device: Device): string[] {
        return RouterOsSyntax.entries(device.switching?.vlans).flatMap(([name, vlan]) => (vlan.vpls ? [name] : []));
    }

    static unsupported(device: Device): string[] {
        const found: string[] = [];
        const pseudowires = RouterOsSyntax.entries(device.interfaces?.pseudowire);
        const vplsVlans = RouterOsPseudowire.vplsVlans(device);
        for (const [name, pseudowire] of pseudowires) {
            const at = `interfaces.pseudowire.${name}`;
            const access = pseudowire.access_vlan;
            if (access && device.switching?.vlans?.[access]?.private_vlan)
                found.push(`${at}.access_vlan ${access}, a private VLAN, not built for a pseudowire yet`);
            // A lower MTU would lower the bridge's VLAN interfaces with it, before which RouterOS refuses it (TRAPS.md).
            if (pseudowire.mtu !== undefined && pseudowire.mtu < RouterOsPseudowire.MTU)
                found.push(
                    `${at}.mtu ${pseudowire.mtu}: RouterOS refuses a pseudowire MTU below a VLAN interface's on its bridge with a tag, and the plan does not lower those first. Write ${RouterOsPseudowire.MTU} or more`
                );
            for (const vlan of [access, pseudowire.qinq_vlan, ...(pseudowire.trunk_vlans ?? [])])
                if (vlan && vplsVlans.includes(vlan))
                    found.push(
                        `${at} in VLAN ${vlan}, a VPLS whose PEs BGP finds: its pseudowires and this one share one split horizon, so no frame passes between them. Put this pseudowire in another VLAN, or remove vpls there`
                    );
            // As on a port, the bridge snoops every VLAN, a QinQ one too.
            for (const field of ["dhcp_snooping", "ra_guard"] as const)
                if (pseudowire.qinq_vlan && device.switching?.[field])
                    found.push(`${at}.qinq_vlan beside switching.${field}, which the platform runs on every VLAN`);
        }
        for (const name of vplsVlans)
            if (device.switching?.vlans?.[name]?.private_vlan) found.push(`switching.vlans.${name}.vpls, in a private VLAN, not built yet`);

        // A running pseudowire's L2MTU is the bridge's, so each VLAN interface on the bridge is lowered to it less a tag (TRAPS.md).
        const running = pseudowires.length > 0 || vplsVlans.length > 0;
        for (const [name, iface] of running ? RouterOsSyntax.entries(device.interfaces?.vlan_interface) : [])
            if (iface.mtu === undefined || iface.mtu > RouterOsPseudowire.VLAN_MTU)
                found.push(
                    `interfaces.vlan_interface.${name}.mtu ${iface.mtu ?? "left out, 1500"} beside a pseudowire: RouterOS lowers it to ${RouterOsPseudowire.VLAN_MTU} once the pseudowire runs, and refuses more. Write mtu: ${RouterOsPseudowire.VLAN_MTU} or less`
                );
        // The VLAN interface of an outer tag that the render adds has no MTU of its own, which RouterOS would lower too (TRAPS.md).
        for (const vlan of running ? RouterOsVlanTags.madeOuter(device) : [])
            found.push(
                `switching.vlans.${vlan}: Circuit adds the VLAN interface of its outer tag at MTU 1500, and RouterOS lowers it to ${RouterOsPseudowire.VLAN_MTU} beside a pseudowire. Write a plain VLAN interface on ${vlan} with mtu: ${RouterOsPseudowire.VLAN_MTU}`
            );
        return found;
    }
}
