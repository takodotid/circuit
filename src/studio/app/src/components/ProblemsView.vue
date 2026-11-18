<!-- Everything that needs a look: what `circuit validate` finds, errors first, and every line of the graph only one end declares, such as a BGP session or a tunnel with nothing back. The top bar counts both. -->
<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import type { StudioData } from "../../../types";
import { GraphLayer } from "../lib/graph-layer";
import { showInGraph } from "../lib/store";
import DataTable from "./DataTable.vue";
import type { Row } from "./DataTable.vue";

const props = defineProps<{ data: StudioData }>();
const router = useRouter();

const findings = computed<Row[]>(() =>
    [...props.data.findings]
        .sort((a, b) => Number(b.level === "error") - Number(a.level === "error"))
        .map((finding) => ({
            cells: [
                { badges: [{ level: finding.level, text: finding.level }] },
                finding.device ? { device: finding.device } : "the network",
                finding.message,
            ],
        }))
);

const nameOf = (id: string) => props.data.graph.nodes.find((node) => node.id === id)?.label ?? id;

const oneSided = computed<Row[]>(() =>
    GraphLayer.oneSided(props.data).map((edge) => ({
        cells: [
            GraphLayer.NAMES[edge.layer],
            edge.label,
            nameOf(edge.from),
            nameOf(edge.to),
            edge.detail.at(-1),
            { action: () => showInGraph(router, edge.layer, { path: [GraphLayer.keyOf(edge)] }), label: "Show in the graph" },
        ],
    }))
);
</script>

<template>
    <h2>Problems</h2>
    <h3>Found by <code>circuit validate</code></h3>
    <DataTable :head="['', 'Device', 'What']" :rows="findings" csv="findings" />

    <h3>Declared at one end only</h3>
    <DataTable :head="['Layer', 'What', 'From', 'To', 'Why', '']" :rows="oneSided" csv="one-sided" />
</template>
