<script setup lang="ts">
// Lesson: project, a colocation. The reader sends packets between the internet and the tenants' servers, and sees which VLAN carries each one, and where it is routed or switched.

import { computed, ref } from "vue";
import { useTravel } from "../travel";

type Place = { id: string; kind: "cloud" | "router" | "switch" | "server"; label: string; note: string; x: number; y: number };

const places: Place[] = [
    { id: "internet", kind: "cloud", label: "The internet", note: "via the transit", x: 90, y: 70 },
    { id: "edge", kind: "router", label: "edge-01", note: "every gateway", x: 350, y: 70 },
    { id: "tor", kind: "switch", label: "tor-01", note: "", x: 350, y: 200 },
    { id: "argon1", kind: "server", label: "Argon server 1", note: "198.51.100.10", x: 120, y: 320 },
    { id: "argon2", kind: "server", label: "Argon server 2", note: "198.51.100.11", x: 350, y: 320 },
    { id: "herza1", kind: "server", label: "Herza server 1", note: "198.51.100.18", x: 580, y: 320 },
];

const at = (id: string) => places.find((place) => place.id === id)!;

const cables = [
    { from: "internet", to: "edge", label: "25g-1" },
    { from: "edge", to: "tor", label: "trunk: 99, 1001, 1002" },
    { from: "tor", to: "argon1", label: "1001, 2001" },
    { from: "tor", to: "argon2", label: "1001, 2001" },
    { from: "tor", to: "herza1", label: "1002, 2002" },
];

type Trip = { id: string; label: string; path: string[]; delivered: boolean; text: string };

const trips: Trip[] = [
    {
        id: "in",
        label: "The internet to Argon server 1",
        path: ["internet", "edge", "tor", "argon1"],
        delivered: true,
        text: "It arrives from the transit, and the edge ACL checks its source. 198.51.100.10 is inside 198.51.100.8/29, the block of Argon, whose gateway is on argon-internet. So the router sends it down the trunk tagged 1001, and tor-01 passes it out of 10g-1, still tagged 1001.",
    },
    {
        id: "private",
        label: "Argon server 1 to Argon server 2, privately",
        path: ["argon1", "tor", "argon2"],
        delivered: true,
        text: "Tagged 2001, argon-private. tor-01 switches it straight to 10g-2. VLAN 2001 is not on the trunk, so it never reaches the router, and never mixes with the internet traffic of Argon.",
    },
    {
        id: "across",
        label: "Argon server 1 to Herza server 1",
        path: ["argon1", "tor", "edge", "tor", "herza1"],
        delivered: true,
        text: "Two different public networks, so it goes up to the gateway of Argon on the router. It is routed onto herza-internet, VLAN 1002, and comes back down the same trunk. To each tenant, the other is just another address on the internet.",
    },
    {
        id: "sneak",
        label: "Argon server 1 into the private network of Herza",
        path: ["argon1", "tor"],
        delivered: false,
        text: "There is no way in. VLAN 2002 is only on the port of Herza, and the router has no address on it. So nothing Argon sends can be switched or routed into it.",
    },
];

const chosen = ref<Trip>();
const said = ref<{ kind: "good" | "bad"; text: string }>();
const { position, traveling, travel } = useTravel();

const litCables = computed(() => {
    const path = chosen.value?.path ?? [];
    const pairs = new Set<string>();
    for (let index = 1; index < path.length; index++) pairs.add([path[index - 1], path[index]].sort().join("-"));
    return pairs;
});

const isLit = (from: string, to: string) => litCables.value.has([from, to].sort().join("-"));

async function send(trip: Trip) {
    chosen.value = trip;
    said.value = undefined;

    await travel(trip.path.map((id) => [at(id).x, at(id).y]));
    said.value = { kind: trip.delivered ? "good" : "bad", text: trip.text };
}
</script>

<template>
    <div class="tenant-path">
        <svg
            class="ac-drawing"
            viewBox="0 0 700 380"
            role="img"
            aria-label="The internet joined to edge-01, edge-01 joined by a trunk to the switch tor-01, and three tenant servers on the switch: Argon server 1, Argon server 2, and Herza server 1."
        >
            <g v-for="cable in cables" :key="cable.from + cable.to">
                <line
                    class="cable"
                    :class="{ lit: isLit(cable.from, cable.to) }"
                    :x1="at(cable.from).x"
                    :y1="at(cable.from).y"
                    :x2="at(cable.to).x"
                    :y2="at(cable.to).y"
                />
                <text
                    class="cable-label"
                    :x="(at(cable.from).x + at(cable.to).x) / 2 + (cable.to === 'tor' ? 10 : 0)"
                    :y="(at(cable.from).y + at(cable.to).y) / 2 - 6"
                    :text-anchor="cable.to === 'tor' ? 'start' : 'middle'"
                >
                    {{ cable.label }}
                </text>
            </g>

            <SvgDevice
                v-for="place in places"
                :key="place.id"
                :kind="place.kind"
                :x="place.x"
                :y="place.y"
                :label="place.label"
                :note="place.note"
                :lit="chosen?.path.includes(place.id)"
            />

            <circle v-if="traveling" class="packet" :cx="position[0]" :cy="position[1]" r="9" />
        </svg>

        <div class="options">
            <button
                v-for="trip in trips"
                :key="trip.id"
                type="button"
                class="ac-button"
                :aria-pressed="chosen?.id === trip.id"
                :disabled="traveling"
                @click="send(trip)"
            >
                {{ trip.label }}
            </button>
        </div>

        <p v-if="said" class="ac-say" :class="said.kind" aria-live="polite">{{ said.text }}</p>
        <p v-else class="ac-say hint" aria-live="polite">
            {{ traveling ? "On its way..." : "Pick a packet to send." }}
        </p>
    </div>
</template>

<style scoped>
.cable-label {
    fill: var(--circuit-soft) !important;
    font-family: var(--circuit-mono);
    font-size: 11.5px !important;
}

.options {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 8px;
    margin-top: 10px;
}

.options .ac-button {
    justify-content: flex-start;
    white-space: normal;
    text-align: left;
}

.hint {
    color: var(--circuit-soft);
}
</style>
