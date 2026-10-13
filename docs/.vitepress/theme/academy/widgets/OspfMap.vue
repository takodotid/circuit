<script setup lang="ts">
// Lesson: OSPF. The reader picks two routers on a map of links and costs, sees the cheapest path OSPF computes, then cuts links or changes costs and watches the path move.

import { computed, ref } from "vue";
import { useTravel } from "../travel";
import { nextHops, pathsTo, shortestPaths, type Link } from "./OspfMap";

const routers = [
    { id: "R1", x: 70, y: 165 },
    { id: "R2", x: 240, y: 60 },
    { id: "R3", x: 240, y: 270 },
    { id: "R4", x: 460, y: 60 },
    { id: "R5", x: 460, y: 270 },
    { id: "R6", x: 630, y: 165 },
];

const ids = routers.map((router) => router.id);
const at = (id: string) => routers.find((router) => router.id === id)!;
const networkOf = (id: string) => `10.0.${id.slice(1)}.0/24`;

const startingLinks: Link[] = [
    { a: "R1", b: "R2", cost: 10, up: true },
    { a: "R1", b: "R3", cost: 10, up: true },
    { a: "R2", b: "R4", cost: 10, up: true },
    { a: "R3", b: "R5", cost: 20, up: true },
    { a: "R4", b: "R6", cost: 10, up: true },
    { a: "R5", b: "R6", cost: 10, up: true },
    { a: "R2", b: "R5", cost: 30, up: true },
    { a: "R4", b: "R5", cost: 100, up: true },
];

const links = ref<Link[]>(startingLinks.map((link) => ({ ...link })));
const costs = [1, 5, 10, 20, 30, 50, 100];

const from = ref("R1");
const to = ref("R6");

const paths = computed(() => shortestPaths(ids, links.value, from.value));
const cheapest = computed(() => pathsTo(paths.value, to.value));

const linkName = (link: Link) => `${link.a} to ${link.b}`;

/** Whether a link is on one of the cheapest paths. */
function onPath(link: Link): boolean {
    return cheapest.value.some((path) =>
        path.some(
            (router, index) =>
                index > 0 && ((path[index - 1] === link.a && router === link.b) || (path[index - 1] === link.b && router === link.a))
        )
    );
}

const lastChange = ref("");

function toggle(link: Link) {
    link.up = !link.up;
    lastChange.value = link.up
        ? `${link.a} and ${link.b} hear each other again. They tell every router, and every router runs the calculation again.`
        : `${link.a} and ${link.b} stop hearing each other. They tell every router the link is gone, and every router runs the calculation again.`;
}

function setCost(link: Link, cost: number) {
    link.cost = cost;
    lastChange.value = `The cost of ${linkName(link)} is now ${cost}. Every router learns it and runs the calculation again.`;
}

function onCost(link: Link, event: Event) {
    setCost(link, Number((event.target as HTMLSelectElement).value));
}

function reset() {
    links.value = startingLinks.map((link) => ({ ...link }));
    lastChange.value = "";
}

const said = computed(() => {
    if (from.value === to.value) return { kind: "warn", word: "Same router", text: "Pick two different routers." };

    const found = cheapest.value;
    const cost = paths.value.cost.get(to.value);

    if (!found.length)
        return {
            kind: "bad",
            word: "No path",
            text: `With these links down, ${from.value} has no way to ${to.value}. Its routing table has no route for ${networkOf(to.value)}.`,
        };

    const written = (path: string[]) => path.join(", ");

    if (found.length === 1) return { kind: "good", word: "Cheapest", text: `${written(found[0]!)}, a total cost of ${cost}.` };

    return {
        kind: "good",
        word: "A tie",
        text: `${found.length} paths cost ${cost}: ${found.map(written).join(" and ")}. OSPF can use them all, and share the traffic between them.`,
    };
});

/** The routing table OSPF builds on the router the reader sends from: every other router's network, its next hops and its cost. */
const table = computed(() =>
    ids
        .filter((id) => id !== from.value)
        .map((id) => ({
            id,
            prefix: networkOf(id),
            via: nextHops(paths.value, id).join(" or "),
            cost: paths.value.cost.get(id),
        }))
);

const { position, travelling, travel } = useTravel(300);

async function send() {
    const path = cheapest.value[0];
    if (!path || from.value === to.value) return;
    await travel(path.map((id) => [at(id).x, at(id).y]));
}

// The part of the sending router's file that sets its link costs, one port per link.
const code = computed(() => {
    const own = links.value.filter((link) => link.a === from.value || link.b === from.value);
    const lines = own.map((link, index) => {
        const neighbor = link.a === from.value ? link.b : link.a;
        return `                    "25g-${index + 1}": { cost: ${link.cost}, network: "point-to-point" }, // to ${neighbor}`;
    });

    return [
        "routing: {",
        `    router_id: "10.255.255.${from.value.slice(1)}",`,
        "    ospf: {",
        "        areas: {",
        '            "0.0.0.0": {',
        "                interfaces: {",
        ...lines,
        "                    office: { passive: true },",
        "                },",
        "            },",
        "        },",
        "    },",
        "},",
    ].join("\n");
});
</script>

<template>
    <div class="ospf-map">
        <div class="ac-row pick">
            <label class="ac-field">
                <span>From</span>
                <select v-model="from" class="ac-select">
                    <option v-for="id in ids" :key="id" :value="id">{{ id }}</option>
                </select>
            </label>
            <label class="ac-field">
                <span>To the network of</span>
                <select v-model="to" class="ac-select">
                    <option v-for="id in ids" :key="id" :value="id">{{ id }}, {{ networkOf(id) }}</option>
                </select>
            </label>
            <button type="button" class="ac-button primary" :disabled="travelling || !cheapest.length || from === to" @click="send">
                Send a packet
            </button>
        </div>

        <svg
            class="ac-drawing"
            viewBox="0 0 700 340"
            role="img"
            :aria-label="`Six routers joined by eight links, each with a cost. The cheapest path from ${from} to ${to} is lit.`"
        >
            <g v-for="link in links" :key="linkName(link)" class="link" :class="{ down: !link.up }">
                <line
                    class="cable"
                    :class="{ lit: link.up && onPath(link) }"
                    :x1="at(link.a).x"
                    :y1="at(link.a).y"
                    :x2="at(link.b).x"
                    :y2="at(link.b).y"
                />
                <g :transform="`translate(${(at(link.a).x + at(link.b).x) / 2} ${(at(link.a).y + at(link.b).y) / 2})`">
                    <rect class="cost" :class="{ lit: link.up && onPath(link) }" x="-17" y="-11" width="34" height="22" />
                    <text class="cost-text" y="4.5" text-anchor="middle">{{ link.up ? link.cost : "cut" }}</text>
                </g>
            </g>
            <SvgDevice
                v-for="router in routers"
                :key="router.id"
                kind="router"
                :x="router.x"
                :y="router.y"
                :label="router.id"
                :note="networkOf(router.id)"
                :lit="router.id === from || router.id === to"
            />
            <circle v-if="travelling" class="packet" :cx="position[0]" :cy="position[1]" r="9" />
        </svg>

        <p class="ac-say" :class="said.kind" :data-word="said.word" aria-live="polite">{{ said.text }}</p>
        <p v-if="lastChange" class="change">{{ lastChange }}</p>

        <div class="frame">
            <table class="ac-table links">
                <thead>
                    <tr>
                        <th>Link</th>
                        <th>Cost</th>
                        <th>Cable</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="link in links" :key="linkName(link)" :class="{ lit: link.up && onPath(link) }">
                        <td>{{ linkName(link) }}<span v-if="link.up && onPath(link)" class="on-path"> (on the path)</span></td>
                        <td>
                            <select
                                class="ac-select"
                                :value="link.cost"
                                :aria-label="`Cost of ${linkName(link)}`"
                                @change="onCost(link, $event)"
                            >
                                <option v-for="cost in costs" :key="cost" :value="cost">{{ cost }}</option>
                            </select>
                        </td>
                        <td>
                            <button
                                type="button"
                                class="ac-button small"
                                :aria-label="`${link.up ? 'Cut' : 'Repair'} ${linkName(link)}`"
                                @click="toggle(link)"
                            >
                                {{ link.up ? "Cut" : "Repair" }}
                            </button>
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
        <div class="ac-row reset">
            <button type="button" class="ac-button small" @click="reset">Put every link back</button>
        </div>

        <p class="table-name">{{ from }}'s routing table, worked out by OSPF</p>
        <div class="frame">
            <table class="ac-table">
                <thead>
                    <tr>
                        <th>Prefix</th>
                        <th>Next hop</th>
                        <th>Cost</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="row in table" :key="row.id" :class="{ lit: row.id === to }">
                        <td class="ac-mono">{{ row.prefix }}</td>
                        <td>{{ row.cost === undefined ? "no route" : row.via }}</td>
                        <td>{{ row.cost ?? "" }}</td>
                    </tr>
                </tbody>
            </table>
        </div>

        <CodeView :code="code" :title="`${from.toLowerCase()}.ts, part of it`" />
    </div>
</template>

<style scoped>
.pick {
    align-items: end;
    margin-bottom: 8px;
}

.link.down .cable {
    stroke-dasharray: 5 7;
    opacity: 0.5;
}

.cost {
    fill: var(--circuit-paper);
    stroke: var(--circuit-ink);
    stroke-width: 1.5;
}

.cost.lit {
    fill: var(--circuit-yellow);
}

.ac-drawing .cost-text {
    font-family: var(--circuit-mono);
    font-size: 12px;
    font-weight: 700;
}

.ac-drawing .cost.lit + .cost-text {
    fill: #0a1a36;
}

.link.down .cost {
    stroke-dasharray: 3 3;
}

.change {
    margin: 6px 0 0;
    color: var(--circuit-soft);
    font-size: 14.5px;
}

.frame {
    margin-top: 10px;
    overflow-x: auto;
}

.links .ac-select {
    min-height: 36px;
    padding: 2px 8px;
}

.on-path {
    color: var(--circuit-soft);
    font-size: 13px;
}

tr.lit .on-path {
    color: inherit;
}

.reset {
    margin-top: 8px;
}

.table-name {
    margin: 18px 0 0;
    font-size: 13px;
    font-weight: 700;
}
</style>
