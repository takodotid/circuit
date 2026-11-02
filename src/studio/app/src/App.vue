<!-- Studio's frame: the rail with the views and the search, the network's health, and the view the address names. -->
<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { Format } from "./lib/format";
import { go, store } from "./lib/store";
import AddressesView from "./components/AddressesView.vue";
import CablesView from "./components/CablesView.vue";
import CompareView from "./components/CompareView.vue";
import DeviceView from "./components/DeviceView.vue";
import DevicesView from "./components/DevicesView.vue";
import GraphView from "./components/GraphView.vue";
import ProblemsView from "./components/ProblemsView.vue";
import SearchView from "./components/SearchView.vue";
import SecretsView from "./components/SecretsView.vue";
import SessionsView from "./components/SessionsView.vue";
import ToolsView from "./components/ToolsView.vue";
import VlansView from "./components/VlansView.vue";

const VIEWS = [
    { id: "graph", label: "Graph" },
    { id: "devices", label: "Devices" },
    { id: "vlans", label: "VLANs" },
    { id: "addresses", label: "Addresses" },
    { id: "sessions", label: "BGP" },
    { id: "cables", label: "Cables" },
    { id: "tools", label: "Tools" },
    { id: "compare", label: "Compare" },
    { id: "secrets", label: "Secrets" },
    { id: "problems", label: "Problems" },
] as const;

// `#device/<name>` opens a device too, as `#devices/<name>` does.
const view = computed(() => (store.route.view === "device" ? "devices" : store.route.view));
const device = computed(() => (view.value === "devices" ? store.route.parts[0] : undefined));

const errors = computed(() => store.data?.findings.filter((finding) => finding.level === "error").length ?? 0);
const warnings = computed(() => (store.data?.findings.length ?? 0) - errors.value);

const summary = computed(() => [
    { text: Format.count(store.data?.devices.length ?? 0, "device"), state: "neutral" },
    { text: Format.count(errors.value, "error"), state: errors.value ? "error" : "quiet" },
    { text: Format.count(warnings.value, "warning"), state: warnings.value ? "warning" : "quiet" },
]);

// The search waits for typing to stop, then shows what it finds; an emptied search goes back to the graph.
const query = ref(view.value === "search" ? (store.route.parts[0] ?? "") : "");
let searching: ReturnType<typeof setTimeout> | undefined;
watch(query, (text) => {
    clearTimeout(searching);
    searching = setTimeout(() => go(text.trim() ? `search/${text.trim()}` : "graph"), 250);
});
</script>

<template>
    <header>
        <a class="brand" href="#graph" aria-label="Circuit Studio, back to the graph"
            ><span class="wordmark">Circuit</span><span class="product">Studio</span></a
        >
        <nav aria-label="Views">
            <button v-for="item in VIEWS" :key="item.id" :aria-pressed="view === item.id" @click="go(item.id)">
                {{ item.label }}<span v-if="item.id === 'problems'" class="count">{{ store.data?.findings.length || "" }}</span>
            </button>
        </nav>
        <input v-model="query" type="search" placeholder="Search the project" aria-label="Search the project" />
        <div class="status-rail" aria-label="Network status">
            <span class="summary">
                <span v-for="item in summary" :key="item.text" :class="['summary-item', item.state]">{{ item.text }}</span>
            </span>
            <span :class="['live', { on: store.live === 'live', beat: store.beat }]">{{
                store.live === "live" ? `${store.data?.project ?? ""} · live` : store.live
            }}</span>
        </div>
    </header>

    <pre v-if="store.error" class="banner">{{ store.error }}</pre>

    <main v-if="store.data">
        <GraphView v-if="view === 'graph'" :data="store.data" />
        <DeviceView v-else-if="device" :key="device" :data="store.data" :name="device" />
        <div v-else class="tables">
            <DevicesView v-if="view === 'devices'" :data="store.data" />
            <VlansView v-else-if="view === 'vlans'" :data="store.data" />
            <AddressesView v-else-if="view === 'addresses'" :data="store.data" />
            <SessionsView v-else-if="view === 'sessions'" :data="store.data" />
            <CablesView v-else-if="view === 'cables'" :data="store.data" />
            <ToolsView v-else-if="view === 'tools'" :data="store.data" />
            <CompareView v-else-if="view === 'compare'" :data="store.data" />
            <SecretsView v-else-if="view === 'secrets'" />
            <ProblemsView v-else-if="view === 'problems'" :data="store.data" />
            <SearchView v-else-if="view === 'search'" :data="store.data" :query="store.route.parts[0] ?? ''" />
            <p v-else class="muted">Nothing here. <a @click="go('graph')">Back to the graph</a>.</p>
        </div>
    </main>
    <main v-else-if="!store.error" class="tables"><p class="muted">Reading the project…</p></main>
</template>
