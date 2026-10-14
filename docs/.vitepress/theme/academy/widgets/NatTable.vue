<script setup lang="ts">
// Lesson: NAT. The reader opens connections from devices at home, watches the router rewrite each one and fill its translation table, then tries to connect in from outside, with and without a port forward.

import { computed, ref } from "vue";
import { useTravel, type Point } from "../travel";

type Kind = "laptop" | "phone" | "camera" | "router" | "cloud" | "server";
type Place = { id: string; kind: Kind; label: string; address: string; x: number; y: number };

/** The router's one public address, on its port to the internet provider. */
const PUBLIC = "203.0.113.2";
const STRANGER = "192.0.2.66";
const FORWARDED_PORT = 8443;

const places: Place[] = [
    { id: "laptop", kind: "laptop", label: "Laptop", address: "192.168.20.10", x: 70, y: 55 },
    { id: "phone", kind: "phone", label: "Phone", address: "192.168.20.11", x: 70, y: 165 },
    { id: "camera", kind: "camera", label: "Camera", address: "192.168.20.50", x: 70, y: 275 },
    { id: "router", kind: "router", label: "Router", address: PUBLIC, x: 265, y: 165 },
    { id: "internet", kind: "cloud", label: "The internet", address: "", x: 440, y: 165 },
    { id: "website", kind: "server", label: "Website", address: "198.51.100.7", x: 625, y: 55 },
    { id: "video", kind: "server", label: "Video service", address: "198.51.100.20", x: 625, y: 165 },
    { id: "stranger", kind: "laptop", label: "Stranger", address: STRANGER, x: 625, y: 275 },
];

const at = (id: string) => places.find((place) => place.id === id)!;
const point = (id: string): Point => [at(id).x, at(id).y];

const inside = ["laptop", "phone", "camera"];
const remotes = ["website", "video"];

/** One row of the router's translation table. */
type Row = {
    number: number;
    device: string;
    insidePort: number;
    outsidePort: number;
    remote: string;
    remotePort: number;
    /** Written for a connection that came in through the port forward. */
    forwarded?: boolean;
};

/** One line of what the packet says, at one moment of its trip. */
type Header = { moment: string; from: string; to: string; changed?: "from" | "to" };

// The port each device picks for its next connection. The laptop and the phone both start at 51000, so their first connections use the same port.
const FIRST_DEVICE_PORTS: Record<string, number> = { laptop: 51000, phone: 51000, camera: 50320 };
const FIRST_OUTSIDE_PORT = 40001;
const FIRST_STRANGER_PORT = 53000;

const devicePorts = ref<Record<string, number>>({ ...FIRST_DEVICE_PORTS });
const nextOutsidePort = ref(FIRST_OUTSIDE_PORT);
const nextStrangerPort = ref(FIRST_STRANGER_PORT);

const rows = ref<Row[]>([]);
const litRow = ref<number>();
const headers = ref<Header[]>([]);

const from = ref("laptop");
const to = ref("website");
const forwardOn = ref(false);
const knockPort = ref(FORWARDED_PORT);

const busy = ref(false);
const said = ref<{ kind: "good" | "bad"; text: string }>();
const { position, travelling, travel } = useTravel();

/** The ports a stranger can try: the forwarded one, and every outside port in the table. */
const knockPorts = computed(() => [
    ...new Set([FORWARDED_PORT, ...rows.value.filter((row) => !row.forwarded).map((row) => row.outsidePort)]),
]);

async function openConnection() {
    busy.value = true;
    said.value = undefined;
    litRow.value = undefined;

    try {
        const device = at(from.value);
        const remote = at(to.value);
        const insidePort = devicePorts.value[from.value]!;
        const outsidePort = nextOutsidePort.value;
        devicePorts.value[from.value] = insidePort + 1;
        nextOutsidePort.value = outsidePort + 1;

        headers.value = [{ moment: `${device.label} sends`, from: `${device.address}:${insidePort}`, to: `${remote.address}:443` }];
        await travel([point(from.value), point("router")]);

        const row: Row = { number: rows.value.length + 1, device: from.value, insidePort, outsidePort, remote: to.value, remotePort: 443 };
        rows.value = [...rows.value, row];
        litRow.value = row.number;
        headers.value = [
            ...headers.value,
            {
                moment: `Router writes row ${row.number} and rewrites the sender`,
                from: `${PUBLIC}:${outsidePort}`,
                to: `${remote.address}:443`,
                changed: "from",
            },
        ];
        await travel([point("router"), point("internet"), point(to.value)]);

        headers.value = [
            ...headers.value,
            { moment: `${remote.label} replies`, from: `${remote.address}:443`, to: `${PUBLIC}:${outsidePort}` },
        ];
        await travel([point(to.value), point("internet"), point("router")]);

        headers.value = [
            ...headers.value,
            {
                moment: `Router finds row ${row.number} and rewrites the receiver`,
                from: `${remote.address}:443`,
                to: `${device.address}:${insidePort}`,
                changed: "to",
            },
        ];
        await travel([point("router"), point(from.value)]);

        const twin = rows.value.find(
            (other) => other !== row && !other.forwarded && other.device !== row.device && other.insidePort === row.insidePort
        );
        const twinNote = twin
            ? ` The ${at(twin.device).label.toLowerCase()} in row ${twin.number} used port ${insidePort} too. Outside, the router tells them apart by its own ports, ${twin.outsidePort} and ${outsidePort}.`
            : "";

        said.value = {
            kind: "good",
            text: `The ${remote.label.toLowerCase()} only ever saw ${PUBLIC}. Its reply came to port ${outsidePort}, and row ${row.number} says that port leads to the ${device.label.toLowerCase()}’s port ${insidePort}.${twinNote}`,
        };
    } finally {
        busy.value = false;
    }
}

async function connectFromOutside() {
    busy.value = true;
    said.value = undefined;
    litRow.value = undefined;

    try {
        const port = knockPort.value;
        const strangerPort = nextStrangerPort.value;
        nextStrangerPort.value = strangerPort + 1;

        headers.value = [{ moment: "Stranger sends", from: `${STRANGER}:${strangerPort}`, to: `${PUBLIC}:${port}` }];
        await travel([point("stranger"), point("internet"), point("router")]);

        if (port === FORWARDED_PORT && forwardOn.value) {
            const row: Row = {
                number: rows.value.length + 1,
                device: "camera",
                insidePort: 443,
                outsidePort: port,
                remote: "stranger",
                remotePort: strangerPort,
                forwarded: true,
            };
            rows.value = [...rows.value, row];
            litRow.value = row.number;
            headers.value = [
                ...headers.value,
                {
                    moment: `Router follows the port forward, writes row ${row.number}, and rewrites the receiver`,
                    from: `${STRANGER}:${strangerPort}`,
                    to: `${at("camera").address}:443`,
                    changed: "to",
                },
            ];
            await travel([point("router"), point("camera")]);

            said.value = {
                kind: "good",
                text: `The port forward sends port ${FORWARDED_PORT} to the camera’s port 443. Anyone on the internet can now reach the camera this way, not only you. Row ${row.number} sends the camera’s replies back out.`,
            };
            return;
        }

        const row = rows.value.find((entry) => entry.outsidePort === port && !entry.forwarded);
        if (row) {
            litRow.value = row.number;
            said.value = {
                kind: "bad",
                text: `Port ${port} is in row ${row.number}, but that row is for replies from ${at(row.remote).address} port ${row.remotePort}. This packet comes from ${STRANGER}, so it matches no row, and it stops at the router.`,
            };
            return;
        }

        said.value = {
            kind: "bad",
            text: `No row in the table is for port ${port}, so the router cannot know which device at home it is meant for. It stops at the router.${forwardOn.value ? "" : " Turn on the port forward and try again."}`,
        };
    } finally {
        busy.value = false;
    }
}

function clearTable() {
    rows.value = [];
    headers.value = [];
    litRow.value = undefined;
    devicePorts.value = { ...FIRST_DEVICE_PORTS };
    nextOutsidePort.value = FIRST_OUTSIDE_PORT;
    nextStrangerPort.value = FIRST_STRANGER_PORT;
    knockPort.value = FORWARDED_PORT;
    said.value = undefined;
}

function toggleForward() {
    forwardOn.value = !forwardOn.value;
    said.value = undefined;
}

const code = computed(() => {
    const lines = [
        "firewall: {",
        "    nat: {",
        '        source: [{ description: "Share the public address", match: { out_interface: "1g-1" }, action: "masquerade" }],',
    ];

    if (forwardOn.value) {
        lines.push(
            "        destination: [",
            "            {",
            '                description: "Camera from outside",',
            `                match: { in_interface: "1g-1", protocol: "tcp", dst_port: ${FORWARDED_PORT} },`,
            '                action: "dnat",',
            '                to: "192.168.20.50",',
            "                to_port: 443,",
            "            },",
            "        ],"
        );
    }

    lines.push("    },", "},");
    return lines.join("\n");
});

const forwardLines = computed(() => (forwardOn.value ? [4, 5, 6, 7, 8, 9, 10, 11, 12] : []));
</script>

<template>
    <div class="nat-table">
        <svg
            class="ac-drawing"
            viewBox="0 0 700 340"
            role="img"
            aria-label="A laptop, a phone and a camera at home behind a router with the public address 203.0.113.2. Beyond the internet are a website, a video service and a stranger."
        >
            <line v-for="id in inside" :key="id" class="cable" :x1="at(id).x" :y1="at(id).y" :x2="at('router').x" :y2="at('router').y" />
            <line class="cable" :x1="at('router').x" :y1="at('router').y" :x2="at('internet').x" :y2="at('internet').y" />
            <line
                v-for="id in ['website', 'video', 'stranger']"
                :key="id"
                class="cable"
                :x1="at('internet').x"
                :y1="at('internet').y"
                :x2="at(id).x"
                :y2="at(id).y"
            />

            <text class="side" x="150" y="320" text-anchor="middle">Private: 192.168.20.0/24</text>
            <text class="side" x="440" y="320" text-anchor="middle">Public</text>

            <SvgDevice
                v-for="place in places"
                :key="place.id"
                :kind="place.kind"
                :x="place.x"
                :y="place.y"
                :label="place.label"
                :note="place.id === 'router' ? `outside ${place.address}` : place.address || undefined"
            />

            <circle v-if="travelling" class="packet" :cx="position[0]" :cy="position[1]" r="9" />
        </svg>

        <div class="controls">
            <div class="send">
                <label class="ac-field">
                    <span>1. From</span>
                    <select v-model="from" class="ac-select">
                        <option v-for="id in inside" :key="id" :value="id">{{ at(id).label }}, {{ at(id).address }}</option>
                    </select>
                </label>
                <label class="ac-field">
                    <span>to</span>
                    <select v-model="to" class="ac-select">
                        <option v-for="id in remotes" :key="id" :value="id">{{ at(id).label }}, port 443</option>
                    </select>
                </label>
                <button type="button" class="ac-button primary" :disabled="busy" @click="openConnection">Open a connection</button>
            </div>

            <div class="send">
                <label class="ac-field">
                    <span>2. A stranger connects to {{ PUBLIC }}, port</span>
                    <select v-model.number="knockPort" class="ac-select">
                        <option v-for="port in knockPorts" :key="port" :value="port">
                            {{ port }}{{ port === FORWARDED_PORT ? "" : " (in the table)" }}
                        </option>
                    </select>
                </label>
                <button type="button" class="ac-button" :disabled="busy" @click="connectFromOutside">Connect from outside</button>
                <button type="button" class="ac-button" :aria-pressed="forwardOn" :disabled="busy" @click="toggleForward">
                    Port forward to the camera: {{ forwardOn ? "on" : "off" }}
                </button>
            </div>
        </div>

        <div v-if="headers.length" class="frame">
            <table class="ac-table">
                <caption>
                    What the packet says
                </caption>
                <thead>
                    <tr>
                        <th scope="col">Moment</th>
                        <th scope="col">From</th>
                        <th scope="col">To</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="(header, index) in headers" :key="index">
                        <td>{{ header.moment }}</td>
                        <td class="ac-mono">
                            <mark v-if="header.changed === 'from'">{{ header.from }}</mark
                            ><template v-else>{{ header.from }}</template>
                        </td>
                        <td class="ac-mono">
                            <mark v-if="header.changed === 'to'">{{ header.to }}</mark
                            ><template v-else>{{ header.to }}</template>
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>

        <div class="frame">
            <table class="ac-table">
                <caption>
                    The router’s translation table
                </caption>
                <thead>
                    <tr>
                        <th scope="col">Row</th>
                        <th scope="col">Inside</th>
                        <th scope="col">Outside</th>
                        <th scope="col">Other end</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-if="!rows.length">
                        <td colspan="4" class="empty">Empty. Open a connection to fill it.</td>
                    </tr>
                    <tr v-for="row in rows" :key="row.number" :class="{ lit: row.number === litRow }">
                        <td>{{ row.number }}{{ row.forwarded ? ", forwarded" : "" }}</td>
                        <td class="ac-mono">{{ at(row.device).address }}:{{ row.insidePort }}</td>
                        <td class="ac-mono">{{ PUBLIC }}:{{ row.outsidePort }}</td>
                        <td class="ac-mono">{{ at(row.remote).address }}:{{ row.remotePort }}</td>
                    </tr>
                </tbody>
            </table>
            <div class="ac-row clear">
                <button type="button" class="ac-button small" :disabled="busy || !rows.length" @click="clearTable">
                    End every connection
                </button>
            </div>
        </div>

        <p v-if="said" class="ac-say" :class="said.kind" :data-word="said.kind === 'good' ? 'Through' : 'Stopped'" aria-live="polite">
            {{ said.text }}
        </p>
        <p v-else class="ac-say hint" aria-live="polite">
            {{
                busy
                    ? "The packet is on its way."
                    : "Open a connection from the laptop, then one from the phone, and watch the table. Then try to connect from outside."
            }}
        </p>

        <CodeView :code="code" title="router.ts" :highlight="forwardLines" />
    </div>
</template>

<style scoped>
.side {
    fill: var(--circuit-soft) !important;
    font-size: 12px !important;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
}

.controls {
    display: grid;
    gap: 16px;
    margin-top: 10px;
}

.send {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: 10px;
}

.frame {
    margin-top: 14px;
    overflow-x: auto;
}

caption {
    padding-bottom: 4px;
    color: var(--circuit-soft);
    font-size: 13px;
    font-weight: 600;
    text-align: left;
}

mark {
    padding: 0 3px;
    background: var(--circuit-yellow);
    color: #0a1a36;
}

.empty {
    color: var(--circuit-soft);
}

.clear {
    margin-top: 8px;
}

.hint {
    color: var(--circuit-soft);
}
</style>
