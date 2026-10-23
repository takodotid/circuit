// @ts-check
/// <reference lib="dom" />
// The graph view: a force layout of every node, drawn one layer at a time, with panning, zooming, dragging, and a side panel for what is selected.

import { Dom } from "./dom.js";
import { Evaluate } from "./evaluate.js";
import { Export } from "./export.js";

/** @typedef {import("../../core/topology").GraphNode} GraphNode */
/** @typedef {import("../../core/topology").GraphEdge} GraphEdge */
/** @typedef {import("../../core/topology").Layer} Layer */
/** @typedef {import("../../core/topology").CarriedVlan} CarriedVlan */
/** @typedef {import("../../core/topology").Annotated} Annotated */
/** @typedef {{ x: number, y: number }} Point */
/** An edge as drawn: one of the graph's, or several between the same two nodes drawn as one, or one a comparison shows is gone. @typedef {GraphEdge & { members?: DrawnEdge[], gone?: true }} DrawnEdge */
/** @typedef {{ node: string } | { edge: DrawnEdge } | undefined} Selection */
/** @typedef {{ x: number, y: number, k: number }} View */

export class Graph {
    /** @type {Record<Layer, string>} */
    static LAYER_NAMES = {
        l1: "Cables",
        l2: "VLANs",
        l3: "Addresses",
        bgp: "BGP",
        ospf: "OSPF",
        tunnels: "Tunnels",
    };

    /** @type {Record<Layer, string>} */
    static #LAYER_HELP = {
        l1: "Each cable a port's link names. A LAG's cables are one line.",
        l2: "The VLANs each cable carries. Pick a VLAN to light up every cable that carries it.",
        l3: "Prefixes two or more devices hold an address in, and point-to-point addresses. Loopbacks and prefixes only one device holds are left out.",
        bgp: "BGP sessions: between our devices, matched by the address each names, and to every AS outside.",
        ospf: "OSPF adjacencies: devices with OSPF in one area on one prefix, neither side passive.",
        tunnels: "GRE and VXLAN tunnels matched by their endpoints, and WireGuard peers.",
    };

    static LAYERS = /** @type {Layer[]} */ (Object.keys(Graph.LAYER_NAMES));

    /**
     * @param {string | undefined} name
     * @returns {name is Layer}
     */
    static isLayer(name) {
        return Graph.LAYERS.includes(/** @type {Layer} */ (name));
    }

    // The parts of index.html this view draws into.
    static #graphView = Dom.byId("graph-view");
    static #layersNav = Dom.byId("layers");
    static #svg = Dom.svgById("canvas");
    static #viewport = Dom.svgById("viewport");
    static #edgeLayer = Dom.svgById("edges");
    static #nodeLayer = Dom.svgById("nodes");
    static #panel = Dom.byId("panel");
    static #presentButton = Dom.byId("present");
    static #caption = Dom.byId("present-caption");

    // State.
    /** @type {Annotated | undefined} */
    static #data;
    /** @type {Layer} */
    static #layer = Graph.LAYERS.find((name) => name === Dom.store.get("layer")) ?? "l1";
    /** The graph has been drawn while visible at least once; until then it is fitted when shown. */
    static #drawn = false;
    /** @type {Selection} */
    static #selection;
    /** @type {string | undefined} */
    static #hovered;
    /** @type {number | undefined} */
    static #vlanFocus;
    /** A VLAN to light up once the VLAN layer is shown, asked for from the tables. @type {number | undefined} */
    static #pendingVlan;
    /** Cables to light up as one path, asked for from the tools, and those lit now. @type {GraphEdge[] | undefined} */
    static #pendingPath;
    /** @type {Set<string> | undefined} */
    static #pathFocus;
    /** A comparison with another commit: its name, the edges it adds, and those gone. @type {{ name: string, added: Set<string>, removed: GraphEdge[] } | undefined} */
    static #comparison;
    /** Presenting: the network on a big screen, going through every layer and lighting its busiest devices in turn. Kept, so a screen that reloads stays on it. */
    static #presenting = Dom.store.get("present") === true;
    /** The device lit while presenting; none while the whole layer is shown. @type {string | undefined} */
    static #touring;
    /** @type {ReturnType<typeof setInterval> | undefined} */
    static #tour;

    /** @param {GraphEdge} edge */
    static #edgeKey(edge) {
        return `${edge.layer} ${edge.from} ${edge.to} ${edge.label}`;
    }

    static #view = { x: 0, y: 0, k: 1 };
    /** Where the reader left each layer's view, as each layer is a drawing of its own. @type {Map<Layer, View>} */
    static #views = new Map();

    /** @typedef {Record<string, [number, number]>} SavedPlaces */

    static #saved = /** @type {Partial<Record<Layer, SavedPlaces>>} */ (Dom.store.get("layouts") ?? {});
    // The one layout an earlier Studio kept for every layer carries on as the cables layer's.
    static #earlier = /** @type {SavedPlaces | undefined} */ (Dom.store.get("positions"));

    /** Where each node is on each layer: every layer is laid out for its own lines, and keeps where its devices were moved. @type {Map<Layer, Map<string, Point>>} */
    static #layouts = new Map(
        Graph.LAYERS.map((name) => {
            const places = Graph.#saved[name] ?? (name === "l1" ? Graph.#earlier : undefined) ?? {};
            return [name, new Map(Object.entries(places).map(([id, [x, y]]) => [id, { x, y }]))];
        })
    );

    /** @param {Layer} name */
    static #layoutOf(name) {
        return /** @type {Map<string, Point>} */ (Graph.#layouts.get(name));
    }

    /** Where nodes are drawn now: the layer's own places, or, while the layer changes, the places on the way there. */
    static #positions = Graph.#layoutOf(Graph.#layer);

    /** @type {Map<string, SVGGElement>} */
    static #nodeElements = new Map();
    /** @type {{ edge: DrawnEdge, group: SVGGElement, path: SVGPathElement, hit: SVGPathElement, label: SVGTextElement, offset: number }[]} */
    static #edgeElements = [];

    static #savePositions() {
        /** @param {Map<string, Point>} places */
        const rounded = (places) => Object.fromEntries([...places].map(([id, point]) => [id, [Math.round(point.x), Math.round(point.y)]]));
        Dom.store.set("layouts", Object.fromEntries([...Graph.#layouts].map(([name, places]) => [name, rounded(places)])));
    }

    /**
     * A number from 0 to 1 that is always the same for the same text, so a layout comes out the same each time.
     *
     * @param {string} text
     */
    static #hash(text) {
        let value = 2166136261;
        for (const char of text) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
        return (value >>> 0) / 4294967296;
    }

    /**
     * Place one layer's nodes with a force layout: every node pushes every other away, and each of the layer's edges pulls its ends together. A node placed before keeps its place unless `fresh`, so the drawing does not jump when the config changes.
     * A node new to a layer starts where it is on the cables layer, so each layer is laid out for its own lines yet still looks like the same network.
     *
     * @param {GraphNode[]} nodes
     * @param {GraphEdge[]} edges
     * @param {boolean} fresh
     * @param {Map<string, Point>} places the layer's places, filled in
     * @param {Map<string, Point>} [seed] places to start new nodes from
     */
    static #layout(nodes, edges, fresh, places, seed) {
        if (fresh) places.clear();

        /** @param {GraphNode} node */
        const halfWidth = (node) =>
            node.kind === "device"
                ? Math.max(node.label.length * 10, (node.detail[0] ?? "").length * 7) / 2 + 60
                : node.label.length * 4 + 30;

        const fixed = new Set(nodes.filter((node) => places.has(node.id)).map((node) => node.id));
        /** @type {Map<string, Set<string>>} */
        const neighbors = new Map();

        for (const edge of edges) {
            if (edge.from === edge.to) continue;
            if (!neighbors.has(edge.from)) neighbors.set(edge.from, new Set());
            if (!neighbors.has(edge.to)) neighbors.set(edge.to, new Set());
            neighbors.get(edge.from)?.add(edge.to);
            neighbors.get(edge.to)?.add(edge.from);
        }

        // A device with no line on this layer is set in a row under the drawing, rather than pushed out to its edges by the rest.
        const loose = edges.length ? nodes.filter((node) => !neighbors.has(node.id) && !places.has(node.id)) : [];
        const linked = nodes.filter((node) => !loose.includes(node));

        function park() {
            if (!loose.length) return;

            const placed = linked.flatMap((node) => places.get(node.id) ?? []);
            const left = placed.length ? Math.min(...placed.map((point) => point.x)) : 0;
            const right = left + Math.max(placed.length ? Math.max(...placed.map((point) => point.x)) - left : 0, 900);
            let x = left;
            let y = (placed.length ? Math.max(...placed.map((point) => point.y)) : 0) + 130;

            for (const node of [...loose].sort((a, b) => a.label.localeCompare(b.label))) {
                const half = halfWidth(node);
                if (x > left && x + half * 2 > right) {
                    x = left;
                    y += 96;
                }

                places.set(node.id, { x: x + half, y });
                x += half * 2 + 24;
            }

            Graph.#savePositions();
        }

        nodes = linked;

        // A new node starts beside a neighbor already placed, or on a circle.
        const radius = 60 * Math.sqrt(nodes.length + 1);

        for (const node of nodes) {
            if (places.has(node.id)) continue;

            const start = seed?.get(node.id);
            if (start) {
                places.set(node.id, { ...start });
                continue;
            }

            const angle = Graph.#hash(node.id) * Math.PI * 2;
            const placed = [...(neighbors.get(node.id) ?? [])].map((id) => places.get(id)).find(Boolean);
            const distance = placed ? 90 : radius;
            const origin = placed ?? { x: 0, y: 0 };

            places.set(node.id, { x: origin.x + Math.cos(angle) * distance, y: origin.y + Math.sin(angle) * distance });
        }

        const moving = nodes.filter((node) => !fixed.has(node.id));
        if (!moving.length) return park();

        const pairs = [...neighbors].flatMap(([from, tos]) => [...tos].filter((to) => from < to).map((to) => [from, to]));
        const ideal = 170;
        const rounds = fixed.size ? 200 : 500;

        /** @param {string} id */
        const at = (id) => /** @type {Point} */ (places.get(id));

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
                        dx = Graph.#hash(a.id + b.id) - 0.5;
                        dy = Graph.#hash(b.id + a.id) - 0.5;
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
                if (!from || !to || !places.has(from) || !places.has(to)) continue;

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

        park();
        Graph.#savePositions();
    }

    // What is drawn.

    /**
     * A layer's edges, with those a comparison says are gone.
     *
     * @param {Layer} name
     * @returns {DrawnEdge[]}
     */
    static #edgesOn(name) {
        const current = Graph.#data?.edges.filter((edge) => edge.layer === name) ?? [];
        if (!Graph.#comparison) return current;

        // An edge the comparison says is gone is drawn when both its ends are still drawn.
        const nodes = new Set(Graph.#data?.nodes.map((node) => node.id));
        const gone = Graph.#comparison.removed.filter((edge) => edge.layer === name && nodes.has(edge.from) && nodes.has(edge.to));
        return [...current, ...gone.map((edge) => ({ ...edge, gone: /** @type {const} */ (true) }))];
    }

    /**
     * A layer's nodes: every device, and whatever else its edges end at.
     *
     * @param {Layer} name
     * @returns {GraphNode[]}
     */
    static #nodesOn(name) {
        const ends = new Set(Graph.#edgesOn(name).flatMap((edge) => [edge.from, edge.to]));
        return Graph.#data?.nodes.filter((node) => node.kind === "device" || ends.has(node.id)) ?? [];
    }

    static #visibleEdges() {
        return Graph.#edgesOn(Graph.#layer);
    }

    static #visibleNodes() {
        return Graph.#nodesOn(Graph.#layer);
    }

    /**
     * Lay out a layer for its own lines. The cables layer comes first, as every other layer's new nodes start from it.
     *
     * @param {Layer} name
     * @param {boolean} fresh forget where the layer's nodes were, and lay it out again
     */
    static #layOut(name, fresh) {
        if (!Graph.#data) return;
        if (name !== "l1") Graph.#layOut("l1", false);

        Graph.#layout(
            Graph.#nodesOn(name),
            Graph.#edgesOn(name),
            fresh,
            Graph.#layoutOf(name),
            name === "l1" ? undefined : Graph.#layoutOf("l1")
        );
    }

    /** The node glide between two layers' places, which a press stops. @type {number | undefined} */
    static #regrouping;

    /** Put the nodes at their own layer's places now, ending a glide between layers. */
    static #settle() {
        if (Graph.#regrouping !== undefined) cancelAnimationFrame(Graph.#regrouping);
        Graph.#regrouping = undefined;
        Graph.#positions = Graph.#layoutOf(Graph.#layer);
    }

    /**
     * Move the nodes from where they are drawn to their places on the layer shown, so the eye can follow each device to where it is on this layer.
     *
     * @param {Map<string, Point>} from
     */
    static #glideNodes(from) {
        Graph.#settle();

        const to = Graph.#layoutOf(Graph.#layer);
        if (Dom.still.matches || from === to) return;

        /** @type {Map<string, Point>} */
        const shown = new Map();
        const began = performance.now();

        /** @param {number} now */
        const step = (now) => {
            const t = Math.min((now - began) / 700, 1);
            const eased = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;

            for (const [id, end] of to) {
                const start = from.get(id) ?? end;
                shown.set(id, { x: start.x + (end.x - start.x) * eased, y: start.y + (end.y - start.y) * eased });
            }

            Graph.#positions = t < 1 ? shown : to;
            Graph.#place();
            Graph.#regrouping = t < 1 ? requestAnimationFrame(step) : undefined;
        };

        Graph.#positions = shown;
        step(began);
    }

    /** @param {string} id */
    static #nodeById(id) {
        return Graph.#data?.nodes.find((node) => node.id === id);
    }

    /**
     * @param {GraphNode} node
     * @returns {"error" | "warning" | undefined}
     */
    static #markOf(node) {
        if (!Graph.#data || node.kind !== "device") return undefined;

        const findings = Graph.#data.findings.filter((finding) => finding.device === node.label);
        if (findings.some((finding) => finding.level === "error")) return "error";

        const drift = Graph.#data.drift[node.label]?.status;
        if (findings.length || drift === "differs" || drift === "cannot plan") return "warning";

        return undefined;
    }

    /**
     * @param {GraphEdge} edge
     * @param {number} offset
     * @returns {{ d: string, label: Point }}
     */
    static #curve(edge, offset) {
        const a = Graph.#positions.get(edge.from) ?? { x: 0, y: 0 };
        const b = Graph.#positions.get(edge.to) ?? { x: 0, y: 0 };
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
    static #place() {
        Graph.#viewport.setAttribute("transform", `translate(${Graph.#view.x},${Graph.#view.y}) scale(${Graph.#view.k})`);
        Graph.#svg.classList.toggle("far", Graph.#view.k < 0.4);

        for (const [id, group] of Graph.#nodeElements) {
            const point = Graph.#positions.get(id) ?? { x: 0, y: 0 };
            group.setAttribute("transform", `translate(${point.x},${point.y})`);
        }

        for (const { edge, path, hit, label, offset } of Graph.#edgeElements) {
            const { d, label: middle } = Graph.#curve(edge, offset);
            path.setAttribute("d", d);
            hit.setAttribute("d", d);
            label.setAttribute("x", String(middle.x));
            label.setAttribute("y", String(middle.y));
        }
    }

    /** Past this many edges between the same two nodes, they are drawn as one, which lists them all when selected. */
    static #MOST_APART = 3;

    /** @type {Record<Layer, string>} */
    static #MANY = { l1: "cables", l2: "cables", l3: "shared prefixes", bgp: "sessions", ospf: "adjacencies", tunnels: "tunnels" };

    /** @type {Record<Layer, string>} */
    static #ONE = { l1: "cable", l2: "cable", l3: "shared prefix", bgp: "session", ospf: "adjacency", tunnels: "tunnel" };

    /**
     * The edges to draw: each on its own, or, past a few between the same two nodes, one for all of them.
     *
     * @param {DrawnEdge[]} edges
     * @returns {DrawnEdge[]}
     */
    static #bundled(edges) {
        /** @type {Map<string, DrawnEdge[]>} */
        const byPair = new Map();
        for (const edge of edges) {
            const pair = `${[edge.from, edge.to].sort().join("|")}${edge.gone ? " gone" : ""}`;
            byPair.set(pair, [...(byPair.get(pair) ?? []), edge]);
        }

        return [...byPair.values()].flatMap((members) => {
            const [first] = members;
            if (!first || members.length <= Graph.#MOST_APART) return members;

            /** @type {Map<number, import("../../core/topology").CarriedVlan>} */
            const vlans = new Map();
            for (const member of members) for (const vlan of member.vlans ?? []) vlans.set(vlan.id, vlan);

            return [
                {
                    layer: first.layer,
                    from: first.from,
                    to: first.to,
                    label: `${members.length} ${Graph.#MANY[first.layer]}`,
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
    static #signals(edge, id) {
        if (Dom.still.matches || edge.oneSided || edge.gone) return [];

        const a = Graph.#positions.get(edge.from) ?? { x: 0, y: 0 };
        const b = Graph.#positions.get(edge.to) ?? { x: 0, y: 0 };
        const seconds = Math.min(Math.max(Math.hypot(b.x - a.x, b.y - a.y) / (Graph.#presenting ? 110 : 45), 1.6), 12);
        const phase = Graph.#hash(`${edge.from}${edge.to}${edge.label}`) * seconds;
        const backwards = Graph.#presenting ? [false, true] : [Graph.#hash(edge.label) < 0.5];

        return backwards.map((back, index) => {
            const dot = Dom.s("circle", { class: "signal", r: 3.5 });
            const motion = Dom.s("animateMotion", {
                dur: `${seconds.toFixed(2)}s`,
                begin: `-${(phase + (index * seconds) / 2).toFixed(2)}s`,
                repeatCount: "indefinite",
                ...(back ? { keyPoints: "1;0", keyTimes: "0;1", calcMode: "linear" } : {}),
            });

            motion.append(Dom.s("mpath", { href: `#${id}` }));
            dot.append(motion);
            return dot;
        });
    }

    /** A confident arrival: fast at first, settling at the end. */
    static #EASE = "cubic-bezier(0.16, 1, 0.3, 1)";

    /**
     * Draw the network in from its busiest device outward, a ring of neighbours at a time, each cable drawn from its nearer end.
     *
     * @param {Set<string>} fresh the nodes this drawing adds, which fade in; the others are already on screen
     */
    static #arrive(fresh) {
        if (Dom.still.matches || !Graph.#edgeElements.length) return;

        /** @param {string} id */
        const degree = (id) => Graph.#edgeElements.filter(({ edge }) => edge.from === id || edge.to === id).length;
        const hub = [...Graph.#nodeElements.keys()].sort((a, b) => degree(b) - degree(a))[0];

        /** @type {Map<string, number>} */
        const ring = new Map(hub ? [[hub, 0]] : []);
        for (let queue = hub ? [hub] : []; queue.length;) {
            const id = /** @type {string} */ (queue.shift());
            for (const { edge } of Graph.#edgeElements) {
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

        for (const [id, group] of Graph.#nodeElements) {
            if (!fresh.has(id)) continue;
            group.animate([{ opacity: 0 }, { opacity: 1 }], {
                duration: 360,
                delay: ringOf(id) * step,
                easing: Graph.#EASE,
                fill: "backwards",
            });
        }

        for (const { edge, group, path, label } of Graph.#edgeElements) {
            const forward = ringOf(edge.from) <= ringOf(edge.to);
            const delay = (Math.min(ringOf(edge.from), ringOf(edge.to)) + 0.5) * step;

            if (edge.oneSided || edge.gone) {
                path.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 420, delay, easing: Graph.#EASE, fill: "backwards" });
            } else {
                // Measured as one whole length, so the line draws in right even while its ends glide to a new layer's places.
                path.setAttribute("pathLength", "1");
                const start = { strokeDasharray: "1 1", strokeDashoffset: forward ? 1 : -1 };
                const end = { strokeDasharray: "1 1", strokeDashoffset: 0 };
                const drawing = path.animate([start, end], { duration: 560, delay, easing: Graph.#EASE, fill: "backwards" });
                drawing.addEventListener("finish", () => path.removeAttribute("pathLength"));
                drawing.addEventListener("cancel", () => path.removeAttribute("pathLength"));
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
    static #draw(arrival) {
        const before = new Set(Graph.#nodeElements.keys());

        Graph.#edgeLayer.replaceChildren();
        Graph.#nodeLayer.replaceChildren();
        Graph.#nodeElements.clear();
        Graph.#edgeElements.length = 0;

        const edges = Graph.#bundled(Graph.#visibleEdges());

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

            const added =
                Graph.#comparison &&
                [edge, ...(edge.members ?? [])].some((one) => !one.gone && Graph.#comparison?.added.has(Evaluate.changeKey(one)));
            const change = edge.gone ? " gone" : added ? " added" : "";
            const group = Dom.s("g", { class: `edge${edge.oneSided ? " one-sided" : ""}${change}` });
            const hit = Dom.s("path", { class: "hit" });
            const path = Dom.s("path", { id: `cable-${number}` });
            const label = Dom.s("text", { "text-anchor": "middle", "dominant-baseline": "central" });
            label.textContent = edge.label;

            group.append(path, hit, ...Graph.#signals(edge, `cable-${number}`), label);

            // Selected on press: the canvas captures the pointer for panning, so no click would reach the edge.
            group.addEventListener("pointerdown", (event) => {
                event.stopPropagation();
                Graph.#select({ edge });
            });

            Graph.#edgeLayer.append(group);
            Graph.#edgeElements.push({ edge, group, path, hit, label, offset });
        }

        for (const node of Graph.#visibleNodes()) {
            const group = Dom.s("g", { class: `node ${node.kind} ${Graph.#markOf(node) ?? ""}`, tabindex: 0 });
            const rect = Dom.s("rect", { rx: node.kind === "segment" ? 14 : 8 });
            group.append(rect);

            const device = node.kind === "device";
            const lines = device ? [node.label, node.detail[0] ?? ""] : [node.label];
            const texts = lines.map((line, index) => {
                const y = device ? (index === 0 ? -9 : 13) : 0;
                const text = Dom.s("text", { class: index === 0 ? "name" : "sub", y });
                text.textContent = line;
                group.append(text);
                return text;
            });

            Graph.#nodeLayer.append(group);

            // Each box fits its text, so it is measured once drawn. A device's text starts after its chassis mark.
            const mark = device ? 46 : 0;
            const width = Math.max(...texts.map((text) => text.getComputedTextLength()), device ? 110 : 0) + 32 + mark;
            const height = device ? 62 : 34;
            rect.setAttribute("x", String(-width / 2));
            rect.setAttribute("y", String(-height / 2));
            rect.setAttribute("width", String(width));
            rect.setAttribute("height", String(height));

            // The mark of the device presenting lights now: a ring around its frame, shown only then.
            const beacon = Dom.s("g", { class: "beacon", "aria-hidden": "true" });
            beacon.append(Dom.s("rect", { x: -width / 2 - 10, y: -height / 2 - 10, width: width + 20, height: height + 20, rx: 16 }));
            group.insertBefore(beacon, rect);

            if (device) {
                for (const text of texts) text.setAttribute("x", String(-width / 2 + 16 + mark));

                // A small front panel: a chassis with two rows of ports, drawn rather than pictured.
                const left = -width / 2 + 16;
                const chassis = Dom.s("g", { class: "chassis", "aria-hidden": "true" });
                chassis.append(Dom.s("rect", { x: left, y: -15, width: 34, height: 30, rx: 4 }));
                for (const row of [0, 1]) {
                    for (const column of [0, 1, 2]) {
                        chassis.append(
                            Dom.s("rect", { class: "socket", x: left + 6 + column * 8, y: -8 + row * 9, width: 6, height: 6, rx: 1 })
                        );
                    }
                }
                group.insertBefore(chassis, texts[0] ?? null);
            }

            group.addEventListener("pointerdown", (event) => Graph.#startDrag(event, node.id));
            group.addEventListener("pointerenter", () => {
                Graph.#hovered = node.id;
                Graph.#emphasize();
            });
            group.addEventListener("pointerleave", () => {
                Graph.#hovered = undefined;
                Graph.#emphasize();
            });
            group.addEventListener("keydown", (event) => event.key === "Enter" && Graph.#select({ node: node.id }));

            Graph.#nodeElements.set(node.id, group);
        }

        Graph.#place();
        Graph.#emphasize();

        if (arrival) Graph.#arrive(new Set([...Graph.#nodeElements.keys()].filter((id) => arrival === "network" || !before.has(id))));
    }

    /** Light up what the pointer is on, the device lit while presenting, or what is selected, and dim the rest. */
    static #emphasize() {
        const focus =
            Graph.#hovered ?? Graph.#touring ?? (Graph.#selection && "node" in Graph.#selection ? Graph.#selection.node : undefined);
        const selectedEdge = Graph.#selection && "edge" in Graph.#selection ? Graph.#selection.edge : undefined;

        /** @param {GraphEdge} edge */
        const touching = (edge) => edge.from === focus || edge.to === focus;
        /** @param {GraphEdge} edge */
        const carries = (edge) => edge.vlans?.some((vlan) => vlan.id === Graph.#vlanFocus) ?? false;

        /** @type {Set<GraphEdge> | undefined} */
        let litEdges;
        if (focus) litEdges = new Set(Graph.#edgeElements.filter(({ edge }) => touching(edge)).map(({ edge }) => edge));
        else if (Graph.#pathFocus)
            litEdges = new Set(
                Graph.#edgeElements
                    .filter(({ edge }) => [edge, ...(edge.members ?? [])].some((one) => Graph.#pathFocus?.has(Graph.#edgeKey(one))))
                    .map(({ edge }) => edge)
            );
        else if (Graph.#vlanFocus !== undefined && Graph.#layer === "l2")
            litEdges = new Set(Graph.#edgeElements.filter(({ edge }) => carries(edge)).map(({ edge }) => edge));
        else if (selectedEdge) litEdges = new Set([selectedEdge]);

        const litNodes = litEdges ? new Set([...litEdges].flatMap((edge) => [edge.from, edge.to])) : undefined;
        if (focus) litNodes?.add(focus);

        for (const { edge, group } of Graph.#edgeElements) {
            group.classList.toggle("lit", Boolean(litEdges?.has(edge)) && !selectedEdge);
            group.classList.toggle("selected", edge === selectedEdge);
            group.classList.toggle("dim", litEdges !== undefined && !litEdges.has(edge));
        }

        for (const [id, group] of Graph.#nodeElements) {
            group.classList.toggle("selected", Boolean(Graph.#selection && "node" in Graph.#selection && Graph.#selection.node === id));
            group.classList.toggle("touring", Graph.#presenting && id === Graph.#touring && !Graph.#hovered);
            group.classList.toggle("dim", litNodes !== undefined && !litNodes.has(id));
        }
    }

    // Panning, zooming and dragging.
    /** @type {{ id?: string, start: Point, origin: Point, moved: boolean } | undefined} */
    static #drag;

    /**
     * @param {{ clientX: number, clientY: number }} event
     * @returns {Point}
     */
    static #toWorld(event) {
        const box = Graph.#svg.getBoundingClientRect();
        return {
            x: (event.clientX - box.left - Graph.#view.x) / Graph.#view.k,
            y: (event.clientY - box.top - Graph.#view.y) / Graph.#view.k,
        };
    }

    /**
     * @param {PointerEvent} event
     * @param {string} [id]
     */
    static #startDrag(event, id) {
        if (event.button !== 0) return;
        if (Graph.#gliding !== undefined) cancelAnimationFrame(Graph.#gliding);
        Graph.#gliding = undefined;

        // A press ends a glide between layers, so a device is moved from its own place on this layer.
        if (Graph.#regrouping !== undefined) {
            Graph.#settle();
            Graph.#place();
        }
        event.stopPropagation();

        Graph.#svg.setPointerCapture(event.pointerId);
        const point = id ? Graph.#positions.get(id) : undefined;
        const origin = point ? { ...point } : { x: Graph.#view.x, y: Graph.#view.y };
        Graph.#drag = { id, start: { x: event.clientX, y: event.clientY }, origin, moved: false };
        if (!id) Graph.#svg.classList.add("panning");
    }

    /** The scale below which a device's name is too small to read: a first view stops there, and the reader pans for the rest. */
    static #READABLE = 0.6;

    /** The view moving to a new place, which a press or a scroll stops. @type {number | undefined} */
    static #gliding;

    /**
     * Move the view to a new place over a second, zooming evenly and keeping the eye on the point between them. At once when the reader asked for less motion.
     *
     * @param {View} target
     */
    static #glideTo(target) {
        if (Graph.#gliding !== undefined) cancelAnimationFrame(Graph.#gliding);
        Graph.#gliding = undefined;

        if (Dom.still.matches) {
            Graph.#view = target;
            Graph.#place();
            return;
        }

        const box = Graph.#svg.getBoundingClientRect();
        const from = { ...Graph.#view };
        /** @param {View} one */
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

            Graph.#view = { k, x: box.width / 2 - centre.x * k, y: box.height / 2 - centre.y * k };
            Graph.#place();
            Graph.#gliding = t < 1 ? requestAnimationFrame(step) : undefined;
        };

        Graph.#gliding = requestAnimationFrame(step);
    }

    /**
     * Show the whole drawing, or, when that would make it unreadable and `readable` is asked, as much of it as stays readable. `glide` moves there instead of jumping.
     *
     * @param {boolean} [readable]
     * @param {boolean} [glide]
     */
    static #fit(readable = false, glide = false) {
        const target = Graph.#framing(Graph.#visibleNodes(), readable);
        if (!target) return;

        if (glide) return Graph.#glideTo(target);
        Graph.#view = target;
        Graph.#place();
    }

    /**
     * The view that frames these nodes.
     *
     * @param {GraphNode[]} nodes
     * @param {boolean} readable
     * @returns {View | undefined}
     */
    static #framing(nodes, readable) {
        // Framed where the nodes are going, not where a glide between layers has them now.
        const places = Graph.#layoutOf(Graph.#layer);
        const points = nodes.flatMap((node) => {
            const point = places.get(node.id);
            return point ? [point] : [];
        });
        if (!points.length) return undefined;

        const box = Graph.#svg.getBoundingClientRect();
        const xs = points.map((point) => point.x);
        const ys = points.map((point) => point.y);
        const width = Math.max(...xs) - Math.min(...xs) + 190;
        const height = Math.max(...ys) - Math.min(...ys) + 130;
        const whole = Math.min(Math.max(Math.min(box.width / width, box.height / height), 0.15), 1.8);
        const k = readable ? Math.max(whole, Graph.#READABLE) : whole;

        // When the whole drawing does not fit readably, the view starts on the device with the most lines, the heart of the network.
        const edges = Graph.#visibleEdges();
        const degree = (/** @type {string} */ id) => edges.filter((edge) => edge.from === id || edge.to === id).length;
        const hub = [...nodes].sort((a, b) => degree(b.id) - degree(a.id))[0];
        const centre =
            k > whole && hub && places.has(hub.id)
                ? /** @type {Point} */ (places.get(hub.id))
                : { x: (Math.max(...xs) + Math.min(...xs)) / 2, y: (Math.max(...ys) + Math.min(...ys)) / 2 };

        // Presenting leaves room for the slow drift and the caption, so nothing framed is cut at the screen's edge.
        const shown = Graph.#presenting ? k * 0.86 : k;

        return { k: shown, x: box.width / 2 - centre.x * shown, y: box.height / 2 - centre.y * shown };
    }

    /** While presenting, frame what is shown: the lit device with everything it has a line to, or the whole layer. */
    static #frameTour(glide = true) {
        const lit = Graph.#touring;
        if (!lit) return Graph.#fit(false, glide);

        const near = new Set([
            lit,
            ...Graph.#visibleEdges().flatMap((edge) => (edge.from === lit ? [edge.to] : edge.to === lit ? [edge.from] : [])),
        ]);
        const target = Graph.#framing(
            Graph.#visibleNodes().filter((node) => near.has(node.id)),
            false
        );
        if (!target) return;

        if (glide) return Graph.#glideTo(target);
        Graph.#view = target;
        Graph.#place();
    }

    // Presenting.

    /** Say what is shown while presenting: the device lit, or the whole layer. */
    static #showCaption() {
        Graph.#caption.hidden = !Graph.#presenting;
        if (!Graph.#presenting) return;

        const node = Graph.#touring ? Graph.#nodeById(Graph.#touring) : undefined;
        const edges = Graph.#visibleEdges().filter((edge) => !node || edge.from === node.id || edge.to === node.id);
        const count = `${edges.length} ${edges.length === 1 ? Graph.#ONE[Graph.#layer] : Graph.#MANY[Graph.#layer]}`;

        if (node)
            Graph.#caption.replaceChildren(
                Dom.h("strong", {}, node.label),
                Dom.h("span", {}, [node.detail[0], count].filter(Boolean).join(", "))
            );
        else
            Graph.#caption.replaceChildren(
                Dom.h("strong", {}, Graph.LAYER_NAMES[Graph.#layer]),
                Dom.h("span", {}, `${Graph.#visibleNodes().filter((one) => one.kind === "device").length} devices, ${count}`)
            );

        Dom.enter(Graph.#caption);
    }

    /** How many devices are lit on each layer while presenting, busiest first, before it moves on to the next layer. */
    static #LIT_PER_LAYER = 4;

    /** How far presenting has gone on this layer: 0 while the whole layer is shown, then each lit device in turn. */
    static #tourStep = 0;

    /** The move to the next layer, waiting while the view zooms out to the whole of this one. @type {ReturnType<typeof setTimeout> | undefined} */
    static #leaving;

    /** The next layer that has lines to show, after this one; this one when no other has any. */
    static #nextLayer() {
        const after = [
            ...Graph.LAYERS.slice(Graph.LAYERS.indexOf(Graph.#layer) + 1),
            ...Graph.LAYERS.slice(0, Graph.LAYERS.indexOf(Graph.#layer) + 1),
        ];
        return after.find((name) => Graph.#data?.edges.some((edge) => edge.layer === name)) ?? Graph.#layer;
    }

    /** While presenting: show the whole layer, light its busiest devices one at a time, then move on to the next layer. */
    static #tourNext() {
        if (Graph.#graphView.hidden || document.hidden || Graph.#hovered || Graph.#drag || Graph.#leaving) return;

        const edges = Graph.#visibleEdges();
        const degree = (/** @type {string} */ id) => edges.filter((edge) => edge.from === id || edge.to === id).length;
        const devices = Graph.#visibleNodes()
            .filter((node) => node.kind === "device" && degree(node.id))
            .sort((a, b) => degree(b.id) - degree(a.id) || a.label.localeCompare(b.label))
            .slice(0, Graph.#LIT_PER_LAYER);

        Graph.#tourStep += 1;
        Graph.#touring = devices[Graph.#tourStep - 1]?.id;

        if (Graph.#touring || Graph.#nextLayer() === Graph.#layer) {
            if (!Graph.#touring) Graph.#tourStep = 0;
            Graph.#emphasize();
            Graph.#showCaption();
            Graph.#frameTour();
            return;
        }

        // Every lit device has had its turn: the view zooms out to the whole layer first, so the next layer is reached from the whole drawing.
        Graph.#tourStep = 0;
        Graph.#emphasize();
        Graph.#showCaption();
        Graph.#frameTour();

        const next = Graph.#nextLayer();
        Graph.#leaving = setTimeout(() => {
            Graph.#leaving = undefined;

            // Moving on replaces the address rather than adding to the history, so Back still leaves Studio's last place.
            if (Graph.#presenting && !Graph.#graphView.hidden) location.replace(`#graph/${next}`);
        }, 2600);
    }

    /** Start the turns over, so the layer shown now has its full time. */
    static #restartTour() {
        clearInterval(Graph.#tour);
        clearTimeout(Graph.#leaving);
        Graph.#leaving = undefined;
        if (Graph.#presenting) Graph.#tour = setInterval(Graph.#tourNext, 6000);
    }

    /** @param {boolean} on */
    static #setPresenting(on) {
        Graph.#presenting = on;
        Dom.store.set("present", on);

        document.body.classList.toggle("presenting", on);
        Graph.#presentButton.setAttribute("aria-pressed", String(on));

        Graph.#touring = undefined;
        if (on) Graph.#selection = undefined;
        Graph.#restartTour();

        if (Graph.#graphView.hidden || !Graph.#data) return;

        // The panel hides or returns, so the drawing is fitted once the page has its new size.
        Graph.#draw();
        Graph.#showPanel();
        Graph.#showCaption();
        requestAnimationFrame(() => (Graph.#presenting ? Graph.#frameTour(false) : Graph.#fit()));
    }

    // The side panel.
    /** @param {Selection} next */
    static #select(next) {
        /** @param {Selection} one */
        const keyOf = (one) => (one && "node" in one ? one.node : one ? Graph.#edgeKey(one.edge) : "");
        const changed = keyOf(next) !== keyOf(Graph.#selection);

        Graph.#selection = next;
        Graph.#pathFocus = undefined;
        Graph.#emphasize();
        Graph.#showPanel();

        if (changed) Dom.enter(Graph.#panel);
    }

    /**
     * @param {Annotated["findings"]} findings
     * @param {boolean} withDevice
     */
    static #findingList(findings, withDevice) {
        return Dom.h(
            "ul",
            {},
            ...findings.map((finding) =>
                Dom.h(
                    "li",
                    {},
                    Dom.h("span", { class: `badge ${finding.level}` }, finding.level),
                    withDevice && finding.device
                        ? Dom.link(finding.device, () => Graph.#select({ node: `device:${finding.device}` }))
                        : undefined,
                    withDevice && finding.device ? ": " : undefined,
                    finding.message
                )
            )
        );
    }

    /** @param {CarriedVlan[]} vlans */
    static #vlanChips(vlans) {
        const chips = Dom.h("div", { class: "chips" });

        for (const vlan of vlans) {
            const button = Dom.h("button", { "aria-pressed": String(vlan.id === Graph.#vlanFocus) }, `${vlan.name} ${vlan.id}`);
            button.addEventListener("click", () => {
                Graph.#vlanFocus = Graph.#vlanFocus === vlan.id ? undefined : vlan.id;
                Graph.#selection = undefined;
                Graph.#emphasize();
                Graph.#showPanel();
            });
            chips.append(button);
        }

        return chips;
    }

    static #legend() {
        /**
         * @param {boolean} dashed
         * @param {string} color
         */
        const sample = (dashed, color) => {
            const icon = Dom.s("svg", { width: 34, height: 10 });
            icon.append(
                Dom.s("line", { x1: 2, y1: 5, x2: 32, y2: 5, stroke: color, "stroke-width": 2, "stroke-dasharray": dashed ? "6 4" : "" })
            );
            return icon;
        };

        /** @param {string} style */
        const box = (style) => {
            const icon = Dom.s("svg", { width: 34, height: 16 });
            icon.append(Dom.s("rect", { x: 2, y: 2, width: 30, height: 12, rx: 3, fill: "none", "stroke-width": 2, style }));
            return icon;
        };

        return Dom.h(
            "ul",
            { class: "legend" },
            Dom.h("li", {}, sample(false, "var(--edge)"), "both ends declare it"),
            Dom.h("li", {}, sample(true, "var(--warning)"), "only one end declares it"),
            Dom.h("li", {}, box("stroke: var(--error)"), "a device with an error"),
            Dom.h("li", {}, box("stroke: var(--warning)"), "a warning, or unlike its snapshot"),
            Dom.h("li", {}, box("stroke: var(--line); stroke-dasharray: 5 3"), "outside the network")
        );
    }

    static #showPanel() {
        Graph.#panel.replaceChildren();
        if (!Graph.#data) return;

        if (Graph.#selection && "node" in Graph.#selection) {
            const node = Graph.#nodeById(Graph.#selection.node);
            if (node) return Graph.#showNode(node);
        }

        if (Graph.#selection && "edge" in Graph.#selection) return Graph.#showEdge(Graph.#selection.edge);

        const drift = Graph.#data.drift;
        const devices = Graph.#data.nodes.filter((node) => node.kind === "device");
        const drifted = devices.filter((node) => drift[node.label]?.status === "differs");
        const unsnapped = devices.filter((node) => drift[node.label]?.status === "no snapshot");

        Graph.#panel.append(
            Dom.h("h2", {}, Graph.LAYER_NAMES[Graph.#layer]),
            Dom.h("p", { class: "muted" }, Graph.#LAYER_HELP[Graph.#layer])
        );

        if (Graph.#comparison) {
            Graph.#panel.append(
                Dom.h("h3", {}, "Compared with ", Graph.#comparison.name),
                Dom.h(
                    "p",
                    {},
                    Dom.h("span", { class: "added" }, "Green lines"),
                    " are new, ",
                    Dom.h("span", { class: "removed" }, "red dashed lines"),
                    " are gone. ",
                    Dom.link("Stop comparing", () => {
                        Graph.#comparison = undefined;
                        Graph.#draw();
                        Graph.#showPanel();
                    })
                )
            );
        }

        if (Graph.#layer === "l2") {
            /** @type {Map<number, CarriedVlan>} */
            const vlans = new Map();
            for (const edge of Graph.#visibleEdges()) for (const vlan of edge.vlans ?? []) vlans.set(vlan.id, vlan);

            const sorted = [...vlans.values()].sort((a, b) => a.id - b.id);
            if (sorted.length) Graph.#panel.append(Dom.h("h3", {}, "VLANs"), Graph.#vlanChips(sorted));
        }

        if (Graph.#data.findings.length)
            Graph.#panel.append(
                Dom.h("h3", {}, "Found by ", Dom.h("code", {}, "circuit validate")),
                Graph.#findingList(Graph.#data.findings, true)
            );

        if (drifted.length) {
            Graph.#panel.append(
                Dom.h("h3", {}, "Unlike their last snapshot"),
                Dom.h(
                    "ul",
                    {},
                    ...drifted.map((node) =>
                        Dom.h(
                            "li",
                            {},
                            Dom.link(node.label, () => Graph.#select({ node: node.id }))
                        )
                    )
                )
            );
        }

        if (unsnapped.length) {
            Graph.#panel.append(
                Dom.h("h3", {}, "No snapshot yet"),
                Dom.h("p", { class: "muted" }, unsnapped.map((node) => node.label).join(", "))
            );
        }

        Graph.#panel.append(Dom.h("h3", {}, "Legend"), Graph.#legend());
    }

    /** @param {GraphNode} node */
    static #showNode(node) {
        const kinds = { device: "device", segment: "shared segment", outside: "outside the network" };
        Graph.#panel.append(Dom.h("h2", {}, node.label), Dom.h("div", { class: "kind" }, kinds[node.kind]));

        if (node.kind === "device")
            Graph.#panel.append(
                Dom.h(
                    "p",
                    {},
                    Dom.link("Everything it holds", () => Dom.go(`devices/${encodeURIComponent(node.label)}`))
                )
            );
        if (node.detail.length) Graph.#panel.append(Dom.h("h3", {}, "Details"), Dom.h("pre", {}, node.detail.join("\n")));

        if (node.kind === "device" && Graph.#data) {
            const findings = Graph.#data.findings.filter((finding) => finding.device === node.label);
            if (findings.length)
                Graph.#panel.append(
                    Dom.h("h3", {}, "Found by ", Dom.h("code", {}, "circuit validate")),
                    Graph.#findingList(findings, false)
                );

            const drift = Graph.#data.drift[node.label];
            if (drift) {
                const notes = {
                    matches: ["Matches its last snapshot."],
                    differs: ["Differs from its last snapshot. This is what ", Dom.h("code", {}, "circuit diff"), " would send:"],
                    "no snapshot": ["No snapshot yet: run ", Dom.h("code", {}, "circuit snapshot"), "."],
                    "cannot plan": ["Could not be planned against its snapshot:"],
                };

                Graph.#panel.append(Dom.h("h3", {}, "Against its snapshot"), Dom.h("p", {}, ...notes[drift.status]));
                if (drift.lines.length) Graph.#panel.append(Dom.h("pre", {}, drift.lines.join("\n")));
            }
        }

        const edges = Graph.#visibleEdges().filter((edge) => edge.from === node.id || edge.to === node.id);

        Graph.#panel.append(Dom.h("h3", {}, `${Graph.LAYER_NAMES[Graph.#layer]} here`));
        if (!edges.length) Graph.#panel.append(Dom.h("p", { class: "muted" }, "None on this layer."));

        Graph.#panel.append(
            Dom.h(
                "ul",
                {},
                ...edges.map((edge) => {
                    const other = Graph.#nodeById(edge.from === node.id ? edge.to : edge.from);
                    return Dom.h(
                        "li",
                        {},
                        Dom.link(edge.label, () => Graph.#select({ edge })),
                        Dom.h("span", { class: "muted" }, ` with ${other?.label ?? "?"}`)
                    );
                })
            )
        );
    }

    /** @param {GraphEdge} edge */
    static #showEdge(edge) {
        const from = Graph.#nodeById(edge.from);
        const to = Graph.#nodeById(edge.to);

        Graph.#panel.append(
            Dom.h("h2", {}, edge.label),
            Dom.h(
                "div",
                { class: "kind" },
                `${Graph.LAYER_NAMES[edge.layer]}, between `,
                Dom.link(from?.label ?? edge.from, () => Graph.#select({ node: edge.from })),
                " and ",
                Dom.link(to?.label ?? edge.to, () => Graph.#select({ node: edge.to }))
            )
        );

        if (edge.oneSided)
            Graph.#panel.append(Dom.h("p", {}, Dom.h("span", { class: "badge warning" }, "one end"), "Only one end declares it."));
        if (edge.detail.length) Graph.#panel.append(Dom.h("h3", {}, "Details"), Dom.h("pre", {}, edge.detail.join("\n")));
        if (edge.vlans?.length) Graph.#panel.append(Dom.h("h3", {}, "VLANs"), Graph.#vlanChips(edge.vlans));
    }

    static #showLayerButtons() {
        Graph.#layersNav.replaceChildren();

        for (const [index, name] of Graph.LAYERS.entries()) {
            const count = Graph.#data?.edges.filter((edge) => edge.layer === name).length ?? 0;
            const button = Dom.h(
                "button",
                { "aria-pressed": String(name === Graph.#layer), title: `${Graph.#LAYER_HELP[name]} Key ${index + 1}.` },
                Graph.LAYER_NAMES[name],
                Dom.h("span", { class: "count" }, String(count))
            );
            button.addEventListener("click", () => Dom.go(`graph/${name}`));
            Graph.#layersNav.append(button);
        }
    }

    /** The layer shown last, or the first. */
    static currentLayer() {
        return Graph.#layer;
    }

    /**
     * Take a new graph, when the config changed. Nodes keep their places, and a selection whose node or edge is gone is dropped.
     *
     * @param {Annotated} next
     */
    static set(next) {
        Graph.#data = next;

        if (Graph.#selection && "node" in Graph.#selection && !Graph.#nodeById(Graph.#selection.node)) Graph.#selection = undefined;
        if (Graph.#selection && "edge" in Graph.#selection) {
            const { layer: was, from, to, label } = Graph.#selection.edge;
            const same = Graph.#data.edges.find(
                (edge) => edge.layer === was && edge.from === from && edge.to === to && edge.label === label
            );
            Graph.#selection = same ? { edge: same } : undefined;
        }

        Graph.#layOut(Graph.#layer, false);
    }

    /**
     * Draw a layer, now that the graph is visible: its labels are measured as they are drawn.
     *
     * @param {Layer} next
     */
    static show(next) {
        if (next !== Graph.#layer) {
            if (Graph.#selection && "edge" in Graph.#selection) Graph.#selection = undefined;
            Graph.#vlanFocus = undefined;
            Graph.#pathFocus = undefined;
            Graph.#touring = undefined;
            Graph.#tourStep = 0;
            Graph.#restartTour();
        }

        if (Graph.#pendingVlan !== undefined) {
            Graph.#vlanFocus = Graph.#pendingVlan;
            Graph.#pendingVlan = undefined;
        }

        if (Graph.#pendingPath) {
            Graph.#pathFocus = new Set(Graph.#pendingPath.map(Graph.#edgeKey));
            Graph.#pendingPath = undefined;
        }

        // The first view draws the whole network in; a new layer draws in its own lines while its devices glide to their places on it.
        const arrival = !Graph.#drawn && Graph.#data ? "network" : next !== Graph.#layer ? "cables" : undefined;
        const from = Graph.#positions;
        if (Graph.#drawn) Graph.#views.set(Graph.#layer, { ...Graph.#view });

        Graph.#layer = next;
        Dom.store.set("layer", Graph.#layer);
        Graph.#layOut(Graph.#layer, false);

        if (arrival === "cables") Graph.#glideNodes(from);
        else Graph.#settle();

        Graph.#showLayerButtons();
        Graph.#draw(arrival);
        Graph.#showPanel();
        Graph.#showCaption();

        // Presenting shows the whole layer as it comes in; a first view on a laptop starts where names can be read. A layer shown before
        // comes back as the reader left it, and one shown for the first time glides into view.
        if (Graph.#presenting && arrival) Graph.#fit();
        else if (!Graph.#drawn && Graph.#data) Graph.#fit(true);
        else if (arrival === "cables") {
            const left = Graph.#views.get(Graph.#layer);
            if (left) Graph.#glideTo(left);
            else Graph.#fit(true, true);
        }
        Graph.#drawn = Graph.#data !== undefined;
    }

    /**
     * Select a device, for when the graph is shown next.
     *
     * @param {string} name
     */
    static selectDevice(name) {
        Graph.#selection = { node: `device:${name}` };
    }

    /**
     * Show a comparison with another commit on the graph: new edges lit, edges gone drawn dashed.
     *
     * @param {{ name: string, added: GraphEdge[], removed: GraphEdge[] }} next
     */
    static setComparison(next) {
        Graph.#comparison = { name: next.name, added: new Set(next.added.map(Evaluate.changeKey)), removed: next.removed };
        Graph.#selection = undefined;
    }

    /**
     * Light up these cables as one path, for when their layer is shown next.
     *
     * @param {GraphEdge[]} path
     */
    static lightPath(path) {
        Graph.#pendingPath = path;
        Graph.#selection = undefined;
    }

    /**
     * Light up every cable carrying a VLAN, for when the VLAN layer is shown next.
     *
     * @param {number} id
     */
    static lightVlan(id) {
        Graph.#pendingVlan = id;
        Graph.#selection = undefined;
    }

    static {
        Graph.#svg.addEventListener("pointerdown", (event) => Graph.#startDrag(event));

        Graph.#svg.addEventListener("pointermove", (event) => {
            if (!Graph.#drag) return;

            const dx = event.clientX - Graph.#drag.start.x;
            const dy = event.clientY - Graph.#drag.start.y;
            if (Math.hypot(dx, dy) > 3) Graph.#drag.moved = true;
            if (!Graph.#drag.moved) return;

            if (Graph.#drag.id)
                Graph.#positions.set(Graph.#drag.id, {
                    x: Graph.#drag.origin.x + dx / Graph.#view.k,
                    y: Graph.#drag.origin.y + dy / Graph.#view.k,
                });
            else Graph.#view = { ...Graph.#view, x: Graph.#drag.origin.x + dx, y: Graph.#drag.origin.y + dy };

            Graph.#place();
        });

        Graph.#svg.addEventListener("pointerup", () => {
            if (!Graph.#drag) return;

            const ended = Graph.#drag;
            Graph.#drag = undefined;
            Graph.#svg.classList.remove("panning");

            if (ended.moved && ended.id) Graph.#savePositions();
            if (ended.moved) return;

            // A press without a move is a click: on a node it selects the node, and on an empty spot it clears the selection.
            Graph.#select(ended.id ? { node: ended.id } : undefined);
        });

        Graph.#svg.addEventListener(
            "wheel",
            (event) => {
                event.preventDefault();
                if (Graph.#gliding !== undefined) cancelAnimationFrame(Graph.#gliding);
                Graph.#gliding = undefined;

                const point = Graph.#toWorld(event);
                const k = Math.min(Math.max(Graph.#view.k * Math.exp(-event.deltaY * 0.0015), 0.15), 4);
                const box = Graph.#svg.getBoundingClientRect();

                Graph.#view = { k, x: event.clientX - box.left - point.x * k, y: event.clientY - box.top - point.y * k };
                Graph.#place();
            },
            { passive: false }
        );

        Dom.byId("fit").addEventListener("click", () => Graph.#fit());

        Dom.byId("lay-out").addEventListener("click", () => {
            if (!Graph.#data) return;
            Graph.#layOut(Graph.#layer, true);
            Graph.#settle();
            Graph.#draw();
            Graph.#fit();
        });

        // Presenting keeps the whole network in view as the screen changes size.
        window.addEventListener("resize", () => (Graph.#presenting ? Graph.#frameTour(false) : Graph.#place()));

        Graph.#presentButton.addEventListener("click", () => Graph.#setPresenting(!Graph.#presenting));
        Graph.#setPresenting(Graph.#presenting);

        // A hidden page's dots stop moving.
        document.addEventListener("visibilitychange", () => {
            if (!(Graph.#svg instanceof SVGSVGElement)) return;
            if (document.hidden) Graph.#svg.pauseAnimations();
            else Graph.#svg.unpauseAnimations();
        });

        // Saving the layer shown, as it looks.
        Dom.byId("save-svg").addEventListener("click", () => {
            if (!(Graph.#viewport instanceof SVGGraphicsElement)) return;
            Export.save(`circuit-${Graph.#layer}.svg`, new Blob([Export.svg(Graph.#svg, Graph.#viewport).text], { type: "image/svg+xml" }));
        });

        Dom.byId("save-png").addEventListener("click", async () => {
            if (!(Graph.#viewport instanceof SVGGraphicsElement)) return;
            Export.save(`circuit-${Graph.#layer}.png`, await Export.png(Export.svg(Graph.#svg, Graph.#viewport)));
        });

        document.addEventListener("keydown", (event) => {
            if (event.target instanceof HTMLInputElement || Graph.#graphView.hidden) return;

            if (event.key === "Escape") {
                if (Graph.#presenting) Graph.#setPresenting(false);
                Graph.#select(undefined);
            }

            if (event.key === "p" && !event.ctrlKey && !event.metaKey && !event.altKey) Graph.#setPresenting(!Graph.#presenting);

            // Keys 1 to 6 pick a layer.
            const chosen = Graph.LAYERS[Number(event.key) - 1];
            if (chosen) Dom.go(`graph/${chosen}`);
        });
    }
}
