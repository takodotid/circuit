import { Derive } from "../../core/derive";
import type { Device, Rate, TunnelPath } from "../../model";
import { RouterOsQueues } from "./queues";
import type { RouterOsRender } from "./render";
import { RouterOsSyntax } from "./syntax";

/** RSVP-TE head-end tunnels under `/mpls traffic-eng`, as MikroTik's TE guide sets them up, and what RouterOS can't take of them. */
export class RouterOsRsvpTe {
    /**
     * MPLS and RSVP-TE on each link, each with its bandwidth, then each tunnel's paths and the tunnel. Its primary path is named after it, and each secondary path by its key. A tunnel starts at the LSR ID: RouterOS sends a pseudowire into the tunnel whose ends are its own, and starts one without `from-address` at its lowest address (TRAPS.md).
     */
    static render(render: RouterOsRender, device: Device): void {
        const mpls = device.routing?.mpls;
        const rsvpTe = mpls?.rsvp_te;
        if (!mpls || !rsvpTe) return;

        const ldp = mpls.ldp.interfaces.map((iface) => render.name(iface));
        for (const [iface, settings] of RouterOsSyntax.entries(rsvpTe.interfaces)) {
            const name = render.name(iface);
            if (!ldp.includes(name)) render.add("/mpls interface", "add", { interface: name });
            render.add("/mpls traffic-eng interface", "add", { bandwidth: RouterOsRsvpTe.bandwidth(settings.bandwidth), interface: name });
        }

        for (const [name, tunnel] of Object.entries(rsvpTe.tunnels ?? {})) {
            const secondaries = Object.entries(tunnel.secondary_paths ?? {});
            for (const [path, settings] of [[name, tunnel] as const, ...secondaries])
                render.add("/mpls traffic-eng path", "add", RouterOsRsvpTe.path(path, settings));

            render.add("/mpls traffic-eng tunnel", "add", {
                bandwidth: tunnel.bandwidth && RouterOsRsvpTe.bandwidth(tunnel.bandwidth),
                comment: tunnel.description,
                "from-address": mpls.ldp.lsr_id,
                name,
                "primary-path": name,
                "secondary-paths": secondaries.length ? secondaries.map(([path]) => path).join(",") : undefined,
                "secondary-standby": secondaries[0]?.[1].standby ? "yes" : undefined,
                "to-address": tunnel.destination,
            });
        }
    }

    /**
     * One path of a tunnel: its hops, or CSPF. A path without `use-cspf` follows its hops alone (TRAPS.md).
     */
    private static path(name: string, path: TunnelPath): Record<string, string | undefined> {
        return {
            hops: path.explicit_path?.map((hop) => `${hop.address}/${hop.hop_type}`).join(","),
            name,
            "use-cspf": path.cspf ? "yes" : undefined,
        };
    }

    /** A bandwidth in the largest unit that keeps a whole number: `1500M` for `1.5G`. */
    private static bandwidth(rate: Rate): string {
        return RouterOsQueues.rate(Derive.bitsPerSecond(rate));
    }

    /** OSPF tells its routers the links' bandwidth in one area at most: an instance's `mpls-te-area` is one area. A tunnel sets up ahead its first secondary path that comes up, and no other (TRAPS.md). */
    static unsupported(device: Device): string[] {
        const areas = Object.entries(device.routing?.ospf?.areas ?? {}).filter(([, area]) => area.traffic_engineering);
        const found = areas
            .slice(1)
            .map(
                ([id]) =>
                    `routing.ospf.areas.${id}.traffic_engineering, a second area with it: RouterOS runs traffic engineering in one OSPF area. Write it on one area`
            );

        for (const [name, tunnel] of Object.entries(device.routing?.mpls?.rsvp_te?.tunnels ?? {}))
            for (const [path, settings] of Object.entries(tunnel.secondary_paths ?? {}).slice(1))
                if (settings.standby)
                    found.push(
                        `routing.mpls.rsvp_te.tunnels.${name}.secondary_paths.${path}.standby, not on the first secondary path: RouterOS sets up ahead one secondary path, the first that comes up. Write standby on the first one alone`
                    );
        return found;
    }
}
