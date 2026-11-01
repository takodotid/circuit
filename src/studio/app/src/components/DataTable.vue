<!-- A table of rows, each cell text or a link, that can be saved as CSV. -->
<script setup lang="ts">
import { Export } from "../lib/csv";
import { go } from "../lib/store";

export type Cell = string | number | undefined | { device: string; label?: string } | { link: string; label: string };
export type Row = { cells: Cell[]; muted?: boolean; id?: string };
export type Column = string | { label: string; field?: boolean; title?: string };

const props = defineProps<{ head: Column[]; rows: Row[]; csv?: string }>();

const labelOf = (column: Column) => (typeof column === "string" ? column : column.label);
const textOf = (cell: Cell) =>
    cell === undefined ? "" : typeof cell === "object" ? ("device" in cell ? (cell.label ?? cell.device) : cell.label) : String(cell);
const linkOf = (cell: Cell) => (typeof cell === "object" && cell ? ("device" in cell ? `devices/${cell.device}` : cell.link) : undefined);

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
        <p v-if="csv" class="table-actions"><a @click="save">Save as CSV</a></p>
        <table class="data">
            <thead>
                <tr>
                    <th v-for="column in head" :key="labelOf(column)" :title="typeof column === 'string' ? undefined : column.title">
                        <code v-if="typeof column !== 'string' && column.field">{{ column.label }}</code>
                        <template v-else>{{ labelOf(column) }}</template>
                    </th>
                </tr>
            </thead>
            <tbody>
                <tr v-for="(row, index) in rows" :id="row.id" :key="index" :class="{ muted: row.muted }">
                    <td v-for="(cell, at) in row.cells" :key="at">
                        <a v-if="linkOf(cell)" @click="go(linkOf(cell)!)">{{ textOf(cell) }}</a>
                        <template v-else>{{ textOf(cell) }}</template>
                    </td>
                </tr>
            </tbody>
        </table>
    </div>
</template>
