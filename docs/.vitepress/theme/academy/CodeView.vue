<script setup lang="ts">
// Code that a widget writes as the reader plays: a device file, a plan or a terminal, on the same navy ground as every code block.

import { computed } from "vue";

const props = withDefaults(
    defineProps<{
        code: string;
        /** `ts` for a Circuit file, `plan` for lines marked +, - and ~, `shell` for commands and what they print. */
        lang?: "ts" | "plan" | "shell" | "text";
        /** The file's name, shown on a tab above the code. */
        title?: string;
        /** Lines to mark as just changed, counted from 1. */
        highlight?: number[];
    }>(),
    { lang: "ts" }
);

type Token = { text: string; kind: string };

const KEYWORDS = new Set(["import", "from", "export", "default", "const", "as", "satisfies", "true", "false", "type"]);

/** A line of TypeScript, split into the parts its colours mark. */
function typescript(line: string): Token[] {
    const comment = line.indexOf("//");
    const code = comment >= 0 && !/"[^"]*\/\/[^"]*"/.test(line) ? line.slice(0, comment) : line;
    const rest = code === line ? "" : line.slice(comment);

    const tokens = code
        .split(/("[^"]*"|`[^`]*`|\b\d[\d_.]*\b|\b[A-Za-z_]\w*(?=\s*:)|\b[A-Za-z_]\w*(?=\()|\b[A-Za-z_]\w*\b)/)
        .filter(Boolean)
        .map((text, index, all) => {
            if (/^["`]/.test(text)) return { text, kind: "s" };
            if (/^\d/.test(text)) return { text, kind: "n" };
            if (KEYWORDS.has(text)) return { text, kind: "k" };
            if (/^\s*:/.test(all[index + 1] ?? "") && /^\w+$/.test(text)) return { text, kind: "p" };
            if (/^\(/.test(all[index + 1] ?? "")) return { text, kind: "f" };
            return { text, kind: "" };
        });

    return rest ? [...tokens, { text: rest, kind: "c" }] : tokens;
}

function plan(line: string): Token[] {
    const kind = { "+": "added", "-": "removed", "~": "changed" }[line[0] ?? ""];
    return [{ text: line, kind: kind ? `line-${kind}` : line.startsWith("#") ? "c" : "" }];
}

function shell(line: string): Token[] {
    return line.startsWith("$ ")
        ? [
              { text: "$ ", kind: "prompt" },
              { text: line.slice(2), kind: "cmd" },
          ]
        : [{ text: line, kind: "out" }];
}

const lines = computed(() =>
    props.code
        .replace(/\n$/, "")
        .split("\n")
        .map((line, index) => ({
            tokens:
                props.lang === "ts"
                    ? typescript(line)
                    : props.lang === "plan"
                      ? plan(line)
                      : props.lang === "shell"
                        ? shell(line)
                        : [{ text: line, kind: "" }],
            marked: props.highlight?.includes(index + 1),
            kind: props.lang === "plan" ? ({ "+": "added", "-": "removed", "~": "changed" }[line[0] ?? ""] ?? "") : "",
        }))
);
</script>

<template>
    <figure class="code-view">
        <figcaption v-if="title">{{ title }}</figcaption>
        <pre><code><span v-for="(line, row) in lines" :key="row" class="line" :class="[line.kind, { marked: line.marked }]"><span v-for="(token, index) in line.tokens" :key="index" :class="token.kind">{{ token.text }}</span>{{ "\n" }}</span></code></pre>
    </figure>
</template>

<style scoped>
.code-view {
    /* Long lines scroll inside the code, and never widen the widget around it. */
    contain: inline-size;
    margin: 16px 0;
    background: var(--circuit-navy);
    color: #e6ecfa;
}

.dark .code-view {
    background: #060c1a;
    box-shadow: inset 0 0 0 1px var(--circuit-line);
}

figcaption {
    padding: 8px 16px;
    border-bottom: 1px solid #1f3561;
    color: #9db3e0;
    font: 600 13px/1.4 var(--circuit-mono);
}

pre {
    margin: 0;
    padding: 14px 0;
    overflow-x: auto;
    background: none;
    font: 13.5px/1.6 var(--circuit-mono);
}

code {
    display: block;
    min-width: max-content;
    padding: 0;
    background: none;
    color: inherit;
    font: inherit;
}

.line {
    display: block;
    padding: 0 16px;
    transition: background-color 0.3s;
}

.line.marked {
    background: rgba(248, 227, 71, 0.16);
    box-shadow: inset 3px 0 0 var(--circuit-yellow);
}

.line.added {
    background: rgba(95, 211, 143, 0.14);
    color: #8ff0b6;
}

.line.removed {
    background: rgba(255, 128, 134, 0.14);
    color: #ffadb1;
}

.line.changed {
    background: rgba(248, 227, 71, 0.14);
    color: #fff3a6;
}

.k {
    color: #ff9db0;
}

.f {
    color: #8fc2ff;
}

.p {
    color: #c9d7f5;
}

.s {
    color: #f8e347;
}

.n {
    color: #ffb36b;
}

.c {
    color: #8193b8;
}

.prompt {
    color: var(--circuit-yellow);
}

.cmd {
    color: #ffffff;
}

.out {
    color: #b9c7e6;
}
</style>
