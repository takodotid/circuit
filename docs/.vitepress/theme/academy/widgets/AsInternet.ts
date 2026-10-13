// Networks of networks lesson: which networks can reach which, when each passes on only the routes it is paid to carry.

/** A transit link has a customer, who pays, and a provider. A peering link has two equal sides. */
export type AsLink = { kind: "transit"; customer: string; provider: string } | { kind: "peering"; a: string; b: string };

type Step = { to: string; direction: "up" | "across" | "down" };

/** Where a network can send from here: up to a provider, across to a peer, or down to a customer. */
function steps(links: readonly AsLink[], from: string): Step[] {
    return links.flatMap((link): Step[] => {
        if (link.kind === "transit") {
            if (link.customer === from) return [{ to: link.provider, direction: "up" }];
            if (link.provider === from) return [{ to: link.customer, direction: "down" }];
            return [];
        }

        if (link.a === from) return [{ to: link.b, direction: "across" }];
        if (link.b === from) return [{ to: link.a, direction: "across" }];
        return [];
    });
}

/**
 * The shortest way from one network to another that every network on it would carry, or undefined when there is none.
 *
 * A network carries traffic for its customers and itself only. So a working path climbs from customer to provider, crosses at most one peering, then only descends from provider to customer.
 */
export function pathBetween(links: readonly AsLink[], from: string, to: string): string[] | undefined {
    type State = { at: string; climbing: boolean; path: string[] };

    const queue: State[] = [{ at: from, climbing: true, path: [from] }];
    const seen = new Set([`${from}:true`]);

    while (queue.length) {
        const state = queue.shift()!;
        if (state.at === to) return state.path;

        for (const step of steps(links, state.at)) {
            if (!state.climbing && step.direction !== "down") continue;

            const climbing = state.climbing && step.direction === "up";
            const key = `${step.to}:${climbing}`;
            if (seen.has(key)) continue;

            seen.add(key);
            queue.push({ at: step.to, climbing, path: [...state.path, step.to] });
        }
    }

    return undefined;
}
