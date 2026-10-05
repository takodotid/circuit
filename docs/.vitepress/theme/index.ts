// The default theme, with the home page of our own.

import DefaultTheme from "vitepress/theme";
import type { Theme } from "vitepress";
import Home from "./Home.vue";
import "./style.css";

export default {
    extends: DefaultTheme,
    enhanceApp({ app }) {
        app.component("Home", Home);
    },
} satisfies Theme;
