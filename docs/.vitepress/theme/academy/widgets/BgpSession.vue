<script setup lang="ts">
// Lesson: BGP. The reader writes the BGP neighbor for a transit provider in Circuit, then brings the session up and sees each stage pass or fail because of what they wrote.

import { computed, ref } from "vue";
import { Ipv6 } from "./Ipv6Shorten";

const OURS = { as: 64500, address: "203.0.113.2", routerId: "203.0.113.2" };
const THEIRS = { as: 64501, address: "203.0.113.1", routerId: "192.0.2.1" };

const address = ref("203.0.113.1");
const remoteAs = ref("");
const importPolicy = ref(false);
const exportPolicy = ref(false);
const maxPrefixes = ref<"" | "10" | "1200000">("");
const sends = ref<"full" | "default">("full");

/** What the provider announces, and how many routes that is. */
const offered = computed(() =>
    sends.value === "full"
        ? { count: 1_000_000, text: "the full table, about a million routes" }
        : { count: 1, text: "only a default route, 0.0.0.0/0" }
);

/** Whether the text is an IPv4 or IPv6 address. */
function isAddress(text: string): boolean {
    if (text.includes(":")) return "groups" in Ipv6.parse(text);

    const parts = text.split(".");
    return parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

type Stage = { state: string; title: string; text: string; result: "ok" | "fail" | "stop" };

const tried = ref(false);

/** Each stage of bringing the session up, as far as it gets. */
const stages = computed<Stage[]>(() => {
    const list: Stage[] = [];
    const typedAs = remoteAs.value.trim();
    const wantedAs = Number(typedAs);
    const typedAddress = address.value.trim();

    // What `circuit validate` reports before anything is sent, in its own words.
    const errors = [
        ...(isAddress(typedAddress) ? [] : [`neighbor transit: '${typedAddress}' is not an address`]),
        ...(typedAs === "" ? ["neighbor transit has no remote_as"] : []),
    ];

    if (typedAs !== "" && !/^\d+$/.test(typedAs)) {
        list.push({
            state: "Idle",
            title: "Validate",
            text: "remote_as must be a number, such as 64501. Your editor marks anything else before you even run circuit validate.",
            result: "fail",
        });
        return list;
    }

    if (errors.length) {
        list.push({
            state: "Idle",
            title: "Validate",
            text: `circuit validate stops before anything reaches the router: ${errors.map((error) => `"error edge-01: ${error}"`).join(" and ")}.`,
            result: "fail",
        });
        return list;
    }

    if (typedAddress !== THEIRS.address) {
        list.push({
            state: "Active",
            title: "Connect",
            text: `Your router opens a TCP connection to ${typedAddress}, port 179. Nobody there answers, so the session stays in Active and keeps trying. The provider's router is at ${THEIRS.address}.`,
            result: "fail",
        });
        return list;
    }

    list.push({
        state: "Connect",
        title: "Connect",
        text: `Your router opens a TCP connection to ${THEIRS.address}, port 179, and the provider's router answers.`,
        result: "ok",
    });

    if (wantedAs !== THEIRS.as) {
        const own = wantedAs === OURS.as ? " That is your own AS, which would make this an internal session." : "";
        list.push({
            state: "OpenSent",
            title: "Open",
            text: `Each router sends an OPEN message with its AS number. The provider's says AS${THEIRS.as}, but remote_as says ${wantedAs}.${own} Your router sends a NOTIFICATION, bad peer AS, and closes the connection. It goes back to Idle and tries again later, with the same result.`,
            result: "fail",
        });
        return list;
    }

    list.push({
        state: "OpenConfirm",
        title: "Open",
        text: `Each router sends an OPEN: yours says AS${OURS.as} and router ID ${OURS.routerId}, the provider's says AS${THEIRS.as}. Both match what the other expects, and they agree on a hold time: the lower of the two they offer.`,
        result: "ok",
    });

    list.push({
        state: "Established",
        title: "Established",
        text: "Each sends a KEEPALIVE to say yes. The session is up. From now on, a keepalive goes every few seconds, and silence for the whole hold time means the session is down.",
        result: "ok",
    });

    const limit = Number(maxPrefixes.value);

    if (maxPrefixes.value && offered.value.count > limit) {
        list.push({
            state: "Idle",
            title: "Updates",
            text: `The provider starts sending ${offered.value.text}. After ${limit.toLocaleString("en-US")} routes, max_prefixes is passed, so your router closes the session. On RouterOS it stays closed until someone clears it by hand.`,
            result: "fail",
        });
        return list;
    }

    const accepted = importPolicy.value
        ? `TRANSIT-IN decides which of them to accept.`
        : "There is no import policy, and in Circuit that means nothing is accepted: the routing table gets none of them.";
    const announced = exportPolicy.value
        ? `TRANSIT-OUT announces ${"198.51.100.0/24"} to the provider.`
        : "There is no export policy, so you announce nothing, and nobody on the internet learns how to reach you.";

    list.push({
        state: "Established",
        title: "Updates",
        text: `The provider sends UPDATE messages with ${offered.value.text}. ${accepted} ${announced}`,
        result: importPolicy.value && exportPolicy.value ? "ok" : "stop",
    });

    return list;
});

const verdict = computed(() => {
    if (!tried.value) return undefined;

    const lastStage = stages.value[stages.value.length - 1]!;

    if (lastStage.result === "fail")
        return {
            kind: "bad",
            word: "Not up",
            text: `The session stops at ${lastStage.title.toLowerCase()}. Change the file and try again.`,
        };
    if (lastStage.result === "stop")
        return { kind: "warn", word: "Up, but", text: "The session is up, but routes do not flow both ways yet. Add the missing policy." };

    return {
        kind: "good",
        word: "Up",
        text: "The session is up, routes come in through TRANSIT-IN, and your block goes out through TRANSIT-OUT.",
    };
});

function connect() {
    tried.value = true;
}

const STATES = ["Idle", "Connect", "Active", "OpenSent", "OpenConfirm", "Established"];
const reached = computed(() => (tried.value ? stages.value[stages.value.length - 1]!.state : "Idle"));

const code = computed(() => {
    const lines = [
        "routing: {",
        '    router_id: "203.0.113.2",',
        "    bgp: {",
        "        asn: 64500,",
        '        networks: ["198.51.100.0/24"],',
        "        neighbors: {",
        "            transit: {",
        `                address: "${address.value.trim()}",`,
        remoteAs.value.trim() ? `                remote_as: ${remoteAs.value.trim()},` : "",
        '                role: "provider",',
        importPolicy.value ? '                import: "TRANSIT-IN",' : "",
        exportPolicy.value ? '                export: "TRANSIT-OUT",' : "",
        maxPrefixes.value ? `                max_prefixes: ${maxPrefixes.value === "10" ? "10" : "1_200_000"},` : "",
        "            },",
        "        },",
        "    },",
        "},",
    ];

    return lines.filter((line) => line !== "").join("\n");
});

function changed() {
    tried.value = false;
}
</script>

<template>
    <div class="bgp-session">
        <div class="ends">
            <p><strong>Your router</strong><br />AS{{ OURS.as }}, {{ OURS.address }}</p>
            <p><strong>Provider's router</strong><br />AS{{ THEIRS.as }}, {{ THEIRS.address }}</p>
        </div>

        <div class="form">
            <label class="ac-field">
                <span>address</span>
                <input v-model="address" class="ac-input mono" autocomplete="off" spellcheck="false" @input="changed" />
            </label>
            <label class="ac-field">
                <span>remote_as</span>
                <input
                    v-model="remoteAs"
                    class="ac-input mono"
                    inputmode="numeric"
                    autocomplete="off"
                    placeholder="the provider's AS"
                    @input="changed"
                />
            </label>
            <label class="ac-field">
                <span>max_prefixes</span>
                <select v-model="maxPrefixes" class="ac-select" @change="changed">
                    <option value="">none</option>
                    <option value="10">10</option>
                    <option value="1200000">1_200_000</option>
                </select>
            </label>
            <label class="ac-field">
                <span>The provider sends</span>
                <select v-model="sends" class="ac-select" @change="changed">
                    <option value="full">the full table</option>
                    <option value="default">only a default route</option>
                </select>
            </label>
        </div>

        <div class="ac-row toggles">
            <button type="button" class="ac-button small" :aria-pressed="importPolicy" @click="((importPolicy = !importPolicy), changed())">
                import: "TRANSIT-IN"
            </button>
            <button type="button" class="ac-button small" :aria-pressed="exportPolicy" @click="((exportPolicy = !exportPolicy), changed())">
                export: "TRANSIT-OUT"
            </button>
        </div>

        <CodeView :code="code" title="edge-01.ts, part of it" />

        <div class="ac-row">
            <button type="button" class="ac-button primary" @click="connect">Bring the session up</button>
        </div>

        <ol class="states" aria-label="Session states">
            <li v-for="state in STATES" :key="state" :class="{ now: state === reached }">{{ state }}</li>
        </ol>

        <ol v-if="tried" class="stages">
            <li v-for="(stage, index) in stages" :key="index" :class="stage.result">
                <span class="mark">{{ stage.result === "ok" ? "Done" : stage.result === "stop" ? "Partly" : "Failed" }}</span>
                <strong>{{ stage.title }}.</strong> {{ stage.text }}
            </li>
        </ol>

        <p v-if="verdict" class="ac-say" :class="verdict.kind" :data-word="verdict.word" aria-live="polite">{{ verdict.text }}</p>
        <p v-else class="ac-say hint" aria-live="polite">
            Fill in the neighbor, then bring the session up. Start with remote_as empty to see what happens.
        </p>
    </div>
</template>

<style scoped>
.ends {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
}

.ends p {
    margin: 0;
    padding: 10px 12px;
    border: 2px solid var(--circuit-ink);
    font-size: 14.5px;
    line-height: 1.5;
}

.form {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 10px;
    margin-top: 14px;
}

.form .ac-field > span {
    font-family: var(--circuit-mono);
}

.form .ac-input {
    width: 100%;
}

.toggles {
    margin-top: 10px;
}

.toggles .ac-button {
    font-family: var(--circuit-mono);
    font-size: 13px;
}

.states {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin: 14px 0 0 !important;
    padding: 0 !important;
    list-style: none;
}

.states li {
    margin: 0 !important;
    padding: 2px 8px;
    border: 1.5px dashed var(--circuit-line);
    color: var(--circuit-soft);
    font-family: var(--circuit-mono);
    font-size: 13px;
}

.states li.now {
    border: 1.5px solid #0a1a36;
    background: var(--circuit-yellow);
    color: #0a1a36;
    font-weight: 700;
}

.stages {
    display: grid;
    gap: 8px;
    margin: 14px 0 0 !important;
    padding: 0 !important;
    list-style: none;
    font-size: 14.5px;
}

.stages li {
    margin: 0 !important;
    line-height: 1.55;
}

.mark {
    display: inline-block;
    min-width: 5em;
    margin-right: 6px;
    padding: 0 6px;
    background: var(--circuit-added);
    color: #ffffff;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.08em;
    line-height: 20px;
    text-align: center;
    text-transform: uppercase;
}

.dark .mark {
    color: #0a1a36;
}

.stop .mark {
    background: var(--circuit-warning);
    color: #ffffff;
}

.fail .mark {
    background: var(--circuit-removed);
}

.hint {
    color: var(--circuit-soft);
}

@media (max-width: 640px) {
    .ends {
        grid-template-columns: 1fr;
    }
}
</style>
