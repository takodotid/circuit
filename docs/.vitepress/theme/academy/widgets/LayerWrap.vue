<script setup lang="ts">
// Lesson: layers. The reader wraps a DNS question in one header per layer, in the order a laptop does, and sees what each header adds.

import { computed, ref } from "vue";

type LayerId = "transport" | "network" | "link" | "physical";

type Layer = {
    id: LayerId;
    number: number;
    name: string;
    /** What the layer adds, in a few words. */
    adds: string;
    /** The values it writes. */
    fields: string;
    size: string;
    /** Said when the reader adds it in the right place. */
    added: string;
};

// From the inside out: the order a sending device adds them.
const layers: Layer[] = [
    {
        id: "transport",
        number: 4,
        name: "Transport",
        adds: "UDP header",
        fields: "from port 51000 to port 53",
        size: "8 bytes",
        added: "The transport layer says which program the question is for: port 53, DNS. It is the closest to the message, so it wraps it first.",
    },
    {
        id: "network",
        number: 3,
        name: "Network",
        adds: "IP header",
        fields: "from 192.168.20.10 to 192.168.30.53, TTL 64",
        size: "20 bytes",
        added: "The network layer adds the IP addresses of the laptop and of the DNS server. This header goes through every router on the way, with the ports still inside it.",
    },
    {
        id: "link",
        number: 2,
        name: "Link",
        adds: "Frame header",
        fields: "from 3c:22:fb:0a:91:7e to 00:00:5e:00:53:01",
        size: "14 bytes, and 4 at the end",
        added: "The link layer makes it a frame for the next device only: the router, by its hardware address. It also adds 4 bytes at the end, so the receiver can tell if the frame was damaged.",
    },
    {
        id: "physical",
        number: 1,
        name: "Physical",
        adds: "Signals",
        fields: "00000000 00000000 01011110 00000000 ...",
        size: "every bit",
        added: "The physical layer sends every bit of the frame as light or electricity on the cable, starting with the router's hardware address. The question is ready to leave the laptop.",
    },
];

// Offered in a mixed order, so the reader decides which comes next.
const offered: LayerId[] = ["network", "physical", "transport", "link"];

const wrapped = ref<LayerId[]>([]);
const said = ref<{ kind: "good" | "warn"; word?: string; text: string }>();

const layerOf = (id: LayerId) => layers.find((layer) => layer.id === id)!;
const has = (id: LayerId) => wrapped.value.includes(id);
const finished = computed(() => wrapped.value.length === layers.length);

function wrap(id: LayerId) {
    const next = layers[wrapped.value.length]!;
    const chosen = layerOf(id);

    if (has(id)) {
        said.value = { kind: "warn", word: "Already", text: `The ${chosen.name.toLowerCase()} layer has already wrapped it.` };
        return;
    }

    if (id !== next.id) {
        said.value = {
            kind: "warn",
            word: "Not yet",
            text: `The ${chosen.name.toLowerCase()} layer wraps whatever the layer above it hands down, and the ${next.name.toLowerCase()} layer has not wrapped the message yet. Work from the inside out.`,
        };
        return;
    }

    wrapped.value = [...wrapped.value, id];
    said.value = { kind: "good", word: `Layer ${chosen.number}`, text: chosen.added };
}

function reset() {
    wrapped.value = [];
    said.value = undefined;
}
</script>

<template>
    <div class="layer-wrap">
        <div class="ac-row">
            <button
                v-for="id in offered"
                :key="id"
                type="button"
                class="ac-button small"
                :aria-pressed="has(id)"
                :disabled="finished"
                @click="wrap(id)"
            >
                {{ has(id) ? "Added: " : "Add " }}{{ layerOf(id).adds.toLowerCase() }}
            </button>
            <button type="button" class="ac-button small" :disabled="!wrapped.length" @click="reset">Start again</button>
        </div>

        <div class="parcel" role="group" aria-label="The message and the headers around it, outermost first">
            <div class="shell" :class="{ on: has('physical') }">
                <p v-if="has('physical')" class="head">
                    <span class="tag">1 Physical</span>
                    <span class="what">{{ layerOf("physical").adds }}</span>
                    <span class="fields">{{ layerOf("physical").fields }}</span>
                </p>
                <div class="shell" :class="{ on: has('link') }">
                    <p v-if="has('link')" class="head">
                        <span class="tag">2 Link</span>
                        <span class="what">{{ layerOf("link").adds }}, {{ layerOf("link").size }}</span>
                        <span class="fields">{{ layerOf("link").fields }}</span>
                    </p>
                    <div class="shell" :class="{ on: has('network') }">
                        <p v-if="has('network')" class="head">
                            <span class="tag">3 Network</span>
                            <span class="what">{{ layerOf("network").adds }}, {{ layerOf("network").size }}</span>
                            <span class="fields">{{ layerOf("network").fields }}</span>
                        </p>
                        <div class="shell" :class="{ on: has('transport') }">
                            <p v-if="has('transport')" class="head">
                                <span class="tag">4 Transport</span>
                                <span class="what">{{ layerOf("transport").adds }}, {{ layerOf("transport").size }}</span>
                                <span class="fields">{{ layerOf("transport").fields }}</span>
                            </p>
                            <div class="message">
                                <span class="tag">5 Application</span>
                                <span class="what">DNS question</span>
                                <span class="fields">What is the address of circuit.tako.id?</span>
                            </div>
                        </div>
                    </div>
                    <p v-if="has('link')" class="foot">Frame check, 4 bytes</p>
                </div>
            </div>
        </div>

        <p v-if="said" class="ac-say" :class="said.kind" :data-word="said.word" aria-live="polite">{{ said.text }}</p>
        <p v-else class="ac-say hint" aria-live="polite">
            The DNS program has written its question. Add the headers in the order the laptop adds them, starting with the one closest to
            the question.
        </p>
    </div>
</template>

<style scoped>
.parcel {
    margin-top: 16px;
}

.shell {
    display: contents;
}

.shell.on {
    display: block;
    padding: 0 10px 10px;
    border: 2px solid var(--circuit-ink);
    background: var(--circuit-paper);
}

.head,
.foot,
.message {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px 10px;
    margin: 0 !important;
    padding: 8px 0;
    font-size: 14.5px;
    line-height: 1.45;
}

.message {
    padding: 10px 12px;
    border: 2px dashed var(--circuit-edge);
    background: var(--circuit-mist);
}

.foot {
    padding: 8px 0 0;
    color: var(--circuit-soft);
    font-size: 13px;
}

.tag {
    padding: 0 6px;
    background: var(--circuit-cobalt);
    color: #ffffff;
    font-size: 11px;
    font-weight: 700;
    font-stretch: 115%;
    letter-spacing: 0.08em;
    line-height: 20px;
    text-transform: uppercase;
}

.message .tag {
    background: var(--circuit-ink);
    color: var(--circuit-paper);
}

.what {
    font-weight: 700;
}

.fields {
    font-family: var(--circuit-mono);
    font-size: 13px;
    word-break: break-word;
}

.hint {
    color: var(--circuit-soft);
}
</style>
