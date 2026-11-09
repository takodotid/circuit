// Registries Circuit reads prefix sets from.

import type { Device, Family } from "../model";
import { Address } from "./address";

/** A registry Circuit fetches prefixes from. */
export type Registry = "ripe-stat";

export class Registries {
    /** The most prefixes a set may take from a registry: more is a wrong query, such as a transit's AS, not a customer's. */
    static readonly MOST = 100_000;

    /**
     * The device with each prefix set a registry fills fetched, as a set of the prefixes it gave, so `diff` and `apply` put them on
     * the device like any other list: each prefix added or removed, never the list emptied first. `told` hears each set fetched.
     * Stops on a registry that can't be reached, an empty answer, or too long a one, so a list is never emptied by mistake.
     */
    static async resolve(device: Device, told: (line: string) => void = () => {}): Promise<Device> {
        const sets = device.routing?.prefix_sets;
        if (!sets || !Object.values(sets).some((set) => set && "source" in set)) return device;

        const resolved: NonNullable<NonNullable<Device["routing"]>["prefix_sets"]> = {};
        for (const [name, set] of Object.entries(sets)) {
            if (!set || !("source" in set)) {
                if (set) resolved[name] = set;
                continue;
            }

            const { registry, query, family } = set.source;
            let prefixes: string[];
            try {
                prefixes = await Registries.prefixes(registry, query, family);
            } catch (error) {
                throw new Error(
                    `routing.prefix_sets.${name}: ${registry} ${query}: ${error instanceof Error ? error.message : String(error)}`
                );
            }
            if (!prefixes.length)
                throw new Error(`routing.prefix_sets.${name}: ${registry} gave no ${family} prefix for ${query}, so nothing was sent`);
            if (prefixes.length > Registries.MOST)
                throw new Error(
                    `routing.prefix_sets.${name}: ${registry} gave ${prefixes.length} prefixes for ${query}, more than ${Registries.MOST}: check the query`
                );

            told(`${name}: ${prefixes.length} ${family} prefix(es) from ${registry} ${query}`);
            resolved[name] = { prefixes: prefixes.map((prefix) => Address.prefixOf(prefix)) };
        }

        return { ...device, routing: { ...device.routing, prefix_sets: resolved } };
    }

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
