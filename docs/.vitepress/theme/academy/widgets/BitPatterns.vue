<script setup lang="ts">
// Lesson: counting like a computer. The reader adds switches one at a time and sees every pattern they can make: each new switch takes every old pattern twice, once off and once on.

import { computed, ref } from "vue";

const switches = ref(2);

/** Every pattern of this many switches, as bits from the left, with the number it stands for. */
const patterns = (size: number) =>
    Array.from({ length: 2 ** size }, (_, value) => ({
        value,
        bits: Array.from({ length: size }, (_, index) => (value >> (size - 1 - index)) & 1),
    }));

const all = computed(() => patterns(switches.value));
const half = computed(() => all.value.length / 2);

// The patterns with the newest switch, on the left, off, and then on.
const groups = computed(() =>
    switches.value === 1
        ? [{ title: "", rows: all.value }]
        : [
              { title: "New switch off", rows: all.value.slice(0, half.value) },
              { title: "New switch on", rows: all.value.slice(half.value) },
          ]
);

const sum = computed(() => Array.from({ length: switches.value }, () => "2").join(" × "));
</script>

<template>
    <div class="bit-patterns">
        <div class="ac-row" role="group" aria-label="How many switches">
            <button
                v-for="size in 4"
                :key="size"
                type="button"
                class="ac-button small"
                :aria-pressed="switches === size"
                @click="switches = size"
            >
                {{ size }} {{ size === 1 ? "switch" : "switches" }}
            </button>
        </div>

        <div class="groups" :class="{ single: switches === 1 }">
            <section v-for="group in groups" :key="group.title" class="group">
                <p v-if="group.title" class="group-title">{{ group.title }}</p>
                <ol>
                    <li v-for="row in group.rows" :key="row.value">
                        <span class="bits" :aria-label="row.bits.join('')">
                            <span
                                v-for="(bit, index) in row.bits"
                                :key="index"
                                class="bit"
                                :class="{ on: bit === 1, newest: switches > 1 && index === 0 }"
                            >
                                {{ bit }}
                            </span>
                        </span>
                        <span class="value">is {{ row.value }}</span>
                    </li>
                </ol>
            </section>
        </div>

        <p class="ac-say good" data-word="Patterns" aria-live="polite">
            <template v-if="switches === 1">One switch makes 2 patterns: off and on. They stand for 0 and 1.</template>
            <template v-else>
                {{ switches }} switches make {{ sum }} = <strong>{{ all.length }}</strong> patterns. The {{ half }} patterns of
                {{ switches - 1 === 1 ? "one switch" : `${switches - 1} switches` }} appear twice, once with the new switch off and once
                with it on. The first stands for 0, so the last is {{ all.length - 1 }}.
            </template>
        </p>
    </div>
</template>

<style scoped>
.groups {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, max-content));
    gap: 12px 36px;
    margin-top: 16px;
}

.group-title {
    margin: 0 0 6px !important;
    color: var(--circuit-soft);
    font-size: 12px !important;
    font-weight: 700;
    font-stretch: 115%;
    letter-spacing: 0.08em;
    text-transform: uppercase;
}

ol {
    display: grid;
    gap: 6px;
    margin: 0 !important;
    padding: 0 !important;
    list-style: none;
}

li {
    display: flex;
    align-items: center;
    gap: 12px;
    margin: 0 !important;
}

.bits {
    display: flex;
    gap: 3px;
}

.bit {
    display: grid;
    place-items: center;
    width: 26px;
    height: 30px;
    border: 1.5px solid var(--circuit-ink);
    border-radius: 2px;
    font: 700 15px/1 var(--circuit-mono);
}

.bit.on {
    background: var(--circuit-cobalt);
    border-color: var(--circuit-cobalt);
    color: #ffffff;
}

.bit.newest {
    outline: 3px solid var(--circuit-yellow);
    outline-offset: 1px;
}

.value {
    color: var(--circuit-soft);
    font-size: 14.5px;
    white-space: nowrap;
}

@media (max-width: 480px) {
    .groups {
        grid-template-columns: minmax(0, 1fr);
    }
}
</style>
