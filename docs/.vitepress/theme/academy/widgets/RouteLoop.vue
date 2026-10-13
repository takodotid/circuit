<script setup lang="ts">
// Lesson: routing tables. The reader sends a packet from the internet to an address in their block that nothing uses, and watches it bounce between two routers until its TTL runs out, then adds a blackhole route and sends again.

import { computed, ref } from "vue";
import { useTravel } from "../travel";
import { contains, parseIPv4, parsePrefix, type Prefix } from "./RouteLookup";

type Place = "internet" | "provider" | "yours" | "server";

const places: Record<Place, { kind: "cloud" | "router" | "server"; label: string; note: string; x: number; y: number }> = {
    internet: { kind: "cloud", label: "Someone online", note: "sends with TTL 64", x: 70, y: 80 },
    provider: { kind: "router", label: "Provider", note: "203.0.113.1", x: 260, y: 80 },
    yours: { kind: "router", label: "Your router", note: "203.0.113.2", x: 450, y: 80 },
    server: { kind: "server", label: "Office server", note: "198.51.100.20", x: 630, y: 80 },
};

const prefixOf = (text: string): Prefix => {
    const parsed = parsePrefix(text);
    if ("error" in parsed) throw new Error(parsed.error);
    return parsed.prefix;
};

type Entry = { prefix: string; to: Place | "drop" | "elsewhere"; says: string };

const providerTable: Entry[] = [
    { prefix: "198.51.100.0/24", to: "yours", says: "your router, 203.0.113.2" },
    { prefix: "0.0.0.0/0", to: "elsewhere", says: "the rest of the internet" },
];

const blackhole = ref(false);

const yourTable = computed<Entry[]>(() => [
    { prefix: "198.51.100.0/26", to: "server", says: "office network, connected" },
    ...(blackhole.value ? [{ prefix: "198.51.100.0/24", to: "drop" as const, says: "blackhole: drop" }] : []),
    { prefix: "0.0.0.0/0", to: "provider", says: "the provider, 203.0.113.1" },
]);

/** The entry a table uses for an address: the longest prefix that holds it. */
function decide(table: readonly Entry[], address: number): Entry | undefined {
    return table
        .filter((entry) => contains(prefixOf(entry.prefix), address))
        .sort((a, b) => prefixOf(b.prefix).length - prefixOf(a.prefix).length)[0];
}

const destinations = [
    { address: "198.51.100.20", label: "198.51.100.20, the office server" },
    { address: "198.51.100.200", label: "198.51.100.200, an address you have not used yet" },
];
const destination = ref("198.51.100.200");

type Hop = { at: "provider" | "yours"; ttl: number; entry?: Entry };

/** Every router the packet passes, with the TTL it leaves with, until it is delivered or dropped. */
const journey = computed(() => {
    const address = parseIPv4(destination.value)!;
    const hops: Hop[] = [];
    let at: "provider" | "yours" = "provider";
    let ttl = 64;

    while (true) {
        ttl -= 1;

        if (ttl === 0) {
            hops.push({ at, ttl });
            return { hops, end: "expired" as const, at };
        }

        const entry = decide(at === "provider" ? providerTable : yourTable.value, address);
        hops.push({ at, ttl, entry });

        if (!entry || entry.to === "drop") return { hops, end: "blackhole" as const, at };
        if (entry.to === "server") return { hops, end: "delivered" as const, at };

        at = at === "provider" ? "yours" : "provider";
    }
});

const { position, travelling, travel } = useTravel(320);
const busy = ref(false);
const ttlShown = ref(64);
const said = ref<{ kind: "good" | "bad"; word?: string; text: string }>();

/** How many legs to show moving before skipping to the end. */
const SHOWN_LEGS = 6;

const point = (place: Place): [number, number] => [places[place].x, places[place].y];

async function send() {
    busy.value = true;
    said.value = undefined;
    ttlShown.value = 64;

    const { hops, end, at } = journey.value;

    await travel([point("internet"), point("provider")]);

    for (const [index, hop] of hops.entries()) {
        ttlShown.value = hop.ttl;

        if (hop.entry?.to === "server") {
            await travel([point("yours"), point("server")]);
            break;
        }

        const next = hops[index + 1];
        if (!next) break;

        if (index >= SHOWN_LEGS) {
            ttlShown.value = hops[hops.length - 1]!.ttl;
            break;
        }

        await travel([point(hop.at), point(next.at)]);
    }

    const crossings = hops.filter((hop) => hop.entry?.to === "yours" || hop.entry?.to === "provider").length;

    if (end === "delivered") {
        said.value = {
            kind: "good",
            text: `198.51.100.20 is in 198.51.100.0/26, your office network, the longest match in your table. The server got the packet with a TTL of ${hops[hops.length - 1]!.ttl}.`,
        };
    } else if (end === "blackhole") {
        said.value = {
            kind: "bad",
            text: `Your router dropped it at once: for an address nothing uses, the blackhole route 198.51.100.0/24 is the longest match. The packet crossed your link to the provider ${crossings} time${crossings === 1 ? "" : "s"}.`,
        };
    } else {
        said.value = {
            kind: "bad",
            word: "Looped",
            text: `The provider sends 198.51.100.200 to you, and your router has nothing longer than the default route for it, so it sends it back. It went back and forth ${crossings} times across your link to the provider until ${at === "yours" ? "your router" : "the provider"} lowered its TTL to 0 and dropped it.`,
        };
    }

    busy.value = false;
}

function toggle() {
    blackhole.value = !blackhole.value;
    said.value = undefined;
}

const cables: [Place, Place][] = [
    ["internet", "provider"],
    ["provider", "yours"],
    ["yours", "server"],
];
</script>

<template>
    <div class="route-loop">
        <svg
            class="ac-drawing"
            viewBox="0 0 700 170"
            role="img"
            aria-label="Someone on the internet, the provider's router, your router and your office server, in a row. A packet travels between them."
        >
            <line
                v-for="[a, b] in cables"
                :key="a + b"
                class="cable"
                :x1="places[a].x"
                :y1="places[a].y"
                :x2="places[b].x"
                :y2="places[b].y"
            />
            <SvgDevice
                v-for="(place, id) in places"
                :key="id"
                :kind="place.kind"
                :x="place.x"
                :y="place.y"
                :label="place.label"
                :note="place.note"
            />
            <g v-if="travelling">
                <circle class="packet" :cx="position[0]" :cy="position[1]" r="9" />
                <text class="ttl" :x="position[0]" :y="position[1] - 16" text-anchor="middle">TTL {{ ttlShown }}</text>
            </g>
        </svg>

        <div class="tables">
            <div>
                <p class="table-name">Provider's table</p>
                <table class="ac-table">
                    <thead>
                        <tr>
                            <th>Prefix</th>
                            <th>Sends to</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="entry in providerTable" :key="entry.prefix">
                            <td class="ac-mono">{{ entry.prefix }}</td>
                            <td>{{ entry.says }}</td>
                        </tr>
                    </tbody>
                </table>
            </div>
            <div>
                <p class="table-name">Your table</p>
                <table class="ac-table">
                    <thead>
                        <tr>
                            <th>Prefix</th>
                            <th>Sends to</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="entry in yourTable" :key="entry.prefix" :class="{ lit: entry.to === 'drop' }">
                            <td class="ac-mono">{{ entry.prefix }}</td>
                            <td>{{ entry.says }}</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>

        <div class="controls">
            <label class="ac-field">
                <span>Send a packet to</span>
                <select v-model="destination" class="ac-select" :disabled="busy" @change="said = undefined">
                    <option v-for="entry in destinations" :key="entry.address" :value="entry.address">{{ entry.label }}</option>
                </select>
            </label>
            <button type="button" class="ac-button" :aria-pressed="blackhole" :disabled="busy" @click="toggle">
                {{ blackhole ? "Blackhole route: on" : "Blackhole route: off" }}
            </button>
            <button type="button" class="ac-button primary" :disabled="busy" @click="send">Send the packet</button>
        </div>

        <p v-if="said" class="ac-say" :class="said.kind" :data-word="said.word" aria-live="polite">{{ said.text }}</p>
        <p v-else-if="busy" class="ac-say hint" aria-live="polite">On its way. Watch the TTL above the packet.</p>
        <p v-else class="ac-say hint" aria-live="polite">
            Send a packet to the address you have not used yet, with the blackhole route off. Then turn it on and send again.
        </p>
    </div>
</template>

<style scoped>
.ttl {
    font-family: var(--circuit-mono);
    font-size: 12px !important;
    font-weight: 700;
}

.tables {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
    margin-top: 6px;
}

.table-name {
    margin: 0;
    font-size: 13px;
    font-weight: 700;
}

.controls {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: 10px;
    margin-top: 16px;
}

.hint {
    color: var(--circuit-soft);
}

@media (max-width: 640px) {
    .tables {
        grid-template-columns: 1fr;
    }
}
</style>
