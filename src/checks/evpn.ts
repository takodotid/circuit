import { Address } from "../core/address";
import { Derive } from "../core/derive";
import { Utils } from "../core/utils";
import type { Device, EvpnVxlan, Vxlan } from "../model";
import { L3vpnChecks } from "./l3vpn";

type Report = (message: string) => void;

/** VXLAN segments in EVPN (RFC 7432, RFC 8365), and the iBGP sessions that carry their routes between VTEPs. */
export class EvpnChecks {
    /** A VNI takes 24 bits (RFC 7348, section 5). */
    private static readonly MAX_VNI = 16_777_215;

    /** What a point-to-point VXLAN tunnel has and a segment in EVPN has not: its far end, and the settings of a routed interface. */
    private static readonly ROUTED = [
        "remote_address",
        "addresses",
        "urpf",
        "ipv6_ra",
        "hardware_offload",
        "vrrp",
        "vrf",
        "exchange",
        "mtu",
        "shaping",
    ] as const satisfies readonly (keyof Vxlan)[];

    static check(device: Device, report: Report): void {
        const segments = Derive.evpnVxlans(device);
        EvpnChecks.shapes(device, report);
        EvpnChecks.segments(device, segments, report);
        EvpnChecks.sessions(device, segments, report);
    }

    /** A VXLAN is a point-to-point tunnel, routed, or a segment in EVPN, a port of its VLAN, never parts of both. */
    private static shapes(device: Device, report: Report): void {
        for (const [name, vxlan] of Object.entries(device.interfaces?.vxlan ?? {})) {
            if (!vxlan) continue;
            const at = `interfaces.vxlan.${name}`;

            if (!vxlan.evpn) {
                if (vxlan.access_vlan !== undefined)
                    report(`${at}.access_vlan without evpn: a tunnel to one far end is routed. Write evpn, or remove access_vlan`);
                continue;
            }
            if (vxlan.access_vlan === undefined)
                report(`${at}.evpn without access_vlan: the segment is a port of a VLAN. Write the VLAN, from switching.vlans`);
            for (const key of EvpnChecks.ROUTED) {
                if ((vxlan as Record<string, unknown>)[key] === undefined) continue;
                const fix =
                    key === "remote_address"
                        ? "BGP EVPN finds the far VTEPs: remove it"
                        : "Write it on a VLAN interface of access_vlan, or remove it";
                report(`${at}.${key} beside evpn: a segment in EVPN is a port of its VLAN, not routed. ${fix}`);
            }
        }
    }

    /** Each segment has a VNI and a VLAN of its own, a route distinguisher no VRF or other segment has, and route targets. All start from one address of the device, and BGP carries their routes. */
    private static segments(device: Device, segments: readonly [string, EvpnVxlan][], report: Report): void {
        if (!segments.length) return;

        const vnis = new Map<number, string>();
        const vlans = new Map<string, string>();
        const distinguishers = new Map<string, string>(
            Object.entries(device.routing?.vrfs ?? {}).flatMap(([name, vrf]) =>
                vrf?.route_distinguisher ? [[vrf.route_distinguisher, `routing.vrfs.${name}`] as const] : []
            )
        );
        const own = new Set(
            Derive.holders(device).flatMap(({ settings }) =>
                (settings.addresses ?? []).map((entry) => Address.host(typeof entry === "string" ? entry : entry.address))
            )
        );

        for (const [name, vxlan] of segments) {
            const at = `interfaces.vxlan.${name}`;
            const { vni, access_vlan: vlan, evpn } = vxlan;
            const local = Address.host(vxlan.local_address);

            if (!Number.isInteger(vni) || vni < 1 || vni > EvpnChecks.MAX_VNI)
                report(`${at}.vni ${vni}: write a whole number from 1 to ${EvpnChecks.MAX_VNI}, the same on every VTEP of the segment`);
            const sameVni = vnis.get(vni);
            if (sameVni) report(`${at}.vni ${vni} is interfaces.vxlan.${sameVni}'s too. Give each VXLAN segment its own VNI`);
            else vnis.set(vni, name);

            const sameVlan = vlans.get(vlan);
            if (sameVlan)
                report(
                    `${at}.access_vlan ${vlan} is interfaces.vxlan.${sameVlan}'s too, which would join the two segments. Give each its own VLAN`
                );
            else vlans.set(vlan, name);

            if (Address.isValid(local) && !own.has(local))
                report(`${at}.local_address ${local} is on no interface of this device. Write the address of its loopback`);

            const distinguisher = evpn.route_distinguisher;
            const problem = L3vpnChecks.valueProblem(distinguisher);
            if (problem) report(`${at}.evpn.route_distinguisher ${distinguisher} ${problem}`);
            const other = distinguishers.get(distinguisher);
            if (other)
                report(
                    `${at}.evpn.route_distinguisher ${distinguisher} is ${other}'s too, and it is what keeps their routes apart. Give each its own, such as ${local}:${vni}`
                );
            else distinguishers.set(distinguisher, at);

            const targets = evpn.route_targets;
            const example = `${device.routing?.bgp?.asn ?? local}:${vni}`;
            if (!targets.import?.length && !targets.export?.length)
                report(
                    `${at}.evpn.route_targets has no target. Write the same on every VTEP of the segment, such as { import: ["${example}"], export: ["${example}"] }`
                );
            for (const way of ["import", "export"] as const) {
                const seen = new Set<string>();
                for (const target of targets[way] ?? []) {
                    const wrong = L3vpnChecks.valueProblem(target);
                    if (wrong) report(`${at}.evpn.route_targets.${way} ${target} ${wrong}`);
                    if (seen.has(target)) report(`${at}.evpn.route_targets.${way} lists ${target} twice. Remove one`);
                    seen.add(target);
                }
            }
        }

        const locals = [...new Set(segments.map(([, vxlan]) => Address.host(vxlan.local_address)))];
        if (locals.length > 1)
            report(
                `interfaces.vxlan: the segments in EVPN start from ${locals.join(" and ")}. The far VTEPs send each segment's frames to the address of this device's BGP session, so write one local_address on every segment`
            );

        const bgp = device.routing?.bgp;
        const carried = [...Object.values(bgp?.neighbor_groups ?? {}), ...Object.values(bgp?.neighbors ?? {})].some((settings) =>
            Derive.carriesEvpn(settings ?? {})
        );
        if (!carried)
            report(
                `interfaces.vxlan.${segments[0]![0]} is in EVPN, and BGP carries its routes. Write routing.bgp, with a neighbor whose address_families has l2vpn-evpn`
            );
    }

    /** A session that carries EVPN routes is iBGP, in the main table, from the segments' address, which the far VTEPs send their frames to. */
    private static sessions(device: Device, segments: readonly [string, EvpnVxlan][], report: Report): void {
        const bgp = device.routing?.bgp;
        const vtep = segments.length ? Address.host(segments[0]![1].local_address) : undefined;

        for (const [name, neighbor] of Object.entries(bgp?.neighbors ?? {})) {
            const group = neighbor.neighbor_group ? bgp?.neighbor_groups?.[neighbor.neighbor_group] : undefined;
            const settings = { ...group, ...neighbor };
            if (!Derive.carriesEvpn(settings)) continue;

            const at = `routing.bgp.neighbors.${name}`;
            const carries = `${at} carries l2vpn-evpn`;

            if (settings.remote_as !== undefined && settings.remote_as !== bgp?.asn)
                report(
                    `${carries} to AS${settings.remote_as}, another AS. Circuit carries EVPN routes between the VTEPs of one AS: write them on an iBGP neighbor, remote_as ${bgp?.asn}`
                );
            if (settings.vrf || Utils.otherTable(settings.routing_table))
                report(
                    `${carries} in ${settings.vrf ? `VRF ${settings.vrf}` : `table ${settings.routing_table}`}, and VTEPs exchange EVPN routes in the main table. Remove it`
                );
            const only = !Derive.unicastFamilies(settings, neighbor.address).length;
            if (settings.send_default_route && only)
                report(`${carries} only, and send_default_route sends an ipv4 or ipv6 default route. Remove send_default_route`);
            for (const way of ["import_policy", "export_policy"] as const)
                if (settings[way] && only && !Derive.vpnFamilies(settings).length)
                    report(
                        `${carries} only, and ${way} ${settings[way]} picks ipv4 and ipv6 routes, while route targets pick EVPN routes. Remove ${way}`
                    );

            // A route reflector may carry EVPN routes without a segment of its own.
            const local = settings.local_address && Address.host(settings.local_address);
            if (vtep && local !== vtep)
                report(
                    `${carries} ${local ? `from ${local}` : "without local_address"}, and the far VTEPs send the segments' frames to that address. Write local_address: "${vtep}", the segments' local_address`
                );
        }
    }
}
