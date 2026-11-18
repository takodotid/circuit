<script setup lang="ts">
// Under a lesson: what the reader can now do, a mark to say they finished it, and the way on.

import { computed } from "vue";
import { withBase } from "vitepress";
import { Academy } from "../../academy";
import { Progress } from "./progress";

const props = defineProps<{ lesson: (typeof Academy.LESSONS)[number] }>();

const finished = computed(() => Progress.isDone(props.lesson.link));
const next = computed(() => Academy.LESSONS[Academy.LESSONS.findIndex((entry) => entry.link === props.lesson.link) + 1]);

// The next lesson may start a level that is still closed: then the way on is its entry check.
const wayOn = computed(() => {
    if (!next.value) return undefined;
    const { level, link, title } = next.value;
    if (Progress.isOpen(level.slug)) return { link, text: `Next: ${title}` };
    return { link: `/academy/checks/${level.slug}`, text: `Next: the ${level.name} entry check` };
});
</script>

<template>
    <aside class="lesson-end" :class="{ finished }" aria-labelledby="lesson-end-title">
        <p id="lesson-end-title" class="chip">{{ finished ? "Done" : "End of lesson" }}</p>
        <p class="outcome">
            You can now <strong>{{ lesson.outcome.replace(/\.$/, "").replace(/^./, (letter) => letter.toLowerCase()) }}.</strong>
        </p>
        <div class="actions">
            <button v-if="!finished" type="button" class="ac-button primary" @click="Progress.setDone(lesson.link, true)">
                Mark as done
            </button>
            <template v-else>
                <a v-if="wayOn" class="ac-button primary" :href="withBase(wayOn.link)">{{ wayOn.text }}</a>
                <a v-else class="ac-button primary" :href="withBase('/academy/certification')">See the certification</a>
                <button type="button" class="ac-button" @click="Progress.setDone(lesson.link, false)">Mark not done</button>
            </template>
        </div>
    </aside>
</template>

<style scoped>
.lesson-end {
    margin: 48px 0 8px;
    padding: 18px 22px 16px;
    border: 2px solid var(--circuit-ink);
}

.lesson-end.finished {
    border-color: var(--circuit-added);
}

.chip {
    display: inline-block;
    margin: 0 0 10px;
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

.finished .chip {
    background: var(--circuit-added);
    color: #ffffff;
}

.dark .finished .chip {
    color: #0b1122;
}

.outcome {
    margin: 0 0 14px;
    font-size: 17px;
    line-height: 1.55;
}

.actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
}

.actions a {
    text-decoration: none;
    white-space: normal;
}
</style>
