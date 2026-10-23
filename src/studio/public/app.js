// @ts-check
/// <reference lib="dom" />
// Studio's page: loads what the server gathered from the config, shows the place the address names, and loads again whenever the server says the config changed.

import { Dom } from "./dom.js";
import { Graph } from "./graph.js";
import { Tables } from "./tables.js";
import { Tools } from "./tools.js";
import { Compare } from "./compare.js";

/** @typedef {import("../data").StudioData} StudioData */

export class App {
    static #views = Dom.byId("views");
    static #search = /** @type {HTMLInputElement} */ (Dom.byId("search"));
    static #summary = Dom.byId("summary");
    static #live = Dom.byId("live");
    static #banner = Dom.byId("banner");
    static #graphView = Dom.byId("graph-view");
    static #tablesView = Dom.byId("tables-view");
    static #tables = Dom.byId("tables");
    static #problems = Dom.byId("problem-count");

    /** What the server gathered last. @type {StudioData | undefined} */
    static #studio;
    /** The address last shown, so drawing the same place again keeps where the reader had scrolled to. */
    static #shownRoute = "";

    /** @type {ReturnType<typeof setTimeout> | undefined} */
    static #searching;

    static #showSummary() {
        const studio = App.#studio;
        if (!studio) return;

        const { graph } = studio;
        const devices = studio.devices.length;
        const errors = graph.findings.filter((finding) => finding.level === "error").length;
        const warnings = graph.findings.length - errors;
        const drifted = Object.values(graph.drift).filter((drift) => drift.status === "differs").length;

        const count = Tables.problemCount(studio);
        App.#problems.textContent = count ? String(count) : "";

        const items = [
            { value: devices, label: devices === 1 ? "device" : "devices", state: "neutral" },
            { value: errors, label: errors === 1 ? "error" : "errors", state: errors ? "error" : "quiet" },
            { value: warnings, label: warnings === 1 ? "warning" : "warnings", state: warnings ? "warning" : "quiet" },
            { value: drifted, label: "unlike the snapshot", state: drifted ? "changed" : "quiet" },
        ];

        App.#summary.replaceChildren(
            ...items.map(({ value, label, state }) => {
                const item = document.createElement("span");
                item.className = `summary-item ${state}`;
                item.append(String(value), ` ${label}`);
                return item;
            })
        );
    }

    /** Show the place the address names, such as `#graph/bgp` or `#devices/edge-01/ports`. */
    static #route() {
        const studio = App.#studio;
        if (!studio) return;

        const parts = location.hash.slice(1).split("/").map(decodeURIComponent).filter(Boolean);
        const [view] = parts;

        // An address from before the tables, such as `#bgp`, still opens that layer.
        const isGraph = !view || view === "graph" || Graph.isLayer(view);
        const asked = view === "graph" ? parts[1] : view;

        const moved = location.hash !== App.#shownRoute;
        App.#shownRoute = location.hash;

        for (const button of App.#views.querySelectorAll("button")) {
            const pressed = isGraph ? button.dataset.view === "graph" : button.dataset.view === view;
            button.setAttribute("aria-pressed", String(pressed));
        }

        App.#graphView.hidden = !isGraph;
        App.#tablesView.hidden = isGraph;

        if (view === "search") {
            if (App.#search.value !== (parts[1] ?? "")) App.#search.value = parts[1] ?? "";
        } else if (document.activeElement !== App.#search) {
            App.#search.value = "";
        }

        App.#showSummary();

        if (isGraph) {
            Graph.show(Graph.isLayer(asked) ? asked : Graph.currentLayer());
            return;
        }

        const tables = App.#tables;
        const scrolled = tables.scrollTop;
        if (view === "tools") Tools.show(parts, tables, studio);
        else if (view === "compare") Compare.show(parts, tables, studio);
        else Tables.show(parts, tables, studio);
        tables.scrollTop = moved ? 0 : scrolled;

        // A new place comes in; the same place drawn again, because the config changed, stays still.
        if (moved) Dom.enter(tables);
    }

    /** Load what Studio shows, at the start and whenever the server says the config changed. */
    static async #load() {
        /** @type {(StudioData & { error?: undefined }) | { error: string }} */
        let next;

        try {
            next = await (await fetch("data", { cache: "no-store" })).json();
        } catch (error) {
            next = { error: `could not reach circuit studio: ${error instanceof Error ? error.message : String(error)}` };
        }

        if (next.error !== undefined) {
            App.#banner.textContent = `The config could not be read, so what is shown is the last that could:\n${next.error}`;
            App.#banner.hidden = false;
            return;
        }

        App.#banner.hidden = true;
        App.#studio = next;
        Graph.set(next.graph);
        App.#route();
    }

    /** Wire up the page and load what it shows. */
    static start() {
        for (const button of App.#views.querySelectorAll("button")) {
            const view = button.dataset.view ?? "graph";
            button.addEventListener("click", () => Dom.go(view === "graph" ? `graph/${Graph.currentLayer()}` : view));
        }

        window.addEventListener("hashchange", App.#route);

        // A menu closes once one of its items is chosen, or when the reader clicks anywhere else.
        document.addEventListener("click", (event) => {
            const target = event.target instanceof Element ? event.target : undefined;

            for (const menu of document.querySelectorAll("details.menu[open]")) {
                if (!target || !menu.contains(target) || target.closest(".menu-items button")) menu.removeAttribute("open");
            }
        });

        App.#search.addEventListener("input", () => {
            clearTimeout(App.#searching);

            const query = App.#search.value.trim();
            App.#searching = setTimeout(() => Dom.go(query ? `search/${encodeURIComponent(query)}` : "devices"), 200);
        });

        const events = new EventSource("events");
        const live = App.#live;

        events.addEventListener("open", () => {
            live.textContent = "live";
            live.title = "Watching the config: a saved change shows here at once.";
            live.classList.add("on");
        });

        events.addEventListener("error", () => {
            live.textContent = "not connected";
            live.title = "Circuit Studio is not answering. Is circuit studio still running?";
            live.classList.remove("on");
        });

        // The config changed: load it again, and the live mark beats once to say so. The page itself changed, while working on Circuit: load the page again.
        events.addEventListener("message", (event) => {
            if (event.data === "page") return location.reload();

            live.classList.remove("beat");
            void live.offsetWidth;
            live.classList.add("beat");
            void App.#load();
        });

        void App.#load();
    }
}

App.start();
