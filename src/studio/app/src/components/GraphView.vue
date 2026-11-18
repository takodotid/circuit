<!-- The network drawn, one layer at a time: cables, VLANs, address segments, BGP, OSPF and tunnels. Drawn with Cytoscape; a node or line picked shows what it is in the panel. Present shows it on a big screen, going through every layer and lighting the busiest devices in turn. -->
<script lang="ts">
import type { Layer } from "../../../../core/graph";
import { type Kept, GraphLayout } from "../lib/graph-layout";
import { Saved } from "../lib/store";

type View = { zoom: number; pan: { x: number; y: number } };

/** Kept while the page is open, as the graph view comes and goes: where each node is, where the reader left each layer, and what is selected. */
const memory = {
    layouts: new GraphLayout(Saved.get<Kept>("layouts")),
    views: new Map<Layer, View>(),
    selection: undefined as { node: string } | { edge: string } | undefined,
    /** The network has been drawn in once; later views show it at once. */
    arrived: false,
};
</script>

<script setup lang="ts">
import cytoscape, {
    type CollectionReturnValue,
    type Core,
    type EdgeCollection,
    type ElementDefinition,
    type NodeSingular,
} from "cytoscape";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import type { StudioData } from "../../../types";
import { Export } from "../lib/export";
import { type Shown, type ShownEdge, type ShownNode, GraphLayer } from "../lib/graph-layer";
import { type Tag, GraphLook } from "../lib/graph-look";
import { GraphSignals } from "../lib/graph-signals";
import { type Drawing, GraphSvg } from "../lib/graph-svg";
import { paramOf, still, store } from "../lib/store";
import GraphPanel from "./GraphPanel.vue";

const props = defineProps<{ data: StudioData }>();
const route = useRoute();
const router = useRouter();

const LAYERS = GraphLayer.LAYERS.map((id) => ({ id, label: GraphLayer.NAMES[id], legend: GraphLayer.HELP[id] }));

// The layer the path names, such as `bgp` in `/graph/bgp`, or the one shown last.
const layer = computed<Layer>(() => {
    const asked = paramOf(route, "layer");
    const last = Saved.get<string>("layer");
    return GraphLayer.isLayer(asked) ? asked : GraphLayer.isLayer(last) ? last : "l1";
});
const counts = computed(() =>
    Object.fromEntries(LAYERS.map((item) => [item.id, props.data.graph.edges.filter((edge) => edge.layer === item.id).length]))
);

const container = ref<HTMLElement>();
const signalsCanvas = ref<HTMLCanvasElement>();
let graph: Core | undefined;
let signals: GraphSignals | undefined;

/** What the layer shown has, and what is selected in it. */
const shown = ref<Shown>({ nodes: [], edges: [] });
const selection = ref(memory.selection);
const selected = computed<{ node?: ShownNode; edge?: ShownEdge }>(() => {
    const picked = selection.value;
    if (picked && "node" in picked) return { node: shown.value.nodes.find((node) => node.id === picked.node) };
    if (picked && "edge" in picked) return { edge: shown.value.edges.find((edge) => edge.id === picked.edge) };
    return {};
});

const layouts = memory.layouts;
const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** Each node's tag, measured once in the colours and fonts it is drawn in, until they change. */
let colors = GraphLook.colors();
const tags = new Map<string, Tag>();

function tagOf(node: ShownNode): Tag {
    const key = `${node.id} ${node.label} ${node.detail[0] ?? ""}`;
    let tag = tags.get(key);
    if (!tag) {
        tag = GraphLook.tag(node, colors);
        tags.set(key, tag);
    }
    return tag;
}

const widthOf = (node: ShownNode) => tagOf(node).width;

/** Give every node of a layer a place. The cables layer comes first, as every other layer's new nodes start where they are on it. */
function layOut(name: Layer): void {
    if (name !== "l1") layOut("l1");

    const { nodes, edges } = name === layer.value ? shown.value : GraphLayer.of(props.data, name);
    const boxes = nodes.map((node) => ({ id: node.id, label: node.label, width: widthOf(node) }));
    layouts.layOut(name, boxes, edges, name === "l1" ? undefined : layouts.places("l1"));
    Saved.set("layouts", layouts.kept());
}

function nodeData(node: ShownNode) {
    const tag = tagOf(node);
    return {
        id: node.id,
        label: node.label,
        kind: node.kind,
        level: node.level ?? "",
        width: tag.width,
        height: tag.height,
        shift: tag.shift,
        image: tag.image,
        picked: tag.picked,
        touring: tag.touring,
    };
}

function edgeData(edge: ShownEdge) {
    return {
        id: edge.id,
        source: edge.from,
        target: edge.to,
        label: edge.label,
        keys: edge.keys,
        vlans: (edge.vlans ?? []).map((vlan) => vlan.id),
        oneSided: Boolean(edge.oneSided),
        added: Boolean(edge.added),
        gone: Boolean(edge.gone),
    };
}

/**
 * Show the layer: add what is new, drop what is gone and update the rest, so nodes keep their places and the selection stays.
 * `arrival` says what is new to the eye: the whole network the first time it is shown, or a new layer, whose devices glide to their
 * places on it while its lines come in. A project read again changes in place.
 */
function draw(arrival?: "network" | "layer"): void {
    if (!graph) return;

    shown.value = GraphLayer.of(props.data, layer.value, store.graphFocus.comparison);
    Saved.set("layer", layer.value);
    layOut(layer.value);
    const places = layouts.places(layer.value);

    const nodeIds = new Set(shown.value.nodes.map((node) => node.id));
    const edgeIds = new Set(shown.value.edges.map((edge) => edge.id));
    const moving = arrival !== undefined && !still.matches;
    const cy = graph;
    let fresh = cy.collection();

    settle();
    cy.batch(() => {
        cy.edges()
            .filter((edge) => !edgeIds.has(edge.id()))
            .remove();
        cy.nodes()
            .filter((node) => !nodeIds.has(node.id()))
            .remove();

        const added: ElementDefinition[] = [];

        for (const node of shown.value.nodes) {
            const existing = cy.getElementById(node.id);
            if (existing.empty()) {
                added.push({ group: "nodes", data: nodeData(node), position: { ...places.get(node.id)! } });
                continue;
            }

            existing.data(nodeData(node));
            if (arrival === "layer" && moving) gliding.push(existing);
            else if (arrival === "layer") existing.position({ ...places.get(node.id)! });
        }

        fresh = fresh.union(cy.add(added));

        for (const edge of shown.value.edges) {
            const existing = cy.getElementById(edge.id);
            if (existing.empty()) fresh = fresh.union(cy.add({ group: "edges", data: edgeData(edge) }));
            else existing.data(edgeData(edge));
        }

        // What arrives starts unseen.
        if (moving) fresh.style({ opacity: 0, "text-opacity": 0 });
    });

    // The devices on both layers glide to their places on this one, so the eye can follow each.
    for (const node of gliding) node.animate({ position: { ...places.get(node.id())! } }, { duration: 700, easing: "ease-in-out-cubic" });
    if (moving) arrive(fresh, arrival);

    // Presenting draws every line heavier, a line the project just added too.
    if (presenting.value) cy.edges().addClass("heavy");

    // A selection whose node or line is gone is dropped; a line's selection does not carry to another layer.
    const picked = selection.value;
    if (picked && cy.getElementById("node" in picked ? picked.node : picked.edge).empty()) select(undefined);
    else emphasize();
}

/** The nodes gliding to a new layer's places. */
let gliding: CollectionReturnValue[] = [];

/** End a glide between layers: each node at its place on this layer, so a press moves it from there. */
function settle(): void {
    const places = layouts.places(layer.value);
    for (const node of gliding) {
        node.stop(true);
        if (node.inside()) node.position({ ...places.get(node.id())! });
    }
    gliding = [];
}

/** The curve of an arrival: quick at first, settling at the end. */
const ARRIVE = "ease-out-quint";

/**
 * Bring new parts in from the busiest device outward, a ring of neighbours at a time: nodes fade in, then the lines, then their labels.
 * On the first view each line draws in from its nearer end; on a new layer its lines fade in. The dots follow once it is all in.
 */
function arrive(fresh: CollectionReturnValue, arrival: "network" | "layer"): void {
    if (!graph) return;
    const cy = graph;

    const hub = cy.nodes().max((node) => node.degree(false)).ele as NodeSingular | undefined;
    const ring = new Map<string, number>(hub ? [[hub.id(), 0]] : []);
    for (const queue: NodeSingular[] = hub ? [hub] : []; queue.length;) {
        const here = queue.shift()!;
        here.neighborhood()
            .nodes()
            .forEach((other) => {
                if (ring.has(other.id())) return;
                ring.set(other.id(), ring.get(here.id())! + 1);
                queue.push(other);
            });
    }

    // The whole drawing arrives within about a second, however many rings it has.
    const farthest = Math.max(0, ...ring.values()) + 1;
    const step = Math.min(110, 800 / farthest);
    const ringOf = (node: NodeSingular) => ring.get(node.id()) ?? farthest;

    fresh.nodes().forEach((node) => {
        node.delay(ringOf(node) * step).animate(
            { style: { opacity: 1, "text-opacity": 1 } },
            { duration: 360, easing: ARRIVE, complete: () => node.removeStyle("opacity text-opacity") }
        );
    });

    let last = 0;
    fresh.edges().forEach((edge) => {
        const from = ringOf(edge.source());
        const to = ringOf(edge.target());
        const delay = (Math.min(from, to) + 0.5) * step + (arrival === "layer" ? 200 : 0);
        last = Math.max(last, delay + 860);

        const done = () => edge.removeStyle("opacity text-opacity line-style line-dash-pattern line-dash-offset");

        // A line both ends declare draws in from its nearer end: a dash as long as the line slides along it. A dashed line fades in.
        // A line whose ends are not placed yet has no length, and fades in too.
        const a = edge.sourceEndpoint();
        const b = edge.targetEndpoint();
        const length = Math.hypot(b.x - a.x, b.y - a.y) * 1.3 + 4;
        if (arrival === "network" && !edge.data("oneSided") && Number.isFinite(length)) {
            edge.style({
                opacity: 1,
                "line-style": "dashed",
                "line-dash-pattern": [length, length],
                "line-dash-offset": from <= to ? length : -length,
            });
            edge.delay(delay)
                .animate({ style: { "line-dash-offset": 0 } }, { duration: 560, easing: ARRIVE })
                .animate({ style: { "text-opacity": 1 } }, { duration: 300, complete: done });
            return;
        }

        edge.delay(delay)
            .animate({ style: { opacity: 1 } }, { duration: 420, easing: ARRIVE })
            .animate({ style: { "text-opacity": 1 } }, { duration: 300, complete: done });
    });

    if (signals) signals.showFrom = performance.now() + last;
}

/** Select a node or a line, or nothing. A selection ends a lit path; selecting something ends a lit VLAN too. */
function select(next: typeof memory.selection): void {
    selection.value = next;
    memory.selection = next;
    delete store.graphFocus.path;
    if (next) delete store.graphFocus.vlan;
    emphasize();
}

/** The device under the pointer, and the one presenting lights. */
let hovered: string | undefined;
let touring: string | undefined;

/**
 * Light what the pointer is on, the device presenting lights, or what is selected: a node with its lines and the nodes at their ends.
 * Else a path asked for, or the cables of a VLAN asked for, or the line selected, each with its ends. The rest dims.
 */
function emphasize(): void {
    if (!graph) return;
    const cy = graph;

    const picked = selection.value;
    const { path, vlan } = store.graphFocus;
    const focus = hovered ?? touring ?? (picked && "node" in picked ? picked.node : undefined);
    const pickedEdge = picked && "edge" in picked ? cy.edges().filter((edge) => edge.id() === picked.edge) : undefined;

    let litEdges: EdgeCollection | undefined = pickedEdge;
    if (focus) litEdges = cy.getElementById(focus).connectedEdges();
    else if (path?.length) litEdges = cy.edges().filter((edge) => (edge.data("keys") as string[]).some((key) => path.includes(key)));
    else if (vlan !== undefined && layer.value === "l2")
        litEdges = cy.edges().filter((edge) => (edge.data("vlans") as number[]).includes(vlan));
    const litNodes = litEdges?.connectedNodes().union(focus ? cy.getElementById(focus) : cy.collection());

    cy.batch(() => {
        cy.elements().removeClass("lit dim picked touring");
        if (picked) cy.getElementById("node" in picked ? picked.node : picked.edge).addClass("picked");
        if (touring && !hovered) cy.getElementById(touring).addClass("touring");
        if (!litEdges || !litNodes) return;

        cy.elements().not(litEdges).not(litNodes).addClass("dim");
        litEdges.not(".picked").addClass("lit");
    });
}

/** Dots in the link colour; on a lit line, the highlighter with a navy ring; on a line a comparison adds, green. */
function signalColors() {
    const colors = GraphLook.colors();
    return { dot: colors.link, lit: colors.yellow, ring: colors.navy, added: colors.ok };
}

/** The dots move, or, when the reader asks for less motion, are not drawn at all. */
function moveSignals(): void {
    if (still.matches) signals?.stop();
    else signals?.start();
}

/** Below this zoom a device's name is too small to read: a first view stops there, around the busiest device, and the reader pans for the rest. */
const READABLE = 0.6;
/** Above this zoom a small network would be drawn larger than it is. */
const LARGEST = 1.2;

/** The view that frames these nodes, by where they are placed on the layer. With `readable`, as much as stays readable, around the busiest of them. */
function framing(ids: readonly string[], padding: number, readable = false): View | undefined {
    if (!graph) return undefined;

    const places = layouts.places(layer.value);
    const boxes = ids.flatMap((id) => {
        const point = places.get(id);
        const node = shown.value.nodes.find((candidate) => candidate.id === id);
        return point && node ? [{ ...point, half: widthOf(node) / 2, halfHeight: tagOf(node).height / 2 }] : [];
    });
    if (!boxes.length) return undefined;

    const left = Math.min(...boxes.map((box) => box.x - box.half));
    const right = Math.max(...boxes.map((box) => box.x + box.half));
    const top = Math.min(...boxes.map((box) => box.y - box.halfHeight));
    const bottom = Math.max(...boxes.map((box) => box.y + box.halfHeight));

    const width = graph.width();
    const height = graph.height();
    const whole = Math.min((width - padding * 2) / (right - left), (height - padding * 2) / (bottom - top));
    let zoom = Math.max(Math.min(whole, LARGEST), graph.minZoom());
    let centre = { x: (left + right) / 2, y: (top + bottom) / 2 };

    if (readable && zoom < READABLE) {
        zoom = READABLE;
        const degree = (id: string) => shown.value.edges.filter((edge) => edge.from === id || edge.to === id).length;
        const hub = [...ids].sort((a, b) => degree(b) - degree(a))[0];
        centre = (hub && places.get(hub)) || centre;
    }

    return { zoom, pan: { x: width / 2 - centre.x * zoom, y: height / 2 - centre.y * zoom } };
}

/** Show the whole layer, but never larger than its own size: a network of two devices stays readable. */
function fit(): void {
    const view = framing(
        shown.value.nodes.map((node) => node.id),
        60
    );
    if (view) graph?.viewport(view);
}

/** Show the layer as the reader left it, or, the first time, framed so names can be read: gliding there, or at once. */
function frameLayer(glide = false): void {
    if (!graph) return;

    const left = memory.views.get(layer.value);
    const view =
        left ??
        framing(
            shown.value.nodes.map((node) => node.id),
            60,
            true
        );
    if (!view) return;

    graph.stop(true);
    if (glide && !still.matches) graph.animate(view, { duration: 1100, easing: "ease-in-out-cubic" });
    else graph.viewport(view);
}

/** Keep where the reader left this layer. */
function keepView(name: Layer): void {
    if (graph && !presenting.value) memory.views.set(name, { zoom: graph.zoom(), pan: { ...graph.pan() } });
}

/** Forget where nodes were moved on this layer, and lay it out again. */
function layOutAgain(): void {
    settle();
    layouts.forget(layer.value);
    layOut(layer.value);
    const places = layouts.places(layer.value);
    graph?.nodes().forEach((node) => {
        node.position({ ...places.get(node.id())! });
    });
    fit();
}

function remember(node: NodeSingular): void {
    layouts.places(layer.value).set(node.id(), { ...node.position() });
    Saved.set("layouts", layouts.kept());
}

function saveImage(): void {
    if (!graph) return;
    const png = graph.png({ output: "blob", full: true, scale: 2, bg: css("--bg") }) as unknown as Blob;
    Export.save(`${props.data.project}-${layer.value}.png`, png);
}

/** Save the layer as an SVG, drawn from where each box and line is and how Cytoscape styles it. */
function saveSvg(): void {
    if (!graph) return;
    const box = graph.elements().boundingBox({});
    const size = (value: string) => parseFloat(value) || 0;

    const drawing: Drawing = {
        box: { x: box.x1, y: box.y1, width: box.w, height: box.h },
        background: css("--bg"),
        font: css("--font"),
        nodes: graph.nodes().map((node) => ({
            ...node.position(),
            width: node.width(),
            height: node.height(),
            label: String(node.data("label")),
            fill: node.style("background-color"),
            stroke: node.style("border-color"),
            strokeWidth: size(node.style("border-width")),
            dashed: node.style("border-style") !== "solid",
            color: node.style("color"),
            fontSize: size(node.style("font-size")),
            opacity: Number(node.style("opacity")),
            ...(node.data("kind") === "device"
                ? {
                      device: {
                          chassis: node.hasClass("touring") ? colors.navy : colors.cobalt,
                          socket: node.hasClass("touring") || node.hasClass("picked") ? colors.yellow : "#ffffff",
                          sub: props.data.graph.nodes.find((candidate) => candidate.id === node.id())?.detail[0] ?? "",
                          subColor: node.hasClass("touring") ? "#2a3550" : colors.muted,
                          mono: colors.mono,
                      },
                  }
                : {}),
        })),
        edges: graph.edges().map((edge) => {
            const control = edge.controlPoints()?.[0];
            return {
                from: edge.sourceEndpoint(),
                to: edge.targetEndpoint(),
                ...(control ? { control } : {}),
                middle: edge.midpoint(),
                label: String(edge.data("label") ?? ""),
                color: edge.style("line-color"),
                width: size(edge.style("width")),
                dashed: edge.style("line-style") === "dashed",
                labelColor: edge.style("color"),
                fontSize: size(edge.style("font-size")),
                opacity: Number(edge.style("opacity")),
            };
        }),
    };

    Export.save(`${props.data.project}-${layer.value}.svg`, new Blob([GraphSvg.of(drawing)], { type: "image/svg+xml" }));
}

// Presenting: the network on a big screen, the whole window, going through every layer and lighting its busiest devices in turn. Kept in the browser, so a screen that reloads stays on it.

const PRESENT_KEY = "circuit-studio-present";
/** How many devices are lit on each layer, busiest first, before it moves on to the next layer. */
const LIT_PER_LAYER = 4;

const remembered = (): boolean => {
    try {
        return localStorage.getItem(PRESENT_KEY) === "on";
    } catch {
        return false;
    }
};

const presenting = ref(remembered());
const caption = ref<{ title: string; detail: string }>();
let tourStep = 0;
let tour: ReturnType<typeof setInterval> | undefined;
let leaving: ReturnType<typeof setTimeout> | undefined;
/** A device is being dragged: the turns and the drift wait, as they do while a device is pointed at. */
let dragging = false;
let resizing: ResizeObserver | undefined;

/** Light one device with what it has a line to, and dim the rest; or light nothing. */
function light(node: NodeSingular | undefined): void {
    if (!graph) return;
    touring = node?.id();
    emphasize();
    pulse(node);

    if (node) {
        const detail = props.data.graph.nodes.find((candidate) => candidate.id === node.id())?.detail[0];
        caption.value = {
            title: String(node.data("label")),
            detail: [detail, GraphLayer.count(layer.value, node.connectedEdges().length)].filter(Boolean).join(", "),
        };
    } else {
        const devices = graph.nodes('[kind = "device"]').length;
        caption.value = {
            title: GraphLayer.NAMES[layer.value],
            detail: `${devices} ${devices === 1 ? "device" : "devices"}, ${GraphLayer.count(layer.value, graph.edges().length)}`,
        };
    }
}

/** Frame what is lit with its neighbours, or the whole layer: gliding there, or at once. */
function frameLit(glide: boolean): void {
    if (!graph) return;
    const ids = touring
        ? graph
              .getElementById(touring)
              .closedNeighborhood()
              .nodes()
              .map((node) => node.id())
        : shown.value.nodes.map((node) => node.id);
    const view = framing(ids, 90);
    if (!view) return;

    graph.stop(true);
    if (glide && !still.matches) {
        graph.animate(view, { duration: 1100, easing: "ease-in-out-cubic", complete: drift });
        return;
    }
    graph.viewport(view);
    drift();
}

/** The device presenting lights now, with a ring that keeps leaving it, the way the docs drawing marks the changed device. */
let pulsing: NodeSingular | undefined;

function pulse(node: NodeSingular | undefined): void {
    if (pulsing?.inside()) {
        pulsing.stop(true);
        pulsing.removeStyle("outline-offset outline-opacity");
    }
    pulsing = node;
    if (!node || still.matches) return;

    const ring = () => {
        if (pulsing !== node || !node.inside()) return;
        node.style({ "outline-offset": 4, "outline-opacity": 1 });
        node.animate(
            { style: { "outline-offset": 22, "outline-opacity": 0 } },
            { duration: 1800, easing: "ease-out-quint", complete: ring }
        );
    };
    ring();
}

/**
 * While presenting, the view drifts slowly away from what it frames and back, so a wall screen does not stand still. It gives way to each
 * turn of the tour, and waits while a device is pointed at or dragged. None with reduced motion.
 */
function drift(): void {
    if (!graph || !presenting.value || still.matches || hovered || dragging) return;
    const cy = graph;

    const base = { zoom: cy.zoom(), pan: { ...cy.pan() } };
    const angle = tourStep * 2.4 + layer.value.length;
    const centre = { x: cy.width() / 2, y: cy.height() / 2 };
    const away = {
        zoom: base.zoom * 1.03,
        pan: {
            x: centre.x - (centre.x - base.pan.x) * 1.03 + Math.cos(angle) * 16,
            y: centre.y - (centre.y - base.pan.y) * 1.03 + Math.sin(angle) * 10,
        },
    };

    cy.animate(away, {
        duration: 7000,
        easing: "ease-in-out-sine",
        complete: () => cy.animate(base, { duration: 7000, easing: "ease-in-out-sine", complete: drift }),
    });
}

/** The next layer with lines, after this one; this one when no other has any. */
function nextLayer(): Layer {
    const at = GraphLayer.LAYERS.indexOf(layer.value);
    const after = [...GraphLayer.LAYERS.slice(at + 1), ...GraphLayer.LAYERS.slice(0, at + 1)];
    return after.find((name) => counts.value[name]) ?? layer.value;
}

/** One turn: the whole layer, then its busiest devices one at a time, then on to the next layer. */
function tourNext(): void {
    if (!graph || document.hidden || hovered || dragging || leaving) return;

    const devices = graph.nodes('[kind = "device"]').toArray() as NodeSingular[];
    const busiest = devices
        .filter((node) => node.degree(false) > 0)
        .sort((a, b) => b.degree(false) - a.degree(false) || String(a.data("label")).localeCompare(String(b.data("label"))))
        .slice(0, LIT_PER_LAYER);

    tourStep += 1;
    const next = busiest[tourStep - 1];
    if (next || nextLayer() === layer.value) {
        if (!next) tourStep = 0;
        light(next);
        frameLit(true);
        return;
    }

    // Every busy device has had its turn: back out to the whole layer, then on to the next one.
    tourStep = 0;
    light(undefined);
    frameLit(true);
    const following = nextLayer();
    leaving = setTimeout(() => {
        leaving = undefined;
        // Replacing the address keeps the history clean, so Back still leaves Studio's last place.
        if (presenting.value) void router.replace({ name: "layer", params: { layer: following } });
    }, 2600);
}

/** Start the turns again, so the layer shown now has its full time. */
function restartTour(): void {
    clearInterval(tour);
    clearTimeout(leaving);
    leaving = undefined;
    tourStep = 0;
    if (presenting.value) tour = setInterval(tourNext, 6000);
}

/** The page as presenting wants it: the rails and the panel gone, heavier lines, a caption, and the turns running. Or back as it was. */
function showPresenting(): void {
    document.body.classList.toggle("presenting", presenting.value);
    if (signals) signals.presenting = presenting.value;
    touring = undefined;
    pulse(undefined);
    graph?.stop(true);
    select(undefined);
    graph?.edges().removeClass("heavy");
    caption.value = undefined;
    restartTour();

    // The drawing takes the window's size once the rails are gone, or back.
    void nextTick(() => {
        graph?.resize();
        if (!presenting.value) return fit();
        graph?.edges().addClass("heavy");
        light(undefined);
        frameLit(false);
    });
}

/** Present, or stop. From a click, the whole screen too, where the browser allows it. */
function togglePresenting(): void {
    const on = !presenting.value;
    if (on && !document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => undefined);
    if (!on && document.fullscreenElement) document.exitFullscreen?.().catch(() => undefined);

    presenting.value = on;
    try {
        localStorage.setItem(PRESENT_KEY, on ? "on" : "off");
    } catch {
        // A browser that keeps nothing still presents, until it reloads.
    }
    showPresenting();
}

/** P presents or stops, Esc stops presenting or clears the selection, and the keys 1 to 6 pick a layer. */
function onKey(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    if (target?.closest("input, select, textarea") || event.ctrlKey || event.metaKey || event.altKey) return;

    if (event.key === "p" || (event.key === "Escape" && presenting.value)) return togglePresenting();
    if (event.key === "Escape") return select(undefined);

    const chosen = GraphLayer.LAYERS[Number(event.key) - 1];
    if (chosen) void router.push({ name: "layer", params: { layer: chosen } });
}

/** The page's colours changed, with the system's light or dark, or the reader asked for less motion: draw it all again in them. */
function restyle(): void {
    if (!graph) return;
    colors = GraphLook.colors();
    tags.clear();
    graph.style(GraphLook.style(colors, still.matches));
    draw();
    signals?.recolor(signalColors());
    moveSignals();
}

const scheme = matchMedia("(prefers-color-scheme: dark)");

/** Select a device from the list the keyboard reaches, and bring it to the middle of the view. */
function pick(id: string): void {
    store.graphFocus.device = id.replace(/^device:/, "");
}

/** The devices on the layer, by name, for the keyboard: a drawing on a canvas has no element to reach. */
const deviceList = computed(() =>
    shown.value.nodes.filter((node) => node.kind === "device").sort((a, b) => a.label.localeCompare(b.label))
);

onMounted(() => {
    graph = cytoscape({
        container: container.value,
        minZoom: 0.2,
        maxZoom: 3,
        autounselectify: true,
        style: GraphLook.style(colors, still.matches),
    });

    graph.on("tap", "node", (event) => select({ node: event.target.id() }));
    graph.on("tap", "edge", (event) => select({ edge: event.target.id() }));
    graph.on("tap", (event) => {
        if (event.target === graph) select(undefined);
    });
    graph.on("dbltap", 'node[kind = "device"]', (event) => {
        void router.push({ name: "device", params: { name: String(event.target.data("label")) } });
    });
    graph.on("dragfree", "node", (event) => remember(event.target));

    // Pointing at a node lights it with its lines, as selecting it does. While presenting, the turns and the drift wait for it.
    graph.on("mouseover", "node", (event) => {
        hovered = event.target.id();
        emphasize();
        if (presenting.value) graph?.stop(true);
        if (container.value) container.value.style.cursor = "pointer";
    });
    graph.on("mouseout", "node", () => {
        hovered = undefined;
        emphasize();
        drift();
        if (container.value) container.value.style.cursor = "";
    });
    graph.on("grab", "node", () => (dragging = true));
    graph.on("free", "node", () => {
        dragging = false;
        drift();
    });
    // The drawing follows the window's size; presenting keeps what it shows in view.
    resizing = new ResizeObserver(() => {
        graph?.resize();
        if (presenting.value) frameLit(false);
    });
    if (container.value) resizing.observe(container.value);
    addEventListener("keydown", onKey);

    // Dots travel the lines that work, unless the reader asks for less motion.
    if (signalsCanvas.value) signals = new GraphSignals(graph, signalsCanvas.value, signalColors());
    moveSignals();
    still.addEventListener("change", restyle);
    scheme.addEventListener("change", restyle);

    // A press or a scroll stops a glide: the nodes are at their places at once, and the view stays where it is.
    graph.on("tapstart", () => {
        settle();
        graph?.stop(true);
    });
    container.value?.addEventListener("wheel", () => graph?.stop(true), { capture: true, passive: true });

    // The first view of the page draws the network in.
    draw(memory.arrived || !props.data.devices.length ? undefined : "network");
    memory.arrived = true;

    // Names are measured in Special Gothic: once it has loaded, the tags are measured again.
    void document.fonts.ready.then(() => {
        tags.clear();
        draw();
    });
    frameLayer();
    showDevice();
    if (presenting.value) showPresenting();
});

/** A device another view asked for: select it, and bring it to the middle of the view. */
function showDevice(): void {
    const name = store.graphFocus.device;
    if (!name || !graph) return;
    delete store.graphFocus.device;

    const node = graph.getElementById(`device:${name}`);
    if (node.empty()) return;

    select({ node: node.id() });
    const view = {
        zoom: graph.zoom(),
        pan: { x: graph.width() / 2 - node.position().x * graph.zoom(), y: graph.height() / 2 - node.position().y * graph.zoom() },
    };
    graph.stop(true);
    if (still.matches) graph.viewport(view);
    else graph.animate(view, { duration: 700, easing: "ease-in-out-cubic" });
}

onBeforeUnmount(() => {
    keepView(layer.value);
    clearInterval(tour);
    clearTimeout(leaving);
    resizing?.disconnect();
    removeEventListener("keydown", onKey);
    still.removeEventListener("change", restyle);
    scheme.removeEventListener("change", restyle);
    signals?.stop();
    document.body.classList.remove("presenting");
    graph?.destroy();
    graph = undefined;
});

watch(layer, (_next, last) => {
    keepView(last);
    if (selection.value && "edge" in selection.value) select(undefined);

    // What was lit on the last layer is not lit on this one.
    delete store.graphFocus.path;
    delete store.graphFocus.vlan;
    draw("layer");
    frameLayer(true);
    // A new layer while presenting is shown whole first, with its full time.
    if (presenting.value) showPresenting();
});

// The project changed: the drawing keeps its places, its view and what is selected.
watch(
    () => props.data,
    () => draw()
);

// What the graph is asked to light changes the drawing.
watch(
    () => [store.graphFocus.path, store.graphFocus.vlan],
    () => emphasize()
);
watch(
    () => store.graphFocus.comparison,
    () => draw()
);
watch(
    () => store.graphFocus.device,
    () => showDevice()
);
</script>

<template>
    <section class="view">
        <div class="toolbar">
            <nav aria-label="Layers">
                <RouterLink
                    v-for="(item, index) in LAYERS"
                    :key="item.id"
                    :to="{ name: 'layer', params: { layer: item.id } }"
                    :aria-current="layer === item.id ? 'page' : undefined"
                    :title="`${item.legend} Key ${index + 1}.`"
                >
                    {{ item.label }} <small>{{ counts[item.id] }}</small>
                </RouterLink>
            </nav>
            <div class="actions">
                <button title="Show all of this layer" @click="fit">Fit</button>
                <button title="Reset this layer's layout" @click="layOutAgain">Lay out again</button>
                <button title="Save this layer as PNG" @click="saveImage">Save image</button>
                <button title="Save this layer as SVG" @click="saveSvg">Save SVG</button>
                <button :aria-pressed="presenting" title="Show it on a big screen, layer by layer (key P)" @click="togglePresenting">
                    Present
                </button>
            </div>
        </div>
        <div class="stage">
            <div class="board">
                <div ref="container" class="canvas" role="img" :aria-label="`The network, ${GraphLayer.NAMES[layer]} layer`"></div>
                <canvas ref="signalsCanvas" class="signals" aria-hidden="true"></canvas>
                <nav class="device-list" aria-label="Devices on this layer">
                    <p>Devices</p>
                    <button
                        v-for="node in deviceList"
                        :key="node.id"
                        type="button"
                        :aria-pressed="selected.node?.id === node.id"
                        @click="pick(node.id)"
                    >
                        {{ node.label }}
                    </button>
                </nav>
            </div>
            <p v-if="presenting && caption" class="present-caption">
                <strong>{{ caption.title }}</strong
                ><span>{{ caption.detail }}</span>
            </p>
            <button v-if="presenting" class="present-exit" title="Stop presenting (Esc)" @click="togglePresenting">Stop presenting</button>
            <GraphPanel :data="data" :layer="layer" :shown="shown" :selected="selected" @select="select" />
        </div>
    </section>
</template>

<style scoped>
/* The drawing, with the travelling dots on a canvas laid over it. */
.board {
    position: relative;
    flex: 1;
    min-width: 0;
    min-height: 0;
}

.canvas,
.signals {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
}

.signals {
    pointer-events: none;
}

/* The devices as buttons, for the keyboard: out of sight until one has the focus, then a list at the drawing's top left. */
.device-list {
    position: absolute;
    top: 12px;
    left: 12px;
    display: grid;
    gap: 4px;
    max-height: calc(100% - 24px);
    overflow: auto;
    padding: 10px;
    border: 2px solid var(--text);
    border-radius: 2px;
    background: var(--surface);
    clip-path: inset(50%);
    opacity: 0;
}

.device-list:focus-within {
    clip-path: none;
    opacity: 1;
}

.device-list p {
    margin: 0 0 4px;
    font-size: 11px;
    font-weight: 700;
    font-stretch: 115%;
    letter-spacing: 0.1em;
    text-transform: uppercase;
}

.device-list button {
    min-height: 30px;
    justify-content: flex-start;
    text-align: left;
}

@media (max-width: 760px) {
    .board {
        flex: 1 1 auto;
        width: 100%;
        min-height: 320px;
    }
}
</style>
