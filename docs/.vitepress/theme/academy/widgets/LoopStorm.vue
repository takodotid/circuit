<script setup lang="ts">
// Lesson: staying up. The reader sends a broadcast around a ring of three switches, with spanning tree off and on, cuts links, adds a second cable, and picks the root bridge.

import { computed, onBeforeUnmount, ref } from "vue";

type SwitchId = "sw1" | "sw2" | "sw3";
type LinkId = "l12" | "l13" | "l23" | "l23b";
type Link = { id: LinkId; a: SwitchId; b: SwitchId; portA: number; portB: number; name: string; extra?: true };

const switches: { id: SwitchId; label: string; mac: number; x: number; y: number }[] = [
    { id: "sw1", label: "sw-01", mac: 1, x: 350, y: 60 },
    { id: "sw2", label: "sw-02", mac: 2, x: 180, y: 220 },
    { id: "sw3", label: "sw-03", mac: 3, x: 520, y: 220 },
];

const links: Link[] = [
    { id: "l12", a: "sw1", b: "sw2", portA: 1, portB: 1, name: "sw-01 to sw-02" },
    { id: "l13", a: "sw1", b: "sw3", portA: 2, portB: 1, name: "sw-01 to sw-03" },
    { id: "l23", a: "sw2", b: "sw3", portA: 2, portB: 2, name: "sw-02 to sw-03" },
    { id: "l23b", a: "sw2", b: "sw3", portA: 3, portB: 3, name: "second cable, sw-02 to sw-03", extra: true },
];

const sw = (id: SwitchId) => switches.find((entry) => entry.id === id)!;
const other = (link: Link, from: SwitchId) => (link.a === from ? link.b : link.a);
const portOf = (link: Link, at: SwitchId) => (link.a === at ? link.portA : link.portB);

const stpOn = ref(false);
const extraCable = ref(false);
const cut = ref<LinkId[]>([]);
const preferred = ref<SwitchId | "">("");

const active = computed(() => links.filter((link) => (!link.extra || extraCable.value) && !cut.value.includes(link.id)));

/** Bridge priority, then MAC address: lower wins the root election. */
const priorityOf = (id: SwitchId) => (preferred.value === id ? 4096 : 32768);
const bridgeId = (id: SwitchId) => priorityOf(id) * 1000 + sw(id).mac;

/** Spanning tree over the links that are up: a root for each group of joined switches, one root port on every other switch, one designated port on every link. Any other port blocks. */
const tree = computed(() => {
    const blocked = new Set<string>();
    const roots = new Set<SwitchId>();
    if (!stpOn.value) return { blocked, roots };

    const cost: Partial<Record<SwitchId, number>> = {};
    const seen = new Set<SwitchId>();

    for (const start of switches.map((entry) => entry.id)) {
        if (seen.has(start)) continue;

        // The switches joined to this one.
        const group: SwitchId[] = [start];
        seen.add(start);
        for (let index = 0; index < group.length; index++) {
            for (const link of active.value) {
                const here = group[index]!;
                if (link.a !== here && link.b !== here) continue;
                const there = other(link, here);
                if (!seen.has(there)) {
                    seen.add(there);
                    group.push(there);
                }
            }
        }

        const root = group.reduce((best, id) => (bridgeId(id) < bridgeId(best) ? id : best));
        roots.add(root);

        // Cost to the root: one per link, all links being the same speed.
        cost[root] = 0;
        const queue = [root];
        while (queue.length) {
            const here = queue.shift()!;
            for (const link of active.value) {
                if (link.a !== here && link.b !== here) continue;
                const there = other(link, here);
                if (cost[there] === undefined) {
                    cost[there] = cost[here]! + 1;
                    queue.push(there);
                }
            }
        }
    }

    const rootPort: Partial<Record<SwitchId, LinkId>> = {};
    for (const { id } of switches) {
        if (roots.has(id)) continue;

        const offers = active.value
            .filter((link) => link.a === id || link.b === id)
            .map((link) => {
                const there = other(link, id);
                return { link: link.id, key: [cost[there]! + 1, bridgeId(there), portOf(link, there)] };
            })
            .sort((x, y) => x.key[0]! - y.key[0]! || x.key[1]! - y.key[1]! || x.key[2]! - y.key[2]!);

        if (offers[0]) rootPort[id] = offers[0].link;
    }

    for (const link of active.value) {
        const key = (at: SwitchId) => [cost[at]!, bridgeId(at), portOf(link, at)];
        const [ka, kb] = [key(link.a), key(link.b)];
        const aWins = ka[0]! - kb[0]! || ka[1]! - kb[1]! || ka[2]! - kb[2]!;
        const designated = aWins < 0 ? link.a : link.b;

        for (const end of [link.a, link.b]) {
            if (end !== designated && rootPort[end] !== link.id) blocked.add(`${link.id}:${end}`);
        }
    }

    return { blocked, roots };
});

const isBlocked = (link: Link, at: SwitchId) => tree.value.blocked.has(`${link.id}:${at}`);

/** Where a blocked port is drawn: a little way along its cable from the switch. */
function blockMark(link: Link, at: SwitchId) {
    const from = sw(at);
    const to = sw(other(link, at));
    const shift = link.extra ? 9 : extraCable.value && link.id === "l23" ? -9 : 0;
    return { x: from.x + (to.x - from.x) * 0.24, y: from.y + (to.y - from.y) * 0.24 + shift };
}

const cableY = (link: Link) => (link.extra ? 9 : extraCable.value && link.id === "l23" ? -9 : 0);

// The broadcast, round by round: each copy crosses one cable per round.
type Copy = { link: LinkId; to: SwitchId };

const inFlight = ref<Copy[]>([]);
const round = ref(0);
const printerGot = ref(0);
const laptopGotBack = ref(0);
const running = ref(false);
const said = ref<{ kind: "good" | "bad" | "warn"; word: string; text: string }>();

const LIMIT_COPIES = 500;
const LIMIT_ROUNDS = 24;
let timer: ReturnType<typeof setInterval> | undefined;

onBeforeUnmount(() => clearInterval(timer));

/** Copies a switch sends out of every forwarding port, except the one the frame came in on. */
function flood(at: SwitchId, cameIn?: LinkId): Copy[] {
    return active.value
        .filter((link) => (link.a === at || link.b === at) && link.id !== cameIn && !isBlocked(link, at))
        .map((link) => ({ link: link.id, to: other(link, at) }));
}

function send() {
    clearInterval(timer);
    said.value = undefined;
    round.value = 1;
    printerGot.value = 0;
    laptopGotBack.value = 0;
    inFlight.value = flood("sw2");
    running.value = true;
    timer = setInterval(step, 800);
}

function stop() {
    clearInterval(timer);
    running.value = false;
}

function step() {
    const next: Copy[] = [];

    for (const copy of inFlight.value) {
        const link = active.value.find((entry) => entry.id === copy.link);
        if (!link) continue;
        if (isBlocked(link, copy.to)) continue;

        if (copy.to === "sw3") printerGot.value++;
        if (copy.to === "sw2") laptopGotBack.value++;
        next.push(...flood(copy.to, copy.link));
    }

    inFlight.value = next;
    round.value++;

    if (!next.length) {
        stop();
        const blockedPorts = [...tree.value.blocked].map((entry) => {
            const [linkId, at] = entry.split(":") as [LinkId, SwitchId];
            return `${sw(at).label} on the ${links.find((link) => link.id === linkId)!.name} cable`;
        });
        said.value = stpOn.value
            ? {
                  kind: "good",
                  word: "Stopped",
                  text: `The broadcast reached every switch it could and stopped. The printer got it ${printerGot.value === 1 ? "once" : `${printerGot.value} times`}.${blockedPorts.length ? ` The blocked port of ${blockedPorts.join(", and of ")} dropped the copy that would have gone round again.` : " No port is blocked: without a loop, spanning tree has nothing to block."}`,
              }
            : {
                  kind: "good",
                  word: "Stopped",
                  text: `No loop is left, so the copies ran out of cables and stopped. The printer got the broadcast ${printerGot.value === 1 ? "once" : `${printerGot.value} times`}.`,
              };
        return;
    }

    if (next.length > LIMIT_COPIES) {
        stop();
        said.value = {
            kind: "bad",
            word: "Storm",
            text: `Over ${LIMIT_COPIES} copies after ${round.value} rounds, and still growing. Every one is the same frame. On a real network the links fill up, the switches’ address tables keep changing as the laptop’s address arrives from every side, and nothing else gets through.`,
        };
        return;
    }

    if (round.value >= LIMIT_ROUNDS) {
        stop();
        said.value = {
            kind: "warn",
            word: "Endless",
            text: `After ${LIMIT_ROUNDS} rounds the copies are still going round, and they never stop: a frame has no counter like the TTL of a packet. The widget stopped them here. Every new broadcast would add more.`,
        };
    }
}

const copiesOn = (id: LinkId) => inFlight.value.filter((copy) => copy.link === id).length;

function toggleCut(id: LinkId) {
    cut.value = cut.value.includes(id) ? cut.value.filter((entry) => entry !== id) : [...cut.value, id];
}

const shownLinks = computed(() => links.filter((link) => !link.extra || extraCable.value));

const code = computed(() => {
    if (!stpOn.value) return "// sw-01.ts, sw-02.ts and sw-03.ts have no stp field, so spanning tree is off.";

    const line = (id: SwitchId) => (preferred.value === id ? `stp: { mode: "rstp", priority: 4096 },` : `stp: { mode: "rstp" },`);
    return [
        "// sw-01.ts",
        line("sw1"),
        "",
        "// sw-02.ts",
        line("sw2"),
        "ports: {",
        `    "10g-4": { description: "Laptop", access_vlan: "office", stp: { edge: true } },`,
        "},",
        "",
        "// sw-03.ts",
        line("sw3"),
    ].join("\n");
});
</script>

<template>
    <div class="loop-storm">
        <svg
            class="ac-drawing"
            viewBox="0 0 700 360"
            role="img"
            aria-label="Three switches in a ring. A laptop hangs off sw-02 and a printer off sw-03. Blocked ports, cut cables and copies of the broadcast on each cable are marked."
        >
            <line class="cable" :x1="60" :y1="300" :x2="sw('sw2').x" :y2="sw('sw2').y" />
            <line class="cable" :x1="640" :y1="300" :x2="sw('sw3').x" :y2="sw('sw3').y" />

            <g v-for="link in shownLinks" :key="link.id">
                <line
                    class="cable"
                    :class="{ lit: copiesOn(link.id) > 0, cut: cut.includes(link.id) }"
                    :x1="sw(link.a).x"
                    :y1="sw(link.a).y + cableY(link)"
                    :x2="sw(link.b).x"
                    :y2="sw(link.b).y + cableY(link)"
                />
                <g v-for="end in [link.a, link.b]" :key="end">
                    <g
                        v-if="isBlocked(link, end)"
                        class="blocked"
                        :transform="`translate(${blockMark(link, end).x} ${blockMark(link, end).y})`"
                    >
                        <title>{{ sw(end).label }} blocks this port</title>
                        <rect x="-9" y="-9" width="18" height="18" />
                        <path d="M-5 -5L5 5M5 -5L-5 5" />
                    </g>
                </g>
                <g
                    v-if="copiesOn(link.id) > 0"
                    class="count"
                    :transform="`translate(${(sw(link.a).x + sw(link.b).x) / 2} ${(sw(link.a).y + sw(link.b).y) / 2 + cableY(link) * 2.2})`"
                >
                    <rect x="-22" y="-11" width="44" height="22" />
                    <text y="5" text-anchor="middle">×{{ copiesOn(link.id) }}</text>
                </g>
            </g>

            <SvgDevice
                v-for="entry in switches"
                :key="entry.id"
                kind="switch"
                :x="entry.x"
                :y="entry.y"
                :label="entry.label"
                :note="tree.roots.has(entry.id) ? 'root bridge' : `priority ${priorityOf(entry.id)}`"
                :lit="tree.roots.has(entry.id)"
            />
            <SvgDevice kind="laptop" :x="60" :y="300" label="Laptop" />
            <SvgDevice kind="printer" :x="640" :y="300" label="Printer" />
        </svg>

        <p class="counters">
            <template v-if="round"
                >Round {{ round }}. Copies on the cables: {{ inFlight.length }}. The printer got the broadcast {{ printerGot }} times; the
                laptop got its own broadcast back {{ laptopGotBack }} times.</template
            >
            <template v-else
                >The laptop will send one broadcast to everyone on the network, such as a question for whoever has a certain
                address.</template
            >
        </p>

        <div class="controls">
            <div class="ac-field">
                <span>Spanning tree</span>
                <div class="ac-row" role="group" aria-label="Spanning tree">
                    <button type="button" class="ac-button small" :aria-pressed="!stpOn" @click="stpOn = false">Off</button>
                    <button type="button" class="ac-button small" :aria-pressed="stpOn" @click="stpOn = true">On</button>
                </div>
            </div>
            <label class="ac-field">
                <span>Bridge priority 4096 on</span>
                <select v-model="preferred" class="ac-select">
                    <option value="">No switch: all 32768, lowest MAC wins</option>
                    <option v-for="entry in switches" :key="entry.id" :value="entry.id">{{ entry.label }}</option>
                </select>
            </label>
            <div class="ac-field">
                <span>Cables</span>
                <div class="ac-row" role="group" aria-label="Cables">
                    <button
                        v-for="link in shownLinks"
                        :key="link.id"
                        type="button"
                        class="ac-button small"
                        :aria-pressed="cut.includes(link.id)"
                        @click="toggleCut(link.id)"
                    >
                        {{ cut.includes(link.id) ? "Reconnect" : "Cut" }} {{ link.name }}
                    </button>
                    <button type="button" class="ac-button small" :aria-pressed="extraCable" @click="extraCable = !extraCable">
                        {{ extraCable ? "Remove" : "Add" }} a second cable, sw-02 to sw-03
                    </button>
                </div>
            </div>
        </div>

        <div class="ac-row send">
            <button v-if="!running" type="button" class="ac-button primary" @click="send">Send a broadcast</button>
            <button v-else type="button" class="ac-button" @click="stop">Stop</button>
        </div>

        <p v-if="said" class="ac-say" :class="said.kind" :data-word="said.word" aria-live="polite">{{ said.text }}</p>
        <p v-else class="ac-say quiet" aria-live="polite">
            Send a broadcast with spanning tree off. Then turn it on, send again, and cut the cable between sw-01 and sw-02.
        </p>
        <p class="note">
            Each round, every copy crosses one cable. The widget counts rounds, not time. It opens a blocked port as soon as you cut a
            cable; real switches first have to notice the cut, which takes a while, longer with the original STP than with RSTP. The MAC
            addresses end in 01, 02 and 03, in the order of the switch names.
        </p>

        <CodeView :code="code" title="The switches’ files" />
    </div>
</template>

<style scoped>
.cable.cut {
    stroke: var(--circuit-removed);
    stroke-dasharray: 10 8;
}

.blocked rect {
    fill: var(--circuit-paper);
    stroke: var(--circuit-ink);
    stroke-width: 2;
}

.blocked path {
    stroke: var(--circuit-ink);
    stroke-width: 2.2;
    stroke-linecap: round;
}

.count rect {
    fill: var(--circuit-yellow);
    stroke: #0a1a36;
    stroke-width: 1.5;
}

.count text {
    fill: #0a1a36 !important;
    font-size: 13px !important;
    font-weight: 700;
}

.counters {
    margin: 8px 0 0;
    font-size: 15px;
}

.controls {
    display: flex;
    flex-wrap: wrap;
    gap: 14px 24px;
    margin-top: 12px;
}

.controls .ac-select {
    max-width: 100%;
}

.send {
    margin-top: 14px;
}

.quiet,
.note {
    color: var(--circuit-soft);
}

.note {
    margin: 8px 0 0;
    font-size: 14px;
}
</style>
