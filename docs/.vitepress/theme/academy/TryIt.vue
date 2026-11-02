<script setup lang="ts">
// A frame around something to play with, marked the way a manual marks an exercise.

defineProps<{
    /** What to do, in a few words. */
    title?: string;
}>();
</script>

<template>
    <section class="try" :aria-label="title ?? 'Try it'">
        <header>
            <span class="chip">Try it</span>
            <strong v-if="title">{{ title }}</strong>
        </header>
        <slot />
    </section>
</template>

<style scoped>
.try {
    margin: 28px 0;
    padding: 18px 22px 22px;
    border: 2px solid var(--circuit-ink);
    background: var(--circuit-paper);
}

header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 12px;
    margin-bottom: 16px;
}

.chip {
    padding: 2px 8px;
    background: var(--circuit-cobalt);
    color: #ffffff;
    font-size: 12px;
    font-weight: 700;
    font-stretch: 120%;
    letter-spacing: 0.1em;
    line-height: 20px;
    text-transform: uppercase;
}

strong {
    font-size: 17px;
    font-weight: 700;
}

@media (max-width: 640px) {
    .try {
        margin-inline: -8px;
        padding: 16px 14px 18px;
    }
}
</style>
