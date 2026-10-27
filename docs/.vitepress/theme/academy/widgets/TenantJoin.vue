<script setup lang="ts">
// Lesson: project, a colocation. The reader writes a second tenant's file for the colocation template, decision by decision, then runs validate and diff and reads what each device would get. Every output is Circuit's own, from TenantJoin.ts.

import { computed, ref } from "vue";
import { RUNS } from "./TenantJoin";

type Verdict = "good" | "warn" | "bad";
type Choice = { id: string; label: string; verdict: Verdict; text: string };
type DecisionId = "vlan" | "block" | "port" | "networks";
type Decision = { id: DecisionId; question: string; choices: Choice[] };

/** The router's address in each block, the gateway, written with the block's length. */
const GATEWAYS = { free: "198.51.100.17/29", overlap: "198.51.100.13/30" };
const VLANS = { "1002": { internet: 1002, private: 2002 }, "1001": { internet: 1001, private: 2001 } };

const decisions: Decision[] = [
    {
        id: "vlan",
        question: "1. Its VLAN IDs",
        choices: [
            {
                id: "1002",
                label: "1002 and 2002",
                verdict: "good",
                text: "No tenant uses them: 1002 for its public network, 2002 for a private one, if it gets one.",
            },
            {
                id: "1001",
                label: "1001 and 2001",
                verdict: "bad",
                text: "acme already uses them. Both tenants would be on VLAN 1001, and their traffic would mix on it.",
            },
        ],
    },
    {
        id: "block",
        question: "2. The router's address in its block, the gateway",
        choices: [
            {
                id: "free",
                label: GATEWAYS.free,
                verdict: "good",
                text: "circuit addresses lists 198.51.100.16/28 as free. The /29 from it is 8 addresses: the network address, the gateway .17, 5 for servers, and the broadcast address.",
            },
            {
                id: "overlap",
                label: GATEWAYS.overlap,
                verdict: "bad",
                text: "Its block, 198.51.100.12/30, lies inside acme's 198.51.100.8/29. Two tenants would answer for the same addresses.",
            },
        ],
    },
    {
        id: "port",
        question: "4. Its port on tor-01",
        choices: [
            { id: "10g-3", label: "10g-3", verdict: "good", text: "No tenant's file lists 10g-3, so it is free." },
            {
                id: "10g-1",
                label: "10g-1",
                verdict: "bad",
                text: "acme's file already gives 10g-1 to acme server 1. Given to two tenants, it would go to the last one alone, and acme server 1 would drop off the network.",
            },
        ],
    },
    {
        id: "networks",
        question: "5. What the port carries",
        choices: [
            {
                id: "internet",
                label: "Its public network",
                verdict: "good",
                text: "One network, untagged on the port, so the server needs no VLAN set up.",
            },
            {
                id: "both",
                label: "Public and private",
                verdict: "good",
                text: "Two tagged VLANs. The private one exists only on the switch, between globex's own servers, and never reaches the router.",
            },
        ],
    },
];

const picked = ref<Record<DecisionId, string | undefined>>({
    vlan: undefined,
    block: undefined,
    port: undefined,
    networks: undefined,
});
const ran = ref(false);

const choiceOf = (decision: Decision) => decision.choices.find((choice) => choice.id === picked.value[decision.id]);
const WORDS: Record<Verdict, string> = { good: "Sound", warn: "Careful", bad: "Breaks" };

function pick(decision: Decision, choice: Choice) {
    picked.value = { ...picked.value, [decision.id]: choice.id };
    ran.value = false;
}

const decidedCount = computed(() => decisions.filter((decision) => picked.value[decision.id]).length);

/** Each choice, or the sound one where the reader has not picked yet. */
const chosen = computed(() => ({
    vlan: (picked.value.vlan ?? "1002") as keyof typeof VLANS,
    block: (picked.value.block ?? "free") as keyof typeof GATEWAYS,
    port: picked.value.port ?? "10g-3",
    networks: picked.value.networks ?? "internet",
}));

const file = computed(() => {
    const ids = VLANS[chosen.value.vlan];
    const carries =
        chosen.value.networks === "both" ? 'trunk_vlans: ["globex-internet", "globex-private"]' : 'access_vlan: "globex-internet"';

    return [
        'import type { Tenant } from "../tenancy";',
        "",
        "export default {",
        '    name: "globex",',
        "    internet: {",
        `        vlan: { name: "globex-internet", id: ${ids.internet}, description: "Tenant globex internet" },`,
        `        gateways: ["${GATEWAYS[chosen.value.block]}", "2001:db8:100:2::1/64"],`,
        "    },",
        `    private: { vlan: { name: "globex-private", id: ${ids.private}, description: "Tenant globex private" } },`,
        "    ports: {",
        `        "tor-01": { "${chosen.value.port}": { description: "globex server 1", ${carries} } },`,
        "    },",
        "} satisfies Tenant;",
    ].join("\n");
});

const result = computed(() => {
    const key = [chosen.value.vlan, chosen.value.block, chosen.value.port, chosen.value.networks].join("|");
    return RUNS[key];
});

const terminal = computed(() => {
    if (!result.value) return "";

    const lines = ["$ npx circuit validate", result.value.validate];
    if (result.value.diff) lines.push("$ npx circuit diff", result.value.diff);
    return lines.join("\n");
});

const outcome = computed(() => {
    if (!result.value?.diff) {
        return {
            kind: "bad",
            word: "Stopped",
            text: "validate found errors, so diff and apply stop here. Each line says what clashes, in the words of the check that found it: change that choice and run again.",
        };
    }
    return {
        kind: "good",
        word: "Ready",
        text: "The router gets globex's VLAN and gateway, the switch gets the VLAN, the port, and the VLAN on its uplink. Nothing of acme's changes.",
    };
});
</script>

<template>
    <div class="tenant-join">
        <p class="progress">{{ decidedCount }} of {{ decisions.length }} decided</p>

        <fieldset v-for="decision in decisions" :key="decision.id" class="decision">
            <legend>{{ decision.question }}</legend>
            <div class="ac-row">
                <button
                    v-for="choice in decision.choices"
                    :key="choice.id"
                    type="button"
                    class="ac-button small"
                    :aria-pressed="picked[decision.id] === choice.id"
                    @click="pick(decision, choice)"
                >
                    {{ choice.label }}
                </button>
            </div>
            <p
                v-if="choiceOf(decision)"
                class="ac-say"
                :class="choiceOf(decision)?.verdict"
                :data-word="WORDS[choiceOf(decision)?.verdict ?? 'good']"
                aria-live="polite"
            >
                {{ choiceOf(decision)?.text }}
            </p>
        </fieldset>

        <CodeView :code="file" title="tenants/globex.ts" />

        <div class="ac-row">
            <button type="button" class="ac-button primary" @click="ran = true">Run validate and diff</button>
            <span v-if="decidedCount < decisions.length" class="quiet">Where you have not picked, the file uses the sound choice.</span>
        </div>

        <template v-if="ran">
            <CodeView :code="terminal" lang="shell" title="Terminal" />
            <p class="ac-say" :class="outcome.kind" :data-word="outcome.word" aria-live="polite">{{ outcome.text }}</p>
        </template>
        <p v-else class="ac-say quiet" aria-live="polite">Make the decisions, then run validate and diff to see what Circuit says.</p>
    </div>
</template>

<style scoped>
.progress {
    margin: 0 0 8px;
    color: var(--circuit-soft);
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
}

.decision {
    min-width: 0;
    margin: 0 0 14px;
    padding: 0 0 14px;
    border: 0;
    border-bottom: 1px solid var(--circuit-line);
}

legend {
    margin-bottom: 8px;
    padding: 0;
    font-weight: 700;
}

.decision .ac-button {
    white-space: normal;
    text-align: left;
}

.quiet {
    color: var(--circuit-soft);
}
</style>
