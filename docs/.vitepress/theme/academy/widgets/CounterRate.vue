<script setup lang="ts">
// Lesson: watching the network. The reader reads two polls of a port's byte counter, works out the traffic in Mbit/s, and sees a 32-bit counter wrap between polls until the answer is wrong.

import { computed, ref } from "vue";

const WRAP_32 = 2 ** 32;
const FIRST_READING = 3_900_000_000;

const speeds = [50, 400, 900];
const intervals = [
    { seconds: 60, label: "1 minute" },
    { seconds: 300, label: "5 minutes" },
];
const widths = [
    { bits: 32, label: "32-bit, ifInOctets" },
    { bits: 64, label: "64-bit, ifHCInOctets" },
];

const speed = ref(50);
const interval = ref(300);
const width = ref(32);

const answer = ref("");
const checked = ref(false);
const working = ref(false);

function reset() {
    answer.value = "";
    checked.value = false;
    working.value = false;
}

function choose(update: () => void) {
    update();
    reset();
}

const format = (value: number) => Math.round(value).toLocaleString("en-US");
const formatMbit = (bitsPerSecond: number) => (bitsPerSecond / 1e6).toLocaleString("en-US", { maximumFractionDigits: 1 });

/** Everything that follows from the three choices: what the counter really did, and what two polls make of it. */
const run = computed(() => {
    const bytesSent = (speed.value * 1e6 * interval.value) / 8;
    const counted = FIRST_READING + bytesSent;

    // A 32-bit counter starts again from 0 after 4,294,967,295. A 64-bit one never gets there.
    const laps = width.value === 32 ? Math.floor(counted / WRAP_32) : 0;
    const secondReading = width.value === 32 ? counted - laps * WRAP_32 : counted;

    const difference = secondReading - FIRST_READING;
    const wrapped = difference < 0;
    const bytesSeen = wrapped ? difference + WRAP_32 : difference;
    const bitsSeen = bytesSeen * 8;
    const rateSeen = bitsSeen / interval.value;

    const secondsPerWrap = (WRAP_32 * 8) / (speed.value * 1e6);

    return { bytesSent, laps, secondReading, difference, wrapped, bytesSeen, bitsSeen, rateSeen, secondsPerWrap };
});

const clock = (seconds: number) => {
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;
    return `10:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
};

const wrapTime = computed(() => {
    const seconds = run.value.secondsPerWrap;
    return seconds >= 120 ? `${(seconds / 60).toFixed(1)} minutes` : `${seconds.toFixed(0)} seconds`;
});

const answerNumber = computed(() => Number(answer.value.replace(/,/g, "").trim()));
const answerValid = computed(() => answer.value.trim() !== "" && Number.isFinite(answerNumber.value) && answerNumber.value >= 0);
const answerRight = computed(
    () => answerValid.value && Math.abs(answerNumber.value - run.value.rateSeen / 1e6) <= Math.max(0.5, (run.value.rateSeen / 1e6) * 0.02)
);

function check() {
    checked.value = true;
}

const truthMatches = computed(() => run.value.laps <= 1);

/** The lap drawing: one row per time the counter went from 0 to its top, for a 32-bit counter. */
const TRACK_LEFT = 40;
const TRACK_WIDTH = 600;
const ROW_HEIGHT = 26;
const at = (value: number) => TRACK_LEFT + (value / WRAP_32) * TRACK_WIDTH;

const rows = computed(() => {
    if (width.value !== 32) return [];

    const result: { from: number; to: number }[] = [];
    let position = FIRST_READING;
    let left = run.value.bytesSent;

    while (left > 0) {
        const room = WRAP_32 - position;
        const step = Math.min(room, left);
        result.push({ from: position, to: position + step });
        left -= step;
        position = position + step >= WRAP_32 ? 0 : position + step;
    }

    return result;
});

const drawingHeight = computed(() => 60 + Math.max(1, rows.value.length) * ROW_HEIGHT);

const yearsToWrap64 = computed(() => (2 ** 64 * 8) / (speed.value * 1e6) / (365.25 * 86400));
</script>

<template>
    <div class="counter-rate">
        <div class="choices">
            <div class="ac-field">
                <span>Traffic on the port</span>
                <div class="ac-row">
                    <button
                        v-for="option in speeds"
                        :key="option"
                        type="button"
                        class="ac-button small"
                        :aria-pressed="speed === option"
                        @click="choose(() => (speed = option))"
                    >
                        {{ option }} Mbit/s
                    </button>
                </div>
            </div>
            <div class="ac-field">
                <span>Poll every</span>
                <div class="ac-row">
                    <button
                        v-for="option in intervals"
                        :key="option.seconds"
                        type="button"
                        class="ac-button small"
                        :aria-pressed="interval === option.seconds"
                        @click="choose(() => (interval = option.seconds))"
                    >
                        {{ option.label }}
                    </button>
                </div>
            </div>
            <div class="ac-field">
                <span>Counter</span>
                <div class="ac-row">
                    <button
                        v-for="option in widths"
                        :key="option.bits"
                        type="button"
                        class="ac-button small"
                        :aria-pressed="width === option.bits"
                        @click="choose(() => (width = option.bits))"
                    >
                        {{ option.label }}
                    </button>
                </div>
            </div>
        </div>

        <table class="ac-table readings">
            <thead>
                <tr>
                    <th>Poll</th>
                    <th>Time</th>
                    <th>{{ width === 32 ? "ifInOctets" : "ifHCInOctets" }}</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td>First</td>
                    <td class="ac-mono">{{ clock(0) }}</td>
                    <td class="ac-mono">{{ format(FIRST_READING) }}</td>
                </tr>
                <tr>
                    <td>Second</td>
                    <td class="ac-mono">{{ clock(interval) }}</td>
                    <td class="ac-mono">{{ format(run.secondReading) }}</td>
                </tr>
            </tbody>
        </table>

        <div class="work">
            <label class="ac-field">
                <span>The traffic between the two polls, in Mbit/s</span>
                <input
                    v-model="answer"
                    class="ac-input mono"
                    inputmode="decimal"
                    :aria-invalid="checked && !answerValid"
                    @input="checked = false"
                    @keydown.enter="check"
                />
            </label>
            <button type="button" class="ac-button primary" @click="check">Check</button>
            <button type="button" class="ac-button" :aria-pressed="working" @click="working = !working">Show the working</button>
        </div>

        <ol v-if="working" class="steps">
            <li>
                Subtract the first reading from the second: {{ format(run.secondReading) }} − {{ format(FIRST_READING) }} =
                <strong class="ac-mono">{{ format(run.difference) }}</strong> bytes.
                <template v-if="run.wrapped">
                    Below zero, so the counter passed 4,294,967,295 and started again from 0. Add 2<sup>32</sup>, 4,294,967,296:
                    <strong class="ac-mono">{{ format(run.bytesSeen) }}</strong> bytes.
                </template>
            </li>
            <li>
                Bytes to bits, times 8: <strong class="ac-mono">{{ format(run.bitsSeen) }}</strong> bits.
            </li>
            <li>
                Per second, divided by {{ interval }}: <strong class="ac-mono">{{ format(run.rateSeen) }}</strong> bit/s, which is
                <strong>{{ formatMbit(run.rateSeen) }} Mbit/s</strong>.
            </li>
        </ol>

        <svg
            v-if="width === 32 && (checked || working)"
            class="ac-drawing laps"
            :viewBox="`0 0 680 ${drawingHeight}`"
            role="img"
            :aria-label="`The counter between the two polls: it went round ${run.laps} time(s) from 0 to its top.`"
        >
            <text :x="TRACK_LEFT" y="18" class="axis">0</text>
            <text :x="TRACK_LEFT + TRACK_WIDTH" y="18" class="axis" text-anchor="end">4,294,967,295</text>
            <g v-for="(row, index) in rows" :key="index" :transform="`translate(0 ${34 + index * ROW_HEIGHT})`">
                <line class="track" :x1="TRACK_LEFT" :x2="TRACK_LEFT + TRACK_WIDTH" y1="0" y2="0" />
                <line class="run" :x1="at(row.from)" :x2="at(row.to)" y1="0" y2="0" />
                <text x="0" y="5" class="axis">{{ index === 0 ? "start" : `lap ${index + 1}` }}</text>
            </g>
            <circle class="reading" :cx="at(FIRST_READING)" cy="34" r="6" />
            <circle class="reading second" :cx="at(run.secondReading)" :cy="34 + (rows.length - 1) * ROW_HEIGHT" r="6" />
            <text :x="TRACK_LEFT" :y="drawingHeight - 6" class="axis">
                Yellow: the first reading. Hollow: the second. The polls only see the two dots.
            </text>
        </svg>

        <p v-if="checked && !answerValid" class="ac-say bad" data-word="Not a number" aria-live="polite">
            Type the traffic as a number of Mbit/s, such as 50 or 12.5.
        </p>
        <p
            v-else-if="checked && !answerRight && !truthMatches && answerNumber === speed"
            class="ac-say warn"
            data-word="Not from these"
            aria-live="polite"
        >
            {{ speed }} Mbit/s is what the port carried, but you know that only because you chose it. Two readings alone make
            {{ formatMbit(run.rateSeen) }} Mbit/s, and that is what a graph would show. Open the working to see why.
        </p>
        <p v-else-if="checked && !answerRight" class="ac-say bad" data-word="Not quite" aria-live="polite">
            Two polls make {{ formatMbit(run.rateSeen) }} Mbit/s, not {{ answer }}. Subtract, times 8 for bits, then divide by the
            {{ interval }} seconds between the polls. Open the working to see each step.
        </p>
        <p
            v-else-if="(checked || working) && truthMatches"
            class="ac-say good"
            :data-word="checked ? 'Right' : 'Worked out'"
            aria-live="polite"
        >
            {{ formatMbit(run.rateSeen) }} Mbit/s is what a graphing tool would draw, and it is the traffic that really passed.
            <template v-if="run.wrapped">The counter wrapped once, and adding 2<sup>32</sup> put it right.</template>
        </p>
        <p v-else-if="checked || working" class="ac-say warn" data-word="Wrong graph" aria-live="polite">
            {{ checked ? "Your arithmetic is" : "This arithmetic is" }} what a graphing tool does, but the port really carried
            {{ speed }} Mbit/s. At this speed a 32-bit counter wraps every {{ wrapTime }}, so it went round {{ run.laps }} times between
            polls, and two readings cannot tell how many times. The graph would show {{ formatMbit(run.rateSeen) }} Mbit/s. Try the 64-bit
            counter.
        </p>
        <p v-else class="ac-say hint" aria-live="polite">
            Work out the traffic from the two readings and type it in Mbit/s. Then try a faster port, a longer poll and the other counter.
        </p>

        <p v-if="width === 64 && (checked || working)" class="note">
            At {{ speed }} Mbit/s, a 64-bit counter would take about {{ Math.round(yearsToWrap64).toLocaleString("en-US") }} years to wrap.
        </p>
    </div>
</template>

<style scoped>
.choices {
    display: grid;
    gap: 12px;
}

.readings {
    max-width: 460px;
}

.work {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: 10px;
    margin-top: 14px;
}

.work .ac-field {
    flex: 1 1 220px;
}

.steps {
    margin: 14px 0 0;
    padding-left: 22px;
    line-height: 1.6;
}

.steps li + li {
    margin-top: 6px;
}

.laps {
    margin-top: 14px;
}

.laps .axis {
    fill: var(--circuit-soft);
    font-size: 12px;
}

.laps .track {
    stroke: var(--circuit-line);
    stroke-width: 10;
}

.laps .run {
    stroke: var(--circuit-link);
    stroke-width: 10;
}

.laps .reading {
    fill: var(--circuit-yellow);
    stroke: #0a1a36;
    stroke-width: 2;
}

.laps .reading.second {
    fill: var(--circuit-paper);
    stroke: var(--circuit-ink);
}

.hint,
.note {
    color: var(--circuit-soft);
}

.note {
    margin: 8px 0 0;
    font-size: 14.5px;
}
</style>
