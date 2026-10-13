<script setup lang="ts">
// Lesson: attacks on the network. A flood toward one customer address arrives over two transits and an exchange; the reader has the customer ask for a blackhole, lists which transits take it, and sees which links are freed and who stops sending.

import { computed, ref } from "vue";
import { useTravel } from "../travel";

const TARGET = "192.0.2.10";

type UpstreamId = "a" | "b" | "ix";

type Upstream = {
    id: UpstreamId;
    label: string;
    asn: number;
    /** Its own blackhole community, when it takes blackholes from us. */
    community?: string;
    /** Gbit/s of the flood that arrives through it. */
    flood: number;
    /** Gbit/s of everyone else's traffic through it. */
    normal: number;
    x: number;
    y: number;
};

const upstreams: Upstream[] = [
    { id: "a", label: "Transit A", asn: 64501, community: "65535:666", flood: 12, normal: 4, x: 250, y: 70 },
    { id: "b", label: "Transit B", asn: 64502, community: "64502:666", flood: 9, normal: 3, x: 250, y: 200 },
    { id: "ix", label: "The exchange", asn: 64504, flood: 3, normal: 2, x: 250, y: 330 },
];

/** Every link to an upstream, in Gbit/s. */
const UPSTREAM_CAPACITY = 10;
/** Acme's link, in Gbit/s, and Acme's own traffic on it. */
const ACME_CAPACITY = 1;
const ACME_NORMAL = 0.3;

const sources = { x: 70, y: 200 };
const edge = { x: 450, y: 200 };
const acme = { x: 630, y: 110 };
const others = { x: 630, y: 290 };

const asked = ref(false);
const listed = ref<UpstreamId[]>([]);

const takesIt = (upstream: Upstream) => asked.value && upstream.community !== undefined && listed.value.includes(upstream.id);

function toggleListed(id: UpstreamId) {
    listed.value = listed.value.includes(id) ? listed.value.filter((entry) => entry !== id) : [...listed.value, id];
    sentOnce.value = false;
}

const loads = computed(() =>
    upstreams.map((upstream) => {
        const flood = takesIt(upstream) ? 0 : upstream.flood;
        return { upstream, load: upstream.normal + flood, flood };
    })
);

/** The flood that reaches your router, and what reaches Acme's link. */
const atEdge = computed(() => loads.value.reduce((sum, entry) => sum + entry.flood, 0));
const acmeLoad = computed(() => ACME_NORMAL + (asked.value ? 0 : atEdge.value));

const format = (gbits: number) => `${gbits.toLocaleString("en-US", { maximumFractionDigits: 1 })}`;

const overloaded = computed(() => [
    ...loads.value.filter((entry) => entry.load > UPSTREAM_CAPACITY).map((entry) => entry.upstream.label),
    ...(acmeLoad.value > ACME_CAPACITY ? ["Acme's link"] : []),
]);

const summary = computed(() => {
    if (!asked.value) {
        return {
            kind: "bad",
            word: "Flooded",
            text: `${format(atEdge.value)} Gbit/s of flood is on its way to ${TARGET}. ${overloaded.value.join(", ")} ${overloaded.value.length === 1 ? "is" : "are"} full, so every customer's traffic through ${overloaded.value.length === 1 ? "it" : "them"} loses packets, not only Acme's.`,
        };
    }

    const stopped = upstreams.filter(takesIt).map((upstream) => upstream.label);
    const stoppedText = stopped.length
        ? `${stopped.join(" and ")} drop${stopped.length === 1 ? "s" : ""} the flood in ${stopped.length === 1 ? "its" : "their"} own network. `
        : "No upstream receives the blackhole route, so the whole flood still crosses your links. ";

    if (overloaded.value.length) {
        return {
            kind: "warn",
            word: "Partly",
            text: `Your router drops everything to ${TARGET}, so Acme's link is free. ${stoppedText}${overloaded.value.join(" and ")} ${overloaded.value.length === 1 ? "is" : "are"} still full.`,
        };
    }

    return {
        kind: "good",
        word: "Shed",
        text: `${stoppedText}What still arrives, ${format(atEdge.value)} Gbit/s through the exchange, your router drops. Every link has room again. The price: ${TARGET} is unreachable for everyone until the blackhole is withdrawn.`,
    };
});

function toggleAsk() {
    asked.value = !asked.value;
    sentOnce.value = false;
}

const travellers = upstreams.map(() => useTravel(300));
const sentOnce = ref(false);
const busy = computed(() => travellers.some((traveller) => traveller.travelling.value));

async function send() {
    sentOnce.value = true;

    await Promise.all(
        upstreams.map((upstream, index) => {
            const path: [number, number][] = [
                [sources.x, sources.y],
                [upstream.x, upstream.y],
            ];
            if (!takesIt(upstream)) path.push([edge.x, edge.y]);
            if (!takesIt(upstream) && !asked.value) path.push([acme.x, acme.y]);
            return travellers[index]!.travel(path);
        })
    );
}

/** Where each wave stopped, in words. */
const fates = computed(() =>
    upstreams.map((upstream) => {
        if (takesIt(upstream)) return `${upstream.label} drops it: it received ${TARGET}/32 with ${upstream.community}.`;
        if (asked.value) {
            return upstream.community && !listed.value.includes(upstream.id)
                ? `${upstream.label} sends it on: it would take blackholes, but it is not in your upstreams, so it never received the route. Your router drops it.`
                : `${upstream.label} sends it on: it takes no blackholes, and never received the route. Your router drops it.`;
        }
        return `${upstream.label} sends it on, and your router passes it to Acme.`;
    })
);

const code = computed(() => {
    const entries = upstreams.filter((upstream) => upstream.community && listed.value.includes(upstream.id));
    const blackhole = entries.length
        ? `    blackhole: { function: 666, upstreams: { ${entries.map((upstream) => `${upstream.asn}: "${upstream.community}"`).join(", ")} } },`
        : "    blackhole: { function: 666 },";

    return ["export const communities = communityScheme({", "    asn: 64500,", blackhole, "});"].join("\n");
});

const meter = (load: number, capacity: number) => Math.min(100, (load / capacity) * 100);
</script>

<template>
    <div class="blackhole-flood">
        <svg
            class="ac-drawing"
            viewBox="0 0 700 400"
            role="img"
            :aria-label="`A flood from many sources reaches your edge router through Transit A, Transit B and an exchange, toward Acme's server ${TARGET}. ${summary.text}`"
        >
            <line
                v-for="upstream in upstreams"
                :key="`in-${upstream.id}`"
                class="cable"
                :x1="sources.x"
                :y1="sources.y"
                :x2="upstream.x"
                :y2="upstream.y"
            />
            <line
                v-for="entry in loads"
                :key="`up-${entry.upstream.id}`"
                class="cable"
                :class="{ full: entry.load > UPSTREAM_CAPACITY }"
                :x1="entry.upstream.x"
                :y1="entry.upstream.y"
                :x2="edge.x"
                :y2="edge.y"
            />
            <line class="cable" :class="{ full: acmeLoad > ACME_CAPACITY }" :x1="edge.x" :y1="edge.y" :x2="acme.x" :y2="acme.y" />
            <line class="cable" :x1="edge.x" :y1="edge.y" :x2="others.x" :y2="others.y" />

            <SvgDevice kind="cloud" :x="sources.x" :y="sources.y" label="Attack sources" note="thousands" />
            <SvgDevice
                v-for="upstream in upstreams"
                :key="upstream.id"
                kind="router"
                :x="upstream.x"
                :y="upstream.y"
                :label="upstream.label"
                :note="takesIt(upstream) ? 'drops it' : `AS${upstream.asn}`"
                :lit="takesIt(upstream)"
            />
            <SvgDevice kind="router" :x="edge.x" :y="edge.y" label="Your edge" :note="asked ? `drops ${TARGET}` : 'AS64500'" :lit="asked" />
            <SvgDevice kind="server" :x="acme.x" :y="acme.y" label="Acme's server" :note="TARGET" :dim="asked" />
            <SvgDevice kind="cloud" :x="others.x" :y="others.y" label="Other customers" />

            <template v-for="(traveller, index) in travellers" :key="`p-${index}`">
                <circle
                    v-if="traveller.travelling.value"
                    class="packet"
                    :cx="traveller.position.value[0]"
                    :cy="traveller.position.value[1]"
                    r="8"
                />
            </template>
        </svg>

        <div class="controls">
            <div class="ac-field">
                <span>1. Acme, under attack, asks you</span>
                <button type="button" class="ac-button small" :aria-pressed="asked" @click="toggleAsk">
                    Announce {{ TARGET }}/32 with 64500:666:0
                </button>
            </div>
            <div class="ac-field">
                <span>2. Upstreams in your scheme's blackhole.upstreams</span>
                <div class="ac-row" role="group" aria-label="Upstreams that receive the blackhole">
                    <button
                        v-for="upstream in upstreams.filter((entry) => entry.community)"
                        :key="upstream.id"
                        type="button"
                        class="ac-button small"
                        :aria-pressed="listed.includes(upstream.id)"
                        @click="toggleListed(upstream.id)"
                    >
                        {{ upstream.label }}, {{ upstream.community }}
                    </button>
                </div>
                <p class="quiet">The exchange takes no blackholes, so it cannot be listed.</p>
            </div>
        </div>

        <CodeView :code="code" title="routing.ts" />

        <div class="meters">
            <div v-for="entry in loads" :key="entry.upstream.id" class="meter" :class="{ full: entry.load > UPSTREAM_CAPACITY }">
                <span class="name">{{ entry.upstream.label }} link</span>
                <span class="bar"><span :style="{ width: `${meter(entry.load, UPSTREAM_CAPACITY)}%` }" /></span>
                <span class="value"
                    >{{ format(entry.load) }} of {{ UPSTREAM_CAPACITY }} Gbit/s{{ entry.load > UPSTREAM_CAPACITY ? ", full" : "" }}</span
                >
            </div>
            <div class="meter" :class="{ full: acmeLoad > ACME_CAPACITY }">
                <span class="name">Acme's link</span>
                <span class="bar"><span :style="{ width: `${meter(acmeLoad, ACME_CAPACITY)}%` }" /></span>
                <span class="value"
                    >{{ format(acmeLoad) }} of {{ ACME_CAPACITY }} Gbit/s{{ acmeLoad > ACME_CAPACITY ? ", full" : "" }}</span
                >
            </div>
        </div>

        <p class="ac-say" :class="summary.kind" :data-word="summary.word" aria-live="polite">{{ summary.text }}</p>

        <div class="ac-row send">
            <button type="button" class="ac-button primary" :disabled="busy" @click="send">Send a wave of the flood</button>
        </div>
        <ul v-if="sentOnce && !busy" class="fates" aria-live="polite">
            <li v-for="(line, index) in fates" :key="index">{{ line }}</li>
        </ul>
    </div>
</template>

<style scoped>
.cable.full {
    stroke: var(--circuit-removed);
    stroke-width: 5;
}

.controls {
    display: grid;
    gap: 12px;
    margin-top: 10px;
}

.quiet {
    margin: 2px 0 0;
    color: var(--circuit-soft);
    font-size: 14px;
}

.meters {
    display: grid;
    gap: 6px;
    margin-top: 6px;
}

.meter {
    display: grid;
    grid-template-columns: 9em minmax(60px, 1fr) 13em;
    align-items: center;
    gap: 10px;
    font-size: 14.5px;
}

.bar {
    height: 14px;
    border: 1.5px solid var(--circuit-ink);
    background: var(--circuit-paper);
}

.bar span {
    display: block;
    height: 100%;
    background: var(--circuit-link);
    transition: width 0.3s;
}

.meter.full .bar span {
    background: var(--circuit-removed);
}

.meter.full .value {
    color: var(--circuit-removed);
    font-weight: 700;
}

.send {
    margin-top: 14px;
}

.fates {
    margin: 10px 0 0 !important;
    font-size: 14.5px;
}

.fates li {
    margin: 2px 0 !important;
}

@media (max-width: 640px) {
    .meter {
        grid-template-columns: 1fr;
        gap: 2px;
        margin-bottom: 6px;
    }
}

@media (prefers-reduced-motion: reduce) {
    .bar span {
        transition: none;
    }
}
</style>
