<script setup lang="ts">
// Lesson: hijacks and leaks. The reader has AS64510 hijack or leak their address block, then publishes a ROA, turns on origin validation and registry filters network by network, and sees where each network's traffic ends up.

import { computed, ref } from "vue";
import { useTravel } from "../travel";
import { type Delivery, type RoaChoice, RouteSpread, type Scenario } from "./HijackSpread";

type Place = { label: string; x: number; y: number };

const places: Record<number, Place> = {
    64496: { label: "Transit 1", x: 230, y: 80 },
    64497: { label: "Transit 2", x: 470, y: 80 },
    64503: { label: "ISP West", x: 75, y: 205 },
    64501: { label: "Your provider", x: 250, y: 215 },
    [RouteSpread.OTHER]: { label: "Another network", x: 470, y: 215 },
    64502: { label: "ISP East", x: 630, y: 205 },
    [RouteSpread.YOU]: { label: "You", x: 250, y: 345 },
};

const place = (as: number) => places[as]!;

const links: { a: number; b: number; peer?: boolean }[] = [
    { a: 64496, b: 64497, peer: true },
    { a: 64496, b: 64503 },
    { a: 64496, b: 64501 },
    { a: 64497, b: RouteSpread.OTHER },
    { a: 64497, b: 64502 },
    { a: 64501, b: RouteSpread.OTHER },
    { a: 64501, b: RouteSpread.YOU },
];

/** The networks whose traffic the widget follows: everyone but you and AS64510. */
const watched = [64496, 64497, 64501, 64502, 64503];

const scenarios: { id: Scenario; label: string; text: string }[] = [
    { id: "normal", label: "Nothing", text: `Only you announce ${RouteSpread.YOUR_BLOCK}.` },
    { id: "same", label: "Announces your /40", text: `AS64510 announces ${RouteSpread.YOUR_BLOCK} as its own, beside you.` },
    {
        id: "specific",
        label: "Announces a /48 inside it",
        text: `AS64510 announces ${RouteSpread.MORE_SPECIFIC}, a more specific part of your block.`,
    },
    {
        id: "forged",
        label: "Forges you as the origin",
        text: `AS64510 announces ${RouteSpread.MORE_SPECIFIC} with the path 64510 64500, as if it had heard it from you.`,
    },
    {
        id: "leak",
        label: "Leaks your route to Transit 2",
        text: "AS64510 hears your route from your provider, and passes it on to its other provider, Transit 2.",
    },
];

const roaChoices: { id: RoaChoice; label: string }[] = [
    { id: "none", label: "No ROA" },
    { id: "40", label: `${RouteSpread.YOUR_BLOCK}, max /40` },
    { id: "48", label: `${RouteSpread.YOUR_BLOCK}, max /48` },
];

const scenario = ref<Scenario>("same");
const roa = ref<RoaChoice>("none");
const rov = ref<number[]>([]);
const registry = ref(false);
const from = ref(64502);

const sceneText = computed(() => scenarios.find((choice) => choice.id === scenario.value)?.text ?? "");

const outcome = computed(() => RouteSpread.run(scenario.value, { roa: roa.value, rov: rov.value, registry: registry.value }));
const deliveries = computed(() => new Map<number, Delivery>(watched.map((as) => [as, RouteSpread.deliver(outcome.value, as)])));

type Fate = "you" | "other" | "through" | "none";

function fateOf(as: number): Fate {
    const delivery = deliveries.value.get(as)!;
    if (delivery.end === "you" && delivery.hops.includes(RouteSpread.OTHER)) return "through";
    return delivery.end;
}

const FATE_WORDS: Record<Fate, string> = { you: "To you", other: "To AS64510", through: "Through AS64510", none: "No route" };

const tally = computed(() => {
    const count = (fate: Fate) => watched.filter((as) => fateOf(as) === fate).length;
    return { you: count("you"), other: count("other"), through: count("through"), none: count("none") };
});

const summary = computed(() => {
    const { you, other, through, none } = tally.value;
    const parts = [`${you} of 5 networks reach you directly`];
    if (other) parts.push(`${other} send your traffic to AS64510`);
    if (through) parts.push(`${through} reach you only through AS64510`);
    if (none) parts.push(`${none} ${none === 1 ? "has" : "have"} no route to you at all`);

    const kind = other ? "bad" : through || none ? "warn" : "good";
    const word = other ? "Hijacked" : through ? "Leaked" : none ? "Partly" : "Safe";
    return { kind, word, text: `${parts.join(", ")}.` };
});

/** Each refusal once, newest reason last. */
const refusals = computed(() => {
    const seen = new Map<string, string>();
    for (const { at, route, reason } of outcome.value.refused) {
        const key = `${at} ${route.prefix} ${route.path.join(" ")}`;
        seen.set(key, `${place(at).label} dropped ${route.prefix}, path ${route.path.join(" ")}: ${reason}.`);
    }
    return [...seen.values()];
});

function toggleRov(as: number) {
    rov.value = rov.value.includes(as) ? rov.value.filter((entry) => entry !== as) : [...rov.value, as];
}

function allRov() {
    rov.value = rov.value.length === watched.length ? [] : [...watched];
}

function routeText(as: number) {
    const route = deliveries.value.get(as)!.via;
    if (!route) return "none";
    return `${route.prefix}, path ${route.path.join(" ")}`;
}

const { position, travelling, travel } = useTravel();
const sent = ref<number[]>([]);

async function send() {
    const delivery = deliveries.value.get(from.value)!;
    sent.value = delivery.hops;
    await travel(delivery.hops.map((as) => [place(as).x, place(as).y]));
}

function changed() {
    sent.value = [];
}

const isLit = (a: number, b: number) =>
    sent.value.some((as, index) => index > 0 && ((sent.value[index - 1] === a && as === b) || (sent.value[index - 1] === b && as === a)));

const sentSay = computed(() => {
    if (!sent.value.length || travelling.value) return undefined;
    const fate = fateOf(from.value);
    const path = sent.value.map((as) => place(as).label).join(", then ");
    return { fate, text: `Traffic to ${RouteSpread.TARGET} from ${place(from.value).label} went: ${path}.` };
});

const tagWidth = (fate: Fate) => FATE_WORDS[fate].length * 7.2 + 14;
</script>

<template>
    <div class="hijack-spread">
        <div class="controls">
            <div class="ac-field">
                <span>1. What AS64510 does</span>
                <div class="ac-row" role="group" aria-label="What AS64510 does">
                    <button
                        v-for="choice in scenarios"
                        :key="choice.id"
                        type="button"
                        class="ac-button small"
                        :aria-pressed="scenario === choice.id"
                        @click="((scenario = choice.id), changed())"
                    >
                        {{ choice.label }}
                    </button>
                </div>
            </div>

            <div class="ac-field">
                <span>2. Your ROA</span>
                <div class="ac-row" role="group" aria-label="Your ROA">
                    <button
                        v-for="choice in roaChoices"
                        :key="choice.id"
                        type="button"
                        class="ac-button small mono"
                        :aria-pressed="roa === choice.id"
                        @click="((roa = choice.id), changed())"
                    >
                        {{ choice.label }}
                    </button>
                </div>
            </div>

            <div class="ac-field">
                <span>3. Networks that drop RPKI invalid routes</span>
                <div class="ac-row" role="group" aria-label="Networks that drop RPKI invalid routes">
                    <button
                        v-for="as in watched"
                        :key="as"
                        type="button"
                        class="ac-button small"
                        :aria-pressed="rov.includes(as)"
                        @click="(toggleRov(as), changed())"
                    >
                        {{ place(as).label }}
                    </button>
                    <button type="button" class="ac-button small" @click="(allRov(), changed())">
                        {{ rov.length === watched.length ? "None" : "All five" }}
                    </button>
                </div>
            </div>

            <div class="ac-field">
                <span>4. Registry filters</span>
                <button type="button" class="ac-button small" :aria-pressed="registry" @click="((registry = !registry), changed())">
                    Providers accept only what each customer registered
                </button>
            </div>
        </div>

        <p class="scene">{{ sceneText }}</p>

        <svg
            class="ac-drawing"
            viewBox="0 0 700 400"
            role="img"
            :aria-label="`Seven networks. Transit 1 and Transit 2 peer. Transit 1 serves ISP West and your provider; Transit 2 serves AS64510 and ISP East; your provider serves you and AS64510. ${summary.text}`"
        >
            <line
                v-for="link in links"
                :key="`${link.a}-${link.b}`"
                class="cable"
                :class="{ peer: link.peer, lit: isLit(link.a, link.b) }"
                :x1="place(link.a).x"
                :y1="place(link.a).y"
                :x2="place(link.b).x"
                :y2="place(link.b).y"
            />
            <text class="caption" x="350" y="70" text-anchor="middle">peers</text>

            <SvgDevice
                v-for="as in RouteSpread.ASES"
                :key="as"
                kind="router"
                :x="place(as).x"
                :y="place(as).y"
                :label="place(as).label"
                :note="`AS${as}`"
                :lit="as === from"
            />

            <g
                v-for="as in watched"
                :key="`tag-${as}`"
                class="tag"
                :class="fateOf(as)"
                :transform="`translate(${place(as).x} ${place(as).y - 48})`"
            >
                <rect :x="-tagWidth(fateOf(as)) / 2" y="-11" :width="tagWidth(fateOf(as))" height="22" />
                <text y="4" text-anchor="middle">{{ FATE_WORDS[fateOf(as)] }}</text>
            </g>

            <circle v-if="travelling" class="packet" :cx="position[0]" :cy="position[1]" r="9" />
        </svg>

        <p class="ac-say" :class="summary.kind" :data-word="summary.word" aria-live="polite">{{ summary.text }}</p>

        <div class="send">
            <label class="ac-field">
                <span>Send traffic to {{ RouteSpread.TARGET }} from</span>
                <select v-model.number="from" class="ac-select" @change="changed">
                    <option v-for="as in watched" :key="as" :value="as">{{ place(as).label }}</option>
                </select>
            </label>
            <button type="button" class="ac-button primary" :disabled="travelling" @click="send">Send</button>
        </div>
        <p v-if="sentSay" class="ac-say sent" :class="sentSay.fate" aria-live="polite">{{ sentSay.text }}</p>

        <div class="frame">
            <table class="ac-table">
                <thead>
                    <tr>
                        <th>Network</th>
                        <th>Route it uses for {{ RouteSpread.TARGET }}</th>
                        <th>Traffic goes</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="as in watched" :key="as" :class="{ lit: as === from }">
                        <td>{{ place(as).label }}</td>
                        <td class="ac-mono">{{ routeText(as) }}</td>
                        <td :class="['fate', fateOf(as)]">{{ FATE_WORDS[fateOf(as)] }}</td>
                    </tr>
                </tbody>
            </table>
        </div>

        <div class="refused">
            <p class="heading">Dropped by a defence</p>
            <ul v-if="refusals.length">
                <li v-for="line in refusals" :key="line">{{ line }}</li>
            </ul>
            <p v-else class="quiet">Nothing yet. Only a loop or your own space coming back is dropped without a defence.</p>
        </div>
    </div>
</template>

<style scoped>
.controls {
    display: grid;
    gap: 12px;
}

.mono {
    font-family: var(--circuit-mono);
    font-size: 13px;
}

.scene {
    margin: 14px 0 0;
    font-weight: 700;
}

.cable.peer {
    stroke-dasharray: 8 6;
}

.caption {
    fill: var(--circuit-soft) !important;
    font-size: 12px !important;
}

.tag rect {
    fill: var(--circuit-paper);
    stroke-width: 1.5;
}

.ac-drawing .tag text {
    font-size: 12px;
    font-weight: 700;
}

.tag.you rect {
    stroke: var(--circuit-added);
}

.ac-drawing .tag.you text {
    fill: var(--circuit-added);
}

.tag.other rect {
    fill: var(--circuit-removed);
    stroke: var(--circuit-removed);
}

.ac-drawing .tag.other text {
    fill: var(--circuit-paper);
}

.tag.through rect {
    stroke: var(--circuit-warning);
    stroke-dasharray: 4 3;
}

.ac-drawing .tag.through text {
    fill: var(--circuit-warning);
}

.tag.none rect {
    stroke: var(--circuit-soft);
    stroke-dasharray: 2 3;
}

.ac-drawing .tag.none text {
    fill: var(--circuit-soft);
}

.send {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: 10px;
    margin-top: 16px;
}

.sent.other::before,
.sent.you::before,
.sent.through::before,
.sent.none::before {
    display: inline-block;
    margin-right: 8px;
    padding: 0 6px;
    color: #ffffff;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.08em;
    line-height: 20px;
    text-transform: uppercase;
    vertical-align: 1px;
}

.sent.you::before {
    content: "To you";
    background: var(--circuit-added);
}

.sent.other::before {
    content: "To AS64510";
    background: var(--circuit-removed);
}

.sent.through::before {
    content: "Through AS64510";
    background: var(--circuit-warning);
}

.sent.none::before {
    content: "No route";
    background: var(--circuit-soft);
}

.dark .sent.you::before,
.dark .sent.other::before {
    color: #0b1122;
}

.frame {
    margin-top: 14px;
    overflow-x: auto;
}

.fate {
    font-weight: 700;
}

.fate.you {
    color: var(--circuit-added);
}

.fate.other {
    color: var(--circuit-removed);
}

.fate.through {
    color: var(--circuit-warning);
}

.fate.none {
    color: var(--circuit-soft);
}

.refused {
    margin-top: 14px;
    font-size: 14.5px;
}

.refused ul {
    margin: 4px 0 0 !important;
}

.refused li {
    margin: 2px 0 !important;
    line-height: 1.5;
}

.heading {
    margin: 0;
    font-weight: 700;
}

.quiet {
    margin: 4px 0 0;
    color: var(--circuit-soft);
}
</style>
