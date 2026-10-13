<script setup lang="ts">
// Lesson: trunks. The reader types a VLAN ID and sees it as the twelve bits of an 802.1Q tag, finds where the range 1 to 4094 comes from, and sees what `circuit validate` says about each number.

import { computed, ref } from "vue";

const typed = ref("20");

const PLACES = [2048, 1024, 512, 256, 128, 64, 32, 16, 8, 4, 2, 1];

// The fixed first half of every tag, 0x8100, which says "a VLAN tag follows".
const MARKER = "1000000100000000";

const frameParts = [
    { name: "To", size: "6 bytes" },
    { name: "From", size: "6 bytes" },
    { name: "VLAN tag", size: "4 bytes", tag: true },
    { name: "Type", size: "2 bytes" },
    { name: "Packet", size: "up to 1500 bytes" },
    { name: "Check", size: "4 bytes" },
];

const id = computed(() => {
    const text = typed.value.trim();
    return /^-?\d+(\.\d+)?$/.test(text) ? Number(text) : undefined;
});

/** The twelve bits of the ID, or undefined when it does not fit in them. */
const bits = computed(() => {
    const value = id.value;
    if (value === undefined || !Number.isInteger(value) || value < 0 || value > 4095) return undefined;

    return PLACES.map((place) => (Math.floor(value / place) % 2 === 1 ? "1" : "0"));
});

const verdict = computed<{ kind: "good" | "bad" | "warn"; word: string; text: string }>(() => {
    const value = id.value;

    if (value === undefined) return { kind: "bad", word: "Not a number", text: "Type a whole number, such as 20." };
    if (!Number.isInteger(value))
        return { kind: "bad", word: "Not whole", text: "Bits only count whole numbers, so a VLAN ID is always a whole number." };
    if (value < 0) return { kind: "bad", word: "Too small", text: "Bits count up from 0. There is no negative VLAN ID." };
    if (value > 4095) {
        const needed = value.toString(2).length;
        return {
            kind: "bad",
            word: "Too big",
            text: `Twelve bits stop at 4095, all twelve on. ${value} needs ${needed} bits, and the tag has room for 12.`,
        };
    }
    if (value === 0)
        return {
            kind: "warn",
            word: "Kept back",
            text: "0 fits in twelve bits, but on the wire it means a frame with a priority and no VLAN. It cannot name a VLAN.",
        };
    if (value === 4095)
        return {
            kind: "warn",
            word: "Kept back",
            text: "4095 is all twelve bits on. The standard keeps it back, so it cannot name a VLAN either.",
        };

    return {
        kind: "good",
        word: "Fits",
        text: `VLAN ${value} fits in the tag's twelve bits. That leaves 1 to 4094 for VLANs: 4094 networks on one cable.`,
    };
});

/** The switch's VLANs with the one the reader typed as guests. */
const file = computed(() =>
    [
        "vlans: {",
        '    home: { id: 20, description: "Home" },',
        `    guests: { id: ${id.value}, description: "Guests" },`,
        '    cameras: { id: 40, description: "Cameras" },',
        "},",
    ].join("\n")
);

/** What `circuit validate` prints for that file, in its own words. */
const validation = computed(() => {
    const value = id.value!;
    let error: string | undefined;

    if (!Number.isInteger(value) || value < 1 || value > 4094) error = `VLAN guests id ${value} is outside 1-4094`;
    else if (value === 20) error = "VLANs home and guests share id 20";
    else if (value === 40) error = "VLANs guests and cameras share id 40";

    return error ? `$ npx circuit validate\n  error  switch: ${error}\n\n1 error(s).` : "$ npx circuit validate\n1 device(s), no errors.";
});
</script>

<template>
    <div class="tag-bits">
        <p class="caption">A frame on a trunk, with the tag inside the frame header:</p>
        <ol class="frame" aria-label="The parts of a tagged frame, in order">
            <li v-for="part in frameParts" :key="part.name" :class="{ tag: part.tag }">
                <strong>{{ part.name }}</strong>
                <span>{{ part.size }}</span>
            </li>
        </ol>

        <label class="ac-field id-field">
            <span>VLAN ID</span>
            <input v-model="typed" class="ac-input mono" inputmode="numeric" :aria-invalid="verdict.kind === 'bad'" />
        </label>

        <p class="caption">The tag's 32 bits:</p>
        <div
            class="bits"
            role="img"
            :aria-label="
                bits ? `Tag bits: marker ${MARKER}, priority 000, drop 0, VLAN ID ${bits.join('')}` : 'The VLAN ID does not fit in the tag'
            "
        >
            <div class="group">
                <span class="cells">{{ MARKER.slice(0, 8) }} {{ MARKER.slice(8) }}</span>
                <span class="name">16 bits: a tag follows</span>
            </div>
            <div class="group">
                <span class="cells">000</span>
                <span class="name">3: priority</span>
            </div>
            <div class="group">
                <span class="cells">0</span>
                <span class="name">1: drop first</span>
            </div>
            <div class="group vid" :class="{ none: !bits }">
                <span class="cells">{{ bits ? bits.join("") : "does not fit" }}</span>
                <span class="name">12 bits: the VLAN ID</span>
            </div>
        </div>

        <table v-if="bits" class="ac-table places">
            <tbody>
                <tr>
                    <td v-for="place in PLACES" :key="place">{{ place }}</td>
                </tr>
                <tr>
                    <td v-for="(bit, index) in bits" :key="index" :class="{ on: bit === '1' }">{{ bit }}</td>
                </tr>
            </tbody>
        </table>

        <p class="ac-say" :class="verdict.kind" :data-word="verdict.word" aria-live="polite">{{ verdict.text }}</p>

        <template v-if="id !== undefined">
            <CodeView :code="file" lang="ts" title="switch.ts, the VLANs" :highlight="[3]" />
            <CodeView :code="validation" lang="shell" title="Terminal" />
        </template>
    </div>
</template>

<style scoped>
.caption {
    margin: 0 0 8px !important;
    color: var(--circuit-soft);
    font-size: 14px !important;
}

.frame {
    display: flex;
    flex-wrap: wrap;
    gap: 0;
    margin: 0 0 16px !important;
    padding: 0 !important;
    border: 2px solid var(--circuit-ink);
    list-style: none;
}

.frame li {
    display: grid;
    flex: 1 1 auto;
    gap: 0;
    margin: 0 !important;
    padding: 6px 10px;
    border-right: 1px solid var(--circuit-line);
    font-size: 13.5px;
    line-height: 1.35;
}

.frame li span {
    color: var(--circuit-soft);
    font-size: 12px;
}

.frame li.tag {
    background: var(--circuit-yellow);
    color: #0a1a36;
}

.frame li.tag span {
    color: #0a1a36;
}

.id-field {
    max-width: 180px;
    margin-bottom: 14px;
}

.bits {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
}

.group {
    display: grid;
    gap: 2px;
    padding: 6px 10px;
    border: 1.5px solid var(--circuit-line);
}

.group.vid {
    border: 2px solid var(--circuit-ink);
    background: var(--circuit-selected);
}

.group.vid.none {
    border-style: dashed;
    border-color: var(--circuit-removed);
    background: none;
}

.cells {
    font-family: var(--circuit-mono);
    font-size: 15px;
    letter-spacing: 0.06em;
}

.name {
    color: var(--circuit-soft);
    font-size: 12px;
}

.places {
    display: table;
    table-layout: fixed;
}

.places td {
    padding: 4px 2px !important;
    font-family: var(--circuit-mono);
    font-size: 12px;
    text-align: center;
}

.places td.on {
    background: var(--circuit-selected);
    font-weight: 700;
}

.tag-bits :deep(.code-view) {
    margin: 12px 0 0;
}
</style>
