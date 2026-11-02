<script setup lang="ts">
// The home page: the opening, then each chapter in turn. Below the opening, each part marked data-reveal arrives as it scrolls into view.

import "./home.css";
import { onBeforeUnmount, onMounted, ref } from "vue";
import HomeBegin from "./HomeBegin.vue";
import HomeClose from "./HomeClose.vue";
import HomeHow from "./HomeHow.vue";
import HomeLearn from "./HomeLearn.vue";
import HomeOpening from "./HomeOpening.vue";
import HomeRuns from "./HomeRuns.vue";
import HomeStudio from "./HomeStudio.vue";
import HomeWhy from "./HomeWhy.vue";

const page = ref<HTMLElement>();

// Below the opening, each part arrives as it scrolls into view. One already in view when the page opens is left as it is.
let revealer: IntersectionObserver | undefined;

function revealOnScroll() {
    if (!page.value || matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    revealer = new IntersectionObserver(
        (entries) => {
            for (const entry of entries) {
                if (!entry.isIntersecting) continue;

                entry.target.classList.replace("waiting", "shown");
                revealer?.unobserve(entry.target);
            }
        },
        { rootMargin: "0px 0px -12% 0px" }
    );

    for (const part of page.value.querySelectorAll("[data-reveal]")) {
        if (part.getBoundingClientRect().top < window.innerHeight) continue;

        part.classList.add("waiting");
        revealer.observe(part);
    }
}

onMounted(revealOnScroll);

onBeforeUnmount(() => revealer?.disconnect());
</script>

<template>
    <article ref="page" class="home">
        <HomeOpening />
        <HomeWhy />
        <HomeHow />
        <HomeBegin />
        <HomeStudio />
        <HomeLearn />
        <HomeRuns />
        <HomeClose />
    </article>
</template>
