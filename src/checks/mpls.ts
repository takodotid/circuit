import { Address } from "../core/address";
import { Derive } from "../core/derive";
import type { Device, Family, Mpls } from "../model";
import { PrefixPolicyChecks } from "./prefix-policy";

type Report = (message: string) => void;

/** MPLS in the main table, with LDP (RFC 5036) between LSR IDs that the IGP carries. */
export class MplsChecks {
    /** A label has a prefix, and nothing else a route policy matches or sets. */
    private static readonly LABEL = { match: "an LDP label has only a prefix", set: "an LDP label has nothing to set" };

    /** An address an error offers when the device has none of its own to offer. */
    private static readonly SAMPLE: Record<Family, string> = { ipv4: "192.0.2.1", ipv6: "2001:db8::1" };

    static check(device: Device, report: Report): void {
        const ldp = device.routing?.mpls?.ldp;
        if (!ldp) return;

        MplsChecks.lsrId(device, ldp, report);
        MplsChecks.families(device, ldp, report);
        MplsChecks.targets(ldp, report);
        MplsChecks.neighbors(ldp, report);
        const policies = [
            ...(["import_policy", "export_policy"] as const).map((way) => ({ at: `routing.mpls.ldp.${way}`, policy: ldp[way] })),
            ...Object.entries(ldp.neighbors ?? {}).flatMap(([lsrId, neighbor]) =>
                (["import_policy", "export_policy"] as const).map((way) => ({
                    at: `routing.mpls.ldp.neighbors.${lsrId}.${way}`,
                    policy: neighbor?.[way],
                }))
            ),
        ];
        for (const { at, policy } of policies)
            if (policy) PrefixPolicyChecks.check(device, `${at} ${policy}`, policy, MplsChecks.LABEL, report);

        const seen = new Set<string>();
        for (const name of ldp.interfaces) {
            const at = `routing.mpls.ldp.interfaces ${name}`;
            if (seen.has(name)) report(`${at} is listed twice. Remove one`);
            seen.add(name);

            const settings = Derive.settings(device, name);
            if (!settings) continue;
            if (device.interfaces?.loopback?.[name]) report(`${at} is a loopback, and LDP runs on links to other routers. Remove it`);
            else if (!Derive.hasFamily(settings, "ipv4"))
                report(`${at} has no IPv4 address, which LDP needs to find its neighbors. Give it one, or remove it`);
            const vrf = "vrf" in settings ? settings.vrf : undefined;
            if (vrf) report(`${at} routes in VRF ${vrf}, and MPLS runs in the main table. Remove it`);
        }
    }

    /** A targeted session runs to another router's LSR ID, once. */
    private static targets(ldp: Mpls["ldp"], report: Report): void {
        const seen = new Set<string>();
        for (const target of ldp.targets ?? []) {
            const at = `routing.mpls.ldp.targets ${target}`;
            if (seen.has(target)) report(`${at} is listed twice. Remove one`);
            seen.add(target);

            if (!Address.isValid(target) || Address.family(target) !== "ipv4")
                report(`${at} is not an IPv4 address. Write the far router's LSR ID, such as 192.0.2.2`);
            else if (target === ldp.lsr_id) report(`${at} is this router's own LSR ID. Write the far router's`);
        }
    }

    /** A neighbor's policies are for another router, by its LSR ID, and it has one at least. */
    private static neighbors(ldp: Mpls["ldp"], report: Report): void {
        for (const [lsrId, neighbor] of Object.entries(ldp.neighbors ?? {})) {
            const at = `routing.mpls.ldp.neighbors.${lsrId}`;
            if (!Address.isValid(lsrId) || Address.family(lsrId) !== "ipv4")
                report(`${at}: ${lsrId} is not an IPv4 address. Write the neighbor's LSR ID, such as 192.0.2.2`);
            else if (lsrId === ldp.lsr_id) report(`${at}: ${lsrId} is this router's own LSR ID. Write a neighbor's`);
            if (!neighbor?.import_policy && !neighbor?.export_policy)
                report(`${at} has no policy. Write import_policy or export_policy, or remove it`);
        }
    }

    /** What LDP labels: IPv4 routes always, and with `ipv6`, IPv6 routes too, from an IPv6 transport address of the device's own (RFC 7552). */
    private static families(device: Device, ldp: Mpls["ldp"], report: Report): void {
        const at = "routing.mpls.ldp.address_families";
        const families = ldp.address_families ?? ["ipv4"];
        const seen = new Set<string>();
        for (const family of families) {
            if (seen.has(family)) report(`${at} lists ${family} twice. Remove one`);
            seen.add(family);
        }
        if (!families.includes("ipv4"))
            report(
                `${at} has no ipv4, and LDP here labels IPv4 routes always: its LSR ID, targets, and pseudowires are IPv4. Write ["ipv4", "ipv6"]`
            );

        const transport = ldp.ipv6_transport_address;
        if (!families.includes("ipv6")) {
            if (transport !== undefined)
                report(
                    `routing.mpls.ldp.ipv6_transport_address ${transport} is where LDP runs its IPv6 sessions from, and ${at} has no ipv6. Add ipv6 there, or remove ipv6_transport_address`
                );
            if (ldp.prefer_ipv4_transport)
                report(
                    `routing.mpls.ldp.prefer_ipv4_transport picks a family for sessions with neighbors that run LDP for both, and ${at} has no ipv6. Remove it`
                );
            return;
        }
        if (transport === undefined) {
            const example = MplsChecks.loopbackHosts(device, "ipv6")[0]?.host ?? MplsChecks.SAMPLE.ipv6;
            report(
                `${at} has ipv6, and LDP runs its IPv6 sessions from an IPv6 address of the device, as it has no IPv6 LSR ID. Write ipv6_transport_address, the IPv6 address of a loopback, such as ${example}`
            );
            return;
        }
        MplsChecks.onLoopback(device, `routing.mpls.ldp.ipv6_transport_address ${transport}`, transport, "ipv6", report);
    }

    /** The LSR ID is the address of a loopback in the main table, which OSPF or IS-IS announces, so every LDP router reaches it. */
    private static lsrId(device: Device, ldp: Mpls["ldp"], report: Report): void {
        MplsChecks.onLoopback(device, `routing.mpls.ldp.lsr_id ${ldp.lsr_id}`, ldp.lsr_id, "ipv4", report);
    }

    /** Each address of the device's loopbacks in `family`, with its loopback and VRF. */
    private static loopbackHosts(device: Device, family: Family): { name: string; host: string; vrf: string | undefined }[] {
        return Object.entries(device.interfaces?.loopback ?? {}).flatMap(([name, settings]) =>
            (settings?.addresses ?? [])
                .map((entry) => Address.host(typeof entry === "string" ? entry : entry.address))
                .filter((host) => Address.isValid(host) && Address.family(host) === family)
                .map((host) => ({ name, host, vrf: settings?.vrf }))
        );
    }

    /** LDP runs sessions from its LSR ID and its IPv6 transport address. Each is on a loopback in the main table that OSPF or IS-IS announces in its family, so every LDP router reaches it. */
    private static onLoopback(device: Device, at: string, address: string, family: Family, report: Report): void {
        const ipv4 = family === "ipv4";
        const name4or6 = ipv4 ? "IPv4" : "IPv6";
        if (!Address.isValid(address) || Address.family(address) !== family) {
            report(
                `${at} is not an ${name4or6} address. Write the ${name4or6} address of a loopback, such as ${MplsChecks.SAMPLE[family]}`
            );
            return;
        }

        const hosts = MplsChecks.loopbackHosts(device, family);
        const loopback = hosts.find(({ host }) => Address.toNumber(host) === Address.toNumber(address));
        if (!loopback) {
            const other = hosts[0]?.host;
            const why = ipv4 ? "LDP sessions run between LSR IDs" : "LDP runs its IPv6 sessions from it";
            report(
                `${at} is no address of a loopback, and ${why}. ${other ? `Write the address of a loopback, such as ${other}` : `Add a loopback with ${address}/${Address.bits(family)} to interfaces.loopback`}`
            );
            return;
        }

        const { name, vrf } = loopback;
        if (vrf) {
            report(
                `${at} is on loopback ${name}, which routes in VRF ${vrf}, and MPLS runs in the main table. Write the address of a loopback in the main table`
            );
            return;
        }

        const routing = device.routing;
        const ospf = routing?.ospf;
        const byOspf =
            ospf &&
            !ospf.vrf &&
            (ospf.address_families ?? ["ipv4"]).includes(family) &&
            Object.values(ospf.areas).some((area) => Object.hasOwn(area.interfaces, name));
        const isis = routing?.isis;
        const byIsis = isis && isis.address_families.includes(family) && Object.hasOwn(isis.interfaces, name);
        if (byOspf || byIsis) return;
        report(
            ipv4
                ? `${at} is on loopback ${name}, which neither OSPF nor IS-IS announces, so other LDP routers can't reach it. Add ${name} to routing.isis.interfaces, or to an area of routing.ospf, with passive: true`
                : `${at} is on loopback ${name}, which neither OSPF nor IS-IS announces for IPv6, so other LDP routers can't reach it. Add ${name} to routing.isis.interfaces, or to an area of routing.ospf, with passive: true, and ipv6 to its address_families`
        );
    }
}
