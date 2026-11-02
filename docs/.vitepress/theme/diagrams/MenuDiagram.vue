<script setup lang="ts">
// The menu `circuit` opens alone, as it looks in a terminal: the same entries, in the same groups, as src/cli/index.ts lists them.

const entries = [
    { heading: "Core" },
    { label: "Validate", hint: "check every file of the project", lit: true },
    { label: "Diff", hint: "what apply would change on a device" },
    { label: "Apply", hint: "make a device match its config" },
    { heading: "Utilities" },
    { label: "Execute", hint: "run a command that only reads on a device" },
    { label: "BGP", hint: "each BGP session of a device" },
    { label: "Access console", hint: "a device's serial console" },
    { label: "Studio", hint: "the network in your browser" },
    { label: "Rename", hint: "give a device a new name everywhere" },
    { heading: "Secrets" },
    { label: "Secrets", hint: "list, set or delete the secrets in .env" },
    { heading: "Circuit" },
    { label: "Update Circuit" },
    { label: "Exit" },
];

const row = 26;
</script>

<template>
    <figure class="circuit-diagram">
        <svg :viewBox="`0 0 760 ${entries.length * row + 90}`" role="img" aria-labelledby="menu-title">
            <title id="menu-title">The menu circuit opens: Core, Utilities, Secrets and Circuit, each with its commands.</title>
            <rect x="0" y="0" width="760" :height="entries.length * row + 90" class="code-box" />
            <text x="24" y="34" class="code-dim">┌ Circuit 1.0.0</text>
            <text x="24" y="60" class="code">◆ What do you want to do?</text>
            <g v-for="(entry, index) in entries" :key="index" :transform="`translate(0, ${index * row + 86})`">
                <text v-if="entry.heading" x="24" y="0" class="code-dim">│ ── {{ entry.heading }} ──</text>
                <template v-else>
                    <text x="24" y="0" :class="entry.lit ? 'code-lit' : 'code'">│ {{ entry.lit ? "●" : "○" }} {{ entry.label }}</text>
                    <text v-if="entry.hint" x="290" y="0" class="code-dim">{{ entry.hint }}</text>
                </template>
            </g>
        </svg>
    </figure>
</template>
