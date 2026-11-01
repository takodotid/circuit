// Registries Circuit reads prefix sets from.

import type { Family } from "../model";

/** A registry Circuit fetches prefixes from. */
export type Registry = "ripe-stat";

export class Registries {
    /** The prefixes of one family a registry gives for a query. */
    static prefixes(name: Registry, query: string, family: Family): Promise<string[]> {
        const sources: Record<Registry, (query: string, family: Family) => Promise<string[]>> = { "ripe-stat": Registries.ripeStat };
        return sources[name](query, family);
    }

    /** Prefixes an origin AS announces, from RIPEstat. */
    private static async ripeStat(query: string, family: Family): Promise<string[]> {
        if (!/^AS\d+$/i.test(query)) throw new Error(`ripe-stat takes an AS number, got '${query}'`);
        const res = await fetch(`https://stat.ripe.net/data/announced-prefixes/data.json?resource=${query.toUpperCase()}`, {
            signal: AbortSignal.timeout(90_000),
        });
        if (!res.ok) throw new Error(`ripe-stat answered ${res.status}`);
        const data = (await res.json()) as { data: { prefixes: { prefix: string }[] } };
        return [
            ...new Set(data.data.prefixes.map((entry) => entry.prefix).filter((entry) => entry.includes(":") === (family === "ipv6"))),
        ].sort();
    }
}
