<!-- Every address the project uses: by the space each network owns and the segments in it, with what is free, as `circuit addresses` prints it; or every address on its own, with an address held twice marked. -->
<script setup lang="ts">
import { computed, ref } from "vue";
import type { AddressBlock, AddressSegment, StudioData } from "../../../types";
import { Net } from "../lib/net";
import DataTable from "./DataTable.vue";
import type { Row } from "./DataTable.vue";

const props = defineProps<{ data: StudioData }>();
const shown = ref<"spaces" | "all">("spaces");
const family = ref<"all" | "ipv4" | "ipv6">("all");

const report = computed(() => props.data.addressSpace);
const hasElsewhere = computed(() => report.value.elsewhere.segments.length > 0 || report.value.elsewhere.blocks.length > 0);

const usesOf = (segment: AddressSegment): Row[] => segment.uses.map((use) => ({ cells: [use.address, use.what] }));
const blocksOf = (blocks: AddressBlock[]): Row[] => blocks.map((block) => ({ cells: [block.prefix, block.what] }));
const headingOf = (segment: AddressSegment) => `${segment.prefix} · ${segment.free} free${segment.next ? ` · next ${segment.next}` : ""}`;

const rows = computed<Row[]>(() => {
    const listed = props.data.addresses.filter((row) => family.value === "all" || row.family === family.value);
    // The same address in the same table on two holders.
    const twice = (row: (typeof listed)[number]) =>
        props.data.addresses.filter((other) => other.vrf === row.vrf && Net.sameAddress(other.address, row.address)).length > 1;

    const sorted = [...listed].sort((a, b) => {
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
        <button :aria-pressed="shown === 'spaces'" @click="shown = 'spaces'">By space</button>
        <button :aria-pressed="shown === 'all'" @click="shown = 'all'">Every address</button>
    </div>

    <template v-if="shown === 'spaces'">
        <p v-if="!report.spaces.length && !hasElsewhere" class="muted">None.</p>

        <section v-for="space in report.spaces" :key="space.prefix">
            <h3>{{ space.prefix }}</h3>
            <p class="muted">{{ space.owner }}</p>
            <template v-for="segment in space.segments" :key="segment.prefix">
                <h4>{{ headingOf(segment) }}</h4>
                <DataTable :head="['Address', 'Used by']" :rows="usesOf(segment)" />
            </template>
            <template v-if="space.blocks.length">
                <h4>Blocks</h4>
                <DataTable :head="['Prefix', 'Used by']" :rows="blocksOf(space.blocks)" />
            </template>
            <p><strong>Free:</strong> {{ space.free.join(", ") || "none" }}</p>
        </section>

        <section v-if="hasElsewhere">
            <h3>Outside the network's space</h3>
            <template v-for="segment in report.elsewhere.segments" :key="segment.prefix">
                <h4>{{ headingOf(segment) }}</h4>
                <DataTable :head="['Address', 'Used by']" :rows="usesOf(segment)" />
            </template>
            <template v-if="report.elsewhere.blocks.length">
                <h4>Blocks</h4>
                <DataTable :head="['Prefix', 'Used by']" :rows="blocksOf(report.elsewhere.blocks)" />
            </template>
        </section>
    </template>

    <template v-else>
        <div class="tabs">
            <button
                v-for="choice in ['all', 'ipv4', 'ipv6'] as const"
                :key="choice"
                :aria-pressed="family === choice"
                @click="family = choice"
            >
                {{ choice === "all" ? "Both" : choice === "ipv4" ? "IPv4" : "IPv6" }}
            </button>
        </div>
        <DataTable :head="['Prefix', 'Address', 'Device', 'On', 'VRF', 'Far end', 'Note']" :rows="rows" csv="addresses" />
    </template>
</template>
