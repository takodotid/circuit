<!-- Studio's tools: trace an address through the project, and find the cables that carry a VLAN between two devices. -->
<script setup lang="ts">
import { computed, ref } from "vue";
import type { StudioData } from "../../../types";
import { go, store } from "../lib/store";
import { Tools } from "../lib/tools";
import DataTable from "./DataTable.vue";

const props = defineProps<{ data: StudioData }>();

const tool = computed(() => (store.route.parts[0] === "vlan" ? "vlan" : "trace"));

// A trace has its own address, such as `#tools/trace/192.0.2.5`, to bookmark or send.
const typed = ref(store.route.parts[0] === "trace" ? (store.route.parts[1] ?? "") : "");
const traced = computed(() => (tool.value === "trace" && store.route.parts[1] ? Tools.trace(props.data, store.route.parts[1]) : undefined));
const traceFailed = computed(() => tool.value === "trace" && Boolean(store.route.parts[1]) && !traced.value);

const vlans = computed(() => [...new Set(props.data.devices.flatMap((device) => Object.keys(device.switching?.vlans ?? {})))].sort());
const devices = computed(() => props.data.devices.map((device) => device.name));
const vlan = ref("");
const from = ref("");
const to = ref("");
const asked = ref(false);
const path = computed(() =>
    asked.value && vlan.value && from.value && to.value ? Tools.vlanPath(props.data, vlan.value, from.value, to.value) : undefined
);
</script>

<template>
    <h2>Tools</h2>
    <div class="tabs">
        <button :aria-pressed="tool === 'trace'" @click="go('tools/trace')">Trace an address</button>
        <button :aria-pressed="tool === 'vlan'" @click="go('tools/vlan')">VLAN path</button>
    </div>

    <template v-if="tool === 'trace'">
        <p class="muted">
            Which device holds an address, how each device would reach it from what the project says, and every rule that names it. A route
            learned from BGP or OSPF is not in the project, so a device with no route here may still reach it.
        </p>
        <form class="tool-form" @submit.prevent="go(`tools/trace/${typed.trim()}`)">
            <label class="field">Address <input v-model="typed" placeholder="192.0.2.5" /></label>
            <button class="primary" type="submit">Trace</button>
        </form>
        <p v-if="traceFailed" class="verdict reject">That is not one address, such as 192.0.2.5 or 2001:db8::5.</p>
        <template v-if="traced">
            <h3>Held by</h3>
            <DataTable
                :head="['Device', 'On', 'Address']"
                :rows="traced.held.map((entry) => ({ cells: [{ device: entry.device }, entry.holder, entry.address] }))"
            />
            <h3>How each device reaches it</h3>
            <DataTable
                :head="['Device', 'Table', 'How', 'Prefix', 'Via', 'Through', 'Note']"
                :rows="
                    traced.routes.map((route) => ({
                        muted: route.kind === 'none',
                        cells: [
                            { device: route.device },
                            route.table,
                            route.kind === 'none' ? 'no route in the project' : route.kind,
                            route.prefix,
                            route.via,
                            route.through,
                            route.note,
                        ],
                    }))
                "
                csv="trace"
            />
            <h3>Rules that name it</h3>
            <DataTable
                :head="['Device', 'Where', 'Rule', 'Matches its', 'Then', 'Description']"
                :rows="
                    traced.rules.map((rule) => ({
                        cells: [{ device: rule.device }, rule.where, rule.rule, rule.side, rule.then, rule.description],
                    }))
                "
            />
        </template>
    </template>

    <template v-else>
        <p class="muted">
            The fewest cables that carry a VLAN from one device to another, by each port's VLANs and links, at both ends of each cable.
        </p>
        <form class="tool-form" @submit.prevent="asked = true">
            <label class="field"
                >VLAN
                <select v-model="vlan" @change="asked = false">
                    <option v-for="name in vlans" :key="name">{{ name }}</option>
                </select>
            </label>
            <label class="field"
                >From
                <select v-model="from" @change="asked = false">
                    <option v-for="name in devices" :key="name">{{ name }}</option>
                </select>
            </label>
            <label class="field"
                >To
                <select v-model="to" @change="asked = false">
                    <option v-for="name in devices" :key="name">{{ name }}</option>
                </select>
            </label>
            <button class="primary" type="submit">Find the path</button>
        </form>
        <template v-if="asked && vlan && from && to">
            <p v-if="!path" class="verdict reject">No path of cables carries {{ vlan }} from {{ from }} to {{ to }}.</p>
            <p v-else-if="!path.length" class="muted">{{ from }} and {{ to }} are one device.</p>
            <DataTable
                v-else
                :head="['From', 'Port', 'To', 'Port']"
                :rows="path.map((hop) => ({ cells: [{ device: hop.device }, hop.port, { device: hop.farDevice }, hop.farPort] }))"
            />
        </template>
    </template>
</template>
