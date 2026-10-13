<script setup lang="ts">
// Lesson: firewalls. The reader reorders, changes, removes and adds rules, sends test packets through them, and sees which rule matched first, or the default, until every packet gets what it should.

import { computed, ref } from "vue";
import { useTravel, type Point } from "../travel";

const props = withDefaults(
    defineProps<{
        /** `forward` shows only traffic through the router; `both` adds traffic to the router itself, with the forward chain already fixed. */
        part?: "forward" | "both";
    }>(),
    { part: "forward" }
);

type Interface = "home" | "guests" | "mgmt" | "1g-1";
type ChainName = "input" | "forward";
type Action = "accept" | "drop";
type State = "new" | "established" | "related";

type Match = {
    in_interface?: Interface;
    out_interface?: Interface;
    src?: string;
    protocol?: "tcp" | "udp" | "icmp";
    dst_port?: number;
    state?: State[];
};

type Rule = { id: string; chain: ChainName; description: string; match: Match; action: Action };

/** A packet to test. Without `out` it is for the router itself. */
type Packet = {
    id: string;
    title: string;
    in: Interface;
    out?: Interface;
    src: string;
    dst: string;
    protocol: "tcp" | "udp";
    srcPort: number;
    dstPort: number;
    state: State;
    should: Action;
    /** A reply exists only if the packet it answers was let through. */
    answers?: string;
};

const MANAGEMENT = "192.168.10.0/24";

/** Every rule the reader can use, each in the chain it belongs to. */
const library: Rule[] = [
    { id: "f-replies", chain: "forward", description: "Replies", match: { state: ["established", "related"] }, action: "accept" },
    { id: "f-guests-anywhere", chain: "forward", description: "Guests to anywhere", match: { in_interface: "guests" }, action: "accept" },
    {
        id: "f-guests-home",
        chain: "forward",
        description: "Guests stay off the home network",
        match: { in_interface: "guests", out_interface: "home" },
        action: "drop",
    },
    {
        id: "f-guests-mgmt",
        chain: "forward",
        description: "Guests stay off management",
        match: { in_interface: "guests", out_interface: "mgmt" },
        action: "drop",
    },
    {
        id: "f-home-internet",
        chain: "forward",
        description: "Home to the internet",
        match: { in_interface: "home", out_interface: "1g-1" },
        action: "accept",
    },
    {
        id: "f-guests-internet",
        chain: "forward",
        description: "Guests to the internet",
        match: { in_interface: "guests", out_interface: "1g-1" },
        action: "accept",
    },
    {
        id: "f-internet-anywhere",
        chain: "forward",
        description: "Anything from the internet",
        match: { in_interface: "1g-1" },
        action: "accept",
    },
    { id: "i-replies", chain: "input", description: "Replies", match: { state: ["established", "related"] }, action: "accept" },
    { id: "i-ping", chain: "input", description: "Ping", match: { protocol: "icmp" }, action: "accept" },
    { id: "i-ssh-anywhere", chain: "input", description: "SSH from anywhere", match: { protocol: "tcp", dst_port: 22 }, action: "accept" },
    { id: "i-management", chain: "input", description: "Management", match: { src: MANAGEMENT }, action: "accept" },
    {
        id: "i-dns-home",
        chain: "input",
        description: "DNS from home",
        match: { in_interface: "home", protocol: "udp", dst_port: 53 },
        action: "accept",
    },
    {
        id: "i-dns-guests",
        chain: "input",
        description: "DNS from guests",
        match: { in_interface: "guests", protocol: "udp", dst_port: 53 },
        action: "accept",
    },
];

const allPackets: Packet[] = [
    {
        id: "web",
        title: "The laptop opens a website",
        in: "home",
        out: "1g-1",
        src: "192.168.20.10",
        dst: "198.51.100.7",
        protocol: "tcp",
        srcPort: 51000,
        dstPort: 443,
        state: "new",
        should: "accept",
    },
    {
        id: "web-reply",
        title: "The website answers the laptop",
        in: "1g-1",
        out: "home",
        src: "198.51.100.7",
        dst: "192.168.20.10",
        protocol: "tcp",
        srcPort: 443,
        dstPort: 51000,
        state: "established",
        should: "accept",
        answers: "web",
    },
    {
        id: "guest-web",
        title: "A guest phone opens a website",
        in: "guests",
        out: "1g-1",
        src: "192.168.30.57",
        dst: "198.51.100.7",
        protocol: "tcp",
        srcPort: 52000,
        dstPort: 443,
        state: "new",
        should: "accept",
    },
    {
        id: "guest-printer",
        title: "A guest phone opens the home printer’s page",
        in: "guests",
        out: "home",
        src: "192.168.30.57",
        dst: "192.168.20.40",
        protocol: "tcp",
        srcPort: 52001,
        dstPort: 443,
        state: "new",
        should: "drop",
    },
    {
        id: "stranger-laptop",
        title: "A stranger tries to log in to the laptop",
        in: "1g-1",
        out: "home",
        src: "192.0.2.66",
        dst: "192.168.20.10",
        protocol: "tcp",
        srcPort: 53000,
        dstPort: 22,
        state: "new",
        should: "drop",
    },
    {
        id: "admin-ssh",
        title: "You log in to the router from the management network",
        in: "mgmt",
        src: "192.168.10.20",
        dst: "192.168.10.1",
        protocol: "tcp",
        srcPort: 50500,
        dstPort: 22,
        state: "new",
        should: "accept",
    },
    {
        id: "stranger-ssh",
        title: "A stranger tries to log in to the router",
        in: "1g-1",
        src: "192.0.2.66",
        dst: "203.0.113.2",
        protocol: "tcp",
        srcPort: 53001,
        dstPort: 22,
        state: "new",
        should: "drop",
    },
    {
        id: "guest-ssh",
        title: "A guest phone tries to log in to the router",
        in: "guests",
        src: "192.168.30.57",
        dst: "192.168.30.1",
        protocol: "tcp",
        srcPort: 52002,
        dstPort: 22,
        state: "new",
        should: "drop",
    },
    {
        id: "home-dns",
        title: "The laptop asks the router for a name (DNS)",
        in: "home",
        src: "192.168.20.10",
        dst: "192.168.20.1",
        protocol: "udp",
        srcPort: 51001,
        dstPort: 53,
        state: "new",
        should: "accept",
    },
    {
        id: "router-dns",
        title: "An answer to the router’s own DNS question",
        in: "1g-1",
        src: "198.51.100.53",
        dst: "203.0.113.2",
        protocol: "udp",
        srcPort: 53,
        dstPort: 50123,
        state: "established",
        should: "accept",
    },
];

const packets = props.part === "forward" ? allPackets.filter((packet) => packet.out) : allPackets;

const ruleById = (id: string) => library.find((rule) => rule.id === id)!;

/** What each chain holds at the start: the forward chain with three mistakes in the first part, fixed in the second, where the input chain has its own. */
function startingChains() {
    if (props.part === "forward") {
        return {
            forward: {
                rules: ["f-guests-anywhere", "f-guests-home", "f-home-internet"].map((id) => ({ ...ruleById(id) })),
                default: "accept" as Action,
            },
            input: { rules: [] as Rule[], default: "drop" as Action },
        };
    }

    return {
        forward: {
            rules: ["f-replies", "f-guests-home", "f-guests-mgmt", "f-home-internet", "f-guests-internet"].map((id) => ({
                ...ruleById(id),
            })),
            default: "drop" as Action,
        },
        input: {
            rules: ["i-replies", "i-ping", "i-ssh-anywhere", "i-management", "i-dns-home", "i-dns-guests"].map((id) => ({
                ...ruleById(id),
            })),
            default: "drop" as Action,
        },
    };
}

const chains = ref(startingChains());
const shownChains: ChainName[] = props.part === "forward" ? ["forward"] : ["input", "forward"];

const chainOf = (packet: Packet): ChainName => (packet.out ? "forward" : "input");

/** Whether an IPv4 address is inside a prefix such as 192.168.10.0/24. */
function within(address: string, prefix: string): boolean {
    const [network, length] = prefix.split("/");
    const toNumber = (text: string) => text.split(".").reduce((sum, part) => sum * 256 + Number(part), 0);
    const size = 2 ** (32 - Number(length));
    return Math.floor(toNumber(address) / size) === Math.floor(toNumber(network!) / size);
}

const interfaceName = (name: Interface) => (name === "1g-1" ? "1g-1, the internet" : name);

/** Why a rule does not match a packet, or undefined when every condition holds. */
function mismatch(rule: Rule, packet: Packet): string | undefined {
    const match = rule.match;

    if (match.in_interface && match.in_interface !== packet.in) return `came in on ${interfaceName(packet.in)}, not ${match.in_interface}`;
    if (match.out_interface && match.out_interface !== packet.out)
        return `leaves on ${packet.out ? interfaceName(packet.out) : "nothing"}, not ${match.out_interface}`;
    if (match.src && !within(packet.src, match.src)) return `${packet.src} is not in ${match.src}`;
    if (match.protocol && match.protocol !== packet.protocol)
        return `it is ${packet.protocol.toUpperCase()}, not ${match.protocol.toUpperCase()}`;
    if (match.dst_port !== undefined && match.dst_port !== packet.dstPort) return `it is for port ${packet.dstPort}, not ${match.dst_port}`;
    if (match.state && !match.state.includes(packet.state)) return `it starts a new connection, it is not a reply`;

    return undefined;
}

type Line = { rule: Rule; result: "skipped" | "matched" | "unread"; reason?: string };
type Outcome = { sent: false } | { sent: true; chain: ChainName; lines: Line[]; matched?: number; verdict: Action };

/** Read a chain from the top for one packet: the first rule that matches decides, then the default. */
function evaluate(packet: Packet): Outcome {
    if (packet.answers) {
        const request = allPackets.find((entry) => entry.id === packet.answers)!;
        const first = evaluate(request);
        if (!first.sent || first.verdict === "drop") return { sent: false };
    }

    const chain = chains.value[chainOf(packet)];
    const lines: Line[] = [];
    let matched: number | undefined;

    chain.rules.forEach((rule, index) => {
        if (matched !== undefined) {
            lines.push({ rule, result: "unread" });
            return;
        }

        const reason = mismatch(rule, packet);
        if (reason) {
            lines.push({ rule, result: "skipped", reason });
            return;
        }

        matched = index;
        lines.push({ rule, result: "matched" });
    });

    const verdict = matched === undefined ? chain.default : chain.rules[matched]!.action;
    return { sent: true, chain: chainOf(packet), lines, matched, verdict };
}

const outcomes = computed(() => Object.fromEntries(packets.map((packet) => [packet.id, evaluate(packet)])));

const isRight = (packet: Packet) => {
    const outcome = outcomes.value[packet.id]!;
    return outcome.sent && outcome.verdict === packet.should;
};

/** What happens to a packet with the rules as they are now. */
const nowText = (packet: Packet) => {
    const outcome = outcomes.value[packet.id]!;
    return outcome.sent ? outcome.verdict : "no reply";
};

const rightCount = computed(() => packets.filter(isRight).length);

const selectedId = ref<string>();
const selected = computed(() => packets.find((packet) => packet.id === selectedId.value));
const selectedOutcome = computed(() => (selected.value ? outcomes.value[selected.value.id] : undefined));

// The drawing: the router in the middle, a network on each of its interfaces.
const spots: Record<Interface | "router", Point> = {
    mgmt: [90, 55],
    home: [90, 150],
    guests: [90, 245],
    router: [330, 150],
    "1g-1": [560, 150],
};

const sides: Interface[] = ["mgmt", "home", "guests", "1g-1"];

const { position, travelling, travel } = useTravel();
const arrived = ref(false);

async function send(packet: Packet) {
    selectedId.value = packet.id;
    arrived.value = false;

    const outcome = outcomes.value[packet.id]!;
    if (!outcome.sent) {
        arrived.value = true;
        return;
    }

    await travel([spots[packet.in], spots.router]);
    if (packet.out && outcome.verdict === "accept") await travel([spots.router, spots[packet.out]]);
    arrived.value = true;
}

function describe(match: Match): string {
    const parts: string[] = [];
    if (match.in_interface) parts.push(`in ${match.in_interface}`);
    if (match.out_interface) parts.push(`out ${match.out_interface}`);
    if (match.src) parts.push(`from ${match.src}`);
    if (match.protocol) parts.push(match.protocol);
    if (match.dst_port !== undefined) parts.push(`port ${match.dst_port}`);
    if (match.state) parts.push(match.state.join(" or "));
    return parts.join(", ") || "every packet";
}

function move(chain: ChainName, index: number, by: number) {
    const rules = [...chains.value[chain].rules];
    const [rule] = rules.splice(index, 1);
    rules.splice(index + by, 0, rule!);
    chains.value[chain].rules = rules;
}

function flip(rule: Rule) {
    rule.action = rule.action === "accept" ? "drop" : "accept";
}

function remove(chain: ChainName, index: number) {
    chains.value[chain].rules = chains.value[chain].rules.filter((_, at) => at !== index);
}

const toAdd = ref<Record<ChainName, string>>({ input: "", forward: "" });

/** The rules of a chain's library that are not in the chain now. */
const missing = (chain: ChainName) =>
    library.filter((rule) => rule.chain === chain && !chains.value[chain].rules.some((entry) => entry.id === rule.id));

function add(chain: ChainName) {
    const id = toAdd.value[chain];
    if (!id) return;

    chains.value[chain].rules = [...chains.value[chain].rules, { ...ruleById(id) }];
    toAdd.value[chain] = "";
}

function flipDefault(chain: ChainName) {
    chains.value[chain].default = chains.value[chain].default === "accept" ? "drop" : "accept";
}

function reset() {
    chains.value = startingChains();
    selectedId.value = undefined;
    arrived.value = false;
}

/** The line under the drawing: what happened to the packet just sent, or how the reader is doing. */
const verdictText = computed(() => {
    const packet = selected.value;
    const outcome = selectedOutcome.value;
    if (!packet || !outcome || !arrived.value) return undefined;

    if (!outcome.sent) {
        return {
            kind: "bad",
            word: "No reply",
            text: "The laptop’s request was dropped, so the website never answers. Let the request through first.",
        };
    }

    const chainWords =
        outcome.chain === "input"
            ? "It is for the router itself, so the input chain decides."
            : "It passes through the router, so the forward chain decides.";
    const decided =
        outcome.matched === undefined
            ? `No rule matches it, so the default decides: ${outcome.verdict}.`
            : `Rule ${outcome.matched + 1}, ${outcome.lines[outcome.matched]!.rule.description}, is the first that matches, so it is ${outcome.verdict === "accept" ? "accepted" : "dropped"}. Rules below it are not read.`;
    const verdictMatches = outcome.verdict === packet.should;
    const judgement = verdictMatches
        ? "That is what should happen."
        : `It should be ${packet.should === "accept" ? "accepted" : "dropped"}: change the rules.`;

    return {
        kind: outcome.verdict === "accept" ? "good" : "bad",
        word: outcome.verdict === "accept" ? "Accepted" : "Dropped",
        text: `${chainWords} ${decided} ${judgement}`,
    };
});

/** The chains as they would be written in the router's file. */
const code = computed(() => {
    const value = (key: keyof Match, entry: unknown) =>
        key === "state"
            ? `[${(entry as string[]).map((state) => `"${state}"`).join(", ")}]`
            : typeof entry === "number"
              ? String(entry)
              : `"${entry}"`;
    const matchText = (match: Match) => {
        const keys = (["in_interface", "out_interface", "src", "protocol", "dst_port", "state"] as const).filter(
            (key) => match[key] !== undefined
        );
        return keys.length ? `match: { ${keys.map((key) => `${key}: ${value(key, match[key])}`).join(", ")} }, ` : "";
    };

    const lines = ["firewall: {", "    filter: {"];

    for (const name of shownChains) {
        const chain = chains.value[name];
        lines.push(
            name === "input" ? "        // Traffic to the router itself." : "        // Traffic passing through the router.",
            `        ${name}: {`
        );
        if (chain.default === "drop") lines.push('            default: "drop",');
        lines.push("            rules: [");
        for (const rule of chain.rules)
            lines.push(`                { description: "${rule.description}", ${matchText(rule.match)}action: "${rule.action}" },`);
        lines.push("            ],", "        },");
    }

    lines.push("    },", "},");
    return lines.join("\n");
});
</script>

<template>
    <div class="firewall-rules">
        <svg
            class="ac-drawing"
            viewBox="0 0 700 300"
            role="img"
            :aria-label="`A router with four networks: management, home and guests on one side, the internet on its port 1g-1 on the other.${selected ? ' Showing: ' + selected.title + '.' : ''}`"
        >
            <line
                v-for="side in sides"
                :key="side"
                class="cable"
                :class="{
                    lit:
                        selected &&
                        (selected.in === side || (selected.out === side && selectedOutcome?.sent && selectedOutcome.verdict === 'accept')),
                }"
                :x1="spots[side][0]"
                :y1="spots[side][1]"
                :x2="spots.router[0]"
                :y2="spots.router[1]"
            />
            <SvgDevice kind="desktop" :x="spots.mgmt[0]" :y="spots.mgmt[1]" label="Admin" note="mgmt" />
            <SvgDevice kind="laptop" :x="spots.home[0]" :y="spots.home[1]" label="Home" note="home" />
            <SvgDevice kind="phone" :x="spots.guests[0]" :y="spots.guests[1]" label="Guests" note="guests" />
            <SvgDevice kind="cloud" :x="spots['1g-1'][0]" :y="spots['1g-1'][1]" label="The internet" note="1g-1" />
            <SvgDevice
                kind="router"
                :x="spots.router[0]"
                :y="spots.router[1]"
                label="Router"
                :lit="!!(selected && arrived && selectedOutcome?.sent && !selected.out && selectedOutcome.verdict === 'accept')"
            />

            <g
                v-if="selected && arrived && selectedOutcome?.sent && selectedOutcome.verdict === 'drop'"
                class="stop"
                :transform="`translate(${spots.router[0]} ${spots.router[1] - 52})`"
            >
                <rect x="-38" y="-13" width="76" height="22" />
                <text y="3" text-anchor="middle">DROPPED</text>
            </g>

            <circle v-if="travelling" class="packet" :cx="position[0]" :cy="position[1]" r="9" />
        </svg>

        <div class="frame">
            <table class="ac-table packets">
                <caption>
                    Test packets: click one to send it
                </caption>
                <thead>
                    <tr>
                        <th scope="col">Packet</th>
                        <th scope="col" v-if="part === 'both'">Chain</th>
                        <th scope="col">Now</th>
                        <th scope="col">Should be</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="packet in packets" :key="packet.id" :class="{ lit: packet.id === selectedId }">
                        <td>
                            <button type="button" class="send" :disabled="travelling" @click="send(packet)">{{ packet.title }}</button>
                            <span class="detail ac-mono"
                                >{{ packet.src }} to {{ packet.dst }}, {{ packet.protocol }} port {{ packet.dstPort
                                }}{{ packet.state === "new" ? "" : ", a reply" }}</span
                            >
                        </td>
                        <td v-if="part === 'both'">{{ chainOf(packet) }}</td>
                        <td>
                            <span class="verdict" :class="isRight(packet) ? 'right' : 'wrong'">
                                {{ nowText(packet) }}
                                <span class="mark">{{ isRight(packet) ? "right" : "wrong" }}</span>
                            </span>
                        </td>
                        <td>{{ packet.should }}</td>
                    </tr>
                </tbody>
            </table>
        </div>

        <p v-if="verdictText" class="ac-say" :class="verdictText.kind" :data-word="verdictText.word" aria-live="polite">
            {{ verdictText.text }}
        </p>
        <p v-else class="ac-say hint" aria-live="polite">
            Click a packet to send it through the rules. Then change the rules until every packet is right.
        </p>

        <p class="score" :class="{ done: rightCount === packets.length }">
            {{
                rightCount === packets.length
                    ? `All ${packets.length} packets are right.`
                    : `${rightCount} of ${packets.length} packets are right.`
            }}
        </p>

        <div class="chains" :class="{ two: shownChains.length > 1 }">
            <section
                v-for="name in shownChains"
                :key="name"
                class="chain"
                :class="{ quiet: selected && selectedOutcome?.sent && selectedOutcome.chain !== name }"
            >
                <h4>
                    {{ name }}
                    <span>{{ name === "input" ? "to the router itself" : "through the router" }}</span>
                </h4>

                <ol class="rules">
                    <li
                        v-for="(rule, index) in chains[name].rules"
                        :key="rule.id"
                        :class="selectedOutcome?.sent && selectedOutcome.chain === name ? selectedOutcome.lines[index]?.result : ''"
                    >
                        <span class="number">{{ index + 1 }}</span>
                        <span class="what">
                            <strong>{{ rule.description }}</strong>
                            <span class="ac-mono">{{ describe(rule.match) }}</span>
                            <span v-if="selectedOutcome?.sent && selectedOutcome.chain === name" class="trace">
                                {{
                                    selectedOutcome.lines[index]?.result === "matched"
                                        ? "Matches first: this rule decides."
                                        : selectedOutcome.lines[index]?.result === "unread"
                                          ? "Not read."
                                          : `No match: ${selectedOutcome.lines[index]?.reason}.`
                                }}
                            </span>
                        </span>
                        <span class="tools">
                            <button
                                type="button"
                                class="ac-button small action"
                                :class="rule.action"
                                :aria-label="`Rule ${index + 1}, ${rule.description}: ${rule.action}. Change it.`"
                                @click="flip(rule)"
                            >
                                {{ rule.action }}
                            </button>
                            <button
                                type="button"
                                class="ac-button small"
                                :disabled="index === 0"
                                :aria-label="`Move rule ${index + 1} up`"
                                @click="move(name, index, -1)"
                            >
                                Up
                            </button>
                            <button
                                type="button"
                                class="ac-button small"
                                :disabled="index === chains[name].rules.length - 1"
                                :aria-label="`Move rule ${index + 1} down`"
                                @click="move(name, index, 1)"
                            >
                                Down
                            </button>
                            <button
                                type="button"
                                class="ac-button small"
                                :aria-label="`Remove rule ${index + 1}`"
                                @click="remove(name, index)"
                            >
                                Remove
                            </button>
                        </span>
                    </li>
                    <li
                        class="default"
                        :class="
                            selectedOutcome?.sent && selectedOutcome.chain === name
                                ? selectedOutcome.matched === undefined
                                    ? 'matched'
                                    : 'unread'
                                : ''
                        "
                    >
                        <span class="number">end</span>
                        <span class="what">
                            <strong>Default</strong>
                            <span class="ac-mono">what no rule matched</span>
                            <span v-if="selectedOutcome?.sent && selectedOutcome.chain === name" class="trace">
                                {{ selectedOutcome.matched === undefined ? "Nothing matched: the default decides." : "Not read." }}
                            </span>
                        </span>
                        <span class="tools">
                            <button
                                type="button"
                                class="ac-button small action"
                                :class="chains[name].default"
                                :aria-label="`Default of ${name}: ${chains[name].default}. Change it.`"
                                @click="flipDefault(name)"
                            >
                                {{ chains[name].default }}
                            </button>
                        </span>
                    </li>
                </ol>

                <div class="add">
                    <label class="ac-field">
                        <span>Add a rule at the end of {{ name }}</span>
                        <select v-model="toAdd[name]" class="ac-select">
                            <option value="">Pick a rule</option>
                            <option v-for="rule in missing(name)" :key="rule.id" :value="rule.id">
                                {{ rule.description }} ({{ describe(rule.match) }}, {{ rule.action }})
                            </option>
                        </select>
                    </label>
                    <button type="button" class="ac-button" :disabled="!toAdd[name]" @click="add(name)">Add</button>
                </div>
            </section>
        </div>

        <div class="ac-row">
            <button type="button" class="ac-button small" @click="reset">Start over</button>
        </div>

        <CodeView :code="code" title="router.ts" />
    </div>
</template>

<style scoped>
.frame {
    margin-top: 10px;
    overflow-x: auto;
}

caption {
    padding-bottom: 4px;
    color: var(--circuit-soft);
    font-size: 13px;
    font-weight: 600;
    text-align: left;
}

.send {
    display: block;
    min-height: 40px;
    padding: 0;
    color: var(--circuit-link);
    font: inherit;
    font-weight: 600;
    text-align: left;
    text-decoration: underline dotted 2px;
    text-underline-offset: 4px;
}

.send:hover:not(:disabled) {
    text-decoration-style: solid;
}

.packets tr.lit .send {
    color: #0a1a36;
}

.dark .packets tr.lit .send {
    color: var(--circuit-ink);
}

.detail {
    display: block;
    color: var(--circuit-soft);
    font-size: 12px;
}

.packets tr.lit .detail {
    color: inherit;
}

.verdict {
    white-space: nowrap;
}

.verdict .mark {
    display: inline-block;
    margin-left: 6px;
    padding: 0 6px;
    color: #ffffff;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.06em;
    line-height: 18px;
    text-transform: uppercase;
}

.verdict.right .mark {
    background: var(--circuit-added);
}

.verdict.wrong .mark {
    background: var(--circuit-removed);
}

.stop rect {
    fill: var(--circuit-removed);
}

.stop text {
    fill: #ffffff !important;
    font-size: 12px !important;
    font-weight: 700;
    letter-spacing: 0.08em;
}

.hint {
    color: var(--circuit-soft);
}

.score {
    margin: 8px 0 0;
    font-weight: 700;
}

.score.done {
    color: var(--circuit-added);
}

.chains {
    display: grid;
    gap: 16px;
    margin-top: 16px;
}

.chain {
    min-width: 0;
    padding: 12px 14px;
    border: 2px solid var(--circuit-ink);
    transition: opacity 0.25s;
}

.chain.quiet {
    opacity: 0.45;
}

h4 {
    margin: 0 0 8px !important;
    font-family: var(--circuit-mono);
    font-size: 16px;
}

h4 span {
    margin-left: 6px;
    color: var(--circuit-soft);
    font-family: var(--circuit-font);
    font-size: 14px;
    font-weight: 600;
}

.rules {
    margin: 0 !important;
    padding: 0 !important;
    list-style: none;
}

.rules li {
    display: grid;
    grid-template-columns: 34px minmax(0, 1fr);
    gap: 4px 8px;
    margin: 0 !important;
    padding: 8px 6px;
    border-top: 1px solid var(--circuit-line);
    transition: background-color 0.2s;
}

.rules li.matched {
    background: var(--circuit-selected);
    box-shadow: inset 3px 0 0 var(--circuit-yellow);
}

.rules li.unread {
    opacity: 0.5;
}

.rules li.default {
    border-top: 2px solid var(--circuit-ink);
}

.number {
    color: var(--circuit-soft);
    font-size: 13px;
    font-weight: 700;
    line-height: 24px;
}

.what {
    display: grid;
    gap: 2px;
    line-height: 1.4;
}

.what .ac-mono {
    color: var(--circuit-soft);
    font-size: 12.5px;
}

.trace {
    font-size: 13.5px;
    font-weight: 600;
}

.tools {
    grid-column: 2;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
}

.action {
    min-width: 76px;
    font-family: var(--circuit-mono);
}

.action.drop {
    border-color: var(--circuit-removed);
    border-style: dashed;
    color: var(--circuit-removed);
}

.add {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: 8px;
    margin-top: 12px;
}

.add .ac-select {
    max-width: 100%;
}

.add .ac-field {
    min-width: 0;
    flex: 1 1 220px;
}
</style>
