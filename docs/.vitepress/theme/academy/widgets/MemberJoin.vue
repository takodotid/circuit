<script setup lang="ts">
// Lesson: project, an internet exchange. The reader admits a new member to the exchange example from its application, picks its AS and its port, then runs validate and diff. Every output is Circuit's own, from MemberJoin.ts.

import { computed, ref } from "vue";
import { RUNS } from "./MemberJoin";

type Verdict = "good" | "warn" | "bad";
type Choice = { id: string; label: string; verdict: Verdict; text: string };
type DecisionId = "asn" | "port";
type Decision = { id: DecisionId; question: string; choices: Choice[] };

const MEMBERS = [
    { member: "cloudflare", asn: "AS64510", port: "ix-sw-01 40g-1" },
    { member: "google", asn: "AS64511", port: "ix-sw-02 40g-1" },
];

const decisions: Decision[] = [
    {
        id: "asn",
        question: "1. Its AS number",
        choices: [
            {
                id: "54113",
                label: "54113, from its application",
                verdict: "good",
                text: "The AS the member gave, and no other member has it.",
            },
            {
                id: "13335",
                label: "13335",
                verdict: "bad",
                text: "A slip of the keyboard: that is cloudflare's AS. Here it is only in the port's description, so Circuit cannot tell it is wrong, but the NOC would look up the wrong network. Check it against the application.",
            },
        ],
    },
    {
        id: "port",
        question: "2. Its port on ix-sw-02",
        choices: [
            { id: "10g-2", label: "10g-2", verdict: "good", text: "Free: no member's file and no line in ix-sw-02.ts uses it." },
            {
                id: "40g-1",
                label: "40g-1",
                verdict: "bad",
                text: "google's port. Two members cannot share one port: the newcomer's router would have nowhere to plug in.",
            },
            {
                id: "40g-5",
                label: "40g-5",
                verdict: "bad",
                text: "The trunk to ix-sw-01, which carries the whole peering LAN between the two switches.",
            },
        ],
    },
];

const picked = ref<Record<DecisionId, string | undefined>>({ asn: undefined, port: undefined });
const ran = ref(false);

const choiceOf = (decision: Decision) => decision.choices.find((choice) => choice.id === picked.value[decision.id]);
const WORDS: Record<Verdict, string> = { good: "Sound", warn: "Careful", bad: "Breaks" };

function pick(decision: Decision, choice: Choice) {
    picked.value = { ...picked.value, [decision.id]: choice.id };
    ran.value = false;
}

const decidedCount = computed(() => decisions.filter((decision) => picked.value[decision.id]).length);

const chosen = computed(() => ({
    asn: picked.value.asn ?? "54113",
    port: picked.value.port ?? "10g-2",
}));

const file = computed(() =>
    [
        'import { ix_1 } from "../sites/ix-1/site";',
        "",
        "export const fastly = {",
        "    parts: {",
        '        "ix-sw-02": part("device", {',
        `            interfaces: { ethernet: { "${chosen.value.port}": { ...ix_1.member_port, description: "fastly, AS${chosen.value.asn}" } } },`,
        "        }),",
        "    },",
        "};",
    ].join("\n")
);

const result = computed(() => RUNS[[chosen.value.asn, chosen.value.port].join("|")]);

const terminal = computed(() => {
    if (!result.value) return "";

    const lines = ["$ circuit validate", result.value.validate];
    if (result.value.diff) lines.push(result.value.diff);
    return lines.join("\n");
});

const outcome = computed(() => {
    if (!result.value?.diff) {
        return {
            kind: "bad",
            word: "Stopped",
            text: "Circuit stops while reading the files: two files give one port two descriptions, and it names both. Nothing is checked or planned until it is fixed.",
        };
    }
    return {
        kind: "good",
        word: "Ready",
        text: "One port, set up from the site's member_port: the peering VLAN only, no spanning tree, no LLDP, and storm control at 1%. Nothing else on the switch changes.",
    };
});
</script>

<template>
    <div class="member-join">
        <div class="table-frame">
            <table class="ac-table">
                <thead>
                    <tr>
                        <th>Member</th>
                        <th>AS</th>
                        <th>Port</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="entry in MEMBERS" :key="entry.member">
                        <td>{{ entry.member }}</td>
                        <td class="ac-mono">{{ entry.asn }}</td>
                        <td class="ac-mono">{{ entry.port }}</td>
                    </tr>
                </tbody>
            </table>
        </div>
        <p class="note">On ix-sw-02, google has 40g-1, and 40g-5 is the trunk to ix-sw-01.</p>

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

        <CodeView :code="file" title="members/fastly.ts" />

        <div class="ac-row">
            <button type="button" class="ac-button primary" @click="ran = true">Run validate and diff</button>
            <span v-if="decidedCount < decisions.length" class="quiet">Where you have not picked, the file uses the sound choice.</span>
        </div>

        <template v-if="ran">
            <CodeView :code="terminal" lang="shell" title="Terminal" />
            <p class="ac-say" :class="outcome.kind" :data-word="outcome.word" aria-live="polite">{{ outcome.text }}</p>
        </template>
        <p v-else class="ac-say quiet" aria-live="polite">Make the two decisions, then run validate and diff.</p>
    </div>
</template>

<style scoped>
.table-frame {
    overflow-x: auto;
}

.note {
    margin: 8px 0 14px;
    color: var(--circuit-soft);
    font-size: 14px;
}

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
