<script setup lang="ts">
// Lesson: opening a website. The reader steps through everything that happens between typing circuit.tako.id and seeing the page, with each message travelling the hops it really takes.

import { computed, ref } from "vue";
import { useTravel, type Point } from "../travel";
import { useNarrow, usePause } from "./SwitchLearning";

type Place = "laptop" | "home" | "provider" | "resolver" | "internet" | "site";
type Label = { x: number; y: number; anchor: "start" | "middle" | "end" };

const places: { id: Place; kind: "laptop" | "router" | "server" | "cloud"; label: string; note?: string }[] = [
    { id: "laptop", kind: "laptop", label: "Your laptop", note: "192.168.1.20" },
    { id: "home", kind: "router", label: "Home router", note: "192.168.1.1" },
    { id: "provider", kind: "router", label: "Your provider" },
    { id: "resolver", kind: "server", label: "DNS resolver", note: "198.51.100.53" },
    { id: "internet", kind: "cloud", label: "The internet" },
    { id: "site", kind: "server", label: "circuit.tako.id", note: "203.0.113.80" },
];

const cables: [Place, Place][] = [
    ["laptop", "home"],
    ["home", "provider"],
    ["provider", "resolver"],
    ["provider", "internet"],
    ["internet", "site"],
];

type Layout = {
    viewBox: string;
    at: Record<Place, Point>;
    /** Where each name is written; the note goes one line under it. */
    labels: Record<Place, Label>;
    home: { x: number; y: number; width: number; height: number; labelX: number; labelY: number; anchor: "start" | "end" };
};

const layouts: Record<"wide" | "narrow", Layout> = {
    wide: {
        viewBox: "0 0 700 310",
        at: { laptop: [60, 120], home: [190, 120], provider: [340, 120], resolver: [340, 245], internet: [490, 120], site: [630, 120] },
        labels: {
            laptop: { x: 60, y: 158, anchor: "middle" },
            home: { x: 190, y: 158, anchor: "middle" },
            provider: { x: 340, y: 86, anchor: "middle" },
            resolver: { x: 340, y: 283, anchor: "middle" },
            internet: { x: 490, y: 158, anchor: "middle" },
            site: { x: 630, y: 158, anchor: "middle" },
        },
        home: { x: 8, y: 62, width: 246, height: 134, labelX: 12, labelY: 54, anchor: "start" },
    },
    narrow: {
        viewBox: "0 0 360 510",
        at: { laptop: [70, 50], home: [70, 150], provider: [70, 262], resolver: [260, 262], internet: [70, 372], site: [70, 470] },
        labels: {
            laptop: { x: 112, y: 48, anchor: "start" },
            home: { x: 112, y: 148, anchor: "start" },
            provider: { x: 112, y: 248, anchor: "start" },
            resolver: { x: 260, y: 300, anchor: "middle" },
            internet: { x: 112, y: 376, anchor: "start" },
            site: { x: 112, y: 466, anchor: "start" },
        },
        home: { x: 6, y: 14, width: 348, height: 180, labelX: 346, labelY: 34, anchor: "end" },
    },
};

const narrow = useNarrow();
const layout = computed(() => layouts[narrow.value ? "narrow" : "wide"]);
const at = (id: Place) => layout.value.at[id];

const out: Place[] = ["laptop", "home", "provider", "internet", "site"];
const back: Place[] = [...out].reverse();

type Step = {
    title: string;
    text: string;
    /** The ways messages travel in this step, one after another. */
    legs: Place[][];
    /** How many packets travel each leg together, a little apart. */
    burst?: number;
    /** What to light when nothing travels. */
    lit?: Place[];
    card: { label: string; rows: [string, string][] };
    browser?: boolean;
};

const steps: Step[] = [
    {
        title: "What the laptop already knows",
        text: "Your laptop joined the home network earlier and was given its own address, the size of its network, a gateway and a DNS resolver to ask. How it got them is a lesson of the Elementary level; here they are simply there.",
        legs: [],
        lit: ["laptop"],
        card: {
            label: "The laptop’s settings",
            rows: [
                ["Address", "192.168.1.20/24"],
                ["Gateway", "192.168.1.1"],
                ["DNS resolver", "198.51.100.53"],
            ],
        },
    },
    {
        title: "You type the name",
        text: "You type circuit.tako.id and press Enter. To send anything, the browser needs an IP address, and neither the browser nor the laptop remembers one for this name.",
        legs: [],
        lit: ["laptop"],
        card: {
            label: "In the address bar",
            rows: [
                ["Name", "circuit.tako.id"],
                ["Address", "not known yet"],
            ],
        },
    },
    {
        title: "Ask the resolver",
        text: "198.51.100.53 is not on the home network, so the DNS question goes to the gateway, and from there to the provider. On the way out, the home router puts the home’s one public address, the one the internet knows it by, on it as the sender, and remembers to pass the reply back to your laptop. The Elementary level shows how.",
        legs: [["laptop", "home", "provider", "resolver"]],
        card: {
            label: "The question, as it leaves the laptop",
            rows: [
                ["From", "192.168.1.20, port 50731"],
                ["To", "198.51.100.53, port 53 (DNS, over UDP)"],
                ["Says", "What is the address of circuit.tako.id?"],
            ],
        },
    },
    {
        title: "The answer comes back",
        text: "The resolver does not remember the name, so it asks a root server, the servers for .id and the servers for tako.id, out on the internet, as in the DNS lesson. Then it answers the laptop, and both remember the answer.",
        legs: [
            ["resolver", "provider", "internet"],
            ["internet", "provider", "resolver"],
            ["resolver", "provider", "home", "laptop"],
        ],
        card: {
            label: "The answer, as it reaches the laptop",
            rows: [
                ["From", "198.51.100.53, port 53"],
                ["To", "192.168.1.20, port 50731"],
                ["Says", "circuit.tako.id is 203.0.113.80. Remember it for 300 seconds."],
            ],
        },
    },
    {
        title: "Near or far?",
        text: "The laptop compares 203.0.113.80 with its own network. The network parts differ, so every packet for the website goes to the gateway, inside a frame addressed to the home router’s hardware address.",
        legs: [],
        lit: ["laptop", "home"],
        card: {
            label: "The laptop decides",
            rows: [
                ["Website", "203.0.113.80"],
                ["My network", "192.168.1.0/24"],
                ["So", "send it to the gateway, 192.168.1.1"],
            ],
        },
    },
    {
        title: "The handshake on port 443",
        text: "The browser opens a TCP conversation with port 443, the locked web program, on 203.0.113.80. Three messages cross: hello?, hello!, ok. Every router on the way looks up the address in its routing table and lowers the TTL by one.",
        legs: [out, back, out],
        card: {
            label: "The first message",
            rows: [
                ["From", "192.168.1.20, port 50732"],
                ["To", "203.0.113.80, port 443 (HTTPS, over TCP)"],
                ["Says", "hello?"],
            ],
        },
    },
    {
        title: "Lock the conversation",
        text: "The browser and the server agree on a secret key that only the two of them know, and the server shows a certificate that proves it really is circuit.tako.id. From here on, everything they send is scrambled with the key. The routers on the way still pass it on, but cannot read it.",
        legs: [out, back],
        card: {
            label: "What anyone on the way sees",
            rows: [
                ["From", "192.168.1.20, port 50732"],
                ["To", "203.0.113.80, port 443"],
                ["Says", "x8#Qm!2vL0@r7... (locked)"],
            ],
        },
    },
    {
        title: "Ask for the page",
        text: "Inside the locked conversation, the browser asks for the page. Only the server can unlock and read the request.",
        legs: [out],
        card: {
            label: "The request, as the server reads it",
            rows: [
                ["Asks for", "the page at circuit.tako.id/"],
                ["Says also", "which browser this is, and which languages you read"],
            ],
        },
    },
    {
        title: "The page comes back in packets",
        text: "The page is too big for one packet, so it is cut into numbered pieces. They cross the same hops back, and TCP on the laptop puts them in order and has any lost piece sent again.",
        legs: [back],
        burst: 3,
        card: {
            label: "Coming back, again and again",
            rows: [
                ["From", "203.0.113.80, port 443"],
                ["To", "192.168.1.20, port 50732"],
                ["Carries", "the page, one numbered piece per packet, locked"],
            ],
        },
    },
    {
        title: "The browser draws the page",
        text: "The browser reads the page. It names more things to fetch, such as pictures and styles, which the browser asks for in the same way, often over the same conversation. Then it draws the page. The lock beside the name says the conversation is locked and the server proved its name.",
        legs: [],
        lit: ["laptop"],
        browser: true,
        card: { label: "On your screen", rows: [] },
    },
];

const index = ref(0);
const step = computed(() => steps[index.value]!);
const current = ref<Place[]>();

const packets = [useTravel(300), useTravel(300), useTravel(300)];
/** Which packets belong to the step on show; one left over from a step the reader moved away from is hidden. */
const shown = ref([false, false, false]);
const pause = usePause();

async function onStep(next: number) {
    index.value = next;
    current.value = undefined;
    shown.value = [false, false, false];

    const { legs, burst = 1 } = steps[next]!;

    for (const leg of legs) {
        if (index.value !== next) return;
        current.value = leg;
        const points = leg.map(at);

        await Promise.all(
            packets.slice(0, burst).map(async (packet, order) => {
                if (order) await pause(order * 260);
                if (index.value !== next) return;
                shown.value[order] = true;
                await packet.travel(points);
            })
        );
    }
}

const cableKey = (a: Place, b: Place) => [a, b].sort().join("-");

/** The cables any message of this step uses. */
const litCables = computed(() => {
    const keys = new Set<string>();
    for (const leg of step.value.legs) {
        for (let hop = 1; hop < leg.length; hop++) keys.add(cableKey(leg[hop - 1]!, leg[hop]!));
    }
    return keys;
});

const litPlaces = computed(() => {
    if (current.value) return [current.value[current.value.length - 1]!];
    if (step.value.lit) return step.value.lit;
    const legs = step.value.legs;
    const last = legs[legs.length - 1];
    return last ? [last[last.length - 1]!] : [];
});
</script>

<template>
    <div class="website-journey">
        <StepThrough :steps="steps" @change="onStep">
            <svg
                class="ac-drawing"
                :viewBox="layout.viewBox"
                role="img"
                aria-label="Your laptop and home router inside your home, joined to your provider. The provider is joined to a DNS resolver and to the internet, and the website circuit.tako.id is on the far side of the internet."
            >
                <rect class="home-area" :x="layout.home.x" :y="layout.home.y" :width="layout.home.width" :height="layout.home.height" />
                <text class="home-label" :x="layout.home.labelX" :y="layout.home.labelY" :text-anchor="layout.home.anchor">Your home</text>

                <line
                    v-for="[a, b] in cables"
                    :key="`${a}-${b}`"
                    class="cable"
                    :class="{ lit: litCables.has(cableKey(a, b)) }"
                    :x1="at(a)[0]"
                    :y1="at(a)[1]"
                    :x2="at(b)[0]"
                    :y2="at(b)[1]"
                />

                <template v-for="place in places" :key="place.id">
                    <SvgDevice :kind="place.kind" :x="at(place.id)[0]" :y="at(place.id)[1]" :lit="litPlaces.includes(place.id)" />
                    <text
                        class="label"
                        :x="layout.labels[place.id].x"
                        :y="layout.labels[place.id].y"
                        :text-anchor="layout.labels[place.id].anchor"
                    >
                        {{ place.label }}
                    </text>
                    <text
                        v-if="place.note"
                        class="note"
                        :x="layout.labels[place.id].x"
                        :y="layout.labels[place.id].y + 16"
                        :text-anchor="layout.labels[place.id].anchor"
                    >
                        {{ place.note }}
                    </text>
                </template>

                <circle
                    v-for="(packet, order) in packets"
                    v-show="shown[order] && packet.travelling.value"
                    :key="`packet-${order}`"
                    class="packet"
                    :cx="packet.position.value[0]"
                    :cy="packet.position.value[1]"
                    r="9"
                />
            </svg>

            <div v-if="step.browser" class="browser" aria-label="The browser window">
                <div class="bar">
                    <svg class="lock" viewBox="0 0 16 18" aria-hidden="true">
                        <path d="M4 8V5.5a4 4 0 0 1 8 0V8" />
                        <rect x="2" y="8" width="12" height="9" rx="1" />
                    </svg>
                    <span class="ac-mono">https://circuit.tako.id</span>
                </div>
                <div class="page">
                    <strong>Circuit</strong>
                    <span class="line long" />
                    <span class="line" />
                    <span class="line short" />
                </div>
            </div>
            <div v-else class="card">
                <p class="card-label">{{ step.card.label }}</p>
                <dl>
                    <template v-for="[name, value] in step.card.rows" :key="name">
                        <dt>{{ name }}</dt>
                        <dd>{{ value }}</dd>
                    </template>
                </dl>
            </div>
        </StepThrough>
    </div>
</template>

<style scoped>
.home-area {
    fill: none;
    stroke: var(--circuit-edge);
    stroke-width: 1.5;
    stroke-dasharray: 6 5;
}

.home-label {
    fill: var(--circuit-soft) !important;
    font-size: 12px !important;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
}

.label {
    font-size: 13px;
    font-weight: 700;
}

.note {
    fill: var(--circuit-soft) !important;
    font-family: var(--circuit-mono);
    font-size: 11.5px !important;
}

.card {
    margin-top: 8px;
    padding: 10px 14px;
    border: 2px solid var(--circuit-ink);
}

.card-label {
    margin: 0 0 6px !important;
    font-size: 12px;
    font-weight: 700;
    font-stretch: 112%;
    letter-spacing: 0.06em;
    text-transform: uppercase;
}

.card dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 3px 14px;
    margin: 0;
    font-size: 14.5px;
}

.card dt {
    font-weight: 700;
}

.card dd {
    margin: 0;
    overflow-wrap: anywhere;
}

.browser {
    margin-top: 8px;
    border: 2px solid var(--circuit-ink);
}

.bar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    border-bottom: 2px solid var(--circuit-ink);
    background: var(--circuit-mist);
    font-size: 14px;
}

.lock {
    width: 14px;
    height: 16px;
    fill: none;
    stroke: var(--circuit-ink);
    stroke-width: 1.8;
}

.lock rect {
    fill: var(--circuit-ink);
}

.page {
    display: grid;
    gap: 8px;
    padding: 14px 14px 16px;
}

.page strong {
    font-size: 20px;
}

.line {
    display: block;
    width: 70%;
    height: 8px;
    background: var(--circuit-line);
}

.line.long {
    width: 92%;
}

.line.short {
    width: 45%;
}
</style>
