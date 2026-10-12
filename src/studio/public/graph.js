// @ts-check
/// <reference lib="dom" />
// The graph view: a force layout of every node, drawn one layer at a time, with panning, zooming, dragging, and a side panel for what is selected.

import { byId, go, h, link, s, store, svgById } from "./dom.js";
import { pngOf, save, svgOf } from "./export.js";

/** @typedef {import("../../core/graph").GraphNode} GraphNode */
/** @typedef {import("../../core/graph").GraphEdge} GraphEdge */
/** @typedef {import("../../core/graph").Layer} Layer */
/** @typedef {import("../../core/graph").CarriedVlan} CarriedVlan */
/** @typedef {import("../../core/graph").Annotated} Annotated */
/** @typedef {{ x: number, y: number }} Point */
/** @typedef {{ node: string } | { edge: GraphEdge } | undefined} Selection */

/** @type {Record<Layer, string>} */
export const LAYER_NAMES = {
    l1: "Cables",
    l2: "VLANs",
    l3: "Addresses",
    bgp: "BGP",
    ospf: "OSPF",
    tunnels: "Tunnels",
};

/** @type {Record<Layer, string>} */
const LAYER_HELP = {
    l1: "Each cable a port's link names. A LAG's cables are one line.",
    l2: "The VLANs each cable carries. Pick a VLAN to light up every cable that carries it.",
    l3: "Prefixes two or more devices hold an address in, and point-to-point addresses. Loopbacks and prefixes only one device holds are left out.",
    bgp: "BGP sessions: between our devices, matched by the address each names, and to every AS outside.",
    ospf: "OSPF adjacencies: devices with OSPF in one area on one prefix, neither side passive.",
    tunnels: "GRE and VXLAN tunnels matched by their endpoints, and WireGuard peers.",
};

export const LAYERS = /** @type {Layer[]} */ (Object.keys(LAYER_NAMES));

/**
 * @param {string | undefined} name
 * @returns {name is Layer}
 */
export const isLayer = (name) => LAYERS.includes(/** @type {Layer} */ (name));

// The parts of index.html this view draws into.
const graphView = byId("graph-view");
const layersNav = byId("layers");
const svg = svgById("canvas");
const viewport = svgById("viewport");
const edgeLayer = svgById("edges");
const nodeLayer = svgById("nodes");
const panel = byId("panel");

// State.
/** @type {Annotated | undefined} */
let data;
/** @type {Layer} */
let layer = LAYERS.find((name) => name === store.get("layer")) ?? "l1";
/** The graph has been drawn while visible at least once; until then it is fitted when shown. */
let drawn = false;
/** @type {Selection} */
let selection;
/** @type {string | undefined} */
let hovered;
/** @type {number | undefined} */
let vlanFocus;
/** A VLAN to light up once the VLAN layer is shown, asked for from the tables. @type {number | undefined} */
let pendingVlan;
/** Cables to light up as one path, asked for from the tools, and those lit now. @type {GraphEdge[] | undefined} */
let pendingPath;
/** @type {Set<string> | undefined} */
let pathFocus;

/** @param {GraphEdge} edge */
const edgeKey = (edge) => `${edge.layer} ${edge.from} ${edge.to} ${edge.label}`;
let view = { x: 0, y: 0, k: 1 };

const saved = /** @type {Record<string, [number, number]>} */ (store.get("positions") ?? {});
/** @type {Map<string, Point>} */
const positions = new Map(Object.entries(saved).map(([id, [x, y]]) => [id, { x, y }]));

/** @type {Map<string, SVGGElement>} */
const nodeElements = new Map();
/** @type {{ edge: GraphEdge, group: SVGGElement, path: SVGPathElement, hit: SVGPathElement, label: SVGTextElement, offset: number }[]} */
const edgeElements = [];

function savePositions() {
    store.set("positions", Object.fromEntries([...positions].map(([id, point]) => [id, [Math.round(point.x), Math.round(point.y)]])));
}

/**
 * A number from 0 to 1 that is always the same for the same text, so a layout comes out the same each time.
 *
 * @param {string} text
 */
function hash(text) {
    let value = 2166136261;
    for (const char of text) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
    return (value >>> 0) / 4294967296;
}

/**
 * Place nodes with a force layout: every node pushes every other away, and each edge pulls its ends together. A node placed before keeps its place unless `fresh`, so the drawing does not jump when the config changes.
 * Every layer is laid out together, so a device stays where it is when the layer changes.
 *
 * @param {GraphNode[]} nodes
 * @param {GraphEdge[]} edges
 * @param {boolean} fresh
 */
function layout(nodes, edges, fresh) {
    if (fresh) positions.clear();

    const fixed = new Set(nodes.filter((node) => positions.has(node.id)).map((node) => node.id));
    /** @type {Map<string, Set<string>>} */
    const neighbors = new Map();

    for (const edge of edges) {
        if (edge.from === edge.to) continue;
        if (!neighbors.has(edge.from)) neighbors.set(edge.from, new Set());
        if (!neighbors.has(edge.to)) neighbors.set(edge.to, new Set());
        neighbors.get(edge.from)?.add(edge.to);
        neighbors.get(edge.to)?.add(edge.from);
    }

    // A new node starts beside a neighbor already placed, or on a circle.
    const radius = 60 * Math.sqrt(nodes.length + 1);

    for (const node of nodes) {
        if (positions.has(node.id)) continue;

        const angle = hash(node.id) * Math.PI * 2;
        const placed = [...(neighbors.get(node.id) ?? [])].map((id) => positions.get(id)).find(Boolean);
        const distance = placed ? 90 : radius;
        const origin = placed ?? { x: 0, y: 0 };

        positions.set(node.id, { x: origin.x + Math.cos(angle) * distance, y: origin.y + Math.sin(angle) * distance });
    }

    const moving = nodes.filter((node) => !fixed.has(node.id));
    if (!moving.length) return;

    const pairs = [...neighbors].flatMap(([from, tos]) => [...tos].filter((to) => from < to).map((to) => [from, to]));
    const ideal = 230;
    const rounds = fixed.size ? 200 : 500;

    /** @param {string} id */
    const at = (id) => /** @type {Point} */ (positions.get(id));

    for (let round = 0; round < rounds; round++) {
        const heat = 40 * (1 - round / rounds) + 1;
        const push = new Map(nodes.map((node) => [node.id, { x: 0, y: 0 }]));
        /** @param {string} id */
        const pushOf = (id) => /** @type {Point} */ (push.get(id));

        for (const [index, a] of nodes.entries()) {
            for (const b of nodes.slice(index + 1)) {
                let dx = at(a.id).x - at(b.id).x;
                let dy = at(a.id).y - at(b.id).y;

                // Two nodes in one place are pulled apart in a direction of their own.
                if (dx === 0 && dy === 0) {
                    dx = hash(a.id + b.id) - 0.5;
                    dy = hash(b.id + a.id) - 0.5;
                }

                // Nodes far apart no longer push, so parts that are not connected stay near each other.
                const distance = Math.max(Math.hypot(dx, dy), 1);
                if (distance > ideal * 3) continue;

                const force = (ideal * ideal) / distance;
                pushOf(a.id).x += (dx / distance) * force;
                pushOf(a.id).y += (dy / distance) * force;
                pushOf(b.id).x -= (dx / distance) * force;
                pushOf(b.id).y -= (dy / distance) * force;
            }
        }

        for (const [from, to] of pairs) {
            if (!from || !to || !positions.has(from) || !positions.has(to)) continue;

            const dx = at(from).x - at(to).x;
            const dy = at(from).y - at(to).y;
            const distance = Math.max(Math.hypot(dx, dy), 1);
            const force = (distance * distance) / ideal;
            pushOf(from).x -= (dx / distance) * force;
            pushOf(from).y -= (dy / distance) * force;
            pushOf(to).x += (dx / distance) * force;
            pushOf(to).y += (dy / distance) * force;
        }

        for (const node of moving) {
            const point = at(node.id);
            const force = pushOf(node.id);

            // A pull to the middle keeps parts that are not connected from drifting away.
            force.x -= point.x * 0.15;
            force.y -= point.y * 0.15;

            const length = Math.max(Math.hypot(force.x, force.y), 1);
            const step = Math.min(length, heat);
            point.x += (force.x / length) * step;
            point.y += (force.y / length) * step;
        }
    }

    savePositions();
}

// What is drawn.
const visibleEdges = () => data?.edges.filter((edge) => edge.layer === layer) ?? [];

/** @returns {GraphNode[]} */
function visibleNodes() {
    const ends = new Set(visibleEdges().flatMap((edge) => [edge.from, edge.to]));
    return data?.nodes.filter((node) => node.kind === "device" || ends.has(node.id)) ?? [];
}

/** @param {string} id */
const nodeById = (id) => data?.nodes.find((node) => node.id === id);

/**
 * @param {GraphNode} node
 * @returns {"error" | "warning" | undefined}
 */
function markOf(node) {
    if (!data || node.kind !== "device") return undefined;

    const findings = data.findings.filter((finding) => finding.device === node.label);
    if (findings.some((finding) => finding.level === "error")) return "error";

    const drift = data.drift[node.label]?.status;
    if (findings.length || drift === "differs" || drift === "cannot plan") return "warning";

    return undefined;
}

/**
 * @param {GraphEdge} edge
 * @param {number} offset
 * @returns {{ d: string, label: Point }}
 */
function curve(edge, offset) {
    const a = positions.get(edge.from) ?? { x: 0, y: 0 };
    const b = positions.get(edge.to) ?? { x: 0, y: 0 };
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };

    const length = Math.max(Math.hypot(b.x - a.x, b.y - a.y), 1);
    const normal = { x: -(b.y - a.y) / length, y: (b.x - a.x) / length };
    const control = { x: mid.x + normal.x * offset * 2, y: mid.y + normal.y * offset * 2 };

    return {
        d: `M${a.x},${a.y} Q${control.x},${control.y} ${b.x},${b.y}`,
        label: { x: mid.x + normal.x * offset, y: mid.y + normal.y * offset },
    };
}

/** Move what is drawn to where the nodes are now, without drawing it again. */
function place() {
    viewport.setAttribute("transform", `translate(${view.x},${view.y}) scale(${view.k})`);
    svg.classList.toggle("far", view.k < 0.4);

    for (const [id, group] of nodeElements) {
        const point = positions.get(id) ?? { x: 0, y: 0 };
        group.setAttribute("transform", `translate(${point.x},${point.y})`);
    }

    for (const { edge, path, hit, label, offset } of edgeElements) {
        const { d, label: middle } = curve(edge, offset);
        path.setAttribute("d", d);
        hit.setAttribute("d", d);
        label.setAttribute("x", String(middle.x));
        label.setAttribute("y", String(middle.y));
    }
}

function draw() {
    edgeLayer.replaceChildren();
    nodeLayer.replaceChildren();
    nodeElements.clear();
    edgeElements.length = 0;

    const edges = visibleEdges();

    // Edges between the same two nodes bend apart, so each stays readable.
    /** @type {Map<string, number>} */
    const between = new Map();
    /** @param {GraphEdge} edge */
    const pairOf = (edge) => [edge.from, edge.to].sort().join("|");
    for (const edge of edges) between.set(pairOf(edge), (between.get(pairOf(edge)) ?? 0) + 1);
    /** @type {Map<string, number>} */
    const seen = new Map();

    for (const edge of edges) {
        const pair = pairOf(edge);
        const index = seen.get(pair) ?? 0;
        seen.set(pair, index + 1);

        // Bend in one direction whichever way round the edge was written.
        const sign = edge.from < edge.to ? 1 : -1;
        const offset = (index - ((between.get(pair) ?? 1) - 1) / 2) * 34 * sign;

        const group = s("g", { class: `edge${edge.oneSided ? " one-sided" : ""}` });
        const hit = s("path", { class: "hit" });
        const path = s("path");
        const label = s("text", { "text-anchor": "middle", "dominant-baseline": "central" });
        label.textContent = edge.label;

        group.append(path, hit, label);

        // Selected on press: the canvas captures the pointer for panning, so no click would reach the edge.
        group.addEventListener("pointerdown", (event) => {
            event.stopPropagation();
            select({ edge });
        });

        edgeLayer.append(group);
        edgeElements.push({ edge, group, path, hit, label, offset });
    }

    for (const node of visibleNodes()) {
        const group = s("g", { class: `node ${node.kind} ${markOf(node) ?? ""}`, tabindex: 0 });
        const rect = s("rect", { rx: node.kind === "segment" ? 14 : 8 });
        group.append(rect);

        const lines = node.kind === "device" ? [node.label, node.detail[0] ?? ""] : [node.label];
        const texts = lines.map((line, index) => {
            const text = s("text", { class: index === 0 ? "name" : "sub", y: lines.length === 1 ? 0 : index === 0 ? -8 : 9 });
            text.textContent = line;
            group.append(text);
            return text;
        });

        nodeLayer.append(group);

        // Each box fits its text, so it is measured once drawn.
        const width = Math.max(...texts.map((text) => text.getComputedTextLength())) + 24;
        const height = lines.length === 1 ? 28 : 44;
        rect.setAttribute("x", String(-width / 2));
        rect.setAttribute("y", String(-height / 2));
        rect.setAttribute("width", String(width));
        rect.setAttribute("height", String(height));

        group.addEventListener("pointerdown", (event) => startDrag(event, node.id));
        group.addEventListener("pointerenter", () => {
            hovered = node.id;
            emphasize();
        });
        group.addEventListener("pointerleave", () => {
            hovered = undefined;
            emphasize();
        });
        group.addEventListener("keydown", (event) => event.key === "Enter" && select({ node: node.id }));

        nodeElements.set(node.id, group);
    }

    place();
    emphasize();
}

/** Light up what the pointer is on, or what is selected, and dim the rest. */
function emphasize() {
    const focus = hovered ?? (selection && "node" in selection ? selection.node : undefined);
    const selectedEdge = selection && "edge" in selection ? selection.edge : undefined;

    /** @param {GraphEdge} edge */
    const touching = (edge) => edge.from === focus || edge.to === focus;
    /** @param {GraphEdge} edge */
    const carries = (edge) => edge.vlans?.some((vlan) => vlan.id === vlanFocus) ?? false;

    /** @type {Set<GraphEdge> | undefined} */
    let litEdges;
    if (focus) litEdges = new Set(edgeElements.filter(({ edge }) => touching(edge)).map(({ edge }) => edge));
    else if (pathFocus) litEdges = new Set(edgeElements.filter(({ edge }) => pathFocus?.has(edgeKey(edge))).map(({ edge }) => edge));
    else if (vlanFocus !== undefined && layer === "l2")
        litEdges = new Set(edgeElements.filter(({ edge }) => carries(edge)).map(({ edge }) => edge));
    else if (selectedEdge) litEdges = new Set([selectedEdge]);

    const litNodes = litEdges ? new Set([...litEdges].flatMap((edge) => [edge.from, edge.to])) : undefined;
    if (focus) litNodes?.add(focus);

    for (const { edge, group } of edgeElements) {
        group.classList.toggle("lit", Boolean(litEdges?.has(edge)) && !selectedEdge);
        group.classList.toggle("selected", edge === selectedEdge);
        group.classList.toggle("dim", litEdges !== undefined && !litEdges.has(edge));
    }

    for (const [id, group] of nodeElements) {
        group.classList.toggle("selected", Boolean(selection && "node" in selection && selection.node === id));
        group.classList.toggle("dim", litNodes !== undefined && !litNodes.has(id));
    }
}

// Panning, zooming and dragging.
/** @type {{ id?: string, start: Point, origin: Point, moved: boolean } | undefined} */
let drag;

/**
 * @param {{ clientX: number, clientY: number }} event
 * @returns {Point}
 */
const toWorld = (event) => {
    const box = svg.getBoundingClientRect();
    return { x: (event.clientX - box.left - view.x) / view.k, y: (event.clientY - box.top - view.y) / view.k };
};

/**
 * @param {PointerEvent} event
 * @param {string} [id]
 */
function startDrag(event, id) {
    if (event.button !== 0) return;
    event.stopPropagation();

    svg.setPointerCapture(event.pointerId);
    const point = id ? positions.get(id) : undefined;
    const origin = point ? { ...point } : { x: view.x, y: view.y };
    drag = { id, start: { x: event.clientX, y: event.clientY }, origin, moved: false };
    if (!id) svg.classList.add("panning");
}

svg.addEventListener("pointerdown", (event) => startDrag(event));

svg.addEventListener("pointermove", (event) => {
    if (!drag) return;

    const dx = event.clientX - drag.start.x;
    const dy = event.clientY - drag.start.y;
    if (Math.hypot(dx, dy) > 3) drag.moved = true;
    if (!drag.moved) return;

    if (drag.id) positions.set(drag.id, { x: drag.origin.x + dx / view.k, y: drag.origin.y + dy / view.k });
    else view = { ...view, x: drag.origin.x + dx, y: drag.origin.y + dy };

    place();
});

svg.addEventListener("pointerup", () => {
    if (!drag) return;

    const ended = drag;
    drag = undefined;
    svg.classList.remove("panning");

    if (ended.moved && ended.id) savePositions();
    if (ended.moved) return;

    // A press without a move is a click: on a node it selects the node, and on an empty spot it clears the selection.
    select(ended.id ? { node: ended.id } : undefined);
});

svg.addEventListener(
    "wheel",
    (event) => {
        event.preventDefault();

        const point = toWorld(event);
        const k = Math.min(Math.max(view.k * Math.exp(-event.deltaY * 0.0015), 0.15), 4);
        const box = svg.getBoundingClientRect();

        view = { k, x: event.clientX - box.left - point.x * k, y: event.clientY - box.top - point.y * k };
        place();
    },
    { passive: false }
);

function fit() {
    const points = visibleNodes().flatMap((node) => {
        const point = positions.get(node.id);
        return point ? [point] : [];
    });
    if (!points.length) return;

    const box = svg.getBoundingClientRect();
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    const width = Math.max(...xs) - Math.min(...xs) + 240;
    const height = Math.max(...ys) - Math.min(...ys) + 160;
    const k = Math.min(Math.max(Math.min(box.width / width, box.height / height), 0.15), 1.5);

    const centre = { x: (Math.max(...xs) + Math.min(...xs)) / 2, y: (Math.max(...ys) + Math.min(...ys)) / 2 };
    view = { k, x: box.width / 2 - centre.x * k, y: box.height / 2 - centre.y * k };
    place();
}

byId("fit").addEventListener("click", fit);

byId("lay-out").addEventListener("click", () => {
    if (!data) return;
    layout(data.nodes, data.edges, true);
    draw();
    fit();
});

window.addEventListener("resize", () => place());

// Saving the layer shown, as it looks.
byId("save-svg").addEventListener("click", () => {
    if (!(viewport instanceof SVGGraphicsElement)) return;
    save(`circuit-${layer}.svg`, new Blob([svgOf(svg, viewport).text], { type: "image/svg+xml" }));
});

byId("save-png").addEventListener("click", async () => {
    if (!(viewport instanceof SVGGraphicsElement)) return;
    save(`circuit-${layer}.png`, await pngOf(svgOf(svg, viewport)));
});

// The side panel.
/** @param {Selection} next */
function select(next) {
    selection = next;
    pathFocus = undefined;
    emphasize();
    showPanel();
}

/**
 * @param {Annotated["findings"]} findings
 * @param {boolean} withDevice
 */
function findingList(findings, withDevice) {
    return h(
        "ul",
        {},
        ...findings.map((finding) =>
            h(
                "li",
                {},
                h("span", { class: `badge ${finding.level}` }, finding.level),
                withDevice && finding.device ? link(finding.device, () => select({ node: `device:${finding.device}` })) : undefined,
                withDevice && finding.device ? ": " : undefined,
                finding.message
            )
        )
    );
}

/** @param {CarriedVlan[]} vlans */
function vlanChips(vlans) {
    const chips = h("div", { class: "chips" });

    for (const vlan of vlans) {
        const button = h("button", { "aria-pressed": String(vlan.id === vlanFocus) }, `${vlan.name} ${vlan.id}`);
        button.addEventListener("click", () => {
            vlanFocus = vlanFocus === vlan.id ? undefined : vlan.id;
            selection = undefined;
            emphasize();
            showPanel();
        });
        chips.append(button);
    }

    return chips;
}

function legend() {
    /**
     * @param {boolean} dashed
     * @param {string} color
     */
    const sample = (dashed, color) => {
        const icon = s("svg", { width: 34, height: 10 });
        icon.append(s("line", { x1: 2, y1: 5, x2: 32, y2: 5, stroke: color, "stroke-width": 2, "stroke-dasharray": dashed ? "6 4" : "" }));
        return icon;
    };

    /** @param {string} style */
    const box = (style) => {
        const icon = s("svg", { width: 34, height: 16 });
        icon.append(s("rect", { x: 2, y: 2, width: 30, height: 12, rx: 3, fill: "none", "stroke-width": 2, style }));
        return icon;
    };

    return h(
        "ul",
        { class: "legend" },
        h("li", {}, sample(false, "var(--edge)"), "both ends declare it"),
        h("li", {}, sample(true, "var(--warning)"), "only one end declares it"),
        h("li", {}, box("stroke: var(--error)"), "a device with an error"),
        h("li", {}, box("stroke: var(--warning)"), "a warning, or unlike its snapshot"),
        h("li", {}, box("stroke: var(--line); stroke-dasharray: 5 3"), "outside the network")
    );
}

function showPanel() {
    panel.replaceChildren();
    if (!data) return;

    if (selection && "node" in selection) {
        const node = nodeById(selection.node);
        if (node) return showNode(node);
    }

    if (selection && "edge" in selection) return showEdge(selection.edge);

    const drift = data.drift;
    const devices = data.nodes.filter((node) => node.kind === "device");
    const drifted = devices.filter((node) => drift[node.label]?.status === "differs");
    const unsnapped = devices.filter((node) => drift[node.label]?.status === "no snapshot");

    panel.append(h("h2", {}, LAYER_NAMES[layer]), h("p", { class: "muted" }, LAYER_HELP[layer]));

    if (layer === "l2") {
        /** @type {Map<number, CarriedVlan>} */
        const vlans = new Map();
        for (const edge of visibleEdges()) for (const vlan of edge.vlans ?? []) vlans.set(vlan.id, vlan);

        const sorted = [...vlans.values()].sort((a, b) => a.id - b.id);
        if (sorted.length) panel.append(h("h3", {}, "VLANs"), vlanChips(sorted));
    }

    if (data.findings.length) panel.append(h("h3", {}, "Found by ", h("code", {}, "circuit validate")), findingList(data.findings, true));

    if (drifted.length) {
        panel.append(
            h("h3", {}, "Unlike their last snapshot"),
            h(
                "ul",
                {},
                ...drifted.map((node) =>
                    h(
                        "li",
                        {},
                        link(node.label, () => select({ node: node.id }))
                    )
                )
            )
        );
    }

    if (unsnapped.length) {
        panel.append(h("h3", {}, "No snapshot yet"), h("p", { class: "muted" }, unsnapped.map((node) => node.label).join(", ")));
    }

    panel.append(h("h3", {}, "Legend"), legend());
}

/** @param {GraphNode} node */
function showNode(node) {
    const kinds = { device: "device", segment: "shared segment", outside: "outside the network" };
    panel.append(h("h2", {}, node.label), h("div", { class: "kind" }, kinds[node.kind]));

    if (node.kind === "device")
        panel.append(
            h(
                "p",
                {},
                link("Everything it holds", () => go(`devices/${encodeURIComponent(node.label)}`))
            )
        );
    if (node.detail.length) panel.append(h("h3", {}, "Details"), h("pre", {}, node.detail.join("\n")));

    if (node.kind === "device" && data) {
        const findings = data.findings.filter((finding) => finding.device === node.label);
        if (findings.length) panel.append(h("h3", {}, "Found by ", h("code", {}, "circuit validate")), findingList(findings, false));

        const drift = data.drift[node.label];
        if (drift) {
            const notes = {
                matches: ["Matches its last snapshot."],
                differs: ["Differs from its last snapshot. This is what ", h("code", {}, "circuit diff"), " would send:"],
                "no snapshot": ["No snapshot yet: run ", h("code", {}, "circuit snapshot"), "."],
                "cannot plan": ["Could not be planned against its snapshot:"],
            };

            panel.append(h("h3", {}, "Against its snapshot"), h("p", {}, ...notes[drift.status]));
            if (drift.lines.length) panel.append(h("pre", {}, drift.lines.join("\n")));
        }
    }

    const edges = visibleEdges().filter((edge) => edge.from === node.id || edge.to === node.id);

    panel.append(h("h3", {}, `${LAYER_NAMES[layer]} here`));
    if (!edges.length) panel.append(h("p", { class: "muted" }, "None on this layer."));

    panel.append(
        h(
            "ul",
            {},
            ...edges.map((edge) => {
                const other = nodeById(edge.from === node.id ? edge.to : edge.from);
                return h(
                    "li",
                    {},
                    link(edge.label, () => select({ edge })),
                    h("span", { class: "muted" }, ` with ${other?.label ?? "?"}`)
                );
            })
        )
    );
}

/** @param {GraphEdge} edge */
function showEdge(edge) {
    const from = nodeById(edge.from);
    const to = nodeById(edge.to);

    panel.append(
        h("h2", {}, edge.label),
        h(
            "div",
            { class: "kind" },
            `${LAYER_NAMES[edge.layer]}, between `,
            link(from?.label ?? edge.from, () => select({ node: edge.from })),
            " and ",
            link(to?.label ?? edge.to, () => select({ node: edge.to }))
        )
    );

    if (edge.oneSided) panel.append(h("p", {}, h("span", { class: "badge warning" }, "one end"), "Only one end declares it."));
    if (edge.detail.length) panel.append(h("h3", {}, "Details"), h("pre", {}, edge.detail.join("\n")));
    if (edge.vlans?.length) panel.append(h("h3", {}, "VLANs"), vlanChips(edge.vlans));
}

function showLayerButtons() {
    layersNav.replaceChildren();

    for (const [index, name] of LAYERS.entries()) {
        const count = data?.edges.filter((edge) => edge.layer === name).length ?? 0;
        const button = h(
            "button",
            { "aria-pressed": String(name === layer), title: `${LAYER_HELP[name]} Key ${index + 1}.` },
            LAYER_NAMES[name],
            h("span", { class: "count" }, String(count))
        );
        button.addEventListener("click", () => go(`graph/${name}`));
        layersNav.append(button);
    }
}

document.addEventListener("keydown", (event) => {
    if (event.target instanceof HTMLInputElement || graphView.hidden) return;

    if (event.key === "Escape") select(undefined);

    // Keys 1 to 6 pick a layer.
    const chosen = LAYERS[Number(event.key) - 1];
    if (chosen) go(`graph/${chosen}`);
});

/** The layer shown last, or the first. */
export const currentLayer = () => layer;

/**
 * Take a new graph, when the config changed. Nodes keep their places, and a selection whose node or edge is gone is dropped.
 *
 * @param {Annotated} next
 */
export function setGraph(next) {
    data = next;

    if (selection && "node" in selection && !nodeById(selection.node)) selection = undefined;
    if (selection && "edge" in selection) {
        const { layer: was, from, to, label } = selection.edge;
        const same = data.edges.find((edge) => edge.layer === was && edge.from === from && edge.to === to && edge.label === label);
        selection = same ? { edge: same } : undefined;
    }

    layout(data.nodes, data.edges, false);
}

/**
 * Draw a layer, now that the graph is visible: its labels are measured as they are drawn.
 *
 * @param {Layer} next
 */
export function showLayer(next) {
    if (next !== layer) {
        if (selection && "edge" in selection) selection = undefined;
        vlanFocus = undefined;
        pathFocus = undefined;
    }

    if (pendingVlan !== undefined) {
        vlanFocus = pendingVlan;
        pendingVlan = undefined;
    }

    if (pendingPath) {
        pathFocus = new Set(pendingPath.map(edgeKey));
        pendingPath = undefined;
    }

    layer = next;
    store.set("layer", layer);

    showLayerButtons();
    draw();
    showPanel();

    if (!drawn && data) fit();
    drawn = data !== undefined;
}

/**
 * Select a device, for when the graph is shown next.
 *
 * @param {string} name
 */
export function selectDevice(name) {
    selection = { node: `device:${name}` };
}

/**
 * Light up these cables as one path, for when their layer is shown next.
 *
 * @param {GraphEdge[]} path
 */
export function lightPath(path) {
    pendingPath = path;
    selection = undefined;
}

/**
 * Light up every cable carrying a VLAN, for when the VLAN layer is shown next.
 *
 * @param {number} id
 */
export function lightVlan(id) {
    pendingVlan = id;
    selection = undefined;
}
