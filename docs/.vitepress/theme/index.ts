// The default theme, with the home page of our own.

import DefaultTheme from "vitepress/theme";
import type { Theme } from "vitepress";
import { nextTick } from "vue";
import Home from "./Home.vue";
import "./style.css";

/** A page reached from another comes in: its text fades in and rises a little, so the change of page is seen without waiting for it. */
async function arrive() {
    await nextTick();

    const content = document.querySelector(".VPDoc .content-container");
    if (!content || matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    content.animate(
        [
            { opacity: 0, transform: "translateY(8px)" },
            { opacity: 1, transform: "none" },
        ],
        { duration: 320, easing: "cubic-bezier(0.16, 1, 0.3, 1)" }
    );
}

export default {
    extends: DefaultTheme,
    enhanceApp({ app, router }) {
        app.component("Home", Home);

        if (typeof window === "undefined") return;

        const after = router.onAfterRouteChange;
        router.onAfterRouteChange = async (to) => {
            await after?.(to);
            await arrive();
        };
    },
} satisfies Theme;
