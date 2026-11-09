<!-- Every BGP session of the project, with what it takes from its group, and what is at its far end. -->
<script setup lang="ts">
import { computed } from "vue";
import type { StudioData } from "../../../types";
import { FieldDocs } from "../lib/field-docs";
import DataTable, { type Row } from "./DataTable.vue";

const props = defineProps<{ data: StudioData }>();
const devices = computed(() => new Set(props.data.devices.map((device) => device.name)));

const neighbor = (field: string) => `routing.bgp.neighbors.*.${field}`;
const columns = [
    "Device",
    FieldDocs.column("Neighbor", "routing.bgp.neighbors"),
    FieldDocs.column("Address", neighbor("address")),
    FieldDocs.column("Remote AS", neighbor("remote_as")),
    FieldDocs.column("Role", neighbor("role")),
    FieldDocs.column("Group", neighbor("neighbor_group")),
    FieldDocs.column("Import", neighbor("import_policy")),
    FieldDocs.column("Export", neighbor("export_policy")),
    "Far end",
    "Note",
];

const rows = computed<Row[]>(() =>
    props.data.sessions.map((session) => ({
        cells: [
            { device: session.device },
            session.name,
            session.address,
            session.remoteAs ? `AS${session.remoteAs}` : "",
            session.role,
            session.group,
            session.import,
            session.export,
            session.far && devices.value.has(session.far) ? { device: session.far } : session.far,
            session.oneSided ? "no session back" : "",
        ],
    }))
);
</script>

<template>
    <h2>BGP sessions</h2>
    <DataTable :head="columns" :rows="rows" csv="bgp-sessions" />
</template>
