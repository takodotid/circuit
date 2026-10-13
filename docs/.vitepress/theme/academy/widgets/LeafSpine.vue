<script setup lang="ts">
// Lesson: roles in a network. The reader builds a leaf-spine fabric, sends flows between racks and watches them spread over the spines, then fails a spine and sees what is left.

import { computed, ref, watch } from "vue";
import { useTravel } from "../travel";

const spineCount = ref(2);
const leafCount = ref(4);
const failed = ref<number[]>([]);

const from = ref(1);
const to = ref(3);
const flows = ref(0);
const lastSpine = ref<number>();

const said = ref<{ kind: "good" | "bad" | "warn"; word?: string; text: string }>();
const { position, travelling, travel } = useTravel(320);

// Fewer spines or leaves than before: forget what no longer exists.
watch([spineCount, leafCount], () => {
    failed.value = failed.value.filter((spine) => spine <= spineCount.value);
    if (from.value > leafCount.value) from.value = 1;
    if (to.value > leafCount.value) to.value = Math.min(2, leafCount.value);
    lastSpine.value = undefined;
    said.value = undefined;
});

const spines = computed(() =>
    Array.from({ length: spineCount.value }, (_, index) => ({
        number: index + 1,
        x: 350 + (index - (spineCount.value - 1) / 2) * 160,
        y: 60,
    }))
);

const leaves = computed(() =>
    Array.from({ length: leafCount.value }, (_, index) => ({
        number: index + 1,
        x: 350 + (index - (leafCount.value - 1) / 2) * 112,
        y: 220,
    }))
);

const alive = computed(() => spines.value.filter((spine) => !failed.value.includes(spine.number)));

const cables = computed(() =>
    leaves.value.flatMap((leaf) =>
        spines.value.map((spine) => ({
            key: `${leaf.number}-${spine.number}`,
            leaf,
            spine,
            down: failed.value.includes(spine.number),
            lit: lastSpine.value === spine.number && (leaf.number === from.value || leaf.number === to.value),
        }))
    )
);

function toggleSpine(number: number) {
    failed.value = failed.value.includes(number) ? failed.value.filter((spine) => spine !== number) : [...failed.value, number];
    lastSpine.value = undefined;

    const left = spineCount.value - failed.value.length;
    said.value = failed.value.includes(number)
        ? {
              kind: left ? "warn" : "bad",
              word: left ? "Spine down" : "Cut off",
              text: left
                  ? `spine-${number} is down. Every leaf still has ${left} way${left > 1 ? "s" : ""} up, and the racks can still reach each other, with ${percentLeft.value}% of the capacity between them.`
                  : "No spine is left, so no rack can reach another. Each leaf still serves its own rack.",
          }
        : { kind: "good", word: "Repaired", text: `spine-${number} is back, and the leaves share flows over it again.` };
}

const percentLeft = computed(() => Math.round((alive.value.length / spineCount.value) * 100));

async function send() {
    const start = leaves.value[from.value - 1]!;
    const end = leaves.value[to.value - 1]!;

    if (from.value === to.value) {
        lastSpine.value = undefined;
        said.value = {
            kind: "warn",
            word: "Same rack",
            text: "Both servers are in the same rack, so their leaf switch delivers the flow without sending it up. Pick two different racks.",
        };
        return;
    }

    if (!alive.value.length) {
        said.value = { kind: "bad", text: "Every spine is down, so the flow has no way from one rack to another." };
        return;
    }

    flows.value += 1;
    // Each flow is kept on one spine; different flows are spread over all of them.
    const spine = alive.value[(flows.value - 1) % alive.value.length]!;
    lastSpine.value = spine.number;
    said.value = undefined;

    await travel([
        [start.x, start.y],
        [spine.x, spine.y],
        [end.x, end.y],
    ]);

    said.value = {
        kind: "good",
        text: `Flow ${flows.value} went up from leaf-${from.value} to spine-${spine.number} and down to leaf-${to.value}: three switches, as between any two racks. ${alive.value.length > 1 ? `Send again: the next flow takes another of the ${alive.value.length} spines.` : "Only one spine is left, so every flow takes it."}`,
    };
}

const facts = computed(() => [
    { name: "Cables between leaves and spines", value: `${spineCount.value} x ${leafCount.value} = ${spineCount.value * leafCount.value}` },
    { name: "Ports each spine needs for leaves", value: `${leafCount.value}, one per leaf` },
    { name: "Uplinks each leaf needs", value: `${spineCount.value}, one per spine` },
    { name: "Equal paths between two racks", value: `${alive.value.length}` },
    { name: "Capacity left between racks", value: `${percentLeft.value}%` },
]);
</script>

<template>
    <div class="leaf-spine">
        <div class="ac-row pick">
            <label class="ac-field">
                <span>Spines</span>
                <select v-model.number="spineCount" class="ac-select">
                    <option v-for="count in [1, 2, 3, 4]" :key="count" :value="count">{{ count }}</option>
                </select>
            </label>
            <label class="ac-field">
                <span>Leaves, one per rack</span>
                <select v-model.number="leafCount" class="ac-select">
                    <option v-for="count in [2, 3, 4, 5, 6]" :key="count" :value="count">{{ count }}</option>
                </select>
            </label>
        </div>

        <svg
            class="ac-drawing"
            viewBox="0 0 700 290"
            role="img"
            :aria-label="`${spineCount} spine switches on top, ${leafCount} leaf switches below, each leaf joined to every spine. ${failed.length} spine${failed.length === 1 ? ' is' : 's are'} down.`"
        >
            <line
                v-for="cable in cables"
                :key="cable.key"
                class="cable"
                :class="{ lit: cable.lit, down: cable.down }"
                :x1="cable.leaf.x"
                :y1="cable.leaf.y"
                :x2="cable.spine.x"
                :y2="cable.spine.y"
            />
            <SvgDevice
                v-for="spine in spines"
                :key="`s${spine.number}`"
                kind="switch"
                :x="spine.x"
                :y="spine.y"
                :label="`spine-${spine.number}`"
                :note="failed.includes(spine.number) ? 'down' : undefined"
                :dim="failed.includes(spine.number)"
                :lit="lastSpine === spine.number"
            />
            <SvgDevice
                v-for="leaf in leaves"
                :key="`l${leaf.number}`"
                kind="switch"
                :x="leaf.x"
                :y="leaf.y"
                :label="`leaf-${leaf.number}`"
                :note="`rack ${leaf.number}`"
                :lit="leaf.number === from || leaf.number === to"
            />
            <circle v-if="travelling" class="packet" :cx="position[0]" :cy="position[1]" r="9" />
        </svg>

        <div class="controls">
            <div class="ac-row send">
                <label class="ac-field">
                    <span>Send a flow from</span>
                    <select v-model.number="from" class="ac-select">
                        <option v-for="leaf in leaves" :key="leaf.number" :value="leaf.number">rack {{ leaf.number }}</option>
                    </select>
                </label>
                <label class="ac-field">
                    <span>to</span>
                    <select v-model.number="to" class="ac-select">
                        <option v-for="leaf in leaves" :key="leaf.number" :value="leaf.number">rack {{ leaf.number }}</option>
                    </select>
                </label>
                <button type="button" class="ac-button primary" :disabled="travelling" @click="send">Send a flow</button>
            </div>

            <div class="ac-field">
                <span>Fail or repair a spine</span>
                <div class="ac-row">
                    <button
                        v-for="spine in spines"
                        :key="spine.number"
                        type="button"
                        class="ac-button small"
                        :aria-pressed="failed.includes(spine.number)"
                        @click="toggleSpine(spine.number)"
                    >
                        {{ failed.includes(spine.number) ? `Repair spine-${spine.number}` : `Fail spine-${spine.number}` }}
                    </button>
                </div>
            </div>
        </div>

        <p v-if="said" class="ac-say" :class="said.kind" :data-word="said.word" aria-live="polite">{{ said.text }}</p>
        <p v-else class="ac-say hint" aria-live="polite">Send a flow from rack 1 to rack 3, then send another. Then fail a spine.</p>

        <div class="frame">
            <table class="ac-table">
                <tbody>
                    <tr v-for="fact in facts" :key="fact.name">
                        <td>{{ fact.name }}</td>
                        <td class="ac-mono">{{ fact.value }}</td>
                    </tr>
                </tbody>
            </table>
        </div>
    </div>
</template>

<style scoped>
.pick,
.send {
    align-items: end;
}

.pick {
    margin-bottom: 8px;
}

.cable.down {
    stroke-dasharray: 4 6;
    opacity: 0.4;
}

.controls {
    display: grid;
    gap: 14px;
    margin-top: 10px;
}

.hint {
    color: var(--circuit-soft);
}

.frame {
    overflow-x: auto;
}
</style>
