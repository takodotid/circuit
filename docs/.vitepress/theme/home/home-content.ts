// What the home page lists below its opening: the commands to start with, the steps of a change, the patterns, the platforms, the Academy's levels and the networks that run Circuit.

import circuit from "../../../../package.json";
import { Catalog } from "../../../../src/platforms/catalog";
import { Academy } from "../../academy";
import { data as templateFiles } from "../templates.data";

export class HomeContent {
    static readonly INSTALL = "npx @takodotid/circuit new";

    static readonly REPOSITORY = circuit.repository.url.replace(/^git\+/, "").replace(/\.git$/, "");
    static readonly RELEASES = `${HomeContent.REPOSITORY}/releases`;
    static readonly NPM = `https://www.npmjs.com/package/${circuit.name}`;
    static readonly EMAIL = circuit.author.email;

    // Starting a project with each package manager, as the getting started page writes it.
    static readonly STARTERS = [
        { name: "npm", command: HomeContent.INSTALL },
        { name: "pnpm", command: "pnpm dlx @takodotid/circuit new" },
        { name: "Bun", command: "bunx @takodotid/circuit new" },
    ];

    static readonly STEPS = [
        {
            title: "Change the file.",
            text: "VLANs, ports, addresses, routing, firewall: the same words for every vendor. Your editor checks every name as you type.",
            command: "edge-b1.ts",
            file: true,
        },
        {
            title: "Check it.",
            text: "Circuit catches what a device cannot do, and any rule of your own that the change breaks.",
            command: "npx circuit validate",
        },
        {
            title: "Read the plan.",
            text: "Every command that would be sent, in the vendor's own language, before anything is sent.",
            command: "npx circuit diff",
        },
        {
            title: "Confirm.",
            text: "Circuit applies the change the safest way the device allows, and keeps it only once it can still log in afterwards.",
            command: "npx circuit apply edge-b1 --confirm",
        },
    ];

    static readonly PATTERNS = [
        { name: "A single site", id: "single-site", text: "A home, an office or an internal network. A router and a switch, no BGP." },
        { name: "An edge router", id: "edge-router", text: "Your own AS number, with an IP transit and an internet exchange." },
        { name: "Colocation with tenants", id: "colocation", text: "Customers who each get their own VLANs, addresses and ports." },
    ].map((pattern) => ({ ...pattern, files: templateFiles[pattern.id] ?? [] }));

    static readonly PLATFORMS = [
        { name: "MikroTik RouterOS 7", platform: "routeros" },
        { name: "Huawei VRP", platform: "vrp" },
        { name: "Raisecom ROS", platform: "raisecom-ros" },
    ].map((entry) => ({ ...entry, models: Object.keys(Catalog.MODELS[entry.platform as keyof typeof Catalog.MODELS]) }));

    // Circuit Academy's levels, each with the first lessons it teaches.
    static readonly LEVELS = Academy.LEVELS.map((level) => ({
        ...level,
        link: `/academy/#${level.slug}`,
        first: level.lessons.slice(0, 4).map((lesson) => lesson.title),
        more: Math.max(0, level.lessons.length - 4),
    }));

    static readonly FIRST_LESSON = `/academy/${Academy.LEVELS[0]!.slug}/${Academy.LEVELS[0]!.lessons[0]!.slug}`;

    // Networks that run on Circuit in production. Each logo uses the page's ink, so one image works in light and dark.
    static readonly USERS = [{ name: "Tako", logo: "/users/tako.png", link: "https://tako.id", width: 1292, height: 602 }];
}
