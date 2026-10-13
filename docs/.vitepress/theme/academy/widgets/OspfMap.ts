// OSPF lesson: the shortest path first calculation every OSPF router runs over its map of links and costs (Dijkstra's algorithm).

export type Link = { a: string; b: string; cost: number; up: boolean };

export type ShortestPaths = {
    /** The total cost from the source to each router it can reach. */
    cost: Map<string, number>;
    /** For each router, the routers just before it on every path of the lowest cost. */
    before: Map<string, string[]>;
};

/** The cost of the cheapest path from the source to every router, over the links that are up. */
export function shortestPaths(routers: readonly string[], links: readonly Link[], source: string): ShortestPaths {
    const cost = new Map<string, number>([[source, 0]]);
    const before = new Map<string, string[]>([[source, []]]);
    const done = new Set<string>();

    while (done.size < routers.length) {
        // The closest router not done yet. Its cost cannot get any lower.
        let closest: string | undefined;

        for (const router of routers) {
            if (done.has(router) || !cost.has(router)) continue;
            if (closest === undefined || cost.get(router)! < cost.get(closest)!) closest = router;
        }

        if (closest === undefined) break;
        done.add(closest);

        for (const link of links) {
            if (!link.up || (link.a !== closest && link.b !== closest)) continue;

            const neighbor = link.a === closest ? link.b : link.a;
            if (done.has(neighbor)) continue;

            const through = cost.get(closest)! + link.cost;
            const known = cost.get(neighbor);

            if (known === undefined || through < known) {
                cost.set(neighbor, through);
                before.set(neighbor, [closest]);
            } else if (through === known) {
                before.get(neighbor)!.push(closest);
            }
        }
    }

    return { cost, before };
}

/** Every path of the lowest cost from the source to the target, each a list of routers from source to target. */
export function pathsTo(paths: ShortestPaths, target: string): string[][] {
    if (!paths.cost.has(target)) return [];

    const previous = paths.before.get(target)!;
    if (previous.length === 0) return [[target]];

    return previous.flatMap((router) => pathsTo(paths, router).map((path) => [...path, target]));
}

/** The neighbors a router sends through to reach the target: the second router of every cheapest path. */
export function nextHops(paths: ShortestPaths, target: string): string[] {
    return [...new Set(pathsTo(paths, target).map((path) => path[1] ?? path[0]!))];
}
