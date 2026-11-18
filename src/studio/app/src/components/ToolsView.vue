<!-- Studio's tools: trace an address through the project, find the cables that carry a VLAN between two devices, and test a packet against a firewall chain or a route against a route policy. Each keeps what was asked in the page's address. -->
<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import type { StudioData } from "../../../types";
import { GraphLayer } from "../lib/graph-layer";
import { go, goParams, placeParams, showInGraph, store } from "../lib/store";
import { Tools } from "../lib/tools";
import DataTable from "./DataTable.vue";
import FirewallTest from "./FirewallTest.vue";
import PolicyTest from "./PolicyTest.vue";

const props = defineProps<{ data: StudioData }>();

const TOOLS = ["trace", "vlan", "firewall", "policy"] as const;
const tool = computed(() => TOOLS.find((name) => name === store.route.parts[0]) ?? "trace");

// A trace has its own address, such as `#tools/trace/192.0.2.5`, to bookmark or send.
const typed = ref(store.route.parts[0] === "trace" ? (store.route.parts[1] ?? "") : "");
const traced = computed(() => (tool.value === "trace" && store.route.parts[1] ? Tools.trace(props.data, store.route.parts[1]) : undefined));
const traceFailed = computed(() => tool.value === "trace" && Boolean(store.route.parts[1]) && !traced.value);

/** Where the traced address is, in a sentence. */
const placed = computed(() => {
    const place = traced.value?.place;
    if (!place) return "";
    if (place.segment && place.space?.prefix === place.segment.prefix) return `In ${place.segment.prefix}: ${place.space.owner}.`;
    if (place.segment) return `In ${place.segment.prefix}${place.space ? `, inside ${place.space.prefix}: ${place.space.owner}` : ""}.`;
    if (place.block) return `In ${place.block.prefix}: ${place.block.what}.`;
    if (place.space) return `In ${place.space.prefix}: ${place.space.owner}. Nothing uses it yet.`;
    return "No segment or block of the project holds it.";
});

// The VLAN path keeps what was picked in the address, such as `#tools/vlan/vlan=users&from=core-01&to=acc-04`.
const VLAN_PLACE = "tools/vlan";
const vlans = computed(() => [...new Set(props.data.devices.flatMap((device) => Object.keys(device.switching?.vlans ?? {})))].sort());
const devices = computed(() => props.data.devices.map((device) => device.name));
const asked = computed(() => placeParams(VLAN_PLACE));
const picked = reactive({ vlan: "", from: "", to: "" });

watch(
    asked,
    (params) => {
        picked.vlan = params.get("vlan") ?? vlans.value[0] ?? "";
        picked.from = params.get("from") ?? devices.value[0] ?? "";
        picked.to = params.get("to") ?? devices.value[1] ?? "";
    },
    { immediate: true }
);

function findPath(): void {
    goParams(VLAN_PLACE, new URLSearchParams({ vlan: picked.vlan, from: picked.from, to: picked.to }));
}

const question = computed(() => {
    const params = asked.value;
    const vlan = params.get("vlan");
    const from = params.get("from");
    const to = params.get("to");
    return tool.value === "vlan" && vlan && from && to ? { vlan, from, to } : undefined;
});
const path = computed(() =>
    question.value ? Tools.vlanPath(props.data, question.value.vlan, question.value.from, question.value.to) : undefined
);

/** Light the path's cables on the VLANs layer: each line between two of its devices that carries the VLAN. */
function showPath(): void {
    const pairOf = (a: string, b: string) => [a, b].sort().join("|");
    const pairs = new Set((path.value ?? []).map((hop) => pairOf(`device:${hop.device}`, `device:${hop.farDevice}`)));
    const lines = props.data.graph.edges.filter(
        (edge) =>
            edge.layer === "l2" &&
            pairs.has(pairOf(edge.from, edge.to)) &&
            edge.vlans?.some((carried) => carried.name === question.value?.vlan)
    );
    showInGraph("l2", { path: lines.map(GraphLayer.keyOf) });
}
</script>

<template>
    <h2>Tools</h2>
    <div class="tabs">
        <button :aria-pressed="tool === 'trace'" @click="go('tools/trace')">Trace an address</button>
        <button :aria-pressed="tool === 'vlan'" @click="go('tools/vlan')">VLAN path</button>
        <button :aria-pressed="tool === 'firewall'" @click="go('tools/firewall')">Test a firewall</button>
        <button :aria-pressed="tool === 'policy'" @click="go('tools/policy')">Test a route policy</button>
    </div>

    <FirewallTest v-if="tool === 'firewall'" :data="data" />
    <PolicyTest v-else-if="tool === 'policy'" :data="data" />

    <template v-else-if="tool === 'trace'">
        <p class="muted">
            Who holds an address, each device's route to it, and the rules that name it. BGP and OSPF routes aren't in the project.
        </p>
        <form class="tool-form" @submit.prevent="go(`tools/trace/${typed.trim()}`)">
            <label class="field">Address <input v-model="typed" placeholder="192.0.2.5" /></label>
            <button class="primary" type="submit">Trace</button>
        </form>
        <p v-if="traceFailed" class="verdict reject">That is not one address, such as 192.0.2.5 or 2001:db8::5.</p>
        <template v-if="traced">
            <p>{{ placed }}</p>
            <template v-if="traced.place.uses.length">
                <h3>Used by</h3>
                <DataTable :head="['Address', 'Used by']" :rows="traced.place.uses.map((use) => ({ cells: [use.address, use.what] }))" />
            </template>
            <h3>Held by</h3>
            <DataTable
                :head="['Device', 'On', 'Address']"
                :rows="traced.held.map((entry) => ({ cells: [{ device: entry.device }, entry.holder, entry.address] }))"
            />
            <h3>How each device reaches it</h3>
            <DataTable
                :head="['Device', 'Table', 'How', 'Prefix', 'Via', 'Through', 'Note']"
                :rows="
                    traced.routes.map((route) => ({
                        muted: route.kind === 'none',
                        cells: [
                            { device: route.device },
                            route.table,
                            route.kind === 'none' ? 'no route in the project' : route.kind,
                            route.prefix,
                            route.via,
                            route.through,
                            route.note,
                        ],
                    }))
                "
                csv="trace"
            />
            <h3>Rules that name it</h3>
            <DataTable
                :head="['Device', 'Where', 'Rule', 'Matches its', 'Then', 'Description']"
                :rows="
                    traced.rules.map((rule) => ({
                        cells: [{ device: rule.device }, rule.where, rule.rule, rule.side, rule.then, rule.description],
                    }))
                "
            />
        </template>
    </template>

    <template v-else>
        <p class="muted">The fewest cables that carry a VLAN between two devices.</p>
        <form class="tool-form" @submit.prevent="findPath">
            <label class="field"
                >VLAN
                <select v-model="picked.vlan">
                    <option v-for="name in vlans" :key="name">{{ name }}</option>
                </select>
            </label>
            <label class="field"
                >From
                <select v-model="picked.from">
                    <option v-for="name in devices" :key="name">{{ name }}</option>
                </select>
            </label>
            <label class="field"
                >To
                <select v-model="picked.to">
                    <option v-for="name in devices" :key="name">{{ name }}</option>
                </select>
            </label>
            <button class="primary" type="submit">Find the path</button>
        </form>
        <template v-if="question">
            <p v-if="!path" class="verdict reject">
                No path of cables carries {{ question.vlan }} from {{ question.from }} to {{ question.to }}.
            </p>
            <p v-else-if="!path.length" class="muted">{{ question.from }} and {{ question.to }} are one device.</p>
            <template v-else>
                <p><button type="button" class="link" @click="showPath">Show in the graph</button></p>
                <DataTable
                    :head="['From', 'Port', 'To', 'Port']"
                    :rows="path.map((hop) => ({ cells: [{ device: hop.device }, hop.port, { device: hop.farDevice }, hop.farPort] }))"
                />
            </template>
        </template>
    </template>
</template>
