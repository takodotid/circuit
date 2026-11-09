<!-- Every VLAN of the project: its ID on each device, what it is for, and the ports that carry it. -->
<script setup lang="ts">
import { computed } from "vue";
import type { StudioData } from "../../../types";
import { FieldDocs } from "../lib/field-docs";
import DataTable, { type Row } from "./DataTable.vue";

const props = defineProps<{ data: StudioData }>();

const columns = [
    FieldDocs.column("VLAN", "switching.vlans"),
    FieldDocs.column("ID", "switching.vlans.*.id"),
    FieldDocs.column("Description", "switching.vlans.*.description"),
    "Devices",
    "Ports and LAGs carrying it",
];

const rows = computed<Row[]>(() => {
    const byName = new Map<string, { ids: Set<number>; descriptions: Set<string>; devices: string[]; ports: string[] }>();

    for (const device of props.data.devices) {
        for (const [name, vlan] of Object.entries(device.switching?.vlans ?? {})) {
            if (!vlan) continue;
            const entry = byName.get(name) ?? { ids: new Set(), descriptions: new Set(), devices: [], ports: [] };
            entry.ids.add(vlan.id);
            if (vlan.description) entry.descriptions.add(vlan.description);
            entry.devices.push(device.name);
            byName.set(name, entry);
        }

        // A port carries what its LAG carries.
        const holders = [
            ...Object.entries(device.interfaces?.ethernet ?? {}).filter(([, port]) => port && !port.in_lag),
            ...Object.entries(device.interfaces?.lag ?? {}),
        ];
        for (const [holder, settings] of holders) {
            const carried = [settings?.access_vlan, settings?.native_vlan, ...(settings?.trunk_vlans ?? [])];
            for (const name of new Set(carried)) if (name) byName.get(name)?.ports.push(`${device.name} ${holder}`);
        }
    }

    return [...byName]
        .sort(([, a], [, b]) => Math.min(...a.ids) - Math.min(...b.ids))
        .map(([name, entry]) => ({
            cells: [
                name,
                [...entry.ids].join(", ") + (entry.ids.size > 1 ? " (differs by device)" : ""),
                [...entry.descriptions].join(" / "),
                entry.devices.join(", "),
                entry.ports.length,
            ],
        }));
});
</script>

<template>
    <h2>VLANs</h2>
    <DataTable :head="columns" :rows="rows" csv="vlans" />
</template>
