<script setup lang="ts">
// The menu `circuit` opens alone, as it looks in a terminal: the same entries, in the same groups, as src/cli/index.ts lists them.

const entries = [
    { heading: "Core" },
    { label: "Validate", hint: "check the whole project", lit: true },
    { label: "Diff", hint: "show what would change on a device" },
    { label: "Apply", hint: "make a device match its config" },
    { heading: "Utilities" },
    { label: "Execute", hint: "run read-only commands on a device" },
    { label: "BGP", hint: "show a device's BGP sessions" },
    { label: "Access console", hint: "open a device's serial console" },
    { label: "Communities", hint: "what each BGP community means" },
    { label: "Addresses", hint: "used and free address space" },
    { label: "Sync", hint: "update NetBox, LibreNMS, PeeringDB, or Prometheus" },
    { label: "Studio", hint: "open the project in your browser" },
    { label: "Rename", hint: "rename a device everywhere in the project" },
    { label: "Tidy files", hint: "fix spacing and line breaks" },
    { heading: "Secrets" },
    { label: "Secrets", hint: "edit the secrets in a text editor" },
    { heading: "Circuit" },
    { label: "Update Circuit" },
    { label: "Uninstall Circuit", hint: "your projects stay" },
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
