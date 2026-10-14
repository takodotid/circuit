<script setup lang="ts">
// Lesson: messages in pieces. The reader types a message, picks a packet size and sends it; packets take two ways, arrive out of order, some are lost and asked for again, and the phone puts them back in order.

import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useTravel, type Point } from "../travel";

const MAX_LETTERS = 40;
const MAX_PACKETS = 10;

const sizes = [
    { letters: 4, name: "Small" },
    { letters: 8, name: "Medium" },
    { letters: 12, name: "Large" },
];

type Place = { kind: "laptop" | "phone" | "router"; label: string; x: number; y: number };

const places = {
    laptop: { kind: "laptop", label: "Laptop", x: 60, y: 150 },
    home: { kind: "router", label: "Home router", x: 175, y: 150 },
    quiet: { kind: "router", label: "Quiet way", x: 350, y: 55 },
    busy: { kind: "router", label: "Busy way", x: 350, y: 235 },
    friend: { kind: "router", label: "Friend’s router", x: 525, y: 150 },
    phone: { kind: "phone", label: "Friend’s phone", x: 640, y: 150 },
} satisfies Record<string, Place>;

type PlaceId = keyof typeof places;

const point = (id: PlaceId): Point => [places[id].x, places[id].y];

const cables: [PlaceId, PlaceId][] = [
    ["laptop", "home"],
    ["home", "quiet"],
    ["home", "busy"],
    ["quiet", "friend"],
    ["busy", "friend"],
    ["friend", "phone"],
];

const message = ref("Meet me at the station at five");
const size = ref(8);
const loseSome = ref(true);

/** The message cut into pieces of the chosen size. */
const pieces = computed(() => {
    const text = message.value.slice(0, MAX_LETTERS);
    const cut: string[] = [];
    for (let start = 0; start < text.length; start += size.value) cut.push(text.slice(start, start + size.value));
    return cut;
});

type Packet = {
    number: number;
    text: string;
    way: "quiet" | "busy";
    lost: boolean;
    state: "ready" | "moving" | "waiting" | "lost" | "arrived";
    again: boolean;
};

const packets = ref<Packet[]>([]);
const arrivals = ref<Packet[]>([]);
const run = ref(0);
const running = ref(false);
const finished = ref(false);
const asking = ref(false);
const said = ref<{ kind: "good" | "bad" | "warn"; word?: string; text: string }>();

// One traveller per packet, so every packet can be on its way at once.
const travellers = Array.from({ length: MAX_PACKETS }, () => useTravel());
const request = useTravel();

const timers = new Set<number>();
onBeforeUnmount(() => timers.forEach((timer) => clearTimeout(timer)));

function wait(milliseconds: number) {
    return new Promise<void>((resolve) => {
        const timer = window.setTimeout(() => {
            timers.delete(timer);
            resolve();
        }, milliseconds);
        timers.add(timer);
    });
}

/** The same run number always gives the same luck, so a run can be repeated. */
function luck(seed: number) {
    let state = seed * 2654435761;
    return () => {
        state = (state + 0x6d2b79f5) | 0;
        let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
        mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
        return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
    };
}

function prepare(seed: number): Packet[] {
    const random = luck(seed);
    const made: Packet[] = pieces.value.map((text, index) => ({
        number: index + 1,
        text,
        way: random() < 0.45 ? "busy" : "quiet",
        lost: loseSome.value && random() < 0.22,
        state: "ready",
        again: false,
    }));

    // Every run shows the ideas: one packet takes the busy way early enough to be overtaken, and one is lost when losing is on.
    if (made.length > 1 && !made.slice(0, -1).some((packet) => packet.way === "busy")) {
        made[Math.floor(random() * (made.length - 1))]!.way = "busy";
    }
    if (loseSome.value && made.length > 1 && !made.some((packet) => packet.lost)) {
        made[Math.floor(random() * made.length)]!.lost = true;
    }

    return made;
}

const listOf = (numbers: number[]) =>
    numbers.length === 1 ? `${numbers[0]}` : `${numbers.slice(0, -1).join(", ")} and ${numbers[numbers.length - 1]}`;

async function journey(packet: Packet, index: number) {
    const traveller = travellers[index]!;
    const middle = packet.way;

    packet.state = "moving";
    await traveller.travel([point("laptop"), point("home"), point(middle)]);

    if (packet.lost) {
        packet.state = "lost";
        return;
    }

    if (middle === "busy") {
        packet.state = "waiting";
        await wait(900);
        packet.state = "moving";
    }

    await traveller.travel([point(middle), point("friend"), point("phone")]);
    packet.state = "arrived";
    arrivals.value.push(packet);
}

async function send(seed: number) {
    if (!pieces.value.length) {
        said.value = { kind: "bad", word: "Empty", text: "Type a message first: there is nothing to cut into packets." };
        return;
    }

    run.value = seed;
    packets.value = prepare(seed);
    arrivals.value = [];
    finished.value = false;
    running.value = true;
    said.value = undefined;

    const journeys = packets.value.map(async (packet, index) => {
        await wait(index * 350);
        await journey(packet, index);
    });
    await Promise.all(journeys);

    const missing = packets.value.filter((packet) => packet.state === "lost");

    if (missing.length) {
        said.value = {
            kind: "warn",
            word: "Missing",
            text: `${missing.length === 1 ? "Packet" : "Packets"} ${listOf(missing.map((packet) => packet.number))} never came. The phone sees the gap in the numbers and asks the laptop to send ${missing.length === 1 ? "it" : "them"} again.`,
        };

        asking.value = true;
        await request.travel([point("phone"), point("friend"), point("quiet"), point("home"), point("laptop")]);
        asking.value = false;

        const resends = missing.map(async (packet, order) => {
            packet.lost = false;
            packet.way = "quiet";
            packet.again = true;
            await wait(order * 350);
            await journey(packet, packets.value.indexOf(packet));
        });
        await Promise.all(resends);
    }

    const order = arrivals.value.map((packet) => packet.number).join(", ");
    said.value = {
        kind: "good",
        text: `All ${packets.value.length} packets are in. They arrived in the order ${order}, and the phone put them back in order by their numbers.`,
    };
    running.value = false;
    finished.value = true;
}

// A changed message or size starts again from the ready packets.
watch([message, size, loseSome], () => {
    if (running.value) return;
    packets.value = [];
    arrivals.value = [];
    finished.value = false;
    said.value = undefined;
});

const shown = computed<Packet[]>(() =>
    packets.value.length
        ? packets.value
        : pieces.value.map((text, index) => ({ number: index + 1, text, way: "quiet", lost: false, state: "ready", again: false }))
);

/** The packets on their way, drawn where their traveller is now. */
const dots = computed(() =>
    packets.value
        .map((packet, index) => ({ packet, position: travellers[index]!.position.value }))
        .filter(({ packet }) => packet.state === "moving" || packet.state === "waiting")
);

const ways = ["quiet", "busy"] as const;

/** The numbers of the packets lost on one way. */
const lostOn = (way: Packet["way"]) =>
    packets.value.filter((packet) => packet.state === "lost" && packet.way === way).map((packet) => packet.number);

/** What the phone has, slot by slot, in the order of the numbers. */
const slots = computed(() =>
    shown.value.map((packet) => ({
        number: packet.number,
        text: packet.state === "arrived" ? packet.text : undefined,
        missing: packet.state === "lost",
    }))
);
</script>

<template>
    <div class="packet-journey">
        <div class="setup">
            <label class="ac-field message">
                <span>1. Type a message (up to {{ MAX_LETTERS }} letters)</span>
                <input v-model="message" class="ac-input" :maxlength="MAX_LETTERS" :disabled="running" />
            </label>

            <div class="ac-field">
                <span>2. Pick a packet size</span>
                <div class="ac-row">
                    <button
                        v-for="option in sizes"
                        :key="option.letters"
                        type="button"
                        class="ac-button small"
                        :aria-pressed="size === option.letters"
                        :disabled="running"
                        @click="size = option.letters"
                    >
                        {{ option.name }}: {{ option.letters }} letters
                    </button>
                </div>
            </div>

            <div class="ac-field">
                <span>3. On the way</span>
                <div class="ac-row">
                    <button
                        type="button"
                        class="ac-button small"
                        :aria-pressed="loseSome"
                        :disabled="running"
                        @click="loseSome = !loseSome"
                    >
                        Lose some packets: {{ loseSome ? "on" : "off" }}
                    </button>
                </div>
            </div>
        </div>

        <p class="caption">
            The message as {{ shown.length }} {{ shown.length === 1 ? "packet" : "packets" }}. Each one says who sent it, who it is for, and
            its number.
        </p>
        <ol class="cards">
            <li v-for="packet in shown" :key="packet.number" class="card" :class="packet.state">
                <span class="number">No. {{ packet.number }} of {{ shown.length }}</span>
                <span class="who">Laptop → Friend’s phone</span>
                <span class="piece">{{ packet.text }}</span>
            </li>
        </ol>

        <svg
            class="ac-drawing"
            viewBox="0 0 700 300"
            role="img"
            aria-label="A laptop joined to a home router. From there two ways, a quiet one and a busy one, lead to a friend’s router and the friend’s phone."
        >
            <line
                v-for="[from, to] in cables"
                :key="`${from}-${to}`"
                class="cable"
                :x1="places[from].x"
                :y1="places[from].y"
                :x2="places[to].x"
                :y2="places[to].y"
            />

            <SvgDevice v-for="(place, id) in places" :key="id" :kind="place.kind" :x="place.x" :y="place.y" :label="place.label" />

            <template v-for="way in ways" :key="way">
                <text v-if="lostOn(way).length" class="dropped" :x="places[way].x + 40" :y="places[way].y + (way === 'quiet' ? -18 : 26)">
                    Lost here: {{ lostOn(way).join(", ") }}
                </text>
            </template>

            <g v-for="dot in dots" :key="dot.packet.number" :transform="`translate(${dot.position[0]} ${dot.position[1]})`">
                <circle class="packet" r="12" />
                <text class="packet-number" text-anchor="middle" dy="4">{{ dot.packet.number }}</text>
            </g>

            <g v-if="asking" :transform="`translate(${request.position.value[0]} ${request.position.value[1]})`">
                <circle class="ask" r="12" />
                <text class="ask-mark" text-anchor="middle" dy="4">?</text>
            </g>
        </svg>

        <div class="phone">
            <p class="caption">What the friend’s phone has received, in the order it came:</p>
            <ol class="arrived">
                <li v-for="packet in arrivals" :key="`${packet.number}-${packet.again}`" :class="{ again: packet.again }">
                    {{ packet.number }}<span v-if="packet.again" class="again-word"> again</span>
                </li>
                <li v-if="!arrivals.length" class="nothing">nothing yet</li>
            </ol>

            <p class="caption">Put back in order by number:</p>
            <ol class="slots">
                <li v-for="slot in slots" :key="slot.number" :class="{ filled: slot.text !== undefined, missing: slot.missing }">
                    <span class="slot-number">{{ slot.number }}</span>
                    <span class="slot-text">{{ slot.text ?? (slot.missing ? "missing" : "…") }}</span>
                </li>
            </ol>

            <p v-if="finished" class="whole">
                The phone shows: <strong>{{ packets.map((packet) => packet.text).join("") }}</strong>
            </p>
        </div>

        <div class="ac-row actions">
            <button type="button" class="ac-button primary" :disabled="running" @click="send(run + 1)">Send the message</button>
            <button v-if="run > 0" type="button" class="ac-button" :disabled="running" @click="send(run)">Send run {{ run }} again</button>
        </div>

        <p v-if="said" class="ac-say" :class="said.kind" :data-word="said.word" aria-live="polite">{{ said.text }}</p>
        <p v-else-if="running" class="ac-say hint" aria-live="polite">Run {{ run }}: the packets are on their way. Watch the busy way.</p>
        <p v-else class="ac-say hint" aria-live="polite">
            Press Send the message. Which way each packet takes, and which ones get lost, is chosen at random. Each run has a number, and
            sending the same run again gives the same result.
        </p>
    </div>
</template>

<style scoped>
.setup {
    display: grid;
    gap: 14px;
}

.message .ac-input {
    width: 100%;
}

.caption {
    margin: 18px 0 8px;
    color: var(--circuit-soft);
    font-size: 14px;
    line-height: 1.5;
}

.cards,
.arrived,
.slots {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 0 !important;
    padding: 0 !important;
    list-style: none;
}

.cards li,
.arrived li,
.slots li {
    margin: 0 !important;
}

.card {
    display: grid;
    gap: 1px;
    min-width: 108px;
    padding: 6px 8px;
    border: 1.5px solid var(--circuit-ink);
    border-radius: 2px;
    background: var(--circuit-paper);
    font-size: 12px;
    line-height: 1.35;
    transition:
        opacity 0.25s,
        border-color 0.25s;
}

.card.lost {
    border-color: var(--circuit-removed);
    border-style: dashed;
}

.card.moving,
.card.waiting {
    opacity: 0.5;
}

.number {
    font-weight: 700;
}

.who {
    color: var(--circuit-soft);
}

.piece,
.slot-text {
    justify-self: start;
    padding: 0 2px;
    background: var(--circuit-mist);
    font-family: var(--circuit-mono);
    font-size: 13px;
    white-space: pre;
}

.missing .slot-text {
    background: none;
}

.dropped {
    fill: var(--circuit-removed) !important;
    font-size: 12px !important;
    font-weight: 700;
}

.packet-number {
    fill: #0a1a36 !important;
    font-size: 12px !important;
    font-weight: 700;
}

.ask {
    fill: var(--circuit-paper);
    stroke: var(--circuit-link);
    stroke-width: 2.5;
}

.ask-mark {
    fill: var(--circuit-link) !important;
    font-weight: 700;
}

.phone {
    padding-top: 4px;
}

.arrived li {
    display: grid;
    place-items: center;
    min-width: 32px;
    height: 32px;
    padding: 0 8px;
    border: 1.5px solid var(--circuit-ink);
    border-radius: 2px;
    background: var(--circuit-yellow);
    color: #0a1a36;
    font-weight: 700;
}

.arrived li.again {
    border-style: dashed;
    background: var(--circuit-paper);
    color: var(--circuit-ink);
}

.again-word {
    font-size: 12px;
    font-weight: 600;
}

.arrived li.nothing {
    border-color: var(--circuit-line);
    background: none;
    color: var(--circuit-soft);
    font-weight: 400;
}

.slots li {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 32px;
    padding: 2px 8px 2px 2px;
    border: 1.5px dashed var(--circuit-line);
    border-radius: 2px;
}

.slots li.filled {
    border: 1.5px solid var(--circuit-ink);
}

.slots li.missing {
    border-color: var(--circuit-removed);
    color: var(--circuit-removed);
}

.slot-number {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    background: var(--circuit-mist);
    font-size: 12px;
    font-weight: 700;
}

.whole {
    margin: 14px 0 0;
    font-size: 16px;
}

.actions {
    margin-top: 16px;
}

.hint {
    color: var(--circuit-soft);
}
</style>
