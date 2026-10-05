import { defineConfig } from "vitepress";
import circuit from "../../package.json";

const repository = circuit.repository.url.replace(/^git\+/, "").replace(/\.git$/, "");

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
        ["link", { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" }],
        // Newsreader, for the headings of the home page.
        ["link", { rel: "preconnect", href: "https://fonts.googleapis.com" }],
        ["link", { rel: "preconnect", href: "https://fonts.gstatic.com", crossorigin: "" }],
        [
            "link",
            {
                rel: "stylesheet",
                href: "https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;1,6..72,400&display=swap",
            },
        ],
    ],

    themeConfig: {
        nav: [
            { text: "Guide", link: "/guide/introduction" },
            { text: "Patterns", link: "/patterns/" },
            { text: "Platforms", link: "/platforms/" },
            { text: "Reference", link: "/reference/schema" },
            { text: "Releases", link: `${repository}/releases` },
        ],

        sidebar: [
            {
                text: "Guide",
                items: [
                    { text: "Introduction", link: "/guide/introduction" },
                    { text: "Getting started", link: "/guide/getting-started" },
                    { text: "Devices", link: "/guide/devices" },
                    { text: "The network", link: "/guide/network" },
                    { text: "Secrets", link: "/guide/secrets" },
                    { text: "Commands", link: "/guide/commands" },
                    { text: "How a change is applied", link: "/guide/convergence" },
                    { text: "BGP communities", link: "/guide/communities" },
                    { text: "Publishing the network", link: "/guide/publishing" },
                    { text: "Presets", link: "/guide/presets" },
                    { text: "Questions", link: "/guide/questions" },
                    { text: "Words used here", link: "/guide/glossary" },
                ],
            },
            {
                text: "Working with others",
                items: [
                    { text: "AI agents", link: "/integrations/ai-agents" },
                    { text: "1Password", link: "/integrations/1password" },
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
                text: "Platforms",
                items: [
                    { text: "Support", link: "/platforms/" },
                    { text: "RouterOS", link: "/platforms/routeros" },
                    { text: "VRP", link: "/platforms/vrp" },
                    { text: "Raisecom ROS", link: "/platforms/raisecom-ros" },
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
        ],

        socialLinks: [{ icon: "github", link: repository }],

        editLink: {
            pattern: `${repository}/edit/main/docs/:path`,
        },

        search: {
            provider: "local",
        },

        footer: {
            message: "Released under the Business Source License 1.1.",
            copyright: "Copyright 2026 PT Hobimu Jadi Cuan.",
        },
    },
});
