<script setup lang="ts">
// Lesson: BGP. The reader announces a prefix from their AS and steps through the rounds as it spreads, the AS path growing at each hop and loops dropped. Cutting links changes the paths.

import { computed, ref } from "vue";
import { Announcement } from "./BgpAnnounce";
import type { Arrival, AsLink } from "./BgpAnnounce";

const ORIGIN = 64500;
const PREFIX = "198.51.100.0/24";

const places: Record<number, { name: string; x: number; y: number }> = {
    64500: { name: "You", x: 90, y: 190 },
    6939: { name: "Hurricane Electric", x: 250, y: 70 },
    1299: { name: "Arelion", x: 450, y: 70 },
    27776: { name: "El Boldo", x: 620, y: 70 },
    15169: { name: "Google", x: 450, y: 310 },
    174: { name: "Cogent", x: 250, y: 310 },
};

const ases = [64500, 6939, 174, 1299, 15169, 27776];

const allLinks: AsLink[] = [
    { a: 64500, b: 6939, provider: 6939 },
    { a: 64500, b: 174, provider: 174 },
    { a: 6939, b: 1299 },
    { a: 174, b: 1299 },
    { a: 174, b: 15169 },
    { a: 1299, b: 27776, provider: 1299 },
];

const cut = ref<string[]>([]);
const linkKey = (link: AsLink) => `${link.a}-${link.b}`;
const links = computed(() => allLinks.filter((link) => !cut.value.includes(linkKey(link))));

/** A small arrow at the middle of a transit link, pointing from the customer to the provider it pays. */
function arrow(link: AsLink): string {
    const provider = place(link.provider!);
    const customer = place(link.provider === link.a ? link.b : link.a);
    const angle = (Math.atan2(provider.y - customer.y, provider.x - customer.x) * 180) / Math.PI;
    return `translate(${(provider.x + customer.x) / 2} ${(provider.y + customer.y) / 2}) rotate(${angle})`;
}

const rounds = computed(() => Announcement.rounds(links.value, ORIGIN));
const step = ref(0);

const round = computed(() => (step.value === 0 ? undefined : rounds.value[step.value]));
const best = computed(() => round.value?.best ?? new Map<number, number[]>());
const last = computed(() => rounds.value.length - 1);

/** Set when the reader announces with every link of the origin cut. */
const alone = ref(false);

function start() {
    if (last.value === 0) {
        alone.value = true;
        return;
    }

    step.value = 1;
}

function next() {
    if (step.value < last.value) step.value += 1;
}

function toggle(link: AsLink) {
    const name = linkKey(link);
    cut.value = cut.value.includes(name) ? cut.value.filter((entry) => entry !== name) : [...cut.value, name];
    step.value = 0;
    alone.value = false;
}

const pathText = (path: number[]) => (path.length ? path.join(" ") : "its own");

function noteOf(as: number): string {
    const path = best.value.get(as);
    if (as === ORIGIN) return step.value ? "announces it" : "";
    if (!path) return step.value ? "no route yet" : "";
    return path.join(" ");
}

const place = (as: number) => places[as]!;

/** Where a message is drawn: above a level link, higher for one going left; part way along a sloping one, nearer its receiver. */
function chipAt(arrival: Arrival) {
    const from = place(arrival.from);
    const to = place(arrival.to);

    if (from.y === to.y) return { x: (from.x + to.x) / 2, y: from.y + (to.x > from.x ? -30 : -58) };

    return { x: from.x + (to.x - from.x) * 0.62, y: from.y + (to.y - from.y) * 0.62 };
}

const name = (as: number) => place(as).name;

function sentence(arrival: Arrival): string {
    const who = name(arrival.to);
    const path = arrival.path.join(" ");

    if (arrival.result === "loop") return `${who} hears ${path}, finds its own number in it, and drops it. That is a loop.`;
    if (arrival.result === "new") return `${who} hears ${path}. It is its first route to ${PREFIX}, so it keeps it.`;
    if (arrival.result === "shorter") return `${who} hears ${path}, which is shorter than what it had, so it switches to it.`;
    return `${who} hears ${path}, which is no shorter than ${pathText(best.value.get(arrival.to) ?? [])}, so it keeps what it has.`;
}

const said = computed(() => {
    if (alone.value) return "Every link of yours is cut, so nobody hears the announcement. Put a link back.";
    if (step.value === 0) return "Announce your prefix, and step through the rounds.";

    if (step.value === last.value) {
        const missing = ases.filter((as) => as !== ORIGIN && !best.value.get(as)).map(name);
        const done = "Nobody has anything more to send.";
        if (!missing.length) return done;
        return `${done} ${missing.join(" and ")} ${missing.length === 1 ? "has" : "have"} no route, because no neighbor may pass it on.`;
    }

    return "Every AS whose path changed sends it on, with its own number in front.";
});

const label = (as: number) => `${name(as)}, AS${as}`;
</script>

<template>
    <div class="bgp-announce">
        <div class="ac-row controls">
            <button v-if="step === 0" type="button" class="ac-button primary" @click="start">Announce {{ PREFIX }}</button>
            <button v-else type="button" class="ac-button primary" :disabled="step === last" @click="next">Next round</button>
            <button type="button" class="ac-button" :disabled="step === 0" @click="step = 0">Start again</button>
            <span v-if="step" class="count">Round {{ step }} of {{ last }}</span>
        </div>

        <svg
            class="ac-drawing"
            viewBox="0 0 700 370"
            role="img"
            :aria-label="`Six networks joined by transit and peering links. You announce ${PREFIX}.`"
        >
            <g class="legend" transform="translate(20 20)">
                <path class="pays" transform="translate(9 0)" d="M-9 -8L9 0L-9 8z" />
                <text x="26" y="4">transit: arrow to who is paid</text>
                <text x="26" y="26">peering: no arrow</text>
            </g>
            <g v-for="link in allLinks" :key="linkKey(link)">
                <line
                    class="cable"
                    :class="{ cut: cut.includes(linkKey(link)) }"
                    :x1="place(link.a).x"
                    :y1="place(link.a).y"
                    :x2="place(link.b).x"
                    :y2="place(link.b).y"
                />
                <path v-if="link.provider" class="pays" :transform="arrow(link)" d="M-9 -8L9 0L-9 8z" />
            </g>
            <SvgDevice
                v-for="as in ases"
                :key="as"
                kind="router"
                :x="place(as).x"
                :y="place(as).y"
                :label="name(as)"
                :note="noteOf(as)"
                :lit="as === ORIGIN"
            />
            <g
                v-for="(arrival, index) in round?.arrivals ?? []"
                :key="index"
                :transform="`translate(${chipAt(arrival).x} ${chipAt(arrival).y})`"
                class="chip"
                :class="arrival.result"
            >
                <rect
                    :x="-(arrival.path.join(' ').length * 3.9 + 10)"
                    y="-12"
                    :width="arrival.path.join(' ').length * 7.8 + 20"
                    height="24"
                />
                <text y="4.5" text-anchor="middle">{{ arrival.path.join(" ") }}</text>
            </g>
        </svg>

        <p class="ac-say" aria-live="polite">{{ said }}</p>

        <ul v-if="round" class="log" aria-live="polite">
            <li v-for="(arrival, index) in round.arrivals" :key="index" :class="arrival.result">
                <span class="mark">{{ arrival.result === "loop" ? "Dropped" : arrival.result === "longer" ? "Ignored" : "Kept" }}</span>
                {{ sentence(arrival) }}
            </li>
        </ul>

        <div class="frame">
            <table class="ac-table">
                <thead>
                    <tr>
                        <th>AS</th>
                        <th>AS path to {{ PREFIX }}</th>
                        <th>ASes on the way</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="as in ases" :key="as">
                        <td>{{ label(as) }}</td>
                        <td class="ac-mono">
                            {{ as === ORIGIN ? (step ? "its own prefix" : "") : (best.get(as)?.join(" ") ?? (step ? "no route yet" : "")) }}
                        </td>
                        <td>{{ as !== ORIGIN ? (best.get(as)?.length ?? "") : "" }}</td>
                    </tr>
                </tbody>
            </table>
        </div>

        <div class="ac-field cuts">
            <span>Cut a link, then announce again</span>
            <div class="ac-row">
                <button
                    v-for="link in allLinks"
                    :key="linkKey(link)"
                    type="button"
                    class="ac-button small"
                    :aria-pressed="cut.includes(linkKey(link))"
                    @click="toggle(link)"
                >
                    {{ cut.includes(linkKey(link)) ? "Cut:" : "" }} {{ name(link.a) }} to {{ name(link.b) }}
                </button>
            </div>
        </div>
    </div>
</template>

<style scoped>
.controls {
    margin-bottom: 8px;
}

.count {
    color: var(--circuit-soft);
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
}

.cable.cut {
    stroke-dasharray: 5 7;
    opacity: 0.45;
}

.pays {
    fill: var(--circuit-edge, #7b86a0);
    stroke: none;
}

.ac-drawing .legend text {
    font-size: 12px;
}

.chip rect {
    fill: var(--circuit-yellow);
    stroke: #0a1a36;
    stroke-width: 1.5;
}

.ac-drawing .chip text {
    fill: #0a1a36;
    font-family: var(--circuit-mono);
    font-size: 12.5px;
    font-weight: 700;
}

.chip.longer rect {
    fill: var(--circuit-paper);
    stroke: var(--circuit-edge, #7b86a0);
}

.ac-drawing .chip.longer text {
    fill: var(--circuit-soft);
}

.chip.loop rect {
    fill: var(--circuit-paper);
    stroke: var(--circuit-removed);
    stroke-dasharray: 4 3;
}

.ac-drawing .chip.loop text {
    fill: var(--circuit-removed);
    text-decoration: line-through;
}

.log {
    display: grid;
    gap: 6px;
    margin: 12px 0 0 !important;
    padding: 0 !important;
    list-style: none;
    font-size: 14.5px;
}

.log li {
    margin: 0 !important;
    line-height: 1.5;
}

.mark {
    display: inline-block;
    min-width: 5.6em;
    margin-right: 6px;
    padding: 0 6px;
    background: var(--circuit-added);
    color: #ffffff;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.08em;
    line-height: 20px;
    text-align: center;
    text-transform: uppercase;
}

.dark .mark {
    color: #0a1a36;
}

.log .longer .mark {
    background: var(--circuit-soft);
}

.log .loop .mark {
    background: var(--circuit-removed);
}

.frame {
    margin-top: 14px;
    overflow-x: auto;
}

.cuts {
    margin-top: 16px;
}
</style>
