<script setup lang="ts">
// Lesson: counting like a computer. The reader flips eight switches to make a number from 0 to 255, or lets them count up one at a time. BitChallenges reuses it.

import { computed, onBeforeUnmount, ref } from "vue";
import { bitsOf, bitText, placeValues, sumText } from "./BitSwitches";

const props = defineProps<{
    /** The switches show a number to read and cannot be flipped. */
    locked?: boolean;
    /** Hide the total, so the reader works it out. */
    hideTotal?: boolean;
    /** Show the buttons that count up and down. */
    tools?: boolean;
}>();

const value = defineModel<number>({ default: 0 });

const bits = computed(() => bitsOf(value.value));
const said = ref<{ kind: "warn"; text: string }>();

function flip(index: number) {
    if (props.locked) return;
    stop();
    said.value = undefined;
    value.value = value.value ^ placeValues[index]!;
}

function addOne() {
    if (value.value === 255) {
        stop();
        said.value = {
            kind: "warn",
            text: "All eight switches are on: 255 is the most they can show. One more would need a ninth switch, worth 256.",
        };
        return false;
    }
    said.value = undefined;
    value.value++;
    return true;
}

function addOneByHand() {
    stop();
    addOne();
}

function takeOne() {
    stop();
    if (value.value === 0) {
        said.value = { kind: "warn", text: "All the switches are off: 0 is the least they can show." };
        return;
    }
    said.value = undefined;
    value.value--;
}

function set(to: number) {
    stop();
    said.value = undefined;
    value.value = to;
}

// Counting on its own: one more every 0.6 seconds, until 255 or the reader stops it.
const counting = ref(false);
let timer = 0;

function stop() {
    clearInterval(timer);
    counting.value = false;
}

function count() {
    if (counting.value) {
        stop();
        return;
    }
    if (value.value === 255) set(0);

    counting.value = true;
    timer = window.setInterval(() => {
        if (!addOne()) stop();
    }, 600);
}

onBeforeUnmount(stop);
</script>

<template>
    <div class="bit-switches">
        <div class="switches" role="group" aria-label="Eight switches, each worth twice the one to its right">
            <button
                v-for="(place, index) in placeValues"
                :key="place"
                type="button"
                class="switch"
                :class="{ on: bits[index] }"
                :aria-pressed="locked ? undefined : bits[index] === 1"
                :aria-label="`Worth ${place}: ${bits[index] ? 'on' : 'off'}`"
                :disabled="locked"
                @click="flip(index)"
            >
                <span class="place">{{ place }}</span>
                <span class="lamp" aria-hidden="true" />
                <span class="digit" aria-hidden="true">{{ bits[index] }}</span>
            </button>
        </div>

        <p v-if="!hideTotal" class="total" aria-live="polite">
            <span class="ac-mono">{{ bitText(value) }}</span>
            <span class="equals">=</span>
            <span>{{ sumText(value) }}</span>
            <span class="equals">=</span>
            <strong>{{ value }}</strong>
        </p>
        <p v-else class="total">
            <span class="ac-mono">{{ bitText(value) }}</span>
        </p>

        <div v-if="tools" class="ac-row tools">
            <button type="button" class="ac-button primary" @click="count">{{ counting ? "Stop counting" : "Count up on its own" }}</button>
            <button type="button" class="ac-button small" @click="addOneByHand">Add one</button>
            <button type="button" class="ac-button small" @click="takeOne">Take one away</button>
            <button type="button" class="ac-button small" @click="set(0)">All off</button>
            <button type="button" class="ac-button small" @click="set(255)">All on</button>
        </div>

        <p v-if="said" class="ac-say warn" data-word="Limit" aria-live="polite">{{ said.text }}</p>
    </div>
</template>

<style scoped>
.switches {
    display: grid;
    grid-template-columns: repeat(8, minmax(0, 1fr));
    gap: 6px;
}

.switch {
    display: grid;
    justify-items: center;
    gap: 6px;
    min-height: 96px;
    padding: 8px 2px 6px;
    border: 1.5px solid var(--circuit-ink);
    border-radius: 2px;
    background: var(--circuit-paper);
    color: var(--circuit-ink);
    transition:
        background-color 0.2s,
        border-color 0.2s;
}

.switch:hover:not(:disabled) {
    border-color: var(--circuit-link);
}

.switch:disabled {
    cursor: default;
}

.switch.on {
    border-color: var(--circuit-cobalt);
    background: var(--circuit-cobalt);
    color: #ffffff;
}

.place {
    font-size: 13px;
    font-weight: 700;
}

.lamp {
    width: 22px;
    height: 22px;
    border: 2px solid var(--circuit-edge);
    border-radius: 50%;
    transition: background-color 0.2s;
}

.on .lamp {
    border-color: #0a1a36;
    background: var(--circuit-yellow);
}

.digit {
    font-family: var(--circuit-mono);
    font-size: 22px;
    font-weight: 700;
    line-height: 1;
}

.total {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px 10px;
    margin: 14px 0 0;
    font-size: 17px;
}

.total .ac-mono {
    font-size: 18px;
    letter-spacing: 0.08em;
}

.total strong {
    font-size: 24px;
}

.equals {
    color: var(--circuit-soft);
}

.tools {
    margin-top: 14px;
}

@media (max-width: 480px) {
    .switches {
        grid-template-columns: repeat(4, minmax(0, 1fr));
    }

    .switch {
        min-height: 84px;
    }
}

@media (prefers-reduced-motion: reduce) {
    .switch,
    .lamp {
        transition: none;
    }
}
</style>
