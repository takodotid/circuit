<!-- Every device of the project, with where it is, what it runs on, how many of its ports the project declares, and what validate finds on it. -->
<script setup lang="ts">
import { computed } from "vue";
import type { StudioData } from "../../../types";
import { FieldDocs } from "../lib/field-docs";
import { Format } from "../lib/format";
import DataTable, { type Badge, type Row } from "./DataTable.vue";

const props = defineProps<{ data: StudioData }>();

const columns = [
    FieldDocs.column("Device", "name"),
    FieldDocs.column("Site", "site"),
    FieldDocs.column("Platform", "platform"),
    FieldDocs.column("Model", "model"),
    FieldDocs.column("Reached at", "connection.host"),
    FieldDocs.column("Ports declared", "interfaces.ethernet"),
    "Found",
    "File",
];

const rows = computed<Row[]>(() =>
    props.data.devices.map((device) => {
        const findings = props.data.findings.filter((finding) => finding.device === device.name);
        const errors = findings.filter((finding) => finding.level === "error").length;
        const warnings = findings.length - errors;
        const badges: Badge[] = [
            ...(errors ? [{ level: "error" as const, text: Format.count(errors, "error") }] : []),
            ...(warnings ? [{ level: "warning" as const, text: Format.count(warnings, "warning") }] : []),
        ];
        const declared = Object.keys(device.interfaces?.ethernet ?? {}).length;
        const all = props.data.ports[device.name]?.length;

        return {
            cells: [
                { device: device.name },
                device.site,
                device.platform,
                device.model,
                device.connection.host ?? "console only",
                all ? `${declared} of ${all}` : String(declared),
                { badges },
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
