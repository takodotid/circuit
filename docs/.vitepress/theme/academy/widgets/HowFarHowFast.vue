<script setup lang="ts">
// Lesson: cables, light and radio. The reader picks a distance and a speed, and sees which kinds of link reach that far at that speed, which do not, and why.

import { computed, ref } from "vue";

type Speed = 1 | 10 | 100;

const distances = [
    { metres: 3, name: "At a desk", spelled: "3 m" },
    { metres: 60, name: "Across a floor", spelled: "60 m" },
    { metres: 2_000, name: "Between two buildings", spelled: "2 km" },
    { metres: 25_000, name: "Across a city", spelled: "25 km" },
];

const speeds: Speed[] = [1, 10, 100];

const NO_COPPER_100 = "No LAN cable carries 100 Gbit/s. At this speed it is fibre, or a DAC inside a rack.";
const WIFI_RANGE = 20;
const SHORT_FOR_40_KM = 2_000;

type Way = {
    id: string;
    name: string;
    /** Carries light, not electricity. */
    light?: boolean;
    /** How far it reaches at each speed, in metres, or why it does not run at that speed. */
    reach: Record<Speed, number | string>;
};

const ways: Way[] = [
    {
        id: "cat5e",
        name: "Cat5e LAN cable",
        reach: {
            1: 100,
            10: "The standard does not promise 10 Gbit/s on Cat5e. Use Cat6 for a short run, or Cat6a for the full 100 m.",
            100: NO_COPPER_100,
        },
    },
    { id: "cat6", name: "Cat6 LAN cable", reach: { 1: 100, 10: 55, 100: NO_COPPER_100 } },
    { id: "cat6a", name: "Cat6a LAN cable", reach: { 1: 100, 10: 100, 100: NO_COPPER_100 } },
    {
        id: "dac",
        name: "DAC",
        reach: { 1: "At 1 Gbit/s, the ports are usually RJ45, so a LAN cable does this job.", 10: 7, 100: 5 },
    },
    { id: "multimode", name: "Multimode fibre", light: true, reach: { 1: 550, 10: 400, 100: 100 } },
    { id: "single-10", name: "Single-mode, 10 km optics", light: true, reach: { 1: 10_000, 10: 10_000, 100: 10_000 } },
    { id: "single-40", name: "Single-mode, 40 km optics", light: true, reach: { 1: 40_000, 10: 40_000, 100: 40_000 } },
    {
        id: "wifi",
        name: "Wi-Fi",
        reach: {
            1: WIFI_RANGE,
            10: "The highest Wi-Fi speeds are the best case, added up over all its antennas and shared by every device. A link that must carry this much all the time is a cable or a fibre.",
            100: "No Wi-Fi comes close to 100 Gbit/s. This is a job for fibre.",
        },
    },
];

const distance = ref(distances[0]!);
const speed = ref<Speed>(1);

const spell = (metres: number) => (metres >= 1000 ? `${metres / 1000} km` : `${metres} m`);

type Verdict = { way: Way; reach?: number; status: "works" | "short" | "speed" | "careful"; text: string };

const verdicts = computed<Verdict[]>(() =>
    ways.map((way) => {
        const reach = way.reach[speed.value];
        const wanted = distance.value.metres;

        if (typeof reach === "string") return { way, status: "speed", text: reach };

        if (way.id === "wifi") {
            if (wanted > reach)
                return {
                    way,
                    reach,
                    status: "short",
                    text: `One access point reaches about ${reach} m indoors, and less through walls. To cover more, put several on the ceiling, each with its own cable.`,
                };
            return {
                way,
                reach,
                status: "careful",
                text: "Newer Wi-Fi is rated above 1 Gbit/s, but that is the best case, and every device on the access point shares it, taking turns. Expect less, and less again through a wall.",
            };
        }

        if (wanted > reach) {
            const why = way.light
                ? "Past that, the light is too weak or too blurred to read."
                : "Past that, the signal is too weak and too noisy to read.";
            return {
                way,
                reach,
                status: "short",
                text: `Reaches ${spell(reach)} at ${speed.value} Gbit/s, and this is ${distance.value.spelled}. ${why}`,
            };
        }

        // A long-reach optic's light can be too strong for the far end over a short run.
        if (way.id === "single-40" && wanted <= SHORT_FOR_40_KM)
            return {
                way,
                reach,
                status: "careful",
                text: "It reaches, but an optic made for 40 km sends light so strong that over a short run it can overload the far end. It may need a small part called an attenuator to dim it. A 10 km optic is the simpler choice here.",
            };

        return {
            way,
            reach,
            status: "works",
            text: `Reaches ${spell(reach)} at ${speed.value} Gbit/s, enough for ${distance.value.spelled}.`,
        };
    })
);

const working = computed(() => verdicts.value.filter((entry) => entry.status === "works"));

const summary = computed(() => {
    const names = working.value.map((entry) => entry.way.name);
    const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0];
    return `${distance.value.name}, ${distance.value.spelled}, at ${speed.value} Gbit/s: ${names.length} of ${ways.length} work. ${list}.`;
});

const words: Record<Verdict["status"], string> = {
    works: "Works",
    short: "Too short",
    speed: "Not at this speed",
    careful: "Careful",
};

// The chart: a log scale from 1 m to 100 km, so a desk and a city fit on one line.
const LEFT = 200;
const PER_TEN = 96;
const TOP = 34;
const ROW = 30;

const across = (metres: number) => LEFT + Math.log10(metres) * PER_TEN;
const rowY = (index: number) => TOP + index * ROW;
const ticks = [1, 10, 100, 1_000, 10_000, 100_000];
const bottom = TOP + ways.length * ROW;
</script>

<template>
    <div class="how-far-how-fast">
        <div class="ac-field">
            <span>1. How far</span>
            <div class="ac-row" role="group" aria-label="How far">
                <button
                    v-for="entry in distances"
                    :key="entry.metres"
                    type="button"
                    class="ac-button small"
                    :aria-pressed="distance.metres === entry.metres"
                    @click="distance = entry"
                >
                    {{ entry.name }}, {{ entry.spelled }}
                </button>
            </div>
        </div>

        <div class="ac-field">
            <span>2. How fast</span>
            <div class="ac-row" role="group" aria-label="How fast">
                <button
                    v-for="entry in speeds"
                    :key="entry"
                    type="button"
                    class="ac-button small"
                    :aria-pressed="speed === entry"
                    @click="speed = entry"
                >
                    {{ entry }} Gbit/s
                </button>
            </div>
        </div>

        <svg
            class="ac-drawing"
            :viewBox="`0 0 700 ${bottom + 34}`"
            role="img"
            :aria-label="`How far each kind of link reaches at ${speed} Gbit/s, with a line at ${distance.spelled}. The list under the drawing says the same in words.`"
        >
            <line v-for="tick in ticks" :key="tick" class="grid" :x1="across(tick)" :y1="TOP - 14" :x2="across(tick)" :y2="bottom" />
            <text v-for="tick in ticks" :key="`t${tick}`" class="tick" :x="across(tick)" :y="bottom + 20" text-anchor="middle">
                {{ spell(tick) }}
            </text>

            <g v-for="(entry, index) in verdicts" :key="entry.way.id">
                <text class="way" x="8" :y="rowY(index) + 4">{{ entry.way.name }}</text>
                <rect
                    v-if="entry.reach"
                    :class="['bar', entry.status]"
                    :x="LEFT"
                    :y="rowY(index) - 8"
                    :width="across(entry.reach) - LEFT"
                    height="16"
                />
                <text v-else class="none" :x="LEFT + 6" :y="rowY(index) + 4">not at this speed</text>
            </g>

            <line class="distance" :x1="across(distance.metres)" :y1="TOP - 22" :x2="across(distance.metres)" :y2="bottom" />
            <text class="distance-name" :x="across(distance.metres)" :y="TOP - 26" text-anchor="middle">{{ distance.spelled }}</text>
        </svg>

        <p class="ac-say good" data-word="Works" aria-live="polite">{{ summary }}</p>

        <ul class="verdicts">
            <li v-for="entry in verdicts" :key="entry.way.id">
                <span :class="['chip', entry.status]">{{ words[entry.status] }}</span>
                <strong>{{ entry.way.name }}.</strong> {{ entry.text }}
            </li>
        </ul>

        <p class="footnote">
            Multimode reaches are for good, newer multimode fibre; older fibre reaches less. The 40 km optics at 1 Gbit/s are made by many
            makers, but are not part of the Ethernet standard itself.
        </p>
    </div>
</template>

<style scoped>
.ac-field + .ac-field {
    margin-top: 12px;
}

.ac-drawing {
    margin-top: 16px;
}

.grid {
    stroke: var(--circuit-line);
    stroke-width: 1;
}

.ac-drawing .tick {
    fill: var(--circuit-soft);
    font-size: 13px;
}

.ac-drawing .way {
    font-size: 13px;
    font-weight: 700;
}

.ac-drawing .none {
    fill: var(--circuit-soft);
    font-size: 13px;
    font-style: italic;
}

.bar {
    stroke-width: 1.5;
    transition: width 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}

.bar.works {
    fill: var(--circuit-cobalt);
    stroke: #0a1a36;
}

.bar.short {
    fill: var(--circuit-paper);
    stroke: var(--circuit-removed);
    stroke-dasharray: 4 3;
}

.bar.careful {
    fill: var(--circuit-paper);
    stroke: var(--circuit-warning);
    stroke-width: 2;
    stroke-dasharray: 4 3;
}

.dark .bar.works {
    stroke: var(--circuit-link);
}

.distance {
    stroke: var(--circuit-yellow);
    stroke-width: 4;
}

.ac-drawing .distance-name {
    font-size: 14px;
    font-weight: 700;
}

.verdicts {
    margin: 10px 0 0 !important;
    padding: 0 !important;
    list-style: none;
}

.verdicts li {
    margin: 6px 0 0 !important;
    font-size: 15px;
    line-height: 1.55;
}

.chip {
    display: inline-block;
    margin-right: 6px;
    padding: 0 6px;
    color: #ffffff;
    font-size: 11px;
    font-weight: 700;
    font-stretch: 115%;
    letter-spacing: 0.08em;
    line-height: 20px;
    text-transform: uppercase;
    vertical-align: 1px;
}

.chip.works {
    background: var(--circuit-added);
}

.chip.short {
    background: var(--circuit-removed);
}

.chip.careful {
    background: var(--circuit-warning);
}

.chip.speed {
    background: var(--circuit-soft);
}

.dark .chip.works,
.dark .chip.short,
.dark .chip.careful,
.dark .chip.speed {
    color: #0b1122;
}

.footnote {
    margin: 12px 0 0;
    color: var(--circuit-soft);
    font-size: 13.5px;
}

@media (prefers-reduced-motion: reduce) {
    .bar {
        transition: none;
    }
}
</style>
