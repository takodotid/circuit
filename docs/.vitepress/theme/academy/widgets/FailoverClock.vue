<script setup lang="ts">
// Lesson: BGP inside a network. The reader breaks the link between two routers and sees on a time line how long traffic is lost, with and without BFD, and whether the iBGP session between them survives.

import { computed, ref, watch } from "vue";
import { useTravel } from "../travel";

type Build = "cable" | "switch";
type Ends = "loopbacks" | "link";

const build = ref<Build>("switch");
const bfd = ref(false);
const ends = ref<Ends>("loopbacks");
const cut = ref(false);

// The values the time line uses: OSPF's sample dead interval, BGP's suggested hold time, and an example BFD setting.
const DEAD_INTERVAL = 40;
const HOLD_TIME = 90;
const BFD_INTERVAL = 0.3;
const BFD_MULTIPLIER = 3;

watch([build, bfd, ends], () => {
    cut.value = false;
});

const places = {
    r1: { x: 110, y: 70 },
    r2: { x: 590, y: 70 },
    r3: { x: 350, y: 200 },
    sw: { x: 350, y: 70 },
};

/** Seconds from the cut until OSPF knows the link is gone. */
const noticed = computed(() => {
    if (build.value === "cable") return 0;
    return bfd.value ? BFD_INTERVAL * BFD_MULTIPLIER : DEAD_INTERVAL;
});

const howNoticed = computed(() => {
    if (build.value === "cable") return "Both ports lose the light and go down, and the routers notice at once.";
    if (bfd.value)
        return `Both routers' ports stay up, since their own cables to the switch are fine. BFD misses ${BFD_MULTIPLIER} packets sent ${BFD_INTERVAL * 1000} ms apart, an example setting, and tells OSPF after ${noticed.value.toFixed(1)} s.`;
    return `Both routers' ports stay up, since their own cables to the switch are fine. OSPF waits out its dead interval, ${DEAD_INTERVAL} s with the standard's sample values, without a hello from the other side.`;
});

const sessionText = computed(() => {
    if (ends.value === "loopbacks")
        return "The iBGP session runs between the loopbacks. Once OSPF finds the way through R3, the session's packets take it, long before the 90 s hold time runs out. The session never goes down, and no route is withdrawn.";

    return `The iBGP session runs between the link's own addresses, and R2's address on the link can no longer be reached. The session goes down at the latest when the ${HOLD_TIME} s hold time runs out, and every route learned through it is withdrawn, to be sent again when the link returns.`;
});

const { position, travelling, travel } = useTravel(300);

async function toggleCut() {
    cut.value = !cut.value;
    if (!cut.value) return;

    await travel([
        [places.r1.x, places.r1.y],
        [places.r3.x, places.r3.y],
        [places.r2.x, places.r2.y],
    ]);
}

// The time line: 0 to 100 seconds across 600 units.
const SCALE = 600 / 100;
const left = 60;
const xOf = (seconds: number) => left + seconds * SCALE;

const said = computed(() => {
    if (!cut.value) return undefined;

    const lost = noticed.value === 0 ? "almost nothing" : `${noticed.value.toFixed(noticed.value < 1 ? 1 : 0)} seconds of traffic`;
    const kind = noticed.value > 5 || ends.value === "link" ? "warn" : "good";

    return {
        kind,
        word: kind === "good" ? "Rerouted" : "Slow",
        text: `Traffic from R1 to R2 lost ${lost}, then took R1, R3, R2. ${sessionText.value}`,
    };
});
</script>

<template>
    <div class="failover-clock">
        <div class="settings">
            <div class="ac-field">
                <span>The link between R1 and R2</span>
                <div class="ac-row" role="group" aria-label="The link between R1 and R2">
                    <button type="button" class="ac-button small" :aria-pressed="build === 'cable'" @click="build = 'cable'">
                        A cable straight between them
                    </button>
                    <button type="button" class="ac-button small" :aria-pressed="build === 'switch'" @click="build = 'switch'">
                        Through a switch
                    </button>
                </div>
            </div>
            <div class="ac-field">
                <span>BFD on the OSPF interfaces</span>
                <div class="ac-row" role="group" aria-label="BFD on the OSPF interfaces">
                    <button type="button" class="ac-button small" :aria-pressed="!bfd" @click="bfd = false">Off</button>
                    <button type="button" class="ac-button small" :aria-pressed="bfd" @click="bfd = true">On</button>
                </div>
            </div>
            <div class="ac-field">
                <span>The iBGP session runs between</span>
                <div class="ac-row" role="group" aria-label="The iBGP session runs between">
                    <button type="button" class="ac-button small" :aria-pressed="ends === 'loopbacks'" @click="ends = 'loopbacks'">
                        The loopbacks
                    </button>
                    <button type="button" class="ac-button small" :aria-pressed="ends === 'link'" @click="ends = 'link'">
                        The link's own addresses
                    </button>
                </div>
            </div>
        </div>

        <svg
            class="ac-drawing"
            viewBox="0 0 700 270"
            role="img"
            :aria-label="`R1 and R2 joined by a link of cost 10${build === 'switch' ? ' through a switch' : ''}, and by a longer way through R3. ${cut ? (build === 'switch' ? 'The switch has stopped passing traffic.' : 'The cable is cut.') : ''}`"
        >
            <template v-if="build === 'switch'">
                <line class="cable" :class="{ lit: !cut, cut }" :x1="places.r1.x" :y1="places.r1.y" :x2="places.sw.x" :y2="places.sw.y" />
                <line class="cable" :class="{ lit: !cut, cut }" :x1="places.sw.x" :y1="places.sw.y" :x2="places.r2.x" :y2="places.r2.y" />
            </template>
            <line
                v-else
                class="cable"
                :class="{ lit: !cut, cut }"
                :x1="places.r1.x"
                :y1="places.r1.y"
                :x2="places.r2.x"
                :y2="places.r2.y"
            />
            <line class="cable" :class="{ lit: cut }" :x1="places.r1.x" :y1="places.r1.y" :x2="places.r3.x" :y2="places.r3.y" />
            <line class="cable" :class="{ lit: cut }" :x1="places.r3.x" :y1="places.r3.y" :x2="places.r2.x" :y2="places.r2.y" />

            <text x="230" y="58" text-anchor="middle" class="cost">cost 10</text>
            <text x="205" y="150" text-anchor="middle" class="cost">cost 20</text>
            <text x="495" y="150" text-anchor="middle" class="cost">cost 20</text>
            <text v-if="cut && build === 'cable'" x="350" y="58" text-anchor="middle" class="cut-mark">cut</text>

            <SvgDevice kind="router" :x="places.r1.x" :y="places.r1.y" label="R1" note="lo 10.255.0.1" />
            <SvgDevice kind="router" :x="places.r2.x" :y="places.r2.y" label="R2" note="lo 10.255.0.2" />
            <SvgDevice kind="router" :x="places.r3.x" :y="places.r3.y" label="R3" note="lo 10.255.0.3" />
            <SvgDevice
                v-if="build === 'switch'"
                kind="switch"
                :x="places.sw.x"
                :y="places.sw.y"
                label="Switch"
                :note="cut ? 'stopped, ports up' : undefined"
                :dim="cut"
            />

            <circle v-if="travelling" class="packet" :cx="position[0]" :cy="position[1]" r="9" />
        </svg>

        <div class="ac-row">
            <button type="button" class="ac-button primary" :disabled="travelling" @click="toggleCut">
                {{ cut ? "Repair the link" : build === "switch" ? "Make the switch fail" : "Cut the cable" }}
            </button>
        </div>

        <p v-if="said" class="ac-say" :class="said.kind" :data-word="said.word" aria-live="polite">{{ said.text }}</p>
        <p v-else class="ac-say hint" aria-live="polite">
            Make the switch fail with BFD off, then turn BFD on and try again. Then try a cable straight between the routers, and a session
            between the link's own addresses.
        </p>

        <svg
            v-if="cut"
            class="ac-drawing timeline"
            viewBox="0 0 700 150"
            role="img"
            :aria-label="`A time line from 0 to 100 seconds. Traffic is lost until ${noticed.toFixed(1)} seconds. ${ends === 'link' ? `The iBGP session goes down by ${HOLD_TIME} seconds.` : 'The iBGP session stays up.'}`"
        >
            <text x="0" y="34" class="row">Traffic</text>
            <rect v-if="noticed > 0" class="lost" :x="xOf(0)" y="22" :width="Math.max(noticed * SCALE, 3)" height="18" />
            <rect
                class="moved"
                :x="xOf(noticed) + (noticed > 0 ? 3 : 0)"
                y="22"
                :width="xOf(100) - xOf(noticed) - (noticed > 0 ? 3 : 0)"
                height="18"
            />
            <text :x="xOf(noticed) + 8" y="56" class="mark">
                {{ noticed === 0 ? "rerouted at once" : `lost until ${noticed.toFixed(noticed < 1 ? 1 : 0)} s, then through R3` }}
            </text>

            <text x="0" y="88" class="row">iBGP</text>
            <rect v-if="ends === 'loopbacks'" class="moved" :x="xOf(0)" y="76" :width="xOf(100) - xOf(0)" height="18" />
            <template v-else>
                <rect class="moved" :x="xOf(0)" y="76" :width="HOLD_TIME * SCALE" height="18" />
                <rect class="lost" :x="xOf(HOLD_TIME) + 3" y="76" :width="xOf(100) - xOf(HOLD_TIME) - 3" height="18" />
            </template>
            <text
                :x="ends === 'loopbacks' ? xOf(0) + 8 : xOf(HOLD_TIME) - 8"
                y="110"
                class="mark"
                :text-anchor="ends === 'loopbacks' ? 'start' : 'end'"
            >
                {{ ends === "loopbacks" ? "stays up" : `down by ${HOLD_TIME} s, routes withdrawn` }}
            </text>

            <line :x1="xOf(0)" y1="124" :x2="xOf(100)" y2="124" class="axis" />
            <g v-for="tick in [0, 20, 40, 60, 80, 100]" :key="tick">
                <line :x1="xOf(tick)" y1="120" :x2="xOf(tick)" y2="128" class="axis" />
                <text :x="xOf(tick)" y="144" text-anchor="middle" class="tick">{{ tick }} s</text>
            </g>
        </svg>
        <p v-if="cut" class="how">{{ howNoticed }}</p>
    </div>
</template>

<style scoped>
.settings {
    display: grid;
    gap: 12px;
    margin-bottom: 8px;
}

.cable.cut {
    stroke: var(--circuit-removed);
    stroke-dasharray: 8 6;
}

.ac-drawing .cost {
    fill: var(--circuit-soft);
    font-family: var(--circuit-mono);
    font-size: 12px;
}

.ac-drawing .cut-mark {
    fill: var(--circuit-removed);
    font-size: 13px;
    font-weight: 700;
}

.timeline {
    margin-top: 14px;
}

.ac-drawing .row {
    font-size: 12px;
    font-weight: 700;
}

.ac-drawing .mark,
.ac-drawing .tick {
    fill: var(--circuit-soft);
    font-size: 12px;
}

.lost {
    fill: var(--circuit-removed);
}

.moved {
    fill: var(--circuit-link);
    opacity: 0.55;
}

.axis {
    stroke: var(--circuit-ink);
    stroke-width: 1.5;
}

.how {
    margin: 6px 0 0;
    color: var(--circuit-soft);
    font-size: 14.5px;
}

.hint {
    color: var(--circuit-soft);
}
</style>
