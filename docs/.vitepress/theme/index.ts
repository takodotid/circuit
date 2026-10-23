// The default theme, with the home page of our own and the Academy's lessons around it.

import DefaultTheme from "vitepress/theme";
import type { Theme } from "vitepress";
import { nextTick, type Component } from "vue";
import AcademyHome from "./academy/AcademyHome.vue";
import AcademyLayout from "./academy/AcademyLayout.vue";
import CodeView from "./academy/CodeView.vue";
import Graduates from "./academy/Graduates.vue";
import LevelCheck from "./academy/LevelCheck.vue";
import Quiz from "./academy/Quiz.vue";
import StepThrough from "./academy/StepThrough.vue";
import SvgDevice from "./academy/SvgDevice.vue";
import Term from "./academy/Term.vue";
import TryIt from "./academy/TryIt.vue";
import Home from "./home/Home.vue";
import "./style.css";
import "./academy/academy.css";

// Each lesson's own widgets, used in its page by file name, such as <PacketSplit />.
const widgets = import.meta.glob<{ default: Component }>("./academy/widgets/*.vue", { eager: true });

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
    Layout: AcademyLayout,
    enhanceApp({ app, router }) {
        app.component("Home", Home);

        for (const [name, component] of Object.entries({
            AcademyHome,
            CodeView,
            Graduates,
            LevelCheck,
            Quiz,
            StepThrough,
            SvgDevice,
            Term,
            TryIt,
        })) {
            app.component(name, component);
        }

        for (const [file, widget] of Object.entries(widgets)) {
            app.component(file.replace(/^.*\/|\.vue$/g, ""), widget.default);
        }

        if (typeof window === "undefined") return;

        const after = router.onAfterRouteChange;
        router.onAfterRouteChange = async (to) => {
            await after?.(to);
            await arrive();
        };
    },
} satisfies Theme;
