<script setup lang="ts">
// Lesson: messages in pieces. A laptop sends a video and a phone a short chat message over one shared cable; the reader cuts them into packets or not, adds noise, and sees who waits and what must be sent again.

import { computed, onBeforeUnmount, ref } from "vue";

const VIDEO_LENGTH = 12;
const CHAT_LENGTH = 2;
const CHAT_READY_AT = 2;
const NOISE_AT = 5;

type Sender = "video" | "chat";

type Slot = {
    moment: number;
    sender: Sender;
    label: string;
    /** Part of one big piece with the slot before it. */
    joined: boolean;
    damaged: boolean;
    again: boolean;
};

const cut = ref(false);
const noise = ref(false);

/** What crosses the cable at each moment. */
const slots = computed<Slot[]>(() => {
    const result: Slot[] = [];
    const add = (sender: Sender, label: string, joined: boolean, again = false) => {
        const moment = result.length + 1;
        result.push({ moment, sender, label, joined, damaged: noise.value && moment === NOISE_AT, again });
    };

    if (!cut.value) {
        // One big piece each: the chat waits until the whole video has crossed.
        for (let part = 0; part < VIDEO_LENGTH; part++) add("video", "V", part > 0);
        for (let part = 0; part < CHAT_LENGTH; part++) add("chat", "C", part > 0);

        const videoDamaged = result.some((slot) => slot.sender === "video" && slot.damaged);
        if (videoDamaged) for (let part = 0; part < VIDEO_LENGTH; part++) add("video", "V", part > 0, true);

        return result;
    }

    // Packets: the laptop and the phone take turns while both have something to send.
    const videoQueue = Array.from({ length: VIDEO_LENGTH }, (_, index) => `V${index + 1}`);
    const chatQueue = Array.from({ length: CHAT_LENGTH }, (_, index) => `C${index + 1}`);
    const resend: string[] = [];
    let last: Sender = "chat";

    while (videoQueue.length || chatQueue.length || resend.length) {
        const moment = result.length + 1;
        const chatReady = chatQueue.length > 0 && moment >= CHAT_READY_AT;
        const videoReady = videoQueue.length > 0 || resend.length > 0;
        const sender: Sender = chatReady && (!videoReady || last === "video") ? "chat" : "video";

        if (sender === "chat") {
            add("chat", chatQueue.shift()!, false);
        } else if (videoQueue.length) {
            add("video", videoQueue.shift()!, false);
        } else {
            add("video", resend.shift()!, false, true);
        }

        const sent = result[result.length - 1]!;
        if (sent.damaged) resend.push(sent.label);
        last = sender;
    }

    return result;
});

/** The moment each sender's last piece crossed without damage. */
const doneAt = (sender: Sender) =>
    Math.max(...slots.value.filter((slot) => slot.sender === sender && !slot.damaged).map((slot) => slot.moment));

const now = ref(0);
const playing = ref(false);
const played = ref(false);
let timer = 0;

onBeforeUnmount(() => clearInterval(timer));

function reset() {
    clearInterval(timer);
    playing.value = false;
    played.value = false;
    now.value = 0;
}

function choose(change: () => void) {
    change();
    reset();
}

function send() {
    reset();

    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
        now.value = slots.value.length;
        played.value = true;
        return;
    }

    playing.value = true;
    timer = window.setInterval(() => {
        if (now.value < slots.value.length) {
            now.value++;
            return;
        }

        clearInterval(timer);
        playing.value = false;
        played.value = true;
    }, 200);
}

/** What is on the shared cable at this moment, while sending. */
const onCable = computed(() => (playing.value && now.value > 0 ? slots.value[now.value - 1] : undefined));

const result = computed(() => {
    const chat = doneAt("chat");
    const video = doneAt("video");
    const damaged = slots.value.find((slot) => slot.damaged);

    const waiting = cut.value
        ? `The laptop and the phone took turns, so the chat message was through at moment ${chat}.`
        : `The chat message is only ${CHAT_LENGTH} moments long, but it waited behind the whole video and was through at moment ${chat}.`;

    const lost = !damaged
        ? `The video was through at moment ${video}.`
        : cut.value
          ? `Noise at moment ${NOISE_AT} damaged one packet, ${damaged.label}. Only that packet was sent again, so the video was through at moment ${video}.`
          : `Noise at moment ${NOISE_AT} damaged the video, and because it was one big piece, all ${VIDEO_LENGTH} moments of it were sent again. It was through at moment ${video}.`;

    return `${waiting} ${lost}`;
});
</script>

<template>
    <div class="shared-cable">
        <svg
            class="ac-drawing"
            viewBox="0 0 700 200"
            role="img"
            aria-label="A laptop and a phone joined to a home router, which has one cable to the internet. Whatever crosses that cable now is shown on it."
        >
            <line class="cable" x1="80" y1="50" x2="260" y2="100" />
            <line class="cable" x1="80" y1="150" x2="260" y2="100" />
            <line class="cable" :class="{ lit: onCable }" x1="260" y1="100" x2="610" y2="100" />

            <SvgDevice kind="laptop" :x="80" :y="50" label="Laptop: video" />
            <SvgDevice kind="phone" :x="80" :y="150" label="Phone: chat" />
            <SvgDevice kind="router" :x="260" :y="100" label="Home router" />
            <SvgDevice kind="cloud" :x="610" :y="100" label="The internet" />

            <text class="cable-note" x="435" y="135" text-anchor="middle">One cable: one thing at a time</text>

            <g v-if="onCable" :transform="`translate(435 100)`">
                <rect class="on-cable" :class="[onCable.sender, { damaged: onCable.damaged }]" x="-26" y="-14" width="52" height="28" />
                <text class="on-cable-label" :class="onCable.sender" text-anchor="middle" dy="5">{{ onCable.label }}</text>
            </g>
        </svg>

        <div class="ac-row">
            <button type="button" class="ac-button small" :aria-pressed="cut" :disabled="playing" @click="choose(() => (cut = !cut))">
                Cut into packets: {{ cut ? "on" : "off" }}
            </button>
            <button type="button" class="ac-button small" :aria-pressed="noise" :disabled="playing" @click="choose(() => (noise = !noise))">
                Noise at moment {{ NOISE_AT }}: {{ noise ? "on" : "off" }}
            </button>
            <button type="button" class="ac-button primary" :disabled="playing" @click="send">Send both</button>
        </div>

        <p class="caption">What crossed the cable, moment by moment{{ now ? `: moment ${now}` : "" }}</p>
        <ol class="track" :aria-label="`${slots.length} moments`">
            <li
                v-for="slot in slots"
                :key="slot.moment"
                :class="[slot.sender, { joined: slot.joined, damaged: slot.damaged, again: slot.again, shown: slot.moment <= now }]"
                :title="`Moment ${slot.moment}`"
            >
                <span v-if="slot.moment <= now">{{ slot.label }}</span>
            </li>
        </ol>
        <p class="legend">
            <span class="key video">V</span> the laptop’s video <span class="key chat">C</span> the phone’s chat message
            <span class="key damaged">✕</span> damaged by noise <span class="key again">V</span> sent again
        </p>

        <p v-if="played" class="ac-say good" data-word="Done" aria-live="polite">{{ result }}</p>
        <p v-else-if="playing" class="ac-say hint" aria-live="polite">Sending…</p>
        <p v-else class="ac-say hint" aria-live="polite">
            Press Send both with packets off, then turn them on and send again. Watch when the chat message gets through.
        </p>
    </div>
</template>

<style scoped>
.ac-row {
    margin-top: 8px;
}

.cable-note {
    fill: var(--circuit-soft) !important;
    font-size: 12px !important;
}

.on-cable.video {
    fill: var(--circuit-cobalt);
    stroke: #0a1a36;
    stroke-width: 1.5;
}

.on-cable.chat {
    fill: var(--circuit-yellow);
    stroke: #0a1a36;
    stroke-width: 1.5;
}

.on-cable.damaged {
    stroke: var(--circuit-removed);
    stroke-width: 3;
    stroke-dasharray: 5 3;
}

.on-cable-label {
    font-weight: 700;
}

.on-cable-label.video {
    fill: #ffffff !important;
}

.on-cable-label.chat {
    fill: #0a1a36 !important;
}

.caption {
    margin: 18px 0 8px;
    color: var(--circuit-soft);
    font-size: 14px;
}

.track {
    display: grid;
    grid-template-columns: repeat(13, minmax(0, 1fr));
    row-gap: 6px;
    margin: 0 !important;
    padding: 0 !important;
    list-style: none;
}

.track li {
    display: grid;
    place-items: center;
    height: 34px;
    margin: 0 !important;
    border: 1.5px dashed var(--circuit-line);
    border-left-width: 1.5px;
    font-family: var(--circuit-mono);
    font-size: 12px;
    font-weight: 700;
    overflow: hidden;
}

.track li + li {
    margin-left: 3px !important;
}

.track li:nth-child(13n + 1) {
    margin-left: 0 !important;
}

.track li.shown.video {
    border: 1.5px solid #0a1a36;
    background: var(--circuit-cobalt);
    color: #ffffff;
}

.track li.shown.chat {
    border: 1.5px solid #0a1a36;
    background: var(--circuit-yellow);
    color: #0a1a36;
}

/* One big piece reads as one bar: no gap and no border between its moments. */
.track li.joined {
    margin-left: 0 !important;
    border-left: none;
}

.track li.shown.joined {
    border-left: none;
}

.track li.shown.damaged {
    border: 2px dashed var(--circuit-removed);
    background: var(--circuit-paper);
    color: var(--circuit-removed);
}

.track li.shown.again {
    border: 2px dotted var(--circuit-ink);
    background: var(--circuit-paper);
    color: var(--circuit-ink);
}

.legend {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 8px;
    margin: 10px 0 0;
    color: var(--circuit-soft);
    font-size: 13.5px;
}

.key {
    display: inline-grid;
    place-items: center;
    width: 22px;
    height: 22px;
    font-family: var(--circuit-mono);
    font-size: 12px;
    font-weight: 700;
}

.key.video {
    background: var(--circuit-cobalt);
    color: #ffffff;
}

.key.chat {
    background: var(--circuit-yellow);
    color: #0a1a36;
}

.key.damaged {
    border: 2px dashed var(--circuit-removed);
    color: var(--circuit-removed);
}

.key.again {
    border: 2px dotted var(--circuit-ink);
    color: var(--circuit-ink);
}

.hint {
    color: var(--circuit-soft);
}

@media (max-width: 480px) {
    .track li {
        font-size: 10px;
    }
}
</style>
