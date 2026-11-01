<!-- Every device of the project, with where it is, what it runs on, and what validate finds on it. -->
<script setup lang="ts">
import { computed } from "vue";
import type { StudioData } from "../../../types";
import DataTable, { type Row } from "./DataTable.vue";

const props = defineProps<{ data: StudioData }>();

const rows = computed<Row[]>(() =>
    props.data.devices.map((device) => {
        const findings = props.data.findings.filter((finding) => finding.device === device.name);
        const errors = findings.filter((finding) => finding.level === "error").length;
        return {
            cells: [
                { device: device.name },
                device.site,
                device.platform,
                device.model,
                device.connection.host ?? "console only",
                errors || "",
                findings.length - errors || "",
                props.data.files[device.name],
            ],
        };
    })
);
</script>

<template>
    <h2>Devices</h2>
    <DataTable :head="['Device', 'Site', 'Platform', 'Model', 'Reached at', 'Errors', 'Warnings', 'File']" :rows="rows" csv="devices" />
</template>
