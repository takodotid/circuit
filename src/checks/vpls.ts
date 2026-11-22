import { Derive } from "../core/derive";
import type { Device } from "../model";
import { L3vpnChecks } from "./l3vpn";

type Report = (message: string) => void;

/** VLANs in a VPLS whose PEs BGP finds, and whose pseudowires BGP sets up (RFC 4761) or LDP does (RFC 6074). */
export class VplsChecks {
    /** A VE ID takes 2 bytes (RFC 4761, section 3.2.2). */
    private static readonly MAX_SITE_ID = 65_535;

    static check(device: Device, report: Report): void {
        const routing = device.routing;
        const example = `${routing?.bgp?.asn ?? routing?.router_id ?? "192.0.2.1"}:300`;
        const carried = Object.values(routing?.bgp?.neighbors ?? {}).some((neighbor) => {
            const group = neighbor.neighbor_group ? routing?.bgp?.neighbor_groups?.[neighbor.neighbor_group] : undefined;
            return (neighbor.address_families ?? group?.address_families)?.includes(Derive.VPLS_FAMILY);
        });

        // A route distinguisher names one VPN of the device, an L3VPN's VRF or a VPLS.
        const distinguishers = new Map<string, string>();
        for (const [name, vrf] of Object.entries(routing?.vrfs ?? {}))
            if (vrf?.route_distinguisher !== undefined) distinguishers.set(vrf.route_distinguisher, `VRF ${name}`);

        for (const [name, vlan] of Object.entries(device.switching?.vlans ?? {})) {
            const vpls = vlan?.vpls;
            if (!vpls) continue;
            const at = `switching.vlans.${name}.vpls`;
            const { route_distinguisher: distinguisher, route_targets: targets } = vpls;

            const problem = L3vpnChecks.valueProblem(distinguisher);
            if (problem) report(`${at}.route_distinguisher ${distinguisher} ${problem}`);
            const other = distinguishers.get(distinguisher);
            if (other)
                report(
                    `${at}.route_distinguisher ${distinguisher} is ${other}'s too, and it is what keeps their routes apart. Give each its own`
                );
            else distinguishers.set(distinguisher, `VLAN ${name}`);

            if (!targets.import?.length && !targets.export?.length)
                report(
                    `${at}.route_targets has no target. Write import, export, or both, such as { import: ["${example}"], export: ["${example}"] }`
                );
            for (const way of ["import", "export"] as const) {
                const seen = new Set<string>();
                for (const target of targets[way] ?? []) {
                    const wrong = L3vpnChecks.valueProblem(target);
                    if (wrong) report(`${at}.route_targets.${way} ${target} ${wrong}`);
                    if (seen.has(target)) report(`${at}.route_targets.${way} lists ${target} twice. Remove one`);
                    seen.add(target);
                }
            }

            VplsChecks.signaling(at, vpls, report);

            if (!routing?.mpls?.ldp?.lsr_id)
                report(`${at} needs routing.mpls: the VPLS's frames cross the core by label. Write routing.mpls.ldp`);
            if (!carried)
                report(
                    `${at}: BGP finds the VPLS's other PEs, and no BGP neighbor carries ${Derive.VPLS_FAMILY}. Write a neighbor in routing.bgp whose address_families has ${Derive.VPLS_FAMILY}`
                );
        }
    }

    /** One of `site_id`, for BGP's pseudowires, and `vpls_id`, for LDP's, each in its range. */
    private static signaling(at: string, vpls: { site_id?: number; vpls_id?: string }, report: Report): void {
        const { site_id: site, vpls_id: id } = vpls;
        if (site === undefined && id === undefined)
            report(
                `${at} has neither site_id nor vpls_id. Write site_id, this PE's number, for pseudowires that BGP sets up, or vpls_id, the VPLS's ID, for pseudowires that LDP sets up`
            );
        if (site !== undefined && id !== undefined)
            report(
                `${at} has site_id and vpls_id. Write site_id for pseudowires that BGP sets up, or vpls_id for pseudowires that LDP sets up, the same at every PE of the VPLS`
            );

        if (site !== undefined && (!Number.isInteger(site) || site < 1 || site > VplsChecks.MAX_SITE_ID))
            report(`${at}.site_id ${site}: write a whole number from 1 to ${VplsChecks.MAX_SITE_ID}, which no other PE of the VPLS has`);
        const problem = id === undefined ? undefined : L3vpnChecks.valueProblem(id);
        if (problem) report(`${at}.vpls_id ${id} ${problem}`);
    }
}
