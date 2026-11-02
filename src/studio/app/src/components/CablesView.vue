<!-- Every cable the project names with `link`, from the end that names it first. -->
<script setup lang="ts">
import { computed } from "vue";
import type { StudioData } from "../../../types";
import DataTable, { type Row } from "./DataTable.vue";

const props = defineProps<{ data: StudioData }>();
const devices = computed(() => new Set(props.data.devices.map((device) => device.name)));

const rows = computed<Row[]>(() =>
    props.data.cables.map((cable) => ({
        cells: [
            { device: cable.device },
            cable.port + (cable.lag ? ` (${cable.lag})` : ""),
            devices.value.has(cable.farDevice) ? { device: cable.farDevice } : cable.farDevice,
            cable.farPort + (cable.farLag ? ` (${cable.farLag})` : ""),
            cable.through,
            cable.vlans.join(", "),
            cable.description,
            cable.oneSided ? "the far end does not link back" : "",
        ],
    }))
);
</script>

<template>
    <h2>Cables</h2>
    <DataTable :head="['Device', 'Port', 'Far device', 'Far port', 'Through', 'VLANs', 'Description', 'Note']" :rows="rows" csv="cables" />
</template>
