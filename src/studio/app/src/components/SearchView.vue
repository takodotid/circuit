<!-- What the search finds: any field of any device, by its name or its value, with where it is and a link to the tab that shows it, and lines of each device's config. -->
<script setup lang="ts">
import { computed } from "vue";
import type { StudioData } from "../../../types";
import { Format } from "../lib/format";
import DataTable, { type Row } from "./DataTable.vue";

const props = defineProps<{ data: StudioData; query: string }>();

/** Past this many matches the search stops, so a short word does not fill the page. */
const MOST = 200;

/** The tab of a device's page that shows a field, by where the field is. */
function sectionOf(path: readonly string[]): string {
    if (path[0] === "interfaces") return path[1] === "ethernet" ? "ports" : "interfaces";
    const sections = ["switching", "routing", "firewall", "management", "system", "monitoring", "services"];
    return sections.includes(path[0] ?? "") ? path[0]! : "overview";
}

const found = computed<Row[]>(() => {
    const query = props.query.toLowerCase();
    if (!query) return [];

    const rows: Row[] = [];
    const add = (device: string, path: string[], text: string) => {
        if (rows.length >= MOST || !text.toLowerCase().includes(query)) return;
        rows.push({
            cells: [
                { device },
                { link: `devices/${device}/${sectionOf(path)}`, label: path.join(" › ") },
                text.length > 120 ? `${text.slice(0, 120)}…` : text,
            ],
        });
    };

    // Every field, however deep. A name a device gives, such as a port or a VLAN, matches too. A secret shows as the project writes it.
    const walk = (device: string, path: string[], value: unknown): void => {
        if (rows.length >= MOST || value === undefined || value === null) return;
        if (Format.isSecret(value)) return add(device, path, Format.compact(value));
        if (Array.isArray(value)) return value.forEach((item, index) => walk(device, [...path, String(index + 1)], item));
        if (Format.isObject(value)) {
            for (const [key, inner] of Object.entries(value)) {
                if (path.length) add(device, [...path, key], key);
                walk(device, [...path, key], inner);
            }
            return;
        }
        if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") add(device, path, String(value));
    };

    for (const device of props.data.devices) walk(device.name, [], device);

    for (const device of props.data.devices) {
        const lines = (props.data.rendered[device.name] ?? "").split("\n").filter((line) => line.toLowerCase().includes(query));
        if (!lines.length || rows.length >= MOST) continue;

        rows.push({
            cells: [
                { device: device.name },
                { link: `devices/${device.name}/config`, label: `config, ${Format.count(lines.length, "line")}` },
                lines
                    .slice(0, 3)
                    .map((line) => line.trim())
                    .join(" · ") + (lines.length > 3 ? " …" : ""),
            ],
        });
    }

    return rows;
});
</script>

<template>
    <h2>Search: {{ query }}</h2>
    <p v-if="!found.length" class="muted">Nothing in the project matches.</p>
    <template v-else>
        <p class="muted">
            {{ found.length >= MOST ? `The first ${MOST} matches.` : Format.count(found.length, "match", "matches") + "." }}
        </p>
        <DataTable :head="['Device', 'Where', 'Found']" :rows="found" csv="search" />
    </template>
</template>
