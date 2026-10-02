import { defineConfig } from "vitepress";

export default defineConfig({
    title: "Circuit",
    description: "Declarative, vendor-neutral network configuration.",
    lang: "en",
    cleanUrls: true,
    lastUpdated: true,

    sitemap: {
        hostname: "https://circuit.tako.id",
    },

    head: [["meta", { name: "author", content: "Tako Network Engineering Team" }]],

    themeConfig: {
        nav: [
            { text: "Guide", link: "/guide/introduction" },
            { text: "Platforms", link: "/platforms/" },
            { text: "Reference", link: "/reference/schema" },
            { text: "Releases", link: "https://github.com/takodotid/circuit/releases" },
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
                    { text: "How a device converges", link: "/guide/convergence" },
                    { text: "Publishing the network", link: "/guide/publishing" },
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

        socialLinks: [{ icon: "github", link: "https://github.com/takodotid/circuit" }],

        editLink: {
            pattern: "https://github.com/takodotid/circuit/edit/main/docs/:path",
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
