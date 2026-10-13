<script setup lang="ts">
// Lesson: writing a network down. The reader edits a router's file with toggles, or changes the router by hand, and reads the plan Circuit makes.

import { computed, reactive } from "vue";
import { type Edits, planKey, plans, routerFile } from "./PlanEditor";

const edits = reactive<Edits>({ describe: false, removeIntern: false, dns: false, drift: false });

const fileEdits: { key: keyof Edits; label: string }[] = [
    { key: "describe", label: "Describe port 25g-1" },
    { key: "removeIntern", label: "Remove the intern's login" },
    { key: "dns", label: "Add a DNS server" },
];

const file = computed(() => routerFile(edits));

// The plan as `circuit diff` printed it, without the indent, so each line starts with its mark.
const plan = computed(() =>
    (plans[planKey(edits)] ?? "")
        .split("\n")
        .map((line) => line.trimStart())
        .join("\n")
);

const changesMade = computed(() => fileEdits.some((edit) => edits[edit.key]) || edits.drift);

/** What each part of the plan means, in words. */
const meanings = computed(() => {
    const said: string[] = [];

    if (edits.describe) {
        said.push(
            "~ Port 25g-1, which this router calls sfp28-1, gets the comment Office. The router keeps a description on the port's address too, so one line of the file became two commands."
        );
    }
    if (edits.drift) {
        said.push(
            "~ Port sfp28-5 is turned off again and its comment cleared. Someone turned it on by hand, but the file does not list port 25g-5, and a port the file leaves out is shut down."
        );
    }
    if (edits.dns) said.push("~ The router's DNS setting changes to ask 203.0.113.53.");
    if (edits.removeIntern) said.push("- The intern's login is removed, because the file no longer lists it.");

    return said;
});
</script>

<template>
    <div class="plan-editor">
        <div class="ac-field">
            <span>Change the file</span>
            <div class="ac-row">
                <button
                    v-for="edit in fileEdits"
                    :key="edit.key"
                    type="button"
                    class="ac-button small"
                    :aria-pressed="edits[edit.key]"
                    @click="edits[edit.key] = !edits[edit.key]"
                >
                    {{ edit.label }}
                </button>
            </div>
        </div>

        <div class="ac-field by-hand">
            <span>Or change the router without the file</span>
            <div class="ac-row">
                <button type="button" class="ac-button small" :aria-pressed="edits.drift" @click="edits.drift = !edits.drift">
                    Someone turns on port 25g-5 by hand
                </button>
            </div>
        </div>

        <div class="views">
            <CodeView :code="file.text" lang="ts" title="router.ts" :highlight="file.changed" />
            <CodeView :code="plan" lang="plan" title="npx circuit diff router" />
        </div>

        <div aria-live="polite">
            <template v-if="!changesMade">
                <p class="ac-say hint">
                    The router runs exactly what this file says, so the plan is empty: <span class="ac-mono">router: matches</span>. Change
                    the file with a button above, and read the plan again.
                </p>
            </template>
            <ul v-else class="meanings">
                <li v-for="line in meanings" :key="line">
                    <span class="mark" :class="line[0] === '-' ? 'removed' : 'changed'">{{ line[0] === "-" ? "Remove" : "Change" }}</span>
                    {{ line.slice(2) }}
                </li>
            </ul>
        </div>
    </div>
</template>

<style scoped>
.plan-editor {
    display: grid;
    gap: 14px;
}

.views {
    display: grid;
    gap: 0;
}

.views :deep(.code-view) {
    margin: 0 0 12px;
}

.hint {
    margin: 0;
    color: var(--circuit-soft);
}

.meanings {
    display: grid;
    gap: 8px;
    margin: 0 !important;
    padding: 0 !important;
    list-style: none;
}

.meanings li {
    margin: 0 !important;
    font-size: 15.5px;
    line-height: 1.55;
}

.mark {
    display: inline-block;
    margin-right: 8px;
    padding: 0 6px;
    color: #ffffff;
    font-size: 11px;
    font-weight: 700;
    font-stretch: 115%;
    letter-spacing: 0.08em;
    line-height: 20px;
    text-transform: uppercase;
    vertical-align: 1px;
}

.mark.changed {
    background: var(--circuit-cobalt);
}

.mark.removed {
    background: var(--circuit-removed);
}
</style>
