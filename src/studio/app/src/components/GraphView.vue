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
};
</script>

<script setup lang="ts">
import cytoscape, { type Core, type ElementDefinition, type NodeSingular } from "cytoscape";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { StudioData } from "../../../types";
import { Export } from "../lib/csv";
import { type Shown, type ShownEdge, type ShownNode, GraphLayer } from "../lib/graph-layer";
import { GraphLook } from "../lib/graph-look";
import { type Drawing, GraphSvg } from "../lib/graph-svg";
import { go, still, store } from "../lib/store";

const props = defineProps<{ data: StudioData }>();

const LAYERS = GraphLayer.LAYERS.map((id) => ({ id, label: GraphLayer.NAMES[id], legend: GraphLayer.HELP[id] }));

const layer = computed<Layer>(() => (GraphLayer.isLayer(store.route.parts[0]) ? store.route.parts[0] : "l1"));
const counts = computed(() =>
    Object.fromEntries(LAYERS.map((item) => [item.id, props.data.graph.edges.filter((edge) => edge.layer === item.id).length]))
);

const container = ref<HTMLElement>();
let graph: Core | undefined;

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

/** How wide a node's tag is: as wide as its name. */
const widthOf = (node: ShownNode) => node.label.length * 8.5 + 28;

/** Give every node of a layer a place. The cables layer comes first, as every other layer's new nodes start where they are on it. */
function layOut(name: Layer): void {
    if (name !== "l1") layOut("l1");

    const { nodes, edges } = name === layer.value ? shown.value : GraphLayer.of(props.data, name);
    const boxes = nodes.map((node) => ({ id: node.id, label: node.label, width: widthOf(node) }));
    layouts.layOut(name, boxes, edges, name === "l1" ? undefined : layouts.places("l1"));
    Saved.set("layouts", layouts.kept());
}

function nodeData(node: ShownNode) {
    return { id: node.id, label: node.label, kind: node.kind, level: node.level ?? "", width: widthOf(node) };
}

function edgeData(edge: ShownEdge) {
    return { id: edge.id, source: edge.from, target: edge.to, label: edge.label, oneSided: Boolean(edge.oneSided) };
}

/**
 * Show the layer: add what is new, drop what is gone and update the rest, so nodes keep their places and the selection stays. `moved`
 * says the layer changed, so the nodes it shares with the last one go to their places on this one.
 */
function draw(moved: boolean): void {
    if (!graph) return;

    shown.value = GraphLayer.of(props.data, layer.value);
    layOut(layer.value);
    const places = layouts.places(layer.value);

    const nodeIds = new Set(shown.value.nodes.map((node) => node.id));
    const edgeIds = new Set(shown.value.edges.map((edge) => edge.id));
    const cy = graph;

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
            if (moved) existing.position({ ...places.get(node.id)! });
        }

        cy.add(added);

        for (const edge of shown.value.edges) {
            const existing = cy.getElementById(edge.id);
            if (existing.empty()) cy.add({ group: "edges", data: edgeData(edge) });
            else existing.data(edgeData(edge));
        }
    });

    // A selection whose node or line is gone is dropped; a line's selection does not carry to another layer.
    const picked = selection.value;
    if (picked && cy.getElementById("node" in picked ? picked.node : picked.edge).empty()) select(undefined);
    else emphasize();
}

function select(next: typeof memory.selection): void {
    selection.value = next;
    memory.selection = next;
    emphasize();
}

/** The device under the pointer, and the one presenting lights. */
let hovered: string | undefined;
let touring: string | undefined;

/**
 * Light what the pointer is on, the device presenting lights, or what is selected: a node with its lines and the nodes at their ends,
 * or a line with its two ends. The rest dims.
 */
function emphasize(): void {
    if (!graph) return;
    const cy = graph;

    const picked = selection.value;
    const focus = hovered ?? touring ?? (picked && "node" in picked ? picked.node : undefined);
    const pickedEdge = picked && "edge" in picked ? cy.getElementById(picked.edge) : undefined;
    const litEdges = focus ? cy.getElementById(focus).connectedEdges() : pickedEdge;
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
        return point && node ? [{ ...point, half: widthOf(node) / 2 }] : [];
    });
    if (!boxes.length) return undefined;

    const left = Math.min(...boxes.map((box) => box.x - box.half));
    const right = Math.max(...boxes.map((box) => box.x + box.half));
    const top = Math.min(...boxes.map((box) => box.y)) - GraphLook.HEIGHT / 2;
    const bottom = Math.max(...boxes.map((box) => box.y)) + GraphLook.HEIGHT / 2;

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

/** Show the layer as the reader left it, or, the first time, framed so names can be read. */
function frameLayer(): void {
    const left = memory.views.get(layer.value);
    const view =
        left ??
        framing(
            shown.value.nodes.map((node) => node.id),
            60,
            true
        );
    if (view) graph?.viewport(view);
}

/** Keep where the reader left this layer. */
function keepView(name: Layer): void {
    if (graph && !presenting.value) memory.views.set(name, { zoom: graph.zoom(), pan: { ...graph.pan() } });
}

/** Forget where nodes were moved on this layer, and lay it out again. */
function layOutAgain(): void {
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
let pointerOver = false;
let resizing: ResizeObserver | undefined;

/** Light one device with what it has a line to, and dim the rest; or light nothing. */
function light(node: NodeSingular | undefined): void {
    if (!graph) return;
    touring = node?.id();
    emphasize();

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

    if (glide) graph.animate(view, { duration: 1100, easing: "ease-in-out-cubic" });
    else graph.viewport(view);
}

/** The next layer with lines, after this one; this one when no other has any. */
function nextLayer(): Layer {
    const at = GraphLayer.LAYERS.indexOf(layer.value);
    const after = [...GraphLayer.LAYERS.slice(at + 1), ...GraphLayer.LAYERS.slice(0, at + 1)];
    return after.find((name) => counts.value[name]) ?? layer.value;
}

/** One turn: the whole layer, then its busiest devices one at a time, then on to the next layer. */
function tourNext(): void {
    if (!graph || document.hidden || pointerOver || leaving) return;

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
        if (presenting.value) location.replace(`#graph/${following}`);
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
    touring = undefined;
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

function onKey(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    if (target?.closest("input, select, textarea") || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === "p" || (event.key === "Escape" && presenting.value)) togglePresenting();
}

onMounted(() => {
    graph = cytoscape({
        container: container.value,
        minZoom: 0.2,
        maxZoom: 3,
        autounselectify: true,
        style: GraphLook.style(GraphLook.colors(), still.matches),
    });

    graph.on("tap", "node", (event) => select({ node: event.target.id() }));
    graph.on("tap", "edge", (event) => select({ edge: event.target.id() }));
    graph.on("tap", (event) => {
        if (event.target === graph) select(undefined);
    });
    graph.on("dbltap", 'node[kind = "device"]', (event) => go(`devices/${event.target.data("label")}`));
    graph.on("dragfree", "node", (event) => remember(event.target));

    // Pointing at a node lights it with its lines, as selecting it does.
    graph.on("mouseover", "node", (event) => {
        hovered = event.target.id();
        emphasize();
        if (container.value) container.value.style.cursor = "pointer";
    });
    graph.on("mouseout", "node", () => {
        hovered = undefined;
        emphasize();
        if (container.value) container.value.style.cursor = "";
    });

    // The turns wait while the pointer is on the drawing, so someone at the screen can look.
    container.value?.addEventListener("mouseenter", () => (pointerOver = true));
    container.value?.addEventListener("mouseleave", () => (pointerOver = false));
    // The drawing follows the window's size; presenting keeps what it shows in view.
    resizing = new ResizeObserver(() => {
        graph?.resize();
        if (presenting.value) frameLit(false);
    });
    if (container.value) resizing.observe(container.value);
    addEventListener("keydown", onKey);

    draw(false);
    frameLayer();
    if (presenting.value) showPresenting();
});

onBeforeUnmount(() => {
    keepView(layer.value);
    clearInterval(tour);
    clearTimeout(leaving);
    resizing?.disconnect();
    removeEventListener("keydown", onKey);
    document.body.classList.remove("presenting");
    graph?.destroy();
});

watch(layer, (_next, last) => {
    keepView(last);
    if (selection.value && "edge" in selection.value) select(undefined);
    draw(true);
    frameLayer();
    // A new layer while presenting is shown whole first, with its full time.
    if (presenting.value) showPresenting();
});

// The project changed: the drawing keeps its places, its view and what is selected.
watch(
    () => props.data,
    () => draw(false)
);

const nodeFindings = computed(() =>
    props.data.findings.filter((finding) => selected.value.node && `device:${finding.device}` === selected.value.node.id)
);
</script>

<template>
    <section class="view">
        <div class="toolbar">
            <nav aria-label="Layers">
                <button v-for="item in LAYERS" :key="item.id" :aria-pressed="layer === item.id" @click="go(`graph/${item.id}`)">
                    {{ item.label }} <small>{{ counts[item.id] }}</small>
                </button>
            </nav>
            <div class="actions">
                <button title="Fit the drawing to the window" @click="fit">Fit</button>
                <button title="Forget where nodes were moved on this layer, and lay it out again" @click="layOutAgain">
                    Lay out again
                </button>
                <button title="Save this layer as a PNG image" @click="saveImage">Save image</button>
                <button title="Save this layer as an SVG drawing, sharp at any size" @click="saveSvg">Save SVG</button>
                <button
                    :aria-pressed="presenting"
                    title="Show the network on a big screen, going through every layer (key P)"
                    @click="togglePresenting"
                >
                    Present
                </button>
            </div>
        </div>
        <div class="stage">
            <div ref="container" class="canvas" role="img" aria-label="The network"></div>
            <p v-if="presenting && caption" class="present-caption">
                <strong>{{ caption.title }}</strong
                ><span>{{ caption.detail }}</span>
            </p>
            <button v-if="presenting" class="present-exit" title="Stop presenting (Esc)" @click="togglePresenting">Stop presenting</button>
            <aside>
                <template v-if="selected.node">
                    <h2>{{ selected.node.label }}</h2>
                    <p class="kind muted">
                        {{
                            selected.node.kind === "device"
                                ? "a device"
                                : selected.node.kind === "segment"
                                  ? "a shared segment"
                                  : "outside the network"
                        }}
                    </p>
                    <ul>
                        <li v-for="line in selected.node.detail" :key="line">{{ line }}</li>
                    </ul>
                    <ul v-if="nodeFindings.length" class="findings">
                        <li v-for="(finding, index) in nodeFindings" :key="index">
                            <span :class="['badge', finding.level]">{{ finding.level }}</span
                            >{{ finding.message }}
                        </li>
                    </ul>
                    <p v-if="selected.node.kind === 'device'">
                        <a @click="go(`devices/${selected.node.label}`)">Open {{ selected.node.label }}</a>
                    </p>
                </template>
                <template v-else-if="selected.edge">
                    <h2>{{ selected.edge.label }}</h2>
                    <p v-if="selected.edge.oneSided" class="badge warning">declared at one end only</p>
                    <ul>
                        <li v-for="line in selected.edge.detail" :key="line">{{ line }}</li>
                    </ul>
                </template>
                <template v-else>
                    <h2>{{ GraphLayer.NAMES[layer] }}</h2>
                    <p class="muted">{{ GraphLayer.HELP[layer] }}</p>
                    <ul class="legend">
                        <li>A dashed line is declared at one end only.</li>
                        <li>A dashed box is outside the network.</li>
                        <li>A box framed in orange or red has warnings or errors.</li>
                        <li>Pick a box or a line to see what it is. Double-click a device to open it.</li>
                    </ul>
                </template>
            </aside>
        </div>
    </section>
</template>

<style scoped>
.canvas {
    flex: 1;
    min-width: 0;
    height: 100%;
}
</style>
