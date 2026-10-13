<script setup lang="ts">
// Lesson: VLANs. The reader puts each port of a switch in a VLAN, sends a broadcast or a message, and sees who gets it, with the switch's Circuit file written beside it.

import { computed, ref } from "vue";
import { useTravel, type Point } from "../travel";

type VlanName = "home" | "guests" | "cameras";
type Choice = VlanName | "off";

type Port = {
    port: string;
    kind: "laptop" | "desktop" | "printer" | "access-point" | "camera" | "server";
    label: string;
    description: string;
    x: number;
};

const vlans: { name: VlanName; id: number; description: string }[] = [
    { name: "home", id: 20, description: "Home" },
    { name: "guests", id: 30, description: "Guests" },
    { name: "cameras", id: 40, description: "Cameras" },
];

const ports: Port[] = [
    { port: "10g-1", kind: "laptop", label: "Laptop", description: "Laptop", x: 60 },
    { port: "10g-2", kind: "desktop", label: "Desktop", description: "Desktop", x: 170 },
    { port: "10g-3", kind: "printer", label: "Printer", description: "Printer", x: 280 },
    { port: "10g-4", kind: "access-point", label: "Guest Wi-Fi", description: "Guest access point", x: 390 },
    { port: "10g-5", kind: "camera", label: "Camera", description: "Camera", x: 500 },
    { port: "10g-6", kind: "server", label: "Recorder", description: "Video recorder", x: 610 },
];

const SWITCH: Point = [335, 50];
const DEVICE_Y = 196;

// Every port starts in one VLAN, as on a switch nobody has split yet.
const chosen = ref<Record<string, Choice>>(Object.fromEntries(ports.map((entry) => [entry.port, "home"])));
const lastChanged = ref<string>();

const from = ref("10g-4");
const to = ref("everyone");

const said = ref<{ kind: "good" | "bad" | "warn"; word?: string; text: string }>();
const heard = ref<string[]>([]);
const busy = ref(false);

// One moving packet per port, so a broadcast can reach every port at once.
const runners = ports.map(() => useTravel());

const vlanOf = (port: string) => vlans.find((vlan) => vlan.name === chosen.value[port]);
const portOf = (port: string) => ports.find((entry) => entry.port === port)!;

/** Where the cable of a port meets the switch: under one of its six sockets. */
const socketOf = (index: number): Point => [SWITCH[0] - 21 + index * 8.4, SWITCH[1] + 12];

const noteOf = (port: string) => {
    const vlan = vlanOf(port);
    return vlan ? `VLAN ${vlan.id}` : "shut down";
};

function setVlan(port: string, value: Choice) {
    chosen.value = { ...chosen.value, [port]: value };
    lastChanged.value = port;
    heard.value = [];
    said.value = undefined;
}

function pick(port: string, event: Event) {
    setVlan(port, (event.target as HTMLSelectElement).value as Choice);
}

/** The switch's file, as the reader has set the ports. */
const file = computed(() => {
    const lines = [
        'import { defineDevice, secret } from "@takodotid/circuit";',
        "",
        "export default defineDevice({",
        '    name: "switch",',
        '    platform: "vrp",',
        '    model: "CE6855-48S6Q-HI",',
        '    connection: { host: "192.168.10.2", user: "operator" },',
        '    users: { operator: { role: "admin", password: secret("SWITCH_PASSWORD") } },',
        "",
        "    vlans: {",
        ...vlans.map((vlan) => `        ${vlan.name}: { id: ${vlan.id}, description: "${vlan.description}" },`),
        "    },",
        "",
    ];

    const inFile = ports.filter((entry) => chosen.value[entry.port] !== "off");
    let highlight: number | undefined;

    if (!inFile.length) {
        lines.push("    ports: {},");
    } else {
        lines.push("    ports: {");
        for (const entry of inFile) {
            if (entry.port === lastChanged.value) highlight = lines.length + 1;
            lines.push(`        "${entry.port}": { description: "${entry.description}", access_vlan: "${chosen.value[entry.port]}" },`);
        }
        lines.push("    },");
    }

    lines.push("});");
    return { text: lines.join("\n"), highlight: highlight ? [highlight] : [] };
});

const centre = (port: string): Point => [portOf(port).x, DEVICE_Y];

async function send() {
    const sender = portOf(from.value);
    const senderVlan = vlanOf(from.value);
    heard.value = [];

    if (!senderVlan) {
        said.value = {
            kind: "bad",
            text: `Port ${sender.port} is not in the file, so it is shut down. The switch does not hear the ${sender.label.toLowerCase()} at all.`,
        };
        return;
    }

    if (to.value === from.value) {
        said.value = { kind: "warn", text: "A device does not need the network to talk to itself. Pick another one, or everyone." };
        return;
    }

    busy.value = true;
    said.value = undefined;
    await runners[0]!.travel([centre(sender.port), socketOf(ports.indexOf(sender))]);

    if (to.value !== "everyone") {
        const target = portOf(to.value);
        const targetVlan = vlanOf(target.port);

        if (!targetVlan) {
            said.value = {
                kind: "bad",
                text: `Port ${target.port} is shut down, because the file does not list it. Nothing can reach the ${target.label.toLowerCase()}.`,
            };
        } else if (targetVlan.id !== senderVlan.id) {
            said.value = {
                kind: "bad",
                text: `The ${sender.label.toLowerCase()} is in VLAN ${senderVlan.id} and the ${target.label.toLowerCase()} in VLAN ${targetVlan.id}. A switch passes a frame only to ports in the VLAN it came in on, so to cross from one VLAN to another you need a router.`,
            };
        } else {
            const index = ports.indexOf(target);
            await runners[index]!.travel([socketOf(index), centre(target.port)]);
            heard.value = [target.port];
            said.value = {
                kind: "good",
                text: `Both are in VLAN ${senderVlan.id}, so the switch passed the frame from port ${sender.port} to port ${target.port}.`,
            };
        }

        busy.value = false;
        return;
    }

    const receivers = ports.filter((entry) => entry !== sender && vlanOf(entry.port)?.id === senderVlan.id);
    await Promise.all(
        receivers.map((entry) => runners[ports.indexOf(entry)]!.travel([socketOf(ports.indexOf(entry)), centre(entry.port)]))
    );
    heard.value = receivers.map((entry) => entry.port);
    busy.value = false;

    if (!receivers.length) {
        said.value = {
            kind: "warn",
            word: "Nobody",
            text: `No other port is in VLAN ${senderVlan.id}, so the broadcast went nowhere. The rest of the switch never saw it.`,
        };
        return;
    }

    const others = ports.filter((entry) => entry !== sender && !receivers.includes(entry) && vlanOf(entry.port));
    const names = receivers.map((entry) => entry.label.toLowerCase()).join(", ");

    said.value = {
        kind: "good",
        word: `${receivers.length} heard it`,
        text: others.length
            ? `The broadcast reached every port in VLAN ${senderVlan.id}: ${names}. The ${others.map((entry) => entry.label.toLowerCase()).join(", ")} never saw it.`
            : `Every port is in VLAN ${senderVlan.id}, so the broadcast reached them all: ${names}.`,
    };
}
</script>

<template>
    <div class="vlan-painter">
        <svg
            class="ac-drawing"
            viewBox="0 0 670 270"
            role="img"
            aria-label="A switch with six devices below it, each on one port, with the VLAN of each port written under the device."
        >
            <line
                v-for="(entry, index) in ports"
                :key="entry.port"
                class="cable"
                :class="[chosen[entry.port], { lit: heard.includes(entry.port) }]"
                :x1="socketOf(index)[0]"
                :y1="socketOf(index)[1]"
                :x2="entry.x"
                :y2="DEVICE_Y"
            />

            <SvgDevice kind="switch" :x="SWITCH[0]" :y="SWITCH[1]" label="" />
            <text class="switch-name" :x="SWITCH[0] + 44" :y="SWITCH[1] + 5">Switch</text>

            <SvgDevice
                v-for="entry in ports"
                :key="entry.port"
                :kind="entry.kind"
                :x="entry.x"
                :y="DEVICE_Y"
                :label="entry.label"
                :note="noteOf(entry.port)"
                :lit="heard.includes(entry.port)"
                :dim="chosen[entry.port] === 'off'"
            />

            <template v-for="(runner, index) in runners" :key="index">
                <circle v-if="runner.travelling.value" class="packet" :cx="runner.position.value[0]" :cy="runner.position.value[1]" r="8" />
            </template>
        </svg>

        <p class="legend">Cables: VLAN 20 solid, VLAN 30 dashed, VLAN 40 dotted.</p>

        <fieldset class="ports">
            <legend>1. Put each port in a VLAN</legend>
            <label v-for="entry in ports" :key="entry.port" class="ac-field">
                <span>{{ entry.port }}, {{ entry.label }}</span>
                <select class="ac-select" :value="chosen[entry.port]" @change="pick(entry.port, $event)">
                    <option v-for="vlan in vlans" :key="vlan.name" :value="vlan.name">{{ vlan.name }} ({{ vlan.id }})</option>
                    <option value="off">not in the file</option>
                </select>
            </label>
        </fieldset>

        <div class="send">
            <label class="ac-field">
                <span>2. Send from</span>
                <select v-model="from" class="ac-select">
                    <option v-for="entry in ports" :key="entry.port" :value="entry.port">{{ entry.label }}</option>
                </select>
            </label>
            <label class="ac-field">
                <span>to</span>
                <select v-model="to" class="ac-select">
                    <option value="everyone">Everyone (a broadcast)</option>
                    <option v-for="entry in ports" :key="entry.port" :value="entry.port">{{ entry.label }}</option>
                </select>
            </label>
            <button type="button" class="ac-button primary" :disabled="busy" @click="send">Send</button>
        </div>

        <p v-if="said" class="ac-say" :class="said.kind" :data-word="said.word" aria-live="polite">{{ said.text }}</p>
        <p v-else class="ac-say hint" aria-live="polite">
            Every port is in VLAN 20, like a switch nobody has split yet. Send a broadcast from the guest Wi-Fi and see who hears it. Then
            move ports into other VLANs and send it again.
        </p>

        <CodeView :code="file.text" lang="ts" title="switch.ts" :highlight="file.highlight" />
    </div>
</template>

<style scoped>
.cable.guests {
    stroke-dasharray: 9 5;
}

.cable.cameras {
    stroke-dasharray: 2 5;
    stroke-linecap: round;
}

.cable.off {
    stroke-dasharray: 2 8;
    opacity: 0.35;
}

.switch-name {
    font-weight: 700;
}

.legend {
    margin: 4px 0 0 !important;
    color: var(--circuit-soft);
    font-size: 13.5px !important;
}

.ports {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
    gap: 10px 12px;
    margin: 14px 0 0;
    padding: 0;
    border: 0;
    min-width: 0;
}

.ports legend {
    grid-column: 1 / -1;
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

.hint {
    color: var(--circuit-soft);
}
</style>
