<script setup lang="ts">
// Lesson: running it day to day. The reader reviews three pull requests against the colocation example, asks a reviewer's questions of each, and approves or asks for changes. Every validate and diff output is Circuit's own, run on the template; diff compares against the template's build, which stands in for the device.

import { computed, ref } from "vue";

type Question = "ci" | "scope" | "who" | "undo";
type Pull = {
    title: string;
    request: string;
    file: string;
    change: string;
    highlight: number[];
    ci: string;
    plan: string;
    answers: Record<Question, string>;
    approve: boolean;
    verdict: { approve: string; changes: string };
};

const QUESTIONS: { id: Question; label: string }[] = [
    { id: "ci", label: "Does validate pass?" },
    { id: "scope", label: "Does the plan do only what was asked?" },
    { id: "who", label: "Who notices, and when?" },
    { id: "undo", label: "How is it undone?" },
];

const pulls: Pull[] = [
    {
        title: "Give netflix a port for server 3",
        request: "netflix asked for a third server port, with the same networks as servers 1 and 2.",
        file: "tenants/netflix.ts",
        change: [
            "ethernet: {",
            '    "40g-1": { trunk_vlans: ["netflix-internet"] },',
            '    "10g-1": { description: "netflix server 1", trunk_vlans: ["netflix-internet", "netflix-private"] },',
            '    "10g-2": { description: "netflix server 2", trunk_vlans: ["netflix-internet", "netflix-private"] },',
            '    "10g-3": { description: "netflix server 3", trunk_vlans: ["netflix-internet", "netflix-private"] },',
            "},",
        ].join("\n"),
        highlight: [5],
        ci: "$ circuit validate\n✔ 2 device(s), no errors.",
        plan: [
            "$ circuit diff tor-01",
            "tor-01: 7 command(s) in 1 step(s)",
            "  interface 10GE1/0/3",
            "    - shutdown",
            "    + description netflix server 3",
            "    + port link-type trunk",
            "    + undo port trunk allow-pass vlan 1",
            "    + port trunk allow-pass vlan 1001 2001",
        ].join("\n"),
        answers: {
            ci: "Yes: no errors.",
            scope: "Yes. One port, 10GE1/0/3, stops being shut down and carries netflix's VLANs 1001 and 2001. The router has nothing to change.",
            who: "Only netflix, whose new server comes up. Nothing else on the switch is touched, so it can go out in the next window.",
            undo: "Revert the commit and apply: the plan shuts the port again.",
        },
        approve: true,
        verdict: {
            approve: "Right: the plan is one port, the one netflix asked for, and nothing else moves.",
            changes: "There is nothing to change here. The plan touches one free port and only netflix's VLANs.",
        },
    },
    {
        title: "First server for akamai",
        request: "A new tenant, akamai, with one server on its public network.",
        file: "tenants/akamai.ts",
        change: [
            '"tor-01": part("device", {',
            '    switching: { vlans: { "akamai-internet": vlans["akamai-internet"] } },',
            "    interfaces: {",
            "        ethernet: {",
            '            "40g-1": { trunk_vlans: ["akamai-internet"] },',
            '            "10g-1": { description: "akamai server 1", access_vlan: "akamai-internet" },',
            "        },",
            "    },",
            "}),",
        ].join("\n"),
        highlight: [6],
        ci: '$ circuit validate\ntenants/index.ts:4: merge: parts.tor-01.interfaces.ethernet.10g-1.description is written twice with two values: "netflix server 1" in tenants/netflix.ts:24, and "akamai server 1" in tenants/akamai.ts:17. One name holds one value: rename one, or make both the same.\n\n1 error(s).',
        plan: '$ circuit diff tor-01\ntenants/index.ts:4: merge: parts.tor-01.interfaces.ethernet.10g-1.description is written twice with two values: "netflix server 1" in tenants/netflix.ts:24, and "akamai server 1" in tenants/akamai.ts:17. One name holds one value: rename one, or make both the same.\n\n1 error(s).',
        answers: {
            ci: "No. Circuit stops while reading the files: netflix's file and akamai's both write port 10g-1 on tor-01, with two descriptions. It is netflix server 1's port.",
            scope: "There is no plan yet: an error stops diff and apply. Had it gone out, 10GE1/0/1 would have lost netflix's VLANs, and netflix server 1 its networks.",
            who: "Nobody, until it is fixed. Nothing can reach a device while validate fails.",
            undo: "Nothing to undo. Ask for a free port for akamai, such as 10g-3.",
        },
        approve: false,
        verdict: {
            approve: "validate fails: 10g-1 is netflix server 1's port. Approving it would only leave a change that cannot be applied.",
            changes:
                "Right. Circuit caught a port written by two tenants before anyone had to read a plan: ask for a free port, such as 10g-3.",
        },
    },
    {
        title: "SNMP for the new monitoring server",
        request: "Let the monitoring server at 10.0.0.20 poll edge-01 over SNMP version 3.",
        file: "sites/dc-1/edge-01.ts",
        change: [
            "snmp: {",
            '    allow: ["10.0.0.20/32"],',
            "    users: {",
            "        monitor: {",
            '            auth: "sha256",',
            '            auth_password: secret("EDGE_01_SNMP_AUTH"),',
            '            privacy: "aes128",',
            '            privacy_password: secret("EDGE_01_SNMP_PRIVACY"),',
            "        },",
            "    },",
            "},",
        ].join("\n"),
        highlight: [5],
        ci: [
            "$ circuit validate",
            "  error  edge-01: routeros cannot express monitoring.snmp.users.monitor.auth sha256, the platform authenticates with SHA1 or MD5",
            "",
            "1 error(s).",
        ].join("\n"),
        plan: [
            "$ circuit diff edge-01",
            "  error  edge-01: routeros cannot express monitoring.snmp.users.monitor.auth sha256, the platform authenticates with SHA1 or MD5",
            "",
            "1 error(s).",
        ].join("\n"),
        answers: {
            ci: "No. RouterOS, as Circuit writes it, cannot authenticate SNMP with SHA-256, and Circuit says so instead of quietly sending something else.",
            scope: "There is no plan yet: an error stops diff and apply.",
            who: "Nobody, until it is fixed. Nothing can reach a device while validate fails.",
            undo: "Nothing to undo. Ask for sha1, which the schema offers and the platform accepts.",
        },
        approve: false,
        verdict: {
            approve: "validate fails, so this cannot be applied as it is. Ask for the fix first.",
            changes: "Right. The check failed before anyone had to read a plan: ask for sha1.",
        },
    },
];

const current = ref(0);
const asked = ref<Question[][]>(pulls.map(() => []));
const decided = ref<(boolean | undefined)[]>(pulls.map(() => undefined));

const pull = computed(() => pulls[current.value]!);
const askedNow = computed(() => asked.value[current.value] ?? []);
const decision = computed(() => decided.value[current.value]);
const right = computed(() => decision.value !== undefined && decision.value === pull.value.approve);
const rightCount = computed(() => decided.value.filter((value, index) => value !== undefined && value === pulls[index]!.approve).length);

function ask(question: Question) {
    const list = asked.value[current.value]!;
    if (!list.includes(question)) list.push(question);
}

function decide(approve: boolean) {
    decided.value[current.value] = approve;
}

function go(index: number) {
    current.value = index;
}
</script>

<template>
    <div class="change-review">
        <div class="ac-row" role="group" aria-label="Pull requests">
            <button
                v-for="(entry, index) in pulls"
                :key="index"
                type="button"
                class="ac-button small"
                :aria-pressed="index === current"
                @click="go(index)"
            >
                #{{ index + 1 }}{{ decided[index] === undefined ? "" : decided[index] === entry.approve ? " reviewed" : " look again" }}
            </button>
        </div>

        <h4 class="title">#{{ current + 1 }}: {{ pull.title }}</h4>
        <p class="request"><strong>The request:</strong> {{ pull.request }}</p>

        <CodeView :code="pull.change" :title="pull.file" :highlight="pull.highlight" />
        <CodeView :code="pull.ci" lang="shell" title="CI: validate" />
        <CodeView :code="pull.plan" lang="shell" title="The plan the author pasted" />

        <fieldset class="questions">
            <legend>Ask what a reviewer asks</legend>
            <div class="ac-row">
                <button
                    v-for="question in QUESTIONS"
                    :key="question.id"
                    type="button"
                    class="ac-button small"
                    :aria-pressed="askedNow.includes(question.id)"
                    @click="ask(question.id)"
                >
                    {{ question.label }}
                </button>
            </div>
            <dl v-if="askedNow.length" class="answers">
                <template v-for="question in QUESTIONS" :key="question.id">
                    <template v-if="askedNow.includes(question.id)">
                        <dt>{{ question.label }}</dt>
                        <dd>{{ pull.answers[question.id] }}</dd>
                    </template>
                </template>
            </dl>
        </fieldset>

        <div class="ac-row decide">
            <button type="button" class="ac-button" :aria-pressed="decision === true" @click="decide(true)">Approve</button>
            <button type="button" class="ac-button" :aria-pressed="decision === false" @click="decide(false)">Request changes</button>
        </div>

        <p
            v-if="decision !== undefined"
            class="ac-say"
            :class="right ? 'good' : 'bad'"
            :data-word="right ? 'Good review' : 'Look again'"
            aria-live="polite"
        >
            {{ decision ? pull.verdict.approve : pull.verdict.changes }}
        </p>
        <p v-else class="ac-say hint" aria-live="polite">Read the request, the file and the plan, ask your questions, then decide.</p>

        <div class="ac-row next">
            <button v-if="right && current < pulls.length - 1" type="button" class="ac-button primary" @click="go(current + 1)">
                Next pull request
            </button>
            <span class="count">{{ rightCount }} of {{ pulls.length }} reviewed well</span>
        </div>
    </div>
</template>

<style scoped>
.title {
    margin: 14px 0 0 !important;
    font-size: 17px;
}

.request {
    margin: 6px 0 0;
}

.questions {
    min-width: 0;
    margin: 4px 0 0;
    padding: 0;
    border: 0;
}

legend {
    margin-bottom: 6px;
    padding: 0;
    color: var(--circuit-soft);
    font-size: 13px;
    font-weight: 600;
}

.questions .ac-button {
    white-space: normal;
    text-align: left;
}

.answers {
    margin: 12px 0 0;
}

.answers dt {
    font-weight: 700;
}

.answers dd {
    margin: 2px 0 10px;
}

.decide {
    margin-top: 12px;
}

.hint {
    color: var(--circuit-soft);
}

.next {
    margin-top: 12px;
}

.count {
    color: var(--circuit-soft);
    font-size: 14px;
    font-weight: 600;
}
</style>
