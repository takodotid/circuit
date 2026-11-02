<script setup lang="ts">
// Studio: a cobalt chapter with the real screen in it, in the page's own theme.

import { computed } from "vue";
import { useData, withBase } from "vitepress";

const { isDark } = useData();

const studioShot = computed(() => withBase(isDark.value ? "/screenshots/studio-dark.png" : "/screenshots/studio-light.png"));
</script>

<template>
    <section class="studio" aria-labelledby="studio">
        <div class="studio-copy" data-reveal>
            <h2 id="studio">The whole network, drawn</h2>
            <p>
                <code>circuit studio</code> draws the network and lists everything in your files, so the whole team can look things up,
                including people who do not read TypeScript. It reads only the files and the last snapshot, and never logs in to a device.
            </p>
            <a class="onward" :href="withBase('/studio/')">Circuit Studio</a>
        </div>
        <img
            class="shot"
            data-reveal
            :src="studioShot"
            alt="Circuit Studio's graph of an example network, with the devices that differ from their snapshots marked, beside the layer's details."
            width="1440"
            height="900"
            loading="lazy"
        />
    </section>
</template>

<style scoped>
.studio :focus-visible {
    outline-color: #ffffff;
}

.studio {
    display: grid;
    grid-template-columns: calc(500 * var(--px)) minmax(0, 1fr);
    gap: calc(64 * var(--px));
    align-items: center;
    padding: calc(110 * var(--px)) 0 calc(110 * var(--px)) var(--gutter);
    overflow: hidden;
    background: var(--circuit-cobalt);
    color: #ffffff;
}

.studio h2 {
    margin: 0 0 calc(24 * var(--px));
    padding: 0;
    border: 0;
    font-size: calc(72 * var(--px));
    font-weight: 700;
    line-height: 0.98;
    letter-spacing: -0.035em;
}

.studio p {
    margin: 0 0 calc(24 * var(--px));
    color: #e3ebfb;
    font-size: max(17px, calc(19 * var(--px)));
    line-height: 1.6;
}

.studio code {
    padding: 1px 6px;
    border-radius: 2px;
    background: rgba(8, 28, 64, 0.45);
    color: #ffffff;
    font-family: var(--circuit-mono);
    font-size: 0.9em;
}

.studio .onward {
    color: var(--circuit-yellow);
    font-size: max(17px, calc(19 * var(--px)));
    font-weight: 700;
    text-decoration: underline dotted 2px;
    text-underline-offset: 6px;
}

.shot {
    display: block;
    width: 100%;
    height: auto;
    border: 2px solid #0a1a36;
    border-right: 0;
}

@media (prefers-reduced-motion: no-preference) {
    .studio-copy.shown {
        animation: home-surface 0.9s var(--ease) backwards;
    }

    /* The screen slides into the cobalt from the edge it runs off. */
    .shot.shown {
        animation: slide 1s var(--ease) 0.1s backwards;
    }
}

@keyframes slide {
    from {
        opacity: 0;
        transform: translateX(10%);
    }
}

@media (max-width: 760px) {
    .studio {
        grid-template-columns: minmax(0, 1fr);
        gap: 28px;
        padding: 64px var(--gutter) 72px;
    }

    .studio h2 {
        font-size: 44px;
    }

    .shot {
        border-right: 2px solid #0a1a36;
    }
}
</style>
