<script setup lang="ts">
// How a change travels: the file, the checks, the plan against what the device runs now, your yes, and the device. Numbered like the parts plate on the home page.

const steps = [
    { title: "Device file", detail: "edge-01.ts", note: "your editor checks names" },
    { title: "validate", detail: "circuit validate", note: "the whole project" },
    { title: "Plan", detail: "circuit apply edge-01", note: "read the device now" },
    { title: "Your yes", detail: "Send? Yes / No", note: "No by default", action: true },
    { title: "Device", detail: "edge-01", note: "kept once Circuit logs in again" },
];
</script>

<template>
    <figure class="circuit-diagram">
        <svg viewBox="0 0 1000 190" role="img" aria-labelledby="flow-title">
            <title id="flow-title">
                A change goes from the device file, through circuit validate, to a plan made against what the device runs now, then your
                yes, then the device.
            </title>
            <defs>
                <marker id="flow-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
                    <path d="M0 0 10 5 0 10z" class="ink-fill" />
                </marker>
            </defs>
            <g v-for="(step, index) in steps" :key="step.title" :transform="`translate(${index * 200 + 10}, 40)`">
                <rect width="170" height="100" :class="step.action ? 'action' : 'box'" />
                <circle cx="0" cy="0" r="15" class="dot" />
                <text x="0" y="5" class="dot-text">{{ index + 1 }}</text>
                <text x="85" y="38" class="title">{{ step.title }}</text>
                <text x="85" y="62" class="mono">{{ step.detail }}</text>
                <text x="85" y="128" class="note">{{ step.note }}</text>
                <line v-if="index < steps.length - 1" x1="172" y1="50" x2="198" y2="50" class="arrow" marker-end="url(#flow-arrow)" />
            </g>
        </svg>
    </figure>
</template>
