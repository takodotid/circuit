<script setup lang="ts">
// Lesson: ports and protocols. The reader sends requests from a laptop to different port numbers on one server, and sees which program answers each one, or that nobody does.

import { computed, ref } from "vue";
import { useTravel, type Point } from "../travel";
import { useNarrow } from "./SwitchLearning";

type Program = {
    port: number;
    name: string;
    /** The program, as named in a sentence. */
    said: string;
};

const programs: Program[] = [
    { port: 22, name: "Remote login (SSH)", said: "the remote login program, SSH" },
    { port: 25, name: "Mail delivery", said: "the mail program, which takes mail from other mail servers" },
    { port: 53, name: "DNS answers", said: "the DNS program, which answers questions about names" },
    { port: 80, name: "Web pages", said: "the web program, sending pages without a lock" },
    { port: 443, name: "Web pages, locked", said: "the web program, sending pages locked" },
];

type Layout = {
    viewBox: string;
    laptop: Point;
    /** Where the cable meets the server. */
    door: Point;
    box: { x: number; y: number; width: number; height: number };
    /** The middle height of each program's row. */
    rows: number[];
};

const layouts: Record<"wide" | "narrow", Layout> = {
    wide: {
        viewBox: "0 0 560 300",
        laptop: [70, 150],
        door: [250, 150],
        box: { x: 250, y: 14, width: 300, height: 276 },
        rows: [72, 114, 156, 198, 240],
    },
    narrow: {
        viewBox: "0 0 360 420",
        laptop: [80, 50],
        door: [180, 132],
        box: { x: 20, y: 132, width: 320, height: 280 },
        rows: [190, 232, 274, 316, 358],
    },
};

const narrow = useNarrow();
const layout = computed(() => layouts[narrow.value ? "narrow" : "wide"]);

/** The point inside the server where a program's port number sits. */
const portPoint = (index: number): Point => [layout.value.box.x + 46, layout.value.rows[index]!];

const port = ref("443");
const ownPort = ref(51000);
const lastRequest = ref<{ from: number; to: number }>();
const litIndex = ref<number>();
const said = ref<{ kind: "good" | "bad"; word?: string; text: string }>();

const { position, travelling, travel } = useTravel(320);

function choose(value: number) {
    port.value = String(value);
    send();
}

async function send() {
    if (travelling.value) return;

    const text = port.value.trim();
    const number = Number(text);

    if (!/^\d+$/.test(text) || number > 65535) {
        said.value = { kind: "bad", word: "Not a port", text: "A port is a whole number from 0 to 65535. Try 443, 22 or 53." };
        litIndex.value = undefined;
        return;
    }

    ownPort.value += 1;
    lastRequest.value = { from: ownPort.value, to: number };
    said.value = undefined;
    litIndex.value = undefined;

    const index = programs.findIndex((program) => program.port === number);
    const { laptop, door } = layout.value;

    if (index < 0) {
        await travel([laptop, door]);
        await travel([door, laptop]);
        said.value = {
            kind: "bad",
            word: "Nobody there",
            text: `The packet reached 203.0.113.80, but no program on it listens on port ${number}. The server answers that nobody is there, and the laptop gives up.`,
        };
        return;
    }

    const target = portPoint(index);
    await travel([laptop, door, [door[0], target[1]], target]);
    litIndex.value = index;
    await travel([target, [door[0], target[1]], door, laptop]);

    said.value = {
        kind: "good",
        word: "Answered",
        text: `Port ${number} on 203.0.113.80 reached ${programs[index]!.said}. It answered to port ${ownPort.value} on the laptop, the port the laptop picked for this conversation.`,
    };
}
</script>

<template>
    <div class="server-ports">
        <svg
            class="ac-drawing"
            :viewBox="layout.viewBox"
            role="img"
            aria-label="A laptop joined to one server at 203.0.113.80, which runs five programs, each behind its own port number."
        >
            <line
                class="cable"
                :class="{ lit: travelling || litIndex !== undefined }"
                :x1="layout.laptop[0]"
                :y1="layout.laptop[1]"
                :x2="layout.door[0]"
                :y2="layout.door[1]"
            />
            <SvgDevice kind="laptop" :x="layout.laptop[0]" :y="layout.laptop[1]" label="Your laptop" note="192.168.1.20" />

            <rect class="server" :x="layout.box.x" :y="layout.box.y" :width="layout.box.width" :height="layout.box.height" />
            <text class="server-name" :x="layout.box.x + 14" :y="layout.box.y + 26">
                Server
                <tspan class="mono">203.0.113.80</tspan>
            </text>

            <g v-for="(program, index) in programs" :key="program.port" class="program" :class="{ lit: litIndex === index }">
                <rect class="number" :x="layout.box.x + 18" :y="layout.rows[index] - 15" width="56" height="30" />
                <text class="mono" :x="layout.box.x + 46" :y="layout.rows[index] + 5" text-anchor="middle">{{ program.port }}</text>
                <text class="name" :x="layout.box.x + 88" :y="layout.rows[index] + 5">{{ program.name }}</text>
            </g>

            <circle v-if="travelling" class="packet" :cx="position[0]" :cy="position[1]" r="9" />
        </svg>

        <div class="send">
            <label class="ac-field">
                <span>Send a request to 203.0.113.80, port</span>
                <input
                    v-model="port"
                    class="ac-input mono"
                    inputmode="numeric"
                    spellcheck="false"
                    :aria-invalid="said?.word === 'Not a port'"
                    @keydown.enter="send"
                />
            </label>
            <button type="button" class="ac-button primary" :disabled="travelling" @click="send">Send</button>
        </div>
        <div class="ac-row presets">
            <button
                v-for="value in [443, 80, 22, 53, 25, 8080]"
                :key="value"
                type="button"
                class="ac-button small"
                :disabled="travelling"
                @click="choose(value)"
            >
                Port {{ value }}
            </button>
        </div>

        <p v-if="lastRequest" class="request">
            From <span class="ac-mono">192.168.1.20:{{ lastRequest.from }}</span> to
            <span class="ac-mono">203.0.113.80:{{ lastRequest.to }}</span>
        </p>

        <p v-if="said" class="ac-say" :class="said.kind" :data-word="said.word" aria-live="polite">{{ said.text }}</p>
        <p v-else-if="travelling" class="ac-say hint" aria-live="polite">The request is on its way.</p>
        <p v-else class="ac-say hint" aria-live="polite">
            Send a request to port 443, then 22, then to a port with nothing on it, such as 8080.
        </p>
    </div>
</template>

<style scoped>
.server {
    fill: var(--circuit-mist);
    stroke: var(--circuit-ink);
    stroke-width: 2;
}

.server-name {
    font-size: 14px;
    font-weight: 700;
}

.mono {
    font-family: var(--circuit-mono);
}

.program .number {
    fill: var(--circuit-paper);
    stroke: var(--circuit-ink);
    stroke-width: 1.5;
    transition: fill 0.25s;
}

.program text.mono {
    font-size: 14px;
    font-weight: 700;
}

.program .name {
    font-size: 14px;
}

.program.lit .number {
    fill: var(--circuit-yellow);
}

.program.lit text.mono {
    fill: #0a1a36;
}

.program.lit .name {
    font-weight: 700;
}

.send {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: 10px;
    margin-top: 10px;
}

.send .ac-input {
    width: 8em;
}

.presets {
    margin-top: 8px;
}

.request {
    margin: 12px 0 0 !important;
    font-size: 14.5px;
}

.hint {
    color: var(--circuit-soft);
}
</style>
