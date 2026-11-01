<!-- Settings as a table of field and value. A value that holds named items, or a list of items, is a table inside; any other is one line of text. -->
<script setup lang="ts">
import { computed } from "vue";
import { Format } from "../lib/format";

const props = defineProps<{ value: unknown }>();

type Shown =
    | { kind: "text"; text: string }
    | { kind: "settings"; value: Record<string, unknown> }
    | { kind: "record"; head: string[]; rows: { name: string; cells: unknown[] }[] }
    | { kind: "list"; head: string[]; rows: unknown[][] };

/** The fields any of the items hold, in the order first seen. */
const columnsOf = (items: Record<string, unknown>[]) => [...new Set(items.flatMap((item) => Object.keys(item)))];

function shown(value: unknown): Shown {
    if (Format.isObject(value) && Object.keys(value).length && !Format.isSecret(value)) {
        const inner = Object.entries(value).filter(([, item]) => item !== undefined);
        const allObjects = inner.every(([, item]) => Format.isObject(item) && !Format.isSecret(item));
        if (!allObjects) return { kind: "settings", value };

        const items = inner.map(([, item]) => item as Record<string, unknown>);
        const head = columnsOf(items);
        return { kind: "record", head, rows: inner.map(([name], index) => ({ name, cells: head.map((column) => items[index]![column]) })) };
    }

    if (Array.isArray(value) && value.some((item) => Format.isObject(item) && !Format.isSecret(item))) {
        const items = value.map((item) => (Format.isObject(item) ? item : { value: item }));
        const head = columnsOf(items);
        return { kind: "list", head, rows: items.map((item) => head.map((column) => item[column])) };
    }

    return { kind: "text", text: Format.compact(value) };
}

const entries = computed(() =>
    Format.isObject(props.value)
        ? Object.entries(props.value)
              .filter(([, value]) => value !== undefined)
              .map(([key, value]) => ({ key, item: shown(value) }))
        : []
);
</script>

<template>
    <p v-if="!entries.length" class="muted">None.</p>
    <table v-else class="data settings">
        <tbody>
            <tr v-for="{ key, item } in entries" :key="key">
                <th>
                    <code>{{ key }}</code>
                </th>
                <td>
                    <template v-if="item.kind === 'text'">{{ item.text }}</template>
                    <Settings v-else-if="item.kind === 'settings'" :value="item.value" />
                    <table v-else-if="item.kind === 'record'" class="data">
                        <thead>
                            <tr>
                                <th>Name</th>
                                <th v-for="column in item.head" :key="column">
                                    <code>{{ column }}</code>
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="row in item.rows" :key="row.name">
                                <td>
                                    <strong>{{ row.name }}</strong>
                                </td>
                                <td v-for="(cell, at) in row.cells" :key="at">{{ Format.compact(cell) }}</td>
                            </tr>
                        </tbody>
                    </table>
                    <table v-else class="data">
                        <thead>
                            <tr>
                                <th>#</th>
                                <th v-for="column in item.head" :key="column">
                                    <code>{{ column }}</code>
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="(row, index) in item.rows" :key="index">
                                <td>{{ index + 1 }}</td>
                                <td v-for="(cell, at) in row" :key="at">{{ Format.compact(cell) }}</td>
                            </tr>
                        </tbody>
                    </table>
                </td>
            </tr>
        </tbody>
    </table>
</template>
