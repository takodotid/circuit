<!-- The network drawn, one layer at a time: cables, VLANs, address segments, BGP, OSPF and tunnels. Drawn with Cytoscape; a node or line picked shows what it is in the panel. -->
<script setup lang="ts">
import cytoscape, { type Core, type ElementDefinition } from "cytoscape";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { GraphEdge, GraphNode, Layer } from "../../../../core/graph";
import type { StudioData } from "../../../types";
import { Export } from "../lib/csv";
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
    graph?.layout({ name: "cose", animate: false, fit: false, nodeRepulsion: () => 12000, idealEdgeLength: () => 140 }).run();
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

    draw();
});

onBeforeUnmount(() => graph?.destroy());
watch([layer, () => props.data], draw);

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
            </div>
        </div>
        <div class="stage">
            <div ref="container" class="canvas" role="img" aria-label="The network"></div>
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
