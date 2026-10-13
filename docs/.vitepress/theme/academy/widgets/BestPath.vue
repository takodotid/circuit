<script setup lang="ts">
// Lesson: choosing the best route. The reader changes the local preference, origin and MED of four routes to one prefix, and watches which step of the order picks the winner.

import { computed, ref } from "vue";

type Origin = "igp" | "egp" | "incomplete";

type Route = {
    id: string;
    from: string;
    session: "eBGP" | "iBGP";
    path: number[];
    routerId: string;
    localPref: number;
    origin: Origin;
    med: number;
};

const ORIGIN_LABEL: Record<Origin, string> = { igp: "IGP", egp: "EGP", incomplete: "incomplete" };
const ORIGIN_RANK: Record<Origin, number> = { igp: 0, egp: 1, incomplete: 2 };

const LOCAL_PREFS = [50, 100, 150, 200];
const MEDS = [0, 10, 50];

const fresh = (): Route[] => [
    {
        id: "transit-a",
        from: "Transit A",
        session: "eBGP",
        path: [64510, 64505],
        routerId: "192.0.2.1",
        localPref: 100,
        origin: "igp",
        med: 0,
    },
    {
        id: "transit-b",
        from: "Transit B",
        session: "eBGP",
        path: [64511, 64505],
        routerId: "192.0.2.2",
        localPref: 100,
        origin: "igp",
        med: 0,
    },
    { id: "exchange", from: "Exchange peer", session: "eBGP", path: [64505], routerId: "192.0.2.3", localPref: 100, origin: "igp", med: 0 },
    {
        id: "edge-02",
        from: "edge-02, your other router",
        session: "iBGP",
        path: [64512, 64505],
        routerId: "10.0.0.2",
        localPref: 100,
        origin: "igp",
        med: 0,
    },
];

const routes = ref<Route[]>(fresh());

/** A router ID as one number, so 10.0.0.2 sorts below 192.0.2.1. */
const routerIdNumber = (id: string) => id.split(".").reduce((sum, part) => sum * 256 + Number(part), 0);

type Step = {
    name: string;
    rule: string;
    prefer: "high" | "low";
    key: (route: Route) => number;
    show: (route: Route) => string;
};

/** The order this widget applies, exactly as the lesson states it. */
const steps: Step[] = [
    {
        name: "Local preference",
        rule: "highest wins",
        prefer: "high",
        key: (route) => route.localPref,
        show: (route) => String(route.localPref),
    },
    {
        name: "AS path length",
        rule: "shortest wins",
        prefer: "low",
        key: (route) => route.path.length,
        show: (route) => `${route.path.length} AS${route.path.length > 1 ? "es" : ""}`,
    },
    {
        name: "Origin",
        rule: "IGP, then EGP, then incomplete",
        prefer: "low",
        key: (route) => ORIGIN_RANK[route.origin],
        show: (route) => ORIGIN_LABEL[route.origin],
    },
    { name: "MED", rule: "lowest wins", prefer: "low", key: (route) => route.med, show: (route) => String(route.med) },
    {
        name: "eBGP or iBGP",
        rule: "eBGP wins over iBGP",
        prefer: "low",
        key: (route) => (route.session === "eBGP" ? 0 : 1),
        show: (route) => route.session,
    },
    {
        name: "Tie-break",
        rule: "lowest router ID wins",
        prefer: "low",
        key: (route) => routerIdNumber(route.routerId),
        show: (route) => route.routerId,
    },
];

type Row = {
    step: Step;
    index: number;
    state: "tie" | "narrowed" | "decided" | "unused";
    kept: Route[];
    dropped: Route[];
    compared: Route[];
};

const outcome = computed(() => {
    let left = routes.value.slice();
    let decidedAt = -1;
    const rows: Row[] = [];

    steps.forEach((step, index) => {
        if (decidedAt >= 0) {
            rows.push({ step, index, state: "unused", kept: [], dropped: [], compared: [] });
            return;
        }

        const values = left.map(step.key);
        const best = step.prefer === "high" ? Math.max(...values) : Math.min(...values);
        const kept = left.filter((route) => step.key(route) === best);
        const dropped = left.filter((route) => step.key(route) !== best);
        const state = kept.length === 1 ? "decided" : dropped.length ? "narrowed" : "tie";

        rows.push({ step, index, state, kept, dropped, compared: left });
        left = kept;
        if (kept.length === 1) decidedAt = index;
    });

    return { rows, winner: left[0]!, decidedAt };
});

/** Where a route was dropped, in words. */
function droppedAt(route: Route): string {
    const row = outcome.value.rows.find((entry) => entry.dropped.some((dropped) => dropped.id === route.id));
    return row ? `Out at step ${row.index + 1}, ${row.step.name.toLowerCase()}` : "";
}

const REASONS = [
    (route: Route) => `its local preference, ${route.localPref}, is the highest`,
    (route: Route) => `its AS path, ${route.path.length} AS${route.path.length > 1 ? "es" : ""} long, is the shortest`,
    (route: Route) => `its origin, ${ORIGIN_LABEL[route.origin]}, comes first`,
    (route: Route) => `its MED, ${route.med}, is the lowest`,
    () => "it is the only eBGP route left",
    (route: Route) => `its router ID, ${route.routerId}, is the lowest`,
];

const verdict = computed(() => {
    const { winner, decidedAt } = outcome.value;
    return `${winner.from} wins at step ${decidedAt + 1}, ${steps[decidedAt]!.name.toLowerCase()}: ${REASONS[decidedAt]!(winner)}.`;
});

function rowText(row: Row): string {
    if (row.state === "unused") return "Not needed: the route is already chosen.";

    const values = row.compared.map((route) => `${route.from.split(",")[0]} ${row.step.show(route)}`).join(", ");
    if (row.state === "tie") return `${values}. A tie, so on to the next step.`;

    const kept = row.kept.map((route) => route.from.split(",")[0]).join(" and ");
    if (row.state === "decided") return `${values}. ${kept} is chosen.`;
    return `${values}. ${kept} go on.`;
}

const goals = [
    { text: "Transit B is your cheapest contract. Make it the best route.", done: () => outcome.value.winner.id === "transit-b" },
    { text: "Make the choice come down to step 5, eBGP over iBGP.", done: () => outcome.value.decidedAt === 4 },
    { text: "Make the choice come down to the tie-break.", done: () => outcome.value.decidedAt === 5 },
];

const pref = (id: string) => routes.value.find((route) => route.id === id)!.localPref;

const code = computed(() =>
    [
        "policies: {",
        "    SANITY: bgpSanity(),",
        `    "TRANSIT-A-IN": [{ call: "SANITY" }, { set: { local_pref: ${pref("transit-a")} } }, { action: "accept" }],`,
        `    "TRANSIT-B-IN": [{ call: "SANITY" }, { set: { local_pref: ${pref("transit-b")} } }, { action: "accept" }],`,
        `    "IX-IN": [{ call: "SANITY" }, { set: { local_pref: ${pref("exchange")} } }, { action: "accept" }],`,
        "},",
        "// edge-02 sets the local preference of its route in its own import policy.",
    ].join("\n")
);

const changedLines = computed(() =>
    [
        ["transit-a", 3],
        ["transit-b", 4],
        ["exchange", 5],
    ]
        .filter(([id]) => pref(id as string) !== 100)
        .map(([, line]) => line as number)
);

function reset() {
    routes.value = fresh();
}
</script>

<template>
    <div class="best-path">
        <p class="prefix">Four routes to <span class="ac-mono">203.0.113.0/24</span>, a network in AS64505</p>

        <div class="routes">
            <article v-for="route in routes" :key="route.id" class="route" :class="{ winner: route.id === outcome.winner.id }">
                <header>
                    <strong>{{ route.from }}</strong>
                    <span class="tag">{{ route.session }}</span>
                </header>
                <p class="facts">
                    AS path <span class="ac-mono">{{ route.path.join(" ") }}</span
                    ><br />
                    Router ID <span class="ac-mono">{{ route.routerId }}</span>
                </p>

                <div class="fields">
                    <label class="ac-field">
                        <span>Local preference</span>
                        <select v-model.number="route.localPref" class="ac-select">
                            <option v-for="value in LOCAL_PREFS" :key="value" :value="value">{{ value }}</option>
                        </select>
                    </label>
                    <label class="ac-field">
                        <span>Origin</span>
                        <select v-model="route.origin" class="ac-select">
                            <option v-for="(label, value) in ORIGIN_LABEL" :key="value" :value="value">{{ label }}</option>
                        </select>
                    </label>
                    <label class="ac-field">
                        <span>MED</span>
                        <select v-model.number="route.med" class="ac-select">
                            <option v-for="value in MEDS" :key="value" :value="value">{{ value }}</option>
                        </select>
                    </label>
                </div>

                <p class="status">
                    <template v-if="route.id === outcome.winner.id"><span class="best">Best route</span></template>
                    <template v-else>{{ droppedAt(route) }}</template>
                </p>
            </article>
        </div>

        <ol class="ladder" aria-label="The order of the comparison">
            <li v-for="row in outcome.rows" :key="row.index" :class="row.state">
                <span class="number">{{ row.index + 1 }}</span>
                <div>
                    <p class="name">
                        {{ row.step.name }}: <span class="rule">{{ row.step.rule }}</span>
                    </p>
                    <p class="result">{{ rowText(row) }}</p>
                </div>
            </li>
        </ol>

        <p class="ac-say good" data-word="Best" aria-live="polite">{{ verdict }}</p>

        <div class="goals">
            <p class="goals-title">Try these</p>
            <ul>
                <li v-for="goal in goals" :key="goal.text" :class="{ done: goal.done() }">
                    <span class="mark">{{ goal.done() ? "Done" : "To do" }}</span>
                    {{ goal.text }}
                </li>
            </ul>
            <button type="button" class="ac-button small" @click="reset">Start over</button>
        </div>

        <CodeView :code="code" title="edge-01.ts, the local preference you chose" :highlight="changedLines" />
    </div>
</template>

<style scoped>
.prefix {
    margin: 0 0 12px;
    font-weight: 700;
}

.routes {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
}

@media (max-width: 640px) {
    .routes {
        grid-template-columns: 1fr;
    }
}

.route {
    padding: 12px 14px;
    border: 1.5px solid var(--circuit-line);
    background: var(--circuit-paper);
    transition:
        border-color 0.2s,
        background-color 0.2s;
}

.route.winner {
    border: 2px solid var(--circuit-ink);
    background: var(--circuit-selected);
}

.route header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
}

.tag {
    padding: 0 6px;
    border: 1px solid var(--circuit-edge);
    border-radius: 2px;
    color: var(--circuit-soft);
    font-size: 12px;
    font-weight: 700;
    line-height: 20px;
}

.facts {
    margin: 6px 0 10px;
    color: var(--circuit-soft);
    font-size: 14px;
    line-height: 1.6;
}

.fields {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
}

.fields .ac-select {
    width: 100%;
}

.status {
    margin: 10px 0 0;
    color: var(--circuit-soft);
    font-size: 14px;
}

.best {
    padding: 1px 8px;
    background: var(--circuit-ink);
    color: var(--circuit-paper);
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
}

.ladder {
    display: grid;
    gap: 6px;
    margin: 18px 0 0 !important;
    padding: 0 !important;
    list-style: none;
}

.ladder li {
    display: flex;
    gap: 12px;
    margin: 0 !important;
    padding: 8px 10px;
    border-left: 4px solid var(--circuit-line);
}

.ladder li.decided {
    border-left-color: var(--circuit-yellow);
    background: var(--circuit-selected);
}

.ladder li.unused {
    opacity: 0.55;
}

.ladder p {
    margin: 0;
    line-height: 1.5;
}

.number {
    flex: none;
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    background: var(--circuit-cobalt);
    color: #ffffff;
    font-size: 13px;
    font-weight: 700;
}

.name {
    font-weight: 700;
}

.rule {
    color: var(--circuit-soft);
    font-weight: 400;
}

.result {
    font-size: 14.5px;
}

.goals {
    margin-top: 16px;
    padding-top: 12px;
    border-top: 1px solid var(--circuit-line);
}

.goals-title {
    margin: 0 0 6px;
    font-weight: 700;
}

.goals ul {
    margin: 0 0 10px !important;
    padding: 0 !important;
    list-style: none;
}

.goals li {
    margin: 4px 0 !important;
}

.mark {
    display: inline-block;
    min-width: 56px;
    margin-right: 8px;
    padding: 0 6px;
    border: 1.5px dashed var(--circuit-edge);
    color: var(--circuit-soft);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.06em;
    line-height: 18px;
    text-align: center;
    text-transform: uppercase;
}

.goals li.done .mark {
    border: 1.5px solid var(--circuit-added);
    background: var(--circuit-added);
    color: #ffffff;
}
</style>
