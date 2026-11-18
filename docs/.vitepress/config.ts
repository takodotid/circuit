import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { defineConfig, type DefaultTheme } from "vitepress";
import circuit from "../../package.json";
import { Academy } from "./academy.ts";
import { Seo } from "./seo.ts";
import { Progress } from "./theme/academy/progress.ts";

const repository = circuit.repository.url.replace(/^git\+/, "").replace(/\.git$/, "");

const sidebar: DefaultTheme.SidebarItem[] = [
    {
        text: "Get started",
        items: [
            { text: "Introduction", link: "/guide/introduction" },
            { text: "Install", link: "/guide/install" },
            { text: "Your first project", link: "/guide/project" },
            { text: "Example projects", link: "/guide/examples" },
        ],
    },
    {
        text: "Write a project",
        items: [
            { text: "Rules", link: "/guide/rules" },
            { text: "Parts and merge", link: "/guide/parts" },
            { text: "BGP communities", link: "/guide/communities" },
            { text: "Checks", link: "/guide/checks" },
            { text: "Secrets", link: "/guide/secrets" },
        ],
    },
    {
        text: "Run it",
        items: [
            { text: "Make a change", link: "/guide/apply" },
            { text: "Run in CI", link: "/guide/ci" },
            { text: "Studio", link: "/studio/" },
            { text: "Studio tools", link: "/studio/tools" },
            { text: "Host Studio", link: "/studio/hosting" },
        ],
    },
    {
        text: "Integrations",
        items: [
            { text: "How sync works", link: "/integrations/" },
            { text: "NetBox", link: "/integrations/netbox" },
            { text: "LibreNMS", link: "/integrations/librenms" },
            { text: "PeeringDB", link: "/integrations/peeringdb" },
            { text: "Prometheus", link: "/integrations/prometheus" },
            { text: "1Password", link: "/integrations/1password" },
        ],
    },
    {
        text: "Reference",
        items: [
            { text: "The circuit command", link: "/reference/cli" },
            { text: "Platforms", link: "/reference/platforms" },
            { text: "Standards", link: "/reference/standards" },
            { text: "Glossary", link: "/reference/glossary" },
            { text: "FAQ", link: "/guide/faq" },
            { text: "The model", link: "/reference/model" },
        ],
    },
    {
        text: "About",
        items: [
            { text: "Contributing", link: "/contributing" },
            { text: "License and credits", link: "/license" },
        ],
    },
];

/** Pages that moved, and where to. The build writes a page at each old address that sends the reader on. */
const MOVED: Record<string, string> = {
    "guide/cli": "/reference/cli",
    "guide/glossary": "/reference/glossary",
    "platforms/index": "/reference/platforms",
    "platforms/features": "/reference/platforms#feature-matrix",
    credits: "/license#credits",
};

const redirect = (to: string) =>
    `<!doctype html><meta charset="utf-8"><title>Moved</title><meta name="robots" content="noindex"><link rel="canonical" href="${to}"><meta http-equiv="refresh" content="0; url=${to}"><script>location.replace(${JSON.stringify(to)} + (location.hash && !${JSON.stringify(to)}.includes("#") ? location.hash : ""))</script><a href="${to}">This page moved.</a>\n`;

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

    buildEnd({ outDir }) {
        for (const [from, to] of Object.entries(MOVED)) {
            mkdirSync(dirname(join(outDir, from)), { recursive: true });
            writeFileSync(join(outDir, `${from}.html`), redirect(to));
        }
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
            { text: "Reference", link: "/reference/cli" },
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
