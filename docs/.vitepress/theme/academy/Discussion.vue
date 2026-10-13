<script setup lang="ts">
// A discussion under each lesson, kept in the repository's GitHub Discussions through giscus: one thread per page, made when the first reader writes.
// The site stays static: the thread lives on GitHub, and readers sign in there to write.

import { onMounted, ref, watch } from "vue";
import { useData, useRoute } from "vitepress";
import circuit from "../../../../package.json";

// giscus finds the repository and the category by these ids, from https://giscus.app once Discussions is on and the giscus app is installed.
// Until the category exists, readers are pointed to GitHub instead.
const GISCUS = {
    repo: "takodotid/circuit",
    repoId: "R_kgDOU38tPg",
    category: "Academy",
    categoryId: "52482590",
};

const repository = circuit.repository.url.replace(/^git\+/, "").replace(/\.git$/, "");

const { isDark } = useData();
const route = useRoute();
const frame = ref<HTMLElement>();

const theme = () => (isDark.value ? "dark" : "light");

/** Load giscus for this page, replacing the thread of the page before it. */
function load() {
    if (!frame.value || !GISCUS.categoryId) return;

    frame.value.replaceChildren();

    const script = document.createElement("script");
    script.src = "https://giscus.app/client.js";
    script.async = true;
    script.crossOrigin = "anonymous";

    const settings: Record<string, string> = {
        repo: GISCUS.repo,
        "repo-id": GISCUS.repoId,
        category: GISCUS.category,
        "category-id": GISCUS.categoryId,
        mapping: "pathname",
        strict: "1",
        "reactions-enabled": "1",
        "emit-metadata": "0",
        "input-position": "top",
        theme: theme(),
        lang: "en",
        loading: "lazy",
    };

    for (const [name, value] of Object.entries(settings)) script.setAttribute(`data-${name}`, value);

    frame.value.append(script);
}

onMounted(load);
watch(() => route.path, load);

// The thread follows the site's theme without loading again.
watch(isDark, () => {
    const iframe = frame.value?.querySelector<HTMLIFrameElement>("iframe.giscus-frame");
    iframe?.contentWindow?.postMessage({ giscus: { setConfig: { theme: theme() } } }, "https://giscus.app");
});
</script>

<template>
    <section class="discussion" aria-labelledby="discussion-title">
        <h2 id="discussion-title">Discussion</h2>
        <p v-if="GISCUS.categoryId" class="lead">
            Stuck, or found a mistake? Ask here. You sign in with GitHub, and the thread is kept in the repository's discussions.
        </p>
        <p v-else class="lead">
            Stuck, or found a mistake? Ask on
            <a :href="`${repository}/issues/new?title=${encodeURIComponent(`Academy: ${route.path}`)}`">GitHub</a>, and name the lesson. A
            discussion under each lesson is on its way.
        </p>
        <div ref="frame" class="giscus" />
    </section>
</template>

<style scoped>
.discussion {
    margin-top: 48px;
    padding-top: 22px;
    border-top: 3px solid var(--circuit-ink);
}

h2 {
    margin: 0 0 8px;
    font-size: 26px;
    font-weight: 700;
    letter-spacing: -0.015em;
}

.lead {
    margin: 0 0 18px;
    color: var(--circuit-soft);
    font-size: 16px;
    line-height: 1.6;
}

.lead a {
    color: var(--circuit-link);
    font-weight: 600;
    text-decoration: underline dotted 2px;
    text-underline-offset: 4px;
}

.lead a:hover {
    text-decoration-style: solid;
}
</style>
