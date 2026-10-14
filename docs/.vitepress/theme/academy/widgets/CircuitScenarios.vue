<script setup lang="ts">
// Lesson: carrying your own traffic. The reader picks a customer's need, tries each private-circuit product against it, and finds the ones that fit and why the others do not.

import { computed, ref } from "vue";

type ProductId = "metro" | "l2" | "ipvpn" | "iplc" | "iepl" | "dark" | "wave" | "sdwan";
type Fit = "fits" | "works" | "no";

const PRODUCTS: { id: ProductId; name: string }[] = [
    { id: "metro", name: "Metro-E" },
    { id: "l2", name: "L2 transport, EPL or EVPL" },
    { id: "ipvpn", name: "IP VPN" },
    { id: "iplc", name: "IPLC" },
    { id: "iepl", name: "IEPL" },
    { id: "dark", name: "Dark fibre" },
    { id: "wave", name: "A DWDM wavelength" },
    { id: "sdwan", name: "SD-WAN over internet links" },
];

const ACROSS_BORDERS = "IPLC and IEPL are sold between countries. These sites are in one country.";

const SCENARIOS: { id: string; name: string; need: string; fits: Record<ProductId, [Fit, string]> }[] = [
    {
        id: "city",
        name: "Two offices, one city",
        need: "Two offices 12 km apart in the same city want to share one network, as if a long cable joined them, at 1 Gbit/s.",
        fits: {
            metro: [
                "fits",
                "This is what Metro-E is for: Ethernet across one city, at a committed rate. An EPL if the port carries only this, an EVPL if it also carries other circuits.",
            ],
            l2: ["fits", "Inside one city, an EPL or EVPL is what the provider calls Metro-E. Same thing, same fit."],
            ipvpn: [
                "works",
                "It joins the offices, but the provider routes between them, so each office is its own subnet rather than one shared Ethernet.",
            ],
            iplc: ["no", ACROSS_BORDERS],
            iepl: ["no", ACROSS_BORDERS],
            dark: [
                "works",
                "If a spare fibre runs between them, you light it with your own optics at any speed you like. It is more than 1 Gbit/s needs, and a break in it is yours to chase with the provider.",
            ],
            wave: ["works", "It would carry it, but a whole wavelength for 1 Gbit/s between two offices is more than the need."],
            sdwan: [
                "works",
                "Encrypted tunnels over each office's internet line work and cost little, but nothing commits a rate or a delay, and it is routed, not one Ethernet.",
            ],
        },
    },
    {
        id: "abroad",
        name: "A branch abroad",
        need: "A head office in Jakarta and a branch in Singapore need a steady, private 100 Mbit/s between them, with a delay that does not change.",
        fits: {
            metro: ["no", "Metro-E stays inside one city."],
            l2: ["works", "An Ethernet line between countries is what IEPL is. Providers sell it under that name."],
            ipvpn: [
                "works",
                "If the provider has both countries, it routes between them privately. It fits better once there are more than two sites.",
            ],
            iplc: [
                "fits",
                "A dedicated circuit between the two countries at a fixed capacity, reserved for you alone. It may be handed over on an older, non-Ethernet interface.",
            ],
            iepl: [
                "fits",
                "The same dedicated line between countries, handed over as Ethernet, so it plugs into an ordinary router or switch port.",
            ],
            dark: [
                "no",
                "Dark fibre is rented where spare fibre already runs, mostly in and around cities. A fibre of your own across a sea, for 100 Mbit/s, is far beyond the need.",
            ],
            wave: [
                "no",
                "Wavelengths are sold from 1 Gbit/s up, for large amounts of traffic between big sites. For 100 Mbit/s to an office, it is far beyond the need.",
            ],
            sdwan: [
                "works",
                "Tunnels over the internet in both countries work, but the path and the delay change with the internet. It is often the spare for a private line.",
            ],
        },
    },
    {
        id: "dcs",
        name: "Two data centres",
        need: "Two data centres 30 km apart copy storage between them at 100 Gbit/s now, and more next year.",
        fits: {
            metro: [
                "works",
                "It may carry it, but over the provider's shared Ethernet network. A fibre or a wavelength gives you the whole capacity.",
            ],
            l2: ["works", "Same as Metro-E here: possible, but shared with the provider's other customers inside its network."],
            ipvpn: ["no", "A routed service for joining sites, not a pipe for 100 Gbit/s of storage copies."],
            iplc: ["no", ACROSS_BORDERS],
            iepl: ["no", ACROSS_BORDERS],
            dark: [
                "fits",
                "Light the fibre with your own DWDM equipment, and add wavelengths as the copies grow. The most capacity, and you run the equipment.",
            ],
            wave: [
                "fits",
                "The provider's DWDM carries a 100G wavelength for you, and runs the equipment. Buy a second wavelength when you need more.",
            ],
            sdwan: ["no", "Tunnels over internet links cannot carry 100 Gbit/s of steady copies."],
        },
    },
    {
        id: "shops",
        name: "Forty shops",
        need: "Forty shops across the country each have an ordinary broadband line. Each must reach the head office's systems, at the lowest cost.",
        fits: {
            metro: ["no", "Metro-E stays inside one city, and the shops are all over the country."],
            l2: ["no", "Forty Ethernet lines to the head office would cost far more than the need."],
            ipvpn: [
                "works",
                "One provider joins every shop with an agreement on its service, but each shop then needs that provider's line, at a higher price than broadband.",
            ],
            iplc: ["no", ACROSS_BORDERS],
            iepl: ["no", ACROSS_BORDERS],
            dark: ["no", "Nobody lays fibre to forty shops for this."],
            wave: ["no", "Wavelengths join big sites such as data centres, not shops."],
            sdwan: [
                "fits",
                "Tunnels over the broadband lines the shops already have, managed from one place, with each kind of traffic sent the best way. The cheapest fit.",
            ],
        },
    },
    {
        id: "cities",
        name: "Six cities",
        need: "Six offices in six cities of one country. Any office must reach any other, and the company does not want to run the routing between them.",
        fits: {
            metro: ["no", "Metro-E stays inside one city."],
            l2: [
                "works",
                "Ethernet lines between the cities work, but then you route between them yourself, which the company does not want.",
            ],
            ipvpn: [
                "fits",
                "The provider joins all six into one private routed network: any office reaches any other, and the provider runs the routing.",
            ],
            iplc: ["no", ACROSS_BORDERS],
            iepl: ["no", ACROSS_BORDERS],
            dark: ["no", "Fibre between six cities, and running it, is far beyond the need."],
            wave: ["no", "Wavelengths between offices are far more than the need, and you would still run the routing."],
            sdwan: [
                "works",
                "Any office reaches any other over their internet lines, but someone runs the SD-WAN: the company, or a provider that sells it as a managed service.",
            ],
        },
    },
];

const WORDS: Record<Fit, { kind: string; word: string; mark: string }> = {
    fits: { kind: "good", word: "Fits", mark: "Fits" },
    works: { kind: "warn", word: "Works, but", mark: "Works, but" },
    no: { kind: "bad", word: "Does not fit", mark: "No" },
};

const scenarioId = ref(SCENARIOS[0]!.id);
const tried = ref<Record<string, ProductId[]>>({});
const last = ref<ProductId>();

const scenario = computed(() => SCENARIOS.find((entry) => entry.id === scenarioId.value)!);
const triedHere = computed(() => tried.value[scenarioId.value] ?? []);

const fitting = computed(() => PRODUCTS.filter((product) => scenario.value.fits[product.id][0] === "fits"));
const found = computed(() => fitting.value.filter((product) => triedHere.value.includes(product.id)));

function pickScenario(id: string) {
    scenarioId.value = id;
    last.value = undefined;
}

function tryProduct(id: ProductId) {
    if (!triedHere.value.includes(id)) tried.value = { ...tried.value, [scenarioId.value]: [...triedHere.value, id] };
    last.value = id;
}

const said = computed(() => {
    if (!last.value) return undefined;
    const [fit, text] = scenario.value.fits[last.value];
    const name = PRODUCTS.find((product) => product.id === last.value)!.name;
    return { ...WORDS[fit], text: `${name}: ${text}` };
});

const progress = computed(() =>
    found.value.length === fitting.value.length
        ? `You found every product that fits: ${fitting.value.map((product) => product.name).join(" and ")}. Try another need.`
        : `${found.value.length} of ${fitting.value.length} products that fit found so far.`
);
</script>

<template>
    <div class="circuit-scenarios">
        <div class="ac-field">
            <span>1. Pick a need</span>
            <div class="ac-row">
                <button
                    v-for="entry in SCENARIOS"
                    :key="entry.id"
                    type="button"
                    class="ac-button small"
                    :aria-pressed="entry.id === scenarioId"
                    @click="pickScenario(entry.id)"
                >
                    {{ entry.name }}
                </button>
            </div>
        </div>

        <p class="need">{{ scenario.need }}</p>

        <div class="ac-field">
            <span>2. Try a product against it</span>
            <div class="products">
                <button
                    v-for="product in PRODUCTS"
                    :key="product.id"
                    type="button"
                    class="ac-button product"
                    :class="triedHere.includes(product.id) ? `was-${scenario.fits[product.id][0]}` : ''"
                    @click="tryProduct(product.id)"
                >
                    <span>{{ product.name }}</span>
                    <span v-if="triedHere.includes(product.id)" class="mark">{{ WORDS[scenario.fits[product.id][0]].mark }}</span>
                </button>
            </div>
        </div>

        <p v-if="said" class="ac-say" :class="said.kind" :data-word="said.word" aria-live="polite">{{ said.text }}</p>
        <p v-else class="ac-say hint" aria-live="polite">Pick the products you think fit this need, one at a time.</p>
        <p class="progress">{{ progress }}</p>
    </div>
</template>

<style scoped>
.need {
    margin: 14px 0 !important;
    padding: 10px 14px;
    border-left: 3px solid var(--circuit-cobalt);
    background: var(--circuit-mist);
    font-size: 16px;
    line-height: 1.55;
}

.products {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 8px;
}

.product {
    justify-content: space-between;
    white-space: normal;
    text-align: left;
}

.mark {
    flex: none;
    padding: 0 6px;
    font-size: 11px;
    font-weight: 700;
    font-stretch: 115%;
    letter-spacing: 0.06em;
    line-height: 20px;
    text-transform: uppercase;
}

.was-fits {
    border-color: var(--circuit-added);
}

.was-fits .mark {
    background: var(--circuit-added);
    color: var(--circuit-paper);
}

.was-works {
    border-color: var(--circuit-warning);
    border-style: dashed;
}

.was-works .mark {
    background: var(--circuit-warning);
    color: var(--circuit-paper);
}

.was-no {
    border-color: var(--circuit-removed);
    border-style: dashed;
}

.was-no .mark {
    background: var(--circuit-removed);
    color: var(--circuit-paper);
}

.hint {
    color: var(--circuit-soft);
}

.progress {
    margin: 8px 0 0 !important;
    color: var(--circuit-soft);
    font-size: 14.5px;
}
</style>
