<!-- Every address a device holds, by the prefix it is in, with an address held twice marked. -->
<script setup lang="ts">
import { computed, ref } from "vue";
import type { StudioData } from "../../../types";
import { Net } from "../lib/net";
import DataTable, { type Row } from "./DataTable.vue";

const props = defineProps<{ data: StudioData }>();
const family = ref<"all" | "ipv4" | "ipv6">("all");

const rows = computed<Row[]>(() => {
    const shown = props.data.addresses.filter((row) => family.value === "all" || row.family === family.value);
    // The same address in the same table on two holders.
    const twice = (row: (typeof shown)[number]) =>
        props.data.addresses.filter((other) => other.vrf === row.vrf && Net.sameAddress(other.address, row.address)).length > 1;

    const sorted = [...shown].sort((a, b) => {
        const x = Net.parseRange(a.address);
        const y = Net.parseRange(b.address);
        if (!x || !y || x.family !== y.family) return a.family.localeCompare(b.family);
        return x.first < y.first ? -1 : x.first > y.first ? 1 : 0;
    });

    return sorted.map((row) => ({
        cells: [row.prefix, row.address, { device: row.device }, row.holder, row.vrf ?? "", row.peer ?? "", twice(row) ? "held twice" : ""],
    }));
});
</script>

<template>
    <h2>Addresses</h2>
    <div class="tabs">
        <button v-for="choice in ['all', 'ipv4', 'ipv6'] as const" :key="choice" :aria-pressed="family === choice" @click="family = choice">
            {{ choice === "all" ? "Both" : choice === "ipv4" ? "IPv4" : "IPv6" }}
        </button>
    </div>
    <DataTable :head="['Prefix', 'Address', 'Device', 'On', 'VRF', 'Far end', 'Note']" :rows="rows" csv="addresses" />
</template>
