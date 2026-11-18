<!-- The panel beside the graph: the node or line selected, or, with nothing selected, the layer, what validate finds and the legend. -->
<script setup lang="ts">
import { computed } from "vue";
import type { CarriedVlan, Layer } from "../../../../core/graph";
import type { StudioData } from "../../../types";
import { GraphLayer } from "../lib/graph-layer";
import type { Shown, ShownEdge, ShownNode } from "../lib/graph-layer";
import { store } from "../lib/store";
import GraphLegend from "./GraphLegend.vue";

export type Selection = { node: string } | { edge: string } | undefined;

const props = defineProps<{ data: StudioData; layer: Layer; shown: Shown; selected: { node?: ShownNode; edge?: ShownEdge } }>();
const emit = defineEmits<{ select: [next: Selection] }>();

/** What a node is, when its drawing doesn't say: a device's does. */
const KINDS = { device: undefined, segment: "a prefix several devices share", outside: "outside the network" };

const nameOf = (id: string) => props.shown.nodes.find((node) => node.id === id)?.label ?? id;

/** What is shown, so a new selection fades in and the same one changed in place does not. */
const key = computed(() => props.selected.node?.id ?? props.selected.edge?.id ?? props.layer);

/** The selected node's lines on this layer, each with what is at its far end. */
const nodeLines = computed(() => {
    const node = props.selected.node;
    if (!node) return [];
    return props.shown.edges
        .filter((edge) => edge.from === node.id || edge.to === node.id)
        .map((edge) => ({ edge, other: nameOf(edge.from === node.id ? edge.to : edge.from) }));
});

const errorsFirst = <T extends { level: string }>(list: T[]) =>
    [...list].sort((a, b) => Number(b.level === "error") - Number(a.level === "error"));

const nodeFindings = computed(() => {
    const node = props.selected.node;
    return errorsFirst(props.data.findings.filter((finding) => node?.kind === "device" && finding.device === node.label));
});
const findings = computed(() => errorsFirst(props.data.findings));

/** Every VLAN the layer's cables carry. */
const layerVlans = computed(() => {
    const vlans = new Map<number, CarriedVlan>();
    for (const edge of props.shown.edges) for (const vlan of edge.vlans ?? []) vlans.set(vlan.id, vlan);
    return [...vlans.values()].sort((a, b) => a.id - b.id);
});

/** Light the cables that carry a VLAN, or stop. */
function toggleVlan(id: number): void {
    emit("select", undefined);
    if (store.graphFocus.vlan === id) delete store.graphFocus.vlan;
    else store.graphFocus.vlan = id;
}
</script>

<template>
    <aside>
        <Transition name="enter" mode="out-in">
            <div v-if="selected.node" :key="key">
                <h2>{{ selected.node.label }}</h2>
                <p v-if="KINDS[selected.node.kind]" class="kind">{{ KINDS[selected.node.kind] }}</p>
                <p v-if="selected.node.gone"><span class="badge error">gone</span>In {{ store.graphFocus.comparison?.name }}, not now.</p>
                <p v-else-if="selected.node.kind === 'device'">
                    <RouterLink :to="{ name: 'device', params: { name: selected.node.label } }">Open {{ selected.node.label }}</RouterLink>
                </p>
                <ul v-if="selected.node.detail.length">
                    <li v-for="line in selected.node.detail" :key="line">{{ line }}</li>
                </ul>
                <template v-if="nodeFindings.length">
                    <h3>Found by <code>circuit validate</code></h3>
                    <ul>
                        <li v-for="(finding, index) in nodeFindings" :key="index">
                            <span :class="['badge', finding.level]">{{ finding.level }}</span>{{ finding.message }}
                        </li>
                    </ul>
                </template>
                <h3>{{ GraphLayer.LINES[layer][1] }}</h3>
                <p v-if="!nodeLines.length" class="muted">None.</p>
                <ul v-else>
                    <li v-for="{ edge, other } in nodeLines" :key="edge.id">
                        <button type="button" class="link" @click="emit('select', { edge: edge.id })">{{ edge.label }}</button>
                        <span class="muted"> with {{ other }}</span>
                    </li>
                </ul>
            </div>

            <div v-else-if="selected.edge" :key="key">
                <h2>{{ selected.edge.label }}</h2>
                <p class="kind">
                    {{ GraphLayer.NAMES[selected.edge.layer] }}, between
                    <button type="button" class="link" @click="emit('select', { node: selected.edge.from })">
                        {{ nameOf(selected.edge.from) }}
                    </button>
                    and
                    <button type="button" class="link" @click="emit('select', { node: selected.edge.to })">
                        {{ nameOf(selected.edge.to) }}
                    </button>
                </p>
                <p v-if="selected.edge.oneSided">Only one end declares it.</p>
                <p v-if="selected.edge.added"><span class="badge added">new</span>Not in {{ store.graphFocus.comparison?.name }}.</p>
                <p v-if="selected.edge.gone"><span class="badge error">gone</span>In {{ store.graphFocus.comparison?.name }}, not now.</p>
                <template v-if="selected.edge.members">
                    <h3>{{ GraphLayer.count(selected.edge.layer, selected.edge.members.length) }}</h3>
                    <ul class="members">
                        <li v-for="member in selected.edge.members" :key="member.id">
                            <strong>{{ member.label }}</strong>
                            <span v-for="line in member.detail" :key="line" class="muted">{{ line }}</span>
                        </li>
                    </ul>
                </template>
                <ul v-else-if="selected.edge.detail.length">
                    <li v-for="line in selected.edge.detail" :key="line">{{ line }}</li>
                </ul>
                <template v-if="selected.edge.vlans?.length">
                    <h3>VLANs</h3>
                    <div class="chips">
                        <button
                            v-for="vlan in selected.edge.vlans"
                            :key="vlan.id"
                            :aria-pressed="store.graphFocus.vlan === vlan.id"
                            @click="toggleVlan(vlan.id)"
                        >
                            {{ vlan.name }} {{ vlan.id }}
                        </button>
                    </div>
                </template>
            </div>

            <div v-else :key="key">
                <h2>{{ GraphLayer.NAMES[layer] }}</h2>
                <p class="muted">{{ GraphLayer.HELP[layer] }}</p>
                <template v-if="store.graphFocus.comparison">
                    <h3>Compared with {{ store.graphFocus.comparison.name }}</h3>
                    <p><button type="button" class="link" @click="delete store.graphFocus.comparison">Stop comparing</button></p>
                </template>
                <template v-if="layer === 'l2' && layerVlans.length">
                    <h3>VLANs</h3>
                    <div class="chips">
                        <button
                            v-for="vlan in layerVlans"
                            :key="vlan.id"
                            :aria-pressed="store.graphFocus.vlan === vlan.id"
                            @click="toggleVlan(vlan.id)"
                        >
                            {{ vlan.name }} {{ vlan.id }}
                        </button>
                    </div>
                </template>
                <template v-if="findings.length">
                    <h3>Found by <code>circuit validate</code></h3>
                    <ul>
                        <li v-for="(finding, index) in findings" :key="index">
                            <span :class="['badge', finding.level]">{{ finding.level }}</span>
                            <template v-if="finding.device">
                                <button type="button" class="link" @click="emit('select', { node: `device:${finding.device}` })">
                                    {{ finding.device }}</button>:
                            </template>
                            {{ finding.message }}
                        </li>
                    </ul>
                </template>
                <h3>Legend</h3>
                <GraphLegend :layer="layer" :comparing="Boolean(store.graphFocus.comparison)" />
                <p class="muted">Double-click a device to open its page.</p>
            </div>
        </Transition>
    </aside>
</template>
