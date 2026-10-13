<script setup lang="ts">
// The default layout, with the Academy's parts around a lesson: its place in the level above the title, the end of lesson and the discussion under it,
// and in place of a lesson whose level is still closed, the gate to its entry check.

import { computed, nextTick, onMounted, watch } from "vue";
import DefaultTheme from "vitepress/theme";
import { useData, useRoute } from "vitepress";
import { lessons } from "../../academy";
import Discussion from "./Discussion.vue";
import LessonFooter from "./LessonFooter.vue";
import LessonHeader from "./LessonHeader.vue";
import LevelGate from "./LevelGate.vue";
import { done, gated, isOpen, loadProgress, normalize, passed } from "./progress";

const { Layout } = DefaultTheme;
const route = useRoute();
const { frontmatter } = useData();

const path = computed(() => normalize(route.path));
const lesson = computed(() => lessons.find((entry) => entry.link === path.value));
const inAcademy = computed(() => path.value.startsWith("/academy/"));

/** Tick each finished lesson in the sidebar. The sidebar is the theme's own, so its links are marked once they are drawn. */
async function markSidebar() {
    await nextTick();

    for (const link of document.querySelectorAll<HTMLAnchorElement>(".VPSidebar a.link[href^='/academy/']")) {
        const href = normalize(new URL(link.href).pathname);
        link.classList.toggle("academy-done", Boolean(done.value[href]));
    }
}

/** Hide a closed level's lesson behind its gate. The page's head does the same before anything is drawn; this keeps it right as the reader moves between pages or passes a check. */
function lock() {
    const level = lesson.value?.level.slug;
    document.documentElement.classList.toggle("academy-locked", Boolean(level && !isOpen(level)));
}

onMounted(() => {
    loadProgress();
    markSidebar();
    lock();
});

watch([done, () => route.path], markSidebar);
watch([passed, () => route.path], lock);
</script>

<template>
    <Layout>
        <template #doc-before>
            <LessonHeader v-if="lesson" :lesson="lesson" />
            <LevelGate v-if="lesson && gated.includes(lesson.level.slug)" :lesson="lesson" />
        </template>
        <template #doc-footer-before>
            <LessonFooter v-if="lesson" :lesson="lesson" />
        </template>
        <template #doc-after>
            <Discussion v-if="inAcademy && frontmatter.discussion !== false" :key="path" />
        </template>
    </Layout>
</template>
