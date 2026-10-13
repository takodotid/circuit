<script setup lang="ts">
// Lesson: choosing a device. The reader states what a device must do, how many routes, how much traffic and whether it tracks connections, and sees the kind of device that fits, why, and how many packets a second that is.

import { computed, ref } from "vue";

type Routes = "few" | "thousands" | "full";
type Work = "forward" | "track";

const routes = ref<Routes>();
const gigabits = ref<number>();
const work = ref<Work>();
const frameBytes = ref(64);

const routeChoices: { id: Routes; label: string }[] = [
    { id: "few", label: "A default route and our own, a few hundred" },
    { id: "thousands", label: "Our own and our customers', a few thousand" },
    { id: "full", label: "The full table from a transit provider" },
];

const trafficChoices = [
    { gigabits: 1, label: "Up to 1 Gbit/s" },
    { gigabits: 10, label: "Up to 10 Gbit/s" },
    { gigabits: 100, label: "Up to 100 Gbit/s" },
    { gigabits: 400, label: "Several hundred Gbit/s" },
];

const workChoices: { id: Work; label: string }[] = [
    { id: "forward", label: "Forward, and filter by address" },
    { id: "track", label: "Track every connection: a stateful firewall or NAT for all of it" },
];

/** Packets a second at the chosen rate and frame size. Each frame also takes 20 bytes of preamble and gap on the wire. */
const packetsPerSecond = computed(() => (gigabits.value ? (gigabits.value * 1e9) / ((frameBytes.value + 20) * 8) : 0));

function millions(count: number): string {
    const value = count / 1e6;
    return value >= 10 ? value.toFixed(0) : value.toFixed(2);
}

type Verdict = { kind: "good" | "warn"; word: string; title: string; reasons: string[] };

const verdict = computed<Verdict | undefined>(() => {
    if (!routes.value || !gigabits.value || !work.value) return undefined;

    const fast = gigabits.value >= 100;
    const rate = `about ${millions(packetsPerSecond.value)} million packets a second at this frame size`;

    if (work.value === "track") {
        const tracking =
            "Tracking connections means keeping a record of every conversation and checking each packet against it, which is CPU work. On the CCR2216 in Circuit's examples, traffic routed in the switch chip skips the firewall, and the chip holds only a few thousand tracked connections.";

        if (fast)
            return {
                kind: "warn",
                word: "Split the job",
                title: "Split the job between devices",
                reasons: [
                    tracking,
                    `${gigabits.value} Gbit/s is ${rate}, all of it through a CPU. Forward in a chip where most traffic passes, and track connections only for the traffic that needs it, on a CPU router or a firewall of its own.`,
                    "The full-setup example does a small version of this: its edge routers forward in the chip, but keep the exchange interface on the CPU with hardware_offload: false, which is what makes the firewall apply to it.",
                ],
            };

        return {
            kind: "good",
            word: "Fits",
            title: "A router that forwards on its CPU, or an x86 server running router software",
            reasons: [
                tracking,
                `${gigabits.value} Gbit/s is ${rate}. Check the router's figure in packets a second at small frames, not only its bits a second.`,
                ...(routes.value === "full"
                    ? [
                          "On a CPU the routes live in the router's main memory, not in a chip's small, fast table, so the full table is not what limits it.",
                      ]
                    : []),
            ],
        };
    }

    if (routes.value === "full") {
        if (!fast)
            return {
                kind: "good",
                word: "Fits",
                title: "A router that forwards on its CPU, or an x86 server running router software",
                reasons: [
                    "On a CPU the routes live in the router's main memory, not in a chip's small, fast table, so over a million IPv4 routes and a quarter of a million IPv6 are not what limits it.",
                    `${gigabits.value} Gbit/s is ${rate}. That figure, at small frames, is the one to check.`,
                    "To forward this in a chip instead, the chip itself would have to hold the full table.",
                ],
            };

        return {
            kind: "warn",
            word: "Big table",
            title: "A router whose chip holds the full table, with room to grow",
            reasons: [
                `${gigabits.value} Gbit/s is ${rate}. A router reaches that by forwarding in its chip.`,
                "Then the chip must hold over a million IPv4 routes and a quarter of a million IPv6, and the table grows every year. Read the figure for each family on the datasheet, and leave room.",
                "The CCR2216 in Circuit's examples holds up to 120,000 IPv4 routes in its switch chip, so a full table does not fit there: it routes the longer prefixes in the chip and the rest on its CPU.",
                "The other way out: take only a default route from the transit, or a default and the few routes you care about, and a smaller table will do.",
            ],
        };
    }

    if (gigabits.value <= 1)
        return {
            kind: "good",
            word: "Fits",
            title: "A small router that forwards on its CPU",
            reasons: [
                "A small table and 1 Gbit/s is the light end of the scale. Choose by ports, power and what you know how to run.",
                `1 Gbit/s is ${rate}, which is the figure to check.`,
            ],
        };

    return {
        kind: "good",
        word: "Fits",
        title: "A switch or router that forwards in its chip",
        reasons: [
            `${gigabits.value} Gbit/s is ${rate}: work for a chip.`,
            routes.value === "few"
                ? "A few hundred routes ask little of a chip's table, so a switch that also routes, often called a layer 3 switch, is usually enough. Check its route figure on the datasheet all the same."
                : "Check the chip's route figure on the datasheet. The CCR2216's chip holds up to 120,000 IPv4 routes, far more than a few thousand.",
            "Filters that only look at addresses and ports can run in the chip as an ACL, as the edge routers in the examples do with acls.",
        ],
    };
});
</script>

<template>
    <div class="device-class">
        <div class="questions">
            <fieldset>
                <legend>1. Routes it must hold</legend>
                <div class="ac-row">
                    <button
                        v-for="choice in routeChoices"
                        :key="choice.id"
                        type="button"
                        class="ac-button small"
                        :aria-pressed="routes === choice.id"
                        @click="routes = choice.id"
                    >
                        {{ choice.label }}
                    </button>
                </div>
            </fieldset>

            <fieldset>
                <legend>2. Traffic through it</legend>
                <div class="ac-row">
                    <button
                        v-for="choice in trafficChoices"
                        :key="choice.gigabits"
                        type="button"
                        class="ac-button small"
                        :aria-pressed="gigabits === choice.gigabits"
                        @click="gigabits = choice.gigabits"
                    >
                        {{ choice.label }}
                    </button>
                </div>
            </fieldset>

            <fieldset>
                <legend>3. What it does to each packet</legend>
                <div class="ac-row">
                    <button
                        v-for="choice in workChoices"
                        :key="choice.id"
                        type="button"
                        class="ac-button small wrap"
                        :aria-pressed="work === choice.id"
                        @click="work = choice.id"
                    >
                        {{ choice.label }}
                    </button>
                </div>
            </fieldset>

            <label class="ac-field size">
                <span>Frame size, for packets a second</span>
                <select v-model.number="frameBytes" class="ac-select">
                    <option :value="64">64 bytes, the smallest</option>
                    <option :value="512">512 bytes</option>
                    <option :value="1518">1,518 bytes, a full 1,500-byte packet</option>
                </select>
            </label>
        </div>

        <div v-if="verdict" class="verdict" aria-live="polite">
            <p class="ac-say" :class="verdict.kind" :data-word="verdict.word">{{ verdict.title }}</p>
            <ul>
                <li v-for="reason in verdict.reasons" :key="reason">{{ reason }}</li>
            </ul>
        </div>
        <p v-else class="ac-say hint" aria-live="polite">Answer the three questions to see the kind of device that fits.</p>
    </div>
</template>

<style scoped>
.questions {
    display: grid;
    gap: 14px;
}

fieldset {
    margin: 0;
    padding: 0;
    border: 0;
    min-width: 0;
}

legend {
    margin-bottom: 6px;
    padding: 0;
    color: var(--circuit-soft);
    font-size: 13px;
    font-weight: 600;
}

.ac-button.wrap {
    white-space: normal;
    text-align: left;
}

.size {
    justify-self: start;
}

.verdict {
    margin-top: 6px;
    padding-top: 2px;
}

.verdict .ac-say {
    font-weight: 700;
}

.verdict ul {
    margin: 8px 0 0 !important;
}

.verdict li {
    font-size: 15px;
    line-height: 1.55;
}

.hint {
    color: var(--circuit-soft);
}
</style>
