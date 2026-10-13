<script setup lang="ts">
// Lesson: project, an edge router. The reader makes the four decisions of the edge router template, sees the part of edge-01.ts each one writes, and what circuit validate says about the result.

import { computed, ref } from "vue";

type Verdict = "good" | "warn" | "bad";
type Choice = { id: string; label: string; verdict: Verdict; text: string };
type Decision = { id: "import" | "export" | "prefer" | "bgp"; question: string; choices: Choice[] };

const decisions: Decision[] = [
    {
        id: "import",
        question: "1. What do you take in from the transit?",
        choices: [
            {
                id: "sanity",
                label: "What passes SANITY, tagged",
                verdict: "good",
                text: "Routes that should never be on the internet are refused, and every other route is tagged as learned from the transit before it is accepted.",
            },
            {
                id: "all",
                label: "Everything it sends",
                verdict: "warn",
                text: "validate passes: the file is valid, and Circuit cannot know what you meant. But private ranges, routes longer than /24 and RPKI invalid routes would all reach your table.",
            },
            {
                id: "none",
                label: "Leave import out",
                verdict: "bad",
                text: "Without an import, every route from the transit is refused, so the session would bring nothing in. The template's own check in checks.ts catches it.",
            },
        ],
    },
    {
        id: "export",
        question: "2. What do you announce to the transit and the exchange?",
        choices: [
            {
                id: "ours",
                label: "Our two blocks, then reject the rest",
                verdict: "good",
                text: "Your neighbors learn your own space and nothing else, so no traffic between two other networks can come through you.",
            },
            {
                id: "all",
                label: "Everything we know",
                verdict: "bad",
                text: "A route leak: the transit's routes would go to the exchange, and the exchange's to the transit. exportsEndInReject stops it before it reaches the router.",
            },
            {
                id: "noreject",
                label: "Our two blocks, and stop there",
                verdict: "warn",
                text: "Circuit rejects a route no rule accepts, so this announces the same today. The check still wants the end written down, and diff and apply stop until it is.",
            },
        ],
    },
    {
        id: "prefer",
        question: "3. A network is reachable through both. Which way should its traffic go?",
        choices: [
            {
                id: "ix",
                label: "The exchange: local preference 200",
                verdict: "good",
                text: "Local preference is the first step of the comparison, so traffic to every network at the exchange takes the exchange, usually cheaper and closer than the transit.",
            },
            {
                id: "transit",
                label: "The transit: give it 200",
                verdict: "warn",
                text: "It works, but you pay the transit for traffic the exchange would carry for its fixed fee.",
            },
            {
                id: "same",
                label: "Leave both at 100",
                verdict: "warn",
                text: "Then the AS path length and the tie-break choose for you, not what each way costs. The exchange often wins on path length, but not always.",
            },
        ],
    },
    {
        id: "bgp",
        question: "4. Who may open a BGP connection to the router, on TCP port 179?",
        choices: [
            {
                id: "neighbors",
                label: "Only the neighbors' addresses",
                verdict: "good",
                text: "The input chain drops everything it does not allow, so only your three neighbors can reach port 179 at all.",
            },
            {
                id: "anyone",
                label: "Anyone",
                verdict: "warn",
                text: "Anyone on the internet could try to connect. A session still needs the right address and AS to come up, but the router has to deal with every attempt. Allowing only the neighbors costs one address set.",
            },
        ],
    },
];

const picked = ref<Record<Decision["id"], string | undefined>>({ import: undefined, export: undefined, prefer: undefined, bgp: undefined });

const choiceOf = (decision: Decision) => decision.choices.find((choice) => choice.id === picked.value[decision.id]);
const WORDS: Record<Verdict, string> = { good: "Sound", warn: "Think again", bad: "Breaks" };
const verdictOf = (decision: Decision) => choiceOf(decision)?.verdict ?? "";
const wordOf = (decision: Decision) => {
    const verdict = choiceOf(decision)?.verdict;
    return verdict ? WORDS[verdict] : "";
};

const decided = computed(() => decisions.filter((decision) => picked.value[decision.id]).length);

function pick(decision: Decision, choice: Choice) {
    picked.value = { ...picked.value, [decision.id]: choice.id };
}

function bestOfAll() {
    picked.value = { import: "sanity", export: "ours", prefer: "ix", bgp: "neighbors" };
}

const code = computed(() => {
    const { import: imported, export: exported, prefer, bgp } = picked.value;
    const transitPref = prefer === "transit" ? 200 : 100;
    const exchangePref = prefer === "ix" || prefer === undefined ? 200 : 100;

    const transitIn =
        imported === "all"
            ? `    "TRANSIT-IN": [{ set: { local_pref: ${transitPref} } }, { action: "accept" }],`
            : `    "TRANSIT-IN": [{ call: "SANITY" }, communities.tag("transit", 64510), { set: { local_pref: ${transitPref} } }, { action: "accept" }],`;

    const out =
        exported === "all"
            ? [`    OUT: [{ action: "accept" }],`]
            : exported === "noreject"
              ? [
                    `    OUT: [`,
                    '        ...OURS.map((prefix) => ({ description: `Announce ${prefix}`, match: { prefix }, action: "accept" as const })),',
                    `    ],`,
                ]
              : [
                    `    OUT: [`,
                    '        ...OURS.map((prefix) => ({ description: `Announce ${prefix}`, match: { prefix }, action: "accept" as const })),',
                    `        { description: "Nothing else leaves", action: "reject" },`,
                    `    ],`,
                ];

    const bgpRule =
        bgp === "anyone"
            ? `                { description: "BGP", match: { protocol: "tcp", dst_port: 179 }, action: "accept" },`
            : `                { description: "BGP", match: { protocol: "tcp", dst_port: 179, src_set: "bgp-neighbors" }, action: "accept" },`;

    return [
        "neighbors: {",
        "    transit: {",
        `        address: "203.0.113.1",`,
        "        remote_as: 64510,",
        `        role: "provider",`,
        ...(imported === "none" ? [] : [`        import: "TRANSIT-IN",`]),
        `        export: "OUT",`,
        "        max_prefixes: 1_200_000,",
        "    },",
        `    // ix-rs-v4 and ix-rs-v6 alike, with import: "IX-IN"`,
        "},",
        "",
        "policies: {",
        "    SANITY: bgpSanity(),",
        transitIn,
        `    "IX-IN": [{ call: "SANITY" }, communities.tag("exchange", 64511), { set: { local_pref: ${exchangePref} } }, { action: "accept" }],`,
        ...out,
        "},",
        "",
        "firewall: {",
        `    address_sets: { "bgp-neighbors": ["203.0.113.1", "192.0.2.1", "2001:db8:ffff::1"] },`,
        "    filter: {",
        "        input: {",
        `            default: "drop",`,
        "            rules: [",
        "                // Replies, ping and the management network come first.",
        bgpRule,
        "            ],",
        "        },",
        "    },",
        "},",
    ].join("\n");
});

/** What circuit validate printed for each combination, run on the template with these choices. */
const validate = computed(() => {
    const { import: imported, export: exported } = picked.value;
    const exportErrors = exported === "all" || exported === "noreject";
    const lines: string[] = [];

    if (exportErrors) {
        lines.push(
            "  error  edge-01: transit: export OUT does not end in an unconditional reject",
            "  error  edge-01: ix-rs-v4: export OUT does not end in an unconditional reject",
            "  error  edge-01: ix-rs-v6: export OUT does not end in an unconditional reject"
        );
    }
    if (imported === "none") lines.push("  error  edge-01: transit has no import policy");

    const output = lines.length ? [...lines, "", `${lines.length} error(s).`] : ["1 device(s), no errors."];
    return ["$ npx circuit validate", ...output].join("\n");
});

const passes = computed(() => picked.value.import !== "none" && picked.value.export !== "all" && picked.value.export !== "noreject");
const allGood = computed(() => decisions.every((decision) => choiceOf(decision)?.verdict === "good"));
</script>

<template>
    <div class="edge-decisions">
        <p class="progress">{{ decided }} of {{ decisions.length }} decided</p>

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
            <p v-if="choiceOf(decision)" class="ac-say" :class="verdictOf(decision)" :data-word="wordOf(decision)" aria-live="polite">
                {{ choiceOf(decision)?.text }}
            </p>
        </fieldset>

        <CodeView :code="code" title="edge-01.ts, the parts your choices write" />
        <CodeView :code="validate" lang="shell" title="Terminal" />

        <p v-if="decided < decisions.length" class="ac-say quiet" aria-live="polite">
            Make all four decisions. The file above already shows the template's own choice wherever you have not picked yet.
            <button type="button" class="ac-button small" @click="bestOfAll">Show the template's choices</button>
        </p>
        <p v-else-if="allGood" class="ac-say good" data-word="Ready" aria-live="polite">
            These are the template's choices. validate passes, so the next step is circuit diff.
        </p>
        <p v-else-if="passes" class="ac-say warn" aria-live="polite">
            validate passes, but not every choice is sound. A valid file is not always the network you meant.
        </p>
        <p v-else class="ac-say bad" data-word="Stopped" aria-live="polite">
            validate fails, so diff and apply stop until the errors are fixed.
        </p>
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
    margin: 0 0 14px;
    padding: 0 0 14px;
    border: 0;
    border-bottom: 1px solid var(--circuit-line);
    min-width: 0;
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

.quiet .ac-button {
    margin-left: 6px;
}
</style>
