import { Derive } from "../../core/derive";
import type { Device, Rate } from "../../model";
import { RouterOsQueues } from "./queues";
import type { RouterOsRender } from "./render";
import { RouterOsSyntax } from "./syntax";

/** RSVP-TE head-end tunnels under `/mpls traffic-eng`, as MikroTik's TE guide sets them up, and what RouterOS can't take of them. */
export class RouterOsRsvpTe {
    /**
     * MPLS and RSVP-TE on each link, each with its bandwidth, then a path and a tunnel for each tunnel, both named after it. A tunnel starts at the LSR ID: RouterOS sends a pseudowire into the tunnel whose ends are its own, and starts one without `from-address` at its lowest address (TRAPS.md).
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
            const hops = tunnel.explicit_path?.map((hop) => `${hop.address}/${hop.hop_type}`).join(",");
            // A path without `use-cspf` follows its hops alone (TRAPS.md).
            render.add("/mpls traffic-eng path", "add", { hops, name, "use-cspf": tunnel.cspf ? "yes" : undefined });
            render.add("/mpls traffic-eng tunnel", "add", {
                bandwidth: tunnel.bandwidth && RouterOsRsvpTe.bandwidth(tunnel.bandwidth),
                comment: tunnel.description,
                "from-address": mpls.ldp.lsr_id,
                name,
                "primary-path": name,
                "to-address": tunnel.destination,
            });
        }
    }

    /** A bandwidth in the largest unit that keeps a whole number: `1500M` for `1.5G`. */
    private static bandwidth(rate: Rate): string {
        return RouterOsQueues.rate(Derive.bitsPerSecond(rate));
    }

    /** OSPF tells its routers the links' bandwidth in one area at most: an instance's `mpls-te-area` is one area. */
    static unsupported(device: Device): string[] {
        const areas = Object.entries(device.routing?.ospf?.areas ?? {}).filter(([, area]) => area.traffic_engineering);
        if (areas.length < 2) return [];
        return areas
            .slice(1)
            .map(
                ([id]) =>
                    `routing.ospf.areas.${id}.traffic_engineering, a second area with it: RouterOS runs traffic engineering in one OSPF area. Write it on one area`
            );
    }
}
