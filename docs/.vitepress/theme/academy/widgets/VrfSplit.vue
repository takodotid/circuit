<script setup lang="ts">
// Lesson: separate networks on one. Two customers use the same private addresses behind one provider router; the reader sends between offices with one routing table, then with a VRF for each customer.

import { computed, ref } from "vue";
import { useTravel } from "../travel";

type Customer = "a" | "b";
type Office = { id: string; customer: Customer; label: string; port: string; lan: string; next: string; x: number; y: number };

const offices: Office[] = [
    { id: "a1", customer: "a", label: "Customer A, office 1", port: "25g-1", lan: "10.1.1.0/24", next: "172.16.0.2", x: 95, y: 75 },
    { id: "a2", customer: "a", label: "Customer A, office 2", port: "25g-2", lan: "10.1.2.0/24", next: "172.16.0.6", x: 605, y: 75 },
    { id: "b1", customer: "b", label: "Customer B, office 1", port: "25g-3", lan: "10.1.1.0/24", next: "172.16.0.2", x: 95, y: 305 },
    { id: "b2", customer: "b", label: "Customer B, office 2", port: "25g-4", lan: "10.1.2.0/24", next: "172.16.0.6", x: 605, y: 305 },
];

const PE = { x: 350, y: 190 };
const DESTINATION = "10.1.2.20";

/** What circuit validate prints for each version of the file. */
const VALIDATE = {
    one: [
        "$ npx circuit validate",
        "  error  pe-01: 172.16.0.1 is on both port 25g-1 and port 25g-3",
        "  error  pe-01: 172.16.0.5 is on both port 25g-2 and port 25g-4",
        "",
        "2 error(s).",
    ].join("\n"),
    vrfs: ["$ npx circuit validate", "1 device(s), no errors."].join("\n"),
};

const at = (id: string) => offices.find((office) => office.id === id)!;

const mode = ref<"one" | "vrfs">("one");
const from = ref<"a1" | "b1">("b1");
const said = ref<{ kind: "good" | "bad"; word: string; text: string }>();
const lastPath = ref<string[]>([]);
const matched = ref<string>();

const vrfOf = (customer: Customer) => `cust-${customer}`;

type Row = { key: string; table: string; prefix: string; via: string; office: Office };

/** The routes, by table: every office in one table, or each customer's in its own VRF. */
const tables = computed(() => {
    const rows: Row[] = offices.map((office) => ({
        key: office.id,
        table: mode.value === "one" ? "main" : vrfOf(office.customer),
        prefix: office.lan,
        via: office.next,
        office,
    }));

    const names = mode.value === "one" ? ["main"] : ["cust-a", "cust-b"];
    return names.map((name) => ({ name, rows: rows.filter((row) => row.table === name) }));
});

const { position, travelling, travel } = useTravel();

function choose(next: "one" | "vrfs") {
    mode.value = next;
    said.value = undefined;
    lastPath.value = [];
    matched.value = undefined;
}

async function send() {
    const sender = at(from.value);
    const tableName = mode.value === "one" ? "main" : vrfOf(sender.customer);
    const table = tables.value.find((entry) => entry.name === tableName)!;

    // Both offices 2 hold 10.1.2.0/24. In one table the router can use only one of the two routes; the drawing takes the first written.
    const row = table.rows.find((entry) => entry.prefix === "10.1.2.0/24")!;
    matched.value = row.key;
    said.value = undefined;
    lastPath.value = [sender.id, row.office.id];

    await travel([
        [sender.x, sender.y],
        [PE.x, PE.y],
        [row.office.x, row.office.y],
    ]);

    if (row.office.customer === sender.customer) {
        said.value = {
            kind: "good",
            word: "Delivered",
            text:
                mode.value === "one"
                    ? `The router found 10.1.2.0/24 via ${row.via} on port ${row.office.port}, and it happened to be ${row.office.label}. Now send from the other customer.`
                    : `The packet arrived on ${sender.port}, which is in VRF ${tableName}, so the router looked only in that table and found ${row.office.label}. The other customer's 10.1.2.0/24 is in a table this packet never sees.`,
        };
        return;
    }

    said.value = {
        kind: "bad",
        word: "Wrong customer",
        text: `The table holds two routes to 10.1.2.0/24 and cannot tell whose ${DESTINATION} the packet means. It used the route via ${row.via} on port ${row.office.port}, so the packet from ${sender.label} was delivered to ${row.office.label}: another company's network.`,
    };
}

const isLit = (id: string) => lastPath.value.includes(id);

const code = computed(() => {
    const vrf = (customer: Customer) => (mode.value === "vrfs" ? `, vrf: "${vrfOf(customer)}"` : "");
    const lines = [
        ...(mode.value === "vrfs"
            ? ["vrfs: {", '    "cust-a": { description: "Customer A" },', '    "cust-b": { description: "Customer B" },', "},", ""]
            : []),
        "ports: {",
        ...offices.map((office) => {
            const address = office.next.replace(/\d+$/, (last) => String(Number(last) - 1));
            return `    "${office.port}": { description: "${office.label}", addresses: ["${address}/30"]${vrf(office.customer)} },`;
        }),
        "},",
        "",
        "routing: {",
        "    static: [",
        ...offices.map(
            (office) => `        { prefix: "${office.lan}", via: "${office.next}"${vrf(office.customer)}, description: "${office.label}" },`
        ),
        "    ],",
        "},",
    ];
    return lines.join("\n");
});
</script>

<template>
    <div class="vrf-split">
        <div class="ac-field">
            <span>Routing tables on pe-01</span>
            <div class="ac-row" role="group" aria-label="Routing tables on pe-01">
                <button type="button" class="ac-button small" :aria-pressed="mode === 'one'" @click="choose('one')">
                    One table for everyone
                </button>
                <button type="button" class="ac-button small" :aria-pressed="mode === 'vrfs'" @click="choose('vrfs')">
                    A VRF for each customer
                </button>
            </div>
        </div>

        <svg
            class="ac-drawing"
            viewBox="0 0 700 380"
            role="img"
            aria-label="One provider router, pe-01, with two offices of Customer A above and two offices of Customer B below. Both customers use 10.1.1.0/24 in office 1 and 10.1.2.0/24 in office 2."
        >
            <rect v-if="mode === 'vrfs'" class="zone" x="20" y="18" width="660" height="127" />
            <rect v-if="mode === 'vrfs'" class="zone" x="20" y="255" width="660" height="117" />
            <text v-if="mode === 'vrfs'" class="zone-name" x="350" y="38" text-anchor="middle">VRF cust-a</text>
            <text v-if="mode === 'vrfs'" class="zone-name" x="350" y="275" text-anchor="middle">VRF cust-b</text>

            <line
                v-for="office in offices"
                :key="office.id"
                class="cable"
                :class="{ lit: isLit(office.id) }"
                :x1="PE.x"
                :y1="PE.y"
                :x2="office.x"
                :y2="office.y"
            />
            <SvgDevice
                kind="router"
                :x="PE.x"
                :y="PE.y"
                label="pe-01"
                :note="mode === 'one' ? 'one table' : 'two VRFs'"
                :lit="travelling"
            />
            <SvgDevice
                v-for="office in offices"
                :key="`d-${office.id}`"
                kind="router"
                :x="office.x"
                :y="office.y"
                :label="office.label"
                :note="office.lan"
                :lit="office.id === from"
            />
            <circle v-if="travelling" class="packet" :cx="position[0]" :cy="position[1]" r="9" />
        </svg>

        <div class="send">
            <label class="ac-field">
                <span>Send to {{ DESTINATION }}, office 2, from</span>
                <select v-model="from" class="ac-select" @change="((said = undefined), (lastPath = []), (matched = undefined))">
                    <option value="a1">Customer A, office 1</option>
                    <option value="b1">Customer B, office 1</option>
                </select>
            </label>
            <button type="button" class="ac-button primary" :disabled="travelling" @click="send">Send a packet</button>
        </div>

        <p v-if="said" class="ac-say" :class="said.kind" :data-word="said.word" aria-live="polite">{{ said.text }}</p>
        <p v-else class="ac-say hint" aria-live="polite">
            Send from each customer with one table. Then give each customer a VRF and send again.
        </p>

        <div class="tables">
            <div v-for="table in tables" :key="table.name" class="frame">
                <p class="table-name">Table {{ table.name }}</p>
                <table class="ac-table">
                    <thead>
                        <tr>
                            <th>Prefix</th>
                            <th>Via</th>
                            <th>Port</th>
                            <th>Whose</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="row in table.rows" :key="row.key" :class="{ lit: matched === row.key }">
                            <td class="ac-mono">{{ row.prefix }}</td>
                            <td class="ac-mono">{{ row.via }}</td>
                            <td class="ac-mono">{{ row.office.port }}</td>
                            <td>{{ row.office.label }}</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>

        <CodeView :code="code" title="pe-01.ts, part of it" />
        <CodeView :code="VALIDATE[mode]" lang="shell" title="Terminal" />
    </div>
</template>

<style scoped>
.zone {
    fill: none;
    stroke: var(--circuit-link);
    stroke-width: 1.5;
    stroke-dasharray: 6 5;
}

.ac-drawing .zone-name {
    fill: var(--circuit-link);
    font-family: var(--circuit-mono);
    font-size: 12.5px;
    font-weight: 700;
}

.send {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: 10px;
    margin-top: 10px;
}

.hint {
    color: var(--circuit-soft);
}

.tables {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: 14px;
    margin-top: 14px;
}

.frame {
    overflow-x: auto;
}

.table-name {
    margin: 0;
    font-family: var(--circuit-mono);
    font-size: 13px;
    font-weight: 700;
}
</style>
