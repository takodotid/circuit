<!-- A table of rows, each cell text, a link, several device links, badges or an action, that can be saved as CSV. -->
<script setup lang="ts">
import { Export } from "../lib/csv";
import { href } from "../lib/store";

export type Badge = { level: "error" | "warning" | "added"; text: string };

export type Cell =
    | string
    | number
    | undefined
    | { device: string; label?: string }
    | { link: string; label: string }
    | { devices: string[] }
    | { badges: Badge[]; otherwise?: string }
    | { action: () => void; label: string };
export type Row = { cells: Cell[]; muted?: boolean; id?: string };
/** A column: its label, or a label with the doc of the device field it shows, read when the pointer is on it. */
export type Column = string | { label: string; field?: boolean; doc?: string };

const props = defineProps<{ head: Column[]; rows: Row[]; csv?: string }>();

const labelOf = (column: Column) => (typeof column === "string" ? column : column.label);

/** What a cell says, as the CSV has it. An action says nothing there. */
function textOf(cell: Cell): string {
    if (cell === undefined) return "";
    if (typeof cell !== "object") return String(cell);
    if ("device" in cell) return cell.label ?? cell.device;
    if ("devices" in cell) return cell.devices.join(", ");
    if ("badges" in cell) return cell.badges.map((badge) => badge.text).join(", ") || (cell.otherwise ?? "");
    if ("action" in cell) return "";
    return cell.label;
}

const linkOf = (cell: Cell) =>
    typeof cell === "object" && cell ? ("device" in cell ? `devices/${cell.device}` : "link" in cell ? cell.link : undefined) : undefined;

function save(): void {
    const csv = Export.csv(
        props.head.map(labelOf),
        props.rows.map((row) => row.cells.map(textOf))
    );
    Export.save(`${props.csv}.csv`, new Blob([csv], { type: "text/csv" }));
}
</script>

<template>
    <p v-if="!rows.length" class="muted">None.</p>
    <div v-else class="table-block">
        <p v-if="csv" class="table-actions"><button type="button" class="link" @click="save">Save as CSV</button></p>
        <table class="data">
            <thead>
                <tr>
                    <th
                        v-for="(column, index) in head"
                        :key="index"
                        :data-doc="typeof column === 'string' ? undefined : column.doc"
                        :tabindex="typeof column !== 'string' && column.doc ? 0 : undefined"
                    >
                        <code v-if="typeof column !== 'string' && column.field">{{ column.label }}</code>
                        <template v-else>{{ labelOf(column) }}</template>
                    </th>
                </tr>
            </thead>
            <tbody>
                <tr v-for="(row, index) in rows" :id="row.id" :key="index" :class="{ muted: row.muted }">
                    <td v-for="(cell, at) in row.cells" :key="at">
                        <a v-if="linkOf(cell)" :href="href(linkOf(cell)!)">{{ textOf(cell) }}</a>
                        <template v-else-if="typeof cell === 'object' && 'devices' in cell">
                            <template v-for="(name, place) in cell.devices" :key="name"
                                ><template v-if="place">, </template><a :href="href(`devices/${name}`)">{{ name }}</a></template
                            >
                        </template>
                        <template v-else-if="typeof cell === 'object' && 'badges' in cell">
                            <span v-for="badge in cell.badges" :key="badge.text" :class="['badge', badge.level]">{{ badge.text }}</span>
                            <span v-if="!cell.badges.length" class="muted">{{ cell.otherwise }}</span>
                        </template>
                        <button v-else-if="typeof cell === 'object' && 'action' in cell" type="button" class="link" @click="cell.action()">
                            {{ cell.label }}
                        </button>
                        <template v-else>{{ textOf(cell) }}</template>
                    </td>
                </tr>
            </tbody>
        </table>
    </div>
</template>
