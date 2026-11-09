<!-- Test a firewall: a packet a person describes, through one of a device's filter chains, rule by rule. The packet is in the page's address, such as `#tools/firewall/device=edge-01&chain=input&protocol=tcp&dst_port=22`, to bookmark or send. -->
<script setup lang="ts">
import { computed, reactive, watch } from "vue";
import type { Protocol } from "../../../../model";
import type { StudioData } from "../../../types";
import { type ConnectionState, Evaluate, type Packet, type TcpFlag } from "../lib/evaluate";
import { Format } from "../lib/format";
import { Net } from "../lib/net";
import { goParams, placeParams } from "../lib/store";
import DataTable from "./DataTable.vue";

const props = defineProps<{ data: StudioData }>();

const PLACE = "tools/firewall";
const CHAINS = ["input", "forward", "output"] as const;
const PROTOCOLS: Protocol[] = ["tcp", "udp", "icmp", "gre", "esp", "ah", "ospf", "vrrp"];
const STATES: ConnectionState[] = ["new", "established", "related", "untracked", "invalid"];
const FLAGS: TcpFlag[] = ["syn", "ack", "fin", "rst", "psh", "urg"];
const FIELDS = [
    "device",
    "chain",
    "family",
    "protocol",
    "src",
    "dst",
    "src_port",
    "dst_port",
    "in",
    "out",
    "state",
    "nat",
    "flags",
] as const;

const asked = computed(() => placeParams(PLACE));

const withChains = computed(() => props.data.devices.filter((device) => device.firewall?.filter));
const form = reactive(Object.fromEntries(FIELDS.map((field) => [field, ""])) as Record<(typeof FIELDS)[number], string>);
const flags = reactive<Record<string, boolean>>({});

// The form shows what the address asks, so a bookmark or the Back button fills it in.
watch(
    asked,
    (params) => {
        for (const field of FIELDS) form[field] = params.get(field) ?? "";
        if (!form.device) form.device = withChains.value[0]?.name ?? props.data.devices[0]?.name ?? "";
        if (!form.chain) form.chain = "input";
        const ticked = (params.get("flags") ?? "").split(",");
        for (const flag of FLAGS) flags[flag] = ticked.includes(flag);
    },
    { immediate: true }
);

function test(): void {
    form.flags = FLAGS.filter((flag) => flags[flag]).join(",");
    const params = new URLSearchParams(FIELDS.filter((field) => form[field].trim()).map((field) => [field, form[field].trim()]));
    goParams(PLACE, params);
}

const device = computed(() => props.data.devices.find((candidate) => candidate.name === form.device));
const interfaces = computed(() =>
    Object.values(device.value?.interfaces ?? {}).flatMap((group) => Object.keys((group ?? {}) as Record<string, unknown>))
);

/** The packet the address describes, or what is wrong with it. */
const packet = computed<{ packet?: Packet; problems: string[] }>(() => {
    const params = asked.value;
    if (!params.get("device")) return { problems: [] };

    const problems: string[] = [];
    const text = (key: string) => params.get(key) || undefined;
    const address = (key: string, label: string) => {
        const value = text(key);
        if (value && !Net.parseAddress(value)) problems.push(`The ${label} is not one address, such as 192.0.2.5 or 2001:db8::5.`);
        return value;
    };
    const port = (key: string, label: string) => {
        const value = text(key);
        if (value === undefined) return undefined;
        const number = Number(value);
        if (!Number.isInteger(number) || number < 0 || number > 65535) problems.push(`The ${label} is a number from 0 to 65535.`);
        return number;
    };

    const src = address("src", "source");
    const dst = address("dst", "destination");
    if (src && dst && Net.parseAddress(src)?.family !== Net.parseAddress(dst)?.family)
        problems.push("The source and the destination are of different families.");

    const found: Packet = {
        ...(text("family") ? { family: text("family") as Packet["family"] } : {}),
        ...(text("protocol") ? { protocol: text("protocol") as Protocol } : {}),
        ...(src ? { src } : {}),
        ...(dst ? { dst } : {}),
        ...(text("src_port") ? { srcPort: port("src_port", "source port") } : {}),
        ...(text("dst_port") ? { dstPort: port("dst_port", "destination port") } : {}),
        ...(text("in") ? { inInterface: text("in") } : {}),
        ...(text("out") ? { outInterface: text("out") } : {}),
        ...(text("state") ? { state: text("state") as ConnectionState } : {}),
        ...(text("nat") ? { nat: text("nat") as Packet["nat"] } : {}),
        ...(text("flags") ? { flags: text("flags")!.split(",") as TcpFlag[] } : {}),
    };
    return problems.length ? { problems } : { packet: found, problems };
});

const tested = computed(() => {
    const own = props.data.devices.find((candidate) => candidate.name === asked.value.get("device"));
    const chain = asked.value.get("chain") as (typeof CHAINS)[number];
    if (!own || !packet.value.packet || !CHAINS.includes(chain)) return undefined;
    return { device: own, chain, has: Boolean(own.firewall?.filter?.[chain]), ...Evaluate.firewall(own, chain, packet.value.packet) };
});

const VERDICTS = { accept: "Accepted", drop: "Dropped", reject: "Rejected" } as const;
</script>

<template>
    <p class="muted">
        Describe a packet, and Studio walks the chain's rules in order and shows whether each one matches it and why not. The first rule
        that matches decides; when none does, the chain's <code>default_action</code> does, and a chain with none accepts. A rule written
        with a list, such as several sources or an interface set, is one rule per value here, as the device gets it.
    </p>
    <form class="tool-form" @submit.prevent="test">
        <label class="field"
            >Device
            <select v-model="form.device">
                <option v-for="one in data.devices" :key="one.name" :value="one.name">{{ one.name }}</option>
            </select>
        </label>
        <label class="field"
            >Chain
            <select v-model="form.chain">
                <option v-for="chain in CHAINS" :key="chain" :value="chain">
                    {{ chain }}{{ device?.firewall?.filter?.[chain] ? "" : " (none)" }}
                </option>
            </select>
        </label>
        <label class="field"
            >Protocol
            <select v-model="form.protocol">
                <option value="">not given</option>
                <option v-for="protocol in PROTOCOLS" :key="protocol">{{ protocol }}</option>
            </select>
        </label>
        <label class="field"
            >Family
            <select v-model="form.family">
                <option value="">from the addresses</option>
                <option value="ipv4">ipv4</option>
                <option value="ipv6">ipv6</option>
            </select>
        </label>
        <label class="field">Source <input v-model="form.src" placeholder="198.51.100.7" /></label>
        <label class="field">Destination <input v-model="form.dst" placeholder="192.0.2.1" /></label>
        <label class="field">Source port <input v-model="form.src_port" inputmode="numeric" placeholder="51000" /></label>
        <label class="field">Destination port <input v-model="form.dst_port" inputmode="numeric" placeholder="22" /></label>
        <label class="field">Arrives on <input v-model="form.in" list="firewall-interfaces" placeholder="an interface" /> </label>
        <label class="field">Leaves through <input v-model="form.out" list="firewall-interfaces" placeholder="an interface" /> </label>
        <datalist id="firewall-interfaces">
            <option v-for="name in interfaces" :key="name" :value="name" />
        </datalist>
        <label class="field"
            >Connection state
            <select v-model="form.state">
                <option value="">not given</option>
                <option v-for="state in STATES" :key="state">{{ state }}</option>
            </select>
        </label>
        <label class="field"
            >Translated by
            <select v-model="form.nat">
                <option value="">not given</option>
                <option value="none">no translation</option>
                <option value="srcnat">srcnat</option>
                <option value="dstnat">dstnat</option>
                <option value="both">both</option>
            </select>
        </label>
        <fieldset class="field">
            <legend>TCP flags set</legend>
            <span class="flags">
                <label v-for="flag in FLAGS" :key="flag" class="flag"><input v-model="flags[flag]" type="checkbox" /> {{ flag }}</label>
            </span>
        </fieldset>
        <button class="primary" type="submit">Test</button>
    </form>

    <ul v-if="packet.problems.length" class="findings">
        <li v-for="problem in packet.problems" :key="problem"><span class="badge error">fix</span>{{ problem }}</li>
    </ul>

    <template v-if="tested">
        <p v-if="!tested.has" class="muted">{{ tested.device.name }} has no {{ tested.chain }} chain in the project.</p>
        <p v-if="tested.verdict" :class="['verdict', tested.verdict]">{{ VERDICTS[tested.verdict] }}, by {{ tested.by }}.</p>
        <p v-else class="verdict unknown">Stopped at {{ tested.by }}: it needs {{ tested.needs.join(", and ") }}. Fill that in to go on.</p>
        <DataTable
            v-if="tested.steps.length"
            :head="['Rule', 'Description', 'If', 'Then', 'Matches']"
            :rows="
                tested.steps.map((step) => ({
                    muted: step.check.answer === 'no',
                    cells: [
                        step.rule,
                        step.written.description,
                        step.written.if ? Format.compact(step.written.if) : 'every packet',
                        step.written.then,
                        step.check.answer === 'yes'
                            ? 'matches'
                            : step.check.answer === 'no'
                              ? `no: ${step.check.why.join('; ')}`
                              : `needs ${step.check.why.join(', ')}`,
                    ],
                }))
            "
            :csv="`${tested.device.name}-${tested.chain}-test`"
        />
    </template>
</template>
