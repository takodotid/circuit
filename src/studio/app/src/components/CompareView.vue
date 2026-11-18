<!-- The project now against another branch, tag or commit: devices added, removed and changed with their config line by line, the graph's lines added and gone, and what validate finds newly or no longer. -->
<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import type { GraphEdge } from "../../../../core/graph";
import type { Commit, StudioData } from "../../../types";
import { Format } from "../lib/format";
import { GraphLayer } from "../lib/graph-layer";
import { api, go, href, showInGraph, store } from "../lib/store";
import DataTable, { type Badge, type Row } from "./DataTable.vue";
import LineDiff from "./LineDiff.vue";

const props = defineProps<{ data: StudioData }>();

const refs = ref<{ names: string[]; commits: Commit[] }>();
const refsError = ref("");
const typed = ref(store.route.parts[0] ?? "");
const comparison = ref<{ commit: Commit; network: StudioData }>();
const compareError = ref("");
const reading = ref(false);

onMounted(async () => {
    try {
        refs.value = await api("/api/refs");
    } catch (error) {
        refsError.value = (error as Error).message;
    }
});

watch(
    () => store.route.parts[0],
    async (asked) => {
        comparison.value = undefined;
        compareError.value = "";
        if (!asked) return;

        reading.value = true;
        try {
            const answer = await api<{ commit: Commit; network: StudioData | { error: string } }>(
                `/api/compare?ref=${encodeURIComponent(asked)}`
            );
            if ("error" in answer.network) throw new Error(`The project at ${asked} cannot be read:\n${answer.network.error}`);
            comparison.value = { commit: answer.commit, network: answer.network };
        } catch (error) {
            compareError.value = (error as Error).message;
        } finally {
            reading.value = false;
        }
    },
    { immediate: true }
);

const devices = computed(() => {
    const then = comparison.value?.network;
    if (!then) return undefined;

    const before = new Map(then.devices.map((device) => [device.name, then.rendered[device.name] ?? ""]));
    const after = new Map(props.data.devices.map((device) => [device.name, props.data.rendered[device.name] ?? ""]));

    return {
        added: [...after.keys()].filter((name) => !before.has(name)),
        removed: [...before.keys()].filter((name) => !after.has(name)),
        changed: [...after.keys()]
            .filter((name) => before.has(name) && before.get(name) !== after.get(name))
            .map((name) => ({ name, before: before.get(name)!, after: after.get(name)! })),
    };
});

const edgeKey = (edge: GraphEdge) => `${edge.layer}|${[edge.from, edge.to].sort().join("|")}|${edge.label}`;
const edges = computed(() => {
    const then = comparison.value?.network;
    if (!then) return undefined;

    const before = new Set(then.graph.edges.map(edgeKey));
    const after = new Set(props.data.graph.edges.map(edgeKey));

    return {
        added: props.data.graph.edges.filter((edge) => !before.has(edgeKey(edge))),
        gone: then.graph.edges.filter((edge) => !after.has(edgeKey(edge))),
    };
});

/** The graph's lines added and gone, as a table, each with its layer and both ends by name. */
const edgeRows = computed<Row[]>(() => {
    const then = comparison.value?.network;
    if (!then || !edges.value) return [];

    const nodes = [...props.data.graph.nodes, ...then.graph.nodes];
    const nameOf = (id: string) => nodes.find((node) => node.id === id)?.label ?? id;
    const row = (edge: GraphEdge, change: Badge) => ({
        cells: [GraphLayer.NAMES[edge.layer], { badges: [change] }, edge.label, nameOf(edge.from), nameOf(edge.to)],
    });

    return [
        ...edges.value.added.map((edge) => row(edge, { level: "added", text: "added" })),
        ...edges.value.gone.map((edge) => row(edge, { level: "error", text: "gone" })),
    ];
});

/** Show the lines added and gone on the graph, on the first layer that changes. */
function showChanges(): void {
    if (!edges.value) return;
    const changed = [...edges.value.added, ...edges.value.gone];
    const first = GraphLayer.LAYERS.find((layer) => changed.some((edge) => edge.layer === layer)) ?? "l1";
    showInGraph(first, { comparison: { name: store.route.parts[0] ?? "", added: edges.value.added, removed: edges.value.gone } });
}

const findingKey = (finding: { level: string; device?: string; message: string }) =>
    `${finding.level}|${finding.device ?? ""}|${finding.message}`;
const findings = computed(() => {
    const then = comparison.value?.network;
    if (!then) return undefined;

    const before = new Set(then.findings.map(findingKey));
    const after = new Set(props.data.findings.map(findingKey));
    return {
        added: props.data.findings.filter((finding) => !before.has(findingKey(finding))),
        gone: then.findings.filter((finding) => !after.has(findingKey(finding))),
    };
});
</script>

<template>
    <h2>Compare</h2>
    <p class="muted">Compare the project with a branch, tag or commit.</p>
    <p v-if="refsError" class="verdict reject">{{ refsError }}</p>
    <form class="tool-form" @submit.prevent="typed.trim() && go(`compare/${typed.trim()}`)">
        <label class="field"
            >Branch, tag or commit
            <input v-model="typed" list="refs" placeholder="main, HEAD~3" />
            <datalist id="refs">
                <option v-for="name in refs?.names ?? []" :key="name" :value="name" />
                <option v-for="commit in refs?.commits ?? []" :key="commit.commit" :value="commit.short">{{ commit.subject }}</option>
            </datalist>
        </label>
        <button class="primary" type="submit">Compare</button>
    </form>

    <p v-if="reading" class="muted">Reading the project at {{ store.route.parts[0] }}…</p>
    <pre v-if="compareError" class="banner">{{ compareError }}</pre>

    <template v-if="comparison && devices && edges && findings">
        <p>
            Against <strong>{{ comparison.commit.short }}</strong
            >, {{ comparison.commit.subject }}, by {{ comparison.commit.author }}, {{ new Date(comparison.commit.date).toLocaleString() }}.
        </p>

        <h3>Devices</h3>
        <p v-if="!devices.added.length && !devices.removed.length && !devices.changed.length" class="muted">No changes.</p>
        <ul class="findings">
            <li v-for="name in devices.added" :key="`added ${name}`">
                <span class="badge added">added</span><a :href="href(`devices/${name}`)">{{ name }}</a>
            </li>
            <li v-for="name in devices.removed" :key="`removed ${name}`"><span class="badge error">removed</span>{{ name }}</li>
        </ul>
        <details v-for="change in devices.changed" :key="change.name" class="change">
            <summary>{{ change.name }}</summary>
            <LineDiff :before="change.before" :after="change.after" />
        </details>

        <h3>The graph</h3>
        <p v-if="!edgeRows.length" class="muted">No changes.</p>
        <template v-else>
            <p><button type="button" class="link" @click="showChanges">Show the changes in the graph</button></p>
            <DataTable
                :head="['Layer', 'Change', 'What', 'From', 'To']"
                :rows="edgeRows"
                :csv="`compare-${comparison.commit.short}-graph`"
            />
        </template>

        <h3>Found by <code>circuit validate</code></h3>
        <p v-if="!findings.added.length && !findings.gone.length" class="muted">No changes.</p>
        <p v-else class="muted">
            {{ Format.count(findings.added.length, "new finding") }}, {{ Format.count(findings.gone.length, "finding") }} no longer.
        </p>
        <ul class="findings">
            <li v-for="(finding, index) in findings.added" :key="`new ${index}`">
                <span :class="['badge', finding.level]">new {{ finding.level }}</span
                >{{ finding.device ? `${finding.device}: ` : "" }}{{ finding.message }}
            </li>
            <li v-for="(finding, index) in findings.gone" :key="`gone ${index}`">
                <span class="badge">no longer</span>{{ finding.device ? `${finding.device}: ` : "" }}{{ finding.message }}
            </li>
        </ul>
    </template>
</template>
