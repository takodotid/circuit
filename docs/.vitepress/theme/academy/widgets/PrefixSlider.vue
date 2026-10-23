<script setup lang="ts">
// Lesson: reading an IP address. The reader types an address and slides the prefix length, and sees its 32 bits split into network and host, the mask, the first and last address, and how many the block holds.

import { computed, ref, watch } from "vue";
import { Ipv4 } from "./PrefixSlider";

const MIN_PREFIX = 8;
const MAX_PREFIX = 30;

const text = ref("192.168.1.37");
const prefix = ref(24);

const examples = ["192.168.1.37", "10.20.30.40", "172.16.5.200"];
const shortcuts = [8, 16, 24, 25, 30];

const parsed = computed(() => Ipv4.parse(text.value));
const error = computed(() => ("error" in parsed.value ? parsed.value.error : undefined));

/** The last address the reader typed that could be read, so the drawing stays while they type. */
const address = ref((Ipv4.parse(text.value) as { value: number }).value);

watch(parsed, (next) => {
    if ("value" in next) address.value = next.value;
});

/** Four groups of eight bits, each with its number and which part each bit belongs to. */
function groups(value: number) {
    const bits = Ipv4.bits(value);
    return Ipv4.parts(value).map((number, group) => ({
        number,
        bits: bits
            .slice(group * 8, group * 8 + 8)
            .map((bit, place) => ({ bit, network: group * 8 + place < prefix.value, edge: group * 8 + place === prefix.value })),
    }));
}

const addressGroups = computed(() => groups(address.value));
const maskGroups = computed(() => groups(Ipv4.mask(prefix.value)));

const mask = computed(() => Ipv4.format(Ipv4.mask(prefix.value)));
const network = computed(() => Ipv4.network(address.value, prefix.value));
const broadcast = computed(() => Ipv4.broadcast(address.value, prefix.value));
const size = computed(() => Ipv4.blockSize(prefix.value));
const hostBits = computed(() => 32 - prefix.value);
const privateRange = computed(() => Ipv4.privateRange(address.value));

/** How the count is made: a 2 for every host bit, multiplied together. */
const twosText = computed(() =>
    hostBits.value <= 4 ? Array.from({ length: hostBits.value }, () => "2").join(" × ") : `${hostBits.value} twos multiplied together`
);

/** Where the split falls: between two of the four numbers, or inside one. */
const splitText = computed(() => {
    if (prefix.value % 8 === 0) {
        const networkNumbers = prefix.value / 8;
        return `The split falls between two of the four numbers: the first ${networkNumbers === 1 ? "number is" : `${networkNumbers} numbers are`} the network.`;
    }
    return `The split falls inside number ${Math.floor(prefix.value / 8) + 1}, so part of that number is the network and part is the host.`;
});
</script>

<template>
    <div class="prefix-slider">
        <div class="inputs">
            <label class="ac-field">
                <span>An address</span>
                <input v-model="text" class="ac-input mono" :aria-invalid="!!error" spellcheck="false" autocomplete="off" />
            </label>
            <div class="ac-row examples">
                <button
                    v-for="example in examples"
                    :key="example"
                    type="button"
                    class="ac-button small"
                    :aria-pressed="text === example"
                    @click="text = example"
                >
                    {{ example }}
                </button>
            </div>
        </div>

        <p v-if="error" class="ac-say bad" data-word="Not an address" aria-live="polite">{{ error }}</p>

        <label class="ac-field slider">
            <span
                >Prefix length: <strong class="ac-mono">/{{ prefix }}</strong
                >, so {{ prefix }} network bits and {{ hostBits }} host bits</span
            >
            <input v-model.number="prefix" type="range" :min="MIN_PREFIX" :max="MAX_PREFIX" step="1" />
        </label>
        <div class="ac-row">
            <button
                v-for="shortcut in shortcuts"
                :key="shortcut"
                type="button"
                class="ac-button small"
                :aria-pressed="prefix === shortcut"
                @click="prefix = shortcut"
            >
                /{{ shortcut }}
            </button>
        </div>

        <div class="rows" :class="{ stale: error }">
            <p class="row-name">The address, {{ Ipv4.format(address) }}, as 32 bits</p>
            <div class="groups">
                <div v-for="(group, index) in addressGroups" :key="index" class="group">
                    <span class="group-number">{{ group.number }}</span>
                    <span class="cells">
                        <span
                            v-for="(cell, place) in group.bits"
                            :key="place"
                            class="cell"
                            :class="{ network: cell.network, edge: cell.edge }"
                            >{{ cell.bit }}</span
                        >
                    </span>
                </div>
            </div>

            <p class="row-name">The mask, {{ mask }}: a 1 under every network bit</p>
            <div class="groups">
                <div v-for="(group, index) in maskGroups" :key="index" class="group">
                    <span class="group-number">{{ group.number }}</span>
                    <span class="cells">
                        <span
                            v-for="(cell, place) in group.bits"
                            :key="place"
                            class="cell"
                            :class="{ network: cell.network, edge: cell.edge }"
                            >{{ cell.bit }}</span
                        >
                    </span>
                </div>
            </div>

            <p class="legend">
                <span class="key network">1</span> network part <span class="key">0</span> host part
                <span class="key-edge" aria-hidden="true" /> the split
            </p>
        </div>

        <div class="table-frame">
            <table class="ac-table">
                <tbody>
                    <tr>
                        <th scope="row">Prefix and mask</th>
                        <td>
                            <span class="ac-mono">/{{ prefix }}</span> is the same as <span class="ac-mono">{{ mask }}</span>
                        </td>
                    </tr>
                    <tr>
                        <th scope="row">First address</th>
                        <td>
                            <span class="ac-mono">{{ Ipv4.format(network) }}</span
                            >: the network address, stands for the network itself
                        </td>
                    </tr>
                    <tr>
                        <th scope="row">Last address</th>
                        <td>
                            <span class="ac-mono">{{ Ipv4.format(broadcast) }}</span
                            >: the broadcast address, reaches every device at once
                        </td>
                    </tr>
                    <tr class="lit">
                        <th scope="row">For devices</th>
                        <td>
                            <span class="ac-mono">{{ Ipv4.format(network + 1) }}</span> to
                            <span class="ac-mono">{{ Ipv4.format(broadcast - 1) }}</span>
                        </td>
                    </tr>
                    <tr>
                        <th scope="row">How many</th>
                        <td>{{ Ipv4.countText(size) }} addresses in all, {{ Ipv4.countText(size - 2) }} for devices</td>
                    </tr>
                    <tr>
                        <th scope="row">Private?</th>
                        <td>{{ privateRange ? `Yes, inside ${privateRange.text}` : "No, it is not in a private range" }}</td>
                    </tr>
                </tbody>
            </table>
        </div>

        <p class="ac-say hint" aria-live="polite">
            With <span class="ac-mono">/{{ prefix }}</span
            >, {{ hostBits }} host bits make {{ twosText }} = {{ Ipv4.countText(size) }} addresses. {{ splitText }}
        </p>
    </div>
</template>

<style scoped>
.inputs {
    display: grid;
    gap: 8px;
}

.inputs .ac-input {
    width: min(100%, 260px);
    font-size: 17px;
}

.slider {
    margin-top: 16px;
}

.slider strong {
    color: var(--circuit-ink);
    font-size: 15px;
}

.slider input {
    width: 100%;
    min-height: 40px;
    accent-color: var(--circuit-cobalt);
}

.rows {
    margin-top: 16px;
    transition: opacity 0.2s;
}

.rows.stale {
    opacity: 0.5;
}

.row-name {
    margin: 12px 0 6px;
    color: var(--circuit-soft);
    font-size: 13.5px;
    font-weight: 600;
}

.groups {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 10px;
}

.group {
    display: grid;
    justify-items: center;
    gap: 2px;
}

.group-number {
    font-family: var(--circuit-mono);
    font-size: 14px;
    font-weight: 700;
}

.cells {
    display: flex;
}

.cell {
    display: grid;
    place-items: center;
    width: 17px;
    height: 26px;
    border: 1px solid var(--circuit-line);
    border-left-width: 0;
    background: var(--circuit-paper);
    font-family: var(--circuit-mono);
    font-size: 13px;
}

.cell:first-child {
    border-left-width: 1px;
}

.cell.network {
    border-color: #0a1a36;
    background: var(--circuit-cobalt);
    color: #ffffff;
}

/* The first host bit carries a thick yellow bar on its left: the split. */
.cell.edge {
    border-left: 4px solid var(--circuit-yellow);
}

.legend {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 8px;
    margin: 12px 0 0;
    color: var(--circuit-soft);
    font-size: 13.5px;
}

.key {
    display: inline-grid;
    place-items: center;
    width: 18px;
    height: 22px;
    border: 1px solid var(--circuit-line);
    font-family: var(--circuit-mono);
    font-size: 12px;
}

.key.network {
    border-color: #0a1a36;
    background: var(--circuit-cobalt);
    color: #ffffff;
}

.key-edge {
    display: inline-block;
    width: 4px;
    height: 22px;
    background: var(--circuit-yellow);
    outline: 1px solid var(--circuit-line);
}

.table-frame {
    overflow-x: auto;
}

.table-frame th {
    width: 9.5em;
    text-align: left;
}

.hint {
    color: var(--circuit-soft);
}

@media (max-width: 400px) {
    .cell {
        width: 15px;
    }
}

@media (prefers-reduced-motion: reduce) {
    .rows {
        transition: none;
    }
}
</style>
