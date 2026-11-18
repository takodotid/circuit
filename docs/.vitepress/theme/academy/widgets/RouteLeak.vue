<script setup lang="ts">
// Lesson: route policies. The reader chooses what their network announces to its second transit, then sends that transit's customers' traffic and sees whether it squeezes through their network.

import { computed, ref } from "vue";
import { useTravel } from "../travel";

type Place = { id: string; kind: "router" | "cloud"; label: string; note: string; x: number; y: number };

const places: Place[] = [
    { id: "a", kind: "router", label: "Hurricane Electric", note: "AS6939", x: 150, y: 70 },
    { id: "b", kind: "router", label: "A careless transit", note: "AS64510", x: 550, y: 70 },
    { id: "you", kind: "router", label: "Your network", note: "AS64500", x: 350, y: 180 },
    { id: "far", kind: "cloud", label: "Google", note: "AS15169", x: 110, y: 270 },
    { id: "customers", kind: "cloud", label: "AS64510’s customers", note: "", x: 590, y: 270 },
];

const at = (id: string) => places.find((place) => place.id === id)!;

const cables = [
    ["a", "b"],
    ["you", "a"],
    ["you", "b"],
    ["a", "far"],
    ["b", "customers"],
] as const;

type Export = "none" | "ours" | "everything";

const choices: { id: Export; label: string }[] = [
    { id: "none", label: "No export" },
    { id: "ours", label: "Our prefix, then reject" },
    { id: "everything", label: "Everything" },
];

const exported = ref<Export>("ours");
const limited = ref(false);
const said = ref<{ kind: "good" | "bad" | "warn"; word: string; text: string }>();
const lastPath = ref<string[]>([]);

const sessionDown = computed(() => exported.value === "everything" && limited.value);
const leaking = computed(() => exported.value === "everything" && !limited.value);

const learned = computed(() => {
    if (sessionDown.value) return [];
    if (exported.value === "none") return [];
    if (exported.value === "ours") return ["198.51.100.0/24, your own prefix"];
    return ["198.51.100.0/24, your own prefix", "Every route Hurricane Electric sent you: the whole internet"];
});

function choose(id: Export) {
    exported.value = id;
    said.value = undefined;
    lastPath.value = [];
}

function toggleLimit() {
    limited.value = !limited.value;
    said.value = undefined;
    lastPath.value = [];
}

const { position, traveling, travel } = useTravel();

async function send() {
    said.value = undefined;
    const path = leaking.value ? ["customers", "b", "you", "a", "far"] : ["customers", "b", "a", "far"];
    lastPath.value = path;
    await travel(path.map((id) => [at(id).x, at(id).y]));

    if (leaking.value) {
        said.value = {
            kind: "bad",
            word: "Overloaded",
            text: "AS64510 now reaches Google through you, and prefers that way, because you are its customer. Traffic from all its customers squeezes through your links to Hurricane Electric, and they fill up. That is a route leak.",
        };
    } else if (sessionDown.value) {
        said.value = {
            kind: "warn",
            word: "Session down",
            text: "You announced far more than 10 prefixes, so AS64510 closed the session. The leak stopped, but your own prefix went with it. Traffic for your network now comes in only through Hurricane Electric.",
        };
    } else if (exported.value === "none") {
        said.value = {
            kind: "good",
            word: "Delivered",
            text: "The traffic crossed from AS64510 to Hurricane Electric without touching you. AS64510 learned nothing from you, so even traffic for your own network reaches you only through Hurricane Electric.",
        };
    } else {
        said.value = {
            kind: "good",
            word: "Delivered",
            text: "The traffic crossed from AS64510 to Hurricane Electric without touching you. AS64510 learned only your own prefix from you, so only traffic for your network comes your way.",
        };
    }
}

const isLit = (from: string, to: string) => {
    const path = lastPath.value;
    return path.some((id, index) => index > 0 && ((path[index - 1] === from && id === to) || (path[index - 1] === to && id === from)));
};

const code = computed(() => {
    const neighbor = [
        `as64510: {`,
        `    address: "203.0.113.5",`,
        `    remote_as: 64510,`,
        `    role: "provider",`,
        `    import_policy: "as64510-import",`,
        ...(exported.value === "ours" ? [`    export_policy: "as64510-export",`] : []),
        ...(exported.value === "everything" ? [`    export_policy: "everything",`] : []),
        `    max_prefixes: 1_200_000,`,
        `},`,
    ];

    const policy =
        exported.value === "ours"
            ? [
                  "",
                  `"as64510-export": [`,
                  `    { description: "Announce 198.51.100.0/24", if: { prefix: "198.51.100.0/24" }, then: "accept" },`,
                  `    { description: "Nothing else leaves", then: "reject" },`,
                  `],`,
              ]
            : exported.value === "everything"
              ? ["", `everything: [{ then: "accept" }],`]
              : ["", "// No export: nothing is announced to as64510."];

    return [...neighbor, ...policy].join("\n");
});

/** What circuit validate printed for each choice, run on the edge router example with this neighbor added. */
const validate = computed(() =>
    exported.value === "everything"
        ? [
              "$ circuit validate",
              "  error  edge-01: routing.bgp.neighbors.as64510: export_policy everything does not end in an unconditional reject",
              "",
              "1 error(s).",
          ].join("\n")
        : ["$ circuit validate", "✔ 1 device(s), no errors."].join("\n")
);
</script>

<template>
    <div class="route-leak">
        <svg
            class="ac-drawing"
            viewBox="0 0 700 330"
            role="img"
            aria-label="Your network between Hurricane Electric and AS64510. Google sits behind Hurricane Electric, and AS64510's customers behind AS64510. The two transits also reach each other across the rest of the internet."
        >
            <line
                v-for="[from, to] in cables"
                :key="`${from}-${to}`"
                class="cable"
                :class="{ lit: isLit(from, to), down: sessionDown && ((from === 'you' && to === 'b') || (from === 'b' && to === 'you')) }"
                :x1="at(from).x"
                :y1="at(from).y"
                :x2="at(to).x"
                :y2="at(to).y"
            />
            <text class="caption" x="350" y="58" text-anchor="middle">the rest of the internet</text>
            <SvgDevice
                v-for="place in places"
                :key="place.id"
                :kind="place.kind"
                :x="place.x"
                :y="place.y"
                :label="place.label"
                :note="place.note || undefined"
                :lit="place.id === 'you'"
            />
            <circle v-if="traveling" class="packet" :cx="position[0]" :cy="position[1]" r="9" />
        </svg>

        <div class="controls">
            <div class="ac-field">
                <span>What you announce to AS64510</span>
                <div class="ac-row" role="group" aria-label="What you announce to AS64510">
                    <button
                        v-for="choice in choices"
                        :key="choice.id"
                        type="button"
                        class="ac-button small"
                        :aria-pressed="exported === choice.id"
                        @click="choose(choice.id)"
                    >
                        {{ choice.label }}
                    </button>
                </div>
            </div>
            <div class="ac-field">
                <span>On AS64510’s side of the session</span>
                <button type="button" class="ac-button small" :aria-pressed="limited" @click="toggleLimit">Limit you to 10 prefixes</button>
            </div>
        </div>

        <div class="learned">
            <p class="heading">What AS64510 learns from you</p>
            <ul v-if="learned.length">
                <li v-for="entry in learned" :key="entry">{{ entry }}</li>
            </ul>
            <p v-else class="quiet">{{ sessionDown ? "Nothing: the session is closed." : "Nothing." }}</p>
        </div>

        <div class="ac-row send">
            <button type="button" class="ac-button primary" :disabled="traveling" @click="send">
                Send traffic from AS64510’s customers to Google
            </button>
        </div>

        <p v-if="said" class="ac-say" :class="said.kind" :data-word="said.word" aria-live="polite">{{ said.text }}</p>
        <p v-else class="ac-say quiet" aria-live="polite">
            Send the traffic with each choice. Then announce everything, and try the limit.
        </p>

        <CodeView :code="code" title="edge-01.ts, part of it" />
        <CodeView :code="validate" lang="shell" title="Terminal" />
    </div>
</template>

<style scoped>
.cable.down {
    stroke-dasharray: 4 6;
    opacity: 0.45;
}

.caption {
    fill: var(--circuit-soft) !important;
    font-size: 13px !important;
}

.controls {
    display: flex;
    flex-wrap: wrap;
    gap: 14px 24px;
    margin-top: 10px;
}

.learned {
    margin-top: 14px;
}

.learned ul {
    margin: 4px 0 0 !important;
}

.heading {
    margin: 0;
    font-weight: 700;
}

.quiet {
    margin: 4px 0 0;
    color: var(--circuit-soft);
}

.send {
    margin-top: 14px;
}

.send .ac-button {
    white-space: normal;
    text-align: left;
}
</style>
