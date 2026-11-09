<!-- The network drawn, one layer at a time: cables, VLANs, address segments, BGP, OSPF and tunnels. Drawn with Cytoscape; a node or line picked shows what it is in the panel. Present shows it on a big screen, going through every layer and lighting the busiest devices in turn. -->
<script setup lang="ts">
import cytoscape, { type Core, type ElementDefinition, type NodeSingular } from "cytoscape";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { GraphEdge, GraphNode, Layer } from "../../../../core/graph";
import type { StudioData } from "../../../types";
import { Export } from "../lib/csv";
import { type Drawing, GraphSvg } from "../lib/graph-svg";
import { go, store } from "../lib/store";

const props = defineProps<{ data: StudioData }>();

const LAYERS: { id: Layer; label: string; legend: string }[] = [
    { id: "l1", label: "Cables", legend: "Each cable a port's link names. A LAG's cables are one line." },
    { id: "l2", label: "VLANs", legend: "The VLANs each cable carries, from its port or LAG." },
    {
        id: "l3",
        label: "Addresses",
        legend: "Prefixes two devices hold addresses in. Three or more share a segment, drawn as its own box.",
    },
    { id: "bgp", label: "BGP", legend: "Sessions between our devices, matched by address, and to each AS outside." },
    { id: "ospf", label: "OSPF", legend: "Interfaces in one area and one prefix, neither passive." },
    { id: "tunnels", label: "Tunnels", legend: "GRE and VXLAN tunnels matched by their endpoints, and WireGuard peers." },
];

const layer = computed<Layer>(() => (LAYERS.some((item) => item.id === store.route.parts[0]) ? (store.route.parts[0] as Layer) : "l1"));
const counts = computed(() =>
    Object.fromEntries(LAYERS.map((item) => [item.id, props.data.graph.edges.filter((edge) => edge.layer === item.id).length]))
);

const container = ref<HTMLElement>();
const selected = ref<{ node?: GraphNode; edge?: GraphEdge }>({});
let graph: Core | undefined;

/** Where each node was on each layer, kept while the page is open, so a node moved stays moved. */
const placed = new Map<string, Record<string, { x: number; y: number }>>();

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function elements(): ElementDefinition[] {
    const edges = props.data.graph.edges.filter((edge) => edge.layer === layer.value);
    const ends = new Set(edges.flatMap((edge) => [edge.from, edge.to]));
    const levelOf = (node: GraphNode) => {
        const findings = props.data.findings.filter((finding) => `device:${finding.device}` === node.id);
        return findings.some((finding) => finding.level === "error") ? "error" : findings.length ? "warning" : "";
    };

    return [
        ...props.data.graph.nodes
            .filter((node) => node.kind === "device" || ends.has(node.id))
            .map((node) => ({
                group: "nodes" as const,
                // A box as wide as its name.
                data: { id: node.id, label: node.label, kind: node.kind, level: levelOf(node), width: node.label.length * 8.5 + 28 },
            })),
        ...edges.map((edge, index) => ({
            group: "edges" as const,
            data: {
                id: `edge-${index}`,
                source: edge.from,
                target: edge.to,
                label: edge.label,
                oneSided: edge.oneSided ? "yes" : "no",
                index,
            },
        })),
    ];
}

function draw(): void {
    if (!graph) return;
    const positions = placed.get(layer.value);

    graph.elements().remove();
    graph.add(elements());
    selected.value = {};

    if (positions && graph.nodes().every((node) => positions[node.id()] !== undefined)) {
        graph.nodes().forEach((node) => {
            node.position(positions[node.id()]!);
        });
        fit();
    } else {
        layOut();
    }
}

/** Fit the drawing to the window, but never larger than its own size: a network of two devices stays readable. */
function fit(): void {
    if (!graph) return;
    graph.fit(undefined, 60);
    if (graph.zoom() > 1.2) {
        graph.zoom(1.2);
        graph.center();
    }
}

function layOut(): void {
    // From a circle rather than random places, so the same network is drawn the same way each time.
    graph?.layout({ name: "circle", animate: false, fit: false }).run();
    // Boxes are wide, so they push hard and keep a gap, or they land on each other and on the lines' labels.
    graph
        ?.layout({
            name: "cose",
            animate: false,
            fit: false,
            randomize: false,
            nodeRepulsion: () => 160000,
            nodeOverlap: 40,
            nodeDimensionsIncludeLabels: true,
            idealEdgeLength: () => 55,
            edgeElasticity: () => 200,
            gravity: 2.5,
            numIter: 3000,
            componentSpacing: 140,
        })
        .run();
    fit();
    remember();
}

function remember(): void {
    if (!graph) return;
    placed.set(layer.value, Object.fromEntries(graph.nodes().map((node) => [node.id(), { ...node.position() }])));
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
            dashed: node.style("border-style") === "dashed",
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
let lit: NodeSingular | undefined;
let tourStep = 0;
let tour: ReturnType<typeof setInterval> | undefined;
let leaving: ReturnType<typeof setTimeout> | undefined;
let pointerOver = false;
let resizing: ResizeObserver | undefined;

const LINE_WORDS: Record<Layer, [string, string]> = {
    l1: ["cable", "cables"],
    l2: ["cable", "cables"],
    l3: ["shared prefix", "shared prefixes"],
    bgp: ["session", "sessions"],
    ospf: ["adjacency", "adjacencies"],
    tunnels: ["tunnel", "tunnels"],
};

function lines(count: number): string {
    const [one, many] = LINE_WORDS[layer.value];
    return `${count} ${count === 1 ? one : many}`;
}

/** Light one device with what it has a line to, and dim the rest; or light nothing. */
function light(node: NodeSingular | undefined): void {
    if (!graph) return;
    lit = node;
    graph.elements().removeClass("lit dim");

    if (node) {
        const near = node.closedNeighborhood();
        graph.elements().not(near).addClass("dim");
        node.addClass("lit");
        near.edges().addClass("lit");
        const detail = props.data.graph.nodes.find((candidate) => candidate.id === node.id())?.detail[0];
        caption.value = {
            title: String(node.data("label")),
            detail: [detail, lines(node.connectedEdges().length)].filter(Boolean).join(", "),
        };
    } else {
        const devices = graph.nodes('[kind = "device"]').length;
        caption.value = {
            title: LAYERS.find((item) => item.id === layer.value)?.label ?? "",
            detail: `${devices} ${devices === 1 ? "device" : "devices"}, ${lines(graph.edges().length)}`,
        };
    }
}

/** Frame what is lit with its neighbours, or the whole layer: gliding there, or at once. */
function frameLit(glide: boolean): void {
    if (!graph) return;
    const shown = lit ? lit.closedNeighborhood() : graph.elements();
    if (glide) graph.animate({ fit: { eles: shown, padding: 90 } }, { duration: 1100, easing: "ease-in-out-cubic" });
    else graph.fit(shown, 90);
}

/** The next layer with lines, after this one; this one when no other has any. */
function nextLayer(): Layer {
    const at = LAYERS.findIndex((item) => item.id === layer.value);
    const after = [...LAYERS.slice(at + 1), ...LAYERS.slice(0, at + 1)];
    return after.find((item) => counts.value[item.id])?.id ?? layer.value;
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
    selected.value = {};
    graph?.elements().removeClass("lit dim heavy");
    lit = undefined;
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
        style: [
            {
                selector: "node",
                style: {
                    shape: "round-rectangle",
                    width: "data(width)",
                    height: 34,
                    "background-color": css("--surface"),
                    "border-width": 2,
                    "border-color": css("--text"),
                    label: "data(label)",
                    color: css("--text"),
                    "font-family": css("--font"),
                    "font-size": 13,
                    "font-weight": 700,
                    "text-valign": "center",
                    "text-halign": "center",
                },
            },
            {
                selector: 'node[kind = "segment"]',
                style: { "background-color": css("--yellow"), "border-color": css("--navy"), color: "#11141b" },
            },
            {
                selector: 'node[kind = "outside"]',
                style: { "border-style": "dashed", "border-color": css("--edge"), color: css("--muted") },
            },
            { selector: 'node[level = "warning"]', style: { "border-color": css("--warning"), "border-width": 3 } },
            { selector: 'node[level = "error"]', style: { "border-color": css("--error"), "border-width": 3 } },
            {
                selector: "edge",
                style: {
                    width: 2,
                    "line-color": css("--edge"),
                    "curve-style": "bezier",
                    label: "data(label)",
                    "font-size": 11,
                    color: css("--muted"),
                    "text-background-color": css("--bg"),
                    "text-background-opacity": 1,
                    "text-background-padding": "2px",
                    "font-family": css("--font"),
                },
            },
            { selector: 'edge[oneSided = "yes"]', style: { "line-style": "dashed", "line-color": css("--warning") } },
            {
                selector: ":selected",
                style: { "border-color": css("--cobalt"), "line-color": css("--cobalt"), "border-width": 4, width: 4 },
            },
            // Presenting: heavier lines, the lit device in the highlighter with a navy frame (a warning or error keeps its own), the rest dimmed.
            { selector: "edge.heavy", style: { width: 3 } },
            { selector: "edge.lit", style: { width: 5, "line-color": css("--cobalt") } },
            { selector: "node.lit", style: { "background-color": css("--yellow"), color: "#11141b" } },
            { selector: 'node.lit[level = ""]', style: { "border-color": css("--navy"), "border-width": 3 } },
            { selector: ".dim", style: { opacity: 0.18 } },
        ],
    });

    graph.on("tap", "node", (event) => {
        selected.value = { node: props.data.graph.nodes.find((node) => node.id === event.target.id()) };
    });
    graph.on("tap", "edge", (event) => {
        const index = event.target.data("index") as number;
        selected.value = { edge: props.data.graph.edges.filter((edge) => edge.layer === layer.value)[index] };
    });
    graph.on("tap", (event) => {
        if (event.target === graph) selected.value = {};
    });
    graph.on("dbltap", 'node[kind = "device"]', (event) => go(`devices/${event.target.data("label")}`));
    graph.on("dragfree", "node", remember);

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

    draw();
    if (presenting.value) showPresenting();
});

onBeforeUnmount(() => {
    clearInterval(tour);
    clearTimeout(leaving);
    resizing?.disconnect();
    removeEventListener("keydown", onKey);
    document.body.classList.remove("presenting");
    graph?.destroy();
});

watch([layer, () => props.data], () => {
    draw();
    // A new layer while presenting is shown whole first, with its full time.
    if (presenting.value) showPresenting();
});

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
                <button title="Forget where nodes were moved on this layer, and lay it out again" @click="layOut">Lay out again</button>
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
                    <h2>{{ LAYERS.find((item) => item.id === layer)?.label }}</h2>
                    <p class="muted">{{ LAYERS.find((item) => item.id === layer)?.legend }}</p>
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
