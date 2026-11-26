import { Derive } from "../../core/derive";
import type { Device, Lag, Port, Pseudowire } from "../../model";
import type { RouterOsRender } from "./render";

/** What the bridge itself filters, in software: a port out of spanning tree, and a port bound to its hosts. */
export class RouterOsBridgeFilters {
    private static readonly FILTER = "/interface bridge filter";

    private static readonly NAT = "/interface bridge nat";

    /** Destination of spanning tree BPDUs, so a filter can drop them on one port. */
    private static readonly BPDU_DESTINATION = "01:80:C2:00:00:00/FF:FF:FF:FF:FF:FF";

    /** The mask of one whole MAC address, which the bridge prints after it. */
    private static readonly WHOLE_MAC = "FF:FF:FF:FF:FF:FF";

    /** Each port with `stp: false`, then each bound port, in the order the ports are written. */
    static render(render: RouterOsRender, switched: readonly [string, Port | Lag | Pseudowire][]): void {
        for (const [port, settings] of switched) if (settings.stp === false) RouterOsBridgeFilters.outOfStp(render, render.name(port));
        for (const [port, settings] of switched)
            if (settings.bound_to) RouterOsBridgeFilters.bound(render, render.name(port), settings.bound_to);
    }

    /** The platform cannot take a port out of spanning tree, so `stp: false` drops the BPDUs it would send and receive. */
    private static outOfStp(render: RouterOsRender, name: string): void {
        const comment = `${name} out of spanning tree`;
        const destination = RouterOsBridgeFilters.BPDU_DESTINATION;
        render.add(RouterOsBridgeFilters.FILTER, "add", {
            action: "drop",
            chain: "input",
            comment,
            "dst-mac-address": destination,
            "in-interface": name,
        });
        render.add(RouterOsBridgeFilters.FILTER, "add", {
            action: "drop",
            chain: "output",
            comment,
            "dst-mac-address": destination,
            "out-interface": name,
        });
    }

    /**
     * What the port sends jumps from the bridge NAT's `dstnat` chain to a chain of its own. `dstnat` sees each frame once, untagged, whether it goes to the router or to another port (TRAPS.md). There, each host's ARP, and its IP packets from the addresses it may send from, go back. Anything else is dropped.
     */
    private static bound(render: RouterOsRender, name: string, hosts: NonNullable<Port["bound_to"]>): void {
        const chain = RouterOsBridgeFilters.boundChain(name);
        const comment = `${name} bound to its hosts`;
        render.add(RouterOsBridgeFilters.NAT, "add", {
            action: "jump",
            chain: "dstnat",
            comment,
            "in-interface": name,
            "jump-target": chain,
        });

        for (const host of hosts) {
            const mac = `${host.mac.toUpperCase()}/${RouterOsBridgeFilters.WHOLE_MAC}`;
            const sources = Derive.boundSources(host);
            // In the order the export prints the properties.
            const back = (protocol: string, source: Record<string, string> = {}) =>
                render.add(RouterOsBridgeFilters.NAT, "add", {
                    action: "return",
                    chain,
                    "mac-protocol": protocol,
                    ...source,
                    "src-mac-address": mac,
                });
            for (const address of sources.ipv4) back("ip", { "src-address": address });
            for (const address of sources.ipv6) back("ipv6", { "src-address6": address });
            back("arp");
        }

        render.add(RouterOsBridgeFilters.NAT, "add", { action: "drop", chain, comment });
    }

    /** The chain of a bound port, named after it: `bound-ether5`. */
    private static boundChain(name: string): string {
        return `bound-${name}`;
    }

    /** A bound LAG, or a bound member of one, which was not tested. */
    static unsupported(device: Device): string[] {
        const members = Derive.ports(device).flatMap(([name, port]) =>
            port.bound_to && port.in_lag ? [`interfaces.ethernet.${name}`] : []
        );
        const lags = Object.entries(device.interfaces?.lag ?? {}).flatMap(([name, lag]) =>
            lag?.bound_to ? [`interfaces.lag.${name}`] : []
        );
        return [...members, ...lags].map((where) => `${where}.bound_to, on a LAG, which is not tested on a device yet`);
    }
}
