<script setup lang="ts">
// New to networking: the Academy's levels as a parts list, with the first lessons of each.

import { withBase } from "vitepress";
import { HomeContent } from "./home-content";
</script>

<template>
    <section class="chapter learn" aria-labelledby="learn">
        <div class="learn-head">
            <h2 id="learn" data-reveal><span>New to networking?</span></h2>
            <img
                class="desk"
                data-reveal
                :src="withBase('/illustrations/academy/academy-desk.webp')"
                alt=""
                width="1100"
                height="732"
                loading="lazy"
            />
        </div>
        <div class="body">
            <p>
                Circuit writes a network down, so it helps to know what a network is made of first. Circuit Academy starts from nothing and
                gets you to running a provider network, with something to try in your browser in every lesson.
            </p>
            <ol class="levels" data-reveal>
                <li v-for="(level, index) in HomeContent.LEVELS" :key="level.slug" :style="{ '--i': index }">
                    <a :href="withBase(level.link)">{{ level.name }}: {{ level.title }}</a>
                    <p>{{ level.audience }}</p>
                    <ul class="files" :aria-label="`First lessons of ${level.name}`">
                        <li v-for="(title, place) in level.first" :key="title" :style="{ '--j': place }">{{ title }}</li>
                        <li v-if="level.more" class="more-lessons" :style="{ '--j': level.first.length }">and {{ level.more }} more</li>
                    </ul>
                </li>
            </ol>
            <p class="certify">
                <strong>Certification is coming.</strong> You will be given a network to build in Circuit, and once it passes review, you
                are listed among the <a :href="withBase('/academy/graduates')">graduates</a>.
                <a :href="withBase('/academy/certification')">How it will work</a>
            </p>
            <a class="onward" :href="withBase(HomeContent.FIRST_LESSON)">Take the first lesson</a>
        </div>
    </section>
</template>

<style scoped>
.learn {
    background: var(--circuit-mist);
}

.learn-head {
    align-self: start;
    min-width: 0;
}

.learn .desk {
    display: block;
    width: min(100%, calc(520 * var(--px)));
    height: auto;
    margin-top: calc(40 * var(--px));
}

.levels {
    margin: calc(10 * var(--px)) 0 calc(28 * var(--px));
    padding: 0;
    list-style: none;
    border-top: 2px solid var(--circuit-ink);
}

.levels > li {
    padding: calc(22 * var(--px)) 0;
    border-bottom: 1px solid var(--circuit-line);
}

.levels > li > a {
    font-size: max(21px, calc(28 * var(--px)));
    font-weight: 700;
    letter-spacing: -0.015em;
    text-decoration-thickness: 2px;
}

.levels > li > p {
    margin: calc(6 * var(--px)) 0 calc(12 * var(--px));
}

.levels .files li {
    font-family: var(--circuit-font);
}

.levels .more-lessons {
    border-style: dashed;
}

.certify {
    padding: calc(16 * var(--px)) calc(20 * var(--px));
    border: 2px solid var(--circuit-ink);
    background: var(--circuit-paper);
}

.certify a:last-child {
    margin-left: 0.3em;
}

@media (prefers-reduced-motion: no-preference) {
    .levels.shown > li {
        animation: home-rise 0.65s var(--ease) backwards;
        animation-delay: calc(var(--i) * 0.12s);
    }

    .levels.shown .files li {
        animation: home-pop 0.4s var(--ease) backwards;
        animation-delay: calc(0.3s + var(--i) * 0.12s + var(--j) * 0.05s);
    }

    .desk.shown {
        animation: home-rise 0.7s var(--ease) 0.15s backwards;
    }
}

@media (max-width: 760px) {
    .learn .desk {
        width: min(100%, 360px);
        margin-top: 20px;
    }
}
</style>
