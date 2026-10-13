<script setup lang="ts">
// Lesson: counting like a computer. Two counters count up together, one with wheels of ten digits and one with wheels of two, so the reader sees the same push to the next wheel happen in both.

import { computed, onBeforeUnmount, ref } from "vue";

const LAST = 255;

const count = ref(0);

// The wheels that turned on the last step, counted from the right, so they can be marked.
const turned = ref<{ ten: number; two: number }>({ ten: 0, two: 0 });
const said = ref<{ kind: "good" | "warn"; word: string; text: string }>();

/** A number's digits on a counter with this many wheels, the leftmost first. */
const wheels = (value: number, base: number, size: number) =>
    Array.from({ length: size }, (_, index) => Math.floor(value / base ** (size - 1 - index)) % base);

const tens = computed(() => wheels(count.value, 10, 3));
const twos = computed(() => wheels(count.value, 2, 8));

/** How many wheels turn when a counter goes one up from this number: the rightmost one, and one more for each wheel it pushes. */
function wheelsTurning(value: number, base: number) {
    let turning = 1;
    while (value % base === base - 1) {
        turning++;
        value = Math.floor(value / base);
    }
    return turning;
}

/** Words for what one step did on a counter. */
function story(turning: number, last: string) {
    if (turning === 1) return "only the right wheel turned";
    const pushed = turning - 1;
    return `the right wheel went past ${last}, back to 0, and pushed the next wheel${pushed > 1 ? `, which went round too: ${pushed} pushes in a row` : ""}`;
}

function step() {
    if (count.value === LAST) {
        stop();
        said.value = {
            kind: "warn",
            word: "Full",
            text: "The two-digit counter shows 11111111, all eight wheels at their last digit. One more would push past the leftmost wheel, and there is no ninth wheel to push.",
        };
        return;
    }

    const ten = wheelsTurning(count.value, 10);
    const two = wheelsTurning(count.value, 2);

    count.value++;
    turned.value = { ten, two };
    said.value = {
        kind: "good",
        word: "One more",
        text: `On the ten-digit counter ${story(ten, "9")}. On the two-digit counter ${story(two, "1")}.`,
    };
}

function addOne() {
    stop();
    step();
}

function reset() {
    stop();
    count.value = 0;
    turned.value = { ten: 0, two: 0 };
    said.value = undefined;
}

// Counting on its own: one more every 0.8 seconds, until the two-digit counter is full or the reader stops it.
const running = ref(false);
let timer = 0;

function stop() {
    clearInterval(timer);
    running.value = false;
}

function run() {
    if (running.value) {
        stop();
        return;
    }

    if (count.value === LAST) reset();

    running.value = true;
    timer = window.setInterval(() => {
        step();
        if (count.value === LAST) stop();
    }, 800);
}

onBeforeUnmount(stop);

/** Whether a wheel, counted from the left, turned on the last step. */
const moved = (size: number, index: number, turning: number) => size - 1 - index < turning;
</script>

<template>
    <div class="odometer">
        <div class="counters">
            <figure class="counter">
                <figcaption>
                    <strong>Ten digits</strong>
                    each wheel shows 0 to 9
                </figcaption>
                <div class="wheels" :aria-label="`Ten-digit counter: ${tens.join('')}`" role="img">
                    <span
                        v-for="(digit, index) in tens"
                        :key="`${index}-${digit}`"
                        class="wheel"
                        :class="{ moved: moved(3, index, turned.ten) }"
                    >
                        {{ digit }}
                    </span>
                </div>
            </figure>

            <figure class="counter">
                <figcaption>
                    <strong>Two digits</strong>
                    each wheel shows 0 or 1
                </figcaption>
                <div class="wheels" :aria-label="`Two-digit counter: ${twos.join('')}`" role="img">
                    <span
                        v-for="(digit, index) in twos"
                        :key="`${index}-${digit}`"
                        class="wheel"
                        :class="{ moved: moved(8, index, turned.two) }"
                    >
                        {{ digit }}
                    </span>
                </div>
            </figure>
        </div>

        <p class="reading">
            Both show the number <strong>{{ count }}</strong>
        </p>

        <div class="ac-row">
            <button type="button" class="ac-button primary" @click="addOne">Add one</button>
            <button type="button" class="ac-button" @click="run">{{ running ? "Stop" : "Count on its own" }}</button>
            <button type="button" class="ac-button" :disabled="count === 0" @click="reset">Back to 0</button>
        </div>

        <p v-if="said" class="ac-say" :class="said.kind" :data-word="said.word" aria-live="polite">{{ said.text }}</p>
        <p v-else class="ac-say hint" aria-live="polite">Press Add one a few times, and watch which wheels turn on each counter.</p>
    </div>
</template>

<style scoped>
.counters {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 18px 28px;
    align-items: end;
}

.counter {
    margin: 0;
    min-width: 0;
}

figcaption {
    margin-bottom: 8px;
    color: var(--circuit-soft);
    font-size: 13.5px;
    line-height: 1.4;
}

figcaption strong {
    display: block;
    color: var(--circuit-ink);
    font-size: 15px;
}

.wheels {
    display: flex;
    gap: 4px;
}

.wheel {
    display: grid;
    place-items: center;
    width: 38px;
    height: 52px;
    border: 2px solid var(--circuit-ink);
    border-radius: 2px;
    background: var(--circuit-paper);
    color: var(--circuit-ink);
    font: 700 24px/1 var(--circuit-mono);
    transition: background-color 0.3s;
}

.wheel.moved {
    background: var(--circuit-yellow);
    color: #0a1a36;
}

.reading {
    margin: 16px 0 12px !important;
    font-size: 16px;
}

.hint {
    color: var(--circuit-soft);
}

@media (prefers-reduced-motion: no-preference) {
    .wheel.moved {
        animation: roll 0.35s cubic-bezier(0.16, 1, 0.3, 1);
    }
}

@keyframes roll {
    from {
        transform: translateY(-30%);
        opacity: 0.2;
    }
}

@media (max-width: 640px) {
    .counters {
        grid-template-columns: minmax(0, 1fr);
    }

    .wheel {
        width: calc((100vw - 80px) / 8 - 4px);
        max-width: 38px;
        height: 46px;
        font-size: 20px;
    }
}
</style>
