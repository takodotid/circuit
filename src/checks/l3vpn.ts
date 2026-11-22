import { Address } from "../core/address";
import { Derive } from "../core/derive";
import { Utils } from "../core/utils";
import type { Device } from "../model";

type Report = (message: string) => void;

/** VRFs in an L3VPN (RFC 4364), and the iBGP sessions that carry their routes between PEs over MPLS. */
export class L3vpnChecks {
    /** The largest number in two bytes: a 2-byte AS, or the number after a 4-byte AS or an IPv4 address. */
    private static readonly MAX_TWO_BYTES = 65_535;

    /** The largest number in four bytes: a 4-byte AS (RFC 6793), or the number after a 2-byte AS. */
    private static readonly MAX_FOUR_BYTES = 4_294_967_295;

    /** A whole number, without a sign or leading zeros. */
    private static readonly WHOLE = /^(0|[1-9]\d*)$/;

    static check(device: Device, report: Report): void {
        L3vpnChecks.vrfs(device, report);
        L3vpnChecks.sessions(device, report);
    }

    /**
     * What is wrong with a route distinguisher or a route target, or nothing. Each is an AS number or an IPv4 address, then a number, in 6 bytes (RFC 4364, section 4.2; RFC 4360; RFC 5668). A 2-byte AS takes a 4-byte number, and a 4-byte AS or an address a 2-byte one.
     */
    static valueProblem(value: string): string | undefined {
        const colon = value.lastIndexOf(":");
        const administrator = value.slice(0, colon);
        const assigned = value.slice(colon + 1);
        const shape = "write an AS number or an IPv4 address, a colon, and a number, such as 64500:101";
        if (colon === -1 || !L3vpnChecks.WHOLE.test(assigned)) return `is not a number after a colon: ${shape}`;

        const number = Number(assigned);
        if (administrator.includes(".")) {
            if (!Address.isValid(administrator) || Address.family(administrator) !== "ipv4")
                return `starts with ${administrator}, which is no IPv4 address: ${shape}`;
            return number > L3vpnChecks.MAX_TWO_BYTES
                ? `has ${number} after an IPv4 address, where the number takes 2 bytes: write a number up to ${L3vpnChecks.MAX_TWO_BYTES}`
                : undefined;
        }

        const asn = Number(administrator);
        if (!L3vpnChecks.WHOLE.test(administrator) || asn < 1 || asn > L3vpnChecks.MAX_FOUR_BYTES)
            return `starts with ${administrator}, which is no AS number from 1 to ${L3vpnChecks.MAX_FOUR_BYTES}: ${shape}`;
        if (asn > L3vpnChecks.MAX_TWO_BYTES && number > L3vpnChecks.MAX_TWO_BYTES)
            return `has ${number} after AS${asn}, a 4-byte AS, where the number takes 2 bytes: write a number up to ${L3vpnChecks.MAX_TWO_BYTES}`;
        return number > L3vpnChecks.MAX_FOUR_BYTES ? `has ${number}: write a number up to ${L3vpnChecks.MAX_FOUR_BYTES}` : undefined;
    }

    /** Each VRF in an L3VPN has a route distinguisher of its own and route targets, and the device runs BGP to carry them. */
    private static vrfs(device: Device, report: Report): void {
        const routing = device.routing;
        const example = `${routing?.bgp?.asn ?? routing?.router_id ?? "192.0.2.1"}:101`;
        const distinguishers = new Map<string, string>();

        for (const [name, vrf] of Object.entries(routing?.vrfs ?? {})) {
            const at = `routing.vrfs.${name}`;
            const distinguisher = vrf?.route_distinguisher;
            const targets = vrf?.route_targets;

            if (distinguisher !== undefined) {
                const problem = L3vpnChecks.valueProblem(distinguisher);
                if (problem) report(`${at}.route_distinguisher ${distinguisher} ${problem}`);

                const other = distinguishers.get(distinguisher);
                if (other)
                    report(
                        `${at}.route_distinguisher ${distinguisher} is VRF ${other}'s too, and it is what keeps their routes apart. Give each VRF its own`
                    );
                else distinguishers.set(distinguisher, name);
            }

            if (targets && distinguisher === undefined)
                report(
                    `${at} has route_targets without route_distinguisher, which each of its VPN routes carries. Write one, such as ${example}`
                );
            if (distinguisher !== undefined && !targets)
                report(
                    `${at} has route_distinguisher without route_targets, so it takes and sends no VPN route. Write route_targets: { import: ["${distinguisher}"], export: ["${distinguisher}"] }, or remove route_distinguisher`
                );
            if (targets && !targets.import?.length && !targets.export?.length)
                report(
                    `${at}.route_targets has no target. Write import, export, or both, such as { import: ["${example}"], export: ["${example}"] }`
                );

            for (const way of ["import", "export"] as const) {
                const policy = vrf?.[`${way}_policy`];
                const picks =
                    way === "import"
                        ? "the VPN routes the VRF takes, and it takes"
                        : "the routes the VRF sends as VPN routes, and it sends";
                if (policy !== undefined && !targets?.[way]?.length)
                    report(
                        `${at}.${way}_policy ${policy} picks ${picks} none without ${way} targets. Write route_targets.${way}, or remove ${way}_policy`
                    );

                const seen = new Set<string>();
                for (const target of targets?.[way] ?? []) {
                    const problem = L3vpnChecks.valueProblem(target);
                    if (problem) report(`${at}.route_targets.${way} ${target} ${problem}`);
                    if (seen.has(target)) report(`${at}.route_targets.${way} lists ${target} twice. Remove one`);
                    seen.add(target);
                }
            }

            if ((targets || distinguisher !== undefined) && !routing?.bgp)
                report(
                    `${at} is in an L3VPN, and BGP carries its routes. Write routing.bgp, with a neighbor whose address_families has vpnv4 or vpnv6`
                );
        }
    }

    /** A session that carries VPN routes, of an L3VPN or a VPLS, is iBGP, in the main table, over MPLS. It runs from the address LDP labels for its family: the LSR ID, or the IPv6 transport address. */
    private static sessions(device: Device, report: Report): void {
        const routing = device.routing;
        const bgp = routing?.bgp;
        const ldp = routing?.mpls?.ldp;

        for (const [name, neighbor] of Object.entries(bgp?.neighbors ?? {})) {
            const group = neighbor.neighbor_group ? bgp?.neighbor_groups?.[neighbor.neighbor_group] : undefined;
            const settings = { ...group, ...neighbor };
            const families = Derive.vpnFamilies(settings);
            if (!families.length) continue;

            const at = `routing.bgp.neighbors.${name}`;
            const carries = `${at} carries ${families.join(" and ")}`;

            if (settings.remote_as !== undefined && settings.remote_as !== bgp?.asn)
                report(
                    `${carries} to AS${settings.remote_as}, another AS. Circuit carries VPN routes between the PEs of one AS: write them on an iBGP neighbor, remote_as ${bgp?.asn}`
                );
            if (settings.vrf || Utils.otherTable(settings.routing_table))
                report(
                    `${carries} in ${settings.vrf ? `VRF ${settings.vrf}` : `table ${settings.routing_table}`}, and PEs exchange VPN routes in the main table. Remove it`
                );
            if (settings.send_default_route && !Derive.unicastFamilies(settings, neighbor.address).length)
                report(`${carries} only, and send_default_route sends an ipv4 or ipv6 default route. Remove send_default_route`);
            const overIpv6 = Address.isValid(neighbor.address) && Address.family(neighbor.address) === "ipv6";
            if (!ldp) {
                report(`${carries} without routing.mpls, and traffic to a VPN route crosses the core by label. Write routing.mpls.ldp`);
                continue;
            }
            if (overIpv6 && !(ldp.address_families ?? ["ipv4"]).includes("ipv6")) {
                report(
                    `${carries} to ${neighbor.address}, and LDP here labels IPv4 routes only. Write the far PE's LSR ID, its IPv4 loopback, or add ipv6 to routing.mpls.ldp.address_families`
                );
                continue;
            }

            // The far PE sends the VPN's traffic to this address, by the label LDP gives it here.
            const own = overIpv6 ? ldp.ipv6_transport_address : ldp.lsr_id;
            const ownName = overIpv6 ? "IPv6 transport address" : "LSR ID";
            const local = settings.local_address && Address.host(settings.local_address);
            if (own && local !== own)
                report(
                    `${carries} ${local ? `from ${local}` : "without local_address"}, and the far PE sends the VPN's traffic to that address, by the label LDP gives this router's ${ownName}. Write local_address: "${own}"`
                );
        }
    }
}
