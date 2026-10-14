<script setup lang="ts">
// Lesson: route policies. The reader feeds routes from a transit through an import policy, sees which rule decides each, and turns rules off to see what slips through.

import { computed, ref } from "vue";

type Rpki = "valid" | "invalid" | "not-found";

type Incoming = {
    prefix: string;
    path: string;
    rpki: Rpki;
    note: string;
    /** What a careful policy does with it. */
    belongs: boolean;
};

const incoming: Incoming[] = [
    { prefix: "203.0.113.0/24", path: "64510 64505", rpki: "valid", note: "An ordinary route to another network.", belongs: true },
    {
        prefix: "10.20.0.0/16",
        path: "64510 64509",
        rpki: "not-found",
        note: "Private space, announced by someone by mistake.",
        belongs: false,
    },
    {
        prefix: "203.0.113.128/25",
        path: "64510 64505",
        rpki: "invalid",
        note: "Half of the first route. Most networks take nothing longer than a /24.",
        belongs: false,
    },
    {
        prefix: "198.51.100.0/24",
        path: "64510 64509",
        rpki: "not-found",
        note: "Your own space, announced by AS64509. You have not published a ROA for it yet.",
        belongs: false,
    },
    {
        prefix: "192.0.2.0/24",
        path: "64510 64507",
        rpki: "invalid",
        note: "Its ROA allows only AS64506, but AS64507 announces it.",
        belongs: false,
    },
    { prefix: "2001:db8:4000::/48", path: "64510 64505", rpki: "valid", note: "An ordinary IPv6 route.", belongs: true },
    {
        prefix: "169.254.0.0/16",
        path: "64510 64509",
        rpki: "not-found",
        note: "Link-local addresses, which never belong on the internet.",
        belongs: false,
    },
    { prefix: "2001:db8:4000:10::/64", path: "64510 64505", rpki: "invalid", note: "One LAN inside the IPv6 route above.", belongs: false },
    {
        prefix: "0.0.0.0/0",
        path: "64510",
        rpki: "not-found",
        note: "A default route, where the policy expects the full table.",
        belongs: false,
    },
];

/** An IPv4 prefix as a number and a length, or undefined for IPv6. */
function ipv4(prefix: string): { value: number; length: number } | undefined {
    const [address, length] = prefix.split("/");
    if (!address || address.includes(":")) return undefined;
    const value = address.split(".").reduce((sum, part) => sum * 256 + Number(part), 0);
    return { value, length: Number(length) };
}

const lengthOf = (prefix: string) => Number(prefix.split("/")[1]);
const isIpv6 = (prefix: string) => prefix.includes(":");

/** A route whose prefix is a set's own, or inside one. */
function inside(route: string, set: readonly string[]): boolean {
    const inner = ipv4(route);
    if (!inner) return false;

    return set.some((entry) => {
        const outer = ipv4(entry)!;
        if (inner.length < outer.length) return false;
        const size = 2 ** (32 - outer.length);
        return Math.floor(inner.value / size) === Math.floor(outer.value / size);
    });
}

const BOGONS = ["127.0.0.0/8", "169.254.0.0/16", "0.0.0.0/8", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"];
const OURS = ["198.51.100.0/24"];

/** The rules bgpSanity() makes, in its order. */
const sanity = [
    { label: "IPv4 shorter than /8", test: (route: Incoming) => !isIpv6(route.prefix) && lengthOf(route.prefix) < 8 },
    { label: "IPv4 longer than /24", test: (route: Incoming) => !isIpv6(route.prefix) && lengthOf(route.prefix) > 24 },
    { label: "IPv6 shorter than /16", test: (route: Incoming) => isIpv6(route.prefix) && lengthOf(route.prefix) < 16 },
    { label: "IPv6 longer than /48", test: (route: Incoming) => isIpv6(route.prefix) && lengthOf(route.prefix) > 48 },
    { label: "RPKI invalid", test: (route: Incoming) => route.rpki === "invalid" },
];

type RuleId = "sanity" | "bogons" | "ours" | "tag" | "pref" | "accept";

const rules: { id: RuleId; label: string; line: string; can: boolean }[] = [
    { id: "sanity", label: "Call SANITY", line: `        { call: "SANITY" },`, can: true },
    {
        id: "bogons",
        label: "Martians and private ranges",
        line: `        { description: "Martians and private ranges", match: { prefix_set: "bogons" }, action: "reject" },`,
        can: true,
    },
    {
        id: "ours",
        label: "Our own space, coming back",
        line: `        { description: "Our own space, coming back", match: { prefix_set: "ours" }, action: "reject" },`,
        can: true,
    },
    { id: "tag", label: "Tag where it came from", line: `        communities.tag("transit", 64510),`, can: false },
    { id: "pref", label: "Local preference 100", line: `        { set: { local_pref: 100 } },`, can: false },
    { id: "accept", label: "Accept", line: `        { action: "accept" },`, can: true },
];

const on = ref<Record<RuleId, boolean>>({ sanity: true, bogons: true, ours: true, tag: true, pref: true, accept: true });

type Decision = { accepted: boolean; rule?: RuleId; detail: string };

/** Runs one route through the policy, rule by rule, as Circuit evaluates it: the first accept or reject ends it. */
function decide(route: Incoming): Decision {
    for (const rule of rules) {
        if (!on.value[rule.id]) continue;

        if (rule.id === "sanity") {
            const hit = sanity.find((check) => check.test(route));
            if (hit) return { accepted: false, rule: "sanity", detail: `Rejected inside SANITY: ${hit.label}.` };
        }

        if (rule.id === "bogons" && inside(route.prefix, BOGONS))
            return { accepted: false, rule: "bogons", detail: "Rejected: it is inside the bogons set." };
        if (rule.id === "ours" && inside(route.prefix, OURS))
            return { accepted: false, rule: "ours", detail: "Rejected: it is inside your own space." };
        if (rule.id === "accept")
            return { accepted: true, rule: "accept", detail: "Accepted by the last rule, tagged and with local preference 100." };
    }

    return { accepted: false, detail: "No rule accepted it, so it is rejected." };
}

const shown = ref(0);
const results = computed(() => incoming.slice(0, shown.value).map((route) => ({ route, decision: decide(route) })));
const current = computed(() => results.value.at(-1));

const mistakes = computed(() => ({
    letIn: results.value.filter(({ route, decision }) => decision.accepted && !route.belongs).length,
    keptOut: results.value.filter(({ route, decision }) => !decision.accepted && route.belongs).length,
}));

function next() {
    if (shown.value < incoming.length) shown.value++;
}

function all() {
    shown.value = incoming.length;
}

function restart() {
    shown.value = 0;
    on.value = { sanity: true, bogons: true, ours: true, tag: true, pref: true, accept: true };
}

function toggle(id: RuleId) {
    on.value = { ...on.value, [id]: !on.value[id] };
}

const code = computed(() => {
    const lines = [
        "prefix_sets: {",
        "    bogons: { prefixes: [...MARTIANS, ...PRIVATE_RANGES] },",
        `    ours: { prefixes: ["198.51.100.0/24"] },`,
        "},",
        "",
        "policies: {",
        "    SANITY: bgpSanity(),",
        `    "TRANSIT-IN": [`,
    ];
    const lineOf: Partial<Record<RuleId, number>> = {};

    for (const rule of rules) {
        if (!on.value[rule.id]) continue;
        lines.push(rule.line);
        lineOf[rule.id] = lines.length;
    }

    lines.push("    ],", "},");
    return { text: lines.join("\n"), lineOf };
});

const highlight = computed(() => {
    const rule = current.value?.decision.rule;
    const line = rule ? code.value.lineOf[rule] : undefined;
    return line ? [line] : [];
});

const labelOf = (decision: Decision) => rules.find((rule) => rule.id === decision.rule)?.label ?? "No rule";

function verdictClass(route: Incoming, decision: Decision) {
    if (decision.accepted !== route.belongs) return "warn";
    return decision.accepted ? "good" : "bad";
}

function verdictWord(route: Incoming, decision: Decision) {
    if (decision.accepted !== route.belongs) return decision.accepted ? "Let in" : "Kept out";
    return decision.accepted ? "Accepted" : "Rejected";
}
</script>

<template>
    <div class="policy-filter">
        <div class="layout">
            <div>
                <p class="heading">TRANSIT-IN, read from the top</p>
                <ol class="rules">
                    <li
                        v-for="(rule, index) in rules"
                        :key="rule.id"
                        :class="{ off: !on[rule.id], hit: current && current.decision.rule === rule.id }"
                    >
                        <span class="number">{{ index + 1 }}</span>
                        <div class="body">
                            <p class="name">{{ rule.label }}</p>
                            <ul v-if="rule.id === 'sanity'" class="inner">
                                <li v-for="check in sanity" :key="check.label">{{ check.label }}: reject</li>
                            </ul>
                            <p v-else-if="!rule.can" class="quiet">Changes the route and moves on</p>
                        </div>
                        <button
                            v-if="rule.can"
                            type="button"
                            class="ac-button small"
                            :aria-pressed="on[rule.id]"
                            :aria-label="`${rule.label}: ${on[rule.id] ? 'on' : 'off'}`"
                            @click="toggle(rule.id)"
                        >
                            {{ on[rule.id] ? "On" : "Off" }}
                        </button>
                    </li>
                </ol>
            </div>

            <div>
                <p class="heading">Routes from Transit A, AS64510</p>
                <div v-if="current" class="card">
                    <p class="ac-mono prefix">{{ current.route.prefix }}</p>
                    <p class="quiet">
                        AS path <span class="ac-mono">{{ current.route.path }}</span
                        >, RPKI {{ current.route.rpki }}
                    </p>
                    <p>{{ current.route.note }}</p>
                </div>
                <p v-else class="card quiet">No route yet. Press Next route.</p>

                <div class="ac-row actions">
                    <button type="button" class="ac-button primary" :disabled="shown === incoming.length" @click="next">Next route</button>
                    <button type="button" class="ac-button" :disabled="shown === incoming.length" @click="all">All the rest</button>
                    <button type="button" class="ac-button" @click="restart">Start over</button>
                </div>

                <p
                    v-if="current"
                    class="ac-say"
                    :class="verdictClass(current.route, current.decision)"
                    :data-word="verdictWord(current.route, current.decision)"
                    aria-live="polite"
                >
                    {{ current.decision.detail }}
                    <template v-if="current.decision.accepted && !current.route.belongs">
                        It should not have been: turn the rule that caught it back on.</template
                    >
                    <template v-if="!current.decision.accepted && current.route.belongs"> It should have been accepted.</template>
                </p>
                <p v-else class="ac-say quiet" aria-live="polite">
                    Feed the routes in one at a time. Then turn a rule off and see what gets in.
                </p>
            </div>
        </div>

        <div v-if="results.length" class="table-frame">
            <table class="ac-table">
                <thead>
                    <tr>
                        <th>Route</th>
                        <th>Decided by</th>
                        <th>Result</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="{ route, decision } in results" :key="route.prefix" :class="{ lit: route === current?.route }">
                        <td class="ac-mono">{{ route.prefix }}</td>
                        <td>{{ labelOf(decision) }}</td>
                        <td>
                            {{ decision.accepted ? "Accepted" : "Rejected"
                            }}<strong v-if="decision.accepted !== route.belongs" class="wrong">, wrong</strong>
                        </td>
                    </tr>
                </tbody>
            </table>
            <p class="tally">Let in by mistake: {{ mistakes.letIn }}. Kept out by mistake: {{ mistakes.keptOut }}.</p>
        </div>

        <CodeView :code="code.text" title="edge-01.ts" :highlight="highlight" />
    </div>
</template>

<style scoped>
.layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 18px;
}

@media (max-width: 640px) {
    .layout {
        grid-template-columns: 1fr;
    }
}

.heading {
    margin: 0 0 8px;
    font-weight: 700;
}

.rules {
    display: grid;
    gap: 6px;
    margin: 0 !important;
    padding: 0 !important;
    list-style: none;
}

.rules > li {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    margin: 0 !important;
    padding: 8px 10px;
    border-left: 4px solid var(--circuit-line);
    transition:
        background-color 0.2s,
        opacity 0.2s;
}

.rules > li.hit {
    border-left-color: var(--circuit-yellow);
    background: var(--circuit-selected);
}

.rules > li.off {
    opacity: 0.5;
}

.rules > li.off .name {
    text-decoration: line-through;
}

.body {
    flex: 1;
    min-width: 0;
}

.body p {
    margin: 0;
    line-height: 1.45;
}

.name {
    font-weight: 700;
}

.inner {
    margin: 4px 0 0 !important;
    padding-left: 18px !important;
    font-size: 14px;
}

.inner li {
    margin: 0 !important;
}

.number {
    flex: none;
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: var(--circuit-cobalt);
    color: #ffffff;
    font-size: 12px;
    font-weight: 700;
}

.quiet {
    color: var(--circuit-soft);
    font-size: 14px;
}

.card {
    margin: 0;
    padding: 10px 12px;
    border: 1.5px solid var(--circuit-line);
}

.card p {
    margin: 0 0 4px;
}

.prefix {
    font-size: 17px !important;
    font-weight: 700;
}

.actions {
    margin-top: 12px;
}

.table-frame {
    margin-top: 16px;
    overflow-x: auto;
}

.wrong {
    color: var(--circuit-removed);
}

.tally {
    margin: 8px 0 0;
    font-size: 14.5px;
}
</style>
