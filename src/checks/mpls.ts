import { Address } from "../core/address";
import { Derive } from "../core/derive";
import type { Device, Mpls } from "../model";
import { PrefixPolicyChecks } from "./prefix-policy";

type Report = (message: string) => void;

/** MPLS in the main table, with LDP (RFC 5036) between LSR IDs that the IGP carries. */
export class MplsChecks {
    /** A label has a prefix, and nothing else a route policy matches or sets. */
    private static readonly LABEL = { match: "an LDP label has only a prefix", set: "an LDP label has nothing to set" };

    static check(device: Device, report: Report): void {
        const ldp = device.routing?.mpls?.ldp;
        if (!ldp) return;

        MplsChecks.lsrId(device, ldp, report);
        for (const way of ["import_policy", "export_policy"] as const) {
            const policy = ldp[way];
            if (policy) PrefixPolicyChecks.check(device, `routing.mpls.ldp.${way} ${policy}`, policy, MplsChecks.LABEL, report);
        }

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

    /** The LSR ID is the address of a loopback in the main table, which OSPF or IS-IS announces, so every LDP router reaches it. */
    private static lsrId(device: Device, ldp: Mpls["ldp"], report: Report): void {
        const at = `routing.mpls.ldp.lsr_id ${ldp.lsr_id}`;
        const loopbacks = Object.entries(device.interfaces?.loopback ?? {}).map(([name, settings]) => ({
            name,
            settings,
            hosts: (settings?.addresses ?? [])
                .map((entry) => Address.host(typeof entry === "string" ? entry : entry.address))
                .filter((host) => Address.family(host) === "ipv4"),
        }));

        if (!Address.isValid(ldp.lsr_id) || Address.family(ldp.lsr_id) !== "ipv4") {
            report(`${at} is not an IPv4 address. Write the IPv4 address of a loopback, such as 192.0.2.1`);
            return;
        }

        const loopback = loopbacks.find(({ hosts }) => hosts.includes(ldp.lsr_id));
        if (!loopback) {
            const other = loopbacks.flatMap(({ hosts }) => hosts)[0];
            report(
                `${at} is no address of a loopback, and LDP sessions run between LSR IDs. ${other ? `Write the address of a loopback, such as ${other}` : `Add a loopback with ${ldp.lsr_id}/32 to interfaces.loopback`}`
            );
            return;
        }

        const { name, settings } = loopback;
        if (settings?.vrf) {
            report(
                `${at} is on loopback ${name}, which routes in VRF ${settings.vrf}, and MPLS runs in the main table. Write the address of a loopback in the main table`
            );
            return;
        }

        const routing = device.routing;
        const ospf = routing?.ospf;
        const byOspf =
            ospf &&
            !ospf.vrf &&
            (ospf.address_families ?? ["ipv4"]).includes("ipv4") &&
            Object.values(ospf.areas).some((area) => Object.hasOwn(area.interfaces, name));
        const isis = routing?.isis;
        const byIsis = isis && isis.address_families.includes("ipv4") && Object.hasOwn(isis.interfaces, name);
        if (!byOspf && !byIsis)
            report(
                `${at} is on loopback ${name}, which neither OSPF nor IS-IS announces, so other LDP routers can't reach it. Add ${name} to routing.isis.interfaces, or to an area of routing.ospf, with passive: true`
            );
    }
}
