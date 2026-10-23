// @ts-check
/// <reference lib="dom" />
// Comparing the network now with another branch, tag or commit: which devices changed and how their config differs, what the graph gains and loses, and what validate finds newly or no longer.

import { Dom } from "./dom.js";
import { Evaluate } from "./evaluate.js";
import { Graph } from "./graph.js";
import { Tables } from "./tables.js";

/** @typedef {import("../data").StudioData} StudioData */
/** @typedef {import("../git").Commit} Commit */
/** @typedef {{ commit: Commit, network: StudioData & { error?: undefined }, error?: undefined } | { error: string }} Comparison */

export class Compare {
    /** Comparisons asked for, by the name asked for, kept while the page is open. @type {Map<string, Promise<Comparison>>} */
    static #asked = new Map();

    /** @type {Promise<{ names: string[], commits: Commit[] } | { error: string }> | undefined} */
    static #references;

    /**
     * Read JSON from the server, or what went wrong.
     *
     * @template T
     * @param {string} path
     * @returns {Promise<T | { error: string }>}
     */
    static async fetchJson(path) {
        try {
            return await (await fetch(path, { cache: "no-store" })).json();
        } catch (error) {
            return { error: error instanceof Error ? error.message : String(error) };
        }
    }

    /**
     * A commit in a line: its short name, subject, author and day.
     *
     * @param {Commit} commit
     */
    static #describeCommit(commit) {
        return `${commit.short}, ${commit.subject}, by ${commit.author} on ${new Date(commit.date).toLocaleDateString()}`;
    }

    /**
     * The picker: a branch, tag or recent commit, or any name typed.
     *
     * @param {string | undefined} current
     */
    static #picker(current) {
        const input = Dom.h("input", { type: "text", value: current ?? "", placeholder: "main, a tag, or a commit", spellcheck: "false" });
        const list = Dom.h("select", {}, Dom.h("option", { value: "" }, "Pick one…"));
        list.addEventListener("change", () => {
            if (list.value) Dom.go(`compare/${encodeURIComponent(list.value)}`);
        });

        Compare.#references ??= Compare.fetchJson("refs");
        void Compare.#references.then((found) => {
            if ("error" in found) return list.replaceChildren(Dom.h("option", { value: "" }, "No git history here"));
            const names = found.names.map((name) => Dom.h("option", { value: name }, name));
            const commits = found.commits.map((commit) => Dom.h("option", { value: commit.commit }, Compare.#describeCommit(commit)));
            list.append(
                Dom.h("optgroup", { label: "Branches and tags" }, ...names),
                Dom.h("optgroup", { label: "Latest commits" }, ...commits)
            );
        });

        const compare = Dom.h("button", { type: "submit", class: "primary" }, "Compare");
        compare.addEventListener("click", (event) => {
            event.preventDefault();
            if (input.value.trim()) Dom.go(`compare/${encodeURIComponent(input.value.trim())}`);
        });

        return Dom.h(
            "form",
            { class: "tool-form" },
            Dom.h("label", { class: "field" }, Dom.h("span", {}, "Branch, tag or commit"), list),
            Dom.h("label", { class: "field" }, Dom.h("span", {}, "Or a name"), input),
            compare
        );
    }

    /**
     * @param {HTMLElement} area
     * @param {string} name
     * @param {Commit} commit
     * @param {StudioData} before
     * @param {StudioData} after
     */
    static #showDifferences(area, name, commit, before, after) {
        const found = Evaluate.compareNetworks(before, after);
        const { devices, edges, findings } = found;
        const nothing =
            !devices.added.length && !devices.removed.length && !devices.changed.length && !edges.added.length && !edges.removed.length;

        const layers = [...new Set([...edges.added, ...edges.removed].map((edge) => edge.layer))];
        const showGraph = Dom.link("Show the changes in the graph", () => {
            Graph.setComparison({ name, added: edges.added, removed: edges.removed });
            Dom.go(`graph/${layers[0] ?? "l1"}`);
        });

        area.append(
            Dom.h("p", {}, "Your files now, beside ", Dom.h("strong", {}, name), `: ${Compare.#describeCommit(commit)}.`),
            nothing
                ? Tables.empty("Nothing differs: every device would run the same, and the graph is the same.")
                : Dom.h(
                      "p",
                      {},
                      `${devices.changed.length} changed, ${devices.added.length} added and ${devices.removed.length} removed ${devices.changed.length + devices.added.length + devices.removed.length === 1 ? "device" : "devices"}; ${edges.added.length} ${edges.added.length === 1 ? "line" : "lines"} of the graph added and ${edges.removed.length} gone. `,
                      layers.length ? showGraph : undefined
                  )
        );

        if (devices.added.length || devices.removed.length) {
            area.append(
                Tables.heading("Devices added and removed"),
                Tables.of({
                    head: ["Device", "Change"].map((label) => ({ label })),
                    rows: [
                        ...devices.added.map((device) => ({ cells: [Tables.deviceLink(device), "added"] })),
                        ...devices.removed.map((device) => ({ cells: [device, "removed"] })),
                    ],
                })
            );
        }

        if (devices.changed.length) {
            area.append(
                Tables.heading("Config that changes"),
                Tables.prose(
                    "What each device would run, ",
                    Dom.h("span", { class: "removed" }, "then -"),
                    " and ",
                    Dom.h("span", { class: "added" }, "now +"),
                    "."
                )
            );

            for (const device of devices.changed) {
                area.append(
                    Dom.h(
                        "details",
                        { class: "change" },
                        Dom.h("summary", {}, device),
                        Tables.lineDiff(before.rendered[device] ?? "", after.rendered[device] ?? "")
                    )
                );
            }
        }

        if (edges.added.length || edges.removed.length) {
            const nameOf = (/** @type {string} */ id) =>
                [...after.graph.nodes, ...before.graph.nodes].find((node) => node.id === id)?.label ?? id;

            area.append(
                Tables.heading("The graph"),
                Tables.of({
                    csv: `compare-${name}-graph`,
                    head: ["Layer", "Change", "What", "From", "To"].map((label) => ({ label })),
                    rows: [
                        ...edges.added.map((edge) => ({
                            cells: [
                                Graph.LAYER_NAMES[edge.layer],
                                Dom.h("span", { class: "added" }, "added"),
                                edge.label,
                                nameOf(edge.from),
                                nameOf(edge.to),
                            ],
                        })),
                        ...edges.removed.map((edge) => ({
                            cells: [
                                Graph.LAYER_NAMES[edge.layer],
                                Dom.h("span", { class: "removed" }, "gone"),
                                edge.label,
                                nameOf(edge.from),
                                nameOf(edge.to),
                            ],
                        })),
                    ],
                })
            );
        }

        if (findings.added.length || findings.resolved.length) {
            area.append(
                Dom.h("h3", {}, "Found by ", Dom.h("code", {}, "circuit validate")),
                Tables.of({
                    head: ["", "Device", "Message"].map((label) => ({ label })),
                    rows: [
                        ...findings.added.map((one) => ({
                            cells: [Dom.h("span", { class: "removed" }, `new ${one.level}`), one.device ?? "the network", one.message],
                        })),
                        ...findings.resolved.map((one) => ({
                            cells: [Dom.h("span", { class: "added" }, `no longer`), one.device ?? "the network", one.message],
                        })),
                    ],
                })
            );
        }
    }

    /**
     * Draw the comparison the address names, such as `["compare", "main"]`, into a container.
     *
     * @param {string[]} route
     * @param {HTMLElement} container
     * @param {StudioData} now
     */
    static show(route, container, now) {
        container.replaceChildren();
        const [, name] = route;

        container.append(
            Tables.heading("Compare", "h2"),
            Tables.prose(
                "Your files now, beside another branch, tag or commit: which devices change and how, what the graph gains and loses, and what ",
                Dom.h("code", {}, "circuit validate"),
                " finds newly or no longer. Studio reads the other commit with the Circuit installed now."
            ),
            Compare.#picker(name)
        );

        if (!name) return;

        const area = Dom.h("div", {}, Tables.empty(`Reading the network at ${name}…`));
        container.append(area);

        if (!Compare.#asked.has(name))
            Compare.#asked.set(name, /** @type {Promise<Comparison>} */ (Compare.fetchJson(`compare?ref=${encodeURIComponent(name)}`)));
        const shown = location.hash;

        void Compare.#asked.get(name)?.then((result) => {
            // The reader may have gone elsewhere while it was read.
            if (location.hash !== shown) return;
            area.replaceChildren();

            if (result.error !== undefined) {
                Compare.#asked.delete(name);
                return area.append(Tables.empty(`It could not be read: ${result.error}`));
            }

            if (result.network.error !== undefined) {
                Compare.#asked.delete(name);
                return area.append(Tables.empty(`Its config could not be read: ${result.network.error}`));
            }

            Compare.#showDifferences(area, name, result.commit, result.network, now);
        });
    }
}
