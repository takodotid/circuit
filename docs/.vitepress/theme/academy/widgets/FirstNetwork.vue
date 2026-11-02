<script setup lang="ts">
// Lesson: what is a network. The reader plugs devices into a home router, sends a message between two of them, then joins the home to the internet.

import { computed, ref } from "vue";
import { useTravel } from "../travel";

type Place = { id: string; kind: "laptop" | "phone" | "printer" | "router" | "cloud" | "server"; label: string; x: number; y: number };

const places: Place[] = [
    { id: "laptop", kind: "laptop", label: "Laptop", x: 70, y: 60 },
    { id: "phone", kind: "phone", label: "Phone", x: 70, y: 210 },
    { id: "printer", kind: "printer", label: "Printer", x: 250, y: 230 },
    { id: "router", kind: "router", label: "Home router", x: 250, y: 120 },
    { id: "internet", kind: "cloud", label: "The internet", x: 450, y: 120 },
    { id: "website", kind: "server", label: "A website", x: 620, y: 120 },
];

const at = (id: string) => places.find((place) => place.id === id)!;

// The devices that can be plugged in, and the one cable that joins the home to the internet.
const pluggable = ["laptop", "phone", "printer", "internet"];
const plugged = ref<string[]>([]);

function toggle(id: string) {
    plugged.value = plugged.value.includes(id) ? plugged.value.filter((entry) => entry !== id) : [...plugged.value, id];
    said.value = undefined;
}

const senders = ["laptop", "phone"];
const receivers = ["printer", "phone", "laptop", "website"];
const from = ref("laptop");
const to = ref("printer");

const said = ref<{ kind: "good" | "bad"; text: string }>();
const { position, travelling, travel } = useTravel();

/** The places a message passes, or why it cannot go. */
const route = computed(() => {
    const missing = [from.value, to.value === "website" ? "internet" : to.value].filter((id) => !plugged.value.includes(id));
    if (from.value === to.value) return { error: "A device does not need the network to talk to itself. Pick another one." };
    if (missing.length) {
        const names = missing.map((id) => (id === "internet" ? "the home" : `the ${at(id).label.toLowerCase()}`)).join(" and ");
        const verb = missing.length > 1 ? "are" : "is";

        return { error: `${names.replace(/^./, (letter) => letter.toUpperCase())} ${verb} not connected yet, so there is no way through.` };
    }

    return { path: to.value === "website" ? [from.value, "router", "internet", "website"] : [from.value, "router", to.value] };
});

async function send() {
    const plan = route.value;

    if (!plan.path) {
        said.value = { kind: "bad", text: plan.error! };
        return;
    }

    said.value = undefined;
    await travel(plan.path.map((id) => [at(id).x, at(id).y]));

    said.value = {
        kind: "good",
        text:
            to.value === "website"
                ? "The message left your home through the router, crossed the internet, and reached a computer you have never met."
                : `The message went from the ${at(from.value).label.toLowerCase()} to the router, and the router passed it to the ${at(to.value).label.toLowerCase()}.`,
    };
}
</script>

<template>
    <div class="first-network">
        <svg
            class="ac-drawing"
            viewBox="0 0 700 290"
            role="img"
            aria-label="A laptop, a phone and a printer around a home router, which can be joined to the internet and a website beyond it."
        >
            <line
                v-for="id in pluggable"
                :key="id"
                class="cable"
                :class="{ off: !plugged.includes(id) }"
                :x1="at('router').x"
                :y1="at('router').y"
                :x2="at(id).x"
                :y2="at(id).y"
            />
            <line class="cable" :x1="at('internet').x" :y1="at('internet').y" :x2="at('website').x" :y2="at('website').y" />

            <SvgDevice
                v-for="place in places"
                :key="place.id"
                :kind="place.kind"
                :x="place.x"
                :y="place.y"
                :label="place.label"
                :dim="pluggable.includes(place.id) && !plugged.includes(place.id)"
            />

            <circle v-if="travelling" class="packet" :cx="position[0]" :cy="position[1]" r="9" />
        </svg>

        <div class="controls">
            <div class="ac-field">
                <span>1. Plug in a cable</span>
                <div class="ac-row">
                    <button
                        v-for="id in pluggable"
                        :key="id"
                        type="button"
                        class="ac-button small"
                        :aria-pressed="plugged.includes(id)"
                        @click="toggle(id)"
                    >
                        {{ id === "internet" ? "Home to internet" : at(id).label }}
                    </button>
                </div>
            </div>

            <div class="send">
                <label class="ac-field">
                    <span>2. Send from</span>
                    <select v-model="from" class="ac-select">
                        <option v-for="id in senders" :key="id" :value="id">{{ at(id).label }}</option>
                    </select>
                </label>
                <label class="ac-field">
                    <span>to</span>
                    <select v-model="to" class="ac-select">
                        <option v-for="id in receivers" :key="id" :value="id">{{ at(id).label }}</option>
                    </select>
                </label>
                <button type="button" class="ac-button primary" :disabled="travelling" @click="send">Send a message</button>
            </div>
        </div>

        <p v-if="said" class="ac-say" :class="said.kind" aria-live="polite">{{ said.text }}</p>
        <p v-else class="ac-say hint" aria-live="polite">Plug in the laptop and the printer, then send a message between them.</p>
    </div>
</template>

<style scoped>
.cable.off {
    stroke-dasharray: 4 6;
    opacity: 0.45;
}

.controls {
    display: grid;
    gap: 16px;
    margin-top: 10px;
}

.send {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: 10px;
}

.hint {
    color: var(--circuit-soft);
}
</style>
