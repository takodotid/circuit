<script setup lang="ts">
// Lesson: cables, light and radio. The reader picks a cable or a module from a tray and a port on a switch, and is told whether it fits, and at what speed and distance the link comes up, or why it does not.

import { computed, ref } from "vue";

type PortKind = "rj45" | "sfp-plus" | "sfp28" | "qsfp28";
type Shape = "rj45" | "sfp" | "qsfp";

type Port = {
    kind: PortKind;
    name: string;
    label: string;
    shape: Shape;
    gigabits: number;
    /** Where the first port of this kind is drawn, and its size. */
    x: number;
    y: number;
    width: number;
    height: number;
    count: number;
    gap: number;
};

const ports: Port[] = [
    {
        kind: "rj45",
        name: "RJ45 port, 1G",
        label: "RJ45",
        shape: "rj45",
        gigabits: 1,
        x: 40,
        y: 62,
        width: 34,
        height: 30,
        count: 4,
        gap: 42,
    },
    {
        kind: "sfp-plus",
        name: "SFP+ cage, 10G",
        label: "SFP+",
        shape: "sfp",
        gigabits: 10,
        x: 240,
        y: 68,
        width: 46,
        height: 18,
        count: 2,
        gap: 56,
    },
    {
        kind: "sfp28",
        name: "SFP28 cage, 25G",
        label: "SFP28",
        shape: "sfp",
        gigabits: 25,
        x: 372,
        y: 68,
        width: 46,
        height: 18,
        count: 2,
        gap: 56,
    },
    {
        kind: "qsfp28",
        name: "QSFP28 cage, 100G",
        label: "QSFP28",
        shape: "qsfp",
        gigabits: 100,
        x: 512,
        y: 66,
        width: 72,
        height: 22,
        count: 2,
        gap: 82,
    },
];

type ItemId = "cat6" | "sfp-plus-optic" | "sfp28-optic" | "qsfp28-optic" | "dac";

type Item = {
    id: ItemId;
    name: string;
    shape: Shape;
    gigabits: number;
    carrier: "copper" | "fibre" | "dac";
    /** How far the link reaches, said in words. */
    reach: string;
};

const items: Item[] = [
    { id: "cat6", name: "Cat6 LAN cable", shape: "rj45", gigabits: 1, carrier: "copper", reach: "up to 100 metres" },
    {
        id: "sfp-plus-optic",
        name: "SFP+ optic, 10G, with multimode fibre",
        shape: "sfp",
        gigabits: 10,
        carrier: "fibre",
        reach: "up to about 300 to 400 metres on multimode fibre, depending on its grade",
    },
    {
        id: "sfp28-optic",
        name: "SFP28 optic, 25G, with single-mode fibre",
        shape: "sfp",
        gigabits: 25,
        carrier: "fibre",
        reach: "up to 10 kilometres on single-mode fibre",
    },
    {
        id: "qsfp28-optic",
        name: "QSFP28 optic, 100G, with single-mode fibre",
        shape: "qsfp",
        gigabits: 100,
        carrier: "fibre",
        reach: "up to 10 kilometres on single-mode fibre",
    },
    {
        id: "dac",
        name: "SFP+ DAC, 10G",
        shape: "sfp",
        gigabits: 10,
        carrier: "dac",
        reach: "up to about 7 metres, so to a device in the same rack",
    },
];

const itemId = ref<ItemId>();
const portKind = ref<PortKind>();

const item = computed(() => items.find((entry) => entry.id === itemId.value));
const port = computed(() => ports.find((entry) => entry.kind === portKind.value));

type Verdict = { kind: "good" | "bad" | "warn"; word: string; text: string; inside: boolean };

function farEnd(chosen: Item) {
    if (chosen.carrier === "dac") return "The other end of a DAC is a module too, so it goes straight into the next device's cage.";
    if (chosen.carrier === "fibre")
        return "The device at the far end needs the same kind of optic, or the two ends cannot understand each other.";
    return "The device at the far end needs an RJ45 port too.";
}

const verdict = computed<Verdict | undefined>(() => {
    const chosen = item.value;
    const into = port.value;
    if (!chosen || !into) return undefined;

    if (into.shape === "rj45") {
        if (chosen.shape !== "rj45")
            return {
                kind: "bad",
                word: "Does not fit",
                text: "An RJ45 port is a socket for the plug of a LAN cable. A module needs a cage, and it does not go in here.",
                inside: false,
            };

        return {
            kind: "good",
            word: "Link up",
            text: `The link comes up at 1 Gbit/s, ${chosen.reach}. A Cat6 cable can carry 10 Gbit/s for up to 55 metres, but this port runs at 1 Gbit/s, so the link does too. ${farEnd(chosen)}`,
            inside: true,
        };
    }

    if (chosen.shape === "rj45") {
        const module =
            into.shape === "sfp" ? " To use a LAN cable here, you would need a copper module with an RJ45 socket on its end." : "";
        return {
            kind: "bad",
            word: "Does not fit",
            text: `A cage takes a module, and the plug of a LAN cable is a different shape.${module}`,
            inside: false,
        };
    }

    if (into.shape === "qsfp" && chosen.shape === "sfp")
        return {
            kind: "bad",
            word: "Does not fit",
            text: "A QSFP cage is wider than an SFP-size module, so this one would sit loose and not connect.",
            inside: false,
        };

    if (into.shape === "sfp" && chosen.shape === "qsfp")
        return {
            kind: "bad",
            word: "Does not fit",
            text: "A QSFP module is wider than an SFP cage, so it does not go in.",
            inside: false,
        };

    if (chosen.gigabits > into.gigabits)
        return {
            kind: "warn",
            word: "No link",
            text: `It slides in, because SFP28 is the same size as SFP+. But this cage runs at ${into.gigabits} Gbit/s at most, and a ${chosen.gigabits}G optic is made for ${chosen.gigabits} Gbit/s, so the link usually does not come up. Use a 10G module here.`,
            inside: true,
        };

    const slower =
        chosen.gigabits < into.gigabits
            ? ` SFP+ and SFP28 are the same size, and most ${into.label} cages also run the slower module, at its ${chosen.gigabits} Gbit/s.`
            : "";

    return {
        kind: "good",
        word: "Link up",
        text: `The link comes up at ${chosen.gigabits} Gbit/s, ${chosen.reach}.${slower} ${farEnd(chosen)}`,
        inside: true,
    };
});

/** The drawing of the chosen thing: in the first port of the chosen kind, or under it when it does not fit. */
const drawn = computed(() => {
    const chosen = item.value;
    const into = port.value;
    if (!chosen || !into) return undefined;

    const centre = into.x + into.width / 2;
    const inside = verdict.value!.inside;

    const sizes: Record<Shape, { width: number; height: number }> = {
        rj45: { width: 26, height: 22 },
        sfp: { width: 40, height: 13 },
        qsfp: { width: 64, height: 17 },
    };
    const size = sizes[chosen.shape];
    const top = inside ? into.y + (into.height - size.height) / 2 : 160;

    return {
        kind: verdict.value!.kind,
        carrier: chosen.carrier,
        shape: chosen.shape,
        x: centre - size.width / 2,
        y: top,
        width: size.width,
        height: size.height,
        centre,
        bottom: top + size.height,
        inside,
    };
});

const portsOf = (entry: Port) => Array.from({ length: entry.count }, (_, index) => entry.x + index * entry.gap);
const groupCentre = (entry: Port) => (entry.x + (entry.count - 1) * entry.gap + entry.width + entry.x) / 2;
</script>

<template>
    <div class="plug-it-in">
        <svg
            class="ac-drawing"
            viewBox="0 0 700 230"
            role="img"
            :aria-label="`The front of a switch with four RJ45 ports, two SFP+ cages, two SFP28 cages and two QSFP28 cages.${item && port ? ` A ${item.name} is ${drawn?.inside ? 'in' : 'held under'} the first ${port.name}.` : ''}`"
        >
            <rect class="faceplate" x="20" y="24" width="664" height="104" />

            <g v-for="entry in ports" :key="entry.kind" :class="['group', { chosen: portKind === entry.kind }]">
                <text class="group-name" :x="groupCentre(entry)" y="48" text-anchor="middle">{{ entry.label }}</text>
                <text class="group-speed" :x="groupCentre(entry)" y="116" text-anchor="middle">{{ entry.gigabits }}G</text>

                <template v-for="(left, index) in portsOf(entry)" :key="index">
                    <path
                        v-if="entry.shape === 'rj45'"
                        class="socket"
                        :class="{ lit: portKind === entry.kind && index === 0 }"
                        :d="`M${left} ${entry.y}h${entry.width}v${entry.height - 8}h-9v8h-${entry.width - 18}v-8h-9z`"
                    />
                    <rect
                        v-else
                        class="cage"
                        :class="{ lit: portKind === entry.kind && index === 0 }"
                        :x="left"
                        :y="entry.y"
                        :width="entry.width"
                        :height="entry.height"
                    />
                </template>
            </g>

            <g v-if="drawn" :class="['held', drawn.kind, { inside: drawn.inside }]">
                <template v-if="drawn.carrier === 'fibre'">
                    <line class="lead fibre" :x1="drawn.centre - 6" :y1="drawn.bottom" :x2="drawn.centre - 6" y2="226" />
                    <line class="lead fibre" :x1="drawn.centre + 6" :y1="drawn.bottom" :x2="drawn.centre + 6" y2="226" />
                </template>
                <line v-else class="lead thick" :x1="drawn.centre" :y1="drawn.bottom" :x2="drawn.centre" y2="226" />

                <rect class="thing" :x="drawn.x" :y="drawn.y" :width="drawn.width" :height="drawn.height" />
                <template v-if="drawn.carrier === 'fibre'">
                    <circle class="hole" :cx="drawn.centre - 6" :cy="drawn.y + drawn.height / 2" r="3" />
                    <circle class="hole" :cx="drawn.centre + 6" :cy="drawn.y + drawn.height / 2" r="3" />
                </template>
                <path
                    v-if="drawn.carrier === 'copper'"
                    class="contacts"
                    :d="`M${drawn.x + 5} ${drawn.y + 5}v6M${drawn.x + 10} ${drawn.y + 5}v6M${drawn.x + 15} ${drawn.y + 5}v6M${drawn.x + 20} ${drawn.y + 5}v6`"
                />
                <path v-if="!drawn.inside" class="cross" :d="`M${drawn.x - 14} ${drawn.y - 4}l10 10m0 -10l-10 10`" />
            </g>
        </svg>

        <div class="ac-field">
            <span>1. Take something from the tray</span>
            <div class="tray" role="group" aria-label="The tray">
                <button
                    v-for="entry in items"
                    :key="entry.id"
                    type="button"
                    class="ac-button small"
                    :aria-pressed="itemId === entry.id"
                    @click="itemId = entry.id"
                >
                    <svg class="icon" viewBox="0 0 60 24" aria-hidden="true">
                        <template v-if="entry.carrier === 'copper'">
                            <line x1="2" y1="12" x2="34" y2="12" class="wire thick" />
                            <rect x="34" y="6" width="20" height="12" class="part" />
                            <path d="M40 6v-3h8v3" class="wire" />
                        </template>
                        <template v-else-if="entry.carrier === 'fibre'">
                            <line x1="2" y1="10" x2="20" y2="10" class="wire" />
                            <line x1="2" y1="14" x2="20" y2="14" class="wire" />
                            <rect
                                x="20"
                                :y="entry.shape === 'qsfp' ? 4 : 7"
                                width="34"
                                :height="entry.shape === 'qsfp' ? 16 : 10"
                                class="part"
                            />
                        </template>
                        <template v-else>
                            <rect x="2" y="7" width="14" height="10" class="part" />
                            <line x1="16" y1="12" x2="44" y2="12" class="wire thick" />
                            <rect x="44" y="7" width="14" height="10" class="part" />
                        </template>
                    </svg>
                    {{ entry.name }}
                </button>
            </div>
        </div>

        <div class="ac-field">
            <span>2. Pick a port to plug it into</span>
            <div class="ac-row" role="group" aria-label="Ports">
                <button
                    v-for="entry in ports"
                    :key="entry.kind"
                    type="button"
                    class="ac-button small"
                    :aria-pressed="portKind === entry.kind"
                    @click="portKind = entry.kind"
                >
                    {{ entry.name }}
                </button>
            </div>
        </div>

        <p v-if="verdict" class="ac-say" :class="verdict.kind" :data-word="verdict.word" aria-live="polite">{{ verdict.text }}</p>
        <p v-else class="ac-say hint" aria-live="polite">
            {{ item ? "Now pick a port to plug it into." : "Take something from the tray, then pick a port to plug it into." }}
        </p>
    </div>
</template>

<style scoped>
.faceplate {
    fill: var(--circuit-cobalt);
    stroke: #0a1a36;
    stroke-width: 2.5;
}

.dark .faceplate {
    stroke: var(--circuit-link);
}

.ac-drawing .group-name {
    fill: #ffffff;
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.06em;
}

.ac-drawing .group-speed {
    fill: #c9d7f5;
    font-size: 13px;
    font-weight: 700;
}

.socket,
.cage {
    fill: #0a1a36;
    stroke: #ffffff;
    stroke-width: 1.5;
    transition: stroke 0.2s;
}

.socket.lit,
.cage.lit {
    stroke: var(--circuit-yellow);
    stroke-width: 3;
}

.thing {
    fill: var(--circuit-yellow);
    stroke: #0a1a36;
    stroke-width: 1.5;
}

.held.bad .thing {
    fill: var(--circuit-paper);
    stroke: var(--circuit-removed);
    stroke-width: 2;
    stroke-dasharray: 4 3;
}

.held.warn .thing {
    stroke: var(--circuit-warning);
    stroke-width: 2.5;
    stroke-dasharray: 4 3;
}

.hole {
    fill: #0a1a36;
}

.contacts {
    stroke: #0a1a36;
    stroke-width: 1.5;
}

.lead {
    stroke: var(--circuit-edge);
    fill: none;
}

.lead.thick {
    stroke-width: 6;
}

.lead.fibre {
    stroke-width: 2.5;
}

.held.good .lead {
    stroke: var(--circuit-link);
}

.held.bad .lead {
    stroke-dasharray: 4 4;
}

.cross {
    stroke: var(--circuit-removed);
    stroke-width: 3;
    stroke-linecap: round;
    fill: none;
}

.ac-field {
    margin-top: 14px;
}

.tray {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
}

.tray .ac-button {
    white-space: normal;
    text-align: left;
}

.icon {
    flex: none;
    width: 48px;
    height: 20px;
}

.icon .part {
    fill: currentColor;
    fill-opacity: 0.2;
    stroke: currentColor;
    stroke-width: 1.5;
}

.icon .wire {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.5;
}

.icon .wire.thick {
    stroke-width: 3.5;
}

.hint {
    color: var(--circuit-soft);
}
</style>
