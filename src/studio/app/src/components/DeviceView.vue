<!-- One device: what validate finds on it, each group of its settings, what it would run, what it runs now when asked, and the commits that changed its file. -->
<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { Device } from "../../../../model";
import type { Commit, LiveRead, StudioData } from "../../../types";
import { Format } from "../lib/format";
import { api, go, store } from "../lib/store";
import DataTable, { type Row } from "./DataTable.vue";
import Faceplate from "./Faceplate.vue";
import LineDiff from "./LineDiff.vue";
import Settings from "./Settings.vue";

const props = defineProps<{ data: StudioData; name: string }>();

const device = computed<Device | undefined>(() => props.data.devices.find((candidate) => candidate.name === props.name));
const findings = computed(() => props.data.findings.filter((finding) => finding.device === props.name));
const errors = computed(() => findings.value.filter((finding) => finding.level === "error").length);

/** A section shows when the device has anything in it. */
const SECTIONS = [
    { id: "overview", title: "Overview", has: () => true },
    { id: "ports", title: "Ports", has: () => true },
    { id: "interfaces", title: "Interfaces", has: (d: Device) => Object.keys(d.interfaces ?? {}).some((kind) => kind !== "ethernet") },
    { id: "switching", title: "Switching", has: (d: Device) => Boolean(d.switching) },
    { id: "routing", title: "Routing", has: (d: Device) => Boolean(d.routing) },
    { id: "firewall", title: "Firewall", has: (d: Device) => Boolean(d.firewall) },
    { id: "management", title: "Management", has: (d: Device) => Boolean(d.management) },
    { id: "system", title: "System", has: (d: Device) => Boolean(d.system) },
    { id: "monitoring", title: "Monitoring", has: (d: Device) => Boolean(d.monitoring) },
    { id: "services", title: "Services", has: (d: Device) => Boolean(d.services) },
    { id: "config", title: "Config", has: () => true },
    { id: "now", title: "On the device now", has: () => true },
    { id: "history", title: "History", has: () => true },
] as const;

const sections = computed(() => (device.value ? SECTIONS.filter((section) => section.has(device.value!)) : []));
const section = computed(() => store.route.parts[1] ?? "overview");

const ports = computed<Row[]>(() => {
    const own = device.value;
    if (!own) return [];

    const declared = Object.entries(own.interfaces?.ethernet ?? {});
    const all = props.data.ports[own.name]?.length ? props.data.ports[own.name]! : declared.map(([name]) => name);

    return all.map((name) => {
        const port = own.interfaces?.ethernet?.[name];
        if (!port) return { id: `port-${name}`, muted: true, cells: [name, "shut down", "", "", "", ""] };

        const lag = port.in_lag ? own.interfaces?.lag?.[port.in_lag] : undefined;
        const carrier = lag ?? port;
        const switching = carrier.access_vlan
            ? `access ${carrier.access_vlan}`
            : carrier.trunk_vlans
              ? `trunk ${carrier.trunk_vlans.join(", ")}${carrier.native_vlan ? `, native ${carrier.native_vlan}` : ""}`
              : "";
        const { description, addresses, link, in_lag, access_vlan, trunk_vlans, native_vlan, ...rest } = port;

        return {
            id: `port-${name}`,
            cells: [
                name,
                description ?? "",
                [switching, in_lag ? `in LAG ${in_lag}` : ""].filter(Boolean).join(", "),
                Format.compact(addresses),
                link ? { device: link.device, label: `${link.device} ${link.port}${link.through ? `, through ${link.through}` : ""}` } : "",
                Format.compact(rest),
            ],
        };
    });
});

const interfaces = computed(() => {
    const { ethernet: _ethernet, ...rest } = device.value?.interfaces ?? {};
    return rest;
});

// Reading the device reaches it, so it happens only when asked, and nothing is kept.
const live = ref<LiveRead>();
const reading = ref(false);
const readError = ref("");

async function readNow(): Promise<void> {
    reading.value = true;
    readError.value = "";
    try {
        live.value = await api<LiveRead>(`/api/read?device=${encodeURIComponent(props.name)}`, true);
    } catch (error) {
        readError.value = (error as Error).message;
    } finally {
        reading.value = false;
    }
}

const commands = computed(() => live.value?.steps.reduce((count, step) => count + step.show.length, 0) ?? 0);

const history = ref<Commit[]>();
const historyError = ref("");
watch(
    section,
    async (id) => {
        if (id !== "history" || history.value) return;
        try {
            history.value = await api<Commit[]>(`/api/history?device=${encodeURIComponent(props.name)}`);
        } catch (error) {
            historyError.value = (error as Error).message;
        }
    },
    { immediate: true }
);
</script>

<template>
    <div class="tables">
        <p class="crumbs"><a @click="go('devices')">Devices</a> /</p>
        <p v-if="!device" class="muted">No device {{ name }} in the project.</p>
        <template v-else>
            <h2>
                {{ device.name }}
                <span v-if="errors" class="badge error">{{ Format.count(errors, "error") }}</span>
                <span v-if="findings.length - errors" class="badge warning">{{ Format.count(findings.length - errors, "warning") }}</span>
            </h2>
            <p class="muted">
                {{ device.platform }} {{ device.model }} at {{ device.site }} · <code>{{ data.files[device.name] }}</code>
            </p>

            <div class="tabs">
                <button
                    v-for="item in sections"
                    :key="item.id"
                    :aria-pressed="section === item.id"
                    @click="go(`devices/${device.name}/${item.id}`)"
                >
                    {{ item.title }}
                </button>
            </div>

            <template v-if="section === 'overview'">
                <template v-if="findings.length">
                    <h3>Found by <code>circuit validate</code></h3>
                    <ul class="findings">
                        <li v-for="(finding, index) in findings" :key="index">
                            <span :class="['badge', finding.level]">{{ finding.level }}</span
                            >{{ finding.message }}
                        </li>
                    </ul>
                </template>
                <h3>Device</h3>
                <Settings
                    :value="{
                        name: device.name,
                        site: device.site,
                        role: device.role,
                        platform: device.platform,
                        model: device.model,
                        connection: device.connection,
                    }"
                />
            </template>

            <template v-else-if="section === 'ports'">
                <Faceplate :device="device" :ports="data.ports[device.name] ?? []" />
                <DataTable
                    :head="['Port', 'Description', 'Switching', 'Addresses', 'Link', 'Other settings']"
                    :rows="ports"
                    :csv="`${device.name}-ports`"
                />
            </template>

            <Settings v-else-if="section === 'interfaces'" :value="interfaces" />
            <Settings v-else-if="section === 'switching'" :value="device.switching" />
            <Settings v-else-if="section === 'routing'" :value="device.routing" />
            <Settings v-else-if="section === 'firewall'" :value="device.firewall" />
            <Settings v-else-if="section === 'management'" :value="device.management" />
            <Settings v-else-if="section === 'system'" :value="device.system" />
            <Settings v-else-if="section === 'monitoring'" :value="device.monitoring" />
            <Settings v-else-if="section === 'services'" :value="device.services" />

            <template v-else-if="section === 'config'">
                <p class="muted">
                    What the device should run, as Circuit writes it for {{ device.platform }}. A secret shows as its name, never its value.
                </p>
                <pre class="code">{{ data.rendered[device.name] }}</pre>
            </template>

            <template v-else-if="section === 'now'">
                <p class="muted">
                    Circuit reads the device now, the same way <code>circuit diff</code> does, and shows what
                    <code>circuit apply</code> would send. Nothing is kept: read it again to see it again.
                </p>
                <p>
                    <button class="primary" :disabled="reading" @click="readNow">
                        {{ reading ? "Reading the device…" : "Read from the device now" }}
                    </button>
                </p>
                <p v-if="readError" class="verdict reject">{{ readError }}</p>
                <template v-if="live">
                    <p class="muted">Read at {{ new Date(live.readAt).toLocaleString() }}.</p>
                    <h3>What apply would send</h3>
                    <p v-if="!commands && !live.problems.length" class="verdict accept">
                        The device already runs its config. Nothing to change.
                    </p>
                    <template v-for="step in live.steps" :key="step.title">
                        <h4>{{ step.title }}</h4>
                        <pre class="code">{{ step.show.join("\n") }}</pre>
                    </template>
                    <ul v-if="live.problems.length" class="findings">
                        <li v-for="problem in live.problems" :key="problem"><span class="badge error">problem</span>{{ problem }}</li>
                    </ul>
                    <h3>What it runs, against the project</h3>
                    <LineDiff :before="live.running" :after="live.rendered" />
                </template>
            </template>

            <template v-else-if="section === 'history'">
                <p v-if="historyError" class="muted">{{ historyError }}</p>
                <p v-else-if="!history" class="muted">Reading the history…</p>
                <p v-else-if="!history.length" class="muted">No commit changed {{ data.files[device.name] }} yet.</p>
                <DataTable
                    v-else
                    :head="['Commit', 'When', 'Who', 'What', '']"
                    :rows="
                        history.map((commit) => ({
                            cells: [
                                commit.short,
                                new Date(commit.date).toLocaleString(),
                                commit.author,
                                commit.subject,
                                { link: `compare/${commit.commit}`, label: 'compare with now' },
                            ],
                        }))
                    "
                />
            </template>
        </template>
    </div>
</template>
