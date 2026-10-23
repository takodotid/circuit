<script setup lang="ts">
// How: the four steps of a change, each with what you type for it.

import { withBase } from "vitepress";
import { HomeContent } from "./home-content";
</script>

<template>
    <section class="chapter how" aria-labelledby="how">
        <h2 id="how" data-reveal><span>How</span></h2>
        <div class="body">
            <ol class="steps" data-reveal>
                <li v-for="(step, index) in HomeContent.STEPS" :key="step.title" :style="{ '--i': index }">
                    <span class="dot" aria-hidden="true">{{ index + 1 }}</span>
                    <p>
                        <strong>{{ step.title }}</strong> {{ step.text }}
                    </p>
                    <code :class="{ file: step.file }">{{ step.command }}</code>
                </li>
            </ol>
            <a class="onward" :href="withBase('/guide/getting-started')">Get started</a>
        </div>
    </section>
</template>

<style scoped>
.how {
    background: var(--circuit-mist);
}

.steps {
    margin: 0 0 calc(28 * var(--px));
    padding: 0;
    list-style: none;
    border-top: 2px solid var(--circuit-ink);
}

.steps li {
    display: grid;
    grid-template-columns: calc(52 * var(--px)) minmax(0, 1fr);
    gap: calc(6 * var(--px)) calc(18 * var(--px));
    padding: calc(22 * var(--px)) 0;
    border-bottom: 1px solid var(--circuit-line);
}

.steps .dot {
    grid-row: span 2;
    display: grid;
    place-items: center;
    width: max(30px, calc(40 * var(--px)));
    height: max(30px, calc(40 * var(--px)));
    border-radius: 50%;
    background: var(--circuit-cobalt);
    color: #ffffff;
    font-size: max(15px, calc(19 * var(--px)));
    font-weight: 700;
}

.steps p {
    margin: 0;
}

.steps strong {
    font-weight: 700;
}

.steps code {
    justify-self: start;
    padding: 4px 10px;
    border-radius: 2px;
    background: var(--circuit-navy);
    color: #e6ecfa;
    font-size: max(13px, calc(15 * var(--px)));
}

.steps code::before {
    content: "$ ";
    color: var(--circuit-yellow);
}

.steps code.file::before {
    content: none;
}

.dark .steps code {
    background: #050a16;
    box-shadow: inset 0 0 0 1px var(--circuit-line);
}

/* Lists arrive in their order; a step's number comes first. */
@media (prefers-reduced-motion: no-preference) {
    .steps.shown li {
        animation: home-rise 0.65s var(--ease) backwards;
        animation-delay: calc(var(--i) * 0.12s);
    }

    .steps.shown .dot {
        animation: home-pop 0.5s var(--ease) backwards;
        animation-delay: calc(0.1s + var(--i) * 0.12s);
    }
}

@media (max-width: 760px) {
    .steps li {
        grid-template-columns: 40px minmax(0, 1fr);
        padding: 18px 0;
    }

    .steps code {
        max-width: 100%;
        overflow-x: auto;
    }
}
</style>
