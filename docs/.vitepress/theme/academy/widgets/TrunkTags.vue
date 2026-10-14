<script setup lang="ts">
// Lesson: trunks. The reader chooses the VLANs each end of a trunk carries, sends frames between two switches and watches the tag appear on the trunk and go again, with each end's Circuit port and what `circuit validate` says.

import { computed, ref } from "vue";
import { useTravel, type Point } from "../travel";

type SwitchId = "switch-a" | "switch-b";

type Vlan = { name: string; id: number };

type Host = {
    id: string;
    on: SwitchId;
    kind: "laptop" | "desktop" | "access-point" | "camera" | "server";
    label: string;
    vlan: Vlan;
    x: number;
};

const vlans: Vlan[] = [
    { name: "home", id: 20 },
    { name: "guests", id: 30 },
    { name: "cameras", id: 40 },
];

const vlanNamed = (name: string) => vlans.find((vlan) => vlan.name === name)!;

const switches: Record<SwitchId, { label: string; x: number; y: number; far: SwitchId; farLabel: string }> = {
    "switch-a": { label: "switch-a", x: 160, y: 80, far: "switch-b", farLabel: "Switch B" },
    "switch-b": { label: "switch-b", x: 520, y: 80, far: "switch-a", farLabel: "Switch A" },
};

const ends: SwitchId[] = ["switch-a", "switch-b"];

const HOST_Y = 215;

const hosts: Host[] = [
    { id: "laptop", on: "switch-a", kind: "laptop", label: "Laptop", vlan: vlanNamed("home"), x: 60 },
    { id: "wifi-a", on: "switch-a", kind: "access-point", label: "Guest Wi-Fi A", vlan: vlanNamed("guests"), x: 160 },
    { id: "camera", on: "switch-a", kind: "camera", label: "Camera", vlan: vlanNamed("cameras"), x: 260 },
    { id: "desktop", on: "switch-b", kind: "desktop", label: "Desktop", vlan: vlanNamed("home"), x: 420 },
    { id: "wifi-b", on: "switch-b", kind: "access-point", label: "Guest Wi-Fi B", vlan: vlanNamed("guests"), x: 520 },
    { id: "recorder", on: "switch-b", kind: "server", label: "Recorder", vlan: vlanNamed("cameras"), x: 620 },
];

const hostById = (id: string) => hosts.find((host) => host.id === id)!;

// The VLAN ids each end of the trunk carries.
const carried = ref<Record<SwitchId, number[]>>({ "switch-a": [20, 30, 40], "switch-b": [20, 30, 40] });

const from = ref("camera");
const to = ref("recorder");
const busy = ref(false);
const tag = ref("");
const said = ref<{ kind: "good" | "bad" | "warn"; word?: string; text: string }>();
const { position, travelling, travel } = useTravel(220);

const switchPoint = (id: SwitchId): Point => [switches[id].x, switches[id].y];
const hostPoint = (host: Host): Point => [host.x, HOST_Y];

function toggle(end: SwitchId, id: number) {
    const now = carried.value[end];

    if (now.includes(id) && now.length === 1) {
        said.value = {
            kind: "warn",
            text: "A trunk carries at least one VLAN. To carry none, leave the port out of the file, and it is shut down.",
        };
        return;
    }

    const next = now.includes(id) ? now.filter((entry) => entry !== id) : [...now, id].sort((a, b) => a - b);
    carried.value = { ...carried.value, [end]: next };
    said.value = undefined;
}

const matched = computed(() => carried.value["switch-a"].join() === carried.value["switch-b"].join());

/** The trunk port in one switch's file, as the reader has set it. */
function trunkPort(end: SwitchId) {
    const names = carried.value[end].map((id) => `"${vlans.find((vlan) => vlan.id === id)!.name}"`).join(", ");

    return [
        '"40g-1": {',
        `    description: "${switches[end].farLabel}",`,
        `    trunk_vlans: [${names}],`,
        `    link: { device: "${switches[end].far}", port: "40g-1" },`,
        "},",
    ].join("\n");
}

/** What `circuit validate` prints for the two switches, in its own words. */
const validation = computed(() => {
    if (matched.value) return "$ npx circuit validate\n2 device(s), no errors.";

    const words = (end: SwitchId) => {
        const ids = carried.value[end];
        return ids.length ? `${ids.length === 1 ? "VLAN" : "VLANs"} ${ids.join(", ")} tagged` : "no VLANs";
    };
    const line = (end: SwitchId) => {
        const far = switches[end].far;
        return `  error  ${end}: port 40g-1 link: 40g-1 carries ${words(end)}, and ${far} 40g-1 carries ${words(far)}`;
    };

    return `$ npx circuit validate\n${line("switch-a")}\n${line("switch-b")}\n\n2 error(s).`;
});

async function send() {
    const source = hostById(from.value);
    const target = hostById(to.value);

    if (source === target) {
        said.value = { kind: "warn", text: "Pick two different devices." };
        return;
    }

    busy.value = true;
    said.value = undefined;
    const vlan = source.vlan;

    tag.value = "untagged";
    await travel([hostPoint(source), switchPoint(source.on)]);

    if (target.vlan.id !== vlan.id) {
        said.value = {
            kind: "bad",
            text: `The ${source.label} is in VLAN ${vlan.id} and the ${target.label} in VLAN ${target.vlan.id}. A trunk carries VLANs, it does not join them: crossing still needs a router.`,
        };
    } else if (target.on === source.on) {
        await travel([switchPoint(source.on), hostPoint(target)]);
        said.value = {
            kind: "good",
            text: `Both are on ${source.on} in VLAN ${vlan.id}, so the frame never touched the trunk and never needed a tag.`,
        };
    } else if (!carried.value[source.on].includes(vlan.id)) {
        said.value = {
            kind: "bad",
            text: `${source.on} does not carry VLAN ${vlan.id} on its trunk port, so it has no way to send the frame on. It stays on ${source.on}.`,
        };
    } else {
        tag.value = `tagged: VLAN ${vlan.id}`;
        await travel([switchPoint(source.on), switchPoint(target.on)]);

        if (!carried.value[target.on].includes(vlan.id)) {
            said.value = {
                kind: "bad",
                text: `${source.on} sent the frame tagged ${vlan.id}, but ${target.on} does not carry VLAN ${vlan.id} on its trunk port, so it drops every frame with that tag. The two ends do not agree.`,
            };
        } else {
            tag.value = "untagged";
            await travel([switchPoint(target.on), hostPoint(target)]);
            said.value = {
                kind: "good",
                text: `${source.on} added a tag for VLAN ${vlan.id} as the frame went onto the trunk. ${target.on} read the tag, took it off, and sent the frame out of its port in VLAN ${vlan.id}.`,
            };
        }
    }

    tag.value = "";
    busy.value = false;
}
</script>

<template>
    <div class="trunk-tags">
        <svg
            class="ac-drawing"
            viewBox="0 0 680 280"
            role="img"
            aria-label="Two switches joined by one trunk cable. Each switch has a laptop or desktop in VLAN 20, a guest Wi-Fi access point in VLAN 30 and a camera or recorder in VLAN 40."
        >
            <line class="cable trunk" :x1="switches['switch-a'].x + 30" :y1="80" :x2="switches['switch-b'].x - 30" :y2="80" />
            <text class="trunk-name" x="340" y="68" text-anchor="middle">trunk, port 40g-1 at both ends</text>
            <text class="carries" x="340" y="104" text-anchor="middle">switch-a carries {{ carried["switch-a"].join(", ") }}</text>
            <text class="carries" x="340" y="120" text-anchor="middle">switch-b carries {{ carried["switch-b"].join(", ") }}</text>

            <line
                v-for="host in hosts"
                :key="`cable-${host.id}`"
                class="cable"
                :class="`vlan-${host.vlan.id}`"
                :x1="switches[host.on].x"
                :y1="92"
                :x2="host.x"
                :y2="HOST_Y"
            />

            <SvgDevice kind="switch" :x="switches['switch-a'].x" :y="80" />
            <SvgDevice kind="switch" :x="switches['switch-b'].x" :y="80" />
            <text class="switch-name" :x="switches['switch-a'].x" y="44" text-anchor="middle">switch-a</text>
            <text class="switch-name" :x="switches['switch-b'].x" y="44" text-anchor="middle">switch-b</text>

            <SvgDevice
                v-for="host in hosts"
                :key="host.id"
                :kind="host.kind"
                :x="host.x"
                :y="HOST_Y"
                :label="host.label"
                :note="`VLAN ${host.vlan.id}`"
                :lit="!busy && said?.kind === 'good' && host.id === to"
            />

            <template v-if="travelling">
                <circle class="packet" :cx="position[0]" :cy="position[1]" r="9" />
                <text class="tag-label" :class="{ tagged: tag !== 'untagged' }" :x="position[0]" :y="position[1] - 16" text-anchor="middle">
                    {{ tag }}
                </text>
            </template>
        </svg>

        <div class="ends">
            <fieldset v-for="end in ends" :key="end" class="end">
                <legend>1. VLANs {{ end }} carries on its trunk port</legend>
                <div class="ac-row">
                    <button
                        v-for="vlan in vlans"
                        :key="vlan.id"
                        type="button"
                        class="ac-button small"
                        :aria-pressed="carried[end].includes(vlan.id)"
                        :disabled="busy"
                        @click="toggle(end, vlan.id)"
                    >
                        {{ vlan.id }} {{ vlan.name }}
                    </button>
                </div>
            </fieldset>
        </div>

        <div class="send">
            <label class="ac-field">
                <span>2. Send from</span>
                <select v-model="from" class="ac-select">
                    <option v-for="host in hosts" :key="host.id" :value="host.id">{{ host.label }} (VLAN {{ host.vlan.id }})</option>
                </select>
            </label>
            <label class="ac-field">
                <span>to</span>
                <select v-model="to" class="ac-select">
                    <option v-for="host in hosts" :key="host.id" :value="host.id">{{ host.label }} (VLAN {{ host.vlan.id }})</option>
                </select>
            </label>
            <button type="button" class="ac-button primary" :disabled="busy" @click="send">Send a frame</button>
        </div>

        <p v-if="said" class="ac-say" :class="said.kind" :data-word="said.word" aria-live="polite">{{ said.text }}</p>
        <p v-else class="ac-say hint" aria-live="polite">
            Send from the camera to the recorder and watch the label over the frame. Then turn VLAN 40 off at one end of the trunk and send
            again.
        </p>

        <div class="code">
            <CodeView :code="trunkPort('switch-a')" lang="ts" title="switch-a.ts, port 40g-1" :highlight="matched ? [] : [3]" />
            <CodeView :code="trunkPort('switch-b')" lang="ts" title="switch-b.ts, port 40g-1" :highlight="matched ? [] : [3]" />
            <CodeView :code="validation" lang="shell" title="Terminal" />
        </div>
    </div>
</template>

<style scoped>
.cable.trunk {
    stroke-width: 6;
}

.cable.vlan-30 {
    stroke-dasharray: 9 5;
}

.cable.vlan-40 {
    stroke-dasharray: 2 5;
    stroke-linecap: round;
}

.trunk-name,
.switch-name {
    font-weight: 700;
}

.carries {
    fill: var(--circuit-soft) !important;
    font-family: var(--circuit-mono);
    font-size: 11.5px !important;
}

.tag-label {
    font-family: var(--circuit-mono);
    font-size: 12px !important;
    font-weight: 700;
    paint-order: stroke;
    stroke: var(--circuit-paper);
    stroke-width: 4px;
}

.tag-label.tagged {
    fill: var(--circuit-link) !important;
}

.ends {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
    gap: 12px 20px;
    margin-top: 12px;
}

.end {
    margin: 0;
    padding: 0;
    border: 0;
    min-width: 0;
}

.end legend {
    margin-bottom: 6px;
    padding: 0;
    color: var(--circuit-soft);
    font-size: 13px;
    font-weight: 600;
}

.send {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: 10px;
    margin-top: 16px;
}

.code :deep(.code-view) {
    margin: 12px 0 0;
}

.hint {
    color: var(--circuit-soft);
}
</style>
