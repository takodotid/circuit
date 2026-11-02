<script setup lang="ts">
// Lesson: routers and the gateway. The reader sends from a laptop to a printer, the router and a far server, and watches the laptop find each hardware address it needs with ARP: a broadcast question, one answer, and a line in its ARP table.

import { computed, ref } from "vue";
import { useTravel, type Point } from "../travel";

type Id = "laptop" | "switch" | "printer" | "phone" | "router" | "server";

const places: Record<
    Id,
    { kind: "laptop" | "switch" | "printer" | "phone" | "router" | "server"; label: string; note: string; at: Point }
> = {
    laptop: { kind: "laptop", label: "Laptop", note: "192.168.1.20", at: [80, 150] },
    switch: { kind: "switch", label: "Switch", note: "", at: [290, 150] },
    printer: { kind: "printer", label: "Printer", note: "192.168.1.30", at: [470, 46] },
    phone: { kind: "phone", label: "Phone", note: "192.168.1.40", at: [470, 150] },
    router: { kind: "router", label: "Router", note: "192.168.1.1", at: [470, 262] },
    server: { kind: "server", label: "Far server", note: "203.0.113.80", at: [640, 262] },
};

/** The hardware address each device on the local network answers with. */
const hardware: Partial<Record<Id, string>> = {
    printer: "02:7c:e1:46:a8:3c",
    phone: "6e:04:b8:9d:23:2b",
    router: "00:1a:2b:3c:4d:01",
};

const targets: { id: Id; text: string }[] = [
    { id: "printer", text: "The printer, 192.168.1.30" },
    { id: "router", text: "The router, 192.168.1.1" },
    { id: "server", text: "A far server, 203.0.113.80" },
];

const to = ref<Id>("printer");
const table = ref<{ ip: string; mac: string; who: string }[]>([]);
const lit = ref<Id[]>([]);
const said = ref<{ kind: "good" | "warn"; word: string; text: string }>();
const busy = ref(false);

const { position, travelling, travel } = useTravel(320);
const shown = ref<"ask" | "answer" | "frame">();

/** The devices on the laptop's own network, each with a cable to the switch. */
const local: Id[] = ["laptop", "printer", "phone", "router"];

const path = (...ids: Id[]) => ids.map((id) => places[id].at);
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The device the laptop needs the hardware address of: the receiver itself on the same network, the gateway for anywhere else. */
const nextHop = computed<Id>(() => (to.value === "server" ? "router" : to.value));

async function send() {
    if (busy.value) return;
    busy.value = true;
    said.value = undefined;

    const hop = nextHop.value;
    const ip = places[hop].note;
    const known = table.value.find((row) => row.ip === ip);
    const near = to.value !== "server";
    const decision = near
        ? `${places[to.value].note} is on the laptop's own network, so the frame goes to the ${places[to.value].label.toLowerCase()} itself.`
        : `203.0.113.80 is on another network, so the frame goes to the gateway, 192.168.1.1. The laptop never asks for the far server's hardware address.`;

    if (!known) {
        // Everyone on the network hears the question; only the owner of the address answers.
        shown.value = "ask";
        lit.value = ["printer", "phone", "router"];
        await travel(path("laptop", "switch"));
        await wait(500);
        await travel(path("switch", hop));
        lit.value = [hop];

        shown.value = "answer";
        await travel(path(hop, "switch", "laptop"));
        table.value = [...table.value, { ip, mac: hardware[hop]!, who: places[hop].label }];
    }

    shown.value = "frame";
    lit.value = [hop];
    await travel(near ? path("laptop", "switch", hop) : path("laptop", "switch", "router", "server"));
    shown.value = undefined;
    lit.value = [];

    said.value = known
        ? {
              kind: "good",
              word: "From the table",
              text: `${decision} Its hardware address was already in the ARP table, so the laptop sent the frame at once, with no question.`,
          }
        : {
              kind: "warn",
              word: "Asked first",
              text: `${decision} The laptop did not know ${ip}'s hardware address, so it broadcast "who has ${ip}?". Every device heard it, only the ${places[hop].label.toLowerCase()} answered, and the laptop wrote the answer into its ARP table before sending.`,
          };

    busy.value = false;
}

function forget() {
    table.value = [];
    said.value = undefined;
}
</script>

<template>
    <div class="arp-lookup">
        <svg
            class="ac-drawing"
            viewBox="0 0 720 330"
            role="img"
            aria-label="A laptop, a printer, a phone and a router on one switch, and a far server behind the router."
        >
            <line
                v-for="id in local"
                :key="id"
                class="cable"
                :x1="places.switch.at[0]"
                :y1="places.switch.at[1]"
                :x2="places[id].at[0]"
                :y2="places[id].at[1]"
            />
            <line
                class="cable far"
                :x1="places.router.at[0]"
                :y1="places.router.at[1]"
                :x2="places.server.at[0]"
                :y2="places.server.at[1]"
            />
            <text class="caption" :x="(places.router.at[0] + places.server.at[0]) / 2" :y="places.router.at[1] - 16" text-anchor="middle">
                another network
            </text>

            <SvgDevice
                v-for="(place, id) in places"
                :key="id"
                :kind="place.kind"
                :x="place.at[0]"
                :y="place.at[1]"
                :label="place.label"
                :note="place.note || undefined"
                :lit="lit.includes(id)"
            />

            <g v-if="travelling" :transform="`translate(${position[0]} ${position[1]})`">
                <circle class="packet" :class="shown" r="10" />
                <text class="bubble" y="-16" text-anchor="middle">
                    {{ shown === "ask" ? "who has?" : shown === "answer" ? "it's me" : "frame" }}
                </text>
            </g>
        </svg>

        <div class="controls">
            <label class="ac-field">
                <span>Send from the laptop to</span>
                <select v-model="to" class="ac-select" :disabled="busy">
                    <option v-for="target in targets" :key="target.id" :value="target.id">{{ target.text }}</option>
                </select>
            </label>
            <button type="button" class="ac-button primary" :disabled="busy" @click="send">Send</button>
            <button type="button" class="ac-button" :disabled="busy || !table.length" @click="forget">Empty the ARP table</button>
        </div>

        <p v-if="said" class="ac-say" :class="said.kind" :data-word="said.word" aria-live="polite">{{ said.text }}</p>
        <p v-else class="ac-say hint" aria-live="polite">
            Send to the printer twice, then to the far server, and watch the laptop's ARP table.
        </p>

        <p class="table-name">The laptop's ARP table</p>
        <table class="ac-table">
            <thead>
                <tr>
                    <th scope="col">IP address</th>
                    <th scope="col">Hardware address</th>
                    <th scope="col">Who that is</th>
                </tr>
            </thead>
            <tbody>
                <tr v-for="row in table" :key="row.ip">
                    <td class="ac-mono">{{ row.ip }}</td>
                    <td class="ac-mono">{{ row.mac }}</td>
                    <td>{{ row.who }}</td>
                </tr>
                <tr v-if="!table.length">
                    <td colspan="3">Empty. The laptop has not asked anyone yet.</td>
                </tr>
            </tbody>
        </table>
    </div>
</template>

<style scoped>
.cable.far {
    stroke-dasharray: 6 6;
}

.ac-drawing .caption {
    fill: var(--circuit-soft);
    font-size: 12px;
}

.packet.ask {
    fill: var(--circuit-paper);
}

.ac-drawing .bubble {
    fill: var(--circuit-ink);
    font-size: 13px;
    font-weight: 700;
}

.controls {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: 10px;
    margin-top: 8px;
}

.hint {
    color: var(--circuit-soft);
}

.table-name {
    margin: 18px 0 0 !important;
    font-size: 13px !important;
    font-weight: 700;
}
</style>
