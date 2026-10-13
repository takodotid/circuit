// Hijacks and leaks lesson: one address block spreading through seven ASes, with a hijack or a leak from AS64510, and the defences that stop it.

import { inside, type Roa, validate } from "./OriginCheck";

export const YOU = 64500;
export const OTHER = 64510;
export const YOUR_BLOCK = "2001:db8:a00::/40";
export const MORE_SPECIFIC = "2001:db8:a00::/48";
/** The address the traffic in the widget goes to, inside both prefixes. */
export const TARGET = "2001:db8:a00::10";

/** Provider to customer, and the one pair of peers. */
const PROVIDES: [number, number][] = [
    [64496, 64501],
    [64496, 64503],
    [64497, 64502],
    [64497, OTHER],
    [64501, YOU],
    [64501, OTHER],
];
const PEERS: [number, number][] = [[64496, 64497]];

export const ASES = [64496, 64497, 64501, 64502, 64503, YOU, OTHER];

/** The address space each AS registered: what its providers accept from it when they filter by registry. A provider's registration includes its customers'. */
const REGISTERED: Record<number, string[]> = {
    [YOU]: [YOUR_BLOCK],
    [OTHER]: ["2001:db8:b00::/40"],
    64501: ["2001:db8:100::/40", YOUR_BLOCK, "2001:db8:b00::/40"],
    64502: ["2001:db8:c00::/40"],
    64503: ["2001:db8:d00::/40"],
};

export type Scenario = "normal" | "same" | "specific" | "forged" | "leak";
export type RoaChoice = "none" | "40" | "48";

export type Defences = {
    roa: RoaChoice;
    /** The ASes that drop RPKI invalid routes. */
    rov: number[];
    /** Every provider accepts from a customer only what the customer registered. */
    registry: boolean;
};

type Relation = "self" | "customer" | "peer" | "provider";

export type Route = {
    prefix: string;
    /** The AS path as this AS holds it, nearest first; empty for a route it originates. */
    path: number[];
    from: number;
    relation: Relation;
};

/** What a neighbor is to an AS. */
function relationOf(as: number, neighbor: number): Relation | undefined {
    if (PROVIDES.some(([provider, customer]) => provider === as && customer === neighbor)) return "customer";
    if (PROVIDES.some(([provider, customer]) => provider === neighbor && customer === as)) return "provider";
    if (PEERS.some(([a, b]) => (a === as && b === neighbor) || (b === as && a === neighbor))) return "peer";
    return undefined;
}

const neighborsOf = (as: number) => ASES.filter((other) => relationOf(as, other) !== undefined);

const RANK: Record<Relation, number> = { self: 0, customer: 1, peer: 2, provider: 3 };

/** A route from a customer beats one from a peer, which beats one from a provider; then the shorter path; then the lower neighbor AS. */
function better(a: Route, b: Route): boolean {
    if (RANK[a.relation] !== RANK[b.relation]) return RANK[a.relation] < RANK[b.relation];
    if (a.path.length !== b.path.length) return a.path.length < b.path.length;
    return a.from < b.from;
}

export function roasOf(choice: RoaChoice): Roa[] {
    if (choice === "none") return [];
    return [{ prefix: YOUR_BLOCK, maxLength: Number(choice), asn: YOU }];
}

/** Why an AS refuses a route, or undefined when it takes it. */
function refusal(as: number, route: Route, defences: Defences): string | undefined {
    if (route.path.includes(as)) return "its own AS is in the path";
    if (as === YOU && inside(route.prefix, YOUR_BLOCK)) return "it is your own space, coming back";

    if (defences.rov.includes(as)) {
        const origin = route.path[route.path.length - 1]!;
        const state = validate(roasOf(defences.roa), route.prefix, origin).state;
        if (state === "invalid-origin") return "RPKI invalid: the ROA names another origin";
        if (state === "invalid-length") return "RPKI invalid: longer than the ROA allows";
    }

    if (
        defences.registry &&
        route.relation === "customer" &&
        !(REGISTERED[route.from] ?? []).some((block) => inside(route.prefix, block))
    ) {
        return `AS${route.from} never registered it`;
    }

    return undefined;
}

/** Whether an AS passes a route on to a neighbor: routes from customers and its own go to everyone, the rest only to customers. A leaking AS passes on everything. */
function exports(as: number, route: Route, to: number, leaking: boolean): boolean {
    if (to === route.from) return false;
    if (leaking || route.relation === "self" || route.relation === "customer") return true;
    return relationOf(as, to) === "customer";
}

export type Outcome = {
    /** The route each AS uses for each prefix it holds. */
    tables: Map<number, Map<string, Route>>;
    /** Routes refused, with the AS that refused them and why. */
    refused: { at: number; route: Route; reason: string }[];
};

/**
 * Every AS's routes once nothing changes any more, announcing in rounds.
 *
 * Each AS keeps the latest route each neighbor sent for each prefix, and uses the best of them. Whenever the one it uses changes, it tells every neighbor: the new route where it may pass it on, a withdrawal elsewhere.
 */
export function spread(scenario: Scenario, defences: Defences): Outcome {
    const prefixes = scenario === "specific" || scenario === "forged" ? [YOUR_BLOCK, MORE_SPECIFIC] : [YOUR_BLOCK];
    const tables = new Map<number, Map<string, Route>>(ASES.map((as) => [as, new Map()]));
    /** What each AS heard, by prefix, then by neighbor. */
    const heard = new Map<number, Map<string, Map<number, Route>>>(
        ASES.map((as) => [as, new Map(prefixes.map((prefix) => [prefix, new Map()]))])
    );
    const own = new Map<number, Map<string, Route>>(ASES.map((as) => [as, new Map()]));
    const refused: Outcome["refused"] = [];

    own.get(YOU)!.set(YOUR_BLOCK, { prefix: YOUR_BLOCK, path: [], from: YOU, relation: "self" });
    if (scenario === "same") own.get(OTHER)!.set(YOUR_BLOCK, { prefix: YOUR_BLOCK, path: [], from: OTHER, relation: "self" });
    if (scenario === "specific") own.get(OTHER)!.set(MORE_SPECIFIC, { prefix: MORE_SPECIFIC, path: [], from: OTHER, relation: "self" });
    // A forged origin: AS64510 claims to have heard the route from you.
    if (scenario === "forged") own.get(OTHER)!.set(MORE_SPECIFIC, { prefix: MORE_SPECIFIC, path: [YOU], from: OTHER, relation: "self" });

    const leaking = (as: number) => scenario === "leak" && as === OTHER;

    /** The route an AS uses for a prefix: its own, or the best one heard. */
    const choose = (as: number, prefix: string): Route | undefined => {
        const mine = own.get(as)!.get(prefix);
        if (mine) return mine;

        let best: Route | undefined;
        for (const route of heard.get(as)!.get(prefix)!.values()) {
            if (!best || better(route, best)) best = route;
        }
        return best;
    };

    const same = (a: Route | undefined, b: Route | undefined) => a?.from === b?.from && a?.path.join(" ") === b?.path.join(" ");

    let changed: { as: number; prefix: string }[] = [];

    for (const as of ASES) {
        for (const prefix of prefixes) {
            const route = choose(as, prefix);
            if (!route) continue;
            tables.get(as)!.set(prefix, route);
            changed.push({ as, prefix });
        }
    }

    for (let round = 0; round < 40 && changed.length > 0; round++) {
        const arriving: { to: number; from: number; prefix: string; route: Route | undefined }[] = [];

        for (const { as, prefix } of changed) {
            const route = tables.get(as)!.get(prefix);

            for (const to of neighborsOf(as)) {
                const passed = route && exports(as, route, to, leaking(as));
                arriving.push({
                    to,
                    from: as,
                    prefix,
                    route: passed ? { prefix, path: [as, ...route.path], from: as, relation: relationOf(to, as)! } : undefined,
                });
            }
        }

        const touched = new Map<string, { as: number; prefix: string }>();

        for (const { to, from, prefix, route } of arriving) {
            const reason = route && refusal(to, route, defences);
            if (route && reason) refused.push({ at: to, route, reason });

            const fromNeighbor = heard.get(to)!.get(prefix)!;
            if (route && !reason) fromNeighbor.set(from, route);
            else fromNeighbor.delete(from);

            touched.set(`${to} ${prefix}`, { as: to, prefix });
        }

        changed = [];

        for (const { as, prefix } of touched.values()) {
            const before = tables.get(as)!.get(prefix);
            const after = choose(as, prefix);
            if (same(before, after)) continue;

            if (after) tables.get(as)!.set(prefix, after);
            else tables.get(as)!.delete(prefix);
            changed.push({ as, prefix });
        }
    }

    return { tables, refused };
}

export type Delivery = { hops: number[]; end: "you" | "other" | "none"; via: Route | undefined };

/** Where traffic to the target goes from an AS: each AS on the way uses its longest matching route, and hands the traffic to the neighbor it learned that route from. */
export function deliver(outcome: Outcome, start: number): Delivery {
    const hops = [start];
    let as = start;
    let first: Route | undefined;

    for (let step = 0; step < 10; step++) {
        const routes = [...outcome.tables.get(as)!.values()].filter((route) => inside(TARGET + "/128", route.prefix));
        const route = routes.sort((a, b) => Number(b.prefix.split("/")[1]) - Number(a.prefix.split("/")[1]))[0];
        if (step === 0) first = route;

        if (!route) return { hops, end: "none", via: first };
        if (route.relation === "self") return { hops, end: as === YOU ? "you" : "other", via: first };

        as = route.from;
        hops.push(as);
    }

    return { hops, end: "none", via: first };
}
