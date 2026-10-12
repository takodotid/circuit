// @ts-check
/// <reference lib="dom" />
// Comparing the network now with another branch, tag or commit: which devices changed and how their config differs, what the graph gains and loses, and what validate finds newly or no longer.

import { go, h, link } from "./dom.js";
import { compareNetworks } from "./evaluate.js";
import { LAYER_NAMES, setComparison } from "./graph.js";
import { deviceLink, empty, heading, lineDiff, prose, table } from "./tables.js";

/** @typedef {import("../data").StudioData} StudioData */
/** @typedef {import("../git").Commit} Commit */
/** @typedef {{ commit: Commit, network: StudioData & { error?: undefined }, error?: undefined } | { error: string }} Comparison */

/** Comparisons asked for, by the name asked for, kept while the page is open. @type {Map<string, Promise<Comparison>>} */
const asked = new Map();

/** @type {Promise<{ names: string[], commits: Commit[] } | { error: string }> | undefined} */
let references;

/**
 * Read JSON from the server, or what went wrong.
 *
 * @template T
 * @param {string} path
 * @returns {Promise<T | { error: string }>}
 */
export async function fetchJson(path) {
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
export const describeCommit = (commit) =>
    `${commit.short}, ${commit.subject}, by ${commit.author} on ${new Date(commit.date).toLocaleDateString()}`;

/**
 * The picker: a branch, tag or recent commit, or any name typed.
 *
 * @param {string | undefined} current
 */
function picker(current) {
    const input = h("input", { type: "text", value: current ?? "", placeholder: "main, a tag, or a commit", spellcheck: "false" });
    const list = h("select", {}, h("option", { value: "" }, "Pick one…"));
    list.addEventListener("change", () => {
        if (list.value) go(`compare/${encodeURIComponent(list.value)}`);
    });

    references ??= fetchJson("refs");
    void references.then((found) => {
        if ("error" in found) return list.replaceChildren(h("option", { value: "" }, "No git history here"));
        const names = found.names.map((name) => h("option", { value: name }, name));
        const commits = found.commits.map((commit) => h("option", { value: commit.commit }, describeCommit(commit)));
        list.append(h("optgroup", { label: "Branches and tags" }, ...names), h("optgroup", { label: "Latest commits" }, ...commits));
    });

    const compare = h("button", { type: "submit", class: "primary" }, "Compare");
    compare.addEventListener("click", (event) => {
        event.preventDefault();
        if (input.value.trim()) go(`compare/${encodeURIComponent(input.value.trim())}`);
    });

    return h(
        "form",
        { class: "tool-form" },
        h("label", { class: "field" }, h("span", {}, "Branch, tag or commit"), list),
        h("label", { class: "field" }, h("span", {}, "Or a name"), input),
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
function showDifferences(area, name, commit, before, after) {
    const found = compareNetworks(before, after);
    const { devices, edges, findings } = found;
    const nothing =
        !devices.added.length && !devices.removed.length && !devices.changed.length && !edges.added.length && !edges.removed.length;

    const layers = [...new Set([...edges.added, ...edges.removed].map((edge) => edge.layer))];
    const showGraph = link("Show the changes in the graph", () => {
        setComparison({ name, added: edges.added, removed: edges.removed });
        go(`graph/${layers[0] ?? "l1"}`);
    });

    area.append(
        h("p", {}, "Your files now, beside ", h("strong", {}, name), `: ${describeCommit(commit)}.`),
        nothing
            ? empty("Nothing differs: every device would run the same, and the graph is the same.")
            : h(
                  "p",
                  {},
                  `${devices.changed.length} changed, ${devices.added.length} added and ${devices.removed.length} removed ${devices.changed.length + devices.added.length + devices.removed.length === 1 ? "device" : "devices"}; ${edges.added.length} ${edges.added.length === 1 ? "line" : "lines"} of the graph added and ${edges.removed.length} gone. `,
                  layers.length ? showGraph : undefined
              )
    );

    if (devices.added.length || devices.removed.length) {
        area.append(
            heading("Devices added and removed"),
            table({
                head: ["Device", "Change"].map((label) => ({ label })),
                rows: [
                    ...devices.added.map((device) => ({ cells: [deviceLink(device), "added"] })),
                    ...devices.removed.map((device) => ({ cells: [device, "removed"] })),
                ],
            })
        );
    }

    if (devices.changed.length) {
        area.append(
            heading("Config that changes"),
            prose(
                "What each device would run, ",
                h("span", { class: "removed" }, "then -"),
                " and ",
                h("span", { class: "added" }, "now +"),
                "."
            )
        );

        for (const device of devices.changed) {
            area.append(
                h(
                    "details",
                    { class: "change" },
                    h("summary", {}, device),
                    lineDiff(before.rendered[device] ?? "", after.rendered[device] ?? "")
                )
            );
        }
    }

    if (edges.added.length || edges.removed.length) {
        const nameOf = (/** @type {string} */ id) =>
            [...after.graph.nodes, ...before.graph.nodes].find((node) => node.id === id)?.label ?? id;

        area.append(
            heading("The graph"),
            table({
                csv: `compare-${name}-graph`,
                head: ["Layer", "Change", "What", "From", "To"].map((label) => ({ label })),
                rows: [
                    ...edges.added.map((edge) => ({
                        cells: [
                            LAYER_NAMES[edge.layer],
                            h("span", { class: "added" }, "added"),
                            edge.label,
                            nameOf(edge.from),
                            nameOf(edge.to),
                        ],
                    })),
                    ...edges.removed.map((edge) => ({
                        cells: [
                            LAYER_NAMES[edge.layer],
                            h("span", { class: "removed" }, "gone"),
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
            h("h3", {}, "Found by ", h("code", {}, "circuit validate")),
            table({
                head: ["", "Device", "Message"].map((label) => ({ label })),
                rows: [
                    ...findings.added.map((one) => ({
                        cells: [h("span", { class: "removed" }, `new ${one.level}`), one.device ?? "the network", one.message],
                    })),
                    ...findings.resolved.map((one) => ({
                        cells: [h("span", { class: "added" }, `no longer`), one.device ?? "the network", one.message],
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
export function showCompare(route, container, now) {
    container.replaceChildren();
    const [, name] = route;

    container.append(
        heading("Compare", "h2"),
        prose(
            "Your files now, beside another branch, tag or commit: which devices change and how, what the graph gains and loses, and what ",
            h("code", {}, "circuit validate"),
            " finds newly or no longer. Studio reads the other commit with the Circuit installed now."
        ),
        picker(name)
    );

    if (!name) return;

    const area = h("div", {}, empty(`Reading the network at ${name}…`));
    container.append(area);

    if (!asked.has(name)) asked.set(name, /** @type {Promise<Comparison>} */ (fetchJson(`compare?ref=${encodeURIComponent(name)}`)));
    const shown = location.hash;

    void asked.get(name)?.then((result) => {
        // The reader may have gone elsewhere while it was read.
        if (location.hash !== shown) return;
        area.replaceChildren();

        if (result.error !== undefined) {
            asked.delete(name);
            return area.append(empty(`It could not be read: ${result.error}`));
        }

        if (result.network.error !== undefined) {
            asked.delete(name);
            return area.append(empty(`Its config could not be read: ${result.network.error}`));
        }

        showDifferences(area, name, result.commit, result.network, now);
    });
}
