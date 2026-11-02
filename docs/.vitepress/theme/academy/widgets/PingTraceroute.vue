<script setup lang="ts">
// Lesson: routers and the gateway. The reader runs ping to four addresses and tracert to a far server from a laptop, and watches echo requests, replies and "time exceeded" notes travel, while the laptop prints what Windows would print.

import { computed, ref } from "vue";
import { useTravel, type Point } from "../travel";
import { useNarrow, usePause } from "./SwitchLearning";

type Id = "laptop" | "main" | "provider" | "middle" | "far" | "server" | "shop" | "nobody";
type DeviceId = Exclude<Id, "nobody">;

/** Each device, with its address on the side that faces the laptop: the one it answers from. */
const devices: { id: DeviceId; kind: "laptop" | "router" | "server"; label: string; address: string }[] = [
    { id: "laptop", kind: "laptop", label: "Laptop", address: "192.168.1.20" },
    { id: "main", kind: "router", label: "Main router", address: "192.168.1.1" },
    { id: "provider", kind: "router", label: "Provider router", address: "198.51.100.1" },
    { id: "middle", kind: "router", label: "Middle router", address: "198.51.100.6" },
    { id: "far", kind: "router", label: "Far router", address: "192.0.2.2" },
    { id: "server", kind: "server", label: "Far server", address: "203.0.113.80" },
    { id: "shop", kind: "server", label: "Shop server", address: "203.0.113.50" },
];

const NOBODY_ADDRESS = "203.0.113.99";

const ROUTERS: Id[] = ["main", "provider", "middle", "far"];
const isRouter = (id: Id) => ROUTERS.includes(id);

/** The router that drops packets like the others, but never sends an ICMP note about it. */
const SILENT: Id = "middle";

const deviceOf = (id: Id) => devices.find((device) => device.id === id)!;
const nameOf = (id: Id) => deviceOf(id).label.toLowerCase();

const cables: [Id, Id][] = [
    ["laptop", "main"],
    ["main", "provider"],
    ["provider", "middle"],
    ["middle", "far"],
    ["far", "server"],
    ["far", "shop"],
    ["far", "nobody"],
];

type Anchor = "start" | "middle" | "end";
type Layout = {
    viewBox: string;
    at: Record<Id, Point>;
    /** Names written beside or above a device instead of under it, where a cable runs under it. */
    names: Partial<Record<Id, { x: number; y: number; anchor: Anchor }>>;
    /** Where the remark about the silent router goes once the reader has found it. */
    silentTag: { x: number; y: number; anchor: Anchor };
};

const layouts: Record<"wide" | "narrow", Layout> = {
    wide: {
        viewBox: "0 0 700 335",
        at: {
            laptop: [55, 120],
            main: [170, 120],
            provider: [285, 120],
            middle: [400, 120],
            far: [515, 120],
            server: [640, 50],
            shop: [640, 160],
            nobody: [630, 275],
        },
        names: {
            far: { x: 515, y: 56, anchor: "middle" },
        },
        silentTag: { x: 400, y: 66, anchor: "middle" },
    },
    narrow: {
        viewBox: "0 0 360 612",
        at: {
            laptop: [60, 45],
            main: [60, 140],
            provider: [60, 235],
            middle: [60, 330],
            far: [60, 425],
            server: [60, 545],
            shop: [185, 545],
            nobody: [300, 545],
        },
        names: {
            laptop: { x: 105, y: 43, anchor: "start" },
            main: { x: 105, y: 138, anchor: "start" },
            provider: { x: 105, y: 233, anchor: "start" },
            middle: { x: 105, y: 328, anchor: "start" },
            far: { x: 105, y: 423, anchor: "start" },
        },
        silentTag: { x: 105, y: 370, anchor: "start" },
    },
};

const narrow = useNarrow();
const layout = computed(() => layouts[narrow.value ? "narrow" : "wide"]);
const at = (id: Id) => layout.value.at[id];

/** The devices whose name and address are written beside or above them in this layout. */
const placedNames = computed(() =>
    devices.flatMap((device) => {
        const place = layout.value.names[device.id];
        return place ? [{ ...device, place }] : [];
    })
);
const cableKey = (a: Id, b: Id) => [a, b].sort().join("-");

/** The way from the laptop to the far server, the one tracert follows. */
const TO_SERVER: Id[] = ["laptop", "main", "provider", "middle", "far", "server"];

type PingCommand = {
    id: string;
    kind: "ping";
    address: string;
    about: string;
    /** The devices the echo request passes, ending where it is answered or dropped. */
    way: Id[];
    /** Round-trip times of the four replies, in milliseconds, or none when nothing answers. */
    times?: number[];
    /** Why nothing answers, written at the place the request is dropped. */
    dropped?: string;
};

type TraceCommand = { id: string; kind: "trace"; address: string; about: string };

const commands: (PingCommand | TraceCommand)[] = [
    { id: "gateway", kind: "ping", address: "192.168.1.1", about: "the gateway", way: ["laptop", "main"], times: [2, 1, 3, 2] },
    { id: "server", kind: "ping", address: "203.0.113.80", about: "the far server", way: TO_SERVER, times: [24, 23, 25, 24] },
    {
        id: "nobody",
        kind: "ping",
        address: NOBODY_ADDRESS,
        about: "nobody has it",
        way: ["laptop", "main", "provider", "middle", "far"],
        dropped: "nobody answers",
    },
    {
        id: "shop",
        kind: "ping",
        address: "203.0.113.50",
        about: "the shop server",
        way: ["laptop", "main", "provider", "middle", "far", "shop"],
        dropped: "firewall drops it",
    },
    { id: "trace", kind: "trace", address: "203.0.113.80", about: "the way there" },
];

const commandLine = (command: PingCommand | TraceCommand) =>
    command.kind === "ping" ? `ping ${command.address}` : `tracert -d ${command.address}`;

/** The TTL a device sets on a packet it sends. Many start at 64, others at 128. */
const REPLY_TTL = 64;

/** The three round-trip times tracert prints for each hop, in milliseconds; none for the silent router. */
const traceTimes: Record<number, number[] | undefined> = {
    1: [2, 1, 1],
    2: [8, 9, 8],
    3: undefined,
    4: [23, 22, 23],
    5: [24, 24, 25],
};

const chosen = ref("gateway");
const output = ref<string[]>([]);
const steps = ref<string[]>([]);
const packet = ref<{ text: string; kind: "probe" | "note" }>();
const marker = ref<{ at: Id; text: string; dropped: boolean }>();
const litNodes = ref<Id[]>([]);
const litCables = ref<string[]>([]);
const silentFound = ref(false);
const status = ref("");
const said = ref<{ kind: "good" | "bad" | "warn"; word: string; text: string }>();
const busy = ref(false);
const ranTrace = ref(false);
/** What made the output shown now, so its caption does not change when the reader picks another command. */
const shownKind = ref<"ping" | "trace">();

const { position, travelling, travel } = useTravel(320);
const pause = usePause();

const command = computed(() => commands.find((item) => item.id === chosen.value)!);

/** Move the packet from device to device, one cable at a time, calling `arrive` at each device it reaches. Stops early when `arrive` returns true. */
async function walk(way: Id[], arrive?: (id: Id) => boolean | void) {
    for (let index = 1; index < way.length; index++) {
        const from = way[index - 1]!;
        const to = way[index]!;
        litCables.value = [...litCables.value, cableKey(from, to)];
        await travel([at(from), at(to)]);
        if (arrive?.(to)) return index;
    }
    return way.length - 1;
}

function reset() {
    output.value = [];
    steps.value = [];
    packet.value = undefined;
    marker.value = undefined;
    litNodes.value = [];
    litCables.value = [];
    status.value = "";
    said.value = undefined;
}

async function run() {
    if (busy.value) return;
    reset();
    busy.value = true;

    const current = command.value;
    shownKind.value = current.kind;
    if (current.kind === "ping") await runPing(current);
    else await runTrace();

    packet.value = undefined;
    status.value = "";
    busy.value = false;
}

async function runPing(ping: PingCommand) {
    output.value = [`$ ${commandLine(ping)}`, "", `Pinging ${ping.address} with 32 bytes of data:`];
    status.value = `The laptop sends an echo request to ${ping.address}.`;

    packet.value = { text: "echo request", kind: "probe" };
    await walk(ping.way);

    const end = ping.way[ping.way.length - 1]!;
    litNodes.value = [end];

    if (!ping.times) {
        packet.value = undefined;
        marker.value = { at: end, text: ping.dropped!, dropped: true };
        status.value = "The laptop waits for a reply.";
        await pause(1600);

        output.value = [...output.value, "Request timed out."];
        for (let request = 2; request <= 4; request++) {
            await pause(500);
            output.value = [...output.value, "Request timed out."];
        }

        output.value = [
            ...output.value,
            "",
            `Ping statistics for ${ping.address}:`,
            "    Packets: Sent = 4, Received = 0, Lost = 4 (100% loss),",
        ];

        said.value =
            ping.id === "shop"
                ? {
                      kind: "warn",
                      word: "No reply",
                      text: "The shop server is on, and its website opens. But its firewall, a filter that decides which packets may come in, throws away every echo request. So ping sees the same silence as for an address nobody has: Request timed out does not prove that a device is off.",
                  }
                : {
                      kind: "bad",
                      word: "No reply",
                      text: `The far router asked its own network who has ${NOBODY_ADDRESS}, nobody answered, and it dropped the request. This router sends no note back, so the laptop only waits, and after a few seconds prints Request timed out. Some routers do send a note saying the address cannot be reached, and ping prints that instead.`,
                  };
        return;
    }

    // The reply starts with a fresh TTL, and each router on the way back lowers it by one.
    let ttl = REPLY_TTL;
    packet.value = { text: `reply, TTL ${ttl}`, kind: "note" };
    litCables.value = [];
    await walk([...ping.way].reverse(), (id) => {
        if (!isRouter(id)) return;
        ttl -= 1;
        packet.value = { text: `reply, TTL ${ttl}`, kind: "note" };
    });

    litNodes.value = [];
    output.value = [...output.value, replyLine(ping.address, ping.times[0]!, ttl)];
    for (let request = 1; request < ping.times.length; request++) {
        await pause(500);
        output.value = [...output.value, replyLine(ping.address, ping.times[request]!, ttl)];
    }

    const fastest = Math.min(...ping.times);
    const slowest = Math.max(...ping.times);
    const average = Math.round(ping.times.reduce((sum, time) => sum + time, 0) / ping.times.length);
    output.value = [
        ...output.value,
        "",
        `Ping statistics for ${ping.address}:`,
        "    Packets: Sent = 4, Received = 4, Lost = 0 (0% loss),",
        "Approximate round trip times in milli-seconds:",
        `    Minimum = ${fastest}ms, Maximum = ${slowest}ms, Average = ${average}ms`,
    ];

    const routersBack = ping.way.filter((id) => isRouter(id) && id !== ping.way[ping.way.length - 1]).length;
    said.value =
        routersBack === 0
            ? {
                  kind: "good",
                  word: "Reply",
                  text: `The main router answered all four in about ${average} ms there and back. TTL=${ttl}: it set ${REPLY_TTL} on its reply, and no router stood between it and the laptop to lower it. A quick reply from the gateway means the laptop's own network works.`,
              }
            : {
                  kind: "good",
                  word: "Reply",
                  text: `The far server answered all four in about ${average} ms there and back. Its reply set off with TTL ${REPLY_TTL}, and ${routersBack} routers each lowered it by one on the way back, so it arrived with ${ttl}. The middle router passed the ping on like the others.`,
              };
}

async function runTrace() {
    output.value = ["$ tracert -d 203.0.113.80", "", "Tracing route to 203.0.113.80 over a maximum of 30 hops", ""];

    for (let ttl = 1; ; ttl++) {
        litCables.value = [];
        litNodes.value = [];
        status.value = `tracert sends packets with a TTL of ${ttl}.`;
        packet.value = { text: `TTL ${ttl}`, kind: "probe" };

        let left = ttl;
        const lowered: string[] = [];

        const stop = await walk(TO_SERVER, (id) => {
            if (!isRouter(id)) return true;
            left -= 1;
            lowered.push(lowered.length === 0 ? `the ${nameOf(id)} lowers it to ${left}` : `the ${nameOf(id)} to ${left}`);
            packet.value = { text: `TTL ${left}`, kind: "probe" };
            return left === 0;
        });

        const end = TO_SERVER[stop]!;
        const reached = !isRouter(end);
        const how = `TTL ${ttl}: ${lowered.join(", ")}.`;
        litNodes.value = [end];
        packet.value = undefined;

        if (end === SILENT) {
            marker.value = { at: end, text: "TTL 0: dropped", dropped: true };
            status.value = "The laptop waits for a note that does not come.";
            steps.value = [
                ...steps.value,
                `${how} The ${nameOf(end)} drops the packet and sends nothing back. The laptop waits, gives up, and prints * for each of its three tries.`,
            ];
            await pause(1800);
            output.value = [...output.value, hopLine(ttl)];
            silentFound.value = true;
        } else {
            marker.value = reached ? { at: end, text: "arrived", dropped: false } : { at: end, text: "TTL 0: dropped", dropped: true };
            await pause(600);
            marker.value = undefined;

            packet.value = { text: reached ? "echo reply" : "time exceeded", kind: "note" };
            litCables.value = [];
            await walk(TO_SERVER.slice(0, stop + 1).reverse());
            packet.value = undefined;

            const address = deviceOf(end).address;
            output.value = [...output.value, hopLine(ttl, traceTimes[ttl], address)];
            steps.value = [
                ...steps.value,
                reached
                    ? `${how} The packet reaches the far server, which answers with an echo reply. Hop ${ttl} is the server itself, so the trace ends.`
                    : `${how} The ${nameOf(end)} drops the packet and sends back an ICMP note, time exceeded, from its address. Hop ${ttl} is ${address}.`,
            ];
        }

        marker.value = undefined;
        if (reached) break;
        await pause(300);
    }

    litNodes.value = [];
    output.value = [...output.value, "", "Trace complete."];
    ranTrace.value = true;
    said.value = {
        kind: "good",
        word: "Trace complete",
        text: "Five hops: four routers, then the server. Row 3 is * * * because the middle router dropped its packet without a note. The way through it is fine: the packets with TTL 4 and 5 went through it and got answers.",
    };
}

/** One reply line, as Windows ping prints it. */
function replyLine(address: string, time: number, ttl: number) {
    const shown = time < 1 ? "time<1ms" : `time=${time}ms`;
    return `Reply from ${address}: bytes=32 ${shown} TTL=${ttl}`;
}

/** One row of tracert's list: the hop number, three times, and the address, or three stars when nothing answered. */
function hopLine(hop: number, times?: number[], address?: string) {
    const number = String(hop).padStart(3);

    if (!times || !address) return `${number}${"     *   ".repeat(3)}  Request timed out.`;

    const columns = times.map((time) => `${time < 1 ? "<1" : time} ms`.padStart(9)).join("");
    return `${number}${columns}  ${address}`;
}

const hint = computed(() =>
    ranTrace.value
        ? "Run any command again, or pick another one."
        : "Pick a command and press Run. Start with ping to the gateway, then the far server, then the two that stay silent, and finish with tracert."
);
</script>

<template>
    <div class="ping-traceroute">
        <svg
            class="ac-drawing"
            :viewBox="layout.viewBox"
            role="img"
            aria-label="A laptop joined through four routers in a row, the main router, a provider router, a middle router and a far router, to a far server. The far router also has a shop server and an address nobody has on its network."
        >
            <line
                v-for="[a, b] in cables"
                :key="`${a}-${b}`"
                class="cable"
                :class="{ lit: litCables.includes(cableKey(a, b)), empty: b === 'nobody' }"
                :x1="at(a)[0]"
                :y1="at(a)[1]"
                :x2="at(b)[0]"
                :y2="at(b)[1]"
            />

            <SvgDevice
                v-for="device in devices"
                :key="device.id"
                :kind="device.kind"
                :x="at(device.id)[0]"
                :y="at(device.id)[1]"
                :label="layout.names[device.id] ? undefined : device.label"
                :note="layout.names[device.id] ? undefined : device.address"
                :lit="litNodes.includes(device.id)"
            />

            <g v-for="device in placedNames" :key="`name-${device.id}`">
                <text class="name" :x="device.place.x" :y="device.place.y" :text-anchor="device.place.anchor">{{ device.label }}</text>
                <text class="address" :x="device.place.x" :y="device.place.y + 16" :text-anchor="device.place.anchor">
                    {{ device.address }}
                </text>
            </g>

            <g :transform="`translate(${at('nobody')[0]} ${at('nobody')[1]})`">
                <rect class="nobody" x="-22" y="-16" width="44" height="32" />
                <text class="nobody-mark" y="6" text-anchor="middle">?</text>
                <text class="name" y="38" text-anchor="middle">Nobody</text>
                <text class="address" y="54" text-anchor="middle">{{ NOBODY_ADDRESS }}</text>
            </g>

            <text
                v-if="silentFound"
                class="silent-tag"
                :x="layout.silentTag.x"
                :y="layout.silentTag.y"
                :text-anchor="layout.silentTag.anchor"
            >
                sends no ICMP notes
            </text>

            <text
                v-if="marker"
                class="marker"
                :class="{ dropped: marker.dropped }"
                :x="at(marker.at)[0]"
                :y="at(marker.at)[1] - 26"
                text-anchor="middle"
            >
                {{ marker.text }}
            </text>

            <g v-if="travelling && packet" :transform="`translate(${position[0]} ${position[1]})`">
                <circle class="packet" :class="packet.kind" r="9" />
                <text class="bubble" y="-16" text-anchor="middle">{{ packet.text }}</text>
            </g>
        </svg>

        <div class="controls">
            <label class="ac-field">
                <span>Command on the laptop</span>
                <select v-model="chosen" class="ac-select" :disabled="busy">
                    <option v-for="item in commands" :key="item.id" :value="item.id">{{ commandLine(item) }}, {{ item.about }}</option>
                </select>
            </label>
            <button type="button" class="ac-button primary" :disabled="busy" @click="run">Run</button>
        </div>

        <p v-if="said" class="ac-say" :class="said.kind" :data-word="said.word" aria-live="polite">{{ said.text }}</p>
        <p v-else-if="busy" class="ac-say hint" aria-live="polite">{{ status }}</p>
        <p v-else class="ac-say hint" aria-live="polite">{{ hint }}</p>

        <CodeView
            v-if="output.length"
            :code="output.join('\n')"
            lang="shell"
            title="The laptop's terminal"
            :highlight="busy ? [output.length] : []"
        />

        <p v-if="output.length" class="caption">
            Printed the way Windows prints it. The times are made up for this drawing; on a real network they differ every time.
            <template v-if="shownKind === 'trace'">
                tracert sends three packets for each TTL, so each row has three times. On macOS and Linux the command is
                <span class="ac-mono">traceroute -n</span>, and each row shows the address before the times, or just
                <span class="ac-mono">3 * * *</span>.
            </template>
        </p>

        <ol v-if="steps.length" class="steps">
            <li v-for="(step, index) in steps" :key="index">{{ step }}</li>
        </ol>
    </div>
</template>

<style scoped>
.cable.empty {
    stroke-dasharray: 6 6;
}

.ac-drawing .name {
    font-size: 13px;
    font-weight: 700;
}

.ac-drawing .address {
    fill: var(--circuit-soft);
    font-family: var(--circuit-mono);
    font-size: 11.5px;
}

.nobody {
    fill: none;
    stroke: var(--circuit-edge);
    stroke-width: 2;
    stroke-dasharray: 5 4;
}

.ac-drawing .nobody-mark {
    fill: var(--circuit-soft);
    font-size: 18px;
    font-weight: 700;
}

.ac-drawing .silent-tag {
    fill: var(--circuit-soft);
    font-size: 12px;
    font-weight: 700;
}

.ac-drawing .marker,
.ac-drawing .bubble {
    paint-order: stroke;
    stroke: var(--circuit-paper);
    stroke-width: 4px;
    font-size: 13px;
    font-weight: 700;
}

.ac-drawing .marker.dropped {
    fill: var(--circuit-removed);
}

.packet.note {
    fill: var(--circuit-paper);
}

.controls {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: 10px;
    margin-top: 10px;
}

.hint {
    color: var(--circuit-soft);
}

.caption {
    margin: -6px 0 0 !important;
    color: var(--circuit-soft);
    font-size: 13.5px;
    line-height: 1.5;
}

.steps {
    margin: 12px 0 0 !important;
    padding-left: 22px !important;
    font-size: 14.5px;
    line-height: 1.5;
}

.steps li {
    margin: 4px 0 0 !important;
}
</style>
