// Registries the framework reads prefix sets from. PeeringDB, which it publishes to, is in ./peeringdb.ts.

import type { Family } from "../schema";
import type { Registry } from "../schema/policy";

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
