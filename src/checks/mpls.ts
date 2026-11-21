import { Address } from "../core/address";
import { Derive } from "../core/derive";
import type { Device, Mpls, RouteMatch } from "../model";

type Report = (message: string) => void;

/** MPLS in the main table, with LDP (RFC 5036) between LSR IDs that the IGP carries. */
export class MplsChecks {
    /** What an LDP policy's rules match: a label has a prefix, and nothing else a route policy matches. */
    private static readonly LDP_MATCHES: readonly string[] = [
        "family",
        "prefix",
        "prefix_set",
        "prefix_length",
    ] satisfies (keyof RouteMatch)[];

    static check(device: Device, report: Report): void {
        const ldp = device.routing?.mpls?.ldp;
        if (!ldp) return;

        MplsChecks.lsrId(device, ldp, report);
        for (const way of ["import_policy", "export_policy"] as const) {
            const policy = ldp[way];
            if (policy) MplsChecks.ldpPolicy(device, `routing.mpls.ldp.${way} ${policy}`, policy, new Set(), report);
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

    /** A policy LDP uses, and each one it calls, matches a label's prefix only, and sets nothing. */
    private static ldpPolicy(device: Device, at: string, name: string, seen: Set<string>, report: Report): void {
        if (seen.has(name)) return;
        seen.add(name);

        (device.routing?.policies?.[name] ?? []).forEach((rule, index) => {
            if (rule.call !== undefined) return MplsChecks.ldpPolicy(device, at, rule.call, seen, report);
            if (rule.communities !== undefined) return;

            const where = `${at}: routing.policies.${name}[${index}]`;
            const other = Object.keys(rule.if ?? {}).filter((key) => !MplsChecks.LDP_MATCHES.includes(key));
            if (other.length)
                report(
                    `${where}.if has ${other.join(", ")}, and an LDP label has only a prefix. Match ${MplsChecks.LDP_MATCHES.join(", ")}`
                );
            if (rule.set) report(`${where}.set, and an LDP label has nothing to set. Remove set, and write then: "accept" or "reject"`);
        });
    }
}
