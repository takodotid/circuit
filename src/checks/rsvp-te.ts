import { Address } from "../core/address";
import { Derive } from "../core/derive";
import type { Device, RsvpTe, RsvpTeTunnel } from "../model";
import { RateLimitChecks } from "./rate-limit";

type Report = (message: string) => void;

/** RSVP-TE tunnels (RFC 3209) beside LDP, from the LSR ID, and the traffic engineering of OSPF (RFC 3630) that CSPF reads. */
export class RsvpTeChecks {
    static check(device: Device, report: Report): void {
        RsvpTeChecks.ospf(device, report);

        const rsvpTe = device.routing?.mpls?.rsvp_te;
        if (!rsvpTe) return;

        RsvpTeChecks.interfaces(device, rsvpTe, report);
        for (const [name, tunnel] of Object.entries(rsvpTe.tunnels ?? {}))
            RsvpTeChecks.tunnel(device, `routing.mpls.rsvp_te.tunnels.${name}`, tunnel, report);
    }

    /** The OSPF areas that tell their routers each link's bandwidth. */
    static teAreas(device: Device): string[] {
        return Object.entries(device.routing?.ospf?.areas ?? {}).flatMap(([id, area]) => (area.traffic_engineering ? [id] : []));
    }

    /** OSPFv2 carries the bandwidth of the links in the main table. */
    private static ospf(device: Device, report: Report): void {
        const ospf = device.routing?.ospf;
        for (const id of RsvpTeChecks.teAreas(device)) {
            const at = `routing.ospf.areas.${id}.traffic_engineering`;
            if (!(ospf?.address_families ?? ["ipv4"]).includes("ipv4"))
                report(`${at} is OSPFv2's (RFC 3630), and routing.ospf.address_families has no ipv4. Add ipv4, or remove it`);
            if (ospf?.vrf) report(`${at} is in VRF ${ospf.vrf}, and MPLS runs in the main table. Remove it`);
        }
    }

    /** Each RSVP-TE interface is a link to another router in the main table, with an IPv4 address for RSVP and a strict hop, and a bandwidth. */
    private static interfaces(device: Device, rsvpTe: RsvpTe, report: Report): void {
        const names = Object.keys(rsvpTe.interfaces);
        if (!names.length) report("routing.mpls.rsvp_te.interfaces has none. Write the links to other routers that RSVP-TE runs on");

        for (const name of names) {
            const at = `routing.mpls.rsvp_te.interfaces.${name}`;
            const bandwidth: unknown = rsvpTe.interfaces[name]?.bandwidth;
            RateLimitChecks.rate(`${at}.bandwidth`, bandwidth, report);

            const settings = Derive.settings(device, name);
            if (!settings) continue;
            if (device.interfaces?.loopback?.[name]) report(`${at} is a loopback, and RSVP-TE runs on links to other routers. Remove it`);
            else if (!Derive.hasFamily(settings, "ipv4"))
                report(`${at} has no IPv4 address, which RSVP-TE sends from, and a strict hop names. Give it one, or remove it`);
            const vrf = "vrf" in settings ? settings.vrf : undefined;
            if (vrf) report(`${at} routes in VRF ${vrf}, and MPLS runs in the main table. Remove it`);
        }
    }

    /** A tunnel ends at another router's LSR ID, along an explicit path or one CSPF computes from OSPF's traffic engineering. */
    private static tunnel(device: Device, at: string, tunnel: RsvpTeTunnel, report: Report): void {
        const lsrId = device.routing?.mpls?.ldp.lsr_id;
        const { destination, bandwidth } = tunnel;
        if (!Address.isValid(destination) || Address.family(destination) !== "ipv4")
            report(
                `${at}.destination ${destination} is not an IPv4 address. Write the LSR ID of the router the tunnel ends at, such as 192.0.2.2`
            );
        else if (destination === lsrId) report(`${at}.destination ${destination} is this router's own LSR ID. Write the far router's`);

        if (bandwidth !== undefined) RateLimitChecks.rate(`${at}.bandwidth`, bandwidth, report);

        const path: unknown = tunnel.explicit_path;
        const cspf: unknown = tunnel.cspf;
        if (path !== undefined && cspf !== undefined) report(`${at} has explicit_path and cspf. Write one`);
        else if (path === undefined && cspf !== true)
            report(`${at} has no path. Write explicit_path, the routers it crosses, or cspf: true, for one the router computes`);

        if (cspf === true && !RsvpTeChecks.teAreas(device).length)
            report(
                `${at}.cspf computes the path from each link's bandwidth, which OSPF tells the routers. Write traffic_engineering: true on the OSPF area of routing.mpls.rsvp_te.interfaces`
            );

        if (path === undefined) return;
        if (!Array.isArray(path) || !path.length) {
            report(`${at}.explicit_path has no hop. Write the routers the tunnel crosses, the one it ends at last`);
            return;
        }
        tunnel.explicit_path?.forEach((hop, index) => {
            const where = `${at}.explicit_path[${index}]`;
            if (!Address.isValid(hop.address) || Address.family(hop.address) !== "ipv4")
                report(`${where}.address ${hop.address} is not an IPv4 address. Write an address of the router the hop goes to`);
            if (hop.hop_type !== "strict" && hop.hop_type !== "loose")
                report(`${where}.hop_type ${JSON.stringify(hop.hop_type)} is not strict or loose`);
        });
    }
}
