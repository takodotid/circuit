import { Address } from "../../core/address";
import { Derive } from "../../core/derive";
import type { Device } from "../../model";
import type { RouterOsRender } from "./render";
import { RouterOsVlanTags } from "./vlan-tags";

/** VXLAN segments in EVPN (RFC 8365): a VXLAN interface on the bridge for each, and an entry of BGP's EVPN for its VNI, as MikroTik's EVPN guide sets them up. */
export class RouterOsEvpn {
    /** IANA's VXLAN port (RFC 7348), the platform's default, which the render leaves out. */
    private static readonly PORT = 4789;

    /** Each segment is a VXLAN interface on the bridge, untagged in its VLAN. It learns neither VTEPs nor MAC addresses from the frames it gets: BGP EVPN gives both (TRAPS.md). */
    static vxlans(render: RouterOsRender, device: Device): void {
        for (const [name, vxlan] of Derive.evpnVxlans(device)) {
            render.add("/interface vxlan", "add", {
                bridge: RouterOsVlanTags.BRIDGE,
                "bridge-pvid": render.vlanId(vxlan.access_vlan),
                comment: vxlan.description,
                learning: "no",
                "local-address": Address.host(vxlan.local_address),
                "mac-address": vxlan.mac?.toUpperCase(),
                name,
                port: vxlan.port !== undefined && vxlan.port !== RouterOsEvpn.PORT ? vxlan.port : undefined,
                vni: vxlan.vni,
            });
        }
    }

    /** An entry of the default BGP instance for each segment, named after it, which takes the VXLAN interface of its VNI. */
    static instances(render: RouterOsRender, device: Device): void {
        for (const [name, vxlan] of Derive.evpnVxlans(device)) {
            const targets = vxlan.evpn.route_targets;
            render.add("/routing bgp evpn", "add", {
                "export.route-targets": targets.export?.length ? targets.export.join(",") : undefined,
                "import.route-targets": targets.import?.length ? targets.import.join(",") : undefined,
                instance: "default",
                name,
                rd: vxlan.evpn.route_distinguisher,
                vni: vxlan.vni,
            });
        }
    }

    /**
     * What RouterOS's EVPN can't take: two segments with one route target, which RouterOS tells apart by target alone, and a prefix limit, which counts IPv4 and IPv6 routes only. What it was not tried with: an IPv6 VTEP, a private VLAN, an 802.1ad bridge, and EVPN routes beside other routes on one session.
     */
    static unsupported(device: Device): string[] {
        const found: string[] = [];
        const segments = Derive.evpnVxlans(device);
        const targets = new Map<string, string>();

        for (const [name, vxlan] of segments) {
            const at = `interfaces.vxlan.${name}`;
            const local = Address.host(vxlan.local_address);
            if (Address.isValid(local) && Address.family(local) === "ipv6")
                found.push(`${at}.local_address ${local}, an IPv6 VTEP in EVPN, not tested on RouterOS yet`);
            if (device.switching?.vlans?.[vxlan.access_vlan]?.private_vlan)
                found.push(`${at}.access_vlan ${vxlan.access_vlan}, a private VLAN, not built for EVPN yet`);
            if (RouterOsVlanTags.tpid(device)) found.push(`${at}, not tested on a bridge with tpid 0x88a8 yet`);

            // RouterOS 7.24 sends its EVPN routes with VNI 0, and a second segment that took the first's targets sent none (TRAPS.md).
            const own = new Set([...(vxlan.evpn.route_targets.import ?? []), ...(vxlan.evpn.route_targets.export ?? [])]);
            for (const target of own) {
                const other = targets.get(target);
                if (other)
                    found.push(
                        `${at}.evpn.route_targets ${target}, interfaces.vxlan.${other}'s too: RouterOS 7.24 tells the segments' EVPN routes apart by their route targets alone. Give each segment targets of its own`
                    );
                else targets.set(target, name);
            }
        }

        const bgp = device.routing?.bgp;
        for (const [name, neighbor] of Object.entries(bgp?.neighbors ?? {})) {
            const group = neighbor.neighbor_group ? bgp?.neighbor_groups?.[neighbor.neighbor_group] : undefined;
            const settings = { ...group, ...neighbor };
            if (!Derive.carriesEvpn(settings)) continue;
            const at = `routing.bgp.neighbors.${name}`;
            if (settings.max_prefixes !== undefined)
                found.push(`${at}.max_prefixes, with EVPN routes: RouterOS limits only ipv4 and ipv6 routes`);
            // A session's filter chains take its EVPN routes too (TRAPS.md), which the chains of its other families would reject.
            const others = (settings.address_families ?? []).filter((family) => family !== "l2vpn-evpn");
            if (others.length)
                found.push(
                    `${at}.address_families l2vpn-evpn beside ${others.join(" and ")}, not built for RouterOS yet. Write a neighbor of its own for l2vpn-evpn`
                );
        }
        return found;
    }
}
