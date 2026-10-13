<script setup lang="ts">
// Lesson: watching the network. The reader looks for the incident in a day of traffic on the transit port, reads the flow records at that moment to see who sent it, then sets an alert rule and counts the pages it would send.

import { computed, ref } from "vue";

const SAMPLES = 288;
const MINUTES_PER_SAMPLE = 5;
const PORT_GBIT = 25;

/** Inbound Gbit/s at the start of each hour, for an ordinary day. */
const HOURLY = [6.0, 4.8, 3.6, 2.8, 2.3, 2.2, 2.6, 3.4, 4.2, 4.8, 5.2, 5.5, 5.8, 5.7, 5.6, 5.7, 6.0, 6.5, 7.2, 8.0, 8.6, 8.9, 8.4, 7.2];

/** The flood, in Gbit/s on top of the day's traffic, from 14:20 to 14:45. */
const FLOOD_START = (14 * 60 + 20) / MINUTES_PER_SAMPLE;
const FLOOD = [11, 16.5, 16.8, 16.6, 16.2, 9];

function ordinary(sample: number) {
    const hour = (sample * MINUTES_PER_SAMPLE) / 60;
    const before = HOURLY[Math.floor(hour) % 24]!;
    const after = HOURLY[(Math.floor(hour) + 1) % 24]!;
    const smooth = before + (after - before) * (hour - Math.floor(hour));

    // A fixed wobble, the same every time, so the line looks measured without being random.
    const wobble = 0.22 * Math.sin(sample * 1.7) + 0.12 * Math.sin(sample * 0.31 + 1);
    return smooth + wobble;
}

const flood = (sample: number) => FLOOD[sample - FLOOD_START] ?? 0;
const traffic = Array.from({ length: SAMPLES }, (_, sample) => ordinary(sample) + flood(sample));

const timeOf = (sample: number) => {
    const minutes = sample * MINUTES_PER_SAMPLE;
    return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
};

/* The drawing. */
const LEFT = 46;
const RIGHT = 680;
const TOP = 16;
const BOTTOM = 236;
const xOf = (sample: number) => LEFT + (sample / (SAMPLES - 1)) * (RIGHT - LEFT);
const yOf = (gbit: number) => BOTTOM - (gbit / PORT_GBIT) * (BOTTOM - TOP);
const line = traffic.map((gbit, sample) => `${xOf(sample).toFixed(1)},${yOf(gbit).toFixed(1)}`).join(" ");
const gridLines = [0, 5, 10, 15, 20, 25];
const hourTicks = [0, 3, 6, 9, 12, 15, 18, 21];

/* 1. Finding the incident. */
const cursor = ref(120);
const current = computed(() => traffic[cursor.value] ?? 0);
const verdict = ref<{ kind: "good" | "bad" | "warn"; word: string; text: string }>();

const isFlood = (sample: number) => flood(sample) > 0;
const isEvening = (sample: number) => sample >= 18 * 12 && sample < 23 * 12;

function mark() {
    if (isFlood(cursor.value)) {
        verdict.value = {
            kind: "good",
            word: "Found",
            text: `${timeOf(cursor.value)}, ${current.value.toFixed(1)} Gbit/s. From 14:20 to 14:45 inbound traffic leapt from about 6 Gbit/s to over 20, and fell back as fast. Now read the flow records below to see who sent it.`,
        };
        return;
    }

    verdict.value = isEvening(cursor.value)
        ? {
              kind: "warn",
              word: "Every day",
              text: "This is the evening peak, the busiest hours of an ordinary day. It rises slowly and comes back every day. Look for something that does not.",
          }
        : {
              kind: "bad",
              word: "Not here",
              text: `Nothing unusual at ${timeOf(cursor.value)}. Move along the day and look for a sudden change.`,
          };
}

function move(sample: number) {
    cursor.value = sample;
    verdict.value = undefined;
}

/* 2. The flow records at the cursor, as the collector estimates them from one packet in 1,000. */
const flows = computed(() => {
    const sample = cursor.value;
    const normal = ordinary(sample);
    const rows = [
        { to: "198.51.100.10", who: "acme server 1", protocol: "TCP", from: "many", gbit: normal * 0.42 },
        { to: "198.51.100.11", who: "acme server 2", protocol: "TCP", from: "many", gbit: normal * 0.27 },
        { to: "198.51.100.18", who: "globex server 1", protocol: "TCP", from: "many", gbit: normal * 0.19 },
        { to: "other addresses", who: "", protocol: "mixed", from: "many", gbit: normal * 0.12 },
    ];

    if (isFlood(sample)) {
        rows.unshift({ to: "198.51.100.10", who: "acme server 1", protocol: "UDP", from: "about 30,000 addresses", gbit: flood(sample) });
    }

    return rows;
});

/* 3. An alert rule, and the pages it would have sent today. */
const thresholds = [8, 16, 20];
const durations = [
    { samples: 1, label: "in one sample" },
    { samples: 3, label: "for 15 minutes" },
];
const threshold = ref<number>();
const duration = ref(1);

/** The samples at which the rule starts an alert. An alert ends when traffic drops below the line, and only then can a new one start. */
const pages = computed(() => {
    if (threshold.value === undefined) return [];

    const starts: number[] = [];
    let above = 0;
    let alerting = false;

    traffic.forEach((gbit, sample) => {
        above = gbit > threshold.value! ? above + 1 : 0;

        if (above === 0) alerting = false;
        if (!alerting && above >= duration.value) {
            alerting = true;
            starts.push(sample);
        }
    });

    return starts;
});

const truePages = computed(() => pages.value.filter((sample) => isFlood(sample)).length);
const falsePages = computed(() => pages.value.length - truePages.value);

const ruleVerdict = computed(() => {
    if (threshold.value === undefined) return undefined;

    const when = pages.value.map(timeOf).join(", ");
    const count = `${pages.value.length} page${pages.value.length === 1 ? "" : "s"}${when ? `, at ${when}` : ""}`;

    if (truePages.value === 0) {
        return { kind: "bad", word: "Missed", text: `${count}. The flood never woke anyone.` };
    }
    if (falsePages.value > 0) {
        return {
            kind: "warn",
            word: "Too noisy",
            text: `${count}. ${falsePages.value} of them are the ordinary evening. Pages like that every night teach people to ignore the pager.`,
        };
    }

    const first = pages.value[0]!;
    const late = (first - FLOOD_START) * MINUTES_PER_SAMPLE;
    return {
        kind: "good",
        word: "Pages once",
        text: `${count}: only the flood${late ? `, ${late} minutes after it began` : ", in its first five minutes"}.`,
    };
});
</script>

<template>
    <div class="traffic-day">
        <svg
            class="ac-drawing"
            viewBox="0 0 700 270"
            role="img"
            aria-label="Inbound traffic on the transit port over one day, in Gbit/s, sampled every five minutes, with a cursor at the chosen time."
        >
            <g v-for="gbit in gridLines" :key="gbit">
                <line class="grid" :x1="LEFT" :x2="RIGHT" :y1="yOf(gbit)" :y2="yOf(gbit)" />
                <text class="axis" :x="LEFT - 8" :y="yOf(gbit) + 4" text-anchor="end">{{ gbit }}G</text>
            </g>
            <text class="axis" :x="RIGHT" :y="yOf(PORT_GBIT) - 4" text-anchor="end">the port is full at 25G</text>
            <text v-for="hour in hourTicks" :key="hour" class="axis" :x="xOf(hour * 12)" :y="BOTTOM + 18" text-anchor="middle">
                {{ String(hour).padStart(2, "0") }}:00
            </text>

            <line v-if="threshold !== undefined" class="threshold" :x1="LEFT" :x2="RIGHT" :y1="yOf(threshold)" :y2="yOf(threshold)" />
            <text v-if="threshold !== undefined" class="axis threshold-label" :x="LEFT + 6" :y="yOf(threshold) - 5">
                alert above {{ threshold }}G
            </text>

            <polyline class="traffic" :points="line" />

            <g v-for="sample in pages" :key="sample" class="page" :class="{ wrong: !isFlood(sample) }">
                <path :d="`M${xOf(sample)} ${TOP + 2}l-6 -10h12z`" />
            </g>

            <line class="cursor" :x1="xOf(cursor)" :x2="xOf(cursor)" :y1="TOP" :y2="BOTTOM" />
            <circle class="cursor-dot" :cx="xOf(cursor)" :cy="yOf(current)" r="5" />
        </svg>

        <div class="find">
            <label class="ac-field slider">
                <span>Time of day: {{ timeOf(cursor) }}, {{ current.toFixed(1) }} Gbit/s in</span>
                <input
                    type="range"
                    min="0"
                    :max="SAMPLES - 1"
                    :value="cursor"
                    :aria-valuetext="`${timeOf(cursor)}, ${current.toFixed(1)} gigabits per second`"
                    @input="move(Number(($event.target as HTMLInputElement).value))"
                />
            </label>
            <button type="button" class="ac-button primary" @click="mark">This is the incident</button>
        </div>

        <p v-if="verdict" class="ac-say" :class="verdict.kind" :data-word="verdict.word" aria-live="polite">{{ verdict.text }}</p>
        <p v-else class="ac-say hint" aria-live="polite">
            Move the slider along the day, or use the arrow keys on it, and mark the moment something went wrong.
        </p>

        <h4 class="part">Flow records at {{ timeOf(cursor) }}</h4>
        <div class="table-frame">
            <table class="ac-table">
                <thead>
                    <tr>
                        <th>To</th>
                        <th>Protocol</th>
                        <th>From</th>
                        <th>Traffic</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="(flow, index) in flows" :key="index" :class="{ lit: flow.protocol === 'UDP' }">
                        <td>
                            <span class="ac-mono">{{ flow.to }}</span>
                            <span v-if="flow.who" class="who">{{ flow.who }}</span>
                        </td>
                        <td>{{ flow.protocol }}</td>
                        <td>{{ flow.from }}</td>
                        <td class="ac-mono">{{ flow.gbit.toFixed(1) }} Gbit/s</td>
                    </tr>
                </tbody>
            </table>
        </div>
        <p class="note">
            Estimated by the collector from one packet in 1,000, multiplied back up. SNMP says how much; these records say to whom and from
            where.
        </p>

        <h4 class="part">Alert when inbound traffic is above</h4>
        <div class="ac-row">
            <button
                v-for="option in thresholds"
                :key="option"
                type="button"
                class="ac-button small"
                :aria-pressed="threshold === option"
                @click="threshold = option"
            >
                {{ option }} Gbit/s
            </button>
            <span class="joiner">for</span>
            <button
                v-for="option in durations"
                :key="option.samples"
                type="button"
                class="ac-button small"
                :aria-pressed="duration === option.samples"
                @click="duration = option.samples"
            >
                {{ option.label }}
            </button>
        </div>
        <p v-if="ruleVerdict" class="ac-say" :class="ruleVerdict.kind" :data-word="ruleVerdict.word" aria-live="polite">
            {{ ruleVerdict.text }}
        </p>
        <p v-else class="ac-say hint" aria-live="polite">
            Pick a level. The drawing marks each page the rule would have sent today: a solid triangle for the flood, a hollow one for a
            false alarm.
        </p>
    </div>
</template>

<style scoped>
.grid {
    stroke: var(--circuit-line);
    stroke-width: 1;
}

.axis {
    fill: var(--circuit-soft) !important;
    font-size: 11.5px !important;
}

.traffic {
    fill: none;
    stroke: var(--circuit-link);
    stroke-width: 2;
    stroke-linejoin: round;
}

.threshold {
    stroke: var(--circuit-warning);
    stroke-width: 2;
    stroke-dasharray: 6 5;
}

.threshold-label {
    fill: var(--circuit-warning) !important;
}

.page path {
    fill: var(--circuit-ink);
    stroke: var(--circuit-ink);
    stroke-width: 1.5;
}

.page.wrong path {
    fill: var(--circuit-paper);
}

.cursor {
    stroke: var(--circuit-ink);
    stroke-width: 1.5;
    stroke-dasharray: 3 3;
}

.cursor-dot {
    fill: var(--circuit-yellow);
    stroke: #0a1a36;
    stroke-width: 2;
}

.find {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: 12px;
    margin-top: 8px;
}

.slider {
    flex: 1 1 260px;
}

.slider input {
    width: 100%;
    min-height: 40px;
    accent-color: var(--circuit-cobalt);
}

.part {
    margin: 22px 0 0 !important;
    font-size: 16px;
}

.table-frame {
    overflow-x: auto;
}

.who {
    display: block;
    color: var(--circuit-soft);
    font-size: 13px;
}

.joiner {
    color: var(--circuit-soft);
    font-weight: 600;
}

.hint,
.note {
    color: var(--circuit-soft);
}

.note {
    margin: 8px 0 0;
    font-size: 14px;
}
</style>
