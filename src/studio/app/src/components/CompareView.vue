<!-- The project now against another branch, tag or commit: devices added, removed and changed with their config line by line, the graph's lines added and gone, and what validate finds newly or no longer. -->
<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import type { GraphEdge } from "../../../../core/graph";
import type { Commit, StudioData } from "../../../types";
import { Format } from "../lib/format";
import { api, go, store } from "../lib/store";
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
    const describe = (edge: GraphEdge) =>
        `${edge.layer}: ${edge.from.replace(/^\w+:/, "")} to ${edge.to.replace(/^\w+:/, "")}, ${edge.label}`;

    return {
        added: props.data.graph.edges.filter((edge) => !before.has(edgeKey(edge))).map(describe),
        gone: then.graph.edges.filter((edge) => !after.has(edgeKey(edge))).map(describe),
    };
});

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
    <p class="muted">
        The project now against a branch, tag or commit, read by the Circuit running now: so it shows changes to your files, not to Circuit.
        Before you merge a pull request, compare its branch with <code>main</code>.
    </p>
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
        <p v-if="!devices.added.length && !devices.removed.length && !devices.changed.length" class="muted">No device's config changes.</p>
        <ul class="findings">
            <li v-for="name in devices.added" :key="`added ${name}`">
                <span class="badge">added</span><a @click="go(`devices/${name}`)">{{ name }}</a>
            </li>
            <li v-for="name in devices.removed" :key="`removed ${name}`"><span class="badge error">removed</span>{{ name }}</li>
        </ul>
        <details v-for="change in devices.changed" :key="change.name" class="change">
            <summary>{{ change.name }}: its config changes</summary>
            <LineDiff :before="change.before" :after="change.after" />
        </details>

        <h3>The graph</h3>
        <p v-if="!edges.added.length && !edges.gone.length" class="muted">No line of the graph changes.</p>
        <ul class="findings">
            <li v-for="line in edges.added" :key="`+${line}`"><span class="added">+</span> {{ line }}</li>
            <li v-for="line in edges.gone" :key="`-${line}`"><span class="removed">−</span> {{ line }}</li>
        </ul>

        <h3>Found by <code>circuit validate</code></h3>
        <p v-if="!findings.added.length && !findings.gone.length" class="muted">Nothing new, and nothing gone.</p>
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
