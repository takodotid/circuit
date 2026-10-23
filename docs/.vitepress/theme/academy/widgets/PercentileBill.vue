<script setup lang="ts">
// Lesson: what an ISP sells. The reader guesses where a 95th percentile bill lands, then sorts an evening of five-minute samples, throws away the busiest 5 percent, bills the highest left, and adds a burst to see when it starts to cost.

import { computed, ref, watch } from "vue";
import { Percentile95 } from "./PercentileBill";

const TOP = 700;
const CHART = { left: 52, right: 690, top: 18, bottom: 238 };
const SLOT = (CHART.right - CHART.left) / Percentile95.EVENING.length;

const burst = ref(0);
const stage = ref(0);
const guess = ref(400);
const commit = ref(200);

const samples = computed(() => Percentile95.withBurst(Percentile95.EVENING, burst.value));
const result = computed(() => Percentile95.of(samples.value));
const money = computed(() => Percentile95.bill(result.value.billed, commit.value));

// A new burst changes what is billed, so the reader works it out again from the sorted samples.
watch(burst, () => {
    if (stage.value > 1) stage.value = 1;
});

const y = (rate: number) => CHART.bottom - (rate / TOP) * (CHART.bottom - CHART.top);
const clock = (index: number) => {
    const minutes = 18 * 60 + index * 5;
    return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
};

/** Each bar's place on the line: its time, or its rank once sorted. */
const bars = computed(() =>
    samples.value.map((rate, index) => {
        const rank = result.value.order.indexOf(index);
        const slot = stage.value === 0 ? index : rank;
        const thrownAway = stage.value >= 2 && rank < result.value.discarded;
        const billed = stage.value >= 3 && index === result.value.billedIndex;
        return { index, rate, shift: CHART.left + slot * SLOT, thrownAway, billed };
    })
);

const steps = ["Sort the samples", "Throw away the busiest 5 percent", "Bill the highest one left"];

const said = computed(() => {
    const { discarded, billed, billedIndex, order } = result.value;
    const thrown = order.slice(0, discarded).map((index) => samples.value[index]);

    if (stage.value === 0)
        return {
            kind: "",
            text: `One evening on a transit port, a sample every five minutes from 18:00: ${samples.value.length} samples. Drag your guess to where you think the bill lands, then sort the samples.`,
        };
    if (stage.value === 1)
        return {
            kind: "",
            text: `Sorted from the busiest down. There are ${samples.value.length} samples, and 5 percent of ${samples.value.length} is ${discarded}.`,
        };
    if (stage.value === 2)
        return {
            kind: "warn",
            word: "Thrown away",
            text: `The busiest ${discarded} samples, ${thrown.join(" and ")} Mbit/s, are thrown away. Nobody pays for them.`,
        };

    const off = Math.abs(guess.value - billed);
    const verdict =
        off <= 10
            ? `Your guess of ${guess.value} was right on it.`
            : `Your guess was ${guess.value}, ${off} Mbit/s ${guess.value > billed ? "too high" : "too low"}.`;

    return {
        kind: "good",
        word: "Billed",
        text: `The highest sample left is ${billed} Mbit/s, at ${clock(billedIndex)}. That is the 95th percentile, the rate this evening is billed at. ${verdict}`,
    };
});

const billText = computed(() => {
    const { billed } = result.value;
    const { burst: over, unused } = money.value;

    if (over > 0)
        return `You committed to ${commit.value} Mbit/s, and pay for it whatever you use. The 95th percentile is ${billed} Mbit/s, so ${over} Mbit/s above the commit is billed as burst, at the burst rate in the contract.`;
    if (unused > 0)
        return `The 95th percentile, ${billed} Mbit/s, is under your commit of ${commit.value} Mbit/s. You pay for the whole commit: ${unused} Mbit/s of it went unused.`;
    return `The 95th percentile is exactly your commit of ${commit.value} Mbit/s. You pay for the commit and no burst.`;
});
</script>

<template>
    <div class="percentile-bill">
        <svg
            class="ac-drawing"
            viewBox="0 0 700 290"
            role="img"
            :aria-label="`${samples.length} five-minute traffic samples, ${stage === 0 ? 'in time order' : 'sorted from the busiest down'}.${stage >= 3 ? ' The billed sample is ' + result.billed + ' Mbit/s.' : ''}`"
        >
            <g class="axis">
                <g v-for="rate in [0, 200, 400, 600]" :key="rate">
                    <line :x1="CHART.left" :x2="CHART.right" :y1="y(rate)" :y2="y(rate)" />
                    <text :x="CHART.left - 8" :y="y(rate) + 4" text-anchor="end">{{ rate }}</text>
                </g>
                <text class="unit" :x="CHART.left - 8" :y="CHART.top - 4" text-anchor="end">Mbit/s</text>
            </g>

            <g
                v-for="bar in bars"
                :key="bar.index"
                class="bar"
                :class="{ gone: bar.thrownAway, billed: bar.billed }"
                :style="{ transform: `translate(${bar.shift}px, 0px)` }"
            >
                <rect :x="1.5" :y="y(bar.rate)" :width="SLOT - 3" :height="CHART.bottom - y(bar.rate)" />
            </g>

            <g v-if="stage === 0" class="times">
                <text v-for="index in [0, 12, 24, 36]" :key="index" :x="CHART.left + index * SLOT" :y="CHART.bottom + 18">
                    {{ clock(index) }}
                </text>
            </g>
            <g v-else class="times">
                <text :x="CHART.left" :y="CHART.bottom + 18">busiest</text>
                <text :x="CHART.right" :y="CHART.bottom + 18" text-anchor="end">quietest</text>
            </g>

            <g v-if="stage >= 2" class="cut">
                <line
                    :x1="CHART.left + result.discarded * SLOT"
                    :x2="CHART.left + result.discarded * SLOT"
                    :y1="CHART.top"
                    :y2="CHART.bottom + 4"
                />
                <text :x="CHART.left + result.discarded * SLOT + 6" :y="CHART.top + 12">top 5 percent left of this line</text>
            </g>

            <g class="guess">
                <line :x1="CHART.left" :x2="CHART.right" :y1="y(guess)" :y2="y(guess)" />
                <text :x="CHART.right" :y="y(guess) - 6" text-anchor="end">your guess {{ guess }}</text>
            </g>

            <g v-if="stage >= 3" class="billed-line">
                <line :x1="CHART.left" :x2="CHART.right" :y1="y(result.billed)" :y2="y(result.billed)" />
                <text :x="CHART.left + 6" :y="y(result.billed) - 6">billed {{ result.billed }}</text>
            </g>

            <g class="legend" :transform="`translate(${CHART.left} 276)`">
                <rect class="key" width="12" height="12" y="-10" />
                <text x="18">a sample</text>
                <rect class="key gone" x="100" width="12" height="12" y="-10" />
                <text x="118">thrown away</text>
                <rect class="key billed" x="226" width="12" height="12" y="-10" />
                <text x="244">billed</text>
            </g>
        </svg>

        <div class="controls">
            <label class="ac-field">
                <span>Your guess: {{ guess }} Mbit/s</span>
                <input v-model.number="guess" class="range" type="range" min="0" :max="TOP" step="5" />
            </label>

            <div class="ac-row">
                <button
                    v-for="(label, index) in steps"
                    :key="label"
                    type="button"
                    class="ac-button"
                    :class="{ primary: stage === index }"
                    :disabled="stage !== index"
                    @click="stage = index + 1"
                >
                    {{ index + 1 }}. {{ label }}
                </button>
                <button type="button" class="ac-button small" :disabled="stage === 0" @click="stage = 0">Back to time order</button>
            </div>

            <label class="ac-field">
                <span
                    >A burst at {{ Percentile95.BURST_RATE }} Mbit/s from {{ clock(Percentile95.BURST_START) }}, lasting
                    {{ burst }} five-minute samples</span
                >
                <input v-model.number="burst" class="range" type="range" min="0" max="4" step="1" />
            </label>
        </div>

        <p class="ac-say" :class="said.kind" :data-word="said.word" aria-live="polite">{{ said.text }}</p>

        <div class="bill">
            <label class="ac-field">
                <span>Your commit</span>
                <select v-model.number="commit" class="ac-select">
                    <option v-for="rate in [100, 200, 300, 400]" :key="rate" :value="rate">{{ rate }} Mbit/s</option>
                </select>
            </label>
            <p v-if="stage >= 3" class="bill-text" aria-live="polite">{{ billText }}</p>
            <p v-else class="bill-text hint" aria-live="polite">Work out the 95th percentile first, and the bill appears here.</p>
        </div>
    </div>
</template>

<style scoped>
.axis line {
    stroke: var(--circuit-line);
    stroke-width: 1;
}

.ac-drawing .axis text,
.ac-drawing .times text,
.ac-drawing .legend text {
    fill: var(--circuit-soft);
    font-size: 12px;
}

.bar {
    transition: transform 0.6s cubic-bezier(0.16, 1, 0.3, 1);
}

.bar rect,
.key {
    fill: var(--circuit-link);
    stroke: none;
    transition:
        fill 0.25s,
        y 0.25s,
        height 0.25s;
}

.bar.gone rect,
.key.gone {
    fill: none;
    stroke: var(--circuit-removed);
    stroke-width: 1.5;
    stroke-dasharray: 3 2;
}

.bar.billed rect,
.key.billed {
    fill: var(--circuit-yellow);
    stroke: #0a1a36;
    stroke-width: 1.5;
}

.cut line {
    stroke: var(--circuit-removed);
    stroke-width: 1.5;
    stroke-dasharray: 4 4;
}

.ac-drawing .cut text {
    fill: var(--circuit-removed);
    font-size: 12px;
}

.guess line {
    stroke: var(--circuit-ink);
    stroke-width: 1.5;
    stroke-dasharray: 8 5;
}

.ac-drawing .guess text {
    font-size: 12px;
    font-weight: 700;
}

.billed-line line {
    stroke: var(--circuit-ink);
    stroke-width: 2.5;
}

.ac-drawing .billed-line text {
    font-size: 13px;
    font-weight: 700;
}

.controls {
    display: grid;
    gap: 14px;
    margin-top: 12px;
}

.range {
    width: min(360px, 100%);
    min-height: 40px;
    accent-color: var(--circuit-cobalt);
}

.ac-button {
    white-space: normal;
    text-align: left;
}

.bill {
    margin-top: 16px;
    padding-top: 14px;
    border-top: 1px solid var(--circuit-line);
}

.bill-text {
    margin: 10px 0 0;
    font-size: 15.5px;
    line-height: 1.55;
}

.hint {
    color: var(--circuit-soft);
}

@media (prefers-reduced-motion: reduce) {
    .bar,
    .bar rect {
        transition: none;
    }
}
</style>
