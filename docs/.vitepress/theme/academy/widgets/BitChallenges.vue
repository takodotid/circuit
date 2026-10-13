<script setup lang="ts">
// Lesson: counting like a computer. Nine challenges: make a number with the eight switches, read a number from them, and find the one number they cannot make.

import { computed, ref } from "vue";
import BitSwitches from "./BitSwitches.vue";
import { bitText, sumText } from "./BitSwitches";

type Challenge = { kind: "make"; target: number } | { kind: "read"; value: number };

const challenges: Challenge[] = [
    { kind: "make", target: 1 },
    { kind: "make", target: 8 },
    { kind: "make", target: 10 },
    { kind: "make", target: 192 },
    { kind: "read", value: 168 },
    { kind: "read", value: 15 },
    { kind: "make", target: 100 },
    { kind: "make", target: 255 },
    { kind: "make", target: 256 },
];

const index = ref(0);
const value = ref(0);
const answer = ref("");
const showTotal = ref(false);
const solved = ref(false);
const said = ref<{ kind: "good" | "bad"; word: string; text: string }>();

const challenge = computed(() => challenges[index.value]!);
const finished = computed(() => solved.value && index.value === challenges.length - 1);
const possible = (target: number) => target <= 255;

/** What the switches show: the reader's own for a number to make, the number to read for the rest. */
const shown = computed({
    get: () => (challenge.value.kind === "read" ? challenge.value.value : value.value),
    set: (next: number) => {
        value.value = next;
        if (!solved.value) said.value = undefined;
    },
});

const prompt = computed(() => {
    const now = challenge.value;
    if (now.kind === "read") return `What number is ${bitText(now.value)}?`;
    if (now.target === 256) return "Make 256.";
    if (now.target === 192) return "Make 192. Many home networks have addresses that start with it.";
    return `Make ${now.target}.`;
});

function right(text: string) {
    solved.value = true;
    said.value = { kind: "good", word: "Right", text };
}

function wrong(text: string) {
    said.value = { kind: "bad", word: "Not yet", text };
}

function check() {
    const now = challenge.value;

    if (now.kind === "read") {
        const typed = answer.value.trim();
        if (!/^\d+$/.test(typed)) return wrong("Type the number as digits first, such as 42.");
        if (Number(typed) === now.value) return right(`${bitText(now.value)} is ${sumText(now.value)}, which is ${now.value}.`);
        return wrong(`It is not ${typed}. Add up the numbers above the switches that are on.`);
    }

    if (!possible(now.target)) {
        if (value.value === 255)
            return wrong("That is 255, with every switch on. There is no switch left to turn on. What does that tell you?");
        return wrong(`That is ${value.value}. Keep going, or decide whether it can be done at all.`);
    }

    if (value.value === now.target) return right(`${now.target} is ${sumText(now.target)}, written ${bitText(now.target)}.`);

    const gap = now.target - value.value;
    const what = value.value === 0 ? "All the switches are off, which is 0." : `That is ${value.value} (${sumText(value.value)}).`;
    return wrong(`${what} ${now.target} is ${Math.abs(gap)} ${gap > 0 ? "more" : "less"}.`);
}

function cannot() {
    const now = challenge.value;
    if (now.kind === "make" && !possible(now.target)) {
        return right(
            "Eight switches make at most 255, when all of them are on. 256 would need a ninth switch, worth 256. So one group of eight bits holds 256 different numbers, 0 to 255, and never more."
        );
    }
    return wrong("It can be done with these eight switches. Try the hint.");
}

const hint = ref(false);

const hintText = computed(() => {
    const now = challenge.value;
    if (now.kind === "read") return "Add up the numbers above the switches that are on. A switch that is off adds nothing.";
    if (!possible(now.target)) return "Turn every switch on and look at the total. Is there anything left to turn on?";
    return `Start from the left: turn on the biggest switch that is not more than ${now.target}, take its value away, and do the same with what is left until nothing is left.`;
});

function go(next: number) {
    index.value = next;
    value.value = 0;
    answer.value = "";
    solved.value = false;
    hint.value = false;
    said.value = undefined;
}
</script>

<template>
    <div class="bit-challenges">
        <ol class="progress" aria-label="Challenges">
            <li
                v-for="(entry, number) in challenges"
                :key="number"
                :class="{ now: number === index, done: number < index || (number === index && solved) }"
            >
                <span class="ac-hidden"
                    >Challenge {{ number + 1
                    }}{{ number < index || (number === index && solved) ? ", done" : number === index ? ", now" : "" }}</span
                >
            </li>
        </ol>

        <p class="count">Challenge {{ index + 1 }} of {{ challenges.length }}</p>
        <p class="prompt">{{ prompt }}</p>

        <BitSwitches
            v-model="shown"
            :locked="challenge.kind === 'read' || solved"
            :hide-total="challenge.kind === 'read' ? !solved : !showTotal && !solved"
        />

        <div class="ac-row answer">
            <template v-if="challenge.kind === 'read'">
                <label class="ac-field">
                    <span>The number</span>
                    <input v-model="answer" class="ac-input mono" inputmode="numeric" :disabled="solved" @keydown.enter="check" />
                </label>
                <button type="button" class="ac-button primary" :disabled="solved" @click="check">Check</button>
            </template>
            <template v-else>
                <button type="button" class="ac-button primary" :disabled="solved" @click="check">Check</button>
                <button type="button" class="ac-button" :disabled="solved" @click="cannot">It cannot be done</button>
                <button type="button" class="ac-button small" :aria-pressed="showTotal" :disabled="solved" @click="showTotal = !showTotal">
                    Show the total: {{ showTotal ? "on" : "off" }}
                </button>
            </template>
            <button v-if="!solved" type="button" class="ac-button small" :aria-pressed="hint" @click="hint = !hint">Hint</button>
        </div>

        <p v-if="hint && !solved" class="hint-text">{{ hintText }}</p>

        <p v-if="said" class="ac-say" :class="said.kind" :data-word="said.word" aria-live="polite">{{ said.text }}</p>
        <p v-else class="ac-say quiet" aria-live="polite">
            {{
                challenge.kind === "read" ? "Type the number the switches show, then press Check." : "Flip the switches, then press Check."
            }}
        </p>

        <div v-if="solved" class="ac-row next">
            <button v-if="!finished" type="button" class="ac-button primary" @click="go(index + 1)">Next challenge</button>
            <template v-else>
                <p class="finished">
                    All {{ challenges.length }} done. You can read and write every number a group of eight bits can hold.
                </p>
                <button type="button" class="ac-button" @click="go(0)">Start again</button>
            </template>
        </div>
    </div>
</template>

<style scoped>
.progress {
    display: flex;
    gap: 6px;
    margin: 0 0 10px !important;
    padding: 0 !important;
    list-style: none;
}

.progress li {
    width: 12px;
    height: 12px;
    margin: 0 !important;
    border: 2px solid var(--circuit-soft);
    border-radius: 50%;
}

.progress li.done {
    border-color: var(--circuit-link);
    background: var(--circuit-link);
}

.progress li.now {
    border-color: var(--circuit-ink);
    background: var(--circuit-yellow);
}

.count {
    margin: 0;
    color: var(--circuit-soft);
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
}

.prompt {
    margin: 2px 0 14px;
    font-size: 19px;
    font-weight: 700;
    line-height: 1.4;
}

.answer {
    align-items: end;
    margin-top: 14px;
}

.answer .ac-input {
    width: 120px;
}

.hint-text {
    margin: 12px 0 0;
    padding: 8px 12px;
    border-left: 3px solid var(--circuit-link);
    background: var(--circuit-mist);
    font-size: 15px;
    line-height: 1.55;
}

.quiet {
    color: var(--circuit-soft);
}

.next {
    margin-top: 12px;
}

.finished {
    flex-basis: 100%;
    margin: 0;
    font-weight: 700;
}
</style>
