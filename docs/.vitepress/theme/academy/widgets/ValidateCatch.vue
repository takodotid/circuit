<script setup lang="ts">
// Lesson: writing a network down. The reader slips a mistake into a router's file and sees what `circuit validate` says about it, before anything is sent.

import { computed, ref } from "vue";
import { RouterFile } from "./PlanEditor";

type Mistake = {
    id: string;
    label: string;
    /** The line as it is, and as the mistake writes it. */
    from: string;
    to: string;
    /** What `circuit validate` printed for it, word for word. */
    error: string;
    /** Whether the editor already underlines it while typing, from the types Circuit gives each field. */
    typed: boolean;
    explain: string;
};

const mistakes: Mistake[] = [
    {
        id: "port",
        label: "A port the router does not have",
        from: '"25g-1": {',
        to: '"25g-13": {',
        error: "router: port 25g-13 does not exist on CCR2216-1G-12XS-2XQ",
        typed: true,
        explain:
            "This model has twelve 25G ports. Circuit knows every model's ports, so a port that is not there is an error, not a command the router refuses halfway through a change.",
    },
    {
        id: "user",
        label: "Log in as a user the file does not list",
        from: 'user: "operator"',
        to: 'user: "admin"',
        error: "router: connection user 'admin' is not one of its users",
        typed: true,
        explain:
            "Circuit logs in as one of the users in the file. A user the file does not list would be removed, so Circuit could not log in with it.",
    },
    {
        id: "length",
        label: "An address without its length",
        from: '["192.168.10.1/24"]',
        to: '["192.168.10.1"]',
        error: "router: port 25g-1: '192.168.10.1' is not an address with a length",
        typed: false,
        explain: "A port's address needs its prefix length, such as /24, so the router knows which addresses are on that network.",
    },
    {
        id: "gateway",
        label: "A gateway that is not an address",
        from: 'via: "203.0.113.1"',
        to: 'via: "203.0.113.300"',
        error: "router: static route 0.0.0.0/0: '203.0.113.300' is not an address",
        typed: false,
        explain:
            "Each part of an IPv4 address is 0 to 255, so 300 cannot be one. The editor sees only text here, and validate checks the address itself.",
    },
];

const chosen = ref<string>();
const mistake = computed(() => mistakes.find((entry) => entry.id === chosen.value));

const base = RouterFile.of({ describe: true, removeIntern: false, dns: false, drift: false }).text;

const file = computed(() => {
    if (!mistake.value) return { text: base, line: [] as number[] };

    const lines = base.split("\n");
    const index = lines.findIndex((line) => line.includes(mistake.value!.from));
    lines[index] = lines[index]!.replace(mistake.value.from, mistake.value.to);

    return { text: lines.join("\n"), line: [index + 1] };
});

const output = computed(() =>
    mistake.value
        ? `$ npx circuit validate\n  error  ${mistake.value.error}\n\n1 error(s).`
        : "$ npx circuit validate\n1 device(s), no errors."
);

function choose(id: string | undefined) {
    chosen.value = id;
}
</script>

<template>
    <div class="validate-catch">
        <div class="ac-field">
            <span>Slip a mistake into the file</span>
            <div class="ac-row">
                <button type="button" class="ac-button small" :aria-pressed="!chosen" @click="choose(undefined)">No mistake</button>
                <button
                    v-for="entry in mistakes"
                    :key="entry.id"
                    type="button"
                    class="ac-button small"
                    :aria-pressed="chosen === entry.id"
                    @click="choose(entry.id)"
                >
                    {{ entry.label }}
                </button>
            </div>
        </div>

        <CodeView :code="file.text" lang="ts" title="router.ts" :highlight="file.line" />
        <CodeView :code="output" lang="shell" title="Terminal" />

        <p v-if="mistake" class="ac-say bad" data-word="Not sent" aria-live="polite">
            {{ mistake.explain }}
            {{ mistake.typed ? "Your editor underlines this one as you type, too." : "Your editor cannot see this one; validate does." }}
            While there is an error, <span class="ac-mono">diff</span> and <span class="ac-mono">apply</span> refuse to run.
        </p>
        <p v-else class="ac-say hint" aria-live="polite">
            The file is fine, so validate finds no errors. Pick a mistake to make, and see what validate says.
        </p>
    </div>
</template>

<style scoped>
.validate-catch :deep(.code-view) {
    margin: 12px 0 0;
}

.hint {
    color: var(--circuit-soft);
}
</style>
