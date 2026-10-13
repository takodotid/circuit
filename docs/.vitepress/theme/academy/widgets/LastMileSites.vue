<script setup lang="ts">
// Lesson: reaching the customer. The reader picks a way to connect each of four sites, reads what it brings, and sees the delay each link adds drawn as time on one line.

import { computed, ref } from "vue";
import { useNarrow } from "./SwitchLearning";

type LinkId = "gpon" | "p2p" | "vdsl" | "radio" | "leo" | "geo";
type Fit = "best" | "works" | "poor" | "none";

const LINKS: { id: LinkId; name: string; delay: [number, number]; delayText: string }[] = [
    { id: "gpon", name: "Fibre, shared (GPON)", delay: [0, 1], delayText: "well under 1 ms" },
    { id: "p2p", name: "Fibre, its own", delay: [0, 1], delayText: "well under 1 ms" },
    { id: "vdsl", name: "Copper phone line (VDSL2)", delay: [0, 1], delayText: "under 1 ms on the line" },
    { id: "radio", name: "Fixed wireless radio", delay: [0, 1], delayText: "under 1 ms on the link" },
    { id: "leo", name: "Low-orbit satellite", delay: [30, 80], delayText: "about 30 to 80 ms" },
    { id: "geo", name: "Geostationary satellite (VSAT)", delay: [480, 700], delayText: "over 480 ms, often 600 or more" },
];

const NO_CABLE = "No cable reaches it, so there is nothing to plug this into.";

const SITES: { id: string; name: string; short: string; about: string; fits: Record<LinkId, [Fit, string]> }[] = [
    {
        id: "home",
        name: "A flat in the city",
        short: "Flat",
        about: "The provider's fibre already runs along the street, and the old phone line is still in the wall.",
        fits: {
            gpon: [
                "best",
                "The street has GPON fibre. The flat shares about 2.5 Gbit/s down with the other homes on its splitter, and the fibre adds well under a millisecond.",
            ],
            p2p: [
                "works",
                "A fibre of its own works, but it costs the provider a fibre and a port for one customer. It is kept for businesses that pay for a committed rate.",
            ],
            vdsl: [
                "works",
                "It works over the phone line, but VDSL2 slows with the length of copper: about 100 Mbit/s at 500 m from the cabinet, and 50 at 1 km.",
            ],
            radio: [
                "works",
                "It works if the flat has a clear view of the provider's tower, but the fibre in the street is faster and is not weakened by heavy rain.",
            ],
            leo: [
                "poor",
                "It works under open sky, with tens of milliseconds of delay and capacity shared with other users. Nobody needs it with fibre in the street.",
            ],
            geo: [
                "poor",
                "Over half a second for every round trip makes calls and games painful. Nobody chooses it with fibre in the street.",
            ],
        },
    },
    {
        id: "office",
        name: "An office tower",
        short: "Office",
        about: "An office in the city centre. Its contract must promise a rate and a repair time.",
        fits: {
            p2p: [
                "best",
                "A fibre used by this customer alone. Nobody else shares it, so the provider can commit to a rate and promise a repair time.",
            ],
            gpon: [
                "works",
                "Fine for a small office on a budget, but the splitter's capacity is shared with everyone on it, so a rate is hard to promise.",
            ],
            vdsl: ["poor", "Only as a cheap spare: it is slow and gets slower with distance."],
            radio: ["works", "A good second link: it reaches the office by a different path from the fibre, if the roof can see a tower."],
            leo: ["works", "A spare that shares nothing with the cables in the street, at tens of milliseconds of delay."],
            geo: ["poor", "Only as a last-resort spare: over half a second of delay."],
        },
    },
    {
        id: "factory",
        name: "A factory outside town",
        short: "Factory",
        about: "8 km from town. No fibre or copper runs along its road, but its roof has a clear view of the provider's tower.",
        fits: {
            radio: [
                "best",
                "A point-to-point radio link to the tower needs only a clear view across the 8 km. Heavy rain weakens the higher frequencies, so the link is planned with room for it.",
            ],
            p2p: [
                "works",
                "The best link in the end, but the fibre must first be laid along the road, which takes time and money to build.",
            ],
            gpon: ["none", "No fibre runs along its road, so there is no splitter to join."],
            vdsl: ["none", "No copper runs there, and VDSL2 would be slow over kilometres of it anyway."],
            leo: ["works", "It works under open sky with tens of milliseconds of delay, and makes a good spare for the radio link."],
            geo: ["poor", "It works, but over half a second of delay hurts anything the factory runs in real time."],
        },
    },
    {
        id: "island",
        name: "A plantation on a far island",
        short: "Island",
        about: "No cable reaches the island, and no tower is in sight.",
        fits: {
            leo: [
                "best",
                "Low-orbit satellites fly about 550 km up, so the trip to space and back adds only a few milliseconds; measured round trips are tens of milliseconds. The dish needs an open view of the sky.",
            ],
            geo: [
                "works",
                "A VSAT dish works almost anywhere the sky is open, but the satellite is 35,786 km up, and every round trip takes over half a second.",
            ],
            radio: ["none", "A radio link needs a clear line of sight to a tower, and there is none in view."],
            gpon: ["none", NO_CABLE],
            p2p: ["none", NO_CABLE],
            vdsl: ["none", NO_CABLE],
        },
    },
];

const WORDS: Record<Fit, { kind: string; word: string }> = {
    best: { kind: "good", word: "Best fit" },
    works: { kind: "warn", word: "Works, but" },
    poor: { kind: "warn", word: "Poor fit" },
    none: { kind: "bad", word: "Cannot reach" },
};

const picked = ref<Record<string, LinkId | "">>({ home: "", office: "", factory: "", island: "" });

const linkOf = (id: LinkId) => LINKS.find((link) => link.id === id)!;

// Wide: each site's name left of its line. Under 640px: a narrower drawing with each name above its line, so the words keep their size on a phone.
const narrow = useNarrow();

const LAYOUT = {
    wide: { width: 700, height: 250, left: 120, right: 680, bottom: 222, ticks: [0, 100, 200, 300, 400, 500, 600, 700] },
    narrow: { width: 320, height: 272, left: 14, right: 306, bottom: 244, ticks: [0, 200, 400, 600] },
};
const MAX_MS = 700;

const AXIS = computed(() => (narrow.value ? LAYOUT.narrow : LAYOUT.wide));
const x = (ms: number) => AXIS.value.left + (Math.min(ms, MAX_MS) / MAX_MS) * (AXIS.value.right - AXIS.value.left);

const rows = computed(() =>
    SITES.map((site, index) => {
        const choice = picked.value[site.id];
        const fit = choice ? site.fits[choice][0] : undefined;
        const link = choice ? linkOf(choice) : undefined;
        const y = narrow.value ? 54 + index * 58 : 46 + index * 44;
        const name = narrow.value ? { x: AXIS.value.left, y: y - 16 } : { x: 8, y: y + 5 };
        return { site, index, choice, fit, link, y, name };
    })
);

const best = computed(() => rows.value.filter((row) => row.fit === "best").length);

function showBest() {
    picked.value = Object.fromEntries(
        SITES.map((site) => [site.id, (Object.keys(site.fits) as LinkId[]).find((id) => site.fits[id][0] === "best") ?? ""])
    );
}

function clear() {
    picked.value = { home: "", office: "", factory: "", island: "" };
}
</script>

<template>
    <div class="last-mile-sites">
        <svg
            class="ac-drawing"
            :viewBox="`0 0 ${AXIS.width} ${AXIS.height}`"
            role="img"
            aria-label="The delay each site's link adds to a round trip, drawn on a time line from 0 to 700 milliseconds."
        >
            <text class="axis-title" :x="AXIS.left" y="14">
                {{ narrow ? "Delay added to a round trip, in ms" : "Delay the link adds to a round trip, in milliseconds" }}
            </text>
            <g class="axis">
                <g v-for="ms in AXIS.ticks" :key="ms">
                    <line :x1="x(ms)" :x2="x(ms)" y1="26" :y2="AXIS.bottom" />
                    <text :x="x(ms)" :y="AXIS.bottom + 18" :text-anchor="narrow && ms === 0 ? 'start' : 'middle'">{{ ms }}</text>
                </g>
            </g>

            <g v-for="row in rows" :key="row.site.id">
                <text class="site" :x="row.name.x" :y="row.name.y">{{ row.site.short }}</text>
                <line class="track" :x1="AXIS.left" :x2="AXIS.right" :y1="row.y" :y2="row.y" />
                <text v-if="row.fit === 'none'" class="band-label none" :x="AXIS.left + 10" :y="row.y + 5">cannot reach this site</text>
                <template v-else-if="row.link">
                    <rect
                        class="band"
                        :class="row.fit"
                        :x="x(row.link.delay[0])"
                        :y="row.y - 9"
                        :width="Math.max(5, x(row.link.delay[1]) - x(row.link.delay[0]))"
                        height="18"
                    />
                    <text
                        class="band-label"
                        :x="row.link.delay[1] > 500 ? x(row.link.delay[0]) - 8 : x(row.link.delay[1]) + 10"
                        :y="row.y + 5"
                        :text-anchor="row.link.delay[1] > 500 ? 'end' : 'start'"
                    >
                        {{ row.link.delayText }}
                    </text>
                </template>
                <text v-else class="band-label empty" :x="AXIS.left + 10" :y="row.y + 5">no link picked yet</text>
            </g>
        </svg>

        <ol class="sites">
            <li v-for="row in rows" :key="row.site.id">
                <label class="ac-field">
                    <span>{{ row.site.name }}. {{ row.site.about }}</span>
                    <select v-model="picked[row.site.id]" class="ac-select">
                        <option value="">Pick a way to connect it</option>
                        <option v-for="link in LINKS" :key="link.id" :value="link.id">{{ link.name }}</option>
                    </select>
                </label>
                <p
                    v-if="row.choice && row.fit"
                    class="ac-say"
                    :class="WORDS[row.fit].kind"
                    :data-word="WORDS[row.fit].word"
                    aria-live="polite"
                >
                    {{ row.site.fits[row.choice][1] }}
                </p>
            </li>
        </ol>

        <div class="ac-row">
            <button type="button" class="ac-button small" @click="showBest">Show the best fit for each</button>
            <button type="button" class="ac-button small" @click="clear">Start again</button>
        </div>
        <p class="ac-say" aria-live="polite">
            {{
                best === SITES.length
                    ? "Every site has its best fit: the cables and the radio add almost nothing, the low-orbit satellite tens of milliseconds. Now give the island the geostationary satellite, and see over half a second."
                    : `Pick a link for each site. ${best} of ${SITES.length} have their best fit so far.`
            }}
        </p>
    </div>
</template>

<style scoped>
.axis line {
    stroke: var(--circuit-line);
    stroke-width: 1;
}

.ac-drawing .axis text,
.ac-drawing .axis-title {
    fill: var(--circuit-soft);
    font-size: 12px;
}

.ac-drawing .site {
    font-weight: 700;
}

.track {
    stroke: var(--circuit-edge);
    stroke-width: 1;
    stroke-dasharray: 2 4;
}

.band {
    fill: var(--circuit-link);
    stroke: var(--circuit-ink);
    stroke-width: 1.5;
}

.band.poor,
.band.works {
    fill: var(--circuit-mist);
    stroke: var(--circuit-warning);
    stroke-dasharray: 4 3;
}

.ac-drawing .band-label.none {
    fill: var(--circuit-removed);
}

.ac-drawing .band-label {
    font-size: 12px;
    font-weight: 600;
}

.ac-drawing .band-label.empty {
    fill: var(--circuit-soft);
    font-weight: 400;
}

.sites {
    display: grid;
    gap: 16px;
    margin: 14px 0 12px !important;
    padding: 0 !important;
    list-style: none;
}

.sites li {
    margin: 0 !important;
    padding-left: 12px;
    border-left: 3px solid var(--circuit-line);
}

.sites .ac-say {
    margin-top: 8px;
}
</style>
