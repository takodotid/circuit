<script setup lang="ts">
// Lesson: IPv6. The reader shortens full addresses by hand and has each answer checked against the standard rules, or types any address to see it written in full, step by step.

import { computed, ref } from "vue";
import { differences, expand, longestZeroRun, parseIPv6, same, shorten } from "./Ipv6Shorten";

const challenges = [
    "2001:0db8:0000:0000:0000:ff00:0042:8329",
    "2001:0DB8:0000:0001:0000:0000:0000:0001",
    "2001:0db8:0000:0000:0001:0000:0000:0001",
    "2001:0db8:0000:0001:0001:0001:0001:0001",
    "fe80:0000:0000:0000:02a0:c9ff:fe12:3456",
    "0000:0000:0000:0000:0000:0000:0000:0001",
];

const mode = ref<"shorten" | "expand">("shorten");

// Shortening a challenge.
const index = ref(0);
const answer = ref("");
const checked = ref(false);
const showSteps = ref(false);

const challenge = computed(() => (parseIPv6(challenges[index.value]!) as { groups: number[] }).groups);

const verdict = computed(() => {
    if (!checked.value) return undefined;

    const parsed = parseIPv6(answer.value);
    if ("error" in parsed) return { kind: "bad", word: "Not an address", text: parsed.error };

    if (!same(parsed.groups, challenge.value)) {
        return {
            kind: "bad",
            word: "Different address",
            text: `That is another address. Written in full, yours is ${expand(parsed.groups)}.`,
        };
    }

    const reasons = differences(answer.value, challenge.value);
    if (!reasons.length) return { kind: "good", word: "Right", text: `${shorten(challenge.value)} is the standard short form.` };

    return { kind: "warn", word: "Same address", text: `It is the same address, but not its standard short form. ${reasons.join(" ")}` };
});

function check() {
    checked.value = true;
}

function next() {
    index.value = (index.value + 1) % challenges.length;
    answer.value = "";
    checked.value = false;
    showSteps.value = false;
}

// Expanding any address.
const typed = ref("2001:db8::1");
const typedParsed = computed(() => parseIPv6(typed.value));

/** The address the steps are drawn for: the challenge, or what the reader typed. */
const shown = computed(() => {
    if (mode.value === "shorten") return showSteps.value ? challenge.value : undefined;
    const parsed = typedParsed.value;
    return "groups" in parsed ? parsed.groups : undefined;
});

const run = computed(() => (shown.value ? longestZeroRun(shown.value) : undefined));
const inRun = (position: number) => run.value !== undefined && position >= run.value.start && position < run.value.start + run.value.length;

/** The group whose bits are shown under the steps. */
const bitsOf = ref(1);

const digits = computed(() => {
    if (!shown.value) return [];
    const group = shown.value[bitsOf.value]!.toString(16).padStart(4, "0");
    return [...group].map((digit) => ({ digit, bits: parseInt(digit, 16).toString(2).padStart(4, "0") }));
});

const runText = computed(() => {
    if (!run.value) return "There is no run of two or more zero groups, so there is nothing to replace with ::.";
    const where = run.value.length === 8 ? "every group" : `groups ${run.value.start + 1} to ${run.value.start + run.value.length}`;
    return `The longest run of zero groups is ${where}. It becomes ::.`;
});

function setMode(next: "shorten" | "expand") {
    mode.value = next;
    bitsOf.value = 1;
}
</script>

<template>
    <div class="ipv6-shorten">
        <div class="ac-row" role="group" aria-label="What to do">
            <button type="button" class="ac-button small" :aria-pressed="mode === 'shorten'" @click="setMode('shorten')">
                Shorten it yourself
            </button>
            <button type="button" class="ac-button small" :aria-pressed="mode === 'expand'" @click="setMode('expand')">
                Write any address in full
            </button>
        </div>

        <template v-if="mode === 'shorten'">
            <p class="count">Address {{ index + 1 }} of {{ challenges.length }}</p>
            <p class="full ac-mono">{{ challenges[index] }}</p>

            <form class="ac-row answer" @submit.prevent="check">
                <label class="ac-field grow">
                    <span>Its short form</span>
                    <input
                        v-model="answer"
                        class="ac-input mono"
                        autocomplete="off"
                        spellcheck="false"
                        placeholder="2001:db8::..."
                        @input="checked = false"
                    />
                </label>
                <button type="submit" class="ac-button primary">Check</button>
                <button type="button" class="ac-button" :aria-pressed="showSteps" @click="showSteps = !showSteps">
                    {{ showSteps ? "Hide the steps" : "Show the steps" }}
                </button>
                <button type="button" class="ac-button" @click="next">Next address</button>
            </form>

            <p v-if="verdict" class="ac-say" :class="verdict.kind" :data-word="verdict.word" aria-live="polite">{{ verdict.text }}</p>
            <p v-else class="ac-say hint" aria-live="polite">
                Drop the leading zeros of each group, then write the longest run of zero groups as ::. Type your answer and check it.
            </p>
        </template>

        <template v-else>
            <label class="ac-field typed">
                <span>An IPv6 address, written any way</span>
                <input v-model="typed" class="ac-input mono" autocomplete="off" spellcheck="false" :aria-invalid="'error' in typedParsed" />
            </label>
            <p v-if="'error' in typedParsed" class="ac-say bad" data-word="Not an address" aria-live="polite">{{ typedParsed.error }}</p>
            <p v-else class="ac-say good" data-word="In full" aria-live="polite">{{ expand(typedParsed.groups) }}</p>
        </template>

        <ol v-if="shown" class="steps">
            <li>
                <span class="step-name">All eight groups of four digits, 16 bits each. Pick a group to see its bits.</span>
                <span class="groups">
                    <button
                        v-for="(group, position) in shown"
                        :key="position"
                        type="button"
                        class="group ac-mono"
                        :class="{ chosen: bitsOf === position }"
                        :aria-pressed="bitsOf === position"
                        @click="bitsOf = position"
                    >
                        {{ group.toString(16).padStart(4, "0") }}
                    </button>
                </span>
                <span class="hex">
                    <span v-for="(entry, position) in digits" :key="position" class="hex-digit">
                        <span class="ac-mono">{{ entry.digit }}</span>
                        <span class="ac-hidden">&nbsp;is&nbsp;</span>
                        <span class="ac-mono bits">{{ entry.bits }}</span>
                    </span>
                </span>
            </li>
            <li>
                <span class="step-name">Drop the zeros at the start of each group. A group of zeros becomes 0.</span>
                <span class="groups">
                    <span v-for="(group, position) in shown" :key="position" class="group ac-mono" :class="{ zero: inRun(position) }">{{
                        group.toString(16)
                    }}</span>
                </span>
            </li>
            <li>
                <span class="step-name">{{ runText }}</span>
                <span class="result ac-mono">{{ shorten(shown) }}</span>
            </li>
        </ol>
    </div>
</template>

<style scoped>
.count {
    margin: 16px 0 0;
    color: var(--circuit-soft);
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
}

.full {
    margin: 4px 0 0;
    font-size: 17px !important;
    overflow-wrap: anywhere;
}

.answer {
    align-items: end;
    margin-top: 12px;
}

.grow {
    flex: 1 1 260px;
}

.grow .ac-input,
.typed .ac-input {
    width: 100%;
}

.typed {
    margin-top: 16px;
}

.hint {
    color: var(--circuit-soft);
}

.steps {
    display: grid;
    gap: 14px;
    margin: 18px 0 0 !important;
    padding: 14px 14px 14px 36px !important;
    background: var(--circuit-mist);
}

.steps li {
    display: grid;
    gap: 6px;
    margin: 0 !important;
}

.step-name {
    font-size: 14.5px;
    line-height: 1.5;
}

.groups {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
}

.group {
    min-width: 3.4em;
    padding: 4px 6px;
    border: 1.5px solid var(--circuit-line);
    border-radius: 2px;
    background: var(--circuit-paper);
    color: var(--circuit-ink);
    text-align: center;
}

button.group {
    min-height: 40px;
    cursor: pointer;
}

button.group:hover {
    border-color: var(--circuit-link);
}

.group.chosen {
    border-color: var(--circuit-cobalt);
    background: var(--circuit-cobalt);
    color: #ffffff;
}

.group.zero {
    border-color: var(--circuit-ink);
    border-style: dashed;
    background: var(--circuit-yellow);
    color: #0a1a36;
}

.hex {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
}

.hex-digit {
    display: grid;
    justify-items: center;
}

.bits {
    color: var(--circuit-soft);
}

.result {
    font-size: 17px !important;
    font-weight: 700;
    overflow-wrap: anywhere;
}
</style>
