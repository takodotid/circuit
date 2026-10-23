<script setup lang="ts">
// Lesson: routers and the gateway. The reader picks an address to send to from a laptop; the laptop decides to send directly or to its gateway, and each router passes the packet on by its routing table, lowering the TTL. With `loop`, a forgotten row sends a packet round in a circle until its TTL runs out.

import { computed, ref } from "vue";
import { useTravel, type Point } from "../travel";
import { Motion, useNarrow, usePause } from "./SwitchLearning";

const props = defineProps<{
    /** Add the forgotten row that makes two routers pass a packet back and forth. */
    loop?: boolean;
}>();

type NodeId = "laptop" | "printer" | "switch" | "main" | "provider" | "library" | "desktop";
type RouterId = "main" | "library";

const devices: { id: NodeId; kind: "laptop" | "printer" | "switch" | "router" | "cloud" | "desktop"; label: string; note?: string }[] = [
    { id: "laptop", kind: "laptop", label: "Laptop", note: "192.168.1.20" },
    { id: "printer", kind: "printer", label: "Printer", note: "192.168.1.30" },
    { id: "switch", kind: "switch", label: "Switch" },
    { id: "main", kind: "router", label: "Main router" },
    { id: "provider", kind: "cloud", label: "Internet provider" },
    { id: "library", kind: "router", label: "Library router" },
    { id: "desktop", kind: "desktop", label: "Library desktop", note: "172.16.8.25" },
];

const cables: [NodeId, NodeId][] = [
    ["laptop", "switch"],
    ["printer", "switch"],
    ["switch", "main"],
    ["main", "provider"],
    ["main", "library"],
    ["library", "desktop"],
];

type Tag = { text: string; x: number; y: number; anchor: "start" | "middle" | "end" };
type Layout = {
    viewBox: string;
    at: Record<NodeId, Point>;
    /** The routers' addresses, each written beside its cable. */
    tags: Tag[];
    /** Names written beside a device instead of under it, where a cable runs under it. */
    sideLabels: (Tag & { id: NodeId })[];
};

const layouts: Record<"wide" | "narrow", Layout> = {
    wide: {
        viewBox: "0 0 700 320",
        at: {
            laptop: [60, 70],
            printer: [60, 250],
            switch: [185, 160],
            main: [335, 160],
            provider: [530, 46],
            library: [505, 160],
            desktop: [640, 160],
        },
        tags: [
            { text: "192.168.1.1", x: 262, y: 150, anchor: "middle" },
            { text: "198.51.100.2", x: 386, y: 106, anchor: "end" },
            { text: "10.0.0.1", x: 366, y: 150, anchor: "start" },
            { text: "10.0.0.2", x: 476, y: 180, anchor: "end" },
            { text: "172.16.8.1", x: 566, y: 150, anchor: "middle" },
        ],
        sideLabels: [],
    },
    narrow: {
        viewBox: "0 0 360 590",
        at: {
            laptop: [60, 50],
            printer: [260, 50],
            switch: [160, 150],
            main: [160, 270],
            provider: [300, 270],
            library: [160, 400],
            desktop: [160, 520],
        },
        tags: [
            { text: "192.168.1.1", x: 168, y: 224, anchor: "start" },
            { text: "198.51.100.2", x: 230, y: 259, anchor: "middle" },
            { text: "10.0.0.1", x: 168, y: 336, anchor: "start" },
            { text: "10.0.0.2", x: 168, y: 364, anchor: "start" },
            { text: "172.16.8.1", x: 168, y: 464, anchor: "start" },
        ],
        sideLabels: [
            { id: "switch", text: "Switch", x: 122, y: 155, anchor: "end" },
            { id: "main", text: "Main router", x: 126, y: 275, anchor: "end" },
            { id: "library", text: "Library router", x: 126, y: 405, anchor: "end" },
        ],
    },
};

const narrow = useNarrow();
const layout = computed(() => layouts[narrow.value ? "narrow" : "wide"]);
const at = (id: NodeId) => layout.value.at[id];
const hasSideLabel = (id: NodeId) => layout.value.sideLabels.some((label) => label.id === id);

/** Who has each address: a device, or a router on one of its sides. */
const owners: { address: string; node: NodeId }[] = [
    { address: "192.168.1.20", node: "laptop" },
    { address: "192.168.1.30", node: "printer" },
    { address: "192.168.1.1", node: "main" },
    { address: "10.0.0.1", node: "main" },
    { address: "198.51.100.2", node: "main" },
    { address: "198.51.100.1", node: "provider" },
    { address: "10.0.0.2", node: "library" },
    { address: "172.16.8.1", node: "library" },
    { address: "172.16.8.25", node: "desktop" },
];

type Row = { network: string; prefix?: number; via?: string; sendTo: string; note?: string };

const tables = computed<Record<RouterId, Row[]>>(() => ({
    main: [
        { network: "192.168.1.0", prefix: 24, sendTo: "Directly, office side" },
        { network: "10.0.0.0", prefix: 30, sendTo: "Directly, library side" },
        { network: "198.51.100.0", prefix: 30, sendTo: "Directly, provider side" },
        { network: "172.16.8.0", prefix: 24, via: "10.0.0.2", sendTo: "10.0.0.2, the library router" },
        ...(props.loop
            ? [{ network: "172.16.9.0", prefix: 24, via: "10.0.0.2", sendTo: "10.0.0.2, the library router", note: "old reading room" }]
            : []),
        { network: "Anything else", via: "198.51.100.1", sendTo: "198.51.100.1, the provider" },
    ],
    library: [
        { network: "172.16.8.0", prefix: 24, sendTo: "Directly, library side" },
        { network: "10.0.0.0", prefix: 30, sendTo: "Directly, main side" },
        { network: "Anything else", via: "10.0.0.1", sendTo: "10.0.0.1, the main router" },
    ],
}));

const routerIds: RouterId[] = ["main", "library"];
const routerNames: Record<RouterId, string> = { main: "main router", library: "library router" };

/** An IPv4 address as one number, or undefined when the text is not one. */
function parse(text: string): number | undefined {
    const parts = text.trim().split(".");
    if (parts.length !== 4) return undefined;

    let value = 0;
    for (const part of parts) {
        if (!/^\d{1,3}$/.test(part) || Number(part) > 255) return undefined;
        value = value * 256 + Number(part);
    }
    return value;
}

const blockOf = (address: number, prefix: number) => Math.floor(address / 2 ** (32 - prefix));
const inside = (address: number, network: string, prefix: number) => blockOf(address, prefix) === blockOf(parse(network)!, prefix);
const isEdgeOf = (address: number, prefix: number) =>
    address % 2 ** (32 - prefix) === 0 || address % 2 ** (32 - prefix) === 2 ** (32 - prefix) - 1;
const ownerOf = (address: number) => owners.find((owner) => parse(owner.address) === address)?.node;

/** The row a router uses for an address: one whose network holds it, or else the "anything else" row. */
function lookup(router: RouterId, address: number) {
    const rows = tables.value[router];
    const index = rows.findIndex((row) => row.prefix !== undefined && inside(address, row.network, row.prefix));
    return index >= 0 ? index : rows.findIndex((row) => row.prefix === undefined);
}

/** The way along the cables from one place to another. */
function wayBetween(start: NodeId, end: NodeId): NodeId[] {
    const cameFrom = new Map<NodeId, NodeId>();
    const queue: NodeId[] = [start];
    const seen = new Set<NodeId>([start]);

    while (queue.length) {
        const node = queue.shift()!;
        if (node === end) break;
        for (const [a, b] of cables) {
            const next = a === node ? b : b === node ? a : undefined;
            if (next && !seen.has(next)) {
                seen.add(next);
                cameFrom.set(next, node);
                queue.push(next);
            }
        }
    }

    const way: NodeId[] = [end];
    while (way[0] !== start) way.unshift(cameFrom.get(way[0]!)!);
    return way;
}

const shortcuts = computed(() => [
    { label: "Printer", address: "192.168.1.30" },
    { label: "Library desktop", address: "172.16.8.25" },
    { label: "A website", address: "203.0.113.80" },
    ...(props.loop ? [{ label: "Old reading room", address: "172.16.9.20" }] : []),
]);

const destination = ref(props.loop ? "172.16.9.20" : "172.16.8.25");
const START_TTL = 64;
const ttl = ref(START_TTL);
const sentTo = ref<string>();
const litRows = ref<Partial<Record<RouterId, number>>>({});
const litNodes = ref<NodeId[]>([]);
const litCables = ref<string[]>([]);
const steps = ref<string[]>([]);
const said = ref<{ kind: "good" | "bad" | "warn"; word?: string; text: string }>();
const busy = ref(false);

const walk = useTravel();
const rush = useTravel(2000);
const pause = usePause();

const cableKey = (a: NodeId, b: NodeId) => [a, b].sort().join("-");

/** Move the packet along a way, lighting the cables it uses. */
async function go(way: NodeId[], fast = false) {
    for (let index = 1; index < way.length; index++) litCables.value.push(cableKey(way[index - 1]!, way[index]!));
    litNodes.value = [way[way.length - 1]!];
    await (fast ? rush : walk).travel(way.map(at));
}

/** The steps shown in the list: all of them, or the first and last few of a long loop. */
const shownSteps = computed(() => {
    if (steps.value.length <= 8) return steps.value;
    const hidden = steps.value.length - 6;
    return [...steps.value.slice(0, 4), `... the same again, ${hidden} more times ...`, ...steps.value.slice(-2)];
});

function reset() {
    ttl.value = START_TTL;
    litRows.value = {};
    litNodes.value = [];
    litCables.value = [];
    steps.value = [];
    said.value = undefined;
}

function choose(address: string) {
    if (busy.value) return;
    destination.value = address;
    send();
}

async function send() {
    if (busy.value) return;
    reset();

    const text = destination.value.trim();
    const address = parse(text);

    if (address === undefined) {
        said.value = {
            kind: "bad",
            word: "Not an address",
            text: "An IPv4 address is four numbers from 0 to 255 with dots between them, such as 172.16.8.25.",
        };
        return;
    }

    const first = Math.floor(address / 2 ** 24);
    if (first === 0 || first === 127 || first >= 224) {
        said.value = {
            kind: "bad",
            word: "Not this one",
            text: "Addresses starting with 0, 127 or 224 and above are kept for special uses and are not given to a device. Try one of the buttons.",
        };
        return;
    }

    if (text === "192.168.1.20") {
        said.value = { kind: "bad", word: "Not this one", text: "That is the laptop’s own address. Pick an address somewhere else." };
        return;
    }

    busy.value = true;
    sentTo.value = text;

    // The laptop's own decision: same network or not.
    if (inside(address, "192.168.1.0", 24)) {
        await finishDirect(
            "laptop",
            address,
            "192.168.1.0",
            24,
            `The laptop compares the network parts: ${text} is on its own network, 192.168.1.0/24, so it sends the packet straight there, through the switch.`
        );
        busy.value = false;
        return;
    }

    steps.value.push(
        `The laptop compares the network parts: ${text} is not on its network, 192.168.1.0/24, so it sends the packet to its gateway, the main router at 192.168.1.1.`
    );
    await go(wayBetween("laptop", "main"));

    let router: RouterId = "main";
    let hops = 0;
    const still = Motion.still();

    while (true) {
        if (owners.some((owner) => owner.node === router && owner.address === text)) {
            steps.value.push(`That is the ${routerNames[router]}’s own address, so it keeps the packet.`);
            said.value = { kind: "good", text: `The ${routerNames[router]} received it: ${text} is one of its own addresses.` };
            break;
        }

        ttl.value -= 1;
        hops += 1;

        if (ttl.value === 0) {
            steps.value.push(`The ${routerNames[router]} lowers the TTL to 0 and drops the packet.`);
            said.value = {
                kind: "bad",
                text: `The packet went round between the two routers until its TTL reached 0, ${hops} hops later, and the ${routerNames[router]} dropped it. Without the TTL it would have gone round forever.`,
            };
            break;
        }

        const index = lookup(router, address);
        const row = tables.value[router][index]!;
        litRows.value = { ...litRows.value, [router]: index };

        if (row.via === undefined) {
            await finishDirect(
                router,
                address,
                row.network,
                row.prefix!,
                `The ${routerNames[router]} lowers the TTL to ${ttl.value}. Its table says ${row.network}/${row.prefix} is on one of its own sides, so it sends the packet there directly.`
            );
            break;
        }

        const next = ownerOf(parse(row.via)!)!;
        const rowName = row.prefix === undefined ? "the row for anything else" : `the row for ${row.network}/${row.prefix}`;
        steps.value.push(
            `The ${routerNames[router]} lowers the TTL to ${ttl.value}, finds ${rowName}, and passes the packet to ${row.sendTo}.`
        );

        const fast = hops > 4;
        if (fast && still) {
            // With reduced motion, a long loop is counted out without moving the packet.
            litNodes.value = [next];
        } else {
            if (!fast) await pause(350);
            await go(wayBetween(router, next), fast);
        }

        if (next === "provider") {
            said.value = {
                kind: "good",
                word: "Passed on",
                text: `The packet left through the provider, after ${hops} router${hops > 1 ? "s" : ""} on this drawing. The provider’s routers pass it on the same way, each looking up ${text} in its own table and lowering the TTL by one.`,
            };
            break;
        }

        router = next as RouterId;
    }

    busy.value = false;
}

/** Deliver on a network the sender is on itself, or drop the packet if nobody there has the address. */
async function finishDirect(from: NodeId, address: number, network: string, prefix: number, why: string) {
    const text = sentTo.value!;

    if (isEdgeOf(address, prefix)) {
        said.value = {
            kind: "bad",
            text: `${text} is the first or last address of ${network}/${prefix}. Those two are never given to a device, so there is nobody to send it to.`,
        };
        return;
    }

    steps.value.push(why);

    const owner = ownerOf(address);
    if (!owner || owner === from) {
        const nearest = from === "laptop" ? "switch" : from;
        if (nearest !== from) await go(wayBetween(from, nearest));
        steps.value.push(`It asks the whole network who has ${text}, and nobody answers.`);
        said.value = { kind: "bad", text: `No device on ${network}/${prefix} has the address ${text}, so the packet has nowhere to go.` };
        return;
    }

    await go(wayBetween(from, owner));
    const name = devices.find((device) => device.id === owner)!.label.toLowerCase();
    const routers = START_TTL - ttl.value;

    if (owner === "main" || owner === "library") {
        said.value = { kind: "good", text: `The ${name} received it: ${text} is one of its own addresses.` };
        return;
    }

    said.value = {
        kind: "good",
        text:
            routers === 0
                ? `The ${name} got it straight through the switch. No router was needed, so the TTL is still ${ttl.value}.`
                : `The ${name} got it after ${routers} router${routers > 1 ? "s" : ""}. The TTL went from ${START_TTL} to ${ttl.value}, one less at each router.`,
    };
}
</script>

<template>
    <div class="router-path">
        <svg
            class="ac-drawing"
            :viewBox="layout.viewBox"
            role="img"
            aria-label="A laptop and a printer on a switch, joined to the main router. The main router is joined to the internet provider and to the library router, which has a desktop computer behind it. Each router has an address on each side."
        >
            <line
                v-for="[a, b] in cables"
                :key="`${a}-${b}`"
                class="cable"
                :class="{ lit: litCables.includes(cableKey(a, b)) }"
                :x1="at(a)[0]"
                :y1="at(a)[1]"
                :x2="at(b)[0]"
                :y2="at(b)[1]"
            />

            <SvgDevice
                v-for="device in devices"
                :key="device.id"
                :kind="device.kind"
                :x="at(device.id)[0]"
                :y="at(device.id)[1]"
                :label="hasSideLabel(device.id) ? undefined : device.label"
                :note="device.note"
                :lit="litNodes.includes(device.id)"
            />

            <text
                v-for="label in layout.sideLabels"
                :key="`label-${label.id}`"
                class="side-label"
                :x="label.x"
                :y="label.y"
                :text-anchor="label.anchor"
            >
                {{ label.text }}
            </text>
            <text v-for="tag in layout.tags" :key="tag.text" class="address" :x="tag.x" :y="tag.y" :text-anchor="tag.anchor">
                {{ tag.text }}
            </text>

            <circle v-if="walk.travelling.value" class="packet" :cx="walk.position.value[0]" :cy="walk.position.value[1]" r="9" />
            <circle v-if="rush.travelling.value" class="packet" :cx="rush.position.value[0]" :cy="rush.position.value[1]" r="9" />
        </svg>

        <p class="laptop">
            The laptop: address <span class="ac-mono">192.168.1.20/24</span>, gateway <span class="ac-mono">192.168.1.1</span>
        </p>

        <div class="send">
            <label class="ac-field">
                <span>Send a packet to</span>
                <input
                    v-model="destination"
                    class="ac-input mono"
                    inputmode="decimal"
                    spellcheck="false"
                    :disabled="busy"
                    @keydown.enter="send"
                />
            </label>
            <button type="button" class="ac-button primary" :disabled="busy" @click="send">Send</button>
        </div>
        <div class="ac-row shortcuts">
            <button
                v-for="shortcut in shortcuts"
                :key="shortcut.address"
                type="button"
                class="ac-button small"
                :disabled="busy"
                @click="choose(shortcut.address)"
            >
                {{ shortcut.label }} <span class="ac-mono">{{ shortcut.address }}</span>
            </button>
        </div>

        <dl v-if="sentTo" class="packet-card">
            <div>
                <dt>From</dt>
                <dd class="ac-mono">192.168.1.20</dd>
            </div>
            <div>
                <dt>To</dt>
                <dd class="ac-mono">{{ sentTo }}</dd>
            </div>
            <div class="ttl" :class="{ low: ttl < 10 }">
                <dt>TTL</dt>
                <dd class="ac-mono">{{ ttl }}</dd>
            </div>
        </dl>

        <ol v-if="steps.length" class="steps">
            <li v-for="(step, index) in shownSteps" :key="index">{{ step }}</li>
        </ol>

        <p v-if="said" class="ac-say" :class="said.kind" :data-word="said.word" aria-live="polite">{{ said.text }}</p>
        <p v-else-if="busy" class="ac-say hint" aria-live="polite">The packet is on its way.</p>
        <p v-else-if="loop" class="ac-say hint" aria-live="polite">
            The main router has an old row for a reading room that was closed. Send a packet to the old reading room and watch the TTL.
        </p>
        <p v-else class="ac-say hint" aria-live="polite">
            Send a packet to the printer, then to the library desktop, and compare what the laptop does with each.
        </p>

        <div class="tables">
            <div v-for="router in routerIds" :key="router" class="table">
                <p class="panel-title">{{ router === "main" ? "Main router" : "Library router" }}: routing table</p>
                <div class="table-frame">
                    <table class="ac-table">
                        <thead>
                            <tr>
                                <th>Network</th>
                                <th>Send to</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="(row, index) in tables[router]" :key="row.network" :class="{ lit: litRows[router] === index }">
                                <td>
                                    <span :class="{ 'ac-mono': row.prefix !== undefined }">{{
                                        row.prefix === undefined ? row.network : `${row.network}/${row.prefix}`
                                    }}</span>
                                    <span v-if="row.note" class="note">({{ row.note }})</span>
                                </td>
                                <td>{{ row.sendTo }}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    </div>
</template>

<style scoped>
.side-label {
    font-size: 13px;
    font-weight: 700;
}

.address {
    paint-order: stroke;
    stroke: var(--circuit-paper);
    stroke-width: 4px;
    fill: var(--circuit-link);
    font-family: var(--circuit-mono);
    font-size: 11.5px;
    font-weight: 700;
}

.laptop {
    margin: 10px 0 0 !important;
    color: var(--circuit-soft);
    font-size: 14.5px;
}

.send {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: 10px;
    margin-top: 10px;
}

.send .ac-input {
    width: 13em;
}

.shortcuts {
    margin-top: 8px;
}

.shortcuts .ac-mono {
    font-weight: 400;
}

.packet-card {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 22px;
    margin: 14px 0 0;
    padding: 8px 12px;
    border: 2px solid var(--circuit-ink);
    font-size: 14.5px;
}

.packet-card div {
    display: flex;
    gap: 8px;
}

.packet-card dt {
    font-weight: 700;
}

.packet-card dd {
    margin: 0;
}

.ttl dd {
    min-width: 2ch;
}

.ttl.low dd {
    color: var(--circuit-removed);
    font-weight: 700;
}

.steps {
    margin: 12px 0 0 !important;
    padding-left: 22px !important;
    font-size: 14.5px;
    line-height: 1.5;
}

.steps li {
    margin: 4px 0 0 !important;
}

.hint {
    color: var(--circuit-soft);
}

.tables {
    display: grid;
    grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr);
    gap: 18px;
    margin-top: 16px;
}

.panel-title {
    margin: 0 0 6px !important;
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.06em;
    font-stretch: 112%;
    text-transform: uppercase;
}

.table-frame {
    overflow-x: auto;
}

.table-frame .ac-table {
    display: table;
    margin-top: 0 !important;
    font-size: 13.5px;
}

.note {
    display: block;
    color: var(--circuit-soft);
    font-size: 12.5px;
}

tr.lit .note {
    color: inherit;
}

@media (max-width: 760px) {
    .tables {
        grid-template-columns: minmax(0, 1fr);
    }
}
</style>
