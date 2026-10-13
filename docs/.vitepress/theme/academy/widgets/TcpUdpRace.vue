<script setup lang="ts">
// Lesson: ports and protocols. The reader races one message over TCP and over UDP across a link that loses packets, and sees TCP shake hands, resend and keep order while UDP is faster but keeps holes and disorder.

import { computed, onBeforeUnmount, ref } from "vue";
import { prefersStill } from "./SwitchLearning";
import { runRace, WORD, type Flight, type Race } from "./TcpUdpRace";

/** Real milliseconds shown for each millisecond of the race, so it can be watched. */
const SLOW_DOWN = 10;

const losses = [
    { rate: 0, label: "No loss" },
    { rate: 0.1, label: "Some loss: 1 in 10" },
    { rate: 0.3, label: "Heavy loss: 3 in 10" },
];

const lossRate = ref(0.1);
const pattern = ref(1);
const race = ref<Race>();
const now = ref(0);
const running = ref(false);
let frame = 0;

onBeforeUnmount(() => cancelAnimationFrame(frame));

function setLoss(rate: number) {
    lossRate.value = rate;
    stop();
}

function newPattern() {
    pattern.value += 1;
    stop();
}

function stop() {
    cancelAnimationFrame(frame);
    running.value = false;
    race.value = undefined;
    now.value = 0;
}

function start() {
    cancelAnimationFrame(frame);
    race.value = runRace(pattern.value, lossRate.value);
    now.value = 0;

    if (prefersStill()) {
        now.value = race.value.end;
        return;
    }

    running.value = true;
    const began = performance.now();
    const end = race.value.end;

    const tick = (time: number) => {
        now.value = Math.min(end, (time - began) / SLOW_DOWN);
        if (now.value < end) {
            frame = requestAnimationFrame(tick);
            return;
        }
        running.value = false;
    };

    frame = requestAnimationFrame(tick);
}

// Where things are drawn.
const LEFT = 76;
const RIGHT = 404;
const lines = { tcp: { out: 54, back: 80 }, udp: { out: 186, back: 186 } };

/** How far along its way a flight is, from 0 at the laptop to 1 at the server. */
function progress(flight: Flight) {
    const whole = flight.lost ? (flight.end - flight.start) * 2 : flight.end - flight.start;
    const share = Math.min(1, Math.max(0, (now.value - flight.start) / whole));
    return flight.back ? 1 - share : share;
}

const xOf = (flight: Flight) => LEFT + (RIGHT - LEFT) * progress(flight);
const yOf = (flight: Flight) => (flight.back ? lines[flight.lane].back : lines[flight.lane].out);

const moving = computed(() => race.value?.flights.filter((flight) => flight.start <= now.value && now.value < flight.end) ?? []);
const losing = computed(
    () => race.value?.flights.filter((flight) => flight.lost && flight.end <= now.value && now.value < flight.end + 45) ?? []
);

const letters = [...WORD];

/** Each TCP slot on the server: empty, arrived but waiting for an earlier piece, or handed to the program. */
const tcpSlots = computed(() =>
    letters.map((letter, index) => {
        if (!race.value) return { letter, state: "empty" };
        if (race.value.tcpGiven[index]! <= now.value) return { letter, state: "given" };
        if (race.value.tcpArrived[index]! <= now.value) return { letter, state: "waiting" };
        return { letter, state: "empty" };
    })
);

const udpReceived = computed(
    () => race.value?.udpArrivals.filter((arrival) => arrival.at <= now.value).map((arrival) => letters[arrival.index]!) ?? []
);

const tcpFinished = computed(() => !!race.value && now.value >= race.value.tcpDone);
const udpFinished = computed(() => !!race.value && now.value >= race.value.udpDone);
const done = computed(() => !!race.value && now.value >= race.value.end);

const summary = computed(() => {
    const result = race.value;
    if (!result || !done.value) return "";

    const ms = (value: number) => `${Math.round(value)} ms`;
    const delivered = result.udpArrivals.length;
    const mixed = result.udpArrivals.some((arrival, index, all) => index > 0 && all[index - 1]!.index > arrival.index);
    const lost = letters.length - delivered;

    const tcp = `TCP: all ${letters.length} letters, in order, at ${ms(result.tcpDone)}${result.tcpResent ? `, after sending ${result.tcpResent} piece${result.tcpResent > 1 ? "s" : ""} again` : ""}.`;
    const udpParts = [lost ? `${lost} never arrived` : "", mixed ? "some came in the wrong order" : ""].filter(Boolean);
    const udp = `UDP: ${delivered} of ${letters.length} at ${ms(result.udpDone)}${udpParts.length ? `; ${udpParts.join(", and ")}` : ", all in order this time"}.`;

    return `${tcp} ${udp}`;
});
</script>

<template>
    <div class="race">
        <div class="ac-field">
            <span>How lossy is the link?</span>
            <div class="ac-row" role="group" aria-label="How many packets the link loses">
                <button
                    v-for="loss in losses"
                    :key="loss.rate"
                    type="button"
                    class="ac-button small"
                    :aria-pressed="lossRate === loss.rate"
                    :disabled="running"
                    @click="setLoss(loss.rate)"
                >
                    {{ loss.label }}
                </button>
            </div>
        </div>

        <div class="ac-row controls">
            <button type="button" class="ac-button primary" :disabled="running" @click="start">
                {{ race ? "Run this race again" : "Start the race" }}
            </button>
            <button type="button" class="ac-button small" :disabled="running" @click="newPattern">New loss pattern</button>
            <span class="pattern">Loss pattern {{ pattern }}</span>
        </div>

        <svg
            class="ac-drawing"
            viewBox="0 0 480 230"
            role="img"
            aria-label="Two lanes, each from a laptop on the left to a server on the right: the top one sends over TCP, the bottom one over UDP."
        >
            <text class="lane" x="0" y="16">
                TCP
                <tspan class="lane-note">checks every piece</tspan>
            </text>
            <text class="lane" x="0" y="148">
                UDP
                <tspan class="lane-note">just sends</tspan>
            </text>

            <line class="cable" :x1="LEFT" :y1="lines.tcp.out" :x2="RIGHT" :y2="lines.tcp.out" />
            <line class="cable thin" :x1="LEFT" :y1="lines.tcp.back" :x2="RIGHT" :y2="lines.tcp.back" />
            <line class="cable" :x1="LEFT" :y1="lines.udp.out" :x2="RIGHT" :y2="lines.udp.out" />

            <SvgDevice kind="laptop" :x="36" :y="67" />
            <SvgDevice kind="server" :x="446" :y="67" :lit="tcpFinished" />
            <SvgDevice kind="laptop" :x="36" :y="186" />
            <SvgDevice kind="server" :x="446" :y="186" :lit="udpFinished" />

            <template v-for="(flight, index) in moving" :key="`f${index}-${flight.start}`">
                <g v-if="flight.kind === 'piece'" class="piece" :transform="`translate(${xOf(flight)} ${yOf(flight)})`">
                    <rect x="-11" y="-11" width="22" height="22" />
                    <text y="5" text-anchor="middle">{{ flight.text }}</text>
                </g>
                <g v-else-if="flight.kind === 'hello'" class="hello" :transform="`translate(${xOf(flight)} ${yOf(flight)})`">
                    <rect x="-24" y="-10" width="48" height="20" />
                    <text y="4" text-anchor="middle">{{ flight.text }}</text>
                </g>
                <circle v-else class="reply" :cx="xOf(flight)" :cy="yOf(flight)" r="5.5" />
            </template>

            <g
                v-for="(flight, index) in losing"
                :key="`l${index}-${flight.start}`"
                class="lost"
                :transform="`translate(${(LEFT + RIGHT) / 2} ${yOf(flight)})`"
            >
                <path d="M-8 -8L8 8M8 -8L-8 8" />
                <text y="-14" text-anchor="middle">lost</text>
            </g>
        </svg>

        <p class="legend">Squares are pieces of the message, one letter each. Round dots are TCP’s “got it” replies.</p>

        <div class="results">
            <div>
                <p class="panel-title">TCP: what the program gets</p>
                <div class="slots">
                    <span v-for="(slot, index) in tcpSlots" :key="index" class="slot" :class="slot.state">{{
                        slot.state === "empty" ? "" : slot.letter
                    }}</span>
                </div>
                <p class="time">
                    {{ tcpFinished ? `Done at ${Math.round(race?.tcpDone ?? 0)} ms` : race ? `${Math.round(now)} ms` : "Not started" }}
                </p>
            </div>
            <div>
                <p class="panel-title">UDP: what the program gets</p>
                <div class="slots">
                    <span v-for="(letter, index) in udpReceived" :key="index" class="slot given">{{ letter }}</span>
                    <span v-if="udpReceived.length === 0" class="slot empty" />
                </div>
                <p class="time">
                    {{ udpFinished ? `Done at ${Math.round(race?.udpDone ?? 0)} ms` : race ? `${Math.round(now)} ms` : "Not started" }}
                </p>
            </div>
        </div>

        <p v-if="done" class="ac-say good" data-word="Finished" aria-live="polite">{{ summary }}</p>
        <p v-else-if="race" class="ac-say hint" aria-live="polite">
            The race is on. A dashed letter on the TCP side has arrived, but waits until every letter before it is there.
        </p>
        <p v-else class="ac-say hint" aria-live="polite">
            The laptop sends the word NETWORKING to a server, one letter per packet: once over TCP, once over UDP. Which packets the link
            loses is chosen at random; the pattern number lets you run the same race again.
        </p>
    </div>
</template>

<style scoped>
.controls {
    margin: 12px 0 10px;
}

.pattern {
    color: var(--circuit-soft);
    font-size: 14px;
}

.race .ac-drawing {
    max-width: 600px;
}

.lane {
    font-size: 16px !important;
    font-weight: 700;
}

.lane-note {
    fill: var(--circuit-soft);
    font-weight: 400;
}

.cable.thin {
    stroke-width: 1.5;
    stroke-dasharray: 3 4;
}

.piece rect {
    fill: var(--circuit-yellow);
    stroke: #0a1a36;
    stroke-width: 1.5;
}

.piece text {
    fill: #0a1a36 !important;
    font-family: var(--circuit-mono);
    font-size: 14px !important;
    font-weight: 700;
}

.hello rect {
    fill: var(--circuit-paper);
    stroke: var(--circuit-link);
    stroke-width: 2;
}

.hello text {
    font-size: 12px;
    font-weight: 700;
}

.reply {
    fill: var(--circuit-link);
}

.lost path {
    stroke: var(--circuit-removed);
    stroke-width: 3;
    stroke-linecap: round;
}

.lost text {
    fill: var(--circuit-removed);
    font-size: 12px;
    font-weight: 700;
}

.legend {
    margin: 6px 0 0 !important;
    color: var(--circuit-soft);
    font-size: 13.5px;
}

.results {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 18px;
    margin-top: 14px;
}

.panel-title {
    margin: 0 0 6px !important;
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.06em;
    font-stretch: 112%;
    text-transform: uppercase;
}

.slots {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    min-height: 30px;
}

.slot {
    display: grid;
    place-items: center;
    width: 26px;
    height: 30px;
    border: 1.5px solid var(--circuit-line);
    font-family: var(--circuit-mono);
    font-size: 15px;
    font-weight: 700;
}

.slot.given {
    border-color: var(--circuit-ink);
    background: var(--circuit-yellow);
    color: #0a1a36;
}

.slot.waiting {
    border: 1.5px dashed var(--circuit-ink);
    color: var(--circuit-soft);
}

.time {
    margin: 6px 0 0 !important;
    color: var(--circuit-soft);
    font-family: var(--circuit-mono);
    font-size: 13px;
}

.hint {
    color: var(--circuit-soft);
}

@media (max-width: 640px) {
    .results {
        grid-template-columns: minmax(0, 1fr);
    }
}
</style>
