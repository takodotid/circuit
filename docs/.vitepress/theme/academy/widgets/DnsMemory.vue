<script setup lang="ts">
// Lesson: DNS. The reader looks up names through a resolver and moves a clock forward, and sees that an answer is remembered for its TTL and then looked up again.

import { computed, ref } from "vue";

type Name = { name: string; address: string; ttl: number };

const names: Name[] = [
    { name: "circuit.tako.id", address: "203.0.113.80", ttl: 300 },
    { name: "shop.example.com", address: "198.51.100.20", ttl: 60 },
    { name: "mail.example.org", address: "192.0.2.25", ttl: 3600 },
];

/** Rough times for the drawing of a lookup: to the resolver and back, and to one more server and back. */
const TO_RESOLVER_MS = 10;
const TO_SERVER_MS = 30;

const chosen = ref(names[0]!.name);
const clock = ref(0);
const memory = ref<{ name: string; address: string; forgetsAt: number }[]>([]);
const log = ref<{ at: number; text: string; remembered: boolean }[]>([]);
const said = ref<{ word: string; text: string }>();

const time = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const rest = String(seconds % 60).padStart(2, "0");
    return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
};

function lookUp() {
    const entry = names.find((name) => name.name === chosen.value)!;
    const remembered = memory.value.find((row) => row.name === entry.name);

    if (remembered) {
        const left = remembered.forgetsAt - clock.value;
        said.value = {
            word: "From memory",
            text: `The resolver still remembers ${entry.name}, for ${time(left)} more, so it answered at once: 1 question, about ${TO_RESOLVER_MS} ms.`,
        };
        log.value.unshift({
            at: clock.value,
            text: `${entry.name}: from memory, 1 question, about ${TO_RESOLVER_MS} ms`,
            remembered: true,
        });
    } else {
        const parts = entry.name.split(".");
        const top = parts[parts.length - 1];
        const domain = parts.slice(-2).join(".");
        const milliseconds = TO_RESOLVER_MS + 3 * TO_SERVER_MS;

        memory.value.push({ name: entry.name, address: entry.address, forgetsAt: clock.value + entry.ttl });
        said.value = {
            word: "Looked up",
            text: `The resolver did not remember ${entry.name}, so it asked a root server, the servers for .${top} and the servers for ${domain}: 4 questions, about ${milliseconds} ms. The answer, ${entry.address}, came with a TTL of ${entry.ttl} seconds, so it remembers it until ${time(clock.value + entry.ttl)}.`,
        };
        log.value.unshift({
            at: clock.value,
            text: `${entry.name}: asked root, .${top} and ${domain}, 4 questions, about ${milliseconds} ms`,
            remembered: false,
        });
    }

    log.value = log.value.slice(0, 6);
}

function wait(seconds: number) {
    clock.value += seconds;
    const forgotten = memory.value.filter((row) => row.forgetsAt <= clock.value).map((row) => row.name);
    memory.value = memory.value.filter((row) => row.forgetsAt > clock.value);

    said.value = {
        word: "Time passes",
        text: forgotten.length
            ? `It is now ${time(clock.value)}. The TTL of ${forgotten.join(" and ")} ran out, so the resolver forgot ${forgotten.length > 1 ? "them" : "it"}.`
            : `It is now ${time(clock.value)}. Nothing in the memory has run out yet.`,
    };
}

function restart() {
    clock.value = 0;
    memory.value = [];
    log.value = [];
    said.value = undefined;
}

const sortedMemory = computed(() => [...memory.value].sort((a, b) => a.forgetsAt - b.forgetsAt));
</script>

<template>
    <div class="dns-memory">
        <div class="top">
            <p class="clock">
                <span>Clock</span>
                <strong class="ac-mono">{{ time(clock) }}</strong>
            </p>
            <div class="ac-row">
                <button type="button" class="ac-button small" @click="wait(60)">Wait 1 minute</button>
                <button type="button" class="ac-button small" @click="wait(300)">Wait 5 minutes</button>
                <button type="button" class="ac-button small" :disabled="clock === 0 && log.length === 0" @click="restart">
                    Start over
                </button>
            </div>
        </div>

        <div class="ask">
            <label class="ac-field">
                <span>Name to look up</span>
                <select v-model="chosen" class="ac-select">
                    <option v-for="entry in names" :key="entry.name" :value="entry.name">{{ entry.name }}</option>
                </select>
            </label>
            <button type="button" class="ac-button primary" @click="lookUp">Look it up</button>
        </div>

        <p v-if="said" class="ac-say good" :data-word="said.word" aria-live="polite">{{ said.text }}</p>
        <p v-else class="ac-say hint" aria-live="polite">
            Look up circuit.tako.id, then look it up again. After that, wait 5 minutes and try a third time.
        </p>

        <div class="panels">
            <div>
                <p class="panel-title">The resolver’s memory</p>
                <div class="table-frame">
                    <table class="ac-table">
                        <thead>
                            <tr>
                                <th>Name</th>
                                <th>Address</th>
                                <th>Forgets in</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="row in sortedMemory" :key="row.name">
                                <td>{{ row.name }}</td>
                                <td class="ac-mono">{{ row.address }}</td>
                                <td class="ac-mono">{{ time(row.forgetsAt - clock) }}</td>
                            </tr>
                            <tr v-if="memory.length === 0">
                                <td colspan="3" class="quiet">Empty</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>

            <div>
                <p class="panel-title">Lookups, newest first</p>
                <ol v-if="log.length" class="log">
                    <li v-for="(entry, index) in log" :key="`${entry.at}-${index}-${entry.text}`" :class="{ remembered: entry.remembered }">
                        <span class="ac-mono at">{{ time(entry.at) }}</span>
                        {{ entry.text }}
                    </li>
                </ol>
                <p v-else class="quiet">None yet.</p>
            </div>
        </div>
    </div>
</template>

<style scoped>
.top {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
}

.clock {
    display: flex;
    align-items: baseline;
    gap: 10px;
    margin: 0 !important;
}

.clock span {
    color: var(--circuit-soft);
    font-size: 13px;
    font-weight: 600;
}

.clock strong {
    font-size: 22px;
}

.ask {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: 10px;
    margin-top: 14px;
}

.hint,
.quiet {
    color: var(--circuit-soft);
}

.panels {
    display: grid;
    grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr);
    gap: 18px;
    margin-top: 16px;
}

.panel-title {
    margin: 0 0 6px !important;
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.06em;
    font-stretch: 112%;
    text-transform: uppercase;
}

.table-frame {
    overflow-x: auto;
}

.table-frame .ac-table {
    display: table;
    margin-top: 0 !important;
    font-size: 13.5px;
}

.log {
    margin: 0 !important;
    padding: 0 !important;
    list-style: none;
    font-size: 13.5px;
    line-height: 1.45;
}

.log li {
    margin: 0 0 6px !important;
    padding-left: 8px;
    border-left: 3px solid var(--circuit-edge);
}

.log li.remembered {
    border-left-color: var(--circuit-added);
}

.at {
    display: block;
    color: var(--circuit-soft);
}

@media (max-width: 640px) {
    .panels {
        grid-template-columns: minmax(0, 1fr);
    }
}
</style>
