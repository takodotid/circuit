<script setup lang="ts">
// Lesson: roles in a network. The reader gives each device of the full-setup example a role from what is plugged into it, sees it take its place in the drawing, and sees the name and file that follow.

import { computed, ref } from "vue";

type Role = "edge" | "core" | "aggregation" | "access";
type Kind = "border" | "middle" | "rack";

type Device = {
    /** The name the full-setup example gives it. */
    example: string;
    site: "a" | "b";
    /** Its number among devices of the same role at its site, in the example. */
    order: number;
    kind: Kind;
    /** The roles that fit it. The first is the one the example uses. */
    fits: Role[];
    plugged: string;
    x: number;
    y: number;
};

const roles: { id: Role; label: string; prefix: string }[] = [
    { id: "edge", label: "Edge", prefix: "edge" },
    { id: "core", label: "Core", prefix: "core" },
    { id: "aggregation", label: "Aggregation", prefix: "agg" },
    { id: "access", label: "Access, top of rack", prefix: "tor" },
];

const prefixOf = (role: Role) => roles.find((entry) => entry.id === role)!.prefix;

// The order the cards are listed in, so the roles are not given away by the order.
const devices: Device[] = [
    {
        example: "tor-a2",
        site: "a",
        order: 2,
        kind: "rack",
        fits: ["access"],
        plugged: "Site A, rack 4: customers' servers, and one cable up to each of the two switches in the middle of the site.",
        x: 275,
        y: 300,
    },
    {
        example: "edge-a1",
        site: "a",
        order: 1,
        kind: "border",
        fits: ["edge"],
        plugged:
            "Site A, rack 1: transit provider A and the internet exchange, a cable to its twin, and a trunk down to one of the switches in the middle of the site.",
        x: 170,
        y: 62,
    },
    {
        example: "agg-b1",
        site: "b",
        order: 1,
        kind: "middle",
        fits: ["aggregation", "core"],
        plugged:
            "Site B: a trunk up to the edge router, the office's printer and phones, customers' servers, and one rack switch below it.",
        x: 590,
        y: 180,
    },
    {
        example: "core-a2",
        site: "a",
        order: 2,
        kind: "middle",
        fits: ["core", "aggregation"],
        plugged:
            "Site A, rack 2: a bundle up to the second edge router, its twin beside it, and a cable down to every rack switch at the site.",
        x: 380,
        y: 180,
    },
    {
        example: "tor-b1",
        site: "b",
        order: 1,
        kind: "rack",
        fits: ["access"],
        plugged: "Site B, rack 2: customers' servers and six office desks, with one cable up.",
        x: 590,
        y: 300,
    },
    {
        example: "edge-b1",
        site: "b",
        order: 1,
        kind: "border",
        fits: ["edge"],
        plugged: "Site B, rack 1: transit provider C, the leased line to site A, and a trunk down to the switch below it.",
        x: 590,
        y: 62,
    },
    {
        example: "tor-a1",
        site: "a",
        order: 1,
        kind: "rack",
        fits: ["access"],
        plugged: "Site A, rack 3: customers' servers, and one cable up to each of the two switches in the middle of the site.",
        x: 130,
        y: 300,
    },
    {
        example: "core-a1",
        site: "a",
        order: 1,
        kind: "middle",
        fits: ["core", "aggregation"],
        plugged:
            "Site A, rack 1: a trunk up to the first edge router, its twin beside it, the site's own servers, and a cable down to every rack switch.",
        x: 170,
        y: 180,
    },
    {
        example: "edge-a2",
        site: "a",
        order: 2,
        kind: "border",
        fits: ["edge"],
        plugged:
            "Site A, rack 2: transit provider B and the internet exchange, the leased line to site B, and a bundle down to the second switch in the middle of the site.",
        x: 380,
        y: 62,
    },
    {
        example: "tor-a3",
        site: "a",
        order: 3,
        kind: "rack",
        fits: ["access"],
        plugged: "Site A, rack 5: customers' servers on 25G ports, and two cables bundled up to each switch in the middle of the site.",
        x: 420,
        y: 300,
    },
];

// The cables of the example, by the names it uses.
const cables: [string, string][] = [
    ["edge-a1", "edge-a2"],
    ["edge-a1", "core-a1"],
    ["edge-a2", "core-a2"],
    ["edge-a2", "edge-b1"],
    ["core-a1", "core-a2"],
    ["core-a1", "tor-a1"],
    ["core-a1", "tor-a2"],
    ["core-a1", "tor-a3"],
    ["core-a2", "tor-a1"],
    ["core-a2", "tor-a2"],
    ["core-a2", "tor-a3"],
    ["edge-b1", "agg-b1"],
    ["agg-b1", "tor-b1"],
];

const byExample = (name: string) => devices.find((device) => device.example === name)!;

/** The role the reader gave each device, by its example name. */
const chosen = ref<Record<string, Role>>({});
const said = ref<{ kind: "good" | "bad" | "warn"; word: string; text: string }>();

/** Why a role does not fit a kind of device. */
function refusal(kind: Kind, role: Role): string {
    if (kind === "border")
        return "It has a link to a transit provider, so it is where your network meets other networks. That is the edge, whatever else it does.";
    if (role === "edge")
        return "Nothing on it leads to another network: everything around it is your own. The edge is where your network meets others.";
    if (kind === "middle") return "Other switches hang below it, so it is more than a place where servers plug in.";
    return "Nothing hangs below it: servers plug into it, and its cables only go up. The middle layers are what other switches hang from.";
}

/** The name a placed device gets: its role's prefix, its site, and its number among the devices of that role at the site. A device not placed yet counts in the role the example gives it, so names do not shift as the reader goes. */
function nameOf(device: Device): string | undefined {
    const role = chosen.value[device.example];
    if (!role) return undefined;

    const roleOf = (other: Device) => chosen.value[other.example] ?? other.fits[0];
    const sameRole = devices
        .filter((other) => other.site === device.site && roleOf(other) === role)
        .sort((a, b) => a.order - b.order || a.example.localeCompare(b.example));

    return `${prefixOf(role)}-${device.site}${sameRole.indexOf(device) + 1}`;
}

function choose(device: Device, role: Role) {
    if (!device.fits.includes(role)) {
        said.value = { kind: "bad", word: "Not that role", text: refusal(device.kind, role) };
        return;
    }

    chosen.value = { ...chosen.value, [device.example]: role };
    const name = nameOf(device)!;

    said.value =
        role === device.fits[0]
            ? { kind: "good", word: "Placed", text: `It goes into its place in the drawing, and gets the name ${name}.` }
            : {
                  kind: "warn",
                  word: "Also fine",
                  text: `It is named ${name}. The example calls it ${device.example}: in a site with only two layers of switches, the middle one does the work of both the core and aggregation, so either name fits, as long as every site follows the same rule.`,
              };
}

function reset() {
    chosen.value = {};
    said.value = undefined;
}

const placed = computed(() => devices.filter((device) => chosen.value[device.example]));
const done = computed(() => placed.value.length === devices.length);

const shownCables = computed(() =>
    cables.filter(([a, b]) => chosen.value[a] && chosen.value[b]).map(([a, b]) => ({ a: byExample(a), b: byExample(b), key: `${a}-${b}` }))
);

/** Placed devices whose name differs from the example's. */
const renamed = computed(() => placed.value.filter((device) => nameOf(device) !== device.example));

/** The files a Circuit project of this network holds, one per placed device, in a directory per site. */
const files = computed(() => {
    const lines = ["circuit.config.ts", "network.ts", "edge.ts", "switches.ts"];

    for (const site of ["a", "b"] as const) {
        const names = placed.value
            .filter((device) => device.site === site)
            .map((device) => nameOf(device)!)
            .sort();
        lines.push(...names.map((name) => `site-${site}/${name}.ts`));
    }

    return lines.join("\n");
});

const summary = computed(() => {
    if (!done.value) return undefined;

    if (!renamed.value.length)
        return "Every device has a role, and every name matches the one the full-setup example uses. The edge is on top, the middle switches below it, and the racks at the bottom.";

    const changes = renamed.value.map((device) => `${device.example} is ${nameOf(device)}`).join(", ");
    return `Every device has a role. Your names differ from the example's in ${renamed.value.length}: ${changes}. Both work; what matters is that every device is named by one rule.`;
});
</script>

<template>
    <div class="role-placer">
        <svg
            class="ac-drawing"
            viewBox="0 0 700 410"
            role="img"
            :aria-label="`A drawing of two sites in three layers: edge, core and aggregation, and access. ${placed.length} of ${devices.length} devices are placed.`"
        >
            <g class="bands">
                <text x="6" y="22" class="band">EDGE</text>
                <line x1="6" y1="122" x2="694" y2="122" class="rule" />
                <text x="6" y="140" class="band">CORE, AGGREGATION</text>
                <line x1="6" y1="242" x2="694" y2="242" class="rule" />
                <text x="6" y="260" class="band">ACCESS</text>
                <line x1="505" y1="10" x2="505" y2="370" class="site-rule" />
                <text x="275" y="398" text-anchor="middle" class="site">Site A</text>
                <text x="600" y="398" text-anchor="middle" class="site">Site B</text>
            </g>

            <line
                v-for="cable in shownCables"
                :key="cable.key"
                class="cable lit"
                :x1="cable.a.x"
                :y1="cable.a.y"
                :x2="cable.b.x"
                :y2="cable.b.y"
            />

            <SvgDevice
                v-for="device in placed"
                :key="device.example"
                :kind="device.kind === 'border' ? 'router' : 'switch'"
                :x="device.x"
                :y="device.y"
                :label="nameOf(device)"
            />

            <text v-if="!placed.length" x="350" y="190" text-anchor="middle" class="empty">Nothing placed yet</text>
        </svg>

        <p v-if="said" class="ac-say" :class="said.kind" :data-word="said.word" aria-live="polite">{{ said.text }}</p>
        <p v-else class="ac-say hint" aria-live="polite">Read what is plugged into each device below, then give it a role.</p>
        <p v-if="summary" class="summary">{{ summary }}</p>

        <ol class="cards">
            <li v-for="(device, index) in devices" :key="device.example" class="card" :class="{ placed: chosen[device.example] }">
                <p class="plugged">
                    <strong v-if="chosen[device.example]" class="ac-mono">{{ nameOf(device) }}</strong>
                    <strong v-else>Device {{ index + 1 }}</strong>
                    {{ device.plugged }}
                </p>
                <div class="ac-row" role="group" :aria-label="`Role of device ${index + 1}`">
                    <button
                        v-for="role in roles"
                        :key="role.id"
                        type="button"
                        class="ac-button small"
                        :aria-pressed="chosen[device.example] === role.id"
                        @click="choose(device, role.id)"
                    >
                        {{ role.label }}
                    </button>
                </div>
            </li>
        </ol>

        <div class="ac-row">
            <button type="button" class="ac-button small" :disabled="!placed.length" @click="reset">Start over</button>
        </div>

        <CodeView v-if="placed.length" :code="files" lang="text" title="The files follow the names" />
    </div>
</template>

<style scoped>
.ac-drawing .band {
    fill: var(--circuit-soft);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.08em;
}

.ac-drawing .site {
    font-size: 14px;
    font-weight: 700;
}

.ac-drawing .empty {
    fill: var(--circuit-soft);
    font-size: 15px;
}

.rule {
    stroke: var(--circuit-line);
    stroke-width: 1;
}

.site-rule {
    stroke: var(--circuit-edge);
    stroke-width: 1.5;
    stroke-dasharray: 5 6;
}

.hint {
    color: var(--circuit-soft);
}

.summary {
    margin: 8px 0 0;
    font-size: 15px;
}

.cards {
    display: grid;
    gap: 10px;
    margin: 16px 0 12px !important;
    padding: 0 !important;
    list-style: none;
}

.card {
    margin: 0 !important;
    padding: 10px 12px;
    border: 1.5px solid var(--circuit-line);
}

.card.placed {
    border-color: var(--circuit-link);
}

.plugged {
    margin: 0 0 8px !important;
    font-size: 15px;
    line-height: 1.5;
}

.plugged strong {
    margin-right: 6px;
}
</style>
