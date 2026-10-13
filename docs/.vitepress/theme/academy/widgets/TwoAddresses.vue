<script setup lang="ts">
// Lesson: addresses. The reader takes a laptop from home to a café to an office and off the network, and sees which of its two addresses changes.

import { computed, ref } from "vue";
import { useTravel } from "../travel";

const HARDWARE_ADDRESS = "3c:22:fb:0a:91:7e";
const LAPTOP_Y = 200;

type Place = {
    id: string;
    name: string;
    kind: "router" | "access-point";
    device: string;
    x: number;
    /** The IP address this network gives the laptop. */
    address?: string;
};

const places: Place[] = [
    { id: "home", name: "Home", kind: "router", device: "Home router", x: 110, address: "192.168.1.23" },
    { id: "cafe", name: "Café", kind: "access-point", device: "Café Wi-Fi", x: 300, address: "10.20.0.141" },
    { id: "office", name: "Office", kind: "router", device: "Office router", x: 490, address: "172.16.8.57" },
    { id: "off", name: "Off the network", kind: "router", device: "", x: 640 },
];

const at = (id: string) => places.find((place) => place.id === id)!;

const here = ref("home");
const visits = ref([{ place: "home", address: at("home").address }]);
const said = ref<string>();
const changed = ref(false);

const { position, travelling, travel } = useTravel(320);

const laptopX = computed(() => (travelling.value ? position.value[0] : at(here.value).x));
const ipAddress = computed(() => at(here.value).address);

async function go(id: string) {
    if (id === here.value || travelling.value) return;

    const before = ipAddress.value;
    said.value = undefined;
    changed.value = false;

    await travel([
        [at(here.value).x, LAPTOP_Y],
        [at(id).x, LAPTOP_Y],
    ]);

    here.value = id;
    visits.value.push({ place: id, address: at(id).address });
    changed.value = before !== ipAddress.value;

    const place = at(id);
    said.value = place.address
        ? `The laptop joined the ${place.name.toLowerCase()} network, and that network gave it the IP address ${place.address}. Its hardware address is still ${HARDWARE_ADDRESS}.`
        : `Off the network, the laptop has no IP address at all: nobody has given it one. Its hardware address is still ${HARDWARE_ADDRESS}, because that lives in the network card.`;
}
</script>

<template>
    <div class="two-addresses">
        <svg
            class="ac-drawing"
            viewBox="0 0 700 300"
            role="img"
            :aria-label="`Three networks, a home, a café and an office, and a laptop that is now ${here === 'off' ? 'off the network' : `at the ${at(here).name.toLowerCase()}`}.`"
        >
            <template v-for="place in places" :key="place.id">
                <template v-if="place.address">
                    <rect class="area" :class="{ current: here === place.id }" :x="place.x - 85" y="8" width="170" height="270" />
                    <text class="area-name" :x="place.x" y="30" text-anchor="middle">{{ place.name }}</text>
                    <line
                        v-if="here === place.id && !travelling"
                        class="cable"
                        :class="{ wifi: place.kind === 'access-point' }"
                        :x1="place.x"
                        :y1="85"
                        :x2="place.x"
                        :y2="LAPTOP_Y - 25"
                    />
                    <SvgDevice :kind="place.kind" :x="place.x" :y="85" :label="place.device" />
                </template>
            </template>

            <text class="area-name" :x="at('off').x" y="30" text-anchor="middle">Nowhere</text>

            <SvgDevice
                kind="laptop"
                :x="laptopX"
                :y="LAPTOP_Y"
                label="Laptop"
                :note="travelling ? '' : (ipAddress ?? 'no IP address')"
                lit
            />
        </svg>

        <div class="ac-field">
            <span>Take the laptop to</span>
            <div class="ac-row">
                <button
                    v-for="place in places"
                    :key="place.id"
                    type="button"
                    class="ac-button small"
                    :aria-pressed="here === place.id"
                    :disabled="travelling"
                    @click="go(place.id)"
                >
                    {{ place.name }}
                </button>
            </div>
        </div>

        <div class="cards">
            <div class="card">
                <span class="card-name">Hardware address</span>
                <span class="card-value ac-mono">{{ HARDWARE_ADDRESS }}</span>
                <span class="card-note">Written into the network card when it was made</span>
            </div>
            <div class="card" :class="{ changed }">
                <span class="card-name">IP address <span v-if="changed" class="chip">Changed</span></span>
                <span class="card-value ac-mono">{{ ipAddress ?? "none" }}</span>
                <span class="card-note">{{
                    ipAddress ? `Given by the ${at(here).name.toLowerCase()} network` : "Not on any network, so none was given"
                }}</span>
            </div>
        </div>

        <div class="log">
            <table class="ac-table">
                <thead>
                    <tr>
                        <th>Where</th>
                        <th>Hardware address</th>
                        <th>IP address</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="(visit, index) in visits" :key="index" :class="{ lit: index === visits.length - 1 }">
                        <td>{{ at(visit.place).name }}</td>
                        <td class="ac-mono">{{ HARDWARE_ADDRESS }}</td>
                        <td class="ac-mono">{{ visit.address ?? "none" }}</td>
                    </tr>
                </tbody>
            </table>
        </div>

        <p v-if="said" class="ac-say good" data-word="Moved" aria-live="polite">{{ said }}</p>
        <p v-else class="ac-say hint" aria-live="polite">
            The laptop is at home. Take it to the café, then to the office, and watch both addresses.
        </p>
    </div>
</template>

<style scoped>
.area {
    fill: none;
    stroke: var(--circuit-line);
    stroke-width: 2;
    stroke-dasharray: 6 5;
}

.area.current {
    stroke: var(--circuit-link);
    stroke-dasharray: none;
}

.area-name {
    fill: var(--circuit-soft) !important;
    font-size: 12px !important;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
}

.cable.wifi {
    stroke-dasharray: 3 6;
}

.ac-field {
    margin-top: 8px;
}

.cards {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 10px;
    margin-top: 16px;
}

.card {
    display: grid;
    gap: 2px;
    padding: 10px 12px;
    border: 2px solid var(--circuit-ink);
    background: var(--circuit-paper);
    transition: background-color 0.3s;
}

.card.changed {
    background: var(--circuit-selected);
}

.card-name {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    font-weight: 700;
}

.card-value {
    font-size: 18px;
}

.card-note {
    color: var(--circuit-soft);
    font-size: 13px;
}

.chip {
    padding: 0 6px;
    background: var(--circuit-ink);
    color: var(--circuit-paper);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.08em;
    line-height: 18px;
    text-transform: uppercase;
}

.log {
    overflow-x: auto;
}

.hint {
    color: var(--circuit-soft);
}

@media (prefers-reduced-motion: reduce) {
    .card {
        transition: none;
    }
}
</style>
