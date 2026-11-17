<!-- What `circuit validate` finds, errors first, and every line of the graph only one end declares: BGP sessions and tunnels with nothing back, and internal BGP to an address no device holds. -->
<script setup lang="ts">
import { computed } from "vue";
import type { StudioData } from "../../../types";
import { GraphLayer } from "../lib/graph-layer";
import { go, showInGraph } from "../lib/store";
import DataTable, { type Row } from "./DataTable.vue";

const props = defineProps<{ data: StudioData }>();

const findings = computed(() => [...props.data.findings].sort((a, b) => (a.level === b.level ? 0 : a.level === "error" ? -1 : 1)));

const nameOf = (id: string) => props.data.graph.nodes.find((node) => node.id === id)?.label ?? id;

// The VLANs layer repeats the cables layer's cables, so a cable is counted once.
const oneSided = computed<Row[]>(() =>
    props.data.graph.edges
        .filter((edge) => edge.oneSided && edge.layer !== "l2")
        .map((edge) => ({
            cells: [
                GraphLayer.NAMES[edge.layer],
                edge.label,
                nameOf(edge.from),
                nameOf(edge.to),
                edge.detail.at(-1),
                { action: () => showInGraph(edge.layer, { path: [GraphLayer.keyOf(edge)] }), label: "in the graph" },
            ],
        }))
);
</script>

<template>
    <h2>Problems</h2>
    <h3>Found by <code>circuit validate</code></h3>
    <p v-if="!findings.length" class="muted">Nothing: every device validates.</p>
    <ul v-else class="findings">
        <li v-for="(finding, index) in findings" :key="index">
            <span :class="['badge', finding.level]">{{ finding.level }}</span>
            <a v-if="finding.device" @click="go(`devices/${finding.device}`)">{{ finding.device }}</a
            ><template v-if="finding.device">: </template>{{ finding.message }}
        </li>
    </ul>

    <h3>Declared at one end only</h3>
    <DataTable :head="['Layer', 'What', 'From', 'To', 'Why', '']" :rows="oneSided" csv="one-sided" />
</template>
