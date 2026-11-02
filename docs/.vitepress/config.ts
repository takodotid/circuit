import { defineConfig, type DefaultTheme } from "vitepress";
import circuit from "../../package.json";
import { Academy } from "./academy.ts";
import { Seo } from "./seo.ts";
import { Progress } from "./theme/academy/progress.ts";

const repository = circuit.repository.url.replace(/^git\+/, "").replace(/\.git$/, "");

const sidebar: DefaultTheme.SidebarItem[] = [
    {
        text: "Guide",
        items: [
            { text: "Introduction", link: "/guide/introduction" },
            { text: "Install", link: "/guide/install" },
            { text: "Write a project", link: "/guide/project" },
            { text: "Rules", link: "/guide/rules" },
            { text: "Parts and merge", link: "/guide/parts" },
            { text: "BGP communities", link: "/guide/communities" },
            { text: "Checks and errors", link: "/guide/checks" },
            { text: "Secrets", link: "/guide/secrets" },
            { text: "The circuit command", link: "/guide/cli" },
            { text: "How a change is applied", link: "/guide/apply" },
            { text: "Example projects", link: "/guide/examples" },
            { text: "FAQ", link: "/guide/faq" },
            { text: "Glossary", link: "/guide/glossary" },
        ],
    },
    {
        text: "Circuit Studio",
        items: [
            { text: "Overview", link: "/studio/" },
            { text: "The graph", link: "/studio/graph" },
            { text: "Looking things up", link: "/studio/tables" },
            { text: "Tools", link: "/studio/tools" },
            { text: "Reviewing changes", link: "/studio/changes" },
            { text: "Secrets", link: "/studio/secrets" },
            { text: "Hosting", link: "/studio/hosting" },
        ],
    },
    {
        text: "Platforms",
        items: [{ text: "What each platform does", link: "/platforms/" }],
    },
    {
        text: "Reference",
        items: [{ text: "The model", link: "/reference/model" }],
    },
    {
        text: "Project",
        items: [
            { text: "Contributing", link: "/contributing" },
            { text: "Credits", link: "/credits" },
            { text: "License", link: "/license" },
        ],
    },
];

export default defineConfig({
    title: "Circuit",
    description: circuit.description,
    lang: "en",
    cleanUrls: true,
    lastUpdated: true,

    sitemap: {
        hostname: circuit.homepage,
    },

    head: [
        ["meta", { name: "author", content: circuit.author.name }],
        ["meta", { name: "robots", content: "index, follow, max-image-preview:large, max-snippet:-1" }],
        ["meta", { name: "theme-color", content: "#0a47b8" }],
        ["link", { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" }],
        // Special Gothic is shared by the documentation site and Circuit Studio, and served from the site itself.
        ["link", { rel: "preload", href: "/fonts/special-gothic-latin.woff2", as: "font", type: "font/woff2", crossorigin: "" }],
        // An Academy lesson whose level is still closed is hidden behind its gate before the page is drawn.
        ["script", {}, Progress.LOCK_SCRIPT],
    ],

    // A page without a description of its own is described by its first paragraph, so each page shows its own words in search results.
    transformPageData(pageData, { siteConfig }) {
        if (pageData.frontmatter.description || pageData.isNotFound) return;

        const description = Seo.describe(`${siteConfig.srcDir}/${pageData.relativePath}`);
        if (description) pageData.description = description;
    },

    transformHead: ({ pageData }) =>
        Seo.head(pageData, {
            hostname: circuit.homepage,
            name: "Circuit",
            description: circuit.description,
            repository,
            version: circuit.version,
            sidebar: [...sidebar, ...Academy.SIDEBAR],
        }),

    // Code is set on a navy ground in both themes, like the editor in the home page's drawing.
    markdown: {
        theme: { light: "github-dark", dark: "github-dark" },
    },

    themeConfig: {
        nav: [
            { text: "Guide", link: "/guide/introduction" },
            { text: "Academy", link: "/academy/", activeMatch: "^/academy/" },
            { text: "Studio", link: "/studio/" },
            { text: "Platforms", link: "/platforms/" },
            { text: "Reference", link: "/reference/model" },
            { text: "Releases", link: `${repository}/releases` },
        ],

        // The Academy keeps a sidebar of its own, so its lessons are never mixed in with the documentation.
        sidebar: { "/academy/": Academy.SIDEBAR, "/": sidebar },

        socialLinks: [{ icon: "github", link: repository }],

        editLink: {
            pattern: `${repository}/edit/main/docs/:path`,
        },

        // The outline beside each page lists its second- and third-level headings.
        outline: { level: [2, 3], label: "On this page" },

        search: {
            provider: "local",
            options: {
                translations: { button: { buttonText: "Search docs" } },
            },
        },

        footer: {
            message: "Released under the Business Source License 1.1.",
            copyright: "Copyright 2026 PT Hobimu Jadi Cuan.",
        },
    },
});
