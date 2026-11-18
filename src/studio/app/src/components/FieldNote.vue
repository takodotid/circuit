<!-- The doc of a device field, in a small note by its name while the pointer or the focus is on it. Any element with `data-doc` has one. One note serves the whole page, placed on top so a table's scrolling never cuts it. -->
<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";

const note = ref<{ text: string; left: number; top: number; below: boolean }>();
/** The room a note needs under the name, else it goes above. */
const ROOM_BELOW = 160;
/** The widest a note is, with room to the window's edge. */
const WIDEST = 380;
/** The gap between the name and its note. */
const GAP = 6;

function show(event: Event): void {
    const target = (event.target as Element | null)?.closest?.("[data-doc]");
    const text = target?.getAttribute("data-doc");
    if (!target || !text) return;

    // Below the name, or above it when the name is near the bottom of the window.
    const box = target.getBoundingClientRect();
    const below = box.bottom < innerHeight - ROOM_BELOW;
    note.value = { text, left: Math.min(box.left, innerWidth - WIDEST), top: below ? box.bottom + GAP : box.top - GAP, below };
}

function hide(event: Event): void {
    const target = (event.target as Element | null)?.closest?.("[data-doc]");
    if (target) note.value = undefined;
}

const clear = () => (note.value = undefined);

onMounted(() => {
    document.addEventListener("mouseover", show);
    document.addEventListener("focusin", show);
    document.addEventListener("mouseout", hide);
    document.addEventListener("focusout", hide);
    addEventListener("scroll", clear, true);
});

onBeforeUnmount(() => {
    document.removeEventListener("mouseover", show);
    document.removeEventListener("focusin", show);
    document.removeEventListener("mouseout", hide);
    document.removeEventListener("focusout", hide);
    removeEventListener("scroll", clear, true);
});
</script>

<template>
    <p
        v-if="note"
        class="field-note"
        role="tooltip"
        :style="{ left: `${Math.max(note.left, 8)}px`, top: `${note.top}px`, transform: note.below ? undefined : 'translateY(-100%)' }"
    >
        {{ note.text }}
    </p>
</template>
