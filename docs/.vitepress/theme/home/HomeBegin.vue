<script setup lang="ts">
// Where to begin: the three patterns as a parts list, each with the files it starts with.

import { withBase } from "vitepress";
import { HomeContent } from "./home-content";
</script>

<template>
    <section class="chapter begin" aria-labelledby="begin">
        <h2 id="begin" data-reveal><span>Where to begin</span></h2>
        <div class="body">
            <p>Pick the layout closest to your network. Each one is a working project you change to your own.</p>
            <ol class="patterns" data-reveal>
                <li v-for="(pattern, index) in HomeContent.PATTERNS" :key="pattern.id" :style="{ '--i': index }">
                    <a :href="withBase(`/patterns/${pattern.id}`)">{{ pattern.name }}</a>
                    <p>{{ pattern.text }}</p>
                    <ul class="files" :aria-label="`Files in ${pattern.name}`">
                        <li v-for="(file, place) in pattern.files" :key="file" :style="{ '--j': place }">{{ file }}</li>
                    </ul>
                </li>
            </ol>
        </div>
    </section>
</template>

<style scoped>
.patterns {
    margin: calc(10 * var(--px)) 0 0;
    padding: 0;
    list-style: none;
    border-top: 2px solid var(--circuit-ink);
}

.patterns > li {
    padding: calc(22 * var(--px)) 0;
    border-bottom: 1px solid var(--circuit-line);
}

.patterns > li > a {
    font-size: max(21px, calc(28 * var(--px)));
    font-weight: 700;
    letter-spacing: -0.015em;
    text-decoration-thickness: 2px;
}

.patterns > li > p {
    margin: calc(6 * var(--px)) 0 calc(12 * var(--px));
}

@media (prefers-reduced-motion: no-preference) {
    .patterns.shown > li {
        animation: home-rise 0.65s var(--ease) backwards;
        animation-delay: calc(var(--i) * 0.12s);
    }

    /* A pattern's files are laid out after it, one after another. */
    .patterns.shown .files li {
        animation: home-pop 0.4s var(--ease) backwards;
        animation-delay: calc(0.3s + var(--i) * 0.12s + var(--j) * 0.05s);
    }
}
</style>
