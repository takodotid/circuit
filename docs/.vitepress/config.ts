import { defineConfig, type DefaultTheme } from "vitepress";
import circuit from "../../package.json";
import { Academy } from "./academy";
import { Seo } from "./seo";
import { Progress } from "./theme/academy/progress";

const repository = circuit.repository.url.replace(/^git\+/, "").replace(/\.git$/, "");

const sidebar: DefaultTheme.SidebarItem[] = [
    {
        text: "Guide",
        items: [
            { text: "Introduction", link: "/guide/introduction" },
            { text: "Getting started", link: "/guide/getting-started" },
            { text: "Devices", link: "/guide/devices" },
            { text: "The network", link: "/guide/network" },
            { text: "Secrets", link: "/guide/secrets" },
            { text: "CLI commands", link: "/guide/cli" },
            { text: "Printing the graph", link: "/guide/graph" },
            { text: "Finding a free address", link: "/guide/addresses" },
            { text: "Scheduled refresh", link: "/guide/scheduled-refresh" },
            { text: "How a change is applied", link: "/guide/convergence" },
            { text: "BGP communities", link: "/guide/communities" },
            { text: "Publishing the network", link: "/guide/publishing" },
            { text: "Helpers", link: "/guide/helpers" },
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
            { text: "Hosting", link: "/studio/hosting" },
        ],
    },
    {
        text: "Working with others",
        items: [
            { text: "AI agents", link: "/integrations/ai-agents" },
            { text: "1Password", link: "/integrations/1password" },
            { text: "Prometheus", link: "/integrations/prometheus" },
            { text: "LibreNMS", link: "/integrations/librenms" },
        ],
    },
    {
        text: "Patterns",
        items: [
            { text: "Overview", link: "/patterns/" },
            { text: "A single site", link: "/patterns/single-site" },
            { text: "An edge router", link: "/patterns/edge-router" },
            { text: "Colocation with tenants", link: "/patterns/colocation" },
        ],
    },
    {
        text: "Use cases",
        items: [
            { text: "Overview", link: "/use-cases/" },
            { text: "Selling IP transit", link: "/use-cases/ip-transit" },
            { text: "Selling IX-only transit", link: "/use-cases/ix-transit" },
            { text: "Running an internet exchange", link: "/use-cases/internet-exchange" },
        ],
    },
    {
        text: "Platforms",
        items: [
            { text: "Support", link: "/platforms/" },
            { text: "RouterOS", link: "/platforms/routeros" },
            { text: "VRP", link: "/platforms/vrp" },
            { text: "Raisecom ROS", link: "/platforms/raisecom-ros" },
            { text: "Junos", link: "/platforms/junos" },
            { text: "FortiOS", link: "/platforms/fortios" },
        ],
    },
    {
        text: "Reference",
        items: [{ text: "Schema", link: "/reference/schema" }],
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
            { text: "Patterns", link: "/patterns/" },
            { text: "Use cases", link: "/use-cases/" },
            { text: "Platforms", link: "/platforms/" },
            { text: "Reference", link: "/reference/schema" },
            { text: "Releases", link: `${repository}/releases` },
        ],

        // The Academy keeps a sidebar of its own, so its lessons are never mixed in with the documentation.
        sidebar: { "/academy/": Academy.SIDEBAR, "/": sidebar },

        socialLinks: [
            { icon: "npm", link: `https://www.npmjs.com/package/${circuit.name}` },
            { icon: "github", link: repository },
        ],

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
