<script setup lang="ts">
// Lesson: BGP inside a network. The reader sets how many routers an AS has, draws its iBGP sessions as a full mesh or with route reflectors, adds a router, and fails a reflector.

import { computed, ref, watch } from "vue";
import { IbgpSessions } from "./ReflectorCount";

type Design = 0 | 1 | 2;

const routers = ref(6);
const reflectors = ref<Design>(0);
const reflectorDown = ref(false);
const said = ref<{ kind: "good" | "bad" | "warn"; word?: string; text: string }>();

const MAX = 12;

watch(reflectors, () => {
    reflectorDown.value = false;
    said.value = undefined;
});

watch(routers, () => {
    said.value = undefined;
});

const isReflector = (number: number) => number <= reflectors.value;

const nameOf = (number: number) => (isReflector(number) ? `RR${number}` : `R${number - reflectors.value}`);

/** Where each router is drawn: reflectors in the middle, every other router on a circle around them. */
const places = computed(() => {
    const clients = routers.value - reflectors.value;

    return Array.from({ length: routers.value }, (_, index) => {
        const number = index + 1;

        if (isReflector(number)) {
            const x = reflectors.value === 1 ? 350 : number === 1 ? 290 : 410;
            return { number, x, y: 200 };
        }

        const turn = (index - reflectors.value) / clients;
        const angle = -Math.PI / 2 + turn * 2 * Math.PI;
        return { number, x: 350 + Math.cos(angle) * 270, y: 200 + Math.sin(angle) * 150 };
    });
});

const at = (number: number) => places.value[number - 1]!;

const lines = computed(() =>
    IbgpSessions.pairs(routers.value, reflectors.value).map(([a, b]) => ({
        key: `${a}-${b}`,
        a: at(a),
        b: at(b),
        down: reflectorDown.value && (a === 1 || b === 1),
    }))
);

const count = computed(() => lines.value.length);

const formula = computed(() => {
    const n = routers.value;
    const k = reflectors.value;

    if (k === 0) return `${n} x ${n - 1} / 2 = ${IbgpSessions.fullMesh(n)}`;

    const clients = n - k;
    return k === 1
        ? `${clients} clients x 1 reflector = ${IbgpSessions.withReflectors(n, k)}`
        : `${clients} clients x 2 reflectors + 1 between the reflectors = ${IbgpSessions.withReflectors(n, k)}`;
});

function addRouter() {
    if (routers.value >= MAX) {
        said.value = { kind: "warn", word: "Full", text: `The drawing stops at ${MAX} routers. The table below goes further.` };
        return;
    }

    routers.value += 1;
    const n = routers.value;
    const k = reflectors.value;

    said.value =
        k === 0
            ? {
                  kind: "warn",
                  word: "Every file",
                  text: `The new router needs ${n - 1} sessions, and each of the ${n - 1} routers already there needs one more: ${n} device files change. The network now has ${IbgpSessions.fullMesh(n)} sessions.`,
              }
            : {
                  kind: "good",
                  word: `${k + 1} files`,
                  text: `The new router needs ${k} session${k > 1 ? "s" : ""}, one to each reflector, and only the reflector${k > 1 ? "s" : ""} gain one: ${k + 1} device files change. The network now has ${IbgpSessions.withReflectors(n, k)} sessions.`,
              };
}

function removeRouter() {
    if (routers.value > 3) routers.value -= 1;
}

function toggleReflector() {
    reflectorDown.value = !reflectorDown.value;

    if (!reflectorDown.value) {
        said.value = { kind: "good", word: "Back", text: "RR1 is back, and its clients hear each other's routes through it again." };
        return;
    }

    said.value =
        reflectors.value === 1
            ? {
                  kind: "bad",
                  word: "Cut off",
                  text: "RR1 was the only way routes passed between the clients. Now each router knows only what it learns itself from outside: one reflector is a single point of failure.",
              }
            : {
                  kind: "good",
                  word: "Still up",
                  text: "Every client still has a session with RR2, which reflects every route on its own. This is why reflectors come in pairs.",
              };
}

const growth = computed(() =>
    [...new Set([routers.value, 20, 50, 200])].map((n) => ({
        n,
        full: IbgpSessions.fullMesh(n),
        reflected: IbgpSessions.withReflectors(n, 2),
    }))
);

const designs: { value: Design; label: string }[] = [
    { value: 0, label: "Full mesh" },
    { value: 1, label: "One route reflector" },
    { value: 2, label: "Two route reflectors" },
];
</script>

<template>
    <div class="reflector-count">
        <div class="ac-row" role="group" aria-label="How the sessions are laid out">
            <button
                v-for="design in designs"
                :key="design.value"
                type="button"
                class="ac-button small"
                :aria-pressed="reflectors === design.value"
                @click="reflectors = design.value"
            >
                {{ design.label }}
            </button>
        </div>

        <svg
            class="ac-drawing"
            viewBox="0 0 700 420"
            role="img"
            :aria-label="`${routers} routers of one AS with ${count} iBGP sessions between them, ${reflectors ? `${reflectors} of them route reflectors in the middle` : 'every router with a session to every other'}.`"
        >
            <line
                v-for="line in lines"
                :key="line.key"
                class="cable"
                :class="{ lit: !line.down && reflectors > 0, down: line.down }"
                :x1="line.a.x"
                :y1="line.a.y"
                :x2="line.b.x"
                :y2="line.b.y"
            />
            <SvgDevice
                v-for="place in places"
                :key="place.number"
                kind="router"
                :x="place.x"
                :y="place.y"
                :label="nameOf(place.number)"
                :note="place.number === 1 && reflectorDown ? 'down' : undefined"
                :lit="isReflector(place.number) && !(place.number === 1 && reflectorDown)"
                :dim="place.number === 1 && reflectorDown"
            />
        </svg>

        <div class="ac-row controls">
            <span class="count" aria-live="polite">
                <strong>{{ count }} sessions</strong> for {{ routers }} routers: <span class="ac-mono">{{ formula }}</span>
            </span>
        </div>

        <div class="ac-row controls">
            <button type="button" class="ac-button primary" @click="addRouter">Add a router</button>
            <button type="button" class="ac-button small" :disabled="routers <= 3" @click="removeRouter">Remove one</button>
            <button v-if="reflectors > 0" type="button" class="ac-button small" :aria-pressed="reflectorDown" @click="toggleReflector">
                {{ reflectorDown ? "Bring RR1 back" : "Fail RR1" }}
            </button>
        </div>

        <p v-if="said" class="ac-say" :class="said.kind" :data-word="said.word" aria-live="polite">{{ said.text }}</p>
        <p v-else class="ac-say hint" aria-live="polite">
            Add a router with a full mesh, then switch to two route reflectors and add one again.
        </p>

        <div class="frame">
            <table class="ac-table">
                <thead>
                    <tr>
                        <th>Routers</th>
                        <th>Full mesh</th>
                        <th>Two route reflectors</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="row in growth" :key="row.n" :class="{ lit: row.n === routers }">
                        <td>{{ row.n }}</td>
                        <td>{{ row.full.toLocaleString("en-US") }}</td>
                        <td>{{ row.reflected.toLocaleString("en-US") }}</td>
                    </tr>
                </tbody>
            </table>
        </div>
    </div>
</template>

<style scoped>
.cable.down {
    stroke: var(--circuit-removed);
    stroke-dasharray: 5 6;
    stroke-width: 2.5;
}

.controls {
    margin-top: 10px;
}

.count {
    font-size: 15.5px;
}

.hint {
    color: var(--circuit-soft);
}

.frame {
    overflow-x: auto;
}
</style>
