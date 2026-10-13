<script setup lang="ts">
// Lesson: attacks on the network. The reader sends small requests to a reflector with a forged source, sees the much larger replies land on the victim, then turns on source filtering in the sender's network.

import { computed, ref } from "vue";
import { useTravel } from "../travel";

const VICTIM = "198.51.100.10";
const ATTACKER = "203.0.113.50";
const NETWORK_S = "203.0.113.0/24";
const REQUESTS = 10;

type ServiceId = "dns" | "ntp" | "memcached";

/** Bandwidth amplification factors from the CISA alert on UDP-based amplification attacks, TA14-017A. */
const services: { id: ServiceId; label: string; port: number; low: number; high: number }[] = [
    { id: "dns", label: "An open DNS resolver", port: 53, low: 28, high: 54 },
    { id: "ntp", label: "An NTP server", port: 123, low: 556.9, high: 556.9 },
    { id: "memcached", label: "A memcached server", port: 11211, low: 10_000, high: 51_000 },
];

type Place = "attacker" | "edge" | "internet" | "reflector" | "yours" | "victim";

const points: Record<Place, [number, number]> = {
    attacker: [70, 90],
    edge: [230, 90],
    internet: [400, 170],
    reflector: [600, 90],
    yours: [400, 300],
    victim: [600, 300],
};

const service = ref<ServiceId>("ntp");
const source = ref<"own" | "victim">("victim");
const filtering = ref(false);
const said = ref<{ kind: "good" | "bad" | "warn"; word: string; text: string }>();
const lit = ref<Place[]>([]);

const chosen = computed(() => services.find((entry) => entry.id === service.value)!);

/** Mbit/s of replies, as a range when the factor is one. */
function amplified(): string {
    const { low, high } = chosen.value;
    const format = (mbits: number) =>
        mbits >= 1000 ? `${(mbits / 1000).toLocaleString("en-US", { maximumFractionDigits: 1 })} Gbit/s` : `${Math.round(mbits)} Mbit/s`;
    return low === high ? `about ${format(low * REQUESTS)}` : `${format(low * REQUESTS)} to ${format(high * REQUESTS)}`;
}

const sourceAddress = computed(() => (source.value === "own" ? ATTACKER : VICTIM));

const request = useTravel();
const reply = useTravel(320);

function reset() {
    said.value = undefined;
    lit.value = [];
}

async function attack() {
    said.value = undefined;

    if (filtering.value && source.value === "victim") {
        lit.value = ["attacker", "edge"];
        await request.travel([points.attacker, points.edge]);
        said.value = {
            kind: "bad",
            word: "Dropped",
            text: `Network S's edge router dropped the requests: their source, ${VICTIM}, is not inside ${NETWORK_S}, the only space its customers may send from. Nothing reached the reflector, and nothing reached the victim.`,
        };
        return;
    }

    lit.value = ["attacker", "edge", "internet", "reflector"];
    await request.travel([points.attacker, points.edge, points.internet, points.reflector]);

    if (source.value === "own") {
        lit.value = ["reflector", "internet", "edge", "attacker"];
        await reply.travel([points.reflector, points.internet, points.edge, points.attacker]);
        said.value = {
            kind: "warn",
            word: "Back to sender",
            text: `With its own address as the source, the replies, ${amplified()}, came back to the attacker's own link. That is why reflection needs a forged source.`,
        };
        return;
    }

    lit.value = ["reflector", "internet", "yours", "victim"];
    await reply.travel([points.reflector, points.internet, points.yours, points.victim]);
    said.value = {
        kind: "bad",
        word: "Flooded",
        text: `${chosen.value.label} answered ${VICTIM}, the source the requests carried. ${REQUESTS} Mbit/s of requests became ${amplified()} of replies from UDP port ${chosen.value.port}, and the attacker's address appears nowhere in them.`,
    };
}

const isLit = (a: Place, b: Place) => {
    const path = lit.value;
    return path.some((point, index) => index > 0 && ((path[index - 1] === a && point === b) || (path[index - 1] === b && point === a)));
};

const cables: [Place, Place][] = [
    ["attacker", "edge"],
    ["edge", "internet"],
    ["internet", "reflector"],
    ["internet", "yours"],
    ["yours", "victim"],
];

const busy = computed(() => request.travelling.value || reply.travelling.value);
</script>

<template>
    <div class="spoof-reflect">
        <svg
            class="ac-drawing"
            viewBox="0 0 700 380"
            role="img"
            aria-label="An attacker in Network S, behind that network's edge router, reaches a reflector and a victim across the internet. The victim sits in your network."
        >
            <line
                v-for="[a, b] in cables"
                :key="`${a}-${b}`"
                class="cable"
                :class="{ lit: isLit(a, b) }"
                :x1="points[a][0]"
                :y1="points[a][1]"
                :x2="points[b][0]"
                :y2="points[b][1]"
            />
            <SvgDevice kind="laptop" :x="points.attacker[0]" :y="points.attacker[1]" label="Attacker" :note="ATTACKER" />
            <SvgDevice
                kind="router"
                :x="points.edge[0]"
                :y="points.edge[1]"
                label="Network S edge"
                :note="filtering ? 'checks sources' : 'checks nothing'"
                :lit="filtering"
            />
            <SvgDevice kind="cloud" :x="points.internet[0]" :y="points.internet[1]" label="The internet" />
            <SvgDevice
                kind="server"
                :x="points.reflector[0]"
                :y="points.reflector[1]"
                label="Reflector"
                :note="`UDP port ${chosen.port}`"
            />
            <SvgDevice kind="router" :x="points.yours[0]" :y="points.yours[1]" label="Your edge" />
            <SvgDevice kind="server" :x="points.victim[0]" :y="points.victim[1]" label="Victim" :note="VICTIM" />

            <g v-if="request.travelling.value" class="small-packet">
                <circle class="packet" :cx="request.position.value[0]" :cy="request.position.value[1]" r="6" />
            </g>
            <circle v-if="reply.travelling.value" class="packet big" :cx="reply.position.value[0]" :cy="reply.position.value[1]" r="16" />
        </svg>

        <div class="controls">
            <label class="ac-field">
                <span>1. What the attacker asks</span>
                <select v-model="service" class="ac-select" @change="reset">
                    <option v-for="entry in services" :key="entry.id" :value="entry.id">
                        {{ entry.label }}, UDP port {{ entry.port }}
                    </option>
                </select>
            </label>

            <div class="ac-field">
                <span>2. Source address it writes on the requests</span>
                <div class="ac-row" role="group" aria-label="Source address on the requests">
                    <button type="button" class="ac-button small" :aria-pressed="source === 'own'" @click="((source = 'own'), reset())">
                        Its own, {{ ATTACKER }}
                    </button>
                    <button
                        type="button"
                        class="ac-button small"
                        :aria-pressed="source === 'victim'"
                        @click="((source = 'victim'), reset())"
                    >
                        The victim's, {{ VICTIM }}
                    </button>
                </div>
            </div>

            <div class="ac-field">
                <span>3. Network S's edge</span>
                <button type="button" class="ac-button small" :aria-pressed="filtering" @click="((filtering = !filtering), reset())">
                    Drop sources outside {{ NETWORK_S }}
                </button>
            </div>
        </div>

        <p class="volume">The attacker sends {{ REQUESTS }} Mbit/s of requests. {{ chosen.label }} answers with {{ amplified() }}.</p>

        <div class="ac-row">
            <button type="button" class="ac-button primary" :disabled="busy" @click="attack">Send the requests</button>
        </div>

        <p v-if="said" class="ac-say" :class="said.kind" :data-word="said.word" aria-live="polite">{{ said.text }}</p>
        <p v-else class="ac-say hint" aria-live="polite">
            Send the requests with the victim's address as the source. Then try the attacker's own address, and then turn on the check at
            Network S's edge.
        </p>
    </div>
</template>

<style scoped>
.ac-drawing .packet.big {
    stroke-width: 2;
}

.controls {
    display: grid;
    gap: 12px;
    margin-top: 10px;
}

.volume {
    margin: 14px 0 10px;
    font-size: 15px;
}

.hint {
    color: var(--circuit-soft);
}
</style>
