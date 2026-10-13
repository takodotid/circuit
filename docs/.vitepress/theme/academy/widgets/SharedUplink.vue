<script setup lang="ts">
// Lesson: what an ISP sells. The reader brings more broadband homes online on a shared uplink, and watches each home's share shrink while a business on DIA keeps its committed rate.

import { computed, ref } from "vue";

/** A made-up street: the numbers are chosen to be easy to follow, not taken from any provider. */
const UPLINK = 1000;
const COMMITTED = 100;
const HOMES = 40;
const PLAN = 100;

const SHARED = UPLINK - COMMITTED;
const BAR = { left: 20, width: 660, top: 40, height: 46 };

const busy = ref(4);

const share = computed(() => Math.min(PLAN, SHARED / busy.value));
const used = computed(() => share.value * busy.value);
const scale = (rate: number) => (rate / UPLINK) * BAR.width;

const homes = computed(() =>
    Array.from({ length: HOMES }, (_, index) => ({
        index,
        busy: index < busy.value,
        x: 40 + (index % 20) * 32,
        y: 150 + Math.floor(index / 20) * 34,
    }))
);

const shown = (rate: number) => (Number.isInteger(rate) ? String(rate) : rate.toFixed(1));

const said = computed(() => {
    if (share.value >= PLAN)
        return {
            kind: "good",
            word: "Full speed",
            text: `${busy.value} ${busy.value === 1 ? "home is" : "homes are"} busy, needing ${busy.value * PLAN} Mbit/s, and ${SHARED} Mbit/s is there to share. Every busy home gets its full ${PLAN} Mbit/s. Bring more homes online.`,
        };

    return {
        kind: "warn",
        word: "Shared",
        text: `${busy.value} homes are busy at once. ${SHARED} Mbit/s split ${busy.value} ways is ${shown(share.value)} Mbit/s each. No promise is broken: broadband is sold as up to ${PLAN} Mbit/s. The business on DIA still gets its ${COMMITTED} Mbit/s, because that rate is committed.`,
    };
});
</script>

<template>
    <div class="shared-uplink">
        <label class="ac-field">
            <span>Homes online and busy right now: {{ busy }} of {{ HOMES }}</span>
            <input v-model.number="busy" class="range" type="range" min="1" :max="HOMES" step="1" />
        </label>

        <svg
            class="ac-drawing"
            viewBox="0 0 700 230"
            role="img"
            :aria-label="`An uplink of ${UPLINK} Mbit/s: ${COMMITTED} committed to a business, and ${busy} busy homes sharing ${SHARED}, ${shown(share)} Mbit/s each.`"
        >
            <text class="title" :x="BAR.left" :y="BAR.top - 12">The street's uplink to the provider: {{ UPLINK }} Mbit/s</text>
            <rect class="free" :x="BAR.left" :y="BAR.top" :width="BAR.width" :height="BAR.height" />
            <rect class="committed" :x="BAR.left" :y="BAR.top" :width="scale(COMMITTED)" :height="BAR.height" />
            <text class="inside" :x="BAR.left + 8" :y="BAR.top + 28">DIA</text>
            <rect
                v-for="index in busy"
                :key="index"
                class="home-share"
                :x="BAR.left + scale(COMMITTED) + scale(share) * (index - 1)"
                :y="BAR.top"
                :width="scale(share)"
                :height="BAR.height"
            />
            <rect class="frame" :x="BAR.left" :y="BAR.top" :width="BAR.width" :height="BAR.height" />
            <text class="caption" :x="BAR.left" :y="BAR.top + BAR.height + 20">
                {{ COMMITTED }} committed to the business, {{ shown(used) }} used by homes, {{ shown(SHARED - used) }} free
            </text>

            <g v-for="home in homes" :key="home.index" class="home" :class="{ on: home.busy }">
                <path :d="`M${home.x - 11} ${home.y}l11 -10l11 10v12h-22z`" />
            </g>
            <text class="caption" x="20" y="222">{{ HOMES }} homes, each sold "up to {{ PLAN }} Mbit/s". Filled: busy now.</text>
        </svg>

        <dl class="numbers">
            <div>
                <dt>Each busy home gets</dt>
                <dd>{{ shown(share) }} <small>Mbit/s</small></dd>
            </div>
            <div>
                <dt>The business on DIA gets</dt>
                <dd>{{ COMMITTED }} <small>Mbit/s</small></dd>
            </div>
            <div>
                <dt>Sold to the homes, against {{ SHARED }} shared</dt>
                <dd>{{ HOMES * PLAN }} <small>Mbit/s</small></dd>
            </div>
        </dl>

        <p class="ac-say" :class="said.kind" :data-word="said.word" aria-live="polite">{{ said.text }}</p>
    </div>
</template>

<style scoped>
.range {
    width: min(360px, 100%);
    min-height: 40px;
    accent-color: var(--circuit-cobalt);
}

.free {
    fill: var(--circuit-mist);
}

.committed {
    fill: var(--circuit-cobalt);
}

.home-share {
    fill: var(--circuit-link);
    opacity: 0.55;
    stroke: var(--circuit-paper);
    stroke-width: 1;
    transition:
        x 0.25s,
        width 0.25s;
}

.frame {
    fill: none;
    stroke: var(--circuit-ink);
    stroke-width: 2;
}

.ac-drawing .title {
    font-weight: 700;
}

.ac-drawing .inside {
    fill: #ffffff;
    font-weight: 700;
}

.ac-drawing .caption {
    fill: var(--circuit-soft);
    font-size: 12px;
}

.home path {
    fill: none;
    stroke: var(--circuit-edge);
    stroke-width: 1.5;
    stroke-linejoin: round;
}

.home.on path {
    fill: var(--circuit-link);
    stroke: var(--circuit-ink);
}

.numbers {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 32px;
    margin: 10px 0 0;
}

.numbers dt {
    color: var(--circuit-soft);
    font-size: 13px;
    font-weight: 600;
}

.numbers dd {
    margin: 0;
    font-size: 26px;
    font-weight: 700;
}

.numbers small {
    font-size: 14px;
    font-weight: 600;
}

@media (prefers-reduced-motion: reduce) {
    .home-share {
        transition: none;
    }
}
</style>
