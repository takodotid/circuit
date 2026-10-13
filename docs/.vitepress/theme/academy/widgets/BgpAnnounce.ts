// BGP lesson: one prefix announced from AS to AS, in rounds, with the AS path growing at every hop and loops dropped.

/** One announcement on its way: from one AS to a neighbor, with the AS path the receiver will see. */
export type Message = { from: number; to: number; path: number[] };

/** What happened to a message when it arrived. */
export type Arrival = Message & { result: "loop" | "new" | "shorter" | "longer" };

export type Round = {
    /** The messages that arrived in this round. */
    arrivals: Arrival[];
    /** The path each AS keeps after this round. An empty path is the origin's own prefix. */
    best: Map<number, number[]>;
    /** The messages sent at the end of this round, which arrive in the next. */
    sent: Message[];
};

/**
 * Every round of announcing one prefix, until nothing changes.
 *
 * Each AS keeps the shortest path it hears, and keeps the one it has when a new one is no shorter. Whenever its path changes, it sends the path to every neighbor with its own number added at the front. An AS that finds its own number in a path drops it.
 */
export function announce(links: readonly [number, number][], origin: number): Round[] {
    const neighborsOf = (as: number) => links.flatMap(([a, b]) => (a === as ? [b] : b === as ? [a] : []));
    const send = (as: number, path: number[]): Message[] => neighborsOf(as).map((to) => ({ from: as, to, path: [as, ...path] }));

    const best = new Map<number, number[]>([[origin, []]]);
    const rounds: Round[] = [{ arrivals: [], best: new Map(best), sent: send(origin, []) }];

    while (rounds[rounds.length - 1]!.sent.length && rounds.length < 50) {
        const arriving = rounds[rounds.length - 1]!.sent;
        const changed = new Set<number>();

        const arrivals = arriving.map((message): Arrival => {
            if (message.path.includes(message.to)) return { ...message, result: "loop" };

            const known = best.get(message.to);

            if (known === undefined) {
                best.set(message.to, message.path);
                changed.add(message.to);
                return { ...message, result: "new" };
            }

            if (message.path.length < known.length) {
                best.set(message.to, message.path);
                changed.add(message.to);
                return { ...message, result: "shorter" };
            }

            return { ...message, result: "longer" };
        });

        const sent = [...changed].flatMap((as) => send(as, best.get(as)!));
        rounds.push({ arrivals, best: new Map(best), sent });
    }

    return rounds;
}
