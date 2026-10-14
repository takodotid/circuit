<script setup lang="ts">
// Lesson: choosing a device. For a link from the full-setup example, the reader picks an optic for each end and the fibre between them, and the link comes up or is refused with the reason.

import { computed, ref, watch } from "vue";

type Cage = "SFP+" | "SFP28" | "QSFP+" | "QSFP28";
type Fibre = "OM3" | "OM4" | "OS2";

type Optic = {
    name: string;
    form: Cage;
    gigabits: number;
    medium: "multimode" | "single mode";
    /** How far it reaches on each kind of fibre, in metres. */
    reach: Partial<Record<Fibre, number>>;
    /** Fibres in the cable, both directions together. */
    fibres: number;
};

// Reaches as Wikipedia's pages on 10, 25, 40 and 100 Gigabit Ethernet give them.
const optics: Optic[] = [
    { name: "10GBASE-SR", form: "SFP+", gigabits: 10, medium: "multimode", reach: { OM3: 300, OM4: 400 }, fibres: 2 },
    { name: "10GBASE-LR", form: "SFP+", gigabits: 10, medium: "single mode", reach: { OS2: 10_000 }, fibres: 2 },
    { name: "25GBASE-SR", form: "SFP28", gigabits: 25, medium: "multimode", reach: { OM3: 70, OM4: 100 }, fibres: 2 },
    { name: "25GBASE-LR", form: "SFP28", gigabits: 25, medium: "single mode", reach: { OS2: 10_000 }, fibres: 2 },
    { name: "40GBASE-SR4", form: "QSFP+", gigabits: 40, medium: "multimode", reach: { OM3: 100, OM4: 150 }, fibres: 8 },
    { name: "40GBASE-LR4", form: "QSFP+", gigabits: 40, medium: "single mode", reach: { OS2: 10_000 }, fibres: 2 },
    { name: "100GBASE-SR4", form: "QSFP28", gigabits: 100, medium: "multimode", reach: { OM3: 70, OM4: 100 }, fibres: 8 },
    { name: "100GBASE-LR4", form: "QSFP28", gigabits: 100, medium: "single mode", reach: { OS2: 10_000 }, fibres: 2 },
    { name: "100GBASE-ER4", form: "QSFP28", gigabits: 100, medium: "single mode", reach: { OS2: 40_000 }, fibres: 2 },
];

const fibreNames: Record<Fibre, string> = {
    OM3: "OM3 multimode",
    OM4: "OM4 multimode",
    OS2: "OS2 single mode",
};

type End = {
    device: string;
    kind: "router" | "switch" | "server";
    /** The port's name in Circuit, when the device is ours. */
    port?: string;
    /** What the platform calls the port. */
    spelled: string;
    cage: Cage;
    /** The speed the port runs at without being told, in Gbit/s. */
    gigabits: number;
};

type Link = { id: string; title: string; metres: number; fibres: Fibre[]; why: string; a: End; b: End };

const links: Link[] = [
    {
        id: "edge-core",
        title: "edge-a1 to core-a1",
        metres: 25,
        fibres: ["OM3", "OM4", "OS2"],
        why: "Across the room, from the router's 100G port to the switch's 40G port.",
        a: { device: "edge-a1", kind: "router", port: "100g-2", spelled: "qsfp28-2-1", cage: "QSFP28", gigabits: 100 },
        b: { device: "core-a1", kind: "switch", port: "40g-1", spelled: "40GE1/0/1", cage: "QSFP+", gigabits: 40 },
    },
    {
        id: "edge2-core2",
        title: "edge-a2 to core-a2",
        metres: 10,
        fibres: ["OM3", "OM4", "OS2"],
        why: "In the next rack, from the router's 25G port to the switch's 10G port.",
        a: { device: "edge-a2", kind: "router", port: "25g-3", spelled: "sfp28-3", cage: "SFP28", gigabits: 25 },
        b: { device: "core-a2", kind: "switch", port: "10g-1", spelled: "10GE1/0/1", cage: "SFP+", gigabits: 10 },
    },
    {
        id: "tor-server",
        title: "tor-a3 to a server",
        metres: 3,
        fibres: ["OM3", "OM4", "OS2"],
        why: "In the same rack, to a customer's server with a 25G card.",
        a: { device: "tor-a3", kind: "switch", port: "25g-1", spelled: "twenty-fivegige 1/2/1", cage: "SFP28", gigabits: 25 },
        b: { device: "Server", kind: "server", spelled: "a 25G card", cage: "SFP28", gigabits: 25 },
    },
    {
        id: "edge-transit",
        title: "edge-a1 to transit A",
        metres: 2_000,
        fibres: ["OS2"],
        why: "To transit provider A's router in another building, 2 km away. The fibre between the buildings is single mode.",
        a: { device: "edge-a1", kind: "router", port: "25g-1", spelled: "sfp28-1", cage: "SFP28", gigabits: 25 },
        b: { device: "Transit A", kind: "router", spelled: "a 25G port", cage: "SFP28", gigabits: 25 },
    },
];

const linkId = ref(links[0]!.id);
const link = computed(() => links.find((entry) => entry.id === linkId.value)!);

const opticA = ref("");
const opticB = ref("");
const fibre = ref<Fibre>("OM4");
const tried = ref(false);

watch(linkId, () => {
    opticA.value = "";
    opticB.value = "";
    fibre.value = link.value.fibres.includes("OM4") ? "OM4" : link.value.fibres[0]!;
    tried.value = false;
});

watch([opticA, opticB, fibre], () => {
    tried.value = false;
});

const find = (name: string) => optics.find((optic) => optic.name === name);

/** Whether an optic goes into a cage and runs there. A newer cage also takes the older optic of its shape. */
function fits(cage: Cage, optic: Optic): boolean {
    return cage === optic.form || (cage === "SFP28" && optic.form === "SFP+") || (cage === "QSFP28" && optic.form === "QSFP+");
}

function cageProblem(end: End, optic: Optic): string {
    const shapeOf = (form: Cage) => (form.startsWith("Q") ? "QSFP" : "SFP");
    if (shapeOf(end.cage) !== shapeOf(optic.form))
        return `${optic.name} is a ${optic.form} optic, and ${end.device}'s port is a ${end.cage} cage. ${shapeOf(optic.form)} and ${shapeOf(end.cage)} are different shapes, so it does not go in.`;
    return `${optic.name} is a ${optic.gigabits}G ${optic.form} optic, and ${end.device}'s port is a ${end.gigabits}G ${end.cage} cage, which cannot run it. Use a ${end.gigabits}G optic there.`;
}

const metres = (value: number) => (value >= 1000 ? `${value / 1000} km` : `${value} m`);

type Result = { ok: boolean; text: string; notes: string[] };

const result = computed<Result | undefined>(() => {
    const a = find(opticA.value);
    const b = find(opticB.value);
    if (!a || !b) return undefined;

    const { a: endA, b: endB } = link.value;

    if (!fits(endA.cage, a)) return { ok: false, text: cageProblem(endA, a), notes: [] };
    if (!fits(endB.cage, b)) return { ok: false, text: cageProblem(endB, b), notes: [] };

    if (a.name !== b.name) {
        const why =
            a.gigabits !== b.gigabits
                ? "They do not even run at the same speed."
                : a.medium !== b.medium
                  ? `One is made for ${a.medium} fibre and the other for ${b.medium}, and they send light differently.`
                  : "They send light differently.";
        return {
            ok: false,
            text: `${a.name} at one end and ${b.name} at the other cannot hear each other: both ends must be the same standard. ${why}`,
            notes: [],
        };
    }

    const reach = a.reach[fibre.value];
    if (reach === undefined) {
        const wanted = a.medium === "multimode" ? "multimode (OM3 or OM4)" : "single-mode (OS2)";
        return {
            ok: false,
            text: `${a.name} is made for ${wanted} fibre, and this is ${fibreNames[fibre.value]}. The light does not travel in it the way the optic needs.`,
            notes: [],
        };
    }

    if (reach < link.value.metres)
        return {
            ok: false,
            text: `${a.name} reaches ${metres(reach)} on ${fibre.value}, and this run is ${metres(link.value.metres)}. Past its reach, the far end cannot read the signal reliably.`,
            notes: [],
        };

    const notes: string[] = [];
    if (a.fibres === 8) notes.push(`${a.name} sends on eight fibres, four each way, so the cable is an MPO trunk, not a duplex pair.`);

    const slower = [endA, endB].filter((end) => end.gigabits > a.gigabits);
    for (const end of slower) {
        notes.push(
            end.port
                ? `${end.device}'s ${end.cage} cage has a slower ${a.form} optic in it. Say so in its file with speed: "${a.gigabits}g".`
                : `${end.device}'s ${end.cage} cage has a slower ${a.form} optic in it, so it must be set to ${a.gigabits}G too.`
        );
    }

    return {
        ok: true,
        text: `The link comes up at ${a.gigabits} Gbit/s. ${a.name} reaches ${metres(reach)} on ${fibre.value}, and this run is ${metres(link.value.metres)}.`,
        notes,
    };
});

const said = computed(() => {
    if (!tried.value) return undefined;
    if (!result.value) return { kind: "warn", word: "Pick both", text: "Pick an optic for each end first." };
    return result.value.ok
        ? { kind: "good", word: "Link up", text: result.value.text }
        : { kind: "bad", word: "No link", text: result.value.text };
});

/** The ports in Circuit, once the link is up: ours only, with the speed where an optic is slower than its cage. */
const code = computed(() => {
    if (!tried.value || !result.value?.ok) return "";
    const optic = find(opticA.value)!;
    const { a, b } = link.value;

    const line = (end: End, other: End) => {
        const fields = [`description: "${other.device}"`];
        if (end.gigabits > optic.gigabits) fields.push(`speed: "${optic.gigabits}g"`);
        if (other.port) fields.push(`link: { device: "${other.device}", port: "${other.port}" }`);
        return [`// ${end.device}.ts, its port ${end.spelled}`, `"${end.port}": { ${fields.join(", ")} },`];
    };

    return [...line(a, b), ...(b.port ? ["", ...line(b, a)] : [])].join("\n");
});

const lightLink = () => (tried.value = true);
</script>

<template>
    <div class="optic-matcher">
        <div class="ac-row" role="group" aria-label="Which link">
            <button
                v-for="entry in links"
                :key="entry.id"
                type="button"
                class="ac-button small"
                :aria-pressed="linkId === entry.id"
                @click="linkId = entry.id"
            >
                {{ entry.title }}
            </button>
        </div>
        <p class="why">{{ link.why }}</p>

        <svg
            class="ac-drawing"
            viewBox="0 0 700 190"
            role="img"
            :aria-label="`${link.a.device}, a ${link.a.cage} cage, joined by ${metres(link.metres)} of fibre to ${link.b.device}, a ${link.b.cage} cage.`"
        >
            <line class="cable" :class="{ lit: said?.kind === 'good', broken: said?.kind === 'bad' }" x1="115" y1="70" x2="585" y2="70" />
            <text x="350" y="58" text-anchor="middle" class="run">{{ metres(link.metres) }}, {{ fibreNames[fibre] }}</text>

            <rect class="optic" :class="{ empty: !opticA }" x="160" y="58" width="34" height="24" />
            <rect class="optic" :class="{ empty: !opticB }" x="506" y="58" width="34" height="24" />
            <text x="177" y="108" text-anchor="middle" class="optic-name">{{ opticA || "no optic" }}</text>
            <text x="523" y="108" text-anchor="middle" class="optic-name">{{ opticB || "no optic" }}</text>

            <SvgDevice
                :kind="link.a.kind"
                :x="85"
                :y="70"
                :label="link.a.device"
                :note="[link.a.port, link.a.cage].filter(Boolean).join(' ')"
            />
            <SvgDevice
                :kind="link.b.kind"
                :x="615"
                :y="70"
                :label="link.b.device"
                :note="[link.b.port, link.b.cage].filter(Boolean).join(' ')"
            />
        </svg>

        <div class="ac-row pick">
            <label class="ac-field">
                <span>Optic in {{ link.a.device }}</span>
                <select v-model="opticA" class="ac-select">
                    <option value="" disabled>Choose an optic</option>
                    <option v-for="optic in optics" :key="optic.name" :value="optic.name">{{ optic.name }}, {{ optic.form }}</option>
                </select>
            </label>
            <label class="ac-field">
                <span>Fibre</span>
                <select v-model="fibre" class="ac-select">
                    <option v-for="kind in link.fibres" :key="kind" :value="kind">{{ fibreNames[kind] }}</option>
                </select>
            </label>
            <label class="ac-field">
                <span>Optic in {{ link.b.device }}</span>
                <select v-model="opticB" class="ac-select">
                    <option value="" disabled>Choose an optic</option>
                    <option v-for="optic in optics" :key="optic.name" :value="optic.name">{{ optic.name }}, {{ optic.form }}</option>
                </select>
            </label>
            <button type="button" class="ac-button primary" @click="lightLink">Light the link</button>
        </div>

        <p v-if="said" class="ac-say" :class="said.kind" :data-word="said.word" aria-live="polite">{{ said.text }}</p>
        <p v-else class="ac-say hint" aria-live="polite">Pick an optic for each end and the fibre, then light the link.</p>
        <ul v-if="said && result?.notes.length" class="notes">
            <li v-for="note in result.notes" :key="note">{{ note }}</li>
        </ul>

        <CodeView v-if="code" :code="code" title="The ports in Circuit" />
    </div>
</template>

<style scoped>
.why {
    margin: 8px 0 0;
    color: var(--circuit-soft);
    font-size: 15px;
}

.ac-drawing .run {
    fill: var(--circuit-soft);
    font-size: 12.5px;
}

.ac-drawing .optic-name {
    font-family: var(--circuit-mono);
    font-size: 11.5px;
}

.optic {
    fill: var(--circuit-yellow);
    stroke: #0a1a36;
    stroke-width: 1.5;
}

.optic.empty {
    fill: var(--circuit-paper);
    stroke: var(--circuit-edge);
    stroke-dasharray: 3 3;
}

.cable.broken {
    stroke: var(--circuit-removed);
    stroke-dasharray: 8 6;
}

.pick {
    align-items: end;
    margin-top: 6px;
}

.notes {
    margin: 8px 0 0 !important;
}

.notes li {
    font-size: 15px;
}

.hint {
    color: var(--circuit-soft);
}
</style>
