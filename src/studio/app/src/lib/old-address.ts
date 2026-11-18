// Studio's pages had addresses after `#` before they had paths, such as `/#devices/edge-01`. A bookmark of one still opens its page.

import { GraphLayer } from "./graph-layer";

export class OldAddress {
    /** The path of an address after `#`, such as `/devices/edge-01` for `#devices/edge-01`, or undefined for none. */
    static path(hash: string): string | undefined {
        const body = hash.replace(/^#\/?/, "");
        if (!body) return undefined;

        const [first = "", ...rest] = body.split("/");

        // A layer alone, such as `#bgp`, opens that layer of the graph.
        if (GraphLayer.isLayer(first)) return `/graph/${first}`;
        if (first === "graph") return rest[0] ? `/graph/${rest[0]}` : "/";
        if (first === "device") return `/devices/${rest.join("/")}`;

        if (first === "search") {
            const query = OldAddress.decoded(rest.join("/"));
            return query ? `/search?${new URLSearchParams({ q: query })}` : "/search";
        }

        // A tool kept its form after its name, such as `#tools/firewall/device=edge-01&chain=input`.
        const [tool, ...form] = rest;
        if (first === "tools" && (tool === "vlan" || tool === "firewall" || tool === "policy"))
            return form.length ? `/tools/${tool}?${form.join("/")}` : `/tools/${tool}`;

        return `/${body}`;
    }

    private static decoded(text: string): string {
        try {
            return decodeURIComponent(text);
        } catch {
            return text;
        }
    }
}
