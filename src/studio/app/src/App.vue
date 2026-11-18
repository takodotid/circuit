<!-- Studio's frame: the rail with the views and the search, the network's health, and the page the path names. -->
<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { Format } from "./lib/format";
import { GraphLayer } from "./lib/graph-layer";
import { store } from "./lib/store";
import { placeOf, viewOf } from "./router";
import FieldNote from "./components/FieldNote.vue";

const VIEWS = [
    { id: "graph", label: "Graph", to: "/" },
    { id: "devices", label: "Devices", to: "/devices" },
    { id: "vlans", label: "VLANs", to: "/vlans" },
    { id: "addresses", label: "Addresses", to: "/addresses" },
    { id: "bgp", label: "BGP", to: "/bgp" },
    { id: "cables", label: "Cables", to: "/cables" },
    { id: "tools", label: "Tools", to: "/tools" },
    { id: "compare", label: "Compare", to: "/compare" },
    { id: "secrets", label: "Secrets", to: "/secrets" },
    { id: "problems", label: "Problems", to: "/problems" },
] as const;

const route = useRoute();
const router = useRouter();
const view = computed(() => viewOf(route));

// What the live mark can't say in one word.
const LIVE: Record<typeof store.live, string | undefined> = {
    live: "A saved file shows here at once.",
    connecting: undefined,
    offline: "Check that circuit studio is still running.",
};

const errors = computed(() => store.data?.findings.filter((finding) => finding.level === "error").length ?? 0);
const warnings = computed(() => (store.data?.findings.length ?? 0) - errors.value);

const summary = computed(() => [
    { text: Format.count(store.data?.devices.length ?? 0, "device"), state: "neutral" },
    { text: Format.count(errors.value, "error"), state: errors.value ? "error" : "quiet" },
    { text: Format.count(warnings.value, "warning"), state: warnings.value ? "warning" : "quiet" },
]);

// What the Problems page lists: what validate finds, and every line only one end declares.
const problems = computed(() => (store.data ? store.data.findings.length + GraphLayer.oneSided(store.data).length : 0));

// The search waits for typing to stop, then shows what it finds; an emptied search goes back to the graph. Leaving the search empties it.
// Typing more replaces the search's address, so Back leaves the search in one step.
const query = ref("");
let searching: ReturnType<typeof setTimeout> | undefined;
/** How long the search waits after a key, so it runs once the reader stops typing. */
const TYPING_PAUSE = 250;

function search(event: Event): void {
    const text = (event.target as HTMLInputElement).value;
    query.value = text;
    clearTimeout(searching);
    searching = setTimeout(() => {
        if (!text.trim()) return void router.push({ name: "graph" });
        const next = { name: "search", query: { q: text.trim() } };
        void (view.value === "search" ? router.replace(next) : router.push(next));
    }, TYPING_PAUSE);
}

watch(
    () => [view.value, route.query.q] as const,
    ([next, asked]) => {
        if (next !== "search") query.value = "";
        else if (typeof asked === "string" && asked !== query.value.trim()) query.value = asked;
    },
    { immediate: true }
);
</script>

<template>
    <header>
        <RouterLink class="brand" to="/" aria-label="Circuit Studio, back to the graph"
            ><span class="wordmark">Circuit</span><span class="product">Studio</span></RouterLink
        >
        <nav aria-label="Views">
            <RouterLink v-for="item in VIEWS" :key="item.id" :to="item.to" :aria-current="view === item.id ? 'page' : undefined">
                {{ item.label }}<span v-if="item.id === 'problems'" class="count">{{ problems || "" }}</span>
            </RouterLink>
        </nav>
        <input :value="query" type="search" placeholder="Search" aria-label="Search" @input="search" />
        <div class="status-rail" aria-label="Network status">
            <span class="summary">
                <span v-for="item in summary" :key="item.text" :class="['summary-item', item.state]">{{ item.text }}</span>
            </span>
            <span :class="['live', { on: store.live === 'live', beat: store.beat }]" :title="LIVE[store.live]">{{
                store.live === "live" ? `${store.data?.project ?? ""} · live` : store.live
            }}</span>
        </div>
    </header>

    <pre v-if="store.error" class="banner">{{
        store.data ? `Studio can't read the project. It shows the last version it could read:\n${store.error}` : store.error
    }}</pre>

    <!-- Each page fades in from the top; a project read again changes the same page in place. -->
    <main v-if="store.data">
        <RouterView v-slot="{ Component, route: shown }">
            <Transition name="enter" mode="out-in">
                <component :is="Component" v-if="shown.meta.whole" :key="placeOf(shown)" />
                <div v-else-if="Component" :key="placeOf(shown)" class="tables"><component :is="Component" /></div>
            </Transition>
        </RouterView>
    </main>
    <main v-else-if="!store.error" class="tables"><p class="muted">Reading the project…</p></main>
    <FieldNote />
</template>
