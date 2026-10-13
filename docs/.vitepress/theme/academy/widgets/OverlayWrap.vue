<script setup lang="ts">
// Lesson: separate networks on one. The reader follows either customer's packet across a provider core wrapped in VXLAN or in MPLS labels, sees which header each router reads, and finds the core MTU the wrapping needs.

import { computed, ref } from "vue";

type Kind = "vxlan" | "mpls";
type Header = { name: string; detail: string; bytes: number; part: "outer" | "service" | "inner" | "packet" };

/** Each customer's VRF on both PEs, and the VNI of its own tunnel between them. */
const customers = {
    a: { name: "Customer A", vrf: "cust-a", vni: 10001 },
    b: { name: "Customer B", vrf: "cust-b", vni: 10002 },
};

const kind = ref<Kind>("vxlan");
const whose = ref<keyof typeof customers>("a");
const packetSize = ref(1500);
const coreMtu = ref(1500);

const customer = computed(() => customers[whose.value]);

/** The headers on the core link, outermost first. Sizes: Ethernet 14 bytes, IPv4 20, UDP 8, VXLAN 8 (RFC 7348), an MPLS label 4 (RFC 3032). */
const headers = computed<Header[]>(() => {
    const { name, vni } = customer.value;
    const packet: Header = { name: `${name}'s packet`, detail: "10.1.1.20 to 10.1.2.20", bytes: packetSize.value, part: "packet" };

    if (kind.value === "vxlan") {
        return [
            { name: "Ethernet", detail: "to the next core router", bytes: 14, part: "outer" },
            { name: "IPv4", detail: "192.0.2.1 to 192.0.2.2, pe-01 to pe-02", bytes: 20, part: "outer" },
            { name: "UDP", detail: "to port 4789", bytes: 8, part: "outer" },
            { name: "VXLAN", detail: `VNI ${vni}: ${name}`, bytes: 8, part: "service" },
            { name: "Ethernet", detail: "between the two tunnel ends", bytes: 14, part: "inner" },
            packet,
        ];
    }

    return [
        { name: "Ethernet", detail: "to the next core router", bytes: 14, part: "outer" },
        { name: "Label", detail: "the way to pe-02", bytes: 4, part: "outer" },
        { name: "Label", detail: `${name}'s VPN at pe-02`, bytes: 4, part: "service" },
        packet,
    ];
});

/** What the core link must carry above the Ethernet header: for VXLAN the outer IP packet, for MPLS the labels and the packet. */
const needed = computed(() => headers.value.slice(1).reduce((sum, header) => sum + header.bytes, 0));
const added = computed(() => needed.value - packetSize.value);
const fits = computed(() => needed.value <= coreMtu.value);

const steps = computed(() => {
    const vxlan = kind.value === "vxlan";
    const { name, vrf, vni } = customer.value;
    return [
        {
            title: `${name}'s office 1 sends a packet`,
            text: `A plain packet to 10.1.2.20 arrives at pe-01 on the port for ${name}'s office 1. That port is in VRF ${vrf}.`,
        },
        {
            title: "pe-01 looks it up, and wraps it",
            text: vxlan
                ? `In VRF ${vrf}, 10.1.2.0/24 is behind pe-02, through ${name}'s own tunnel. pe-01 wraps the packet in a VXLAN header with VNI ${vni}, then in UDP and IP addressed to pe-02's loopback.`
                : `In VRF ${vrf}, 10.1.2.0/24 is behind pe-02. pe-01 puts two labels on it: an inner one that pe-02 gave for ${name}'s VPN, and an outer one that leads to pe-02.`,
        },
        {
            title: "A core router passes it on",
            text: vxlan
                ? "The core router reads only the outer IP header: a packet from pe-01 to pe-02, the same for both customers. It holds no customer routes, and cannot confuse the two customers' 10.1.2.0/24."
                : "The core router reads only the outer label, the same for both customers, and swaps it for the next one toward pe-02. It holds no customer routes, and cannot confuse the two customers' 10.1.2.0/24.",
        },
        {
            title: "pe-02 unwraps it",
            text: vxlan
                ? `pe-02 removes the outer headers. VNI ${vni} says the packet is ${name}'s, so it looks up 10.1.2.20 in VRF ${vrf} and sends it to ${name}'s office 2.`
                : `pe-02 reads the inner label, which says ${name}'s VPN, so it looks up 10.1.2.20 in VRF ${vrf} and sends it to ${name}'s office 2.`,
        },
    ];
});

const stations = [
    { label: "Office 1", kind: "router" as const, x: 70 },
    { label: "pe-01", kind: "router" as const, x: 250 },
    { label: "Core", kind: "router" as const, x: 430 },
    { label: "pe-02", kind: "router" as const, x: 610 },
];

const stationX = (step: number) => stations[step]?.x ?? 70;

/** Which headers the router at a step reads. */
function readAt(step: number, header: Header): boolean {
    if (step === 0 || step === 1) return header.part === "packet";
    if (step === 2) return header.part === "outer" && (kind.value === "mpls" ? header.name === "Label" : header.name === "IPv4");
    return header.part === "service" || header.part === "packet";
}

/** pe-01 adds every header around the customer's packet. */
const addedAt = (step: number, header: Header) => step === 1 && header.part !== "packet";

/** On the customer's own link the packet is plain. */
const shownAt = (step: number) => (step === 0 ? headers.value.filter((header) => header.part === "packet") : headers.value);

const mtus = [1500, 1550, 9000];
const sizes = [1400, 1500];
</script>

<template>
    <div class="overlay-wrap">
        <div class="choices">
            <div class="ac-field">
                <span>How the core carries the traffic</span>
                <div class="ac-row" role="group" aria-label="How the core carries the traffic">
                    <button type="button" class="ac-button small" :aria-pressed="kind === 'vxlan'" @click="kind = 'vxlan'">VXLAN</button>
                    <button type="button" class="ac-button small" :aria-pressed="kind === 'mpls'" @click="kind = 'mpls'">
                        MPLS labels
                    </button>
                </div>
            </div>
            <div class="ac-field">
                <span>Whose packet</span>
                <div class="ac-row" role="group" aria-label="Whose packet">
                    <button type="button" class="ac-button small" :aria-pressed="whose === 'a'" @click="whose = 'a'">Customer A</button>
                    <button type="button" class="ac-button small" :aria-pressed="whose === 'b'" @click="whose = 'b'">Customer B</button>
                </div>
            </div>
        </div>

        <StepThrough :key="`${kind}-${whose}`" :steps="steps" v-slot="{ step }">
            <svg
                class="ac-drawing"
                viewBox="0 0 700 120"
                role="img"
                :aria-label="`${customer.name}'s office 1, then pe-01, a core router and pe-02, in a line.`"
            >
                <line class="cable" x1="70" y1="45" x2="610" y2="45" />
                <line class="cable lit" :x1="70" y1="45" :x2="stationX(step)" y2="45" />
                <SvgDevice
                    v-for="(station, index) in stations"
                    :key="station.label"
                    :kind="station.kind"
                    :x="station.x"
                    :y="45"
                    :label="station.label"
                    :lit="index === step"
                />
            </svg>

            <ol class="stack" :aria-label="`The headers on the wire at step ${step + 1}, outermost first`">
                <li
                    v-for="(header, index) in shownAt(step)"
                    :key="`${header.name}-${index}`"
                    :class="[header.part, { read: readAt(step, header) }]"
                >
                    <span class="name">{{ header.name }}</span>
                    <span class="detail">{{ header.detail }}</span>
                    <span class="bytes">{{ header.bytes }} bytes</span>
                    <span v-if="readAt(step, header)" class="read-mark">Read here</span>
                    <span v-else-if="addedAt(step, header)" class="added-mark">Added here</span>
                </li>
            </ol>
        </StepThrough>

        <div class="mtu">
            <label class="ac-field">
                <span>Customer packet</span>
                <select v-model.number="packetSize" class="ac-select">
                    <option v-for="size in sizes" :key="size" :value="size">{{ size }} bytes</option>
                </select>
            </label>
            <label class="ac-field">
                <span>MTU of the core links</span>
                <select v-model.number="coreMtu" class="ac-select">
                    <option v-for="mtu in mtus" :key="mtu" :value="mtu">{{ mtu }} bytes</option>
                </select>
            </label>
        </div>

        <p class="ac-say" :class="fits ? 'good' : 'bad'" :data-word="fits ? 'Fits' : 'Too big'" aria-live="polite">
            {{ kind === "vxlan" ? "VXLAN adds" : "Two labels add" }} {{ added }} bytes, so the core must carry {{ needed }} bytes where the
            customer sent {{ packetSize }}.
            <template v-if="fits"> The core links take {{ coreMtu }}, so it fits.</template>
            <template v-else-if="kind === 'vxlan'">
                The core links take only {{ coreMtu }}. RFC 7348 says a tunnel end must not split a VXLAN packet, so it is dropped: raise
                the core MTU, or lower the tunnel's own.</template
            >
            <template v-else> The core links take only {{ coreMtu }}, so it does not get across in one piece: raise the core MTU.</template>
        </p>
    </div>
</template>

<style scoped>
.choices {
    display: flex;
    flex-wrap: wrap;
    gap: 12px 24px;
}

.stack {
    display: grid;
    gap: 3px;
    margin: 6px 0 0 !important;
    padding: 0 !important;
    list-style: none;
}

.stack li {
    display: grid;
    grid-template-columns: 7.5em minmax(0, 1fr) auto auto;
    align-items: center;
    gap: 10px;
    margin: 0 !important;
    padding: 6px 10px;
    border-left: 6px solid var(--circuit-line);
    background: var(--circuit-mist);
    font-size: 14px;
    line-height: 1.4;
    transition: background-color 0.2s;
}

.stack li.outer {
    border-left-color: var(--circuit-edge);
}

.stack li.service {
    border-left-color: var(--circuit-cobalt);
}

.stack li.packet {
    border-left-color: var(--circuit-ink);
}

.stack li.read {
    background: var(--circuit-selected);
    color: #11141b;
}

.dark .stack li.read {
    color: var(--circuit-ink);
}

.name {
    font-weight: 700;
}

.detail {
    font-family: var(--circuit-mono);
    font-size: 13px;
}

.bytes {
    color: var(--circuit-soft);
    white-space: nowrap;
}

.stack li.read .bytes {
    color: inherit;
}

.read-mark {
    padding: 0 6px;
    background: var(--circuit-yellow);
    color: #0a1a36;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.08em;
    line-height: 20px;
    text-transform: uppercase;
    white-space: nowrap;
}

.added-mark {
    padding: 0 6px;
    border: 1.5px solid var(--circuit-cobalt);
    color: var(--circuit-link);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.08em;
    line-height: 17px;
    text-transform: uppercase;
    white-space: nowrap;
}

.mtu {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    margin-top: 18px;
}

@media (max-width: 640px) {
    .stack li {
        grid-template-columns: 1fr auto;
    }

    .detail {
        grid-column: 1 / -1;
        grid-row: 2;
    }
}

@media (prefers-reduced-motion: reduce) {
    .stack li {
        transition: none;
    }
}
</style>
