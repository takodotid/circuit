<script setup lang="ts">
// Lesson: project, an internet exchange. The reader admits a new member to the exchange example from its application, picks its AS, address and port, then runs validate and diff. Every output is Circuit's own, from MemberJoin.ts.

import { computed, ref } from "vue";
import { RUNS } from "./MemberJoin";

type Verdict = "good" | "warn" | "bad";
type Choice = { id: string; label: string; verdict: Verdict; text: string };
type DecisionId = "asn" | "ipv4" | "port";
type Decision = { id: DecisionId; question: string; choices: Choice[] };

const LAN = [
    { address: "203.0.113.1", holder: "route server rs1, reserved" },
    { address: "203.0.113.2", holder: "route server rs2, reserved" },
    { address: "203.0.113.10", holder: "cloudflare, AS13335" },
    { address: "203.0.113.11", holder: "akamai, AS20940" },
    { address: "203.0.113.12", holder: "acme, AS65550" },
];

const decisions: Decision[] = [
    {
        id: "asn",
        question: "1. Its AS number",
        choices: [
            {
                id: "64501",
                label: "64501, from its application",
                verdict: "good",
                text: "The AS the member gave, and no other member has it.",
            },
            {
                id: "65550",
                label: "65550",
                verdict: "bad",
                text: "A slip of the keyboard: that is acme's AS. The route servers, set up from this list, would expect the wrong network on this member's session.",
            },
        ],
    },
    {
        id: "ipv4",
        question: "2. Its IPv4 address on the peering LAN, 203.0.113.0/24",
        choices: [
            { id: "203.0.113.13", label: "203.0.113.13", verdict: "good", text: "The next address no one has." },
            {
                id: "203.0.113.12",
                label: "203.0.113.12",
                verdict: "bad",
                text: "acme's. Two routers would answer for one address, and traffic meant for acme could reach the newcomer.",
            },
            {
                id: "203.0.113.1",
                label: "203.0.113.1",
                verdict: "bad",
                text: "Route server rs1 answers there. Every member's session with rs1 could end up at this member's router.",
            },
            {
                id: "198.51.100.13",
                label: "198.51.100.13",
                verdict: "bad",
                text: "Not on the peering LAN at all, so no other member could reach it directly.",
            },
        ],
    },
    {
        id: "port",
        question: "3. Its port on ix-sw-02",
        choices: [
            { id: "10g-2", label: "10g-2", verdict: "good", text: "Free: no member's file and no line in ix-sw-02.ts uses it." },
            {
                id: "10g-1",
                label: "10g-1",
                verdict: "bad",
                text: "acme's port. Two members cannot share one port: the newcomer's router would have nowhere to plug in, and acme's port would be described with the newcomer's name.",
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

const picked = ref<Record<DecisionId, string | undefined>>({ asn: undefined, ipv4: undefined, port: undefined });
const ran = ref(false);

const choiceOf = (decision: Decision) => decision.choices.find((choice) => choice.id === picked.value[decision.id]);
const WORDS: Record<Verdict, string> = { good: "Sound", warn: "Careful", bad: "Breaks" };

function pick(decision: Decision, choice: Choice) {
    picked.value = { ...picked.value, [decision.id]: choice.id };
    ran.value = false;
}

const decidedCount = computed(() => decisions.filter((decision) => picked.value[decision.id]).length);

const chosen = computed(() => ({
    asn: picked.value.asn ?? "64501",
    ipv4: picked.value.ipv4 ?? "203.0.113.13",
    port: picked.value.port ?? "10g-2",
}));

const file = computed(() =>
    [
        'import type { ExchangeMember } from "@takodotid/circuit/presets";',
        "",
        "export default {",
        '    name: "example",',
        `    asn: ${chosen.value.asn},`,
        `    ports: { "ix-sw-02": "${chosen.value.port}" },`,
        `    ipv4: "${chosen.value.ipv4}",`,
        '    ipv6: "2001:db8:ffff::13",',
        "} satisfies ExchangeMember;",
    ].join("\n")
);

const result = computed(() => RUNS[[chosen.value.asn, chosen.value.ipv4, chosen.value.port].join("|")]);

const terminal = computed(() => {
    if (!result.value) return "";

    const lines = ["$ npx circuit validate", result.value.validate];
    if (result.value.diff) lines.push("$ npx circuit diff", result.value.diff);
    return lines.join("\n");
});

const outcome = computed(() => {
    if (result.value?.validate.startsWith("error: merge")) {
        return {
            kind: "bad",
            word: "Stopped",
            text: "Circuit stops while reading the files: merge will not let a member's port replace the switch's own trunk, so nothing is checked or planned until it is fixed.",
        };
    }
    if (!result.value?.diff) {
        return {
            kind: "bad",
            word: "Stopped",
            text: "exchange.check found what clashes, in the member's own words. diff and apply stop until it is fixed.",
        };
    }
    return {
        kind: "good",
        word: "Ready",
        text: "One port, set up by the preset: the peering VLAN only, no spanning tree, no LLDP, and storm control at 1%. Nothing else on either switch changes.",
    };
});
</script>

<template>
    <div class="member-join">
        <div class="table-frame">
            <table class="ac-table">
                <thead>
                    <tr>
                        <th>Peering LAN address</th>
                        <th>Held by</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="entry in LAN" :key="entry.address" :class="{ lit: entry.address === chosen.ipv4 && ran }">
                        <td class="ac-mono">{{ entry.address }}</td>
                        <td>{{ entry.holder }}</td>
                    </tr>
                </tbody>
            </table>
        </div>
        <p class="note">On ix-sw-02, acme has 10g-1 and akamai 40g-1, and 40g-5 is the trunk to ix-sw-01.</p>

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

        <CodeView :code="file" title="members/example.ts" />

        <div class="ac-row">
            <button type="button" class="ac-button primary" @click="ran = true">Run validate and diff</button>
            <span v-if="decidedCount < decisions.length" class="quiet">Where you have not picked, the file uses the sound choice.</span>
        </div>

        <template v-if="ran">
            <CodeView :code="terminal" lang="shell" title="Terminal" />
            <p class="ac-say" :class="outcome.kind" :data-word="outcome.word" aria-live="polite">{{ outcome.text }}</p>
        </template>
        <p v-else class="ac-say quiet" aria-live="polite">Make the three decisions, then run validate and diff.</p>
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
