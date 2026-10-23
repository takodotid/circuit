<script setup lang="ts">
// Lesson: hijacks and leaks. The reader writes ROAs and a route, and sees route origin validation decide valid, invalid or not found, ROA by ROA.

import { computed, ref } from "vue";
import { type Roa, Rov } from "./OriginCheck";

type RoaRow = { prefix: string; maxLength: string; asn: string };
type Case = { label: string; roas: RoaRow[]; prefix: string; path: string };

const yourRoa: RoaRow = { prefix: "2001:db8:a00::/40", maxLength: "40", asn: "64500" };

const cases: Case[] = [
    { label: "Your own route", roas: [yourRoa], prefix: "2001:db8:a00::/40", path: "64501 64500" },
    { label: "Another origin", roas: [yourRoa], prefix: "2001:db8:a00::/40", path: "64497 64510" },
    { label: "A /48 of yours", roas: [yourRoa], prefix: "2001:db8:a00::/48", path: "64501 64500" },
    { label: "Forged origin", roas: [{ ...yourRoa, maxLength: "48" }], prefix: "2001:db8:a00::/48", path: "64497 64510 64500" },
    { label: "No ROA for it", roas: [yourRoa], prefix: "2001:db8:b00::/40", path: "64497 64510" },
    {
        label: "Two ROAs",
        roas: [
            { prefix: "192.0.2.0/24", maxLength: "24", asn: "64500" },
            { prefix: "192.0.2.0/24", maxLength: "24", asn: "64505" },
        ],
        prefix: "192.0.2.0/24",
        path: "64496 64505",
    },
];

const roas = ref<RoaRow[]>(cases[0]!.roas.map((row) => ({ ...row })));
const prefix = ref(cases[0]!.prefix);
const path = ref(cases[0]!.path);
const picked = ref(0);

function load(index: number) {
    const chosen = cases[index]!;
    roas.value = chosen.roas.map((row) => ({ ...row }));
    prefix.value = chosen.prefix;
    path.value = chosen.path;
    picked.value = index;
}

function addRoa() {
    roas.value = [...roas.value, { prefix: "", maxLength: "", asn: "" }];
    picked.value = -1;
}

function removeRoa(index: number) {
    roas.value = roas.value.filter((_, at) => at !== index);
    picked.value = -1;
}

const isAsn = (text: string) => /^\d{1,10}$/.test(text.trim()) && Number(text) <= 4294967295;

/** What is wrong with one ROA row, or undefined. */
function problemOf(row: RoaRow): string | undefined {
    const parsed = Rov.parsePrefix(row.prefix);
    if (typeof parsed === "string") return parsed;

    const max = Number(row.maxLength);
    const bits = parsed.family === 4 ? 32 : 128;
    if (!/^\d{1,3}$/.test(row.maxLength.trim()) || max < parsed.length || max > bits) {
        return `maxLength must be from ${parsed.length}, the prefix's own length, to ${bits}.`;
    }
    if (!isAsn(row.asn)) return "The AS must be a number, such as 64500.";
    return undefined;
}

const pathNumbers = computed(() => path.value.trim().split(/\s+/).filter(Boolean));

const routeProblem = computed(() => {
    const parsed = Rov.parsePrefix(prefix.value);
    if (typeof parsed === "string") return parsed;
    if (pathNumbers.value.length === 0) return "Write the AS path, nearest AS first, such as 64501 64500.";
    if (!pathNumbers.value.every(isAsn)) return "Each AS in the path must be a number, separated by spaces.";
    return undefined;
});

const problems = computed(() => roas.value.map(problemOf));
const ready = computed(() => !routeProblem.value && problems.value.every((problem) => problem === undefined));

const origin = computed(() => Number(pathNumbers.value[pathNumbers.value.length - 1]));

const published = computed<Roa[]>(() =>
    roas.value.map((row) => ({ prefix: row.prefix.trim(), maxLength: Number(row.maxLength), asn: Number(row.asn) }))
);

const verdict = computed(() => (ready.value ? Rov.validate(published.value, prefix.value.trim(), origin.value) : undefined));

/** For each ROA: does it cover the route, name its origin, allow its length. */
const checks = computed(() => {
    const route = Rov.parsePrefix(prefix.value);
    return published.value.map((roa, index) => {
        const parsed = Rov.parsePrefix(roa.prefix);
        if (problems.value[index] || typeof parsed === "string" || typeof route === "string") return undefined;

        const covering = Rov.covers(parsed, route);
        return {
            covers: covering,
            sameAs: covering ? roa.asn === origin.value : undefined,
            fits: covering ? route.length <= roa.maxLength : undefined,
        };
    });
});

const length = computed(() => prefix.value.trim().split("/")[1]);

const said = computed(() => {
    if (!verdict.value) {
        const row = problems.value.findIndex(Boolean);
        const text = routeProblem.value ? `The route: ${routeProblem.value}` : `ROA ${row + 1}: ${problems.value[row]}`;
        return { kind: "warn", word: "Fix this", text };
    }

    const route = `${prefix.value.trim()} from AS${origin.value}`;

    switch (verdict.value.state) {
        case "valid":
            return {
                kind: "good",
                word: "Valid",
                text: `${route} is valid: the ROA for ${verdict.value.matching[0]!.prefix} has AS${origin.value} as the origin and allows up to /${verdict.value.matching[0]!.maxLength}. SANITY lets it on to the rest of the import.`,
            };
        case "invalid-origin":
            return {
                kind: "bad",
                word: "Invalid",
                text: `${route} is invalid: a ROA covers it, but none has AS${origin.value} as the origin. SANITY rejects it.`,
            };
        case "invalid-length":
            return {
                kind: "bad",
                word: "Invalid",
                text: `${route} is invalid: the ROA has AS${origin.value} as the origin, but allows nothing longer than /${Math.max(...verdict.value.covering.filter((roa) => roa.asn === origin.value).map((roa) => roa.maxLength))}, and this is a /${length.value}. SANITY rejects it.`,
            };
        default:
            return {
                kind: "warn",
                word: "Not found",
                text: `No ROA covers ${prefix.value.trim()}, so origin validation cannot tell anything about it. SANITY lets it on, like most routes on the internet today.`,
            };
    }
});

const mark = (value: boolean | undefined) => (value === undefined ? "not asked" : value ? "yes" : "no");
</script>

<template>
    <div class="origin-check">
        <div class="ac-field">
            <span>Load a case</span>
            <div class="ac-row" role="group" aria-label="Load a case">
                <button
                    v-for="(entry, index) in cases"
                    :key="entry.label"
                    type="button"
                    class="ac-button small"
                    :aria-pressed="picked === index"
                    @click="load(index)"
                >
                    {{ entry.label }}
                </button>
            </div>
        </div>

        <p class="heading">ROAs the validator has</p>
        <div v-for="(row, index) in roas" :key="index" class="roa">
            <label class="ac-field">
                <span>Prefix</span>
                <input
                    v-model="row.prefix"
                    class="ac-input mono"
                    autocomplete="off"
                    spellcheck="false"
                    :aria-invalid="problems[index] !== undefined && typeof Rov.parsePrefix(row.prefix) === 'string'"
                    @input="picked = -1"
                />
            </label>
            <label class="ac-field small">
                <span>maxLength</span>
                <input v-model="row.maxLength" class="ac-input mono" inputmode="numeric" autocomplete="off" @input="picked = -1" />
            </label>
            <label class="ac-field small">
                <span>Origin AS</span>
                <input v-model="row.asn" class="ac-input mono" inputmode="numeric" autocomplete="off" @input="picked = -1" />
            </label>
            <button type="button" class="ac-button small" :aria-label="`Remove ROA ${index + 1}`" @click="removeRoa(index)">Remove</button>
        </div>
        <p v-if="roas.length === 0" class="quiet">No ROAs at all: nothing covers any route.</p>
        <button v-if="roas.length < 3" type="button" class="ac-button small add" @click="addRoa">Add a ROA</button>

        <p class="heading">The route your router receives</p>
        <div class="route">
            <label class="ac-field">
                <span>Prefix</span>
                <input v-model="prefix" class="ac-input mono" autocomplete="off" spellcheck="false" @input="picked = -1" />
            </label>
            <label class="ac-field">
                <span>AS path, nearest first</span>
                <input v-model="path" class="ac-input mono" autocomplete="off" spellcheck="false" @input="picked = -1" />
            </label>
        </div>
        <p v-if="!routeProblem" class="quiet">The origin is the last AS in the path: AS{{ origin }}.</p>

        <div v-if="verdict" class="frame">
            <table class="ac-table">
                <thead>
                    <tr>
                        <th>ROA</th>
                        <th>Covers the prefix?</th>
                        <th>Names AS{{ origin }}?</th>
                        <th>/{{ length }} within maxLength?</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="(roa, index) in published" :key="index" :class="{ lit: verdict.matching.includes(roa) }">
                        <td class="ac-mono">{{ roa.prefix }}, max /{{ roa.maxLength }}, AS{{ roa.asn }}</td>
                        <td>{{ mark(checks[index]?.covers) }}</td>
                        <td>{{ mark(checks[index]?.sameAs) }}</td>
                        <td>{{ mark(checks[index]?.fits) }}</td>
                    </tr>
                </tbody>
            </table>
        </div>

        <p class="ac-say" :class="said.kind" :data-word="said.word" aria-live="polite">{{ said.text }}</p>
    </div>
</template>

<style scoped>
.heading {
    margin: 18px 0 8px;
    font-weight: 700;
}

.roa {
    display: grid;
    grid-template-columns: minmax(0, 2.4fr) minmax(0, 1fr) minmax(0, 1fr) auto;
    align-items: end;
    gap: 8px;
    margin-bottom: 8px;
}

.route {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 8px;
}

.ac-input {
    width: 100%;
}

.add {
    margin-top: 2px;
}

.quiet {
    margin: 6px 0 0;
    color: var(--circuit-soft);
    font-size: 14.5px;
}

.frame {
    margin-top: 10px;
    overflow-x: auto;
}

@media (max-width: 640px) {
    .roa {
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        padding-bottom: 10px;
        border-bottom: 1px solid var(--circuit-line);
    }

    .roa > :first-child {
        grid-column: 1 / -1;
    }

    .route {
        grid-template-columns: 1fr;
    }
}
</style>
