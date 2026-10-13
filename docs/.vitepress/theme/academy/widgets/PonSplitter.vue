<script setup lang="ts">
// Lesson: reaching the customer. The reader sets a GPON splitter's size, the homes' plan and how many homes are busy, and sees how the fibre's capacity is shared between them.

import { computed, ref } from "vue";

/** GPON's line rates, in Mbit/s, before the overheads that leave a little less for the homes. */
const DOWN = 2488;
const UP = 1244;

const SIZES = [32, 64] as const;
const split = ref<(typeof SIZES)[number]>(32);
const plan = ref(300);
const busy = ref(4);

const busyNow = computed(() => Math.min(busy.value, split.value));
const down = computed(() => Math.min(plan.value, DOWN / busyNow.value));
const up = computed(() => UP / busyNow.value);

const SPLITTER = [250, 170] as const;
const columns = 8;

const homes = computed(() => {
    const rows = split.value / columns;
    const gap = Math.min(36, 260 / rows);
    const top = 170 - ((rows - 1) * gap) / 2;
    return Array.from({ length: split.value }, (_, index) => ({
        index,
        busy: index < busyNow.value,
        x: 360 + (index % columns) * 42,
        y: top + Math.floor(index / columns) * gap,
    }));
});

const shown = (rate: number) => (rate >= 100 ? String(Math.round(rate)) : rate.toFixed(1));

function setSplit(size: (typeof SIZES)[number]) {
    split.value = size;
    busy.value = Math.min(busy.value, size);
}

const said = computed(() => {
    const asked = busyNow.value * plan.value;

    if (asked <= DOWN)
        return {
            kind: "good",
            word: "Full plan",
            text: `${busyNow.value} busy ${busyNow.value === 1 ? "home asks" : "homes ask"} for ${asked} Mbit/s down, and the fibre carries about ${DOWN}. Each gets its full ${plan.value} Mbit/s.`,
        };

    return {
        kind: "warn",
        word: "Shared",
        text: `${busyNow.value} busy homes ask for ${asked} Mbit/s down, more than the ${DOWN} the fibre carries. Shared evenly, each gets at most ${shown(down.value)} Mbit/s, until some of them finish.`,
    };
});
</script>

<template>
    <div class="pon-splitter">
        <div class="controls">
            <div class="ac-field">
                <span>Homes on one splitter</span>
                <div class="ac-row">
                    <button
                        v-for="size in SIZES"
                        :key="size"
                        type="button"
                        class="ac-button small"
                        :aria-pressed="split === size"
                        @click="setSplit(size)"
                    >
                        1 to {{ size }}
                    </button>
                </div>
            </div>
            <label class="ac-field">
                <span>Each home's plan, "up to"</span>
                <select v-model.number="plan" class="ac-select">
                    <option v-for="rate in [100, 300, 1000]" :key="rate" :value="rate">{{ rate }} Mbit/s</option>
                </select>
            </label>
            <label class="ac-field">
                <span>Homes busy now: {{ busyNow }} of {{ split }}</span>
                <input v-model.number="busy" class="range" type="range" min="1" :max="split" step="1" />
            </label>
        </div>

        <svg
            class="ac-drawing"
            viewBox="0 0 700 330"
            role="img"
            :aria-label="`A GPON tree: the OLT, one fibre to a 1 to ${split} splitter, and ${split} homes, ${busyNow} of them busy.`"
        >
            <line
                v-for="home in homes"
                :key="`f${home.index}`"
                class="drop"
                :class="{ lit: home.busy }"
                :x1="SPLITTER[0]"
                :y1="SPLITTER[1]"
                :x2="home.x - 12"
                :y2="home.y"
            />
            <line class="cable lit" x1="90" :y1="SPLITTER[1]" :x2="SPLITTER[0]" :y2="SPLITTER[1]" />
            <text class="caption" x="170" :y="SPLITTER[1] - 12" text-anchor="middle">one fibre</text>

            <SvgDevice kind="router" :x="60" :y="SPLITTER[1]" label="OLT" note="at the provider" />
            <path class="splitter" :d="`M${SPLITTER[0] - 14} ${SPLITTER[1] - 18}v36l28 -18z`" />
            <text class="caption" :x="SPLITTER[0]" :y="SPLITTER[1] + 38" text-anchor="middle">splitter</text>
            <text class="caption" :x="SPLITTER[0]" :y="SPLITTER[1] + 52" text-anchor="middle">no power</text>

            <g v-for="home in homes" :key="home.index" class="home" :class="{ on: home.busy }">
                <path :d="`M${home.x - 10} ${home.y + 7}v-9l10 -8l10 8v9z`" />
            </g>
            <text class="caption" x="360" y="320">an ONT in each home; filled: busy now</text>
        </svg>

        <dl class="numbers">
            <div>
                <dt>Down, each busy home</dt>
                <dd>{{ shown(down) }} <small>Mbit/s</small></dd>
            </div>
            <div>
                <dt>Up, if they all send at once</dt>
                <dd>{{ shown(up) }} <small>Mbit/s</small></dd>
            </div>
        </dl>

        <p class="ac-say" :class="said.kind" :data-word="said.word" aria-live="polite">{{ said.text }}</p>
    </div>
</template>

<style scoped>
.controls {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: 14px 24px;
    margin-bottom: 8px;
}

.range {
    width: min(260px, 100%);
    min-height: 40px;
    accent-color: var(--circuit-cobalt);
}

.drop {
    stroke: var(--circuit-edge);
    stroke-width: 1;
    opacity: 0.45;
}

.drop.lit {
    stroke: var(--circuit-link);
    stroke-width: 1.5;
    opacity: 1;
}

.splitter {
    fill: var(--circuit-paper);
    stroke: var(--circuit-ink);
    stroke-width: 2;
    stroke-linejoin: round;
}

.ac-drawing .caption {
    fill: var(--circuit-soft);
    font-size: 12px;
}

.home path {
    fill: var(--circuit-paper);
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
</style>
