<script setup lang="ts">
// Lesson: addresses. The reader sends a letter in an envelope inside an envelope from a laptop through two routers to a server, one hop at a time, and sees which labels change.

import { computed, ref } from "vue";
import { useTravel } from "../travel";

type Stop = { id: string; kind: "laptop" | "router" | "server"; label: string; note?: string; x: number };

const stops: Stop[] = [
    { id: "laptop", kind: "laptop", label: "Laptop", note: "10.1.0.20", x: 60 },
    { id: "a", kind: "router", label: "Router A", x: 255 },
    { id: "b", kind: "router", label: "Router B", x: 450 },
    { id: "server", kind: "server", label: "Server", note: "10.3.0.50", x: 640 },
];

const Y = 70;

type Label = { who: string; address: string };

/** The outer envelope written for each hop: from the hardware address of the one sending it, to the hardware address of the next stop. */
const outers: { from: Label; to: Label }[] = [
    { from: { who: "Laptop", address: "3c:22:fb:0a:91:7e" }, to: { who: "Router A, left side", address: "00:1a:2b:3c:4d:01" } },
    {
        from: { who: "Router A, right side", address: "00:1a:2b:3c:4d:02" },
        to: { who: "Router B, left side", address: "00:5e:7f:11:22:01" },
    },
    { from: { who: "Router B, right side", address: "00:5e:7f:11:22:02" }, to: { who: "Server", address: "a4:5e:60:d1:33:08" } },
];

const inner = { from: "10.1.0.20", to: "10.3.0.50" };

/** How many hops the letter has made: 0 is still at the laptop, 3 is at the server. */
const hops = ref(0);
const { position, travelling, travel } = useTravel(220);

const done = computed(() => hops.value === outers.length);
const outer = computed(() => outers[Math.min(hops.value, outers.length - 1)]!);
const fresh = computed(() => hops.value > 0 && !done.value);

async function next() {
    if (done.value || travelling.value) return;

    await travel([
        [stops[hops.value]!.x, Y],
        [stops[hops.value + 1]!.x, Y],
    ]);
    hops.value++;
}

function again() {
    hops.value = 0;
}

const say = computed(() => {
    if (hops.value === 0)
        return "The laptop has put its letter for the server in an inner envelope with both IP addresses, and that in an outer envelope for the first stop, Router A. Press Send to the next stop.";
    if (done.value)
        return "The server opened the outer envelope, then the inner one, and read the letter. The outer envelope was new on every hop; the inner one never changed.";
    const router = stops[hops.value]!.label;
    const following = stops[hops.value + 1]!.label;
    return `${router} threw away the outer envelope, read the IP address on the inner one, and put it in a new outer envelope for the next stop, ${following}. The inner envelope is untouched.`;
});
</script>

<template>
    <div class="envelope-hops">
        <svg
            class="ac-drawing"
            viewBox="0 0 700 140"
            role="img"
            aria-label="A laptop, Router A, Router B and a server in a row, joined by three cables. The letter travels along them one hop at a time."
        >
            <line
                v-for="(stop, index) in stops.slice(1)"
                :key="stop.id"
                class="cable"
                :class="{ lit: index < hops }"
                :x1="stops[index]?.x"
                :y1="Y"
                :x2="stop.x"
                :y2="Y"
            />
            <SvgDevice
                v-for="(stop, index) in stops"
                :key="stop.id"
                :kind="stop.kind"
                :x="stop.x"
                :y="Y"
                :label="stop.label"
                :note="stop.note"
                :lit="!travelling && index === hops"
            />

            <circle v-if="travelling" class="packet" :cx="position[0]" :cy="position[1]" r="9" />
        </svg>

        <div class="envelope outer" :class="{ fresh, opened: done }">
            <p class="kind">
                Outer envelope: hardware addresses, for this hop only
                <span v-if="fresh" class="chip">New</span>
                <span v-if="done" class="chip">Opened</span>
            </p>
            <dl>
                <div>
                    <dt>From</dt>
                    <dd>
                        <span class="ac-mono">{{ outer.from.address }}</span> {{ outer.from.who }}
                    </dd>
                </div>
                <div>
                    <dt>To</dt>
                    <dd>
                        <span class="ac-mono">{{ outer.to.address }}</span> {{ outer.to.who }}
                    </dd>
                </div>
            </dl>

            <div class="envelope inner">
                <p class="kind">Inner envelope: IP addresses, for the whole way</p>
                <dl>
                    <div>
                        <dt>From</dt>
                        <dd>
                            <span class="ac-mono">{{ inner.from }}</span> Laptop
                        </dd>
                    </div>
                    <div>
                        <dt>To</dt>
                        <dd>
                            <span class="ac-mono">{{ inner.to }}</span> Server
                        </dd>
                    </div>
                </dl>
                <p class="letter">Letter: “Please send me today’s report.”</p>
            </div>
        </div>

        <div class="ac-row actions">
            <button v-if="!done" type="button" class="ac-button primary" :disabled="travelling" @click="next">Send to the next stop</button>
            <button v-else type="button" class="ac-button" @click="again">Start again</button>
        </div>

        <div v-if="hops" class="log">
            <p class="caption">The envelopes as they crossed each cable:</p>
            <table class="ac-table">
                <thead>
                    <tr>
                        <th>Cable</th>
                        <th>Outer: from → to</th>
                        <th>Inner: from → to</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="(crossed, index) in outers.slice(0, hops)" :key="index">
                        <td>{{ stops[index]?.label }} to {{ stops[index + 1]?.label }}</td>
                        <td class="ac-mono">{{ crossed.from.address }} → {{ crossed.to.address }}</td>
                        <td class="ac-mono">{{ inner.from }} → {{ inner.to }}</td>
                    </tr>
                </tbody>
            </table>
        </div>

        <p class="ac-say" :class="{ good: done, hint: !done }" aria-live="polite">{{ say }}</p>
    </div>
</template>

<style scoped>
.envelope {
    padding: 10px 14px 12px;
    border: 2px solid var(--circuit-ink);
    background: var(--circuit-paper);
    transition: background-color 0.3s;
}

.outer {
    margin-top: 8px;
}

.outer.fresh {
    background: var(--circuit-selected);
}

.outer.opened {
    border-style: dashed;
}

.inner {
    margin-top: 10px;
    border-width: 1.5px;
    background: var(--circuit-mist);
}

.kind {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 8px;
    margin: 0 0 6px;
    font-size: 13px;
    font-weight: 700;
}

.chip {
    padding: 0 6px;
    background: var(--circuit-ink);
    color: var(--circuit-paper);
    font-size: 11px;
    letter-spacing: 0.08em;
    line-height: 18px;
    text-transform: uppercase;
}

dl {
    display: grid;
    gap: 2px;
    margin: 0;
}

dl > div {
    display: flex;
    flex-wrap: wrap;
    gap: 0 10px;
}

dt {
    width: 40px;
    color: var(--circuit-soft);
    font-size: 13px;
    font-weight: 700;
}

dd {
    margin: 0;
    font-size: 14.5px;
}

dd .ac-mono {
    margin-right: 6px;
}

.letter {
    margin: 8px 0 0;
    font-size: 14.5px;
    font-style: italic;
}

.actions {
    margin-top: 14px;
}

.caption {
    margin: 18px 0 0;
    color: var(--circuit-soft);
    font-size: 14px;
}

.log {
    overflow-x: auto;
}

.ac-say.hint {
    color: var(--circuit-soft);
}

@media (prefers-reduced-motion: reduce) {
    .envelope {
        transition: none;
    }
}
</style>
