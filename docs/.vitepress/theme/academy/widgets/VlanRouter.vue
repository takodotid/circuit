<script setup lang="ts">
// Lesson: VLANs. The reader tries to send from a laptop in one VLAN to a recorder in another, then plugs in a router with a port in each VLAN and tries again.

import { ref } from "vue";
import { useTravel, type Point } from "../travel";

const LAPTOP: Point = [100, 225];
const RECORDER: Point = [540, 225];
const SWITCH: Point = [320, 150];
const ROUTER: Point = [320, 50];

// The two cables between the switch and the router: the left one in VLAN 20, the right one in VLAN 40.
const HOME_DOWN: Point = [306, 140];
const HOME_UP: Point = [306, 62];
const CAMERAS_UP: Point = [334, 62];
const CAMERAS_DOWN: Point = [334, 140];

const router = ref(false);
const busy = ref(false);
const decided = ref<string>();
const said = ref<{ kind: "good" | "bad"; text: string }>();
const { position, travelling, travel } = useTravel();

function toggleRouter() {
    router.value = !router.value;
    decided.value = undefined;
    said.value = undefined;
}

async function send() {
    busy.value = true;
    said.value = undefined;
    decided.value =
        "The laptop compares addresses: 192.168.40.10 is not on its own network, 192.168.20.0/24, so it sends the packet to its gateway, 192.168.20.1.";

    if (!router.value) {
        await travel([LAPTOP, [SWITCH[0] - 14, SWITCH[1]]]);
        said.value = {
            kind: "bad",
            text: "Nothing in VLAN 20 answers to 192.168.20.1, so the packet has nowhere to go. The switch will not carry it into VLAN 40 on its own.",
        };
        busy.value = false;
        return;
    }

    await travel([LAPTOP, HOME_DOWN, HOME_UP, ROUTER, CAMERAS_UP, CAMERAS_DOWN, RECORDER]);
    said.value = {
        kind: "good",
        text: "The router got the packet on its port in VLAN 20, found 192.168.40.0/24 on its port in VLAN 40, and sent it out there. The switch carried it in VLAN 40 to the recorder.",
    };
    busy.value = false;
}
</script>

<template>
    <div class="vlan-router">
        <svg
            class="ac-drawing"
            viewBox="0 0 640 290"
            role="img"
            aria-label="A laptop in VLAN 20 and a video recorder in VLAN 40 on one switch, and a router above the switch with one cable in each VLAN."
        >
            <line class="cable home" :x1="LAPTOP[0]" :y1="LAPTOP[1]" :x2="SWITCH[0] - 14" :y2="SWITCH[1] + 10" />
            <line class="cable cameras" :x1="RECORDER[0]" :y1="RECORDER[1]" :x2="SWITCH[0] + 14" :y2="SWITCH[1] + 10" />
            <line class="cable home" :class="{ off: !router }" :x1="HOME_DOWN[0]" :y1="HOME_DOWN[1]" :x2="HOME_UP[0]" :y2="HOME_UP[1]" />
            <line
                class="cable cameras"
                :class="{ off: !router }"
                :x1="CAMERAS_DOWN[0]"
                :y1="CAMERAS_DOWN[1]"
                :x2="CAMERAS_UP[0]"
                :y2="CAMERAS_UP[1]"
            />

            <text class="small" :x="HOME_DOWN[0] - 8" y="106" text-anchor="end">VLAN 20</text>
            <text class="small" :x="CAMERAS_DOWN[0] + 8" y="106">VLAN 40</text>

            <SvgDevice kind="router" :x="ROUTER[0]" :y="ROUTER[1]" :dim="!router" />
            <g :class="{ faded: !router }">
                <text class="name" :x="ROUTER[0] + 42" :y="ROUTER[1] - 8">Router</text>
                <text class="mono" :x="ROUTER[0] + 42" :y="ROUTER[1] + 9">192.168.20.1 in VLAN 20</text>
                <text class="mono" :x="ROUTER[0] + 42" :y="ROUTER[1] + 25">192.168.40.1 in VLAN 40</text>
            </g>

            <SvgDevice kind="switch" :x="SWITCH[0]" :y="SWITCH[1]" />
            <text class="name" :x="SWITCH[0] + 42" :y="SWITCH[1] + 5">Switch</text>

            <SvgDevice kind="laptop" :x="LAPTOP[0]" :y="LAPTOP[1]" label="Laptop, VLAN 20" note="192.168.20.10/24" />
            <SvgDevice kind="server" :x="RECORDER[0]" :y="RECORDER[1]" label="Recorder, VLAN 40" note="192.168.40.10/24" />

            <circle v-if="travelling" class="packet" :cx="position[0]" :cy="position[1]" r="9" />
        </svg>

        <div class="ac-row controls">
            <button type="button" class="ac-button" :aria-pressed="router" :disabled="busy" @click="toggleRouter">
                {{ router ? "Router plugged in" : "Plug in a router" }}
            </button>
            <button type="button" class="ac-button primary" :disabled="busy" @click="send">Send from the laptop to the recorder</button>
        </div>

        <div aria-live="polite">
            <p v-if="decided" class="ac-say">{{ decided }}</p>
            <p v-if="said" class="ac-say" :class="said.kind">{{ said.text }}</p>
            <p v-if="!decided" class="ac-say hint">
                The laptop and the recorder share one switch, but not one VLAN. Send from the laptop first, without a router.
            </p>
        </div>
    </div>
</template>

<style scoped>
.cable.cameras {
    stroke-dasharray: 2 5;
    stroke-linecap: round;
}

.cable.off {
    opacity: 0.25;
}

.faded {
    opacity: 0.35;
}

.name {
    font-weight: 700;
}

.mono {
    fill: var(--circuit-soft) !important;
    font-family: var(--circuit-mono);
    font-size: 11.5px !important;
}

.small {
    fill: var(--circuit-soft) !important;
    font-size: 12px !important;
}

.controls {
    margin-top: 12px;
}

.hint {
    color: var(--circuit-soft);
}
</style>
