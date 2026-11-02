<!-- Two texts compared line by line: what is the same is folded away, except a few lines around each change. -->
<script setup lang="ts">
import { computed } from "vue";
import { Diff } from "../lib/diff";
import { Format } from "../lib/format";

const props = defineProps<{ before: string; after: string }>();

const lines = computed(() => Diff.lines(props.before.trimEnd().split("\n"), props.after.trimEnd().split("\n")));
const changed = computed(() => lines.value?.filter((line) => line.kind !== "same").length ?? 0);
const shown = computed(() => (lines.value ? Diff.shown(lines.value) : []));
const mark = (kind: string) => (kind === "added" ? "+ " : kind === "removed" ? "- " : "  ");
</script>

<template>
    <p v-if="!lines" class="muted">They differ in too many lines to compare one by one.</p>
    <p v-else-if="!changed" class="muted">They are the same, line for line.</p>
    <div v-else>
        <p class="muted">{{ Format.count(changed, "line differs", "lines differ") }}.</p>
        <pre
            class="code diff"
        ><template v-for="(line, index) in shown" :key="index"><span v-if="line.kind === 'fold'" class="fold">{{ Format.count(line.count, "line") }} the same{{ "\n" }}</span><span v-else :class="line.kind">{{ mark(line.kind) }}{{ line.text }}{{ "\n" }}</span></template></pre>
    </div>
</template>
