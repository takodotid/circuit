<script setup lang="ts">
// Lesson: carrying your own traffic. The reader buys an EPL or EVPLs on one port, sends frames with different VLAN tags into the provider, sees where each arrives, and reads the Circuit excerpt for the port.

import { computed, ref } from "vue";
import { useTravel } from "../travel";
import { Handoff, type Mode, type Service } from "./EvplHandoff";

const mode = ref<Mode>("evpl");
const bought = ref<Service["id"][]>(["branch"]);
const tag = ref<number | "none">(2010);

const PLACES = {
    office: { x: 80, y: 150 },
    provider: { x: 330, y: 150 },
    branch: { x: 590, y: 60 },
    dc: { x: 590, y: 240 },
};

function toggle(id: Service["id"]) {
    bought.value = bought.value.includes(id) ? bought.value.filter((entry) => entry !== id) : [...bought.value, id];
    said.value = undefined;
}

function choose(next: Mode) {
    mode.value = next;
    said.value = undefined;
}

/** Whether a far end is reached through this port at all. */
const reaches = (id: Service["id"]) => (mode.value === "epl" ? id === "branch" : bought.value.includes(id));

const code = computed(() => Handoff.code(mode.value, bought.value));

const said = ref<{ kind: string; word: string; text: string }>();
const { position, travelling, travel } = useTravel();

const tagText = computed(() => (tag.value === "none" ? "an untagged frame" : `a frame tagged ${tag.value}`));

async function send() {
    const start: [number, number] = [PLACES.office.x, PLACES.office.y];
    const middle: [number, number] = [PLACES.provider.x, PLACES.provider.y];
    said.value = undefined;

    if (mode.value === "epl") {
        await travel([start, middle, [PLACES.branch.x, PLACES.branch.y]]);
        said.value = {
            kind: "good",
            word: "Arrived",
            text: `With an EPL the whole port is one circuit. ${tagText.value.replace(/^./, (letter) => letter.toUpperCase())} reaches the branch office as it left, tag and all. The provider does not look at the tag.`,
        };
        return;
    }

    const service = Handoff.SERVICES.find((entry) => entry.vlan === tag.value && bought.value.includes(entry.id));

    if (!service) {
        await travel([start, middle]);
        const why =
            tag.value === "none" ? "In this example no circuit takes untagged frames." : `No circuit you bought uses VLAN ${tag.value}.`;
        said.value = {
            kind: "bad",
            word: "Dropped",
            text: `The provider reads the tag of each frame to pick its circuit. ${why} It drops the frame at the edge of its network.`,
        };
        return;
    }

    const place = PLACES[service.id];
    await travel([start, middle, [place.x, place.y]]);
    said.value = {
        kind: "good",
        word: "Arrived",
        text: `VLAN ${service.vlan} is the EVPL to ${service.place}, so the provider carries the frame there, and nowhere else. Each VLAN on the port is a circuit of its own.`,
    };
}
</script>

<template>
    <div class="evpl-handoff">
        <div class="ac-row modes" role="group" aria-label="What you bought">
            <button type="button" class="ac-button" :aria-pressed="mode === 'epl'" @click="choose('epl')">EPL: the whole port</button>
            <button type="button" class="ac-button" :aria-pressed="mode === 'evpl'" @click="choose('evpl')">
                EVPL: one VLAN per circuit
            </button>
        </div>

        <div v-if="mode === 'evpl'" class="ac-field">
            <span>EVPLs bought on this port</span>
            <div class="ac-row">
                <button
                    v-for="service in Handoff.SERVICES"
                    :key="service.id"
                    type="button"
                    class="ac-button small"
                    :aria-pressed="bought.includes(service.id)"
                    @click="toggle(service.id)"
                >
                    VLAN {{ service.vlan }} to {{ service.place }}
                </button>
            </div>
        </div>

        <svg
            class="ac-drawing"
            viewBox="0 0 700 310"
            role="img"
            :aria-label="`Your office router hands frames to the provider on one port. ${mode === 'epl' ? 'An EPL carries everything to the branch office.' : 'Each EVPL carries one VLAN to its own far end.'}`"
        >
            <line class="cable lit" :x1="PLACES.office.x" :y1="PLACES.office.y" :x2="PLACES.provider.x" :y2="PLACES.provider.y" />
            <text class="caption" x="205" y="140" text-anchor="middle">one port, {{ Handoff.PORT }}</text>
            <line
                v-for="service in Handoff.SERVICES"
                :key="service.id"
                class="cable"
                :class="{ lit: reaches(service.id), off: !reaches(service.id) }"
                :x1="PLACES.provider.x"
                :y1="PLACES.provider.y"
                :x2="PLACES[service.id].x"
                :y2="PLACES[service.id].y"
            />
            <text
                v-for="service in Handoff.SERVICES"
                :key="`t${service.id}`"
                class="caption"
                :x="(PLACES.provider.x + PLACES[service.id].x) / 2 + 10"
                :y="(PLACES.provider.y + PLACES[service.id].y) / 2 + (service.id === 'branch' ? -10 : 22)"
            >
                {{
                    mode === "epl"
                        ? service.id === "branch"
                            ? "everything"
                            : ""
                        : reaches(service.id)
                          ? `VLAN ${service.vlan}`
                          : "not bought"
                }}
            </text>

            <SvgDevice kind="router" :x="PLACES.office.x" :y="PLACES.office.y" label="Your office" />
            <SvgDevice kind="cloud" :x="PLACES.provider.x" :y="PLACES.provider.y" label="The provider" />
            <SvgDevice kind="router" :x="PLACES.branch.x" :y="PLACES.branch.y" label="Branch office" :dim="!reaches('branch')" />
            <SvgDevice kind="server" :x="PLACES.dc.x" :y="PLACES.dc.y" label="Data centre" :dim="!reaches('dc')" />

            <circle v-if="travelling" class="packet" :cx="position[0]" :cy="position[1]" r="9" />
        </svg>

        <div class="send">
            <label class="ac-field">
                <span>Send from your office</span>
                <select v-model="tag" class="ac-select">
                    <option value="none">an untagged frame</option>
                    <option v-for="vlan in [2010, 2020, 2030]" :key="vlan" :value="vlan">a frame tagged {{ vlan }}</option>
                </select>
            </label>
            <button type="button" class="ac-button primary" :disabled="travelling" @click="send">Send the frame</button>
        </div>

        <p v-if="said" class="ac-say" :class="said.kind" :data-word="said.word" aria-live="polite">{{ said.text }}</p>
        <p v-else class="ac-say hint" aria-live="polite">
            Send a frame tagged 2010, then 2020. Buy the second EVPL and send 2020 again, then switch to an EPL.
        </p>

        <CodeView :code="code" lang="ts" title="office.ts, the part for the provider's port" />
    </div>
</template>

<style scoped>
.modes {
    margin-bottom: 12px;
}

.cable.off {
    stroke-dasharray: 4 6;
    opacity: 0.45;
}

.ac-drawing .caption {
    fill: var(--circuit-soft);
    font-size: 12px;
}

.send {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: 10px;
    margin-top: 8px;
}

.hint {
    color: var(--circuit-soft);
}
</style>
