<!-- What `circuit validate` finds, errors first, and what only one end declares: cables and BGP sessions with nothing back. -->
<script setup lang="ts">
import { computed } from "vue";
import type { StudioData } from "../../../types";
import { go } from "../lib/store";

const props = defineProps<{ data: StudioData }>();

const findings = computed(() => [...props.data.findings].sort((a, b) => (a.level === b.level ? 0 : a.level === "error" ? -1 : 1)));
const oneSidedCables = computed(() => props.data.cables.filter((cable) => cable.oneSided));
const oneSidedSessions = computed(() => props.data.sessions.filter((session) => session.oneSided));
</script>

<template>
    <h2>Problems</h2>
    <h3>Found by <code>circuit validate</code></h3>
    <p v-if="!findings.length" class="muted">Nothing: every device validates.</p>
    <ul v-else class="findings">
        <li v-for="(finding, index) in findings" :key="index">
            <span :class="['badge', finding.level]">{{ finding.level }}</span>
            <a v-if="finding.device" @click="go(`devices/${finding.device}`)">{{ finding.device }}</a
            ><template v-if="finding.device">: </template>{{ finding.message }}
        </li>
    </ul>

    <h3>Declared at one end only</h3>
    <p v-if="!oneSidedCables.length && !oneSidedSessions.length" class="muted">
        Every cable and BGP session between devices is declared at both ends.
    </p>
    <ul v-else class="findings">
        <li v-for="cable in oneSidedCables" :key="`${cable.device} ${cable.port}`">
            <span class="badge warning">cable</span>
            <a @click="go(`devices/${cable.device}`)">{{ cable.device }}</a> {{ cable.port }} links to {{ cable.farDevice }}
            {{ cable.farPort }}, which does not link back
        </li>
        <li v-for="session in oneSidedSessions" :key="`${session.device} ${session.name}`">
            <span class="badge warning">BGP</span>
            <a @click="go(`devices/${session.device}`)">{{ session.device }}</a> {{ session.name }} reaches {{ session.far }}, which has no
            session back
        </li>
    </ul>
</template>
