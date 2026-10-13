<script setup lang="ts">
// Lesson: DNS. The reader steps through a lookup of circuit.tako.id, from the laptop to the resolver, the root, the .id servers and the tako.id servers, and compares it with a lookup someone already remembers.

import { computed, ref } from "vue";
import { useTravel, type Point } from "../travel";
import { useNarrow } from "./SwitchLearning";

type Place = "laptop" | "resolver" | "root" | "tld" | "domain";
type Mode = "nobody" | "resolver" | "laptop";

const places: { id: Place; kind: "laptop" | "server"; label: string; note?: string }[] = [
    { id: "laptop", kind: "laptop", label: "Your laptop" },
    { id: "resolver", kind: "server", label: "Resolver", note: "198.51.100.53" },
    { id: "root", kind: "server", label: "A root server" },
    { id: "tld", kind: "server", label: ".id servers" },
    { id: "domain", kind: "server", label: "tako.id servers" },
];

type Layout = {
    viewBox: string;
    at: Record<Place, Point>;
    /** Places whose name is written above them, because their cables leave from below. */
    above: Place[];
};

const layouts: Record<"wide" | "narrow", Layout> = {
    wide: {
        viewBox: "0 0 640 290",
        at: { laptop: [80, 140], resolver: [300, 140], root: [530, 40], tld: [530, 140], domain: [530, 240] },
        above: [],
    },
    narrow: {
        viewBox: "0 0 360 260",
        at: { laptop: [60, 70], resolver: [250, 70], root: [60, 200], tld: [180, 200], domain: [300, 200] },
        above: ["resolver"],
    },
};

/** Where a place's name goes: under it, or above it. Its note goes one line lower. */
function labelAt(id: Place): Point {
    const [x, y] = layout.value.at[id];
    return layout.value.above.includes(id) ? [x, y - 52] : [x, y + 38];
}

const narrow = useNarrow();
const layout = computed(() => layouts[narrow.value ? "narrow" : "wide"]);
const at = (id: Place) => layout.value.at[id];

const links: [Place, Place][] = [
    ["laptop", "resolver"],
    ["resolver", "root"],
    ["resolver", "tld"],
    ["resolver", "domain"],
];

type Step = {
    title: string;
    text: string;
    /** The trips a message makes in this step, in order. */
    legs: [Place, Place][];
    ask?: string;
    answer?: string;
    /** How many questions have gone over the network once this step is done. */
    questions: number;
    laptopKnows: boolean;
    resolverKnows: boolean;
};

const ANSWER = "circuit.tako.id is 203.0.113.80. Remember it for 300 seconds.";

const scripts: Record<Mode, Step[]> = {
    nobody: [
        {
            title: "You type a name",
            text: "You type circuit.tako.id. Before asking anyone, the laptop looks in its own memory of recent answers. There is nothing there.",
            legs: [],
            questions: 0,
            laptopKnows: false,
            resolverKnows: false,
        },
        {
            title: "Ask the resolver",
            text: "The laptop sends one question to its resolver. The resolver will do the rest of the work, and first looks in its own memory. Nothing there either.",
            legs: [["laptop", "resolver"]],
            ask: "What is the address of circuit.tako.id?",
            questions: 1,
            laptopKnows: false,
            resolverKnows: false,
        },
        {
            title: "Ask a root server",
            text: "The resolver starts at the top. A root server does not know circuit.tako.id, but it knows which servers look after every name that ends in .id, and points the resolver to them.",
            legs: [
                ["resolver", "root"],
                ["root", "resolver"],
            ],
            ask: "What is the address of circuit.tako.id?",
            answer: "I do not know. Ask the servers for .id: here are their addresses.",
            questions: 2,
            laptopKnows: false,
            resolverKnows: false,
        },
        {
            title: "Ask the servers for .id",
            text: "The servers for .id do not know every name under .id either, but they know who looks after tako.id, and point the resolver there.",
            legs: [
                ["resolver", "tld"],
                ["tld", "resolver"],
            ],
            ask: "What is the address of circuit.tako.id?",
            answer: "Ask the servers for tako.id: here are their addresses.",
            questions: 3,
            laptopKnows: false,
            resolverKnows: false,
        },
        {
            title: "Ask the servers for tako.id",
            text: "The servers for tako.id hold the domain’s own list of names, so they know the answer. They also say how long it may be remembered.",
            legs: [
                ["resolver", "domain"],
                ["domain", "resolver"],
            ],
            ask: "What is the address of circuit.tako.id?",
            answer: ANSWER,
            questions: 4,
            laptopKnows: false,
            resolverKnows: true,
        },
        {
            title: "The answer comes back",
            text: "The resolver passes the answer to the laptop, and both remember it for the next 300 seconds. The laptop can now send packets to 203.0.113.80. Four questions, one answer.",
            legs: [["resolver", "laptop"]],
            answer: ANSWER,
            questions: 4,
            laptopKnows: true,
            resolverKnows: true,
        },
    ],
    resolver: [
        {
            title: "You type a name",
            text: "You type circuit.tako.id. The laptop looks in its own memory first. There is nothing there.",
            legs: [],
            questions: 0,
            laptopKnows: false,
            resolverKnows: true,
        },
        {
            title: "Ask the resolver",
            text: "The laptop sends its question to the resolver, as before.",
            legs: [["laptop", "resolver"]],
            ask: "What is the address of circuit.tako.id?",
            questions: 1,
            laptopKnows: false,
            resolverKnows: true,
        },
        {
            title: "The resolver remembers",
            text: "Someone else asked the resolver for this name a minute ago, and the answer is still in its memory. It answers at once: no root, no .id, no tako.id. One question instead of four.",
            legs: [["resolver", "laptop"]],
            answer: "circuit.tako.id is 203.0.113.80. Remember it for the 240 seconds that are left.",
            questions: 1,
            laptopKnows: true,
            resolverKnows: true,
        },
    ],
    laptop: [
        {
            title: "You type a name",
            text: "You type circuit.tako.id. The laptop looked it up a minute ago, and the answer is still in its memory: 203.0.113.80.",
            legs: [],
            questions: 0,
            laptopKnows: true,
            resolverKnows: true,
        },
        {
            title: "No question at all",
            text: "Nothing goes over the network for the name. The laptop can send packets to 203.0.113.80 straight away, which is why opening a site the second time feels instant.",
            legs: [],
            questions: 0,
            laptopKnows: true,
            resolverKnows: true,
        },
    ],
};

const modes: { id: Mode; label: string }[] = [
    { id: "nobody", label: "Nobody remembers it" },
    { id: "resolver", label: "The resolver remembers it" },
    { id: "laptop", label: "The laptop remembers it" },
];

const mode = ref<Mode>("nobody");
const index = ref(0);
const steps = computed(() => scripts[mode.value]);
const step = computed(() => steps.value[index.value]!);

const { position, travelling, travel } = useTravel();
const leg = ref<[Place, Place]>();

function pick(next: Mode) {
    mode.value = next;
    index.value = 0;
    leg.value = undefined;
}

async function onStep(next: number) {
    index.value = next;
    const legs = steps.value[next]!.legs;
    leg.value = undefined;

    for (const entry of legs) {
        if (index.value !== next) return;
        leg.value = entry;
        await travel([at(entry[0]), at(entry[1])]);
    }
}

const isLit = (a: Place, b: Place) => step.value.legs.some(([from, to]) => (from === a && to === b) || (from === b && to === a));
const litPlace = computed(() => {
    const legs = step.value.legs;
    if (legs.length === 0) return "laptop";
    return leg.value ? leg.value[1] : legs[legs.length - 1]![1];
});
</script>

<template>
    <div class="dns-lookup">
        <div class="ac-row modes" role="group" aria-label="Who remembers the answer already">
            <button
                v-for="entry in modes"
                :key="entry.id"
                type="button"
                class="ac-button small"
                :aria-pressed="mode === entry.id"
                @click="pick(entry.id)"
            >
                {{ entry.label }}
            </button>
        </div>

        <StepThrough :key="mode" :steps="steps" @change="onStep">
            <svg
                class="ac-drawing"
                :viewBox="layout.viewBox"
                role="img"
                aria-label="Your laptop asks a resolver. The resolver can ask a root server, the servers for .id, and the servers for tako.id."
            >
                <line
                    v-for="[a, b] in links"
                    :key="`${a}-${b}`"
                    class="cable"
                    :class="{ lit: isLit(a, b), far: a !== 'laptop' }"
                    :x1="at(a)[0]"
                    :y1="at(a)[1]"
                    :x2="at(b)[0]"
                    :y2="at(b)[1]"
                />
                <g
                    v-for="place in places"
                    :key="place.id"
                    class="place"
                    :class="{ dim: mode !== 'nobody' && ['root', 'tld', 'domain'].includes(place.id) }"
                >
                    <SvgDevice :kind="place.kind" :x="at(place.id)[0]" :y="at(place.id)[1]" :lit="litPlace === place.id" />
                    <text class="label" :x="labelAt(place.id)[0]" :y="labelAt(place.id)[1]" text-anchor="middle">{{ place.label }}</text>
                    <text v-if="place.note" class="note" :x="labelAt(place.id)[0]" :y="labelAt(place.id)[1] + 16" text-anchor="middle">
                        {{ place.note }}
                    </text>
                </g>
                <circle v-if="travelling && leg" class="packet" :cx="position[0]" :cy="position[1]" r="9" />
            </svg>

            <div class="talk">
                <p v-if="step.ask"><strong>Question:</strong> {{ step.ask }}</p>
                <p v-if="step.answer"><strong>Answer:</strong> {{ step.answer }}</p>
                <p v-if="!step.ask && !step.answer" class="quiet">No message in this step.</p>
            </div>

            <dl class="facts">
                <div>
                    <dt>Questions sent so far</dt>
                    <dd>{{ step.questions }}</dd>
                </div>
                <div>
                    <dt>Laptop remembers</dt>
                    <dd>{{ step.laptopKnows ? "circuit.tako.id is 203.0.113.80" : "nothing yet" }}</dd>
                </div>
                <div>
                    <dt>Resolver remembers</dt>
                    <dd>{{ step.resolverKnows ? "circuit.tako.id is 203.0.113.80" : "nothing yet" }}</dd>
                </div>
            </dl>
        </StepThrough>
    </div>
</template>

<style scoped>
.modes {
    margin-bottom: 14px;
}

.place {
    transition: opacity 0.25s;
}

.place.dim {
    opacity: 0.3;
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

.cable.far:not(.lit) {
    stroke-dasharray: 5 5;
}

.talk {
    min-height: 3.4em;
    margin-top: 8px;
    padding: 8px 12px;
    border-left: 4px solid var(--circuit-yellow);
    background: var(--circuit-mist);
}

.talk p {
    margin: 0 !important;
    font-size: 14.5px;
    line-height: 1.5;
}

.talk p + p {
    margin-top: 4px !important;
}

.quiet {
    color: var(--circuit-soft);
}

.facts {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
    margin: 12px 0 0;
}

.facts div {
    padding: 6px 10px;
    border: 1.5px solid var(--circuit-line);
}

.facts dt {
    color: var(--circuit-soft);
    font-size: 12px;
    font-weight: 700;
}

.facts dd {
    margin: 0;
    font-size: 14px;
}

@media (max-width: 640px) {
    .facts {
        grid-template-columns: minmax(0, 1fr);
    }
}
</style>
