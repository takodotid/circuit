<script setup lang="ts">
// Lesson: routing tables. The reader looks up destination addresses in an office router's table, adds and removes static routes, and sees the matching rows, the winner and the Circuit file.

import { computed, ref } from "vue";
import { bitsOf, firstDifference, formatIPv4, formatPrefix, lookup, parseIPv4, parsePrefix, type Prefix, type Route } from "./RouteLookup";

type Row = Route & { id: number };

const prefixOf = (text: string): Prefix => {
    const parsed = parsePrefix(text);
    if ("error" in parsed) throw new Error(parsed.error);
    return parsed.prefix;
};

/** Where a new static route can send traffic: a router on one of the connected networks, or nowhere. */
const targets = [
    { value: "203.0.113.1", label: "203.0.113.1, the internet provider", description: "Internet provider" },
    { value: "10.0.10.254", label: "10.0.10.254, the lab router", description: "Lab, behind the lab router" },
    { value: "blackhole", label: "Blackhole: drop it", description: "Drop" },
];

let nextId = 1;
const row = (route: Route): Row => ({ ...route, id: nextId++ });

const rows = ref<Row[]>([
    row({ prefix: prefixOf("10.0.10.0/24"), interface: "office", kind: "connected" }),
    row({ prefix: prefixOf("10.0.20.0/24"), interface: "guests", kind: "connected" }),
    row({ prefix: prefixOf("203.0.113.0/30"), interface: "25g-1", kind: "connected" }),
    row({ prefix: prefixOf("0.0.0.0/0"), via: "203.0.113.1", kind: "static", description: "Internet provider" }),
    row({ prefix: prefixOf("10.20.0.0/16"), via: "10.0.10.254", kind: "static", description: "Lab, behind the lab router" }),
]);

const destination = ref("");
const picks = ["10.0.10.25", "10.20.5.9", "192.0.2.80", "10.0.11.7", "203.0.113.1"];

const address = computed(() => parseIPv4(destination.value));
const result = computed(() => (address.value === undefined ? undefined : lookup(rows.value, address.value)));

/** The row whose bits are shown under the table: the one the reader chose, or the winner. */
const comparedId = ref<number>();
const compared = computed(() => rows.value.find((entry) => entry.id === comparedId.value) ?? result.value?.winner);

function pick(text: string) {
    destination.value = text;
    comparedId.value = undefined;
}

function sendsTo(route: Row): string {
    if (route.blackhole) return "nowhere: drop";
    if (route.via) return `router ${route.via}`;
    return `out of ${route.interface}, straight to the device`;
}

function verdict(route: Row): string {
    if (address.value === undefined) return "";

    const differs = firstDifference(route.prefix, address.value);
    if (differs !== undefined) return `No, bit ${differs} differs`;
    if (route.prefix.length === 0) return "Yes, it holds every address";

    return `Yes, the first ${route.prefix.length} bits agree`;
}

const said = computed(() => {
    if (!destination.value.trim()) return { kind: "hint", text: "Pick an address above, or type one, to look it up in the table." };
    if (address.value === undefined)
        return {
            kind: "bad",
            word: "Not an address",
            text: `${destination.value.trim()} is not an IPv4 address. Write four numbers from 0 to 255 with dots between them.`,
        };

    const { matches, winner } = result.value!;
    const shown = formatIPv4(address.value);

    if (!winner)
        return {
            kind: "bad",
            word: "Dropped",
            text: `No route holds ${shown}, so the router has nowhere to send it and drops it. A default route would have caught it.`,
        };

    const count = matches.length === 1 ? "only 1 route" : `${matches.length} routes`;
    const longest = matches.length === 1 ? "" : ` The longest prefix is /${winner.prefix.length}, so that one wins.`;

    if (winner.blackhole)
        return {
            kind: "bad",
            word: "Dropped",
            text: `${shown} matches ${count}.${longest} It is a blackhole route, so the router drops the packet on purpose.`,
        };

    return { kind: "good", word: "Sent", text: `${shown} matches ${count}.${longest} The router sends it to ${sendsTo(winner)}.` };
});

/** The bits of the address and of the compared prefix, split into the part the prefix compares and the rest. */
const bits = computed(() => {
    const route = compared.value;
    if (!route || address.value === undefined) return undefined;

    const split = (text: string) => ({ compared: text.slice(0, route.prefix.length), rest: text.slice(route.prefix.length) });
    const differs = firstDifference(route.prefix, address.value);

    return { route, address: split(bitsOf(address.value)), prefix: split(bitsOf(route.prefix.network)), differs };
});

/** Bits grouped by eight, each character with whether it is in the compared part and whether it is the first that differs. */
function cells(part: { compared: string; rest: string }, differs: number | undefined) {
    return [...part.compared, ...part.rest].map((bit, index) => ({
        bit,
        compared: index < part.compared.length,
        differs: differs === index + 1,
        gap: index > 0 && index % 8 === 0,
    }));
}

// Adding a static route.
const newPrefix = ref("");
const newTarget = ref("203.0.113.1");
const formError = ref("");

function add() {
    const parsed = parsePrefix(newPrefix.value);

    if ("error" in parsed) {
        formError.value = parsed.error;
        return;
    }

    if (rows.value.some((entry) => formatPrefix(entry.prefix) === formatPrefix(parsed.prefix))) {
        formError.value = `The table already has a route for ${formatPrefix(parsed.prefix)}. Remove it first, or pick another prefix.`;
        return;
    }

    const target = targets.find((entry) => entry.value === newTarget.value)!;

    rows.value = [
        ...rows.value,
        row(
            target.value === "blackhole"
                ? { prefix: parsed.prefix, blackhole: true, kind: "static", description: "Drop" }
                : { prefix: parsed.prefix, via: target.value, kind: "static", description: target.description }
        ),
    ];

    formError.value = "";
    newPrefix.value = "";
}

function remove(id: number) {
    rows.value = rows.value.filter((entry) => entry.id !== id);
    if (comparedId.value === id) comparedId.value = undefined;
}

/** The order a router shows its table in: longest prefix first. */
const sorted = computed(() => [...rows.value].sort((a, b) => b.prefix.length - a.prefix.length || a.prefix.network - b.prefix.network));

const code = computed(() => {
    const statics = rows.value.filter((entry) => entry.kind === "static");
    const lines = statics.map((entry) => {
        const target = entry.blackhole ? "blackhole: true" : `via: "${entry.via}"`;
        return `        { prefix: "${formatPrefix(entry.prefix)}", ${target}, description: "${entry.description}" },`;
    });

    return [
        "// The connected routes come from these addresses.",
        "ports: {",
        '    "25g-1": { description: "Internet provider", addresses: ["203.0.113.2/30"] },',
        "},",
        "interfaces: {",
        '    office: { type: "vlan", vlan: "office", addresses: ["10.0.10.1/24"] },',
        '    guests: { type: "vlan", vlan: "guests", addresses: ["10.0.20.1/24"] },',
        "},",
        "",
        "// The static routes are written by hand.",
        "routing: {",
        statics.length ? "    static: [" : "    static: [],",
        ...(statics.length ? [...lines, "    ],"] : []),
        "},",
    ].join("\n");
});
</script>

<template>
    <div class="route-lookup">
        <div class="ac-field">
            <span>1. Look up an address</span>
            <div class="ac-row">
                <input
                    v-model="destination"
                    class="ac-input mono"
                    aria-label="Destination address"
                    placeholder="10.0.10.25"
                    :aria-invalid="destination.trim() !== '' && address === undefined"
                    @input="comparedId = undefined"
                />
                <button
                    v-for="entry in picks"
                    :key="entry"
                    type="button"
                    class="ac-button small"
                    :aria-pressed="destination === entry"
                    @click="pick(entry)"
                >
                    {{ entry }}
                </button>
            </div>
        </div>

        <div class="frame">
            <table class="ac-table">
                <thead>
                    <tr>
                        <th>Prefix</th>
                        <th>Sends to</th>
                        <th>Kind</th>
                        <th>Holds the address?</th>
                        <th><span class="ac-hidden">Remove</span></th>
                    </tr>
                </thead>
                <tbody>
                    <tr
                        v-for="route in sorted"
                        :key="route.id"
                        :class="{ lit: result?.winner?.id === route.id, miss: result && !result.matches.includes(route) }"
                    >
                        <td class="ac-mono">{{ formatPrefix(route.prefix) }}</td>
                        <td>{{ sendsTo(route) }}</td>
                        <td>{{ route.kind }}</td>
                        <td>
                            <strong v-if="result?.winner?.id === route.id" class="wins">Wins</strong>
                            {{ verdict(route) }}
                        </td>
                        <td>
                            <button
                                v-if="route.kind === 'static'"
                                type="button"
                                class="ac-button small"
                                :aria-label="`Remove the route for ${formatPrefix(route.prefix)}`"
                                @click="remove(route.id)"
                            >
                                Remove
                            </button>
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>

        <p class="ac-say" :class="said.kind" :data-word="said.word" aria-live="polite">{{ said.text }}</p>

        <div v-if="bits" class="bits">
            <label class="ac-field">
                <span>Compare the bits with</span>
                <select v-model="comparedId" class="ac-select">
                    <option :value="undefined">the winning route</option>
                    <option v-for="route in sorted" :key="route.id" :value="route.id">{{ formatPrefix(route.prefix) }}</option>
                </select>
            </label>
            <p class="bit-line">
                <span class="bit-name">address</span>
                <span class="ac-mono"
                    ><span
                        v-for="(cell, index) in cells(bits.address, bits.differs)"
                        :key="index"
                        :class="{ compared: cell.compared, differs: cell.differs, gap: cell.gap }"
                        >{{ cell.bit }}</span
                    ></span
                >
            </p>
            <p class="bit-line">
                <span class="bit-name">/{{ bits.route.prefix.length }}</span>
                <span class="ac-mono"
                    ><span
                        v-for="(cell, index) in cells(bits.prefix, bits.differs)"
                        :key="index"
                        :class="{ compared: cell.compared, differs: cell.differs, gap: cell.gap }"
                        >{{ cell.bit }}</span
                    ></span
                >
            </p>
            <p v-if="bits.route.prefix.length === 0" class="bit-note">A /0 compares no bits at all, so it holds every address.</p>
            <p v-else class="bit-note">
                Only the first {{ bits.route.prefix.length }} bits are compared, marked with a line under them.
                <template v-if="bits.differs"
                    >Bit {{ bits.differs }} differs, marked in red, so this route does not hold the address.</template
                >
                <template v-else>They all agree, so this route holds the address.</template>
            </p>
        </div>

        <form class="add" @submit.prevent="add">
            <span class="ac-field-title">2. Add a static route</span>
            <div class="ac-row">
                <label class="ac-field">
                    <span>Prefix</span>
                    <input v-model="newPrefix" class="ac-input mono" placeholder="10.0.0.0/8" :aria-invalid="formError !== ''" />
                </label>
                <label class="ac-field">
                    <span>Send to</span>
                    <select v-model="newTarget" class="ac-select">
                        <option v-for="target in targets" :key="target.value" :value="target.value">{{ target.label }}</option>
                    </select>
                </label>
                <button type="submit" class="ac-button primary">Add the route</button>
            </div>
            <p v-if="formError" class="ac-say bad" data-word="Not added" aria-live="polite">{{ formError }}</p>
        </form>

        <CodeView :code="code" title="office-router.ts, part of it" />
    </div>
</template>

<style scoped>
.frame {
    margin-top: 14px;
    overflow-x: auto;
}

.frame .ac-table {
    min-width: 560px;
}

tr.miss td {
    color: var(--circuit-soft);
}

.wins {
    display: inline-block;
    margin-right: 6px;
    padding: 0 6px;
    background: var(--circuit-ink);
    color: var(--circuit-paper);
    font-size: 11px;
    letter-spacing: 0.08em;
    line-height: 20px;
    text-transform: uppercase;
}

.dark tr.lit .wins {
    background: var(--circuit-yellow);
    color: #0a1a36;
}

.ac-input.mono {
    width: 12em;
}

.hint {
    color: var(--circuit-soft);
}

.bits {
    margin-top: 14px;
    padding: 12px 14px;
    background: var(--circuit-mist);
}

.bits .ac-field {
    max-width: 260px;
}

.bit-line {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 12px;
    margin: 10px 0 0;
    line-height: 1.6;
    overflow-wrap: anywhere;
}

.bit-name {
    min-width: 4.5em;
    color: var(--circuit-soft);
    font-size: 13px;
    font-weight: 700;
}

.bit-line .ac-mono {
    letter-spacing: 0.04em;
}

.compared {
    text-decoration: underline 2px var(--circuit-link);
    text-underline-offset: 4px;
}

.differs {
    color: var(--circuit-removed);
    font-weight: 700;
}

.gap {
    margin-left: 0.45em;
}

.bit-note {
    margin: 8px 0 0;
    font-size: 14.5px;
}

.add {
    margin-top: 20px;
}

.ac-field-title {
    display: block;
    margin-bottom: 6px;
    color: var(--circuit-soft);
    font-size: 13px;
    font-weight: 600;
}

.add .ac-row {
    align-items: end;
}
</style>
