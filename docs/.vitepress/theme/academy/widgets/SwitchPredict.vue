<script setup lang="ts">
// Lesson: switches. The reader is the switch: for each frame, they read the address table and pick the ports the frame goes out of.

import { computed, ref } from "vue";
import { BROADCAST, hostById, hosts } from "./SwitchLearning";

type Round = {
    /** The devices the switch already knows, in the order it learned them. */
    known: string[];
    from: string;
    /** A device's id, or "everyone" for a broadcast. */
    to: string;
};

const rounds: Round[] = [
    { known: [], from: "laptop", to: "printer" },
    { known: ["laptop"], from: "printer", to: "laptop" },
    { known: ["laptop", "printer"], from: "camera", to: "server" },
    { known: ["laptop", "printer", "camera"], from: "desktop", to: "everyone" },
    { known: ["laptop", "printer", "camera", "desktop"], from: "server", to: "camera" },
];

const index = ref(0);
const round = computed(() => rounds[index.value]!);
const sender = computed(() => hostById(round.value.from));
const toMac = computed(() => (round.value.to === "everyone" ? BROADCAST : hostById(round.value.to).mac));
const table = computed(() => round.value.known.map((id) => hostById(id)));

/** The ports the switch really sends the frame out of. */
const answer = computed(() => {
    const entry = table.value.find((host) => host.mac === toMac.value);
    if (entry) return [entry.port];
    return hosts.filter((host) => host.port !== sender.value.port).map((host) => host.port);
});

const picked = ref<number[]>([]);
const result = ref<{ right: boolean; text: string }>();

function toggle(port: number) {
    if (result.value?.right) return;
    picked.value = picked.value.includes(port) ? picked.value.filter((entry) => entry !== port) : [...picked.value, port];
    result.value = undefined;
}

/** Why the right ports are right, in words. */
const reason = computed(() => {
    if (round.value.to === "everyone")
        return `The frame is for ${BROADCAST}, which means everyone, so it goes out of every port except port ${sender.value.port}, where it came in.`;

    const target = hostById(round.value.to);
    const entry = table.value.find((host) => host.mac === target.mac);
    if (entry) return `The table has ${target.mac} behind port ${entry.port}, so the frame goes out of port ${entry.port} only.`;

    return `The table has no row for ${target.mac}, so the switch floods: every port except port ${sender.value.port}, where it came in.`;
});

function check() {
    if (picked.value.length === 0) {
        result.value = { right: false, text: "Pick at least one port first. Every frame goes out of at least one." };
        return;
    }

    const right = picked.value.length === answer.value.length && answer.value.every((port) => picked.value.includes(port));
    const learned = `The switch also writes down that ${sender.value.mac} is behind port ${sender.value.port}.`;

    if (right) {
        result.value = { right: true, text: `${reason.value} ${learned}` };
        return;
    }

    if (picked.value.includes(sender.value.port)) {
        result.value = {
            right: false,
            text: `A switch never sends a frame back out of the port it came in on, here port ${sender.value.port}. Look again.`,
        };
        return;
    }

    const target = round.value.to === "everyone" ? undefined : hostById(round.value.to);
    const flooding = answer.value.length > 1 && round.value.to !== "everyone";
    if (target && flooding && picked.value.length === 1 && picked.value[0] === target.port) {
        result.value = {
            right: false,
            text: `You can see the ${target.label.toLowerCase()} is behind port ${target.port}, but the switch cannot: its table has no row for ${target.mac} yet. What does a switch do then?`,
        };
        return;
    }

    const missing = answer.value.filter((port) => !picked.value.includes(port)).length;
    const extra = picked.value.filter((port) => !answer.value.includes(port)).length;
    const parts = [
        missing ? `${missing} port${missing > 1 ? "s" : ""} missing` : "",
        extra ? `${extra} port${extra > 1 ? "s" : ""} too many` : "",
    ].filter(Boolean);
    result.value = { right: false, text: `Not quite: ${parts.join(" and ")}. Look for the receiver’s address in the table first.` };
}

function next() {
    index.value += 1;
    picked.value = [];
    result.value = undefined;
}

function restart() {
    index.value = 0;
    picked.value = [];
    result.value = undefined;
}

const finished = computed(() => index.value === rounds.length - 1 && result.value?.right);
</script>

<template>
    <div class="switch-predict">
        <p class="count">Frame {{ index + 1 }} of {{ rounds.length }}</p>

        <div class="layout">
            <div>
                <p class="panel-title">A frame arrives on port {{ sender.port }}</p>
                <dl class="frame">
                    <dt>To</dt>
                    <dd>
                        <span class="ac-mono">{{ toMac }}</span>
                    </dd>
                    <dt>From</dt>
                    <dd>
                        <span class="ac-mono">{{ sender.mac }}</span>
                    </dd>
                </dl>

                <p class="panel-title">The address table before it</p>
                <table class="ac-table">
                    <thead>
                        <tr>
                            <th>Hardware address</th>
                            <th>Port</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="host in table" :key="host.id" :class="{ lit: result?.right && host.mac === toMac }">
                            <td class="ac-mono">{{ host.mac }}</td>
                            <td>{{ host.port }}</td>
                        </tr>
                        <tr v-if="table.length === 0">
                            <td colspan="2" class="empty">Empty</td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <div>
                <p class="panel-title">Which ports does it go out of?</p>
                <div class="ports" role="group" aria-label="Switch ports">
                    <button
                        v-for="host in hosts"
                        :key="host.id"
                        type="button"
                        class="ac-button port"
                        :aria-pressed="picked.includes(host.port)"
                        :disabled="result?.right"
                        @click="toggle(host.port)"
                    >
                        <span class="number">Port {{ host.port }}</span>
                        <span class="plugged"
                            >{{ host.label }} <span class="ac-mono">{{ host.mac }}</span></span
                        >
                    </button>
                </div>

                <div class="ac-row actions">
                    <button v-if="!result?.right" type="button" class="ac-button primary" @click="check">Check</button>
                    <button v-else-if="!finished" type="button" class="ac-button primary" @click="next">Next frame</button>
                    <button v-else type="button" class="ac-button" @click="restart">Start over</button>
                </div>
            </div>
        </div>

        <p
            v-if="result"
            class="ac-say"
            :class="result.right ? 'good' : 'bad'"
            :data-word="result.right ? 'Right' : 'Not yet'"
            aria-live="polite"
        >
            {{ result.text }}
            <template v-if="finished"> That is all five: you switched every frame the way a switch does.</template>
        </p>
        <p v-else class="ac-say hint" aria-live="polite">
            You are the switch. Pick the ports this frame goes out of, then press Check. You can see which device is plugged into each port;
            the switch knows only what its table says.
        </p>
    </div>
</template>

<style scoped>
.count {
    margin: 0 0 10px !important;
    color: var(--circuit-soft);
    font-size: 12px;
    font-weight: 700;
    font-stretch: 115%;
    letter-spacing: 0.08em;
    text-transform: uppercase;
}

.layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 18px;
}

.panel-title {
    margin: 0 0 6px !important;
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.06em;
    font-stretch: 112%;
    text-transform: uppercase;
}

.frame {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 2px 12px;
    margin: 0 0 14px;
    padding: 8px 12px;
    border: 2px solid var(--circuit-ink);
    font-size: 14px;
}

.frame dt {
    font-weight: 700;
}

.frame dd {
    margin: 0;
    overflow-wrap: anywhere;
}

.ac-table {
    display: table;
    margin-top: 0 !important;
}

.empty {
    color: var(--circuit-soft);
}

.ports {
    display: grid;
    gap: 6px;
}

.port {
    justify-content: space-between;
    width: 100%;
    white-space: normal;
}

.port:disabled {
    opacity: 0.85;
}

.plugged {
    font-size: 13px;
    font-weight: 400;
    text-align: right;
}

.actions {
    margin-top: 12px;
}

.hint {
    color: var(--circuit-soft);
}

@media (max-width: 640px) {
    .layout {
        grid-template-columns: minmax(0, 1fr);
    }
}
</style>
