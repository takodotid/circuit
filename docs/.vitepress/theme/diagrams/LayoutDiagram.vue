<script setup lang="ts">
// A project's folder: each file on the editor's navy ground, with what it holds beside it, and which files git keeps.

const rows = [
    { file: "circuit.ts", note: "the network: its AS, sites and checks", git: "commit" },
    { file: "sites/site-1/site.ts", note: "what the site's devices share", git: "commit" },
    { file: "sites/site-1/edge-01.ts", note: "one device per file", git: "commit", lit: true },
    { file: "tenants/", note: "what each tenant adds to the devices", git: "commit" },
    { file: "lib/checks.ts", note: "your own checks", git: "commit" },
    { file: ".gitignore", note: "keeps .circuit/cache out of git", git: "commit" },
    { file: ".circuit/secrets", note: "the secrets, each one encrypted", git: "commit" },
    { file: ".circuit/version", note: "the Circuit version the project runs", git: "commit" },
    { file: ".circuit/types/", note: "the editor's types, written by Circuit", git: "commit" },
    { file: ".circuit/hooks/", note: "the check before each commit", git: "commit" },
    { file: "tsconfig.json", note: "points the editor at .circuit/types", git: "commit" },
];

const row = 34;
</script>

<template>
    <figure class="circuit-diagram">
        <svg :viewBox="`0 0 1000 ${rows.length * row + 40}`" role="img" aria-labelledby="layout-title">
            <title id="layout-title">The files of a project, what each holds, and that every one is committed.</title>
            <rect x="0" y="0" width="380" :height="rows.length * row + 40" class="code-box" />
            <g v-for="(entry, index) in rows" :key="entry.file" :transform="`translate(0, ${index * row + 34})`">
                <text x="24" y="0" :class="entry.lit ? 'code-lit' : entry.git === 'never' ? 'code-dim' : 'code'">{{ entry.file }}</text>
                <line x1="380" y1="-5" x2="410" y2="-5" class="arrow-dashed" />
                <text x="420" y="0" class="label">{{ entry.note }}</text>
                <rect
                    :class="entry.git === 'never' ? 'chip-red' : 'chip'"
                    x="840"
                    y="-15"
                    :width="entry.git === 'never' ? 140 : 84"
                    height="20"
                />
                <text x="848" y="0" class="chip-text">{{ entry.git === "never" ? "NEVER COMMITTED" : "COMMITTED" }}</text>
            </g>
        </svg>
    </figure>
</template>
