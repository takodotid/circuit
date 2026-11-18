<!-- What the graph's marks mean, each beside a small drawing of it. -->
<script setup lang="ts">
import type { Layer } from "../../../../core/graph";

defineProps<{ layer: Layer; comparing: boolean }>();
</script>

<template>
    <ul class="legend">
        <li>
            <svg width="34" height="12" aria-hidden="true">
                <line x1="2" y1="6" x2="32" y2="6" stroke-width="2" style="stroke: var(--edge)" />
                <circle cx="20" cy="6" r="3" style="fill: var(--accent)" />
            </svg>
            Both ends declare it.
        </li>
        <li>
            <svg width="34" height="12" aria-hidden="true">
                <line x1="2" y1="6" x2="32" y2="6" stroke-width="3" stroke-dasharray="4 4" style="stroke: var(--warning)" />
            </svg>
            Only one end declares it.
        </li>
        <template v-if="comparing">
            <li>
                <svg width="34" height="12" aria-hidden="true">
                    <line x1="2" y1="6" x2="32" y2="6" stroke-width="4" style="stroke: var(--ok)" />
                </svg>
                New since the commit compared.
            </li>
            <li>
                <svg width="34" height="18" aria-hidden="true">
                    <line x1="2" y1="9" x2="19" y2="9" stroke-width="4" stroke-dasharray="7 3" style="stroke: var(--error)" />
                    <rect
                        x="20"
                        y="3"
                        width="12"
                        height="12"
                        rx="3"
                        fill="none"
                        stroke-width="2"
                        stroke-dasharray="3 2"
                        style="stroke: var(--muted)"
                    />
                </svg>
                Gone since then.
            </li>
        </template>
        <li>
            <svg width="34" height="18" aria-hidden="true">
                <rect x="2" y="2" width="30" height="14" rx="3" fill="none" stroke-width="3" style="stroke: var(--error)" />
            </svg>
            A device with an error.
        </li>
        <li>
            <svg width="34" height="18" aria-hidden="true">
                <rect
                    x="2"
                    y="2"
                    width="30"
                    height="14"
                    rx="3"
                    fill="none"
                    stroke-width="3"
                    stroke-dasharray="6 3"
                    style="stroke: var(--warning)"
                />
            </svg>
            A device with a warning.
        </li>
        <li v-if="layer === 'l3'">
            <svg width="34" height="18" aria-hidden="true">
                <rect x="2" y="2" width="30" height="14" rx="6" stroke-width="2" style="fill: var(--segment); stroke: var(--yellow-deep)" />
            </svg>
            A prefix three or more devices share.
        </li>
        <li>
            <svg width="34" height="18" aria-hidden="true">
                <rect
                    x="2"
                    y="2"
                    width="30"
                    height="14"
                    rx="3"
                    fill="none"
                    stroke-width="2"
                    stroke-dasharray="2 3"
                    style="stroke: var(--edge)"
                />
            </svg>
            Outside the network.
        </li>
    </ul>
</template>
