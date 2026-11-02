<script setup lang="ts">
// Lesson: networks of networks. The reader adds networks to an internet exchange and compares the sessions each one needs with and without a route server.

import { computed, ref } from "vue";

const count = ref(6);
const routeServer = ref(false);

const CENTRE = [350, 170] as const;
const RADIUS = 115;

const members = computed(() =>
    Array.from({ length: count.value }, (_, index) => {
        const angle = (index / count.value) * Math.PI * 2 - Math.PI / 2;
        return { as: `AS${64496 + index}`, x: CENTRE[0] + Math.cos(angle) * RADIUS * 1.8, y: CENTRE[1] + Math.sin(angle) * RADIUS };
    })
);

/** Every session: between each pair of members, or between each member and the route server. */
const sessions = computed(() => {
    if (routeServer.value) return members.value.map((member) => ({ x1: member.x, y1: member.y, x2: CENTRE[0], y2: CENTRE[1] }));

    return members.value.flatMap((member, index) =>
        members.value.slice(index + 1).map((other) => ({ x1: member.x, y1: member.y, x2: other.x, y2: other.y }))
    );
});

const each = computed(() => (routeServer.value ? 1 : count.value - 1));
const total = computed(() => sessions.value.length);

const said = computed(() =>
    routeServer.value
        ? `Each network keeps 1 session, with the route server: ${total.value} in all. A network that joins reaches every other member at once.`
        : `Each network keeps ${each.value} sessions, one with every other member: ${total.value} in all. A network that joins has to set up ${count.value} new sessions, each agreed with another network.`
);
</script>

<template>
    <div class="ix-sessions">
        <div class="ac-row controls">
            <label class="ac-field">
                <span>Networks at the exchange: {{ count }}</span>
                <input v-model.number="count" class="range" type="range" min="2" max="12" step="1" />
            </label>
            <button type="button" class="ac-button" :aria-pressed="routeServer" @click="routeServer = !routeServer">
                {{ routeServer ? "Route server: on" : "Route server: off" }}
            </button>
        </div>

        <svg
            class="ac-drawing"
            viewBox="0 0 700 340"
            role="img"
            :aria-label="`${count} networks at an exchange, with ${total} sessions drawn between them.`"
        >
            <rect class="lan" x="20" y="10" width="660" height="320" />
            <text class="lan-name" x="34" y="32">The exchange: one shared network</text>
            <line
                v-for="(session, index) in sessions"
                :key="index"
                class="session"
                :x1="session.x1"
                :y1="session.y1"
                :x2="session.x2"
                :y2="session.y2"
            />
            <SvgDevice v-if="routeServer" kind="server" :x="CENTRE[0]" :y="CENTRE[1]" label="Route server" lit />
            <SvgDevice v-for="member in members" :key="member.as" kind="router" :x="member.x" :y="member.y" :label="member.as" />
        </svg>

        <dl class="numbers">
            <div>
                <dt>Sessions each network keeps</dt>
                <dd>{{ each }}</dd>
            </div>
            <div>
                <dt>Sessions in all</dt>
                <dd>{{ total }}</dd>
            </div>
        </dl>

        <p class="ac-say" aria-live="polite">{{ said }}</p>
    </div>
</template>

<style scoped>
.controls {
    align-items: end;
    gap: 16px;
}

.range {
    width: min(260px, 70vw);
    min-height: 40px;
    accent-color: var(--circuit-cobalt);
}

.lan {
    fill: var(--circuit-mist);
    stroke: var(--circuit-line);
    stroke-width: 1.5;
}

.ac-drawing .lan-name {
    fill: var(--circuit-soft);
    font-size: 12px;
    font-weight: 700;
}

.session {
    stroke: var(--circuit-link);
    stroke-width: 1.5;
    opacity: 0.7;
}

.numbers {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 32px;
    margin: 10px 0 0;
}

.numbers dt {
    color: var(--circuit-soft);
    font-size: 13px;
    font-weight: 600;
}

.numbers dd {
    margin: 0;
    font-size: 28px;
    font-weight: 700;
}
</style>
