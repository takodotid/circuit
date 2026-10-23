<script setup lang="ts">
// In place of a lesson whose level is still closed: what the lesson teaches, and the entry check that opens it.
// Its heading has no id, so the page's outline leaves it out.

import { computed } from "vue";
import { withBase } from "vitepress";
import { Academy } from "../../academy";

const props = defineProps<{ lesson: (typeof Academy.LESSONS)[number] }>();

const before = computed(() => Academy.LEVELS[Academy.LEVELS.findIndex((level) => level.slug === props.lesson.level.slug) - 1]!);
const beforeStart = computed(() => Academy.link(before.value, before.value.lessons[0]!));
</script>

<template>
    <aside class="level-gate" :aria-label="`${lesson.title} is locked`">
        <p class="chip">Locked</p>
        <h2>{{ lesson.title }} is part of {{ lesson.level.name }}</h2>
        <p>
            This lesson builds on everything in {{ before.name }}. To open {{ lesson.level.name }}, pass its entry check: ten questions
            about {{ before.name }}. If you know networking already, it takes a few minutes; if not, {{ before.name }} teaches every answer.
        </p>
        <p class="outcome">After this lesson you can: {{ lesson.outcome.replace(/^./, (letter) => letter.toLowerCase()) }}</p>
        <div class="actions">
            <a class="ac-button primary" :href="withBase(`/academy/checks/${lesson.level.slug}`)"
                >Take the {{ lesson.level.name }} entry check</a
            >
            <a class="ac-button" :href="withBase(beforeStart)">Start {{ before.name }} instead</a>
        </div>
        <p class="note">A passed check is kept in this browser.</p>
    </aside>
</template>

<style scoped>
.level-gate {
    margin: 8px 0 32px;
    padding: 20px 22px 14px;
    border: 2px solid var(--circuit-ink);
    background: var(--circuit-mist);
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

h2 {
    margin: 0 0 10px;
    padding: 0;
    border: 0;
    font-size: 28px;
    font-weight: 700;
    line-height: 1.2;
    letter-spacing: -0.015em;
}

p {
    margin: 0 0 12px;
    font-size: 16.5px;
    line-height: 1.65;
}

.outcome {
    color: var(--circuit-soft);
}

.actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin: 4px 0 12px;
}

.actions a {
    text-decoration: none;
    white-space: normal;
}

.note {
    color: var(--circuit-soft);
    font-size: 13.5px;
}
</style>
