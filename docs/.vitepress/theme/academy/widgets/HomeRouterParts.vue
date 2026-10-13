<script setup lang="ts">
// Lesson: what is a network. The reader picks each job a home router does, sees where it sits in the one box at home, then sees the same jobs as separate boxes in an office.

import { computed, ref } from "vue";

type Job = "line" | "router" | "switch" | "wifi";

const jobs: { id: Job; name: string; home: string; office: string }[] = [
    {
        id: "line",
        name: "Talks to the provider's line",
        home: "The socket for the line from your provider, a fibre or a phone line. The box turns the light or the signal on that line into messages, a job called a modem. Some providers give you this part as a small box of its own.",
        office: "The provider's own box, where its line ends. In an office it usually stays a box of its own, owned by the provider.",
    },
    {
        id: "router",
        name: "Joins your home to the internet",
        home: "The router inside the box. It joins your home network to your provider's network, and passes every message for the internet out, and every answer back in to the right device.",
        office: "A router of its own, often with two lines from two providers, so the office stays online when one fails.",
    },
    {
        id: "switch",
        name: "Joins devices with a cable",
        home: "The few sockets on the back, usually four, are a small switch built into the box. A computer or a TV plugged into one of them is on the same network as everything else at home.",
        office: "A switch of its own, with 24 or 48 sockets, or several of them, one on each floor. Every desk and printer has its cable to one.",
    },
    {
        id: "wifi",
        name: "Joins devices without a cable",
        home: "The antennas, or the radio hidden inside the box, are a Wi-Fi access point. Phones and laptops join the network through it, as if they had a cable to the switch.",
        office: "Access points of their own, on the ceiling, one every few rooms, each joined to the switch by a cable.",
    },
];

const view = ref<"home" | "office">("home");
const chosen = ref<Job>();

const job = computed(() => jobs.find((entry) => entry.id === chosen.value));
const lit = (id: Job) => chosen.value === id;
</script>

<template>
    <div class="home-router-parts">
        <div class="ac-row" role="group" aria-label="Where">
            <button type="button" class="ac-button small" :aria-pressed="view === 'home'" @click="view = 'home'">At home: one box</button>
            <button type="button" class="ac-button small" :aria-pressed="view === 'office'" @click="view = 'office'">
                In an office: a box for each job
            </button>
        </div>

        <svg
            v-if="view === 'home'"
            class="ac-drawing"
            viewBox="0 0 640 230"
            role="img"
            aria-label="A home router: one box with antennas on top, and on its back a socket for the provider's line and four sockets for cables."
        >
            <line class="cable" :class="{ lit: lit('line') }" x1="40" y1="150" x2="150" y2="150" />
            <text x="40" y="138" class="small">line from your provider</text>

            <g :class="['part', { lit: lit('wifi') }]">
                <rect x="250" y="28" width="12" height="70" rx="5" />
                <rect x="440" y="28" width="12" height="70" rx="5" />
            </g>

            <rect class="box" :class="{ lit: lit('router') }" x="150" y="90" width="400" height="110" rx="10" />
            <circle class="lamp" cx="520" cy="112" r="6" />

            <g :class="['part', { lit: lit('line') }]">
                <rect x="172" y="132" width="44" height="36" rx="3" />
                <text x="194" y="190" text-anchor="middle" class="tag">LINE</text>
            </g>

            <g :class="['part', { lit: lit('switch') }]">
                <rect v-for="port in 4" :key="port" :x="272 + (port - 1) * 56" y="132" width="42" height="36" rx="3" />
                <text x="377" y="190" text-anchor="middle" class="tag">LAN 1 TO 4</text>
            </g>

            <line class="cable" :class="{ lit: lit('switch') }" x1="293" y1="168" x2="293" y2="222" />
            <line class="cable" :class="{ lit: lit('switch') }" x1="349" y1="168" x2="349" y2="222" />
        </svg>

        <svg
            v-else
            class="ac-drawing"
            viewBox="0 0 700 250"
            role="img"
            aria-label="An office: the provider's box, then a router, then a switch, with an access point and a desktop computer joined to the switch."
        >
            <line class="cable" :class="{ lit: lit('line') || lit('router') }" x1="60" y1="70" x2="240" y2="70" />
            <line class="cable" :class="{ lit: lit('router') || lit('switch') }" x1="240" y1="70" x2="420" y2="70" />
            <line class="cable" :class="{ lit: lit('switch') || lit('wifi') }" x1="420" y1="70" x2="600" y2="70" />
            <line class="cable" :class="{ lit: lit('switch') }" x1="420" y1="70" x2="420" y2="180" />

            <g :class="['modem', { lit: lit('line') }]" transform="translate(60 70)">
                <rect x="-26" y="-16" width="52" height="32" rx="3" />
                <circle cx="14" cy="0" r="4" />
                <text y="40" text-anchor="middle">Provider's box</text>
            </g>
            <SvgDevice kind="router" :x="240" :y="70" label="Router" :lit="lit('router')" :dim="!!chosen && !lit('router')" />
            <SvgDevice kind="switch" :x="420" :y="70" label="Switch" :lit="lit('switch')" :dim="!!chosen && !lit('switch')" />
            <SvgDevice kind="access-point" :x="600" :y="70" label="Access point" :lit="lit('wifi')" :dim="!!chosen && !lit('wifi')" />
            <SvgDevice kind="desktop" :x="420" :y="190" label="A desk" :dim="!!chosen && !lit('switch')" />
        </svg>

        <div class="jobs" role="group" aria-label="Jobs">
            <button
                v-for="entry in jobs"
                :key="entry.id"
                type="button"
                class="ac-button small"
                :aria-pressed="chosen === entry.id"
                @click="chosen = chosen === entry.id ? undefined : entry.id"
            >
                {{ entry.name }}
            </button>
        </div>

        <p v-if="job" class="ac-say" aria-live="polite">
            <strong>{{ job.name }}.</strong> {{ view === "home" ? job.home : job.office }}
        </p>
        <p v-else class="ac-say hint" aria-live="polite">Pick a job to see which part of the box does it. Then switch to the office.</p>
    </div>
</template>

<style scoped>
.ac-drawing {
    margin-top: 14px;
}

.box {
    fill: var(--circuit-cobalt);
    stroke: #0a1a36;
    stroke-width: 2.5;
    transition: fill 0.25s;
}

.box.lit {
    fill: var(--circuit-yellow);
}

.lamp {
    fill: var(--circuit-yellow);
    stroke: #0a1a36;
    stroke-width: 1.5;
}

.part rect {
    fill: #ffffff;
    stroke: #0a1a36;
    stroke-width: 2;
    transition: fill 0.25s;
}

.part.lit rect {
    fill: var(--circuit-yellow);
}

.ac-drawing .tag {
    fill: #ffffff;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.08em;
}

.box.lit ~ g .tag,
.part.lit .tag {
    fill: #0a1a36;
}

.ac-drawing .small {
    fill: var(--circuit-soft);
    font-size: 12px;
}

.modem rect {
    fill: var(--circuit-mist);
    stroke: var(--circuit-ink);
    stroke-width: 2;
    transition: fill 0.25s;
}

.modem circle {
    fill: var(--circuit-yellow);
}

.modem.lit rect {
    fill: var(--circuit-yellow);
    stroke: #0a1a36;
}

.modem text {
    font-size: 13px;
    font-weight: 700;
}

.jobs {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 12px;
}

.jobs .ac-button {
    white-space: normal;
    text-align: left;
}

.hint {
    color: var(--circuit-soft);
}
</style>
