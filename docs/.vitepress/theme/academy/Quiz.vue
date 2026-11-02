<script setup lang="ts">
// One question with a few answers. A wrong pick says why it is wrong and lets the reader pick again; the right one explains itself.

import { computed, ref, useId } from "vue";

const props = defineProps<{
    question: string;
    choices: string[];
    /** The right choice, counted from 0. */
    answer: number;
    /** Why the right answer is right. The default slot can hold this instead, with markup. */
    explain?: string;
    /** For each choice, why it is wrong. Optional, and only read for the wrong ones. */
    why?: string[];
}>();

const id = useId();
const picked = ref<number>();
const tried = ref<number[]>([]);

const solved = computed(() => picked.value === props.answer);

function pick(index: number) {
    if (solved.value) return;

    picked.value = index;
    if (!tried.value.includes(index)) tried.value.push(index);
}

function state(index: number) {
    if (index === props.answer && solved.value) return "right";
    if (tried.value.includes(index) && index !== props.answer) return "wrong";
    return "";
}
</script>

<template>
    <fieldset class="quiz" :aria-describedby="`${id}-feedback`">
        <legend>
            <span class="chip">Check</span>
            <span class="question">{{ question }}</span>
        </legend>

        <div class="choices">
            <button
                v-for="(choice, index) in choices"
                :key="index"
                type="button"
                class="choice"
                :class="state(index)"
                :aria-pressed="picked === index"
                :disabled="solved && index !== answer"
                @click="pick(index)"
            >
                <span class="mark" aria-hidden="true">{{
                    state(index) === "right" ? "✓" : state(index) === "wrong" ? "✕" : String.fromCharCode(65 + index)
                }}</span>
                <span>{{ choice }}</span>
            </button>
        </div>

        <div :id="`${id}-feedback`" class="feedback" aria-live="polite">
            <p v-if="solved" class="right">
                <strong>Right.</strong>{{ " " }}
                <slot>{{ explain }}</slot>
            </p>
            <p v-else-if="picked !== undefined" class="wrong">
                <strong>Not quite.</strong>
                {{ why?.[picked] ?? "Have another look, and pick again." }}
            </p>
        </div>
    </fieldset>
</template>

<style scoped>
.quiz {
    margin: 28px 0;
    padding: 18px 22px 16px;
    border: 2px solid var(--circuit-ink);
    min-width: 0;
}

legend {
    display: contents;
}

.chip {
    display: inline-block;
    margin-bottom: 10px;
    padding: 2px 8px;
    background: var(--circuit-ink);
    color: var(--circuit-paper);
    font-size: 12px;
    font-weight: 700;
    font-stretch: 120%;
    letter-spacing: 0.1em;
    line-height: 20px;
    text-transform: uppercase;
}

.question {
    display: block;
    overflow-wrap: anywhere;
    margin-bottom: 14px;
    font-size: 18px;
    font-weight: 700;
    line-height: 1.4;
}

.choices {
    display: grid;
    gap: 8px;
}

.choice {
    display: flex;
    overflow-wrap: anywhere;
    align-items: flex-start;
    gap: 12px;
    min-height: 44px;
    padding: 10px 14px;
    border: 1.5px solid var(--circuit-line);
    border-radius: 2px;
    background: var(--circuit-paper);
    color: var(--circuit-ink);
    font-size: 16px;
    line-height: 1.45;
    text-align: left;
    transition:
        border-color 0.2s,
        background-color 0.2s;
}

.choice:hover:not(:disabled) {
    border-color: var(--circuit-link);
}

.choice:disabled {
    opacity: 0.55;
    cursor: default;
}

.mark {
    flex: none;
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: var(--circuit-mist);
    font-size: 13px;
    font-weight: 700;
}

.choice.right {
    border-color: var(--circuit-added);
    background: color-mix(in srgb, var(--circuit-added) 10%, var(--circuit-paper));
}

.choice.right .mark {
    background: var(--circuit-added);
    color: var(--circuit-paper);
}

.choice.wrong {
    border-color: var(--circuit-removed);
    border-style: dashed;
}

.choice.wrong .mark {
    background: var(--circuit-removed);
    color: var(--circuit-paper);
}

.feedback p {
    margin: 14px 0 2px;
    font-size: 16px;
    line-height: 1.6;
}

.feedback .right strong {
    color: var(--circuit-added);
}

.feedback .wrong strong {
    color: var(--circuit-removed);
}

@media (max-width: 640px) {
    .quiz {
        margin-inline: -8px;
        padding: 16px 14px 14px;
    }
}
</style>
