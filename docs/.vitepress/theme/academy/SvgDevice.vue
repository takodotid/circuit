<script setup lang="ts">
// A device drawn inside a widget's <svg>, centred on its point, with its name under it. Every lesson draws devices with this, so a laptop or a router looks the same everywhere.

defineProps<{
    kind: "laptop" | "desktop" | "phone" | "server" | "router" | "switch" | "cloud" | "printer" | "camera" | "access-point";
    x: number;
    y: number;
    label?: string;
    /** A second, smaller line under the name, such as an address. */
    note?: string;
    /** Marked as the one that matters now. */
    lit?: boolean;
    /** Faded, as when it is not part of what is shown. */
    dim?: boolean;
}>();
</script>

<template>
    <g class="device" :class="[kind, { lit, dim }]" :transform="`translate(${x} ${y})`">
        <rect v-if="lit" class="halo" x="-38" y="-30" width="76" height="56" rx="8" />

        <template v-if="kind === 'laptop'">
            <rect class="body" x="-22" y="-18" width="44" height="28" rx="2" />
            <rect class="screen" x="-17" y="-13" width="34" height="18" />
            <path class="body" d="M-28 10h56l-4 7h-48z" />
        </template>

        <template v-else-if="kind === 'desktop'">
            <rect class="body" x="-22" y="-20" width="44" height="30" rx="2" />
            <rect class="screen" x="-17" y="-15" width="34" height="20" />
            <path class="body" d="M-5 10h10v5h7v4h-24v-4h7z" />
        </template>

        <template v-else-if="kind === 'phone'">
            <rect class="body" x="-11" y="-20" width="22" height="38" rx="4" />
            <rect class="screen" x="-7" y="-14" width="14" height="25" />
        </template>

        <template v-else-if="kind === 'server'">
            <rect v-for="row in 3" :key="row" class="body" x="-22" :y="-22 + (row - 1) * 14" width="44" height="12" rx="2" />
            <circle v-for="row in 3" :key="`l${row}`" class="led" cx="14" :cy="-16 + (row - 1) * 14" r="2.2" />
        </template>

        <template v-else-if="kind === 'router'">
            <ellipse class="body" cx="0" cy="6" rx="26" ry="11" />
            <rect class="body flat" x="-26" y="-6" width="52" height="12" />
            <ellipse class="body" cx="0" cy="-6" rx="26" ry="11" />
            <path class="mark" d="M-14 -6h28M-14 -6l5 -3.5M-14 -6l5 3.5M14 -6l-5 -3.5M14 -6l-5 3.5" />
        </template>

        <template v-else-if="kind === 'switch'">
            <rect class="body" x="-30" y="-12" width="60" height="24" rx="2" />
            <rect v-for="port in 6" :key="port" class="socket" :x="-24 + (port - 1) * 8.4" y="-4" width="6" height="7" />
        </template>

        <template v-else-if="kind === 'cloud'">
            <path class="body" d="M-26 12a12 12 0 0 1 1 -23a16 16 0 0 1 30 -6a13 13 0 0 1 21 15a10 10 0 0 1 -2 14z" />
        </template>

        <template v-else-if="kind === 'printer'">
            <rect class="screen" x="-13" y="-20" width="26" height="12" />
            <rect class="body" x="-22" y="-10" width="44" height="20" rx="2" />
            <rect class="screen" x="-13" y="4" width="26" height="12" />
        </template>

        <template v-else-if="kind === 'camera'">
            <rect class="body" x="-20" y="-12" width="32" height="22" rx="3" />
            <path class="body" d="M12 -6l12 -6v22l-12 -6z" />
            <circle class="screen" cx="-4" cy="-1" r="6" />
        </template>

        <template v-else-if="kind === 'access-point'">
            <ellipse class="body" cx="0" cy="6" rx="22" ry="8" />
            <path class="wave" d="M-12 -6a17 17 0 0 1 24 0M-7 -1a10 10 0 0 1 14 0" />
            <circle class="led" cx="0" cy="5" r="2.2" />
        </template>

        <text v-if="label" class="label" y="38" text-anchor="middle">{{ label }}</text>
        <text v-if="note" class="note" :y="label ? 54 : 38" text-anchor="middle">{{ note }}</text>
    </g>
</template>

<style scoped>
.device {
    transition: opacity 0.25s;
}

.device.dim {
    opacity: 0.3;
}

.halo {
    fill: var(--circuit-yellow);
    stroke: #0a1a36;
    stroke-width: 2;
}

.body {
    fill: var(--circuit-cobalt);
    stroke: #0a1a36;
    stroke-width: 2;
    stroke-linejoin: round;
}

/* On the night ground a navy outline disappears, so devices are outlined in the night link colour. */
.dark .body,
.dark .halo,
.dark .screen {
    stroke: var(--circuit-link);
}

.dark .lit .halo {
    stroke: #0a1a36;
}

.body.flat {
    stroke: none;
}

.router .body.flat + .body {
    stroke: #0a1a36;
}

.router ellipse:first-of-type {
    fill: var(--circuit-cobalt-deep);
}

.screen {
    fill: #ffffff;
    stroke: #0a1a36;
    stroke-width: 1.5;
}

.socket {
    fill: #ffffff;
}

.lit .socket {
    fill: var(--circuit-yellow);
}

.led {
    fill: var(--circuit-yellow);
}

.mark,
.wave {
    fill: none;
    stroke: #ffffff;
    stroke-width: 2.2;
    stroke-linecap: round;
}

.access-point .wave {
    stroke: var(--circuit-cobalt);
}

.dark .access-point .wave {
    stroke: var(--circuit-link);
}

.cloud .body {
    fill: var(--circuit-mist);
    stroke: var(--circuit-ink);
}

.label {
    fill: var(--circuit-ink);
    font-size: 13px;
    font-weight: 700;
}

.note {
    fill: var(--circuit-soft);
    font-family: var(--circuit-mono);
    font-size: 11.5px;
}
</style>
