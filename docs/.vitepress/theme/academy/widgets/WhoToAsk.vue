<script setup lang="ts">
// Lesson: who runs the internet. The reader matches each thing a network needs to the organization that provides it: a registry, a data center, an exchange, a transit provider, or PeeringDB.

import { computed, ref } from "vue";

type Who = "iana" | "apnic" | "idnic" | "transit" | "datacenter" | "exchange" | "peeringdb";

const WHO: { id: Who; name: string }[] = [
    { id: "iana", name: "IANA" },
    { id: "apnic", name: "APNIC, the regional registry" },
    { id: "idnic", name: "IDNIC, Indonesia's national registry" },
    { id: "transit", name: "A transit provider" },
    { id: "datacenter", name: "The data center operator" },
    { id: "exchange", name: "The exchange operator" },
    { id: "peeringdb", name: "PeeringDB" },
];

const NEEDS: { id: string; need: string; right: Who[]; why: string; wrong: string }[] = [
    {
        id: "asn-id",
        need: "A company in Indonesia wants an AS number and an IPv6 block of its own.",
        right: ["idnic", "apnic"],
        why: "Both are right. A network in Indonesia can join IDNIC or APNIC, but in most cases not both.",
        wrong: "AS numbers and address blocks come from a registry. Which registries serve Indonesia?",
    },
    {
        id: "block-sg",
        need: "A company in Singapore wants an address block of its own.",
        right: ["apnic"],
        why: "Singapore has no national registry, so the company goes to APNIC.",
        wrong: "IDNIC serves Indonesia only. Singapore is not one of the seven economies in APNIC's region with a national registry.",
    },
    {
        id: "pool",
        need: "APNIC's own pool of IPv6 addresses, the one it hands out from.",
        right: ["iana"],
        why: "IANA, at the top, gives blocks to the five regional registries, and they hand out from those.",
        wrong: "Look one level up from the regional registries.",
    },
    {
        id: "cable",
        need: "Your router and a transit provider's router are in the same data center, in different cages. You need a cable between them.",
        right: ["datacenter"],
        why: "That cable is a cross-connect. You order it from the data center operator.",
        wrong: "Inside the building, only the operator runs cables between customers' cages.",
    },
    {
        id: "port",
        need: "A port on the national exchange's peering LAN, with an address on it.",
        right: ["exchange"],
        why: "The exchange operator runs the peering LAN and the route servers, and gives each member its port and address.",
        wrong: "The peering LAN belongs to whoever runs the exchange.",
    },
    {
        id: "where",
        need: "Before asking a network to peer, you want to know which exchanges and buildings it is at.",
        right: ["peeringdb"],
        why: "Networks list their exchanges, buildings, and peering contacts on PeeringDB.",
        wrong: "There is one public database where networks list where they peer.",
    },
    {
        id: "everything",
        need: "Routes to the whole internet, not only to the networks at the exchange.",
        right: ["transit"],
        why: "Peers give you their own routes and their customers'. Everything else comes from a transit provider, your upstream, which you pay.",
        wrong: "Which kind of network sells a way to everyone?",
    },
];

const picked = ref<Record<string, Who | "">>(Object.fromEntries(NEEDS.map((need) => [need.id, ""])));

const right = computed(() => NEEDS.filter((need) => need.right.includes(picked.value[need.id] as Who)).length);
const answered = computed(() => NEEDS.filter((need) => picked.value[need.id]).length);

function verdict(need: (typeof NEEDS)[number]) {
    const choice = picked.value[need.id];
    if (!choice) return undefined;
    return need.right.includes(choice)
        ? { kind: "good", word: "Right", text: need.why }
        : { kind: "bad", word: "Not them", text: need.wrong };
}

const rows = computed(() => NEEDS.map((need) => ({ need, said: verdict(need) })));
</script>

<template>
    <div class="who-to-ask">
        <ol class="needs">
            <li v-for="{ need, said } in rows" :key="need.id">
                <label class="ac-field">
                    <span>{{ need.need }}</span>
                    <select v-model="picked[need.id]" class="ac-select">
                        <option value="">Who do you ask?</option>
                        <option v-for="who in WHO" :key="who.id" :value="who.id">{{ who.name }}</option>
                    </select>
                </label>
                <p v-if="said" class="ac-say" :class="said.kind" :data-word="said.word" aria-live="polite">{{ said.text }}</p>
            </li>
        </ol>
        <p class="ac-say" aria-live="polite">
            {{ answered === 0 ? "Pick who you would ask for each one." : `${right} of ${NEEDS.length} right.` }}
        </p>
    </div>
</template>

<style scoped>
.needs {
    display: grid;
    gap: 16px;
    margin: 0 !important;
    padding: 0 !important;
    list-style: none;
}

.needs li {
    margin: 0 !important;
    padding-left: 12px;
    border-left: 3px solid var(--circuit-line);
}

.needs .ac-field > span {
    color: var(--circuit-ink);
    font-size: 15px;
    font-weight: 600;
}

.needs .ac-say {
    margin-top: 8px;
}
</style>
