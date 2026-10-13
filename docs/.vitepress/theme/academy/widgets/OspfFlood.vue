<script setup lang="ts">
// Lesson: OSPF. The reader steps through four routers finding their neighbors, sharing their links until each holds the same map, computing paths, and doing it again when a link fails.

import { shortestPaths, pathsTo, type Link } from "./OspfMap";

const routers = [
    { id: "R1", x: 70, y: 70 },
    { id: "R2", x: 300, y: 70 },
    { id: "R3", x: 70, y: 240 },
    { id: "R4", x: 300, y: 240 },
];

const at = (id: string) => routers.find((router) => router.id === id)!;

const links = [
    { a: "R1", b: "R2", cost: 10 },
    { a: "R1", b: "R3", cost: 10 },
    { a: "R2", b: "R4", cost: 10 },
    { a: "R3", b: "R4", cost: 30 },
];

const FAILED = "R2-R4";
const key = (link: { a: string; b: string }) => `${link.a}-${link.b}`;

const steps = [
    {
        title: "Neighbors say hello",
        text: "Each router sends a hello message out of every interface OSPF runs on. When two routers hear each other, they become neighbors. They keep saying hello every few seconds.",
    },
    {
        title: "Each router describes its own links",
        text: "Each router writes down the links it has and their costs, in a message called a link-state advertisement. So far, each one only knows its own links.",
    },
    {
        title: "They flood what they learn",
        text: "Each router sends its description to its neighbors, and passes on every description it receives. Soon every router holds the same map of every link: the link-state database.",
    },
    {
        title: "Each router computes its paths",
        text: "Each router runs the shortest path first calculation over the map, with itself at the start, and puts the result in its routing table. R1 reaches R4 through R2, at a cost of 20.",
    },
    {
        title: "A link fails",
        text: "The cable between R2 and R4 breaks. They stop hearing each other's hellos. Many routers wait about 40 seconds of silence before they give up on a neighbor; with BFD it takes less than a second.",
    },
    {
        title: "They flood the change",
        text: "R2 and R4 each send a new description of their links, without the broken one. It is flooded like before, so every router removes the link from its map.",
    },
    {
        title: "Everyone computes again",
        text: "Each router runs the calculation again over the new map. R1 now reaches R4 through R3, at a cost of 40. Nobody touched a routing table by hand.",
    },
];

/** What each router knows about each link at a step: known, unknown, or known to be gone. */
function knows(step: number, router: string, link: { a: string; b: string }): "known" | "unknown" | "gone" {
    if (step === 0) return "unknown";
    if (step >= 5 && key(link) === FAILED) return "gone";
    if (step >= 2) return "known";
    return link.a === router || link.b === router ? "known" : "unknown";
}

/** The links on R1's cheapest path to R4 at a step, if it has computed one. */
function lit(step: number): Set<string> {
    if (step !== 3 && step !== 6) return new Set();

    const up: Link[] = links.map((link) => ({ ...link, up: step < 4 || key(link) !== FAILED }));
    const path =
        pathsTo(
            shortestPaths(
                routers.map((router) => router.id),
                up,
                "R1"
            ),
            "R4"
        )[0] ?? [];

    return new Set(
        path
            .slice(1)
            .map((router, index) =>
                links.map(key).find((name) => name === `${path[index]}-${router}` || name === `${router}-${path[index]}`)!
            )
    );
}

/** Where the word hello sits beside a link: above a level link, to the right of an upright one. */
function helloAt(link: { a: string; b: string }) {
    const start = at(link.a);
    const end = at(link.b);
    const level = start.y === end.y;

    return level
        ? { x: start.x + (end.x - start.x) * 0.3, y: start.y - 12, "text-anchor": "middle" }
        : { x: start.x + 14, y: start.y + (end.y - start.y) * 0.3 + 4, "text-anchor": "start" };
}

const linkLabel = (link: { a: string; b: string }) => `${link.a.slice(1)}-${link.b.slice(1)}`;
</script>

<template>
    <StepThrough :steps="steps" v-slot="{ step }">
        <svg
            class="ac-drawing"
            viewBox="0 0 700 320"
            role="img"
            aria-label="Four routers in a square, and beside them a grid of which links each router knows."
        >
            <g v-for="link in links" :key="key(link)" class="link" :class="{ broken: step >= 4 && key(link) === FAILED }">
                <line
                    class="cable"
                    :class="{ lit: lit(step).has(key(link)) }"
                    :x1="at(link.a).x"
                    :y1="at(link.a).y"
                    :x2="at(link.b).x"
                    :y2="at(link.b).y"
                />
                <g :transform="`translate(${(at(link.a).x + at(link.b).x) / 2} ${(at(link.a).y + at(link.b).y) / 2})`">
                    <rect class="cost" :class="{ lit: lit(step).has(key(link)) }" x="-17" y="-11" width="34" height="22" />
                    <text class="cost-text" y="4.5" text-anchor="middle">{{ step >= 4 && key(link) === FAILED ? "cut" : link.cost }}</text>
                </g>
                <template v-if="step === 0 || (step === 4 && key(link) !== FAILED)">
                    <text class="hello" v-bind="helloAt(link)">hello</text>
                </template>
                <template v-if="step === 2 || (step === 5 && key(link) !== FAILED)">
                    <rect
                        class="lsa"
                        :x="at(link.a).x + (at(link.b).x - at(link.a).x) * 0.72 - 7"
                        :y="at(link.a).y + (at(link.b).y - at(link.a).y) * 0.72 - 5"
                        width="14"
                        height="10"
                    />
                </template>
            </g>

            <SvgDevice
                v-for="router in routers"
                :key="router.id"
                kind="router"
                :x="router.x"
                :y="router.y"
                :label="router.id"
                :lit="(step === 3 || step === 6) && (router.id === 'R1' || router.id === 'R4')"
            />

            <g class="map" transform="translate(420 40)">
                <text class="map-title" x="0" y="0">What each router knows</text>
                <text v-for="(link, column) in links" :key="key(link)" class="map-head" :x="70 + column * 52" y="28" text-anchor="middle">
                    {{ linkLabel(link) }}
                </text>
                <g v-for="(router, row) in routers" :key="router.id" :transform="`translate(0 ${48 + row * 40})`">
                    <text class="map-row" x="0" y="5">{{ router.id }}</text>
                    <g v-for="(link, column) in links" :key="key(link)" :transform="`translate(${70 + column * 52} 0)`">
                        <rect class="cell" :class="knows(step, router.id, link)" x="-11" y="-11" width="22" height="22" />
                        <path v-if="knows(step, router.id, link) === 'gone'" class="cross" d="M-7 -7L7 7M7 -7L-7 7" />
                    </g>
                </g>
                <g transform="translate(0 222)">
                    <rect class="cell known" x="0" y="-9" width="14" height="14" />
                    <text class="legend" x="20" y="3">known</text>
                    <rect class="cell unknown" x="82" y="-9" width="14" height="14" />
                    <text class="legend" x="102" y="3">not yet</text>
                    <rect class="cell gone" x="170" y="-9" width="14" height="14" />
                    <text class="legend" x="190" y="3">gone</text>
                </g>
            </g>
        </svg>
    </StepThrough>
</template>

<style scoped>
.link.broken .cable {
    stroke: var(--circuit-removed);
    stroke-dasharray: 6 6;
}

.cost {
    fill: var(--circuit-paper);
    stroke: var(--circuit-ink);
    stroke-width: 1.5;
}

.cost.lit {
    fill: var(--circuit-yellow);
}

.ac-drawing .cost-text {
    font-family: var(--circuit-mono);
    font-size: 12px;
    font-weight: 700;
}

.ac-drawing .cost.lit + .cost-text {
    fill: #0a1a36;
}

.ac-drawing .hello {
    fill: var(--circuit-link);
    font-size: 12px;
    font-weight: 700;
}

.lsa {
    fill: var(--circuit-yellow);
    stroke: #0a1a36;
    stroke-width: 1.5;
}

.ac-drawing .map-title {
    font-size: 13px;
    font-weight: 700;
}

.ac-drawing .map-head {
    fill: var(--circuit-soft);
    font-family: var(--circuit-mono);
    font-size: 11.5px;
}

.ac-drawing .map-row {
    font-size: 13px;
    font-weight: 700;
}

.cell {
    stroke: var(--circuit-ink);
    stroke-width: 1.5;
    transition: fill 0.25s;
}

.cell.known {
    fill: var(--circuit-cobalt);
}

.cell.unknown {
    fill: var(--circuit-paper);
    stroke-dasharray: 3 3;
}

.cell.gone {
    fill: var(--circuit-paper);
    stroke: var(--circuit-removed);
}

.cross {
    stroke: var(--circuit-removed);
    stroke-width: 2;
}

.ac-drawing .legend {
    font-size: 12px;
}

@media (prefers-reduced-motion: reduce) {
    .cell {
        transition: none;
    }
}
</style>
