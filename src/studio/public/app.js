// @ts-check
/// <reference lib="dom" />
// Studio's page: loads what the server gathered from the config, shows the place the address names, and loads again whenever the server says the config changed.

import { byId, go } from "./dom.js";
import { currentLayer, isLayer, setGraph, showLayer } from "./graph.js";
import { problemCount, showTables } from "./tables.js";

/** @typedef {import("../data").StudioData} StudioData */

const views = byId("views");
const search = /** @type {HTMLInputElement} */ (byId("search"));
const summary = byId("summary");
const live = byId("live");
const banner = byId("banner");
const graphView = byId("graph-view");
const tablesView = byId("tables-view");
const tables = byId("tables");
const problems = byId("problem-count");

/** What the server gathered last. @type {StudioData | undefined} */
let studio;
/** The address last shown, so drawing the same place again keeps where the reader had scrolled to. */
let shownRoute = "";

for (const button of views.querySelectorAll("button")) {
    const view = button.dataset.view ?? "graph";
    button.addEventListener("click", () => go(view === "graph" ? `graph/${currentLayer()}` : view));
}

function showSummary() {
    if (!studio) return;

    const { graph } = studio;
    const devices = studio.devices.length;
    const errors = graph.findings.filter((finding) => finding.level === "error").length;
    const warnings = graph.findings.length - errors;
    const drifted = Object.values(graph.drift).filter((drift) => drift.status === "differs").length;

    const count = problemCount(studio);
    problems.textContent = count ? String(count) : "";

    summary.textContent = [
        `${devices} ${devices === 1 ? "device" : "devices"}`,
        `${errors} ${errors === 1 ? "error" : "errors"}`,
        `${warnings} ${warnings === 1 ? "warning" : "warnings"}`,
        `${drifted} unlike the snapshot`,
    ].join(" · ");
}

/** Show the place the address names, such as `#graph/bgp` or `#devices/edge-01/ports`. */
function route() {
    if (!studio) return;

    const parts = location.hash.slice(1).split("/").map(decodeURIComponent).filter(Boolean);
    const [view] = parts;

    // An address from before the tables, such as `#bgp`, still opens that layer.
    const isGraph = !view || view === "graph" || isLayer(view);
    const asked = view === "graph" ? parts[1] : view;

    const moved = location.hash !== shownRoute;
    shownRoute = location.hash;

    for (const button of views.querySelectorAll("button")) {
        const pressed = isGraph ? button.dataset.view === "graph" : button.dataset.view === view;
        button.setAttribute("aria-pressed", String(pressed));
    }

    graphView.hidden = !isGraph;
    tablesView.hidden = isGraph;

    if (view === "search") {
        if (search.value !== (parts[1] ?? "")) search.value = parts[1] ?? "";
    } else if (document.activeElement !== search) {
        search.value = "";
    }

    showSummary();

    if (isGraph) {
        showLayer(isLayer(asked) ? asked : currentLayer());
        return;
    }

    const scrolled = tables.scrollTop;
    showTables(parts, tables, studio);
    tables.scrollTop = moved ? 0 : scrolled;
}

window.addEventListener("hashchange", route);

/** @type {ReturnType<typeof setTimeout> | undefined} */
let searching;

search.addEventListener("input", () => {
    clearTimeout(searching);

    const query = search.value.trim();
    searching = setTimeout(() => go(query ? `search/${encodeURIComponent(query)}` : "devices"), 200);
});

/** Load what studio shows, at the start and whenever the server says the config changed. */
async function load() {
    /** @type {(StudioData & { error?: undefined }) | { error: string }} */
    let next;

    try {
        next = await (await fetch("data", { cache: "no-store" })).json();
    } catch (error) {
        next = { error: `could not reach circuit studio: ${error instanceof Error ? error.message : String(error)}` };
    }

    if (next.error !== undefined) {
        banner.textContent = `The config could not be read, so what is shown is the last that could:\n${next.error}`;
        banner.hidden = false;
        return;
    }

    banner.hidden = true;
    studio = next;
    setGraph(next.graph);
    route();
}

const events = new EventSource("events");

events.addEventListener("open", () => {
    live.textContent = "live";
    live.title = "Watching the config: a saved change shows here at once.";
    live.classList.add("on");
});

events.addEventListener("error", () => {
    live.textContent = "not connected";
    live.title = "Studio is not answering. Is circuit studio still running?";
    live.classList.remove("on");
});

// The config changed: load it again. The page itself changed, while working on Circuit: load the page again.
events.addEventListener("message", (event) => (event.data === "page" ? location.reload() : void load()));

void load();
