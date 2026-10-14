<script setup lang="ts">
// Lesson: keeping the keys. The reader steps through how Circuit applies a change to a RouterOS router, once with a safe change and once with a change that turns SSH off.

import { computed, ref } from "vue";

const locksOut = ref(false);

const steps = computed(() => [
    {
        title: "Read the router and plan",
        text: "Circuit logs in over SSH as the user in connection, reads what the router runs right now, and makes the plan against it.",
    },
    {
        title: "Try every command without running it",
        text: "Each command is compiled on the router without being run. A typo or an unknown setting stops everything here, before anything has changed.",
    },
    {
        title: "Save a backup, set a timer",
        text: "The router saves a backup of what it runs now, and sets a timer that will load that backup in 10 minutes. The --rollback option changes the minutes.",
    },
    {
        title: "Send the plan",
        text: locksOut.value
            ? "The commands run one by one, and one of them turns SSH off."
            : "The commands run one by one. If the router refuses one, Circuit loads the backup at once.",
    },
    {
        title: "Log in again",
        text: locksOut.value
            ? "Circuit logs in again in a new session, to prove that the way in still works. Nothing answers: SSH is off."
            : "Circuit logs in again in a new session, to prove that the way in still works. It does.",
    },
    locksOut.value
        ? {
              title: "The router undoes the change by itself",
              text: "Circuit stops and tells you the change could not be confirmed. The timer is still set: when it runs out, the router loads the backup, with SSH on, and you can log in again. Fix the file before you apply again.",
          }
        : {
              title: "Keep the change",
              text: "Circuit removes the timer, and the backup too, since every password is in it. It saves a new snapshot of what the router runs, and the change is kept for good.",
          },
]);

const CABLE_LABELS = ["read", "compile only", "backup, timer", "commands", "new login", ""];

function toggle() {
    locksOut.value = !locksOut.value;
}
</script>

<template>
    <div class="safe-apply">
        <div class="ac-row choice">
            <button type="button" class="ac-button small" :aria-pressed="!locksOut" @click="locksOut && toggle()">A safe change</button>
            <button type="button" class="ac-button small" :aria-pressed="locksOut" @click="!locksOut && toggle()">
                A change that turns SSH off
            </button>
        </div>

        <StepThrough :steps="steps" v-slot="{ step }">
            <svg
                class="ac-drawing"
                viewBox="0 0 640 230"
                role="img"
                :aria-label="`Your computer running circuit apply, joined to the router. Step ${step + 1}: ${steps[step]?.title}.`"
            >
                <line
                    class="cable"
                    :class="{ lit: step < 4 || (step >= 4 && !locksOut), broken: step >= 4 && locksOut }"
                    x1="110"
                    y1="120"
                    x2="430"
                    y2="120"
                />
                <g v-if="CABLE_LABELS[step]" class="chip" transform="translate(270 92)">
                    <rect x="-62" y="-14" width="124" height="24" />
                    <text y="3" text-anchor="middle">{{ step >= 4 && locksOut ? "no answer" : CABLE_LABELS[step] }}</text>
                </g>

                <SvgDevice kind="laptop" :x="80" :y="120" label="Your computer" note="circuit apply" />
                <SvgDevice kind="router" :x="460" :y="120" label="Router" :lit="step === 5" />

                <g v-if="step >= 2" class="backup" :class="{ used: step === 5 && locksOut, gone: step === 5 && !locksOut }">
                    <rect x="525" y="40" width="96" height="44" />
                    <text x="573" y="58" text-anchor="middle">Backup</text>
                    <text x="573" y="75" text-anchor="middle" class="small">
                        {{ step === 5 ? (locksOut ? "loaded" : "removed") : "in 10 min" }}
                    </text>
                </g>
            </svg>
        </StepThrough>
    </div>
</template>

<style scoped>
.choice {
    margin-bottom: 12px;
}

.cable.broken {
    stroke: var(--circuit-removed);
    stroke-dasharray: 6 6;
}

.chip rect {
    fill: var(--circuit-paper);
    stroke: var(--circuit-ink);
    stroke-width: 1.5;
}

.chip text {
    font-size: 12.5px !important;
    font-weight: 700;
}

.backup rect {
    fill: var(--circuit-mist);
    stroke: var(--circuit-ink);
    stroke-width: 2;
}

.backup.used rect {
    fill: var(--circuit-yellow);
    stroke: #0a1a36;
}

.backup.used text {
    fill: #0a1a36 !important;
}

.backup.gone {
    opacity: 0.45;
}

.backup.gone rect {
    stroke-dasharray: 4 4;
}

.backup text {
    font-size: 13px !important;
    font-weight: 700;
}

.backup .small {
    font-size: 11.5px !important;
    font-weight: 600;
}
</style>
