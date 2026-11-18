<!-- Every VLAN of the project: its ID, what it is for, the devices that have it, its gateways, and how many ports carry it on each device. -->
<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import type { StudioData } from "../../../types";
import { FieldDocs } from "../lib/field-docs";
import { Format } from "../lib/format";
import { showInGraph } from "../lib/store";
import DataTable, { type Row } from "./DataTable.vue";

const props = defineProps<{ data: StudioData }>();
const router = useRouter();

/** The VLANs some cable carries, by ID: those the graph can light. */
const onCables = computed(() => new Set(props.data.graph.edges.flatMap((edge) => (edge.vlans ?? []).map((vlan) => vlan.id))));

const columns = [
    FieldDocs.column("VLAN", "switching.vlans"),
    FieldDocs.column("ID", "switching.vlans.*.id"),
    FieldDocs.column("Description", "switching.vlans.*.description"),
    "Devices",
    FieldDocs.column("Gateways", "interfaces.vlan_interface"),
    "Ports",
    "",
];

type Entry = { ids: Set<number>; descriptions: Set<string>; devices: string[]; gateways: string[]; ports: string[] };

const rows = computed<Row[]>(() => {
    const byName = new Map<string, Entry>();

    for (const device of props.data.devices) {
        for (const [name, vlan] of Object.entries(device.switching?.vlans ?? {})) {
            if (!vlan) continue;
            const entry = byName.get(name) ?? { ids: new Set(), descriptions: new Set(), devices: [], gateways: [], ports: [] };
            entry.ids.add(vlan.id);
            if (vlan.description) entry.descriptions.add(vlan.description);
            entry.devices.push(device.name);
            byName.set(name, entry);
        }

        // A VLAN interface on the VLAN is its gateway on this device.
        for (const [holder, settings] of Object.entries(device.interfaces?.vlan_interface ?? {})) {
            if (!settings) continue;
            const addresses = Format.compact(settings.addresses);
            byName.get(settings.vlan)?.gateways.push(`${device.name} ${holder}${addresses ? ` ${addresses}` : ""}`);
        }

        // A port carries what its LAG carries, so a LAG counts once.
        const carriers = [
            ...Object.values(device.interfaces?.ethernet ?? {}).filter((port) => port && !port.in_lag),
            ...Object.values(device.interfaces?.lag ?? {}),
        ];
        for (const [name, entry] of byName) {
            if (!entry.devices.includes(device.name)) continue;

            const access = carriers.filter((carrier) => carrier?.access_vlan === name).length;
            const trunk = carriers.filter((carrier) => carrier?.trunk_vlans?.includes(name) || carrier?.native_vlan === name).length;
            const counts = [access ? `${access} access` : "", trunk ? `${trunk} trunk` : ""].filter(Boolean).join(", ");
            if (counts) entry.ports.push(`${device.name}: ${counts}`);
        }
    }

    return [...byName]
        .sort(([, a], [, b]) => Math.min(...a.ids) - Math.min(...b.ids))
        .map(([name, entry]) => ({
            cells: [
                name,
                [...entry.ids].join(", ") + (entry.ids.size > 1 ? " (differs by device)" : ""),
                [...entry.descriptions].join(" / "),
                { devices: entry.devices },
                entry.gateways.join("; "),
                entry.ports.join("; "),
                [...entry.ids].some((id) => onCables.value.has(id))
                    ? { action: () => showInGraph(router, "l2", { vlan: Math.min(...entry.ids) }), label: "Show in the graph" }
                    : "",
            ],
        }));
});
</script>

<template>
    <h2>VLANs</h2>
    <DataTable :head="columns" :rows="rows" csv="vlans" />
</template>
