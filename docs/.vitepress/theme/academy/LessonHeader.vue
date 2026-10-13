<script setup lang="ts">
// Above a lesson's title: which level it belongs to, and where it sits in that level.

import { computed } from "vue";
import { withBase } from "vitepress";
import type { lessons } from "../../academy";

const props = defineProps<{ lesson: (typeof lessons)[number] }>();

const total = computed(() => props.lesson.level.lessons.length);
</script>

<template>
    <p class="kicker">
        <a :href="withBase(`/academy/#${lesson.level.slug}`)">{{ lesson.level.name }}</a>
        <span>Lesson {{ lesson.number }} of {{ total }}</span>
    </p>
</template>

<style scoped>
.kicker {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 12px;
    margin: 0 0 14px;
    font-size: 12px;
    font-weight: 700;
    font-stretch: 115%;
    letter-spacing: 0.08em;
    line-height: 20px;
    text-transform: uppercase;
}

a {
    padding: 2px 8px;
    background: var(--circuit-cobalt);
    color: #ffffff;
    text-decoration: none;
}

a:hover {
    background: var(--circuit-cobalt-deep);
}

span {
    color: var(--circuit-soft);
}
</style>
