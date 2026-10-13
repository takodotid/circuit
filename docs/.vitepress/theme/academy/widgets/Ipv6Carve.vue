<script setup lang="ts">
// Lesson: IPv6. The reader takes a /48 or a /56 for a site, gives each VLAN a subnet number, and sees the /64 each one gets and the Circuit interfaces that result.

import { computed, ref } from "vue";
import { shorten } from "./Ipv6Shorten";

const sites = {
    48: { groups: [0x2001, 0x0db8, 0x0100, 0], subnetBits: 16, text: "2001:db8:100::/48" },
    56: { groups: [0x2001, 0x0db8, 0x0100, 0xab00], subnetBits: 8, text: "2001:db8:100:ab00::/56" },
} as const;

const size = ref<48 | 56>(48);
const site = computed(() => sites[size.value]);
const largest = computed(() => 2 ** site.value.subnetBits - 1);

const vlans = [
    { name: "mgmt", id: 10 },
    { name: "office", id: 20 },
    { name: "guests", id: 30 },
];

/** The subnet number of each VLAN, as the reader typed it in hexadecimal. */
const subnets = ref<Record<string, string>>({ mgmt: "", office: "", guests: "" });

type Plan = { name: string; id: number; error?: string; prefix?: string; router?: string };

const plan = computed<Plan[]>(() =>
    vlans.map((vlan) => {
        const typed = subnets.value[vlan.name]!.trim().toLowerCase();

        if (typed === "") return { ...vlan, error: "No subnet yet." };
        if (!/^[0-9a-f]{1,4}$/.test(typed)) return { ...vlan, error: "Use the digits 0 to 9 and the letters a to f." };

        const number = parseInt(typed, 16);
        if (number > largest.value) return { ...vlan, error: `Too big: a /${size.value} has subnets 0 to ${largest.value.toString(16)}.` };

        const taken = vlans.find(
            (other) =>
                other.name !== vlan.name && subnets.value[other.name]!.trim() !== "" && parseInt(subnets.value[other.name]!, 16) === number
        );
        if (taken) return { ...vlan, error: `${taken.name} has this subnet too. Each VLAN needs its own.` };

        const groups = [...site.value.groups.slice(0, 3), site.value.groups[3] + number, 0, 0, 0, 0];

        return { ...vlan, prefix: `${shorten(groups)}/64`, router: `${shorten([...groups.slice(0, 7), 1])}/64` };
    })
);

const ready = computed(() => plan.value.every((entry) => entry.prefix));

function byVlan() {
    subnets.value = Object.fromEntries(vlans.map((vlan) => [vlan.name, String(vlan.id)]));
}

function choose(next: 48 | 56) {
    size.value = next;
}

const count = computed(() => (2 ** site.value.subnetBits).toLocaleString("en-US"));

const said = computed(() => {
    const filled = plan.value.filter((entry) => entry.prefix).length;
    const wrong = plan.value.find((entry) => entry.error && entry.error !== "No subnet yet.");

    if (wrong) return { kind: "bad", word: "Check", text: `${wrong.name}: ${wrong.error}` };
    if (!filled) return { kind: "hint", text: "Type a subnet number for each VLAN, in hexadecimal, or number them after the VLANs." };
    if (!ready.value) return { kind: "hint", text: `${filled} of 3 VLANs have a /64. Give the others a number too.` };

    return { kind: "good", word: "Planned", text: `Three /64s used, out of the ${count.value} your /${size.value} holds.` };
});

const code = computed(() => {
    const lines = plan.value.map((entry) => {
        const v6 = entry.router ? `, "${entry.router}"` : "";
        const ra = entry.router && entry.name !== "mgmt" ? ", ipv6_ra: true" : "";
        return `    ${entry.name}: { type: "vlan", vlan: "${entry.name}", addresses: ["10.0.${entry.id}.1/24"${v6}]${ra} },`;
    });

    return ["interfaces: {", ...lines, "},"].join("\n");
});

// The 128 bits, drawn as a bar: 5 units for each bit.
const UNIT = 5;
const bar = computed(() => [
    { name: "Site prefix", detail: `${size.value} bits, from your provider`, start: 0, bits: size.value, kind: "site" },
    {
        name: "Subnet",
        detail: `${site.value.subnetBits} bits, yours to number`,
        start: size.value,
        bits: site.value.subnetBits,
        kind: "subnet",
    },
    { name: "Interface", detail: "64 bits, one device", start: 64, bits: 64, kind: "device" },
]);
</script>

<template>
    <div class="ipv6-carve">
        <div class="ac-field">
            <span>1. What your provider gives the site</span>
            <div class="ac-row">
                <button type="button" class="ac-button small" :aria-pressed="size === 48" @click="choose(48)">
                    A /48: 2001:db8:100::/48
                </button>
                <button type="button" class="ac-button small" :aria-pressed="size === 56" @click="choose(56)">
                    A /56: 2001:db8:100:ab00::/56
                </button>
            </div>
        </div>

        <svg
            class="ac-drawing"
            viewBox="0 0 660 84"
            role="img"
            :aria-label="`The 128 bits of an address: ${size} bits of site prefix, ${site.subnetBits} bits of subnet number, and 64 bits for the device.`"
        >
            <g v-for="part in bar" :key="part.kind">
                <rect class="part" :class="part.kind" :x="10 + part.start * UNIT" y="8" :width="part.bits * UNIT" height="30" />
                <text class="part-name" :x="10 + part.start * UNIT + 6" y="28">{{ part.bits >= 16 ? part.name : "" }}</text>
                <text
                    class="part-detail"
                    :x="10 + (part.start + part.bits / 2) * UNIT"
                    :y="part.kind === 'subnet' ? 76 : 58"
                    text-anchor="middle"
                >
                    {{ part.detail }}
                </text>
            </g>
            <line
                class="tick"
                :x1="10 + (size + site.subnetBits / 2) * UNIT"
                y1="40"
                :x2="10 + (size + site.subnetBits / 2) * UNIT"
                y2="64"
            />
        </svg>

        <div class="ac-field plan">
            <span>2. Give each VLAN a subnet number, in hexadecimal</span>
            <table class="ac-table">
                <thead>
                    <tr>
                        <th>VLAN</th>
                        <th>Subnet</th>
                        <th>Its /64</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="entry in plan" :key="entry.name" :class="{ lit: entry.prefix }">
                        <td>{{ entry.name }}, VLAN {{ entry.id }}</td>
                        <td>
                            <input
                                v-model="subnets[entry.name]"
                                class="ac-input mono subnet"
                                :aria-label="`Subnet number for ${entry.name}`"
                                :aria-invalid="!!entry.error && entry.error !== 'No subnet yet.'"
                                autocomplete="off"
                                spellcheck="false"
                            />
                        </td>
                        <td class="ac-mono">{{ entry.prefix ?? entry.error }}</td>
                    </tr>
                </tbody>
            </table>
            <div class="ac-row">
                <button type="button" class="ac-button" @click="byVlan">Number them after the VLANs</button>
            </div>
        </div>

        <p class="ac-say" :class="said.kind" :data-word="said.word" aria-live="polite">{{ said.text }}</p>

        <dl class="facts">
            <div>
                <dt>/64 subnets in your /{{ size }}</dt>
                <dd>{{ count }}</dd>
            </div>
            <div>
                <dt>Addresses in each /64</dt>
                <dd>18,446,744,073,709,551,616</dd>
            </div>
        </dl>

        <CodeView :code="code" title="router.ts, part of it" />
    </div>
</template>

<style scoped>
.ac-drawing {
    margin-top: 14px;
}

.part {
    stroke: #0a1a36;
    stroke-width: 1.5;
    transition:
        x 0.3s,
        width 0.3s;
}

.part.site {
    fill: var(--circuit-cobalt);
}

.part.subnet {
    fill: var(--circuit-yellow);
}

.part.device {
    fill: var(--circuit-mist);
}

.ac-drawing .part-name {
    font-size: 13px;
    font-weight: 700;
    fill: #ffffff;
}

.ac-drawing .subnet + .part-name {
    fill: #0a1a36;
}

.ac-drawing .device + .part-name {
    fill: var(--circuit-ink);
}

.ac-drawing .part-detail {
    font-size: 12px;
    fill: var(--circuit-soft);
}

.tick {
    stroke: var(--circuit-ink);
    stroke-width: 1.5;
}

.plan {
    margin-top: 14px;
}

.subnet {
    width: 6.5em;
}

.plan .ac-row {
    margin-top: 10px;
}

.hint {
    color: var(--circuit-soft);
}

.facts {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 28px;
    margin: 14px 0 0;
}

.facts dt {
    color: var(--circuit-soft);
    font-size: 13px;
    font-weight: 600;
}

.facts dd {
    margin: 0;
    font-family: var(--circuit-mono);
    font-size: 15px;
    overflow-wrap: anywhere;
}

@media (prefers-reduced-motion: reduce) {
    .part {
        transition: none;
    }
}
</style>
