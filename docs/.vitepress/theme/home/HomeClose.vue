<script setup lang="ts">
// The close: one yellow field to start from, with the command for each package manager.

import { ref } from "vue";
import { withBase } from "vitepress";
import { useCopy } from "./copy";
import { HomeContent } from "./home-content";

const { copied, copy } = useCopy();

const starters = HomeContent.STARTERS;
const starter = ref(0);
</script>

<template>
    <section class="close" aria-labelledby="close">
        <h2 id="close" data-reveal>Write down your first device.</h2>
        <p>Circuit asks a few questions, then writes a working project and installs itself with the package manager you started it with.</p>
        <div class="starter" data-reveal>
            <div class="managers" role="tablist" aria-label="Package manager">
                <button
                    v-for="(entry, index) in starters"
                    :key="entry.name"
                    type="button"
                    role="tab"
                    :aria-selected="starter === index"
                    @click="starter = index"
                >
                    {{ entry.name }}
                </button>
            </div>
            <button
                type="button"
                class="command"
                @click="copy(starters[starter].command)"
                :aria-label="`Copy ${starters[starter].command}`"
            >
                <code>{{ starters[starter].command }}</code>
                <span class="copied" aria-live="polite">{{ copied === starters[starter].command ? "Copied" : "" }}</span>
                <svg v-if="copied !== starters[starter].command" viewBox="0 0 24 24" aria-hidden="true">
                    <rect x="8" y="8" width="12" height="12" rx="1" />
                    <path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" />
                </svg>
            </button>
        </div>
        <p class="more">
            Or read <a :href="withBase('/guide/introduction')">what Circuit is</a> first, follow
            <a :href="withBase('/guide/getting-started')">getting started</a>, or see the package on <a :href="HomeContent.NPM">npm</a>.
        </p>
    </section>
</template>

<style scoped>
.close {
    padding: calc(110 * var(--px)) var(--gutter) calc(120 * var(--px));
    background: var(--circuit-yellow);
    color: #0a1a36;
}

.close h2 {
    max-width: calc(980 * var(--px));
    margin: 0 0 calc(20 * var(--px));
    padding: 0;
    border: 0;
    font-size: calc(96 * var(--px));
    font-weight: 700;
    line-height: 0.95;
    letter-spacing: -0.04em;
}

.close > p {
    max-width: 60ch;
    margin: 0 0 calc(32 * var(--px));
    font-size: max(17px, calc(20 * var(--px)));
    line-height: 1.55;
}

.close a {
    color: #0a1a36;
    font-weight: 600;
    text-decoration: underline dotted 2px;
    text-underline-offset: 5px;
}

.close a:hover {
    text-decoration-style: solid;
}

.starter {
    display: flex;
    flex-wrap: wrap;
    align-items: stretch;
    gap: 10px;
    margin-bottom: calc(28 * var(--px));
}

.managers {
    display: flex;
    border: 2px solid #0a1a36;
    border-radius: 2px;
}

.managers button {
    padding: 0 max(14px, calc(20 * var(--px)));
    color: #0a1a36;
    font-size: max(15px, calc(17 * var(--px)));
    font-weight: 700;
}

.managers button + button {
    border-left: 2px solid #0a1a36;
}

.managers button[aria-selected="true"] {
    background: #0a1a36;
    color: var(--circuit-yellow);
}

/* The command's own look is in home.css, shared with the opening; here it sits dark on the yellow. */
.close .command {
    min-width: min(100%, calc(560 * var(--px)));
    height: auto;
    min-height: 56px;
    border-color: #0a1a36;
    background: #0a1a36;
}

.close .command code {
    font-size: max(16px, calc(20 * var(--px)));
}

.close .more {
    margin: 0;
    font-size: max(16px, calc(18 * var(--px)));
}

@media (prefers-reduced-motion: no-preference) {
    .starter.shown {
        animation: home-rise 0.7s var(--ease) 0.15s backwards;
    }
}

@media (max-width: 760px) {
    .close {
        padding: 64px var(--gutter) 72px;
    }

    .close h2 {
        font-size: 46px;
    }

    .starter,
    .managers {
        width: 100%;
    }

    .managers button {
        flex: 1;
        min-height: 44px;
    }

    .close .command code {
        font-size: 14px;
    }
}
</style>
