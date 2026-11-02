<script setup lang="ts">
// The install command, one tab per system. The tab open first is the visitor's own system, once the page is in the browser.

import { onMounted, ref } from "vue";
import { Install, type System } from "../install";

const systems = Install.SYSTEMS;
const chosen = ref<System>("unix");
const copied = ref(false);

onMounted(() => (chosen.value = Install.detect()));

const current = () => systems.find((system) => system.id === chosen.value)!;

async function copy() {
    await navigator.clipboard.writeText(current().command);
    copied.value = true;
    setTimeout(() => (copied.value = false), 1600);
}
</script>

<template>
    <div class="install-tabs">
        <div class="tabs" role="tablist" aria-label="Your system">
            <button
                v-for="system in systems"
                :key="system.id"
                type="button"
                role="tab"
                :aria-selected="chosen === system.id"
                @click="chosen = system.id"
            >
                {{ system.name }}
            </button>
        </div>
        <p class="where">In {{ current().shell }}:</p>
        <button type="button" class="command" :aria-label="`Copy ${current().command}`" @click="copy">
            <code>{{ current().command }}</code>
            <span class="copied" aria-live="polite">{{ copied ? "Copied" : "Copy" }}</span>
        </button>
    </div>
</template>

<style scoped>
.install-tabs {
    margin: 20px 0 24px;
}

.tabs {
    display: inline-flex;
    border: 2px solid var(--circuit-ink);
    border-radius: 2px;
}

.tabs button {
    padding: 6px 16px;
    color: var(--circuit-ink);
    font-weight: 700;
}

.tabs button + button {
    border-left: 2px solid var(--circuit-ink);
}

.tabs button[aria-selected="true"] {
    background: var(--circuit-yellow);
    color: #0a1a36;
}

.where {
    margin: 12px 0 6px;
    color: var(--circuit-soft);
    font-size: 15px;
}

.command {
    display: flex;
    gap: 16px;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 14px 20px;
    border-radius: 2px;
    background: var(--circuit-navy);
    color: #ffffff;
    text-align: left;
}

.command code {
    padding: 0;
    background: none;
    color: #ffffff;
    font-family: var(--circuit-mono);
    font-size: 15px;
    overflow-wrap: anywhere;
}

.copied {
    flex: none;
    color: var(--circuit-yellow);
    font-size: 13px;
    font-weight: 700;
}
</style>
