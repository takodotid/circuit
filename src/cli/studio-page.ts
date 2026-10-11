/// <reference lib="dom" />
// The page `circuit studio` serves. `page` runs in the browser: the server sends its source, so it uses nothing from outside its own body but types.

import type { CarriedVlan, GraphEdge, GraphNode, Layer } from "../core/graph";
import type { Annotated } from "./graph";

export const STYLE = `
:root {
    --bg: #f6f7f9;
    --surface: #ffffff;
    --line: #d7dbe0;
    --text: #1d2228;
    --muted: #5d6670;
    --edge: #8a939c;
    --accent: #2f6fdb;
    --error: #d1242f;
    --warning: #b07800;
    --segment: #e9eef6;
    --font: system-ui, -apple-system, "Segoe UI", sans-serif;
    --mono: ui-monospace, "Cascadia Mono", Menlo, Consolas, monospace;
}
@media (prefers-color-scheme: dark) {
    :root {
        --bg: #14171b;
        --surface: #1c2026;
        --line: #333a42;
        --text: #e4e8ec;
        --muted: #98a2ad;
        --edge: #6c7680;
        --accent: #6aa0ff;
        --error: #ff6b6b;
        --warning: #e3b341;
        --segment: #232a33;
    }
}
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; background: var(--bg); color: var(--text); font: 14px/1.45 var(--font); }
body { display: flex; flex-direction: column; }
button { font: inherit; color: inherit; background: var(--surface); border: 1px solid var(--line); border-radius: 6px; padding: 4px 10px; cursor: pointer; }
button:hover { border-color: var(--accent); }
button[aria-pressed="true"] { background: var(--accent); border-color: var(--accent); color: #fff; }
header { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; padding: 10px 16px; background: var(--surface); border-bottom: 1px solid var(--line); }
header .brand { font-weight: 600; }
header nav, header .actions { display: flex; flex-wrap: wrap; gap: 6px; }
header .count { opacity: 0.7; margin-left: 4px; font-size: 12px; }
header .summary { color: var(--muted); font-size: 13px; }
header .live { margin-left: auto; color: var(--muted); font-size: 12px; }
header .live::before { content: ""; display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--warning); margin-right: 6px; }
header .live.on::before { background: #2da44e; }
.banner { margin: 0; padding: 10px 16px; background: var(--error); color: #fff; white-space: pre-wrap; font: 12px/1.4 var(--mono); max-height: 30vh; overflow: auto; }
main { flex: 1; display: flex; min-height: 0; }
svg.canvas { flex: 1; min-width: 0; height: 100%; cursor: grab; touch-action: none; user-select: none; }
svg.canvas.panning { cursor: grabbing; }
aside { width: 340px; overflow: auto; padding: 14px 16px; background: var(--surface); border-left: 1px solid var(--line); }
aside h2 { font-size: 15px; margin: 0 0 4px; overflow-wrap: anywhere; }
aside h3 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); margin: 18px 0 6px; }
aside ul { list-style: none; margin: 0; padding: 0; }
aside li { padding: 3px 0; overflow-wrap: anywhere; }
aside .kind { color: var(--muted); font-size: 12px; }
aside pre { margin: 0; font: 12px/1.45 var(--mono); white-space: pre-wrap; overflow-wrap: anywhere; background: var(--bg); padding: 8px; border-radius: 6px; }
aside a { color: var(--accent); cursor: pointer; text-decoration: none; }
aside a:hover { text-decoration: underline; }
aside .muted { color: var(--muted); }
.badge { display: inline-block; font-size: 11px; font-weight: 600; padding: 0 6px; border-radius: 4px; margin-right: 6px; color: #fff; }
.badge.error { background: var(--error); }
.badge.warning { background: var(--warning); }
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chips button { padding: 2px 8px; font-size: 12px; }
.legend li { display: flex; align-items: center; gap: 8px; }
.legend svg { flex: none; }
.edge path { fill: none; stroke: var(--edge); stroke-width: 1.6; }
.edge.one-sided path:not(.hit) { stroke: var(--warning); stroke-dasharray: 6 4; }
.edge text { font-size: 11px; fill: var(--muted); paint-order: stroke; stroke: var(--bg); stroke-width: 4px; stroke-linejoin: round; }
.edge .hit { stroke: transparent; stroke-width: 12; cursor: pointer; }
.edge.selected path:not(.hit), .edge.lit path:not(.hit) { stroke: var(--accent); stroke-width: 2.6; }
.edge.selected text, .edge.lit text { fill: var(--text); }
.node { cursor: pointer; }
.node rect { fill: var(--surface); stroke: var(--line); stroke-width: 1.5; }
.node.segment rect { fill: var(--segment); }
.node.outside rect { stroke-dasharray: 5 3; }
.node.error rect { stroke: var(--error); stroke-width: 3; }
.node.warning rect { stroke: var(--warning); stroke-width: 3; }
.node.selected rect { stroke: var(--accent); stroke-width: 3; }
.node text { fill: var(--text); font-size: 12px; text-anchor: middle; dominant-baseline: central; pointer-events: none; }
.node text.name { font-weight: 600; font-size: 13px; }
.node text.sub { fill: var(--muted); font-size: 11px; }
.node.segment text, .node.outside text { font-family: var(--mono); font-size: 11px; }
.dim { opacity: 0.18; }
svg.far .edge text { display: none; }
@media (max-width: 760px) {
    main { flex-direction: column; }
    aside { width: auto; height: 40%; border-left: 0; border-top: 1px solid var(--line); }
}
`;

/** Runs in the browser. */
export function page(): void {
    type Point = { x: number; y: number };
    type Data = Annotated & { error?: undefined };
    type Failed = { error: string };
    type Selection = { node: string } | { edge: GraphEdge } | undefined;

    const LAYER_NAMES: Record<Layer, string> = {
        l1: "Cables",
        l2: "VLANs",
        l3: "Addresses",
        bgp: "BGP",
        ospf: "OSPF",
        tunnels: "Tunnels",
    };

    const LAYER_HELP: Record<Layer, string> = {
        l1: "Each cable a port's link names. A LAG's cables are one line.",
        l2: "The VLANs each cable carries. Pick a VLAN to light up every cable that carries it.",
        l3: "Prefixes two or more devices hold an address in, and point-to-point addresses. Loopbacks and prefixes only one device holds are left out.",
        bgp: "BGP sessions: between our devices, matched by the address each names, and to every AS outside.",
        ospf: "OSPF adjacencies: devices with OSPF in one area on one prefix, neither side passive.",
        tunnels: "GRE and VXLAN tunnels matched by their endpoints, and WireGuard peers.",
    };

    const LAYERS = Object.keys(LAYER_NAMES) as Layer[];
    const SVG = "http://www.w3.org/2000/svg";

    // Browser storage can be missing or refuse, in a private window for example. The page works without it.
    const store = {
        get<T>(key: string): T | undefined {
            try {
                const value = localStorage.getItem(`circuit-studio:${key}`);
                return value === null ? undefined : (JSON.parse(value) as T);
            } catch {
                return undefined;
            }
        },
        set(key: string, value: unknown): void {
            try {
                localStorage.setItem(`circuit-studio:${key}`, JSON.stringify(value));
            } catch {}
        },
    };

    /** An element with attributes and children. Text is always set as text, never parsed as HTML. */
    function h<K extends keyof HTMLElementTagNameMap>(
        tag: K,
        attributes: Record<string, string> = {},
        ...children: (Node | string | undefined | false)[]
    ): HTMLElementTagNameMap[K] {
        const element = document.createElement(tag);
        for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
        for (const child of children) if (child !== undefined && child !== false) element.append(child);
        return element;
    }

    function s<K extends keyof SVGElementTagNameMap>(tag: K, attributes: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
        const element = document.createElementNS(SVG, tag);
        for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, String(value));
        return element;
    }

    function link(text: string, action: () => void): HTMLAnchorElement {
        const anchor = h("a", { role: "button", tabindex: "0" }, text);
        anchor.addEventListener("click", action);
        anchor.addEventListener("keydown", (event) => event.key === "Enter" && action());
        return anchor;
    }

    // The page's parts.
    const layerButtons = new Map<Layer, HTMLButtonElement>();
    const nav = h("nav", { "aria-label": "Layers" });
    const summary = h("span", { class: "summary" });
    const live = h("span", { class: "live" }, "connecting");
    const fitButton = h("button", { title: "Fit the drawing to the window" }, "Fit");
    const layoutButton = h("button", { title: "Forget where nodes were moved, and lay them out again" }, "Lay out again");

    const banner = h("pre", { class: "banner", hidden: "" });
    const svg = s("svg", { class: "canvas", role: "img", "aria-label": "The network" });
    const viewport = s("g");
    const edgeLayer = s("g");
    const nodeLayer = s("g");
    viewport.append(edgeLayer, nodeLayer);
    svg.append(viewport);
    const panel = h("aside");

    document.body.append(
        h(
            "header",
            {},
            h("span", { class: "brand" }, "Circuit studio"),
            nav,
            h("div", { class: "actions" }, fitButton, layoutButton),
            summary,
            live
        ),
        banner,
        h("main", {}, svg, panel)
    );

    // State.
    let data: Data | undefined;
    // The layer named in the address, such as `#bgp`, or the one shown last.
    const requested = [location.hash.slice(1), store.get<string>("layer")].find((name) => LAYERS.includes(name as Layer));
    let layer = (requested ?? "l1") as Layer;
    let selection: Selection;
    let hovered: string | undefined;
    let vlanFocus: number | undefined;
    let view = { x: 0, y: 0, k: 1 };

    const saved = store.get<Record<string, [number, number]>>("positions") ?? {};
    const positions = new Map<string, Point>(Object.entries(saved).map(([id, [x, y]]) => [id, { x, y }]));

    const nodeElements = new Map<string, SVGGElement>();
    const edgeElements: {
        edge: GraphEdge;
        group: SVGGElement;
        path: SVGPathElement;
        hit: SVGPathElement;
        label: SVGTextElement;
        offset: number;
    }[] = [];

    function savePositions(): void {
        store.set("positions", Object.fromEntries([...positions].map(([id, point]) => [id, [Math.round(point.x), Math.round(point.y)]])));
    }

    /** A number from 0 to 1 that is always the same for the same text, so a layout comes out the same each time. */
    function hash(text: string): number {
        let value = 2166136261;
        for (const char of text) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
        return (value >>> 0) / 4294967296;
    }

    /**
     * Place nodes with a force layout: every node pushes every other away, and each edge pulls its ends together. A node placed before keeps its place unless `fresh`, so the drawing does not jump when the config changes.
     * Every layer is laid out together, so a device stays where it is when the layer changes.
     */
    function layout(nodes: GraphNode[], edges: GraphEdge[], fresh: boolean): void {
        if (fresh) positions.clear();

        const fixed = new Set(nodes.filter((node) => positions.has(node.id)).map((node) => node.id));
        const neighbors = new Map<string, Set<string>>();

        for (const edge of edges) {
            if (edge.from === edge.to) continue;
            if (!neighbors.has(edge.from)) neighbors.set(edge.from, new Set());
            if (!neighbors.has(edge.to)) neighbors.set(edge.to, new Set());
            neighbors.get(edge.from)!.add(edge.to);
            neighbors.get(edge.to)!.add(edge.from);
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

        const pairs = [...neighbors].flatMap(([from, tos]) => [...tos].filter((to) => from < to).map((to) => [from, to] as const));
        const ideal = 230;
        const rounds = fixed.size ? 200 : 500;

        for (let round = 0; round < rounds; round++) {
            const heat = 40 * (1 - round / rounds) + 1;
            const push = new Map(nodes.map((node) => [node.id, { x: 0, y: 0 }]));

            for (const [index, a] of nodes.entries()) {
                for (const b of nodes.slice(index + 1)) {
                    const pa = positions.get(a.id)!;
                    const pb = positions.get(b.id)!;
                    let dx = pa.x - pb.x;
                    let dy = pa.y - pb.y;

                    // Two nodes in one place are pulled apart in a direction of their own.
                    if (dx === 0 && dy === 0) {
                        dx = hash(a.id + b.id) - 0.5;
                        dy = hash(b.id + a.id) - 0.5;
                    }

                    // Nodes far apart no longer push, so parts that are not connected stay near each other.
                    const distance = Math.max(Math.hypot(dx, dy), 1);
                    if (distance > ideal * 3) continue;

                    const force = (ideal * ideal) / distance;
                    push.get(a.id)!.x += (dx / distance) * force;
                    push.get(a.id)!.y += (dy / distance) * force;
                    push.get(b.id)!.x -= (dx / distance) * force;
                    push.get(b.id)!.y -= (dy / distance) * force;
                }
            }

            for (const [from, to] of pairs) {
                const pa = positions.get(from);
                const pb = positions.get(to);
                if (!pa || !pb) continue;

                const dx = pa.x - pb.x;
                const dy = pa.y - pb.y;
                const distance = Math.max(Math.hypot(dx, dy), 1);
                const force = (distance * distance) / ideal;
                push.get(from)!.x -= (dx / distance) * force;
                push.get(from)!.y -= (dy / distance) * force;
                push.get(to)!.x += (dx / distance) * force;
                push.get(to)!.y += (dy / distance) * force;
            }

            for (const node of moving) {
                const point = positions.get(node.id)!;
                const force = push.get(node.id)!;

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

    function visibleNodes(): GraphNode[] {
        const ends = new Set(visibleEdges().flatMap((edge) => [edge.from, edge.to]));
        return data?.nodes.filter((node) => node.kind === "device" || ends.has(node.id)) ?? [];
    }

    const nodeById = (id: string) => data?.nodes.find((node) => node.id === id);

    function markOf(node: GraphNode): "error" | "warning" | undefined {
        if (!data || node.kind !== "device") return undefined;

        const findings = data.findings.filter((finding) => finding.device === node.label);
        if (findings.some((finding) => finding.level === "error")) return "error";

        const drift = data.drift[node.label]?.status;
        if (findings.length || drift === "differs" || drift === "cannot plan") return "warning";

        return undefined;
    }

    function curve(edge: GraphEdge, offset: number): { d: string; label: Point } {
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
    function place(): void {
        viewport.setAttribute("transform", `translate(${view.x},${view.y}) scale(${view.k})`);
        svg.classList.toggle("far", view.k < 0.4);

        for (const [id, group] of nodeElements) {
            const point = positions.get(id)!;
            group.setAttribute("transform", `translate(${point.x},${point.y})`);
        }

        for (const { edge, path, hit, label, offset } of edgeElements) {
            const { d, label: at } = curve(edge, offset);
            path.setAttribute("d", d);
            hit.setAttribute("d", d);
            label.setAttribute("x", String(at.x));
            label.setAttribute("y", String(at.y));
        }
    }

    function draw(): void {
        edgeLayer.replaceChildren();
        nodeLayer.replaceChildren();
        nodeElements.clear();
        edgeElements.length = 0;

        const edges = visibleEdges();

        // Edges between the same two nodes bend apart, so each stays readable.
        const between = new Map<string, number>();
        const pairOf = (edge: GraphEdge) => [edge.from, edge.to].sort().join("|");
        for (const edge of edges) between.set(pairOf(edge), (between.get(pairOf(edge)) ?? 0) + 1);
        const seen = new Map<string, number>();

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
    function emphasize(): void {
        const focus = hovered ?? (selection && "node" in selection ? selection.node : undefined);
        const selectedEdge = selection && "edge" in selection ? selection.edge : undefined;

        const touching = (edge: GraphEdge) => edge.from === focus || edge.to === focus;
        const carries = (edge: GraphEdge) => edge.vlans?.some((vlan) => vlan.id === vlanFocus) ?? false;

        let litEdges: Set<GraphEdge> | undefined;
        if (focus) litEdges = new Set(edgeElements.filter(({ edge }) => touching(edge)).map(({ edge }) => edge));
        else if (vlanFocus !== undefined && layer === "l2")
            litEdges = new Set(edgeElements.filter(({ edge }) => carries(edge)).map(({ edge }) => edge));
        else if (selectedEdge) litEdges = new Set([selectedEdge]);

        const litNodes = litEdges ? new Set([...litEdges].flatMap((edge) => [edge.from, edge.to])) : undefined;
        if (focus) litNodes?.add(focus);

        for (const { edge, group } of edgeElements) {
            group.classList.toggle("lit", Boolean(litEdges?.has(edge)) && !selectedEdge);
            group.classList.toggle("selected", edge === selectedEdge);
            group.classList.toggle("dim", Boolean(litEdges) && !litEdges!.has(edge));
        }

        for (const [id, group] of nodeElements) {
            group.classList.toggle("selected", Boolean(selection && "node" in selection && selection.node === id));
            group.classList.toggle("dim", Boolean(litNodes) && !litNodes!.has(id));
        }
    }

    // Panning, zooming and dragging.
    let drag: { id?: string; start: Point; origin: Point; moved: boolean } | undefined;

    const toWorld = (event: { clientX: number; clientY: number }): Point => {
        const box = svg.getBoundingClientRect();
        return { x: (event.clientX - box.left - view.x) / view.k, y: (event.clientY - box.top - view.y) / view.k };
    };

    function startDrag(event: PointerEvent, id?: string): void {
        if (event.button !== 0) return;
        event.stopPropagation();

        svg.setPointerCapture(event.pointerId);
        const origin = id ? { ...positions.get(id)! } : { x: view.x, y: view.y };
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

            const at = toWorld(event);
            const k = Math.min(Math.max(view.k * Math.exp(-event.deltaY * 0.0015), 0.15), 4);
            const box = svg.getBoundingClientRect();

            view = { k, x: event.clientX - box.left - at.x * k, y: event.clientY - box.top - at.y * k };
            place();
        },
        { passive: false }
    );

    function fit(): void {
        const points = visibleNodes()
            .map((node) => positions.get(node.id))
            .filter((point): point is Point => Boolean(point));
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

    fitButton.addEventListener("click", fit);

    layoutButton.addEventListener("click", () => {
        if (!data) return;
        layout(data.nodes, data.edges, true);
        draw();
        fit();
    });

    // The side panel.
    function select(next: Selection): void {
        selection = next;
        emphasize();
        showPanel();
    }

    function findingList(findings: Annotated["findings"], withDevice: boolean): HTMLUListElement {
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

    function vlanChips(vlans: CarriedVlan[]): HTMLDivElement {
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

    function legend(): HTMLUListElement {
        const sample = (dashed: boolean, color: string) => {
            const icon = s("svg", { width: 34, height: 10 });
            icon.append(
                s("line", { x1: 2, y1: 5, x2: 32, y2: 5, stroke: color, "stroke-width": 2, "stroke-dasharray": dashed ? "6 4" : "" })
            );
            return icon;
        };

        const box = (style: string) => {
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

    function showPanel(): void {
        panel.replaceChildren();
        if (!data) return;

        if (selection && "node" in selection) {
            const node = nodeById(selection.node);
            if (node) return showNode(node);
        }

        if (selection && "edge" in selection) return showEdge(selection.edge);

        const devices = data.nodes.filter((node) => node.kind === "device");
        const drifted = devices.filter((node) => data!.drift[node.label]?.status === "differs");
        const unsnapped = devices.filter((node) => data!.drift[node.label]?.status === "no snapshot");

        panel.append(h("h2", {}, LAYER_NAMES[layer]), h("p", { class: "muted" }, LAYER_HELP[layer]));

        if (layer === "l2") {
            const vlans = new Map<number, CarriedVlan>();
            for (const edge of visibleEdges()) for (const vlan of edge.vlans ?? []) vlans.set(vlan.id, vlan);

            const sorted = [...vlans.values()].sort((a, b) => a.id - b.id);
            if (sorted.length) panel.append(h("h3", {}, "VLANs"), vlanChips(sorted));
        }

        if (data.findings.length) panel.append(h("h3", {}, "Found by validate"), findingList(data.findings, true));

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

    function showNode(node: GraphNode): void {
        const kinds = { device: "device", segment: "shared segment", outside: "outside the network" };
        panel.append(h("h2", {}, node.label), h("div", { class: "kind" }, kinds[node.kind]));

        if (node.detail.length) panel.append(h("h3", {}, "Details"), h("pre", {}, node.detail.join("\n")));

        if (node.kind === "device" && data) {
            const findings = data.findings.filter((finding) => finding.device === node.label);
            if (findings.length) panel.append(h("h3", {}, "Found by validate"), findingList(findings, false));

            const drift = data.drift[node.label];
            if (drift) {
                const notes = {
                    matches: "Matches its last snapshot.",
                    differs: "Differs from its last snapshot. This is what diff would send:",
                    "no snapshot": "No snapshot yet: run circuit snapshot.",
                    "cannot plan": "Could not be planned against its snapshot:",
                };

                panel.append(h("h3", {}, "Against its snapshot"), h("p", {}, notes[drift.status]));
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

    function showEdge(edge: GraphEdge): void {
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

    function showHeader(): void {
        nav.replaceChildren();
        layerButtons.clear();

        for (const [index, name] of LAYERS.entries()) {
            const count = data?.edges.filter((edge) => edge.layer === name).length ?? 0;
            const button = h(
                "button",
                { "aria-pressed": String(name === layer), title: `${LAYER_HELP[name]} Key ${index + 1}.` },
                LAYER_NAMES[name],
                h("span", { class: "count" }, String(count))
            );
            button.addEventListener("click", () => chooseLayer(name));
            nav.append(button);
            layerButtons.set(name, button);
        }

        if (!data) return;

        const devices = data.nodes.filter((node) => node.kind === "device").length;
        const errors = data.findings.filter((finding) => finding.level === "error").length;
        const warnings = data.findings.length - errors;
        const drifted = Object.values(data.drift).filter((drift) => drift.status === "differs").length;

        summary.textContent = [
            `${devices} ${devices === 1 ? "device" : "devices"}`,
            `${errors} ${errors === 1 ? "error" : "errors"}`,
            `${warnings} ${warnings === 1 ? "warning" : "warnings"}`,
            `${drifted} unlike the snapshot`,
        ].join(" · ");
    }

    function chooseLayer(next: Layer): void {
        layer = next;
        store.set("layer", layer);
        history.replaceState(null, "", `#${layer}`);

        if (selection && "edge" in selection) selection = undefined;
        vlanFocus = undefined;

        showHeader();
        draw();
        showPanel();
    }

    document.addEventListener("keydown", (event) => {
        if (event.target instanceof HTMLInputElement) return;

        if (event.key === "Escape") select(undefined);

        const chosen = LAYERS[Number(event.key) - 1];
        if (chosen) chooseLayer(chosen);
    });

    // Loading the graph, at the start and whenever the server says the config changed.
    async function load(): Promise<void> {
        let next: Data | Failed;

        try {
            next = (await (await fetch("/graph", { cache: "no-store" })).json()) as Data | Failed;
        } catch (error) {
            next = { error: `could not reach circuit studio: ${(error as Error).message}` };
        }

        if (next.error !== undefined) {
            banner.textContent = `The config could not be read, so the drawing is the last one that could:\n${next.error}`;
            banner.hidden = false;
            return;
        }

        banner.hidden = true;
        const first = !data;
        data = next;

        // A selection whose node or edge is gone is dropped.
        if (selection && "node" in selection && !nodeById(selection.node)) selection = undefined;
        if (selection && "edge" in selection) {
            const { layer: was, from, to, label } = selection.edge;
            const same = data.edges.find((edge) => edge.layer === was && edge.from === from && edge.to === to && edge.label === label);
            selection = same ? { edge: same } : undefined;
        }

        layout(data.nodes, data.edges, false);
        showHeader();
        draw();
        showPanel();
        if (first) fit();
    }

    const events = new EventSource("/events");
    events.addEventListener("open", () => {
        live.textContent = "watching the config";
        live.classList.add("on");
    });
    events.addEventListener("error", () => {
        live.textContent = "not connected: is circuit studio still running?";
        live.classList.remove("on");
    });
    events.addEventListener("message", () => void load());

    window.addEventListener("resize", () => place());

    void load();
}
