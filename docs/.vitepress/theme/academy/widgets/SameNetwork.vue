<script setup lang="ts">
// Lesson: reading an IP address. A game of nine pairs: the reader says whether two devices are on the same network, then sees their network parts side by side.

import { computed, ref } from "vue";
import { Ipv4 } from "./PrefixSlider";

type Pair = { first: string; second: string; prefix: number; asMask?: boolean };

const pairs: Pair[] = [
    { first: "192.168.1.20", second: "192.168.1.200", prefix: 24 },
    { first: "192.168.1.20", second: "192.168.2.20", prefix: 24 },
    { first: "10.0.5.9", second: "10.200.1.1", prefix: 8 },
    { first: "172.16.4.10", second: "172.17.4.10", prefix: 16 },
    { first: "192.168.10.5", second: "192.168.10.250", prefix: 24, asMask: true },
    { first: "192.168.1.20", second: "192.168.1.100", prefix: 25 },
    { first: "192.168.1.100", second: "192.168.1.130", prefix: 25 },
    { first: "10.1.1.5", second: "10.1.1.6", prefix: 30 },
    { first: "10.1.1.6", second: "10.1.1.9", prefix: 30 },
];

const read = (text: string) => (Ipv4.parse(text) as { value: number }).value;

const index = ref(0);
const picked = ref<boolean>();
const score = ref(0);

const pair = computed(() => pairs[index.value]!);
const first = computed(() => read(pair.value.first));
const second = computed(() => read(pair.value.second));
const firstNetwork = computed(() => Ipv4.network(first.value, pair.value.prefix));
const secondNetwork = computed(() => Ipv4.network(second.value, pair.value.prefix));
const same = computed(() => firstNetwork.value === secondNetwork.value);
const answered = computed(() => picked.value !== undefined);
const last = computed(() => index.value === pairs.length - 1);

const sizeText = computed(() => (pair.value.asMask ? `the mask ${Ipv4.format(Ipv4.mask(pair.value.prefix))}` : `/${pair.value.prefix}`));

function answer(sameNetwork: boolean) {
    if (answered.value) return;
    picked.value = sameNetwork;
    if (sameNetwork === same.value) score.value++;
}

function next() {
    if (last.value) {
        index.value = 0;
        score.value = 0;
    } else {
        index.value++;
    }
    picked.value = undefined;
}

/** Both addresses as bits, with the network bits marked, and whether each network bit matches. */
const rows = computed(() => {
    const firstBits = Ipv4.bits(first.value);
    const secondBits = Ipv4.bits(second.value);
    const prefix = pair.value.prefix;

    const cells = (bits: number[]) => bits.map((bit, place) => ({ bit, network: place < prefix, group: Math.floor(place / 8) }));
    const compare = firstBits.map((bit, place) => (place < prefix ? (bit === secondBits[place] ? "=" : "≠") : ""));

    return { first: cells(firstBits), second: cells(secondBits), compare };
});

const groupsOf = <T,>(cells: T[]) => [0, 1, 2, 3].map((group) => cells.slice(group * 8, group * 8 + 8));

const verdict = computed(() => {
    const prefix = pair.value.prefix;
    const networks = `With ${sizeText.value}, the first ${prefix} bits are the network. The laptop’s network is ${Ipv4.format(firstNetwork.value)}, the printer’s is ${Ipv4.format(secondNetwork.value)}.`;
    return same.value
        ? `${networks} They match, so they are on the same network.`
        : `${networks} They differ, so they are on different networks.`;
});
</script>

<template>
    <div class="same-network">
        <p class="count">
            Pair {{ index + 1 }} of {{ pairs.length }} <span class="score">Score: {{ score }}</span>
        </p>

        <svg
            class="ac-drawing"
            viewBox="0 0 600 120"
            role="img"
            :aria-label="`A laptop with the address ${pair.first} and a printer with the address ${pair.second}, both using ${sizeText}.`"
        >
            <SvgDevice kind="laptop" :x="150" :y="45" label="Laptop" :note="pair.first" />
            <SvgDevice kind="printer" :x="450" :y="45" label="Printer" :note="pair.second" />
            <text class="question" x="300" y="50" text-anchor="middle">same network?</text>
        </svg>

        <p class="setting">
            Both devices use <strong class="ac-mono">{{ sizeText }}</strong
            >.
        </p>

        <div class="ac-row">
            <button
                type="button"
                class="ac-button"
                :class="{ primary: !answered }"
                :aria-pressed="picked === true"
                :disabled="answered && picked !== true"
                @click="answer(true)"
            >
                Same network
            </button>
            <button
                type="button"
                class="ac-button"
                :class="{ primary: !answered }"
                :aria-pressed="picked === false"
                :disabled="answered && picked !== false"
                @click="answer(false)"
            >
                Different networks
            </button>
        </div>

        <template v-if="answered">
            <div class="compare" aria-hidden="true">
                <div class="line">
                    <span class="who">Laptop</span>
                    <span v-for="(group, number) in groupsOf(rows.first)" :key="number" class="cells">
                        <span v-for="(cell, place) in group" :key="place" class="cell" :class="{ network: cell.network }">{{
                            cell.bit
                        }}</span>
                    </span>
                </div>
                <div class="line">
                    <span class="who">Printer</span>
                    <span v-for="(group, number) in groupsOf(rows.second)" :key="number" class="cells">
                        <span v-for="(cell, place) in group" :key="place" class="cell" :class="{ network: cell.network }">{{
                            cell.bit
                        }}</span>
                    </span>
                </div>
                <div class="line marks">
                    <span class="who">Match</span>
                    <span v-for="(group, number) in groupsOf(rows.compare)" :key="number" class="cells">
                        <span v-for="(mark, place) in group" :key="place" class="cell mark" :class="{ differs: mark === '≠' }">{{
                            mark
                        }}</span>
                    </span>
                </div>
            </div>

            <p
                class="ac-say"
                :class="picked === same ? 'good' : 'bad'"
                :data-word="picked === same ? 'Right' : 'Not this time'"
                aria-live="polite"
            >
                {{ verdict }}
            </p>

            <div class="ac-row next">
                <button type="button" class="ac-button primary" @click="next">{{ last ? "Play again" : "Next pair" }}</button>
                <span v-if="last" class="final">You got {{ score }} of {{ pairs.length }} right.</span>
            </div>
        </template>
        <p v-else class="ac-say hint" aria-live="polite">
            Look at the first {{ pair.prefix }} bits of each address. Are they the same? Pick an answer.
        </p>
    </div>
</template>

<style scoped>
.count {
    display: flex;
    justify-content: space-between;
    margin: 0;
    color: var(--circuit-soft);
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
}

.score {
    color: var(--circuit-ink);
}

.question {
    fill: var(--circuit-soft) !important;
    font-size: 15px !important;
    font-weight: 700;
}

.setting {
    margin: 4px 0 12px;
    font-size: 16px;
}

.compare {
    display: grid;
    gap: 3px;
    margin-top: 16px;
    overflow-x: auto;
}

.line {
    display: flex;
    align-items: center;
    gap: 6px;
    width: max-content;
}

.who {
    width: 56px;
    color: var(--circuit-soft);
    font-size: 12.5px;
    font-weight: 700;
}

.cells {
    display: flex;
}

.cell {
    display: grid;
    place-items: center;
    width: 15px;
    height: 22px;
    background: var(--circuit-paper);
    color: var(--circuit-soft);
    font-family: var(--circuit-mono);
    font-size: 12px;
}

.cell.network {
    background: var(--circuit-cobalt);
    color: #ffffff;
}

.cell.mark {
    background: none;
    color: var(--circuit-added);
    font-weight: 700;
}

.cell.mark.differs {
    color: var(--circuit-removed);
    outline: 1.5px dashed var(--circuit-removed);
    outline-offset: -1.5px;
}

.next {
    margin-top: 12px;
}

.final {
    font-weight: 700;
}

.hint {
    color: var(--circuit-soft);
}
</style>
