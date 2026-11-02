<!-- What the search finds: devices, ports and interfaces by name or description, addresses, VLANs, BGP neighbors, and lines of each device's config. -->
<script setup lang="ts">
import { computed } from "vue";
import type { StudioData } from "../../../types";
import { Format } from "../lib/format";
import DataTable, { type Row } from "./DataTable.vue";

const props = defineProps<{ data: StudioData; query: string }>();

const found = computed<Row[]>(() => {
    const query = props.query.toLowerCase();
    if (!query) return [];
    const has = (text: unknown) => typeof text === "string" && text.toLowerCase().includes(query);
    const rows: Row[] = [];

    for (const device of props.data.devices) {
        if (has(device.name) || has(device.site) || has(device.model)) {
            rows.push({ cells: [{ device: device.name }, "device", `${device.platform} ${device.model} at ${device.site}`] });
        }

        for (const [kind, group] of Object.entries(device.interfaces ?? {})) {
            for (const [name, settings] of Object.entries((group ?? {}) as Record<string, { description?: string } | undefined>)) {
                if (has(name) || has(settings?.description)) {
                    rows.push({
                        cells: [
                            { device: device.name },
                            kind === "ethernet" ? "port" : kind.replace("_", " "),
                            `${name}${settings?.description ? `: ${settings.description}` : ""}`,
                        ],
                    });
                }
            }
        }

        for (const [name, vlan] of Object.entries(device.switching?.vlans ?? {})) {
            if (has(name) || has(vlan?.description) || has(String(vlan?.id)))
                rows.push({ cells: [{ device: device.name }, "VLAN", `${name}, ID ${vlan?.id}`] });
        }

        for (const [name, neighbor] of Object.entries(device.routing?.bgp?.neighbors ?? {})) {
            if (has(name) || has(neighbor?.description) || has(neighbor?.address)) {
                rows.push({ cells: [{ device: device.name }, "BGP neighbor", `${name}, ${neighbor?.address}`] });
            }
        }

        const lines = (props.data.rendered[device.name] ?? "").split("\n").filter(has);
        if (lines.length) {
            rows.push({
                cells: [
                    { link: `devices/${device.name}/config`, label: device.name },
                    "config",
                    `${Format.count(lines.length, "line")}: ${lines
                        .slice(0, 3)
                        .map((line) => line.trim())
                        .join(" · ")}${lines.length > 3 ? " …" : ""}`,
                ],
            });
        }
    }

    for (const row of props.data.addresses) {
        if (has(row.address)) rows.push({ cells: [{ device: row.device }, "address", `${row.address} on ${row.holder}`] });
    }

    return rows;
});
</script>

<template>
    <h2>Search: {{ query }}</h2>
    <DataTable :head="['Device', 'What', 'Found']" :rows="found" />
</template>
