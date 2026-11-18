<script setup lang="ts">
// Lesson: networks of networks. The reader joins their own AS to a small internet with transit and peering links, and sees which networks each can reach and who pays whom.

import { computed, ref } from "vue";
import { AsPaths, type AsLink } from "./AsInternet";

const networks = [
    { id: "64500", name: "Your network", x: 350, y: 235 },
    { id: "6939", name: "Hurricane Electric", x: 200, y: 60 },
    { id: "174", name: "Cogent", x: 500, y: 60 },
    { id: "20940", name: "Akamai", x: 95, y: 200 },
    { id: "2906", name: "Netflix", x: 605, y: 200 },
];

const at = (id: string) => networks.find((network) => network.id === id)!;
const named = (id: string) => at(id).name;

const starting: AsLink[] = [
    { kind: "peering", a: "6939", b: "174" },
    { kind: "transit", customer: "20940", provider: "6939" },
    { kind: "transit", customer: "2906", provider: "174" },
];

const links = ref<AsLink[]>(starting.map((link) => ({ ...link })));

const ends = (link: AsLink): [string, string] => (link.kind === "transit" ? [link.customer, link.provider] : [link.a, link.b]);

function describe(link: AsLink): string {
    if (link.kind === "transit") return `${named(link.customer)} buys transit from ${named(link.provider)}.`;
    return `${named(link.a)} and ${named(link.b)} peer.`;
}

// Adding a link.
const first = ref("64500");
const relation = ref<"transit" | "peering">("transit");
const second = ref("6939");
const formError = ref("");

function add() {
    if (first.value === second.value) {
        formError.value = "Pick two different networks.";
        return;
    }

    const taken = links.value.some((link) => {
        const [a, b] = ends(link);
        return (a === first.value && b === second.value) || (a === second.value && b === first.value);
    });

    if (taken) {
        formError.value = `${named(first.value)} and ${named(second.value)} already have a link. Remove it first to change it.`;
        return;
    }

    links.value = [
        ...links.value,
        relation.value === "transit"
            ? { kind: "transit", customer: first.value, provider: second.value }
            : { kind: "peering", a: first.value, b: second.value },
    ];
    formError.value = "";
}

function remove(index: number) {
    links.value = links.value.filter((_, position) => position !== index);
}

function reset() {
    links.value = starting.map((link) => ({ ...link }));
    formError.value = "";
}

// Looking from one network.
const from = ref("64500");
const to = ref("2906");

const reach = computed(() =>
    networks
        .filter((network) => network.id !== from.value)
        .map((network) => ({ ...network, path: AsPaths.between(links.value, from.value, network.id) }))
);

const path = computed(() => (from.value === to.value ? undefined : AsPaths.between(links.value, from.value, to.value)));

function onPath(link: AsLink): boolean {
    const [a, b] = ends(link);
    const route = path.value ?? [];
    return route.some((id, index) => index > 0 && ((route[index - 1] === a && id === b) || (route[index - 1] === b && id === a)));
}

const said = computed(() => {
    if (from.value === to.value) return { kind: "warn", word: "Same network", text: "Pick two different networks." };

    const route = path.value;
    const own = links.value.some((link) => ends(link).includes(from.value));

    if (!own)
        return {
            kind: "bad",
            word: "No route",
            text: `${named(from.value)} has no links yet. Give it a transit provider or a peer.`,
        };
    if (!route) return { kind: "bad", word: "No route", text: "No network on the way would carry it." };

    const why =
        route.length === 2
            ? "The two are linked directly."
            : "Each network in between carries it because the traffic comes from, or goes to, a customer who pays it.";

    return { kind: "good", word: "Reaches it", text: `${route.map(named).join(", ")}. ${why}` };
});

const bills = computed(() =>
    networks.map((network) => ({
        ...network,
        pays: links.value
            .filter((link) => link.kind === "transit" && link.customer === network.id)
            .map((link) => named((link as { provider: string }).provider)),
        paid: links.value
            .filter((link) => link.kind === "transit" && link.provider === network.id)
            .map((link) => named((link as { customer: string }).customer)),
    }))
);

/** A small arrow at the middle of a transit link, pointing from the customer to the provider it pays. */
function arrow(link: AsLink): string {
    const [customer, provider] = ends(link);
    const start = at(customer);
    const end = at(provider);
    const angle = (Math.atan2(end.y - start.y, end.x - start.x) * 180) / Math.PI;
    const middle = [(start.x + end.x) / 2, (start.y + end.y) / 2];
    return `translate(${middle[0]} ${middle[1]}) rotate(${angle})`;
}
</script>

<template>
    <div class="as-internet">
        <svg
            class="ac-drawing"
            viewBox="0 0 700 380"
            role="img"
            :aria-label="`Five networks joined by transit and peering links. ${path ? 'The way from ' + named(from) + ' to ' + named(to) + ' is lit.' : ''}`"
        >
            <g v-for="(link, index) in links" :key="index">
                <line
                    class="cable"
                    :class="{ lit: onPath(link), peering: link.kind === 'peering' }"
                    :x1="at(ends(link)[0]).x"
                    :y1="at(ends(link)[0]).y"
                    :x2="at(ends(link)[1]).x"
                    :y2="at(ends(link)[1]).y"
                />
                <path v-if="link.kind === 'transit'" class="pays" :transform="arrow(link)" d="M-9 -8L9 0L-9 8z" />
            </g>
            <SvgDevice
                v-for="network in networks"
                :key="network.id"
                kind="cloud"
                :x="network.x"
                :y="network.y"
                :label="network.name"
                :note="`AS${network.id}`"
                :lit="network.id === from || network.id === to"
                :dim="network.id !== from && !reach.find((entry) => entry.id === network.id)?.path"
            />
            <g class="legend" transform="translate(470 330)">
                <line class="cable" x1="0" y1="0" x2="40" y2="0" />
                <path class="pays" transform="translate(20 0)" d="M-9 -8L9 0L-9 8z" />
                <text x="50" y="4">transit: arrow to who is paid</text>
                <line class="cable peering" x1="0" y1="24" x2="40" y2="24" />
                <text x="50" y="28">peering: nobody pays</text>
            </g>
        </svg>

        <div class="ac-row look">
            <label class="ac-field">
                <span>Look from</span>
                <select v-model="from" class="ac-select">
                    <option v-for="network in networks" :key="network.id" :value="network.id">
                        {{ network.name }}, AS{{ network.id }}
                    </option>
                </select>
            </label>
            <label class="ac-field">
                <span>to</span>
                <select v-model="to" class="ac-select">
                    <option v-for="network in networks" :key="network.id" :value="network.id">
                        {{ network.name }}, AS{{ network.id }}
                    </option>
                </select>
            </label>
        </div>

        <p class="ac-say" :class="said.kind" :data-word="said.word" aria-live="polite">{{ said.text }}</p>

        <div class="frame">
            <table class="ac-table">
                <thead>
                    <tr>
                        <th>To</th>
                        <th>The way</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="entry in reach" :key="entry.id" :class="{ lit: entry.id === to }">
                        <td>{{ entry.name }}, AS{{ entry.id }}</td>
                        <td>{{ entry.path ? entry.path.map(named).join(", ") : "no route" }}</td>
                    </tr>
                </tbody>
            </table>
        </div>

        <form class="add" @submit.prevent="add">
            <span class="title">Add a link</span>
            <div class="ac-row">
                <select v-model="first" class="ac-select" aria-label="First network">
                    <option v-for="network in networks" :key="network.id" :value="network.id">
                        {{ network.name }}, AS{{ network.id }}
                    </option>
                </select>
                <select v-model="relation" class="ac-select" aria-label="Kind of link">
                    <option value="transit">buys transit from</option>
                    <option value="peering">peers with</option>
                </select>
                <select v-model="second" class="ac-select" aria-label="Second network">
                    <option v-for="network in networks" :key="network.id" :value="network.id">
                        {{ network.name }}, AS{{ network.id }}
                    </option>
                </select>
                <button type="submit" class="ac-button primary">Add</button>
            </div>
            <p v-if="formError" class="ac-say bad" data-word="Not added" aria-live="polite">{{ formError }}</p>
        </form>

        <ul class="links">
            <li v-for="(link, index) in links" :key="index">
                <span>{{ describe(link) }}</span>
                <button type="button" class="ac-button small" :aria-label="`Remove the link: ${describe(link)}`" @click="remove(index)">
                    Remove
                </button>
            </li>
        </ul>
        <div class="ac-row">
            <button type="button" class="ac-button small" @click="reset">Start again</button>
        </div>

        <details class="bills">
            <summary>Who pays whom</summary>
            <ul>
                <li v-for="network in bills" :key="network.id">
                    <strong>{{ named(network.id) }}</strong>
                    pays {{ network.pays.length ? network.pays.join(" and ") : "nobody" }}, and is paid by
                    {{ network.paid.length ? network.paid.join(" and ") : "nobody" }}.
                </li>
            </ul>
        </details>
    </div>
</template>

<style scoped>
.cable.peering {
    stroke-dasharray: 7 6;
}

.pays {
    fill: var(--circuit-edge, #7b86a0);
    stroke: none;
}

.ac-drawing .legend text {
    font-size: 12px;
}

.look {
    align-items: end;
    margin-top: 8px;
}

.frame {
    margin-top: 12px;
    overflow-x: auto;
}

.add {
    margin-top: 20px;
}

.title {
    display: block;
    margin-bottom: 6px;
    color: var(--circuit-soft);
    font-size: 13px;
    font-weight: 600;
}

.links {
    display: grid;
    gap: 6px;
    margin: 14px 0 10px !important;
    padding: 0 !important;
    list-style: none;
}

.links li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin: 0 !important;
    padding: 6px 10px;
    border-left: 3px solid var(--circuit-line);
    background: var(--circuit-mist);
    font-size: 14.5px;
}

.bills {
    margin-top: 14px;
}

.bills summary {
    min-height: 40px;
    padding: 8px 0;
    font-weight: 700;
    cursor: pointer;
}

.bills ul {
    margin: 0 !important;
    font-size: 14.5px;
}
</style>
