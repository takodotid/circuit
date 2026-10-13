<script setup lang="ts">
// Lesson: staying up. The reader joins two switches with several cables, as separate links or as one LAG, cuts cables, and sees where six conversations go.

import { computed, ref } from "vue";

type Mode = "separate" | "lag";

const COUNTS = [2, 3, 4];
const FLOWS = 6;
const SPEED = 10;

const count = ref(2);
const mode = ref<Mode>("separate");
const cut = ref<number[]>([]);

const cables = computed(() => Array.from({ length: count.value }, (_, index) => index + 1));
const up = computed(() => cables.value.filter((cable) => !cut.value.includes(cable)));

/** Which cable each conversation uses. Separate links: spanning tree leaves only the first working cable open. A LAG: conversations take turns over every working cable. */
const flowsOn = computed(() => {
    const result: Record<number, number[]> = {};
    for (const cable of cables.value) result[cable] = [];

    if (!up.value.length) return result;

    for (let flow = 1; flow <= FLOWS; flow++) {
        const cable = mode.value === "lag" ? up.value[(flow - 1) % up.value.length]! : up.value[0]!;
        result[cable]!.push(flow);
    }

    return result;
});

function stateOf(cable: number): "cut" | "blocked" | "carrying" {
    if (cut.value.includes(cable)) return "cut";
    if (mode.value === "separate" && cable !== up.value[0]) return "blocked";
    return "carrying";
}

/** What a cable is doing, in a few words for the drawing. */
function cableText(cable: number): string {
    const state = stateOf(cable);
    if (state === "cut") return "cut";
    if (state === "blocked") return "blocked by spanning tree";
    const flows = flowsOn.value[cable]?.length ?? 0;
    return `${flows} conversation${flows === 1 ? "" : "s"}`;
}

function setCount(value: number) {
    count.value = value;
    cut.value = cut.value.filter((cable) => cable <= value);
}

function toggleCut(cable: number) {
    cut.value = cut.value.includes(cable) ? cut.value.filter((entry) => entry !== cable) : [...cut.value, cable];
}

const said = computed(() => {
    const working = up.value.length;

    if (!working) return { kind: "bad", word: "Down", text: "Every cable is cut. The two switches cannot reach each other at all." };

    const cutText = cut.value.length
        ? `${cut.value.length === 1 ? "Cable" : "Cables"} ${cut.value.join(" and ")} ${cut.value.length === 1 ? "is" : "are"} cut. `
        : "";

    if (mode.value === "separate") {
        const blocked = working - 1;
        return {
            kind: "warn",
            word: "One cable",
            text: `${cutText}${blocked ? `Spanning tree blocks ${blocked} of the working cables, because two links between the same switches make a loop. ` : ""}All six conversations share cable ${up.value[0]}, ${SPEED} Gbit/s.${cut.value.length ? " The widget opens the next cable at once; real switches take a while to notice the cut first." : ""}`,
        };
    }

    return {
        kind: "good",
        word: "Shared",
        text: `${cutText}The LAG spreads the six conversations over ${working} cable${working > 1 ? "s" : ""}, ${working * SPEED} Gbit/s in all. Each conversation stays on one cable, so its packets arrive in order, and none of them gets more than ${SPEED} Gbit/s.`,
    };
});

const y = (cable: number) => 120 + (cable - (count.value + 1) / 2) * 22;

const code = computed(() => {
    const ports = cables.value.map((cable) =>
        mode.value === "lag"
            ? `    "10g-${cable}": { description: "sw-02", lag: "uplink", link: { device: "sw-02", port: "10g-${cable}" } },`
            : `    "10g-${cable}": { description: "sw-02", trunk_vlans: ["office", "servers"], link: { device: "sw-02", port: "10g-${cable}" } },`
    );

    return [
        "ports: {",
        ...ports,
        "},",
        ...(mode.value === "lag"
            ? ["", "interfaces: {", `    uplink: { type: "lag", mode: "lacp", trunk_vlans: ["office", "servers"] },`, "},"]
            : []),
    ].join("\n");
});
</script>

<template>
    <div class="lag-links">
        <svg
            class="ac-drawing"
            viewBox="0 0 700 240"
            role="img"
            :aria-label="`Two switches joined by ${count} cables, ${mode === 'lag' ? 'bundled into one LAG' : 'as separate links'}.`"
        >
            <line class="cable" x1="60" y1="120" x2="170" y2="120" />
            <line class="cable" x1="530" y1="120" x2="640" y2="120" />

            <g v-for="cable in cables" :key="cable">
                <line class="cable" :class="stateOf(cable)" x1="200" :y1="y(cable)" x2="500" :y2="y(cable)" />
                <text class="cable-label" x="350" :y="y(cable) - 4" text-anchor="middle">{{ cable }}: {{ cableText(cable) }}</text>
            </g>

            <g v-if="mode === 'lag'">
                <rect class="bundle" x="196" :y="y(1) - 18" width="308" :height="(count - 1) * 22 + 26" />
                <text class="bundle-label" x="200" :y="y(1) - 24">LAG uplink</text>
            </g>

            <SvgDevice kind="laptop" :x="60" :y="120" label="Six laptops" />
            <SvgDevice kind="switch" :x="170" :y="120" label="sw-01" />
            <SvgDevice kind="switch" :x="530" :y="120" label="sw-02" />
            <SvgDevice kind="server" :x="640" :y="120" label="Server" />
        </svg>

        <div class="controls">
            <div class="ac-field">
                <span>Cables between the switches</span>
                <div class="ac-row" role="group" aria-label="Cables between the switches">
                    <button
                        v-for="value in COUNTS"
                        :key="value"
                        type="button"
                        class="ac-button small"
                        :aria-pressed="count === value"
                        @click="setCount(value)"
                    >
                        {{ value }}
                    </button>
                </div>
            </div>
            <div class="ac-field">
                <span>How they are set up</span>
                <div class="ac-row" role="group" aria-label="How the cables are set up">
                    <button type="button" class="ac-button small" :aria-pressed="mode === 'separate'" @click="mode = 'separate'">
                        Separate links
                    </button>
                    <button type="button" class="ac-button small" :aria-pressed="mode === 'lag'" @click="mode = 'lag'">One LAG</button>
                </div>
            </div>
            <div class="ac-field">
                <span>Cut a cable</span>
                <div class="ac-row" role="group" aria-label="Cut a cable">
                    <button
                        v-for="cable in cables"
                        :key="cable"
                        type="button"
                        class="ac-button small"
                        :aria-pressed="cut.includes(cable)"
                        @click="toggleCut(cable)"
                    >
                        Cable {{ cable }}{{ cut.includes(cable) ? ": cut" : "" }}
                    </button>
                </div>
            </div>
        </div>

        <p class="ac-say" :class="said.kind" :data-word="said.word" aria-live="polite">{{ said.text }}</p>
        <p class="note">
            The widget gives conversations to cables in turn. Real switches choose by a hash of each conversation's addresses and ports, so
            the spread is rarely this even. A cut cable does not change the file: the file says what should be, and the cut is what is.
        </p>

        <CodeView :code="code" title="sw-01.ts" />
    </div>
</template>

<style scoped>
.cable.carrying {
    stroke: var(--circuit-link);
    stroke-width: 4;
}

.cable.blocked {
    stroke-dasharray: 3 5;
}

.cable.cut {
    stroke: var(--circuit-removed);
    stroke-dasharray: 10 8;
}

.cable-label {
    fill: var(--circuit-soft) !important;
    font-size: 13px !important;
}

.bundle {
    fill: none;
    stroke: var(--circuit-ink);
    stroke-width: 1.5;
    stroke-dasharray: 2 4;
}

.bundle-label {
    font-size: 13px !important;
    font-weight: 700;
}

.controls {
    display: flex;
    flex-wrap: wrap;
    gap: 14px 24px;
    margin-top: 10px;
}

.note {
    margin: 8px 0 0;
    color: var(--circuit-soft);
    font-size: 14px;
}
</style>
