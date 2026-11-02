<script setup lang="ts">
// A sequence the reader steps through at their own pace: a drawing in the slot that follows the step, and what happens in words under it.

import { computed, ref } from "vue";

const props = defineProps<{
    steps: { title: string; text: string }[];
}>();

const emit = defineEmits<{ change: [step: number] }>();

const step = ref(0);
const current = computed(() => props.steps[step.value]!);

function go(next: number) {
    step.value = Math.max(0, Math.min(props.steps.length - 1, next));
    emit("change", step.value);
}

defineExpose({ go, step });
</script>

<template>
    <div class="step-through" @keydown.left="go(step - 1)" @keydown.right="go(step + 1)">
        <div class="stage">
            <slot :step="step" :current="current" />
        </div>

        <div class="caption" aria-live="polite">
            <p class="count">Step {{ step + 1 }} of {{ steps.length }}</p>
            <p class="title">{{ current.title }}</p>
            <p class="text">{{ current.text }}</p>
        </div>

        <div class="controls">
            <button type="button" class="ac-button" :disabled="step === 0" @click="go(step - 1)">Back</button>
            <ol class="dots" aria-label="Steps">
                <li v-for="(entry, index) in steps" :key="index">
                    <button
                        type="button"
                        :class="{ now: index === step, seen: index < step }"
                        :aria-label="`Step ${index + 1}: ${entry.title}`"
                        :aria-current="index === step ? 'step' : undefined"
                        @click="go(index)"
                    />
                </li>
            </ol>
            <button v-if="step < steps.length - 1" type="button" class="ac-button primary" @click="go(step + 1)">Next step</button>
            <button v-else type="button" class="ac-button" @click="go(0)">Start over</button>
        </div>
    </div>
</template>

<style scoped>
.stage {
    min-height: 120px;
}

.caption {
    margin-top: 14px;
    padding-top: 14px;
    border-top: 1px solid var(--circuit-line);
}

.caption p {
    margin: 0;
}

.count {
    color: var(--circuit-soft);
    font-size: 12px !important;
    font-weight: 700;
    font-stretch: 115%;
    letter-spacing: 0.08em;
    text-transform: uppercase;
}

.title {
    margin-top: 4px !important;
    font-size: 18px !important;
    font-weight: 700;
    line-height: 1.35 !important;
}

.text {
    margin-top: 4px !important;
    min-height: 3.2em;
}

.controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
    margin-top: 14px;
}

.dots {
    display: flex;
    flex-wrap: wrap;
    gap: 2px;
    margin: 0 auto 0 0 !important;
    padding: 0 !important;
    list-style: none;
}

.dots li {
    margin: 0 !important;
}

.dots button {
    display: grid;
    place-items: center;
    width: 24px;
    height: 32px;
}

.dots button::after {
    content: "";
    width: 10px;
    height: 10px;
    border: 2px solid var(--circuit-soft);
    border-radius: 50%;
    transition:
        background-color 0.2s,
        transform 0.2s;
}

.dots button.seen::after {
    border-color: var(--circuit-link);
    background: var(--circuit-link);
}

.dots button.now::after {
    border-color: var(--circuit-ink);
    background: var(--circuit-yellow);
    transform: scale(1.3);
}

.controls > .ac-button:last-child {
    margin-left: auto;
}
</style>
