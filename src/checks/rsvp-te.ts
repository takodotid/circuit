import { Address } from "../core/address";
import { Derive } from "../core/derive";
import type { Device, RsvpTe, RsvpTeTunnel, TunnelPath } from "../model";
import { RateLimitChecks } from "./rate-limit";

type Report = (message: string) => void;

/** RSVP-TE tunnels (RFC 3209) beside LDP, from the LSR ID, and the traffic engineering of OSPF (RFC 3630) that CSPF reads. */
export class RsvpTeChecks {
    /** RFC 3209's priorities, 0 the highest. */
    private static readonly LOWEST_PRIORITY = 7;

    static check(device: Device, report: Report): void {
        RsvpTeChecks.ospf(device, report);

        const rsvpTe = device.routing?.mpls?.rsvp_te;
        if (!rsvpTe) return;

        RsvpTeChecks.interfaces(device, rsvpTe, report);
        const tunnels = Object.entries(rsvpTe.tunnels ?? {});
        for (const [name, tunnel] of tunnels) RsvpTeChecks.tunnel(device, `routing.mpls.rsvp_te.tunnels.${name}`, tunnel, report);
        RsvpTeChecks.pathNames(tunnels, report);
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

    /** A tunnel ends at another router's LSR ID, along its paths, with its bandwidth and priorities. */
    private static tunnel(device: Device, at: string, tunnel: RsvpTeTunnel, report: Report): void {
        const lsrId = device.routing?.mpls?.ldp.lsr_id;
        const { destination, bandwidth } = tunnel;
        if (!Address.isValid(destination) || Address.family(destination) !== "ipv4")
            report(
                `${at}.destination ${destination} is not an IPv4 address. Write the LSR ID of the router the tunnel ends at, such as 192.0.2.2`
            );
        else if (destination === lsrId) report(`${at}.destination ${destination} is this router's own LSR ID. Write the far router's`);

        if (bandwidth !== undefined) RateLimitChecks.rate(`${at}.bandwidth`, bandwidth, report);

        RsvpTeChecks.path(device, at, tunnel, report);
        for (const [name, path] of Object.entries(tunnel.secondary_paths ?? {}))
            RsvpTeChecks.path(device, `${at}.secondary_paths.${name}`, path, report);

        RsvpTeChecks.priorities(at, tunnel, report);
    }

    /** A path is the hops written out, or one CSPF computes from OSPF's traffic engineering. */
    private static path(device: Device, at: string, tunnel: TunnelPath, report: Report): void {
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

    /** Both priorities or neither, each 0 to 7, and the setup priority never higher than the hold priority (RFC 3209, section 4.7.3). */
    private static priorities(at: string, tunnel: RsvpTeTunnel, report: Report): void {
        const setup: unknown = tunnel.setup_priority;
        const hold: unknown = tunnel.hold_priority;
        if (setup === undefined && hold === undefined) return;
        if (setup === undefined || hold === undefined) {
            const missing = setup === undefined ? "setup_priority" : "hold_priority";
            report(`${at} has ${missing === "setup_priority" ? "hold_priority" : "setup_priority"} alone. Write ${missing} beside it`);
            return;
        }
        const valid = (value: unknown): value is number =>
            typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= RsvpTeChecks.LOWEST_PRIORITY;
        for (const [key, value] of [
            ["setup_priority", setup],
            ["hold_priority", hold],
        ] as const)
            if (!valid(value)) report(`${at}.${key} ${JSON.stringify(value)} is not a priority from 0, the highest, to 7`);
        if (valid(setup) && valid(hold) && setup < hold)
            report(
                `${at}.setup_priority ${setup} is higher than hold_priority ${hold}, so the tunnel could take bandwidth it then gives up to a tunnel like itself (RFC 3209, section 4.7.3). Write a hold_priority of ${setup} or higher, a lower number`
            );
    }

    /** Each path of a tunnel is a path of the device by its name: a primary path is named after its tunnel, and a secondary path by its key. */
    private static pathNames(tunnels: [string, RsvpTeTunnel][], report: Report): void {
        const owner = new Map<string, string>(tunnels.map(([name]) => [name, `tunnel ${name}'s primary path`]));
        for (const [name, tunnel] of tunnels)
            for (const path of Object.keys(tunnel.secondary_paths ?? {})) {
                const other = owner.get(path);
                if (other)
                    report(
                        `routing.mpls.rsvp_te.tunnels.${name}.secondary_paths.${path} has the name of ${other}, and each path of the device has its own. Give it another name`
                    );
                else owner.set(path, `tunnel ${name}'s secondary path`);
            }
    }
}
