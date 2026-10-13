<script setup lang="ts">
// Lesson: choosing the best route. The reader prepends their own AS toward one transit or the other, and watches which way a far network sends its traffic in.

import { computed, ref } from "vue";
import { useTravel } from "../travel";

type Place = { id: string; kind: "router" | "cloud"; label: string; note: string; x: number; y: number };

const places: Place[] = [
    { id: "you", kind: "router", label: "Your network", note: "AS64500", x: 90, y: 140 },
    { id: "a", kind: "router", label: "Transit A", note: "AS64510", x: 350, y: 55 },
    { id: "b", kind: "router", label: "Transit B", note: "AS64511", x: 350, y: 225 },
    { id: "far", kind: "cloud", label: "A far network", note: "AS64520", x: 610, y: 140 },
];

const at = (id: string) => places.find((place) => place.id === id)!;

const cables = [
    ["you", "a"],
    ["you", "b"],
    ["a", "far"],
    ["b", "far"],
] as const;

const prependA = ref(0);
const prependB = ref(0);
const farPrefersB = ref(false);
const COUNTS = [0, 1, 2, 3];

/** The two routes the far network holds for your prefix. */
const options = computed(() => [
    { via: "a", name: "Transit A", path: [64510, ...Array(1 + prependA.value).fill(64500)], localPref: 100, routerId: "192.0.2.1" },
    {
        via: "b",
        name: "Transit B",
        path: [64511, ...Array(1 + prependB.value).fill(64500)],
        localPref: farPrefersB.value ? 200 : 100,
        routerId: "192.0.2.2",
    },
]);

/** The far network's choice, by the lesson's order: local preference, then AS path length, then the tie-break. Origin, MED and the session kind are the same for both. */
const choice = computed(() => {
    const a = options.value[0]!;
    const b = options.value[1]!;

    if (a.localPref !== b.localPref) {
        const winner = a.localPref > b.localPref ? a : b;
        return {
            winner,
            why: `AS64520 gives routes from ${winner.name} local preference ${winner.localPref}. That is checked before the AS path, so your prepends do not change its mind.`,
        };
    }

    if (a.path.length !== b.path.length) {
        const winner = a.path.length < b.path.length ? a : b;
        const loser = winner === a ? b : a;
        return {
            winner,
            why: `The path through ${winner.name} is ${winner.path.length} ASes long, against ${loser.path.length} through ${loser.name}. The shorter one wins.`,
        };
    }

    return { winner: a, why: `Both paths are ${a.path.length} ASes long, so the tie-break decides: Transit A has the lower router ID.` };
});

const said = ref<string>();
const { position, travelling, travel } = useTravel();

function setPrepend(which: "a" | "b", count: number) {
    if (which === "a") prependA.value = count;
    else prependB.value = count;
    said.value = undefined;
}

function togglePreference() {
    farPrefersB.value = !farPrefersB.value;
    said.value = undefined;
}

async function send() {
    said.value = undefined;
    const via = choice.value.winner.via;
    await travel([at("far"), at(via), at("you")].map((place) => [place.x, place.y]));
    said.value = `Traffic to you came in over ${choice.value.winner.name}. ${choice.value.why}`;
}

const exportRule = (count: number) =>
    count
        ? `{ description: "Announce 198.51.100.0/24", match: { prefix: "198.51.100.0/24" }, set: { prepend: ${count} }, action: "accept" },`
        : `{ description: "Announce 198.51.100.0/24", match: { prefix: "198.51.100.0/24" }, action: "accept" },`;

const code = computed(() =>
    [
        `"TRANSIT-A-OUT": [`,
        `    ${exportRule(prependA.value)}`,
        `    { description: "Nothing else leaves", action: "reject" },`,
        `],`,
        `"TRANSIT-B-OUT": [`,
        `    ${exportRule(prependB.value)}`,
        `    { description: "Nothing else leaves", action: "reject" },`,
        `],`,
    ].join("\n")
);

const changedLines = computed(() => [...(prependA.value ? [2] : []), ...(prependB.value ? [6] : [])]);

const isLit = (from: string, to: string) => {
    const via = choice.value.winner.via;
    return (from === "you" && to === via) || (from === via && to === "far");
};
</script>

<template>
    <div class="prepend-path">
        <svg
            class="ac-drawing"
            viewBox="0 0 700 300"
            role="img"
            aria-label="Your network joined to Transit A and Transit B, which both reach a far network. The path the far network uses to reach you is lit."
        >
            <line
                v-for="[from, to] in cables"
                :key="`${from}-${to}`"
                class="cable"
                :class="{ lit: isLit(from, to) }"
                :x1="at(from).x"
                :y1="at(from).y"
                :x2="at(to).x"
                :y2="at(to).y"
            />
            <SvgDevice
                v-for="place in places"
                :key="place.id"
                :kind="place.kind"
                :x="place.x"
                :y="place.y"
                :label="place.label"
                :note="place.note"
                :lit="place.id === choice.winner.via"
            />
            <circle v-if="travelling" class="packet" :cx="position[0]" :cy="position[1]" r="9" />
        </svg>

        <div class="controls">
            <div class="ac-field">
                <span>Prepend toward Transit A</span>
                <div class="ac-row" role="group" aria-label="Prepend toward Transit A">
                    <button
                        v-for="count in COUNTS"
                        :key="count"
                        type="button"
                        class="ac-button small"
                        :aria-pressed="prependA === count"
                        @click="setPrepend('a', count)"
                    >
                        {{ count }}
                    </button>
                </div>
            </div>
            <div class="ac-field">
                <span>Prepend toward Transit B</span>
                <div class="ac-row" role="group" aria-label="Prepend toward Transit B">
                    <button
                        v-for="count in COUNTS"
                        :key="count"
                        type="button"
                        class="ac-button small"
                        :aria-pressed="prependB === count"
                        @click="setPrepend('b', count)"
                    >
                        {{ count }}
                    </button>
                </div>
            </div>
            <div class="ac-field">
                <span>What AS64520 itself prefers</span>
                <button type="button" class="ac-button small" :aria-pressed="farPrefersB" @click="togglePreference">
                    Local preference 200 for Transit B
                </button>
            </div>
        </div>

        <div class="table-frame">
            <table class="ac-table">
                <caption>
                    The routes AS64520 holds for your 198.51.100.0/24
                </caption>
                <thead>
                    <tr>
                        <th>Via</th>
                        <th>AS path</th>
                        <th>Length</th>
                        <th>Local pref</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="option in options" :key="option.via" :class="{ lit: option === choice.winner }">
                        <td>{{ option.name }}<template v-if="option === choice.winner"> (chosen)</template></td>
                        <td class="ac-mono">{{ option.path.join(" ") }}</td>
                        <td>{{ option.path.length }}</td>
                        <td>{{ option.localPref }}</td>
                    </tr>
                </tbody>
            </table>
        </div>

        <div class="ac-row send">
            <button type="button" class="ac-button primary" :disabled="travelling" @click="send">Send traffic to you</button>
        </div>

        <p v-if="said" class="ac-say good" aria-live="polite">{{ said }}</p>
        <p v-else class="ac-say hint" aria-live="polite">
            Send traffic first. Then prepend toward the transit it came over, and send again.
        </p>

        <CodeView :code="code" title="edge-01.ts, your exports" :highlight="changedLines" />
    </div>
</template>

<style scoped>
.controls {
    display: flex;
    flex-wrap: wrap;
    gap: 14px 24px;
    margin-top: 10px;
}

.table-frame {
    overflow-x: auto;
}

caption {
    padding-bottom: 4px;
    color: var(--circuit-soft);
    font-size: 13px;
    font-weight: 600;
    text-align: left;
}

.send {
    margin-top: 14px;
}

.hint {
    color: var(--circuit-soft);
}
</style>
