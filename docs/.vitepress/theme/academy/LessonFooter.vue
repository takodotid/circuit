<script setup lang="ts">
// Under a lesson: what the reader can now do, a mark to say they finished it, and the way on.

import { computed } from "vue";
import { withBase } from "vitepress";
import { lessons } from "../../academy";
import { isDone, setDone } from "./progress";

const props = defineProps<{ lesson: (typeof lessons)[number] }>();

const finished = computed(() => isDone(props.lesson.link));
const next = computed(() => lessons[lessons.findIndex((entry) => entry.link === props.lesson.link) + 1]);
</script>

<template>
    <aside class="lesson-end" :class="{ finished }" aria-labelledby="lesson-end-title">
        <p id="lesson-end-title" class="chip">{{ finished ? "Finished" : "Before you go on" }}</p>
        <p class="outcome">
            You can now: <strong>{{ lesson.outcome.replace(/\.$/, "").replace(/^./, (letter) => letter.toLowerCase()) }}.</strong>
        </p>
        <div class="actions">
            <button v-if="!finished" type="button" class="ac-button primary" @click="setDone(lesson.link, true)">
                I can do this, mark it done
            </button>
            <template v-else>
                <a v-if="next" class="ac-button primary" :href="withBase(next.link)">Next: {{ next.title }}</a>
                <a v-else class="ac-button primary" :href="withBase('/academy/certification')">See the certification</a>
                <button type="button" class="ac-button" @click="setDone(lesson.link, false)">Not yet, unmark it</button>
            </template>
        </div>
        <p class="note">Your progress is kept in this browser only.</p>
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

.note {
    margin: 12px 0 0;
    color: var(--circuit-soft);
    font-size: 13.5px;
}
</style>
