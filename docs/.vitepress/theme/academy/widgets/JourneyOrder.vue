<script setup lang="ts">
// Lesson: opening a website. The reader puts the steps of opening a website back in order, moving each one up or down, and checks which are in the right place.

import { computed, nextTick, ref, useId } from "vue";

type Item = { id: string; text: string };

/** The steps in the right order. */
const steps: Item[] = [
    { id: "settings", text: "The laptop already has an address, a gateway and a DNS resolver." },
    { id: "ask", text: "The laptop asks the resolver for the address of circuit.tako.id." },
    { id: "answer", text: "The answer comes back: 203.0.113.80." },
    { id: "gateway", text: "The laptop sees 203.0.113.80 is not on its network, and sends to the gateway." },
    { id: "handshake", text: "Three messages open a TCP conversation with port 443." },
    { id: "lock", text: "Laptop and server agree on a secret key, and the server proves its name." },
    { id: "request", text: "The browser asks for the page." },
    { id: "packets", text: "The page arrives in packets, and TCP puts them in order." },
    { id: "draw", text: "The browser draws the page." },
];

/** A fixed jumbled order, the same for every reader, so nobody starts from a lucky shuffle. */
const jumbled = ["handshake", "ask", "draw", "settings", "lock", "answer", "packets", "gateway", "request"];

const id = useId();
const order = ref<Item[]>(jumbled.map((entry) => steps.find((step) => step.id === entry)!));
const checked = ref(false);
const tries = ref(0);

const rightPlace = (item: Item, index: number) => steps[index]!.id === item.id;
const rightCount = computed(() => order.value.filter(rightPlace).length);
const solved = computed(() => checked.value && rightCount.value === steps.length);

async function move(index: number, by: -1 | 1) {
    const target = index + by;
    if (target < 0 || target >= order.value.length) return;

    const next = [...order.value];
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item!);
    order.value = next;
    checked.value = false;

    // Keep the keyboard on the step that moved.
    await nextTick();
    const atEdge = target === 0 || target === next.length - 1;
    const direction = atEdge ? (target === 0 ? "down" : "up") : by < 0 ? "up" : "down";
    document.getElementById(`${id}-${item!.id}-${direction}`)?.focus();
}

function check() {
    checked.value = true;
    tries.value += 1;
}

function showAnswer() {
    order.value = [...steps];
    checked.value = true;
}

function restart() {
    order.value = jumbled.map((entry) => steps.find((step) => step.id === entry)!);
    checked.value = false;
    tries.value = 0;
}
</script>

<template>
    <div class="journey-order">
        <ol class="list">
            <li
                v-for="(item, index) in order"
                :key="item.id"
                :class="{ right: checked && rightPlace(item, index), wrong: checked && !rightPlace(item, index) }"
            >
                <span class="number" aria-hidden="true">{{ index + 1 }}</span>
                <span class="text">
                    {{ item.text }}
                    <span v-if="checked" class="verdict">{{ rightPlace(item, index) ? "In place" : "Not here" }}</span>
                </span>
                <span class="moves">
                    <button
                        :id="`${id}-${item.id}-up`"
                        type="button"
                        class="ac-button small"
                        :disabled="index === 0 || solved"
                        :aria-label="`Move up: ${item.text}`"
                        @click="move(index, -1)"
                    >
                        Up
                    </button>
                    <button
                        :id="`${id}-${item.id}-down`"
                        type="button"
                        class="ac-button small"
                        :disabled="index === order.length - 1 || solved"
                        :aria-label="`Move down: ${item.text}`"
                        @click="move(index, 1)"
                    >
                        Down
                    </button>
                </span>
            </li>
        </ol>

        <div class="ac-row actions">
            <button v-if="!solved" type="button" class="ac-button primary" @click="check">Check the order</button>
            <button v-if="!solved && tries >= 2" type="button" class="ac-button" @click="showAnswer">Show the right order</button>
            <button v-if="solved" type="button" class="ac-button" @click="restart">Start over</button>
        </div>

        <p v-if="solved" class="ac-say good" data-word="Right" aria-live="polite">
            Every step is in its place. That is the whole journey, from a name to a page, and you have met every part of it in this level.
        </p>
        <p v-else-if="checked" class="ac-say warn" data-word="Not yet" aria-live="polite">
            {{ rightCount }} of {{ steps.length }} are in the right place. Ask yourself what each step needs first: you cannot send to an
            address you do not know yet.
        </p>
        <p v-else class="ac-say hint" aria-live="polite">
            Move the steps with Up and Down until they are in the order they happen, then press Check the order.
        </p>
    </div>
</template>

<style scoped>
.list {
    margin: 0 !important;
    padding: 0 !important;
    list-style: none;
}

.list li {
    display: grid;
    grid-template-columns: 28px 1fr auto;
    align-items: center;
    gap: 10px;
    margin: 0 0 6px !important;
    padding: 6px 8px;
    border: 1.5px solid var(--circuit-line);
    transition: border-color 0.2s;
}

.list li.right {
    border-color: var(--circuit-added);
}

.list li.wrong {
    border-color: var(--circuit-removed);
    border-style: dashed;
}

.number {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    background: var(--circuit-cobalt);
    color: #ffffff;
    font-size: 13px;
    font-weight: 700;
}

.text {
    font-size: 15px;
    line-height: 1.45;
}

.verdict {
    display: inline-block;
    margin-left: 6px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
}

.right .verdict {
    color: var(--circuit-added);
}

.wrong .verdict {
    color: var(--circuit-removed);
}

.moves {
    display: flex;
    gap: 4px;
}

.moves .ac-button {
    min-width: 54px;
    min-height: 40px;
}

.actions {
    margin-top: 12px;
}

.hint {
    color: var(--circuit-soft);
}

@media (max-width: 640px) {
    .list li {
        grid-template-columns: 28px 1fr;
    }

    .moves {
        grid-column: 2;
    }
}
</style>
