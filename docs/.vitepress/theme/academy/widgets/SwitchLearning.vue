<script setup lang="ts">
// Lesson: switches. The reader sends frames between five devices on one switch, and watches the switch learn where each device is, flood a frame it cannot place yet, and copy a broadcast to everyone.

import { computed, ref } from "vue";
import { useTravel, type Point } from "../travel";
import { BROADCAST, hostById, hosts, useNarrow, usePause, type Host } from "./SwitchLearning";

type Layout = {
    viewBox: string;
    /** Where the switch is drawn. */
    hub: Point;
    /** Each port's device, in port order: its centre, and where its cable leaves it. */
    spots: { x: number; y: number; edge: number }[];
    /** Where the switch's name is written, when it is not under the switch. */
    switchLabel?: Point;
};

const layouts: Record<"wide" | "narrow", Layout> = {
    wide: {
        viewBox: "0 0 700 330",
        hub: [350, 272],
        spots: [
            { x: 80, y: 58, edge: 124 },
            { x: 215, y: 58, edge: 124 },
            { x: 350, y: 58, edge: 124 },
            { x: 485, y: 58, edge: 124 },
            { x: 620, y: 58, edge: 124 },
        ],
    },
    narrow: {
        viewBox: "0 0 360 460",
        hub: [180, 236],
        switchLabel: [218, 241],
        spots: [
            { x: 60, y: 58, edge: 124 },
            { x: 180, y: 58, edge: 124 },
            { x: 300, y: 58, edge: 124 },
            { x: 100, y: 392, edge: 364 },
            { x: 260, y: 392, edge: 364 },
        ],
    },
};

const narrow = useNarrow();
const layout = computed(() => layouts[narrow.value ? "narrow" : "wide"]);

const spot = (host: Host) => layout.value.spots[host.port - 1]!;

/** Where a port's number is drawn: on its cable, close to the switch. */
function portTag(host: Host): Point {
    const [hubX, hubY] = layout.value.hub;
    const { x, edge } = spot(host);
    return [x + (hubX - x) * 0.62, edge + (hubY - edge) * 0.62];
}

/** The way from a device to the switch. */
function toSwitch(host: Host): Point[] {
    const { x, y, edge } = spot(host);
    return [[x, y], [x, edge], layout.value.hub];
}

type Entry = { mac: string; port: number };

const table = ref<Entry[]>([]);
/** The row the switch wrote or checked for the sender of the last frame. */
const learnedMac = ref<string>();
/** The row the switch used to find the receiver of the last frame. */
const usedMac = ref<string>();

const from = ref("laptop");
const to = ref("printer");

const packets = hosts.map(() => useTravel());
const pause = usePause();
const busy = ref(false);

type Mark = "sent" | "kept" | "ignored";
const markWords: Record<Mark, string> = { sent: "sent it", kept: "kept it", ignored: "ignored" };
const marks = ref<Record<string, Mark>>({});
const litPorts = ref<number[]>([]);
const frame = ref<{ to: string; from: string }>();

const said = ref<{ word: string; text: string; kind: "good" | "bad" | "warn" }>();

const goals = ref({ flooded: false, direct: false, broadcast: false, everyone: false });

const goalList = computed(() => [
    { done: goals.value.flooded, text: "See the switch flood a frame it cannot place yet." },
    { done: goals.value.direct, text: "Get a frame sent out of one port only." },
    { done: goals.value.everyone, text: "Teach the switch where all five devices are." },
    { done: goals.value.broadcast, text: "Send a broadcast, a frame for everyone." },
]);

const whoHas = (mac: string) => (mac === BROADCAST ? "everyone" : (hosts.find((host) => host.mac === mac)?.label ?? "unknown"));

async function send() {
    if (busy.value) return;

    const sender = hostById(from.value);
    const everyone = to.value === "everyone";
    const target = everyone ? undefined : hostById(to.value);

    if (target && target.id === sender.id) {
        said.value = { kind: "bad", word: "Pick again", text: "A device does not send a frame to itself. Pick two different devices." };
        return;
    }

    busy.value = true;
    said.value = undefined;
    marks.value = { [sender.id]: "sent" };
    litPorts.value = [sender.port];
    learnedMac.value = undefined;
    usedMac.value = undefined;
    frame.value = { to: target?.mac ?? BROADCAST, from: sender.mac };

    await packets[sender.port - 1]!.travel(toSwitch(sender));

    // First the switch reads who sent the frame, and writes down which port that device is behind.
    const known = table.value.find((entry) => entry.mac === sender.mac);
    if (known) known.port = sender.port;
    else table.value.push({ mac: sender.mac, port: sender.port });
    learnedMac.value = sender.mac;

    await pause(500);

    // Then it looks for the receiver in its table.
    const entry = target ? table.value.find((row) => row.mac === target.mac) : undefined;
    const receivers = entry ? hosts.filter((host) => host.port === entry.port) : hosts.filter((host) => host.port !== sender.port);
    usedMac.value = entry?.mac;
    litPorts.value = [sender.port, ...receivers.map((host) => host.port)];

    await Promise.all(receivers.map((host) => packets[host.port - 1]!.travel([...toSwitch(host)].reverse())));

    for (const host of receivers) {
        marks.value[host.id] = everyone || host.id === target?.id ? "kept" : "ignored";
    }

    const learned = known
        ? `The switch already had ${sender.mac} behind port ${sender.port}, so that row stays as it is.`
        : `The switch read the sender, ${sender.mac}, and wrote down that it is behind port ${sender.port}.`;
    const allKnownNow = table.value.length === hosts.length && !goals.value.everyone;

    if (everyone) {
        goals.value.broadcast = true;
        said.value = {
            kind: "good",
            word: "Broadcast",
            text: `${learned} The frame was for ${BROADCAST}, the address that means everyone, so the switch sent a copy out of every other port, and every device kept it.`,
        };
    } else if (entry) {
        goals.value.direct = true;
        said.value = {
            kind: "good",
            word: "Delivered",
            text: `${learned} It found ${target!.mac} behind port ${entry.port} in its table, so the frame went out of that one port only. No other device saw it.`,
        };
    } else {
        goals.value.flooded = true;
        const others = ["no", "one", "two", "three", "four"][receivers.length - 1];
        said.value = {
            kind: "good",
            word: "Flooded",
            text: `${learned} It has no row for ${target!.mac} yet, so it flooded the frame: a copy out of every port except the one it came in on. The ${target!.label.toLowerCase()} kept it, and the other ${others} saw it was not for them and ignored it. Now send one back from the ${target!.label.toLowerCase()} to the ${sender.label.toLowerCase()}.`,
        };
    }

    if (allKnownNow) {
        goals.value.everyone = true;
        said.value.text += " The table now has all five devices: from here on, a frame between two of them goes out of one port only.";
    }

    busy.value = false;
}

function clearTable() {
    table.value = [];
    marks.value = {};
    litPorts.value = [];
    frame.value = undefined;
    learnedMac.value = undefined;
    usedMac.value = undefined;
    said.value = {
        kind: "warn",
        word: "Cleared",
        text: "The table is empty again, as it is after the switch restarts. It floods frames again until it has learned where each device is.",
    };
}
</script>

<template>
    <div class="switch-learning">
        <svg
            class="ac-drawing"
            :viewBox="layout.viewBox"
            role="img"
            aria-label="Five devices: a laptop, a desktop, a printer, a camera and a server, each joined by a cable to its own numbered port on one switch."
        >
            <line
                v-for="host in hosts"
                :key="`cable-${host.id}`"
                class="cable"
                :class="{ lit: litPorts.includes(host.port) }"
                :x1="spot(host).x"
                :y1="spot(host).edge"
                :x2="layout.hub[0]"
                :y2="layout.hub[1]"
            />

            <g
                v-for="host in hosts"
                :key="`port-${host.id}`"
                class="port-tag"
                :transform="`translate(${portTag(host)[0]} ${portTag(host)[1]})`"
            >
                <rect x="-11" y="-11" width="22" height="22" />
                <text y="4.5" text-anchor="middle">{{ host.port }}</text>
            </g>

            <SvgDevice kind="switch" :x="layout.hub[0]" :y="layout.hub[1]" :label="layout.switchLabel ? undefined : 'Switch'" :lit="busy" />
            <text v-if="layout.switchLabel" class="switch-label" :x="layout.switchLabel[0]" :y="layout.switchLabel[1]">Switch</text>
            <SvgDevice
                v-for="host in hosts"
                :key="host.id"
                :kind="host.kind"
                :x="spot(host).x"
                :y="spot(host).y"
                :label="host.label"
                :note="host.mac"
            />

            <template v-for="host in hosts" :key="`mark-${host.id}`">
                <g
                    v-if="marks[host.id]"
                    class="mark"
                    :class="marks[host.id]"
                    :transform="`translate(${spot(host).x} ${spot(host).y - 42})`"
                >
                    <rect x="-36" y="-11" width="72" height="21" />
                    <text y="4" text-anchor="middle">{{ markWords[marks[host.id]] }}</text>
                </g>
            </template>

            <circle
                v-for="(packet, index) in packets"
                v-show="packet.travelling.value"
                :key="`packet-${index}`"
                class="packet"
                :cx="packet.position.value[0]"
                :cy="packet.position.value[1]"
                r="9"
            />
        </svg>

        <div class="send">
            <label class="ac-field">
                <span>Send a frame from</span>
                <select v-model="from" class="ac-select" :disabled="busy">
                    <option v-for="host in hosts" :key="host.id" :value="host.id">{{ host.label }}</option>
                </select>
            </label>
            <label class="ac-field">
                <span>to</span>
                <select v-model="to" class="ac-select" :disabled="busy">
                    <option v-for="host in hosts" :key="host.id" :value="host.id">{{ host.label }}</option>
                    <option value="everyone">Everyone (broadcast)</option>
                </select>
            </label>
            <button type="button" class="ac-button primary" :disabled="busy" @click="send">Send the frame</button>
            <button type="button" class="ac-button small" :disabled="busy || table.length === 0" @click="clearTable">
                Clear the table
            </button>
        </div>

        <p v-if="said" class="ac-say" :class="said.kind" :data-word="said.word" aria-live="polite">{{ said.text }}</p>
        <p v-else-if="busy" class="ac-say hint" aria-live="polite">The frame is on its way to the switch.</p>
        <p v-else class="ac-say hint" aria-live="polite">
            The switch has not seen a frame yet, so its table is empty. Send a frame from the laptop to the printer, and watch which ports
            it goes out of.
        </p>

        <div class="panels">
            <div>
                <p class="panel-title">The switch’s address table</p>
                <div class="table-frame">
                    <table class="ac-table">
                        <thead>
                            <tr>
                                <th>Hardware address</th>
                                <th>Port</th>
                                <th>Who that is</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="entry in table" :key="entry.mac" :class="{ lit: entry.mac === usedMac }">
                                <td class="ac-mono">{{ entry.mac }}</td>
                                <td>
                                    {{ entry.port }}
                                    <span v-if="entry.mac === learnedMac" class="fresh">sender</span>
                                    <span v-if="entry.mac === usedMac" class="fresh used">used</span>
                                </td>
                                <td class="who">{{ whoHas(entry.mac) }}</td>
                            </tr>
                            <tr v-if="table.length === 0">
                                <td colspan="3" class="empty">Empty</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                <p class="aside">The switch knows only the first two columns. The third is there for you.</p>
            </div>

            <div>
                <template v-if="frame">
                    <p class="panel-title">The last frame</p>
                    <dl class="frame">
                        <dt>To</dt>
                        <dd>
                            <span class="ac-mono">{{ frame.to }}</span> ({{ whoHas(frame.to).toLowerCase() }})
                        </dd>
                        <dt>From</dt>
                        <dd>
                            <span class="ac-mono">{{ frame.from }}</span> ({{ whoHas(frame.from).toLowerCase() }})
                        </dd>
                    </dl>
                </template>

                <p class="panel-title">Things to try</p>
                <ul class="goals">
                    <li v-for="goal in goalList" :key="goal.text" :class="{ done: goal.done }">
                        <span class="box" aria-hidden="true">{{ goal.done ? "✓" : "" }}</span>
                        <span
                            >{{ goal.text }}<span class="ac-hidden">{{ goal.done ? " Done." : " Not yet." }}</span></span
                        >
                    </li>
                </ul>
            </div>
        </div>
    </div>
</template>

<style scoped>
.switch-label {
    font-size: 13px;
    font-weight: 700;
}

.port-tag rect {
    fill: var(--circuit-paper);
    stroke: var(--circuit-ink);
    stroke-width: 1.5;
}

.port-tag text {
    font-family: var(--circuit-mono);
    font-size: 12px;
    font-weight: 700;
}

.mark rect {
    fill: var(--circuit-paper);
    stroke-width: 2;
}

.mark text {
    font-size: 12px;
    font-weight: 700;
}

.mark.sent rect {
    stroke: var(--circuit-link);
}

.mark.kept rect {
    stroke: var(--circuit-added);
}

.mark.kept text {
    fill: var(--circuit-added);
}

.mark.ignored rect {
    stroke: var(--circuit-edge);
    stroke-dasharray: 4 3;
}

.mark.ignored text {
    fill: var(--circuit-soft);
}

.send {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: 10px;
    margin-top: 10px;
}

.hint {
    color: var(--circuit-soft);
}

.panels {
    display: grid;
    grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr);
    gap: 18px;
    margin-top: 16px;
}

.panel-title {
    margin: 0 0 6px !important;
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.06em;
    font-stretch: 112%;
    text-transform: uppercase;
}

.table-frame {
    overflow-x: auto;
}

.table-frame .ac-table {
    margin-top: 0 !important;
    display: table;
}

.who {
    color: var(--circuit-soft);
}

tr.lit .who {
    color: inherit;
}

.fresh {
    display: inline-block;
    margin-left: 6px;
    padding: 0 5px;
    border: 1.5px solid var(--circuit-link);
    border-radius: 2px;
    font-size: 11px;
    font-weight: 700;
    line-height: 16px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
}

.fresh.used {
    border-color: currentColor;
}

.empty {
    color: var(--circuit-soft);
}

.aside {
    margin: 6px 0 0 !important;
    color: var(--circuit-soft);
    font-size: 13.5px;
    line-height: 1.5;
}

.frame {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 2px 12px;
    margin: 0 0 14px;
    padding: 8px 12px;
    border: 2px solid var(--circuit-ink);
    font-size: 14px;
}

.frame dt {
    font-weight: 700;
}

.frame dd {
    margin: 0;
    overflow-wrap: anywhere;
}

.goals {
    margin: 0 !important;
    padding: 0 !important;
    list-style: none;
}

.goals li {
    display: flex;
    gap: 10px;
    margin: 0 0 6px !important;
    font-size: 14.5px;
    line-height: 1.45;
}

.box {
    flex: none;
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    border: 1.5px solid var(--circuit-ink);
    border-radius: 2px;
    font-size: 13px;
    font-weight: 700;
}

.goals li.done .box {
    border-color: var(--circuit-added);
    background: var(--circuit-added);
    color: var(--circuit-paper);
}

@media (max-width: 640px) {
    .panels {
        grid-template-columns: minmax(0, 1fr);
    }
}
</style>
