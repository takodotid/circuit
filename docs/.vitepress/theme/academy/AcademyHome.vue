<script setup lang="ts">
// The Academy's map: each level with its lessons, the ones this reader finished ticked, whether each level is open, and the next step.

import { computed, onMounted, ref } from "vue";
import { withBase } from "vitepress";
import { Academy } from "../../academy";
import { Progress } from "./progress";

// What this browser remembers is only known once the page is in it, so the first paint shows a fresh start.
const ready = ref(false);

onMounted(() => {
    Progress.load();
    ready.value = true;
});

const finished = computed(() => (ready.value ? Academy.LESSONS.filter((lesson) => Progress.done.value[lesson.link]).length : 0));
const next = computed(() => (ready.value ? Academy.LESSONS.find((lesson) => !Progress.done.value[lesson.link]) : Academy.LESSONS[0]));

// The way on: the next lesson, or the entry check of its level while that level is closed.
const nextStep = computed(() => {
    const lesson = next.value;
    if (!lesson) return undefined;
    if (ready.value && !Progress.isOpen(lesson.level.slug, Progress.passed.value)) {
        return { link: `/academy/checks/${lesson.level.slug}`, text: `Next: the ${lesson.level.name} entry check` };
    }
    return { link: lesson.link, text: finished.value === 0 ? "Start lesson 1" : `Continue: ${lesson.title}` };
});

/** Whether a level is shown as closed. Before the browser is read, every gated level is. */
const closed = (slug: string) => Progress.GATED.includes(slug) && (!ready.value || !Progress.isOpen(slug, Progress.passed.value));

const levelDone = (slug: string) =>
    ready.value ? Academy.LESSONS.filter((lesson) => lesson.level.slug === slug && Progress.isDone(lesson.link)).length : 0;

function clear() {
    if (confirm("Clear every lesson you marked done, and every entry check you passed, in this browser?")) Progress.reset();
}
</script>

<template>
    <div class="academy-map">
        <div class="progress" aria-live="polite">
            <p v-if="finished === 0">
                <strong>Start from the first lesson</strong> if networking is new to you. If you know some of it, start at the level that
                fits.
            </p>
            <p v-else-if="next">
                <strong>{{ finished }} of {{ Academy.LESSONS.length }} lessons done.</strong> Pick up where you left off.
            </p>
            <p v-else><strong>Every lesson done.</strong> The certification is the next step.</p>

            <div class="actions">
                <a v-if="nextStep" class="ac-button primary" :href="withBase(nextStep.link)">{{ nextStep.text }}</a>
                <a v-else class="ac-button primary" :href="withBase('/academy/certification')">See the certification</a>
                <button v-if="finished > 0 || Object.keys(Progress.passed.value).length" type="button" class="ac-button" @click="clear">
                    Clear my progress
                </button>
            </div>
        </div>

        <section
            v-for="(level, index) in Academy.LEVELS"
            :id="level.slug"
            :key="level.slug"
            class="level"
            :aria-labelledby="`${level.slug}-title`"
        >
            <div class="art">
                <img :src="withBase(level.illustration)" alt="" loading="lazy" />
            </div>
            <div class="about">
                <p class="tag">
                    <span>Level {{ index + 1 }}: {{ level.name }}</span>
                    <span v-if="levelDone(level.slug)" class="count">{{ levelDone(level.slug) }} of {{ level.lessons.length }} done</span>
                </p>
                <h2 :id="`${level.slug}-title`">{{ level.title }}</h2>
                <p class="audience">{{ level.audience }}</p>
                <p v-if="Progress.GATED.includes(level.slug)" class="gate" :class="{ closed: closed(level.slug) }">
                    <template v-if="closed(level.slug)">
                        <span class="lock">Locked</span>
                        Opens with its <a :href="withBase(`/academy/checks/${level.slug}`)">entry check</a>: ten questions about
                        {{ Academy.LEVELS[index - 1]?.name }}.
                    </template>
                    <template v-else>
                        <span class="lock open">Open</span>
                        You passed its entry check in this browser.
                    </template>
                </p>
            </div>
            <ol class="lessons">
                <li
                    v-for="(lesson, number) in level.lessons"
                    :key="lesson.slug"
                    :class="{ done: ready && Progress.isDone(`/academy/${level.slug}/${lesson.slug}`) }"
                >
                    <span class="dot" aria-hidden="true">{{
                        ready && Progress.isDone(`/academy/${level.slug}/${lesson.slug}`) ? "✓" : number + 1
                    }}</span>
                    <div>
                        <a :href="withBase(`/academy/${level.slug}/${lesson.slug}`)">{{ lesson.title }}</a>
                        <span v-if="ready && Progress.isDone(`/academy/${level.slug}/${lesson.slug}`)" class="ac-hidden"> (done)</span>
                        <p>{{ lesson.outcome }}</p>
                    </div>
                </li>
            </ol>
        </section>

        <aside class="certify" aria-labelledby="certify-title">
            <img :src="withBase('/illustrations/academy/certificate.webp')" alt="" loading="lazy" />
            <div>
                <p class="soon">Coming soon</p>
                <h2 id="certify-title">Certification</h2>
                <p>
                    Once you finish the levels, ask for a case: a network someone needs, which you provision in Circuit. When your work
                    passes review, you get a certificate anyone can check, and a place among the graduates.
                </p>
                <div class="actions">
                    <a class="ac-button" :href="withBase('/academy/certification')">How it will work</a>
                    <a class="ac-button" :href="withBase('/academy/graduates')">The graduates</a>
                </div>
            </div>
        </aside>
    </div>
</template>

<style scoped>
.progress {
    margin: 28px 0 8px;
    padding: 18px 22px;
    background: var(--circuit-mist);
}

.progress p {
    margin: 0 0 14px;
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

.level {
    display: grid;
    grid-template-columns: 200px minmax(0, 1fr);
    gap: 4px 28px;
    margin-top: 56px;
    padding-top: 22px;
    border-top: 3px solid var(--circuit-ink);
    scroll-margin-top: calc(var(--vp-nav-height) + 24px);
}

.art {
    grid-row: span 2;
}

.art img {
    width: 100%;
    height: 140px;
    object-fit: contain;
    object-position: left top;
}

.tag {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 12px;
    margin: 0 !important;
    font-size: 12px !important;
    font-weight: 700;
    font-stretch: 115%;
    letter-spacing: 0.08em;
    line-height: 20px !important;
    text-transform: uppercase;
}

.tag span:first-child {
    padding: 2px 8px;
    background: var(--circuit-cobalt);
    color: #ffffff;
}

.tag .count {
    padding: 2px 0;
    color: var(--circuit-added);
}

.level h2 {
    margin: 10px 0 6px !important;
    padding: 0 !important;
    border: 0 !important;
    font-size: 30px;
}

h2 {
    width: fit-content;
    padding-bottom: 8px !important;
    background: radial-gradient(circle, var(--circuit-cobalt) 48%, transparent 52%) left bottom / 14px 7px space no-repeat;
}

.dark h2 {
    background-image: radial-gradient(circle, var(--circuit-link) 48%, transparent 52%);
}

.audience {
    margin: 0 !important;
    color: var(--circuit-soft);
}

.gate {
    margin: 8px 0 0 !important;
    font-size: 15.5px !important;
}

.lock {
    display: inline-block;
    margin-right: 6px;
    padding: 0 7px;
    background: var(--circuit-ink);
    color: var(--circuit-paper);
    font-size: 11px;
    font-weight: 700;
    font-stretch: 115%;
    letter-spacing: 0.08em;
    line-height: 20px;
    text-transform: uppercase;
    vertical-align: 1px;
}

.lock.open {
    background: var(--circuit-added);
    color: #ffffff;
}

.dark .lock.open {
    color: #0b1122;
}

.lessons {
    grid-column: 1 / -1;
    margin: 22px 0 0 !important;
    padding: 0 !important;
    list-style: none;
    border-top: 2px solid var(--circuit-ink);
}

.lessons li {
    display: grid;
    grid-template-columns: 34px minmax(0, 1fr);
    gap: 14px;
    margin: 0 !important;
    padding: 14px 0;
    border-bottom: 1px solid var(--circuit-line);
}

.dot {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border-radius: 50%;
    background: var(--circuit-cobalt);
    color: #ffffff;
    font-size: 14px;
    font-weight: 700;
}

.done .dot {
    background: var(--circuit-added);
}

.dark .done .dot {
    color: #0b1122;
}

.lessons a {
    font-size: 18px;
    font-weight: 700 !important;
}

.lessons p {
    margin: 2px 0 0 !important;
    color: var(--circuit-soft);
    font-size: 15.5px !important;
    line-height: 1.55 !important;
}

.certify {
    display: grid;
    grid-template-columns: 200px minmax(0, 1fr);
    gap: 18px 28px;
    align-items: center;
    margin-top: 64px;
    padding: 22px;
    border: 2px solid var(--circuit-ink);
}

.certify img {
    width: 100%;
    height: auto;
}

.certify h2 {
    margin: 6px 0 10px !important;
    padding: 0 0 8px !important;
    border: 0 !important;
    font-size: 26px;
}

.certify p {
    margin: 0 0 14px !important;
}

.soon {
    display: inline-block;
    padding: 2px 8px;
    background: var(--circuit-yellow);
    color: #0a1a36;
    font-size: 12px !important;
    font-weight: 700;
    font-stretch: 120%;
    letter-spacing: 0.1em;
    line-height: 20px !important;
    text-transform: uppercase;
}

@media (max-width: 640px) {
    .certify {
        grid-template-columns: minmax(0, 1fr);
    }

    .certify img {
        max-width: 240px;
    }

    .level {
        grid-template-columns: minmax(0, 1fr);
    }

    .art {
        grid-row: auto;
    }

    .art img {
        height: 110px;
    }
}
</style>
