<!-- Every device of the project, with where it is, what it runs on, and what validate finds on it. -->
<script setup lang="ts">
import { computed } from "vue";
import type { StudioData } from "../../../types";
import { FieldDocs } from "../lib/field-docs";
import DataTable, { type Row } from "./DataTable.vue";

const props = defineProps<{ data: StudioData }>();

const columns = [
    FieldDocs.column("Device", "name"),
    FieldDocs.column("Site", "site"),
    FieldDocs.column("Platform", "platform"),
    FieldDocs.column("Model", "model"),
    FieldDocs.column("Reached at", "connection.host"),
    "Errors",
    "Warnings",
    "File",
];

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
    <DataTable :head="columns" :rows="rows" csv="devices" />
</template>
