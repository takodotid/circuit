// @ts-check
/// <reference lib="dom" />
// The graph view: a force layout of every node, drawn one layer at a time, with panning, zooming, dragging, and a side panel for what is selected.

import { byId, enter, go, h, link, s, still, store, svgById } from "./dom.js";
import { changeKey } from "./evaluate.js";
import { pngOf, save, svgOf } from "./export.js";

/** @typedef {import("../../core/graph").GraphNode} GraphNode */
/** @typedef {import("../../core/graph").GraphEdge} GraphEdge */
/** @typedef {import("../../core/graph").Layer} Layer */
/** @typedef {import("../../core/graph").CarriedVlan} CarriedVlan */
/** @typedef {import("../../core/graph").Annotated} Annotated */
/** @typedef {{ x: number, y: number }} Point */
/** An edge as drawn: one of the graph's, or several between the same two nodes drawn as one, or one a comparison shows is gone. @typedef {GraphEdge & { members?: DrawnEdge[], gone?: true }} DrawnEdge */
/** @typedef {{ node: string } | { edge: DrawnEdge } | undefined} Selection */

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
const presentButton = byId("present");
const caption = byId("present-caption");

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
/** A comparison with another commit: its name, the edges it adds, and those gone. @type {{ name: string, added: Set<string>, removed: GraphEdge[] } | undefined} */
let comparison;
/** Presenting: the network on a big screen, going through every layer and lighting its busiest devices in turn. Kept, so a screen that reloads stays on it. */
let presenting = store.get("present") === true;
/** The device lit while presenting; none while the whole layer is shown. @type {string | undefined} */
let touring;
/** @type {ReturnType<typeof setInterval> | undefined} */
let tour;

/** @param {GraphEdge} edge */
const edgeKey = (edge) => `${edge.layer} ${edge.from} ${edge.to} ${edge.label}`;
let view = { x: 0, y: 0, k: 1 };

const saved = /** @type {Record<string, [number, number]>} */ (store.get("positions") ?? {});
/** @type {Map<string, Point>} */
const positions = new Map(Object.entries(saved).map(([id, [x, y]]) => [id, { x, y }]));

/** @type {Map<string, SVGGElement>} */
const nodeElements = new Map();
/** @type {{ edge: DrawnEdge, group: SVGGElement, path: SVGPathElement, hit: SVGPathElement, label: SVGTextElement, offset: number }[]} */
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
    const ideal = 170;
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

    // No box may cover another: two that overlap are pushed apart the shorter way out, with room for the label of the line between them.
    /** @param {GraphNode} node */
    const halfWidth = (node) =>
        node.kind === "device" ? Math.max(node.label.length * 10, (node.detail[0] ?? "").length * 7) / 2 + 60 : node.label.length * 4 + 30;

    for (let round = 0; round < 80; round++) {
        let overlapping = false;

        for (const [index, a] of nodes.entries()) {
            for (const b of nodes.slice(index + 1)) {
                const aMoves = !fixed.has(a.id);
                const bMoves = !fixed.has(b.id);
                if (!aMoves && !bMoves) continue;

                const pa = at(a.id);
                const pb = at(b.id);
                const overlapX = halfWidth(a) + halfWidth(b) + 24 - Math.abs(pa.x - pb.x);
                const overlapY = 96 - Math.abs(pa.y - pb.y);
                if (overlapX <= 0 || overlapY <= 0) continue;

                overlapping = true;
                const share = aMoves && bMoves ? 0.5 : 1;
                const alongX = overlapX < overlapY * 2;
                const sign = alongX ? Math.sign(pa.x - pb.x) || 1 : Math.sign(pa.y - pb.y) || 1;
                const distance = (alongX ? overlapX : overlapY) * share;

                if (aMoves) alongX ? (pa.x += sign * distance) : (pa.y += sign * distance);
                if (bMoves) alongX ? (pb.x -= sign * distance) : (pb.y -= sign * distance);
            }
        }

        if (!overlapping) break;
    }

    savePositions();
}

// What is drawn.
/** @returns {DrawnEdge[]} */
const visibleEdges = () => {
    const current = data?.edges.filter((edge) => edge.layer === layer) ?? [];
    if (!comparison) return current;

    // An edge the comparison says is gone is drawn when both its ends are still drawn.
    const nodes = new Set(data?.nodes.map((node) => node.id));
    const gone = comparison.removed.filter((edge) => edge.layer === layer && nodes.has(edge.from) && nodes.has(edge.to));
    return [...current, ...gone.map((edge) => ({ ...edge, gone: /** @type {const} */ (true) }))];
};

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

/** Past this many edges between the same two nodes, they are drawn as one, which lists them all when selected. */
const MOST_APART = 3;

/** @type {Record<Layer, string>} */
const MANY = { l1: "cables", l2: "cables", l3: "shared prefixes", bgp: "sessions", ospf: "adjacencies", tunnels: "tunnels" };

/** @type {Record<Layer, string>} */
const ONE = { l1: "cable", l2: "cable", l3: "shared prefix", bgp: "session", ospf: "adjacency", tunnels: "tunnel" };

/**
 * The edges to draw: each on its own, or, past a few between the same two nodes, one for all of them.
 *
 * @param {DrawnEdge[]} edges
 * @returns {DrawnEdge[]}
 */
function bundled(edges) {
    /** @type {Map<string, DrawnEdge[]>} */
    const byPair = new Map();
    for (const edge of edges) {
        const pair = `${[edge.from, edge.to].sort().join("|")}${edge.gone ? " gone" : ""}`;
        byPair.set(pair, [...(byPair.get(pair) ?? []), edge]);
    }

    return [...byPair.values()].flatMap((members) => {
        const [first] = members;
        if (!first || members.length <= MOST_APART) return members;

        /** @type {Map<number, import("../../core/graph").CarriedVlan>} */
        const vlans = new Map();
        for (const member of members) for (const vlan of member.vlans ?? []) vlans.set(vlan.id, vlan);

        return [
            {
                layer: first.layer,
                from: first.from,
                to: first.to,
                label: `${members.length} ${MANY[first.layer]}`,
                detail: members.flatMap((member) => [member.label, ...member.detail.map((line) => `  ${line}`)]),
                ...(members.some((member) => member.oneSided) ? { oneSided: /** @type {const} */ (true) } : {}),
                ...(vlans.size ? { vlans: [...vlans.values()].sort((a, b) => a.id - b.id) } : {}),
                ...(first.gone ? { gone: /** @type {const} */ (true) } : {}),
                members,
            },
        ];
    });
}

/**
 * Dots that travel a cable both ends declare, so a link that works reads as one that carries traffic: one dot, or one each way while presenting. A cable only one end declares, or one a comparison shows is gone, carries none.
 *
 * @param {DrawnEdge} edge
 * @param {string} id the id of the cable's drawn path, which the dots follow as it moves
 */
function signals(edge, id) {
    if (still.matches || edge.oneSided || edge.gone) return [];

    const a = positions.get(edge.from) ?? { x: 0, y: 0 };
    const b = positions.get(edge.to) ?? { x: 0, y: 0 };
    const seconds = Math.min(Math.max(Math.hypot(b.x - a.x, b.y - a.y) / (presenting ? 110 : 45), 1.6), 12);
    const phase = hash(`${edge.from}${edge.to}${edge.label}`) * seconds;
    const backwards = presenting ? [false, true] : [hash(edge.label) < 0.5];

    return backwards.map((back, index) => {
        const dot = s("circle", { class: "signal", r: 3.5 });
        const motion = s("animateMotion", {
            dur: `${seconds.toFixed(2)}s`,
            begin: `-${(phase + (index * seconds) / 2).toFixed(2)}s`,
            repeatCount: "indefinite",
            ...(back ? { keyPoints: "1;0", keyTimes: "0;1", calcMode: "linear" } : {}),
        });

        motion.append(s("mpath", { href: `#${id}` }));
        dot.append(motion);
        return dot;
    });
}

/** A confident arrival: fast at first, settling at the end. */
const EASE = "cubic-bezier(0.16, 1, 0.3, 1)";

/**
 * Draw the network in from its busiest device outward, a ring of neighbours at a time, each cable drawn from its nearer end.
 *
 * @param {Set<string>} fresh the nodes this drawing adds, which fade in; the others are already on screen
 */
function arrive(fresh) {
    if (still.matches || !edgeElements.length) return;

    /** @param {string} id */
    const degree = (id) => edgeElements.filter(({ edge }) => edge.from === id || edge.to === id).length;
    const hub = [...nodeElements.keys()].sort((a, b) => degree(b) - degree(a))[0];

    /** @type {Map<string, number>} */
    const ring = new Map(hub ? [[hub, 0]] : []);
    for (let queue = hub ? [hub] : []; queue.length;) {
        const id = /** @type {string} */ (queue.shift());
        for (const { edge } of edgeElements) {
            const other = edge.from === id ? edge.to : edge.to === id ? edge.from : undefined;
            if (other === undefined || ring.has(other)) continue;
            ring.set(other, (ring.get(id) ?? 0) + 1);
            queue.push(other);
        }
    }

    // The whole drawing arrives within about a second, however many rings it has.
    const farthest = Math.max(0, ...ring.values()) + 1;
    const step = Math.min(110, 800 / farthest);
    /** @param {string} id */
    const ringOf = (id) => ring.get(id) ?? farthest;

    for (const [id, group] of nodeElements) {
        if (!fresh.has(id)) continue;
        group.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 360, delay: ringOf(id) * step, easing: EASE, fill: "backwards" });
    }

    for (const { edge, group, path, label } of edgeElements) {
        const forward = ringOf(edge.from) <= ringOf(edge.to);
        const delay = (Math.min(ringOf(edge.from), ringOf(edge.to)) + 0.5) * step;

        if (edge.oneSided || edge.gone) {
            path.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 420, delay, easing: EASE, fill: "backwards" });
        } else {
            const length = path.getTotalLength();
            const start = { strokeDasharray: `${length} ${length}`, strokeDashoffset: forward ? length : -length };
            const end = { strokeDasharray: `${length} ${length}`, strokeDashoffset: 0 };
            path.animate([start, end], { duration: 560, delay, easing: EASE, fill: "backwards" });
        }

        for (const part of [label, ...group.querySelectorAll(".signal")]) {
            part.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, delay: delay + 420, fill: "backwards" });
        }
    }
}

/**
 * Draw the layer. `arrival` says what is new to the eye: the whole network the first time it is shown, its cables when the layer changes, and nothing when the config is read again.
 *
 * @param {"network" | "cables"} [arrival]
 */
function draw(arrival) {
    const before = new Set(nodeElements.keys());

    edgeLayer.replaceChildren();
    nodeLayer.replaceChildren();
    nodeElements.clear();
    edgeElements.length = 0;

    const edges = bundled(visibleEdges());

    // Edges between the same two nodes bend apart, so each stays readable.
    /** @type {Map<string, number>} */
    const between = new Map();
    /** @param {DrawnEdge} edge */
    const pairOf = (edge) => [edge.from, edge.to].sort().join("|");
    for (const edge of edges) between.set(pairOf(edge), (between.get(pairOf(edge)) ?? 0) + 1);
    /** @type {Map<string, number>} */
    const seen = new Map();

    for (const [number, edge] of edges.entries()) {
        const pair = pairOf(edge);
        const index = seen.get(pair) ?? 0;
        seen.set(pair, index + 1);

        // Bend in one direction whichever way round the edge was written.
        const sign = edge.from < edge.to ? 1 : -1;
        const offset = (index - ((between.get(pair) ?? 1) - 1) / 2) * 34 * sign;

        const added = comparison && [edge, ...(edge.members ?? [])].some((one) => !one.gone && comparison?.added.has(changeKey(one)));
        const change = edge.gone ? " gone" : added ? " added" : "";
        const group = s("g", { class: `edge${edge.oneSided ? " one-sided" : ""}${change}` });
        const hit = s("path", { class: "hit" });
        const path = s("path", { id: `cable-${number}` });
        const label = s("text", { "text-anchor": "middle", "dominant-baseline": "central" });
        label.textContent = edge.label;

        group.append(path, hit, ...signals(edge, `cable-${number}`), label);

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

        const device = node.kind === "device";
        const lines = device ? [node.label, node.detail[0] ?? ""] : [node.label];
        const texts = lines.map((line, index) => {
            const y = device ? (index === 0 ? -9 : 13) : 0;
            const text = s("text", { class: index === 0 ? "name" : "sub", y });
            text.textContent = line;
            group.append(text);
            return text;
        });

        nodeLayer.append(group);

        // Each box fits its text, so it is measured once drawn. A device's text starts after its chassis mark.
        const mark = device ? 46 : 0;
        const width = Math.max(...texts.map((text) => text.getComputedTextLength()), device ? 110 : 0) + 32 + mark;
        const height = device ? 62 : 34;
        rect.setAttribute("x", String(-width / 2));
        rect.setAttribute("y", String(-height / 2));
        rect.setAttribute("width", String(width));
        rect.setAttribute("height", String(height));

        if (device) {
            for (const text of texts) text.setAttribute("x", String(-width / 2 + 16 + mark));

            // A small front panel: a chassis with two rows of ports, drawn rather than pictured.
            const left = -width / 2 + 16;
            const chassis = s("g", { class: "chassis", "aria-hidden": "true" });
            chassis.append(s("rect", { x: left, y: -15, width: 34, height: 30, rx: 4 }));
            for (const row of [0, 1]) {
                for (const column of [0, 1, 2]) {
                    chassis.append(s("rect", { class: "socket", x: left + 6 + column * 8, y: -8 + row * 9, width: 6, height: 6, rx: 1 }));
                }
            }
            group.insertBefore(chassis, texts[0] ?? null);
        }

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

    if (arrival) arrive(new Set([...nodeElements.keys()].filter((id) => arrival === "network" || !before.has(id))));
}

/** Light up what the pointer is on, the device lit while presenting, or what is selected, and dim the rest. */
function emphasize() {
    const focus = hovered ?? touring ?? (selection && "node" in selection ? selection.node : undefined);
    const selectedEdge = selection && "edge" in selection ? selection.edge : undefined;

    /** @param {GraphEdge} edge */
    const touching = (edge) => edge.from === focus || edge.to === focus;
    /** @param {GraphEdge} edge */
    const carries = (edge) => edge.vlans?.some((vlan) => vlan.id === vlanFocus) ?? false;

    /** @type {Set<GraphEdge> | undefined} */
    let litEdges;
    if (focus) litEdges = new Set(edgeElements.filter(({ edge }) => touching(edge)).map(({ edge }) => edge));
    else if (pathFocus)
        litEdges = new Set(
            edgeElements
                .filter(({ edge }) => [edge, ...(edge.members ?? [])].some((one) => pathFocus?.has(edgeKey(one))))
                .map(({ edge }) => edge)
        );
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
    if (gliding !== undefined) cancelAnimationFrame(gliding);
    gliding = undefined;
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
        if (gliding !== undefined) cancelAnimationFrame(gliding);
        gliding = undefined;

        const point = toWorld(event);
        const k = Math.min(Math.max(view.k * Math.exp(-event.deltaY * 0.0015), 0.15), 4);
        const box = svg.getBoundingClientRect();

        view = { k, x: event.clientX - box.left - point.x * k, y: event.clientY - box.top - point.y * k };
        place();
    },
    { passive: false }
);

/** The scale below which a device's name is too small to read: a first view stops there, and the reader pans for the rest. */
const READABLE = 0.6;

/** The view moving to a new place, which a press or a scroll stops. @type {number | undefined} */
let gliding;

/**
 * Move the view to a new place over a second, zooming evenly and keeping the eye on the point between them. At once when the reader asked for less motion.
 *
 * @param {typeof view} target
 */
function glideTo(target) {
    if (gliding !== undefined) cancelAnimationFrame(gliding);
    gliding = undefined;

    if (still.matches) {
        view = target;
        place();
        return;
    }

    const box = svg.getBoundingClientRect();
    const from = { ...view };
    /** @param {typeof view} one */
    const centreOf = (one) => ({ x: (box.width / 2 - one.x) / one.k, y: (box.height / 2 - one.y) / one.k });
    const start = centreOf(from);
    const end = centreOf(target);
    const began = performance.now();

    /** @param {number} now */
    const step = (now) => {
        const t = Math.min((now - began) / 1100, 1);
        const eased = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
        const k = from.k * (target.k / from.k) ** eased;
        const centre = { x: start.x + (end.x - start.x) * eased, y: start.y + (end.y - start.y) * eased };

        view = { k, x: box.width / 2 - centre.x * k, y: box.height / 2 - centre.y * k };
        place();
        gliding = t < 1 ? requestAnimationFrame(step) : undefined;
    };

    gliding = requestAnimationFrame(step);
}

/**
 * Show the whole drawing, or, when that would make it unreadable and `readable` is asked, as much of it as stays readable. `glide` moves there instead of jumping.
 *
 * @param {boolean} [readable]
 * @param {boolean} [glide]
 */
function fit(readable = false, glide = false) {
    const target = framing(visibleNodes(), readable);
    if (!target) return;

    if (glide) return glideTo(target);
    view = target;
    place();
}

/**
 * The view that frames these nodes.
 *
 * @param {GraphNode[]} nodes
 * @param {boolean} readable
 * @returns {typeof view | undefined}
 */
function framing(nodes, readable) {
    const points = nodes.flatMap((node) => {
        const point = positions.get(node.id);
        return point ? [point] : [];
    });
    if (!points.length) return undefined;

    const box = svg.getBoundingClientRect();
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    const width = Math.max(...xs) - Math.min(...xs) + 190;
    const height = Math.max(...ys) - Math.min(...ys) + 130;
    const whole = Math.min(Math.max(Math.min(box.width / width, box.height / height), 0.15), 1.8);
    const k = readable ? Math.max(whole, READABLE) : whole;

    // When the whole drawing does not fit readably, the view starts on the device with the most lines, the heart of the network.
    const edges = visibleEdges();
    const degree = (/** @type {string} */ id) => edges.filter((edge) => edge.from === id || edge.to === id).length;
    const hub = [...nodes].sort((a, b) => degree(b.id) - degree(a.id))[0];
    const centre =
        k > whole && hub && positions.has(hub.id)
            ? /** @type {Point} */ (positions.get(hub.id))
            : { x: (Math.max(...xs) + Math.min(...xs)) / 2, y: (Math.max(...ys) + Math.min(...ys)) / 2 };

    // Presenting leaves room for the slow drift and the caption, so nothing framed is cut at the screen's edge.
    const shown = presenting ? k * 0.86 : k;

    return { k: shown, x: box.width / 2 - centre.x * shown, y: box.height / 2 - centre.y * shown };
}

/** While presenting, frame what is shown: the lit device with everything it has a line to, or the whole layer. */
function frameTour(glide = true) {
    const lit = touring;
    if (!lit) return fit(false, glide);

    const near = new Set([lit, ...visibleEdges().flatMap((edge) => (edge.from === lit ? [edge.to] : edge.to === lit ? [edge.from] : []))]);
    const target = framing(
        visibleNodes().filter((node) => near.has(node.id)),
        false
    );
    if (!target) return;

    if (glide) return glideTo(target);
    view = target;
    place();
}

byId("fit").addEventListener("click", () => fit());

byId("lay-out").addEventListener("click", () => {
    if (!data) return;
    layout(data.nodes, data.edges, true);
    draw();
    fit();
});

// Presenting keeps the whole network in view as the screen changes size.
window.addEventListener("resize", () => (presenting ? frameTour(false) : place()));

// Presenting.

/** Say what is shown while presenting: the device lit, or the whole layer. */
function showCaption() {
    caption.hidden = !presenting;
    if (!presenting) return;

    const node = touring ? nodeById(touring) : undefined;
    const edges = visibleEdges().filter((edge) => !node || edge.from === node.id || edge.to === node.id);
    const count = `${edges.length} ${edges.length === 1 ? ONE[layer] : MANY[layer]}`;

    if (node) caption.replaceChildren(h("strong", {}, node.label), h("span", {}, [node.detail[0], count].filter(Boolean).join(", ")));
    else
        caption.replaceChildren(
            h("strong", {}, LAYER_NAMES[layer]),
            h("span", {}, `${visibleNodes().filter((one) => one.kind === "device").length} devices, ${count}`)
        );

    enter(caption);
}

/** How many devices are lit on each layer while presenting, busiest first, before it moves on to the next layer. */
const LIT_PER_LAYER = 4;

/** How far presenting has gone on this layer: 0 while the whole layer is shown, then each lit device in turn. */
let tourStep = 0;

/** The next layer that has lines to show, after this one; this one when no other has any. */
function nextLayer() {
    const after = [...LAYERS.slice(LAYERS.indexOf(layer) + 1), ...LAYERS.slice(0, LAYERS.indexOf(layer) + 1)];
    return after.find((name) => data?.edges.some((edge) => edge.layer === name)) ?? layer;
}

/** While presenting: show the whole layer, light its busiest devices one at a time, then move on to the next layer. */
function tourNext() {
    if (graphView.hidden || document.hidden || hovered || drag) return;

    const edges = visibleEdges();
    const degree = (/** @type {string} */ id) => edges.filter((edge) => edge.from === id || edge.to === id).length;
    const devices = visibleNodes()
        .filter((node) => node.kind === "device" && degree(node.id))
        .sort((a, b) => degree(b.id) - degree(a.id) || a.label.localeCompare(b.label))
        .slice(0, LIT_PER_LAYER);

    tourStep += 1;
    touring = devices[tourStep - 1]?.id;

    if (touring || nextLayer() === layer) {
        if (!touring) tourStep = 0;
        emphasize();
        showCaption();
        frameTour();
        return;
    }

    // Every lit device has had its turn. Moving on replaces the address rather than adding to the history, so Back still leaves Studio's last place.
    location.replace(`#graph/${nextLayer()}`);
}

/** @param {boolean} on */
function setPresenting(on) {
    presenting = on;
    store.set("present", on);

    document.body.classList.toggle("presenting", on);
    presentButton.setAttribute("aria-pressed", String(on));

    clearInterval(tour);
    touring = undefined;
    if (on) {
        selection = undefined;
        tour = setInterval(tourNext, 6000);
    }

    if (graphView.hidden || !data) return;

    // The panel hides or returns, so the drawing is fitted once the page has its new size.
    draw();
    showPanel();
    showCaption();
    requestAnimationFrame(() => (presenting ? frameTour(false) : fit()));
}

presentButton.addEventListener("click", () => setPresenting(!presenting));
setPresenting(presenting);

// A hidden page's dots stop moving.
document.addEventListener("visibilitychange", () => {
    if (!(svg instanceof SVGSVGElement)) return;
    if (document.hidden) svg.pauseAnimations();
    else svg.unpauseAnimations();
});

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
    /** @param {Selection} one */
    const keyOf = (one) => (one && "node" in one ? one.node : one ? edgeKey(one.edge) : "");
    const changed = keyOf(next) !== keyOf(selection);

    selection = next;
    pathFocus = undefined;
    emphasize();
    showPanel();

    if (changed) enter(panel);
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

    if (comparison) {
        panel.append(
            h("h3", {}, "Compared with ", comparison.name),
            h(
                "p",
                {},
                h("span", { class: "added" }, "Green lines"),
                " are new, ",
                h("span", { class: "removed" }, "red dashed lines"),
                " are gone. ",
                link("Stop comparing", () => {
                    comparison = undefined;
                    draw();
                    showPanel();
                })
            )
        );
    }

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

    if (event.key === "Escape") {
        if (presenting) setPresenting(false);
        select(undefined);
    }

    if (event.key === "p" && !event.ctrlKey && !event.metaKey && !event.altKey) setPresenting(!presenting);

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
        touring = undefined;
        tourStep = 0;
    }

    if (pendingVlan !== undefined) {
        vlanFocus = pendingVlan;
        pendingVlan = undefined;
    }

    if (pendingPath) {
        pathFocus = new Set(pendingPath.map(edgeKey));
        pendingPath = undefined;
    }

    // The first view draws the whole network in; a new layer draws in its own lines.
    const arrival = !drawn && data ? "network" : next !== layer ? "cables" : undefined;

    layer = next;
    store.set("layer", layer);

    showLayerButtons();
    draw(arrival);
    showPanel();
    showCaption();

    // Presenting shows the whole layer as it comes in; a first view on a laptop starts where names can be read.
    if (presenting && arrival) fit();
    else if (!drawn && data) fit(true);
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
 * Show a comparison with another commit on the graph: new edges lit, edges gone drawn dashed.
 *
 * @param {{ name: string, added: GraphEdge[], removed: GraphEdge[] }} next
 */
export function setComparison(next) {
    comparison = { name: next.name, added: new Set(next.added.map(changeKey)), removed: next.removed };
    selection = undefined;
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
