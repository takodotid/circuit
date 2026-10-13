<script setup lang="ts">
// A word that can be looked up: dotted underline, and its meaning in a small note on hover, focus or tap.

import { nextTick, ref, useId, watch } from "vue";

defineProps<{
    /** What the word means, in one or two plain sentences. */
    means: string;
}>();

const id = useId();
const open = ref(false);
const note = ref<HTMLElement>();
const shift = ref(0);

// The note opens above the word, moved sideways as far as it takes to stay inside the window.
watch(open, async (now) => {
    if (!now) return;

    shift.value = 0;
    await nextTick();
    if (!note.value) return;

    const box = note.value.getBoundingClientRect();
    const gutter = 12;

    if (box.right > window.innerWidth - gutter) shift.value = window.innerWidth - gutter - box.right;
    if (box.left + shift.value < gutter) shift.value = gutter - box.left;
});
</script>

<template>
    <span class="term" @mouseenter="open = true" @mouseleave="open = false">
        <button
            type="button"
            class="word"
            :aria-describedby="id"
            :aria-expanded="open"
            @click="open = true"
            @focus="open = true"
            @blur="open = false"
            @keydown.esc="open = false"
        >
            <slot />
        </button>
        <span :id="id" ref="note" class="meaning" role="tooltip" :class="{ open }" :style="{ transform: `translateX(${shift}px)` }">{{
            means
        }}</span>
    </span>
</template>

<style scoped>
.term {
    position: relative;
    display: inline;
}

.word {
    display: inline;
    padding: 0;
    color: inherit;
    font: inherit;
    text-decoration: underline dotted 2px var(--circuit-link);
    text-underline-offset: 4px;
    cursor: help;
}

.meaning {
    position: absolute;
    left: 0;
    bottom: calc(100% + 8px);
    z-index: 30;
    width: max-content;
    max-width: min(320px, 80vw);
    padding: 10px 12px;
    border: 2px solid var(--circuit-navy);
    background: var(--circuit-paper);
    color: var(--circuit-ink);
    font-size: 14.5px;
    font-weight: 400;
    line-height: 1.5;
    text-align: left;
    white-space: normal;
    display: none;
    pointer-events: none;
}

.dark .meaning {
    border-color: var(--circuit-link);
}

.meaning.open {
    display: block;
    animation: appear 0.18s ease-out;
}

@keyframes appear {
    from {
        opacity: 0;
    }
}
</style>
