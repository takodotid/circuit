// EVPN over VXLAN on VRP (decision 201). Each segment is a bridge domain bound to its VLAN, with its VNI and its EVPN instance. One NVE interface sends every segment to the far VTEPs BGP finds. A CE6855 on V200R005C00SPC800 took it with `commit trial` (TRAPS.md).

import { Address } from "../../core/address";
import { Derive } from "../../core/derive";
import type { Device } from "../../model";
import { LineDiff } from "../line-diff";
import type { Dialect } from "../line-diff";
import { VrpBgp } from "./bgp";

export class VrpEvpn {
    /** The largest VNI the switch takes: `The VNI must not be more than the maximum value(16000000)`. */
    private static readonly MAX_VNI = 16_000_000;

    /** The one NVE interface, which every segment leaves through. */
    private static readonly NVE = "interface Nve1";

    /** `evpn-overlay enable`, then a bridge domain for each segment, numbered by its VNI, bound to its VLAN. */
    static lines(device: Device): string[] {
        const segments = Derive.evpnVxlans(device);
        if (!segments.length) return [];

        const lines = ["evpn-overlay enable", "#"];
        for (const [, segment] of segments) {
            const vlan = device.switching?.vlans?.[segment.access_vlan];
            const { route_distinguisher: distinguisher, route_targets: targets } = segment.evpn;
            lines.push(
                `bridge-domain ${segment.vni}`,
                ...(segment.description ? [` description ${segment.description}`] : []),
                ...(vlan ? [` l2 binding vlan ${vlan.id}`] : []),
                ` vxlan vni ${segment.vni}`,
                " evpn",
                `  route-distinguisher ${distinguisher}`,
                ...(targets.export ?? []).map((target) => `  vpn-target ${target} export-extcommunity`),
                ...(targets.import ?? []).map((target) => `  vpn-target ${target} import-extcommunity`),
                "#"
            );
        }
        return lines;
    }

    /** The NVE interface: the VTEP's address, and each segment's far VTEPs, which BGP finds. */
    static nve(device: Device): string[] {
        const segments = Derive.evpnVxlans(device);
        if (!segments.length) return [];

        const source = Address.host(segments[0]![1].local_address);
        return [
            VrpEvpn.NVE,
            ` source ${source}`,
            ...segments.map(([, segment]) => ` vni ${segment.vni} head-end peer-list protocol bgp`),
            "#",
        ];
    }

    /** What EVPN can't do here. */
    static unsupported(device: Device): string[] {
        const found: string[] = [];
        for (const [name, segment] of Derive.evpnVxlans(device)) {
            const where = `interfaces.vxlan.${name}`;
            if (segment.vni > VrpEvpn.MAX_VNI) found.push(`${where}.vni ${segment.vni}, the switch takes ${VrpEvpn.MAX_VNI} at most`);
            if (segment.port !== undefined) found.push(`${where}.port, not built yet`);
            if (segment.mac !== undefined) found.push(`${where}.mac, the switch gives the NVE interface its own`);
            const local = Address.host(segment.local_address);
            if (Address.family(local) === "ipv6") found.push(`${where}.local_address, IPv6: not built yet`);
            else if (!VrpBgp.interfaceOf(device, local))
                found.push(`${where}.local_address ${local}, no VLAN interface or loopback of the device holds it`);
            const vlanInterface = Object.entries(device.interfaces?.vlan_interface ?? {}).find(
                ([, iface]) => iface?.vlan === segment.access_vlan
            );
            if (vlanInterface)
                found.push(
                    `interfaces.vlan_interface.${vlanInterface[0]}, on the VLAN of ${where}: a VLAN in a bridge domain is not routed here yet`
                );
        }
        return found;
    }

    /** A segment whose route distinguisher changes. The switch takes a new one only once the undo of the old is committed, and the undo takes the segment's targets with it. */
    static problems(desired: string, current: string, dialect: Dialect): string[] {
        const distinguishers = (text: string) =>
            new Map(
                LineDiff.entries(text, dialect).flatMap(({ path, line }) =>
                    path[1] === "evpn" && line.startsWith("route-distinguisher ") ? [[path[0]!, line] as [string, string]] : []
                )
            );
        const had = distinguishers(current);
        return [...distinguishers(desired)]
            .filter(([domain, line]) => had.has(domain) && had.get(domain) !== line)
            .map(
                ([domain]) =>
                    `the route distinguisher of ${domain} changes: the switch takes a new one only once the old is gone, so remove the segment in one apply and add it in the next`
            );
    }
}
