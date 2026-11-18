<script setup lang="ts">
// Lesson: who runs the internet. The reader picks what to open and steps along the way a request travels, each hop labeled with what it is and which network runs it.

import { computed, ref } from "vue";
import { useNarrow } from "./SwitchLearning";

type Kind = "laptop" | "router" | "switch" | "server" | "cloud";
type Hop = { kind: Kind; label: string; network: string; title: string; text: string };

/** Each network's name, and its AS number where the drawing shows it, on two lines. */
const NETWORKS: Record<string, [string, string]> = {
    home: ["Your home", ""],
    provider: ["Your provider", "AS64500"],
    exchange: ["Exchange", ""],
    host: ["Host", ""],
    content: ["Netflix", "AS2906"],
    transit: ["Hurricane Electric", "AS6939"],
    abroad: ["Abroad", ""],
    far: ["Host", ""],
};

const HOME: Hop = {
    kind: "laptop",
    label: "Laptop",
    network: "home",
    title: "Your home",
    text: "Your laptop sends the request to the home router, and the ONT turns it into light on the fiber. The ONT and the router are the provider's CPE, its boxes in your home.",
};

const ACCESS: Hop = {
    kind: "router",
    label: "OLT, BNG",
    network: "provider",
    title: "Your provider's access network",
    text: "The OLT at the other end of the fiber gathers the splitters. Behind it is the BNG: your PPPoE session ends there, and the BNG gives you your address and runs the CGNAT if you share one.",
};

const CORE: Hop = {
    kind: "router",
    label: "PoP",
    network: "provider",
    title: "Your provider's core, to a PoP",
    text: "The provider's core routers carry the request to a point of presence, a PoP: often a data center, where the provider meets other networks.",
};

const CROSS: Hop = {
    kind: "switch",
    label: "Cross-connect",
    network: "exchange",
    title: "A cross-connect in the data center",
    text: "Inside the data center, a cross-connect joins the provider's router to the exchange's switch. It is a cable the data center runs between two customers.",
};

const EXCHANGE: Hop = {
    kind: "switch",
    label: "Peering LAN",
    network: "exchange",
    title: "The national exchange",
    text: "The provider and the hosting company each have a port on the exchange's peering LAN, and they peer. Neither pays a transit provider for this request.",
};

const DESTINATIONS: { id: string; name: string; hops: Hop[] }[] = [
    {
        id: "local",
        name: "A news site hosted in your city",
        hops: [
            HOME,
            ACCESS,
            CORE,
            CROSS,
            EXCHANGE,
            {
                kind: "server",
                label: "Web server",
                network: "host",
                title: "The hosting company",
                text: "The hosting company's router hands the request to the server in its racks. The answer goes back the same way, and never leaves the country.",
            },
        ],
    },
    {
        id: "video",
        name: "A video on Netflix",
        hops: [
            HOME,
            ACCESS,
            CORE,
            {
                kind: "server",
                label: "Cache",
                network: "content",
                title: "A cache inside your provider",
                text: "Netflix places servers with copies of its videos inside providers' networks. The video comes from a rack in your provider's PoP, and crosses no other network.",
            },
        ],
    },
    {
        id: "far",
        name: "A website hosted in Europe",
        hops: [
            HOME,
            ACCESS,
            CORE,
            {
                kind: "cloud",
                label: "Upstream",
                network: "transit",
                title: "Your provider's upstream",
                text: "No network at the national exchange carries this site's routes. So your provider sends the request to its upstream, Hurricane Electric, a transit network it pays.",
            },
            {
                kind: "cloud",
                label: "Backbone",
                network: "transit",
                title: "Across the transit's backbone",
                text: "The transit network carries the request across undersea cables to its routers in Europe. Most of the delay comes from these thousands of kilometers of fiber.",
            },
            {
                kind: "switch",
                label: "Exchange",
                network: "abroad",
                title: "Handed over in Europe",
                text: "In a European data center, the transit network hands the request to the hosting company: at an exchange, over a cross-connect, or as its transit provider.",
            },
            {
                kind: "server",
                label: "Web server",
                network: "far",
                title: "The hosting company abroad",
                text: "The answer comes back across the same kinds of networks, but not always on the same path, because each network chooses its own way.",
            },
        ],
    },
];

const destinationId = ref(DESTINATIONS[0]!.id);
const destination = computed(() => DESTINATIONS.find((entry) => entry.id === destinationId.value)!);

// Wide: the hops side by side. Under 640px: one hop per row, top to bottom, so the words keep their size on a phone.
const narrow = useNarrow();

const SPACING = 100;
const ROW = 96;
const FIRST_ROW = 56;

const placed = computed(() => {
    const hops = destination.value.hops;

    if (narrow.value) return hops.map((hop, index) => ({ ...hop, index, x: 64, y: FIRST_ROW + index * ROW }));

    const start = 350 - ((hops.length - 1) * SPACING) / 2;
    return hops.map((hop, index) => ({ ...hop, index, x: start + index * SPACING, y: 110 }));
});

const viewBox = computed(() => (narrow.value ? `0 0 320 ${FIRST_ROW + (destination.value.hops.length - 1) * ROW + 56}` : "0 0 700 190"));

/** Each network's stretch of the drawing, behind the hops it runs: a column wide, or a row narrow. */
const bands = computed(() => {
    const groups: { network: string; first: number; last: number }[] = [];
    for (const hop of placed.value) {
        const at = narrow.value ? hop.y : hop.x;
        const previous = groups[groups.length - 1];
        if (previous && previous.network === hop.network) previous.last = at;
        else groups.push({ network: hop.network, first: at, last: at });
    }

    return groups.map((group) => {
        if (narrow.value) {
            const y = group.first - 42;
            return { ...group, x: 8, y, width: 304, height: group.last - group.first + ROW - 4, textX: 140, textY: y + 22 };
        }

        const x = group.first - SPACING / 2 + 4;
        return { ...group, x, y: 18, width: group.last - group.first + SPACING - 8, height: 150, textX: x + 6, textY: 36 };
    });
});

const steps = computed(() => destination.value.hops.map((hop) => ({ title: hop.title, text: hop.text })));
</script>

<template>
    <div class="page-load-networks">
        <div class="ac-field">
            <span>Open</span>
            <div class="ac-row">
                <button
                    v-for="entry in DESTINATIONS"
                    :key="entry.id"
                    type="button"
                    class="ac-button small"
                    :aria-pressed="entry.id === destinationId"
                    @click="destinationId = entry.id"
                >
                    {{ entry.name }}
                </button>
            </div>
        </div>

        <StepThrough :key="destinationId" :steps="steps" class="steps">
            <template #default="{ step }">
                <svg
                    class="ac-drawing"
                    :viewBox="viewBox"
                    role="img"
                    :aria-label="`The way to ${destination.name.toLowerCase()}: ${destination.hops.map((hop) => hop.title).join(', then ')}. Now at: ${destination.hops[step]?.title}.`"
                >
                    <g v-for="band in bands" :key="`${band.network}${band.first}`" class="band" :class="{ narrow }">
                        <rect :x="band.x" :y="band.y" :width="band.width" :height="band.height" />
                        <text :x="band.textX" :y="band.textY">{{ NETWORKS[band.network][0] }}</text>
                        <text class="as" :x="band.textX" :y="band.textY + 15">{{ NETWORKS[band.network][1] }}</text>
                    </g>
                    <line
                        v-for="hop in placed.slice(1)"
                        :key="`c${hop.index}`"
                        class="cable"
                        :class="{ lit: hop.index <= step }"
                        :x1="placed[hop.index - 1].x"
                        :y1="placed[hop.index - 1].y"
                        :x2="hop.x"
                        :y2="hop.y"
                    />
                    <SvgDevice
                        v-for="hop in placed"
                        :key="hop.index"
                        :kind="hop.kind"
                        :x="hop.x"
                        :y="hop.y"
                        :label="hop.label"
                        :lit="hop.index === step"
                        :dim="hop.index > step"
                    />
                </svg>
            </template>
        </StepThrough>
    </div>
</template>

<style scoped>
.steps {
    margin-top: 14px;
}

.band rect {
    fill: var(--circuit-mist);
    stroke: var(--circuit-line);
    stroke-width: 1.5;
}

.ac-drawing .band text {
    fill: var(--circuit-soft);
    font-size: 11.5px;
    font-weight: 700;
}

.ac-drawing .band.narrow text {
    font-size: 13px;
}

.ac-drawing .band text.as {
    font-family: var(--circuit-mono);
    font-weight: 400;
}
</style>
