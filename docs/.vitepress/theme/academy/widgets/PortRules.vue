<script setup lang="ts">
// Lesson: project, an internet exchange. The reader turns each protection of a member port on or off, makes one member misbehave, and sees whether the rest of the exchange notices.

import { computed, ref } from "vue";

type Rule = "vlan" | "stp" | "lldp" | "storm";
type Happening = "loop" | "bpdu" | "lldp" | "mgmt";

const RULES: { id: Rule; label: string; field: string }[] = [
    { id: "vlan", label: "Peering VLAN only", field: "access_vlan" },
    { id: "stp", label: "No spanning tree", field: "stp: false" },
    { id: "lldp", label: "No LLDP", field: "lldp: false" },
    { id: "storm", label: "Storm control at 1%", field: "storm_control" },
];

type Outcome = { rule: Rule; safe: string; harm: string; spreads: boolean };

const HAPPENINGS: { id: Happening; label: string; outcome: Outcome }[] = [
    {
        id: "loop",
        label: "A loop inside member C's network",
        outcome: {
            rule: "storm",
            safe: "C's broadcasts multiply inside its own network and pour into its port. ix-sw-02 lets through 1% of the port's speed of broadcast, multicast and unknown unicast, and drops the rest. The other members see a trickle.",
            harm: "C's broadcast storm pours onto the peering LAN: across the trunk, out of every member's port and into every member's router, until C finds its loop.",
            spreads: true,
        },
    },
    {
        id: "bpdu",
        label: "C's switch speaks spanning tree",
        outcome: {
            rule: "stp",
            safe: "The port takes no part in spanning tree, so nothing C's switch says can change which of the exchange's own ports are blocked.",
            harm: "C's switch joins the exchange's spanning tree. With a low enough priority it wins the root election, and the exchange's switches work out their paths again around a member's switch, while every member's traffic waits.",
            spreads: true,
        },
    },
    {
        id: "lldp",
        label: "C's switch listens for LLDP",
        outcome: {
            rule: "lldp",
            safe: "The port sends no LLDP, so C learns nothing about the exchange's own switches.",
            harm: "ix-sw-02 tells C its name and the port's name, and often its model and software: a map of the exchange for anyone who wants to attack it.",
            spreads: false,
        },
    },
    {
        id: "mgmt",
        label: "C tries the management VLAN",
        outcome: {
            rule: "vlan",
            safe: "C's port is an access port in the peering VLAN, 100. Whatever C sends lands there; VLAN 10, where the switches are managed, is not on its port.",
            harm: "If C's port also carried VLAN 10, C's router would sit on the switches' management network and could try to log in to them.",
            spreads: false,
        },
    },
];

const on = ref<Record<Rule, boolean>>({ vlan: true, stp: true, lldp: true, storm: true });
const happening = ref<Happening>();

function toggle(rule: Rule) {
    on.value = { ...on.value, [rule]: !on.value[rule] };
}

const current = computed(() => HAPPENINGS.find((entry) => entry.id === happening.value));
const safe = computed(() => (current.value ? on.value[current.value.outcome.rule] : true));
const spreading = computed(() => Boolean(current.value && !safe.value && current.value.outcome.spreads));
const ruleLabel = computed(() => RULES.find((rule) => rule.id === current.value?.outcome.rule)?.label ?? "");

const sw1 = { x: 230, y: 80 };
const sw2 = { x: 470, y: 80 };
const members = [
    { id: "rs1", kind: "server" as const, label: "rs1", note: "route server", x: 90, y: 220, on: sw1 },
    { id: "a", kind: "router" as const, label: "Member A", note: "", x: 270, y: 220, on: sw1 },
    { id: "b", kind: "router" as const, label: "Member B", note: "", x: 420, y: 220, on: sw2 },
    { id: "c", kind: "switch" as const, label: "Member C", note: "its own switch", x: 600, y: 220, on: sw2 },
];
</script>

<template>
    <div class="port-rules">
        <svg
            class="ac-drawing"
            viewBox="0 0 700 290"
            role="img"
            :aria-label="`Two exchange switches joined by a trunk, with a route server and members A, B and C. ${spreading ? 'The trouble from C is spreading across the exchange.' : 'The exchange is unaffected.'}`"
        >
            <line class="cable" :class="{ harm: spreading }" :x1="sw1.x" :y1="sw1.y" :x2="sw2.x" :y2="sw2.y" />
            <text class="cable-label" :x="(sw1.x + sw2.x) / 2" :y="sw1.y - 10" text-anchor="middle">trunk, 40g-5</text>

            <line
                v-for="member in members"
                :key="member.id"
                class="cable"
                :class="{ lit: member.id === 'c' && current, harm: spreading || (member.id === 'c' && current && !safe) }"
                :x1="member.on.x"
                :y1="member.on.y"
                :x2="member.x"
                :y2="member.y"
            />

            <g v-if="current && safe" class="stop" :transform="`translate(${(sw2.x + 600) / 2} ${(sw2.y + 220) / 2})`">
                <rect x="-30" y="-12" width="60" height="24" />
                <text y="5" text-anchor="middle">stopped</text>
            </g>

            <SvgDevice kind="switch" :x="sw1.x" :y="sw1.y" label="ix-sw-01" />
            <SvgDevice kind="switch" :x="sw2.x" :y="sw2.y" label="ix-sw-02" />
            <SvgDevice
                v-for="member in members"
                :key="member.id"
                :kind="member.kind"
                :x="member.x"
                :y="member.y"
                :label="member.label"
                :note="member.note"
                :lit="member.id === 'c' && Boolean(current)"
            />
        </svg>

        <fieldset class="group">
            <legend>Member C's port does</legend>
            <div class="ac-row">
                <button
                    v-for="rule in RULES"
                    :key="rule.id"
                    type="button"
                    class="ac-button small"
                    :aria-pressed="on[rule.id]"
                    @click="toggle(rule.id)"
                >
                    {{ on[rule.id] ? "On" : "Off" }}: {{ rule.label }}
                </button>
            </div>
        </fieldset>

        <fieldset class="group">
            <legend>Then this happens</legend>
            <div class="options">
                <button
                    v-for="entry in HAPPENINGS"
                    :key="entry.id"
                    type="button"
                    class="ac-button"
                    :aria-pressed="happening === entry.id"
                    @click="happening = entry.id"
                >
                    {{ entry.label }}
                </button>
            </div>
        </fieldset>

        <p v-if="current && safe" class="ac-say good" data-word="Contained" aria-live="polite">
            {{ current.outcome.safe }} Stopped by: {{ ruleLabel }}.
        </p>
        <p v-else-if="current" class="ac-say bad" data-word="Reaches others" aria-live="polite">
            {{ current.outcome.harm }} The protection that stops it: {{ ruleLabel }}.
        </p>
        <p v-else class="ac-say hint" aria-live="polite">
            All four protections start on, as the internetExchange preset writes them. Make C misbehave, then turn the protection that
            stopped it off and try again.
        </p>
    </div>
</template>

<style scoped>
.cable.harm {
    stroke: var(--circuit-removed);
    stroke-width: 4;
    stroke-dasharray: 8 5;
}

.cable-label {
    fill: var(--circuit-soft) !important;
    font-family: var(--circuit-mono);
    font-size: 11.5px !important;
}

.stop rect {
    fill: var(--circuit-paper);
    stroke: var(--circuit-added);
    stroke-width: 2;
}

.stop text {
    fill: var(--circuit-added) !important;
    font-size: 12px !important;
    font-weight: 700;
}

.group {
    min-width: 0;
    margin: 12px 0 0;
    padding: 0;
    border: 0;
}

legend {
    margin-bottom: 6px;
    padding: 0;
    color: var(--circuit-soft);
    font-size: 13px;
    font-weight: 600;
}

.options {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 8px;
}

.options .ac-button {
    justify-content: flex-start;
    white-space: normal;
    text-align: left;
}

.hint {
    color: var(--circuit-soft);
}
</style>
