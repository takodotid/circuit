<script setup lang="ts">
// The graduates of the certification, and a way to check that a certificate is real by its ID.

import { computed, onMounted, ref } from "vue";
import { graduates } from "./graduates";

const query = ref("");
const checked = ref("");

const found = computed(() => graduates.find((graduate) => graduate.id.toLowerCase() === checked.value.trim().toLowerCase()));

const newestFirst = computed(() => [...graduates].sort((a, b) => b.date.localeCompare(a.date)));

const day = (date: string) =>
    new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

function check() {
    checked.value = query.value;
}

// A link to a certificate, such as /academy/graduates#ID, checks it at once.
onMounted(() => {
    const id = decodeURIComponent(location.hash.slice(1));
    if (!id) return;

    query.value = id;
    check();
});
</script>

<template>
    <div class="graduates">
        <form class="lookup" @submit.prevent="check">
            <label class="ac-field">
                <span>Check a certificate by its ID</span>
                <input
                    v-model="query"
                    class="ac-input mono"
                    type="text"
                    autocomplete="off"
                    spellcheck="false"
                    placeholder="The ID on the certificate"
                />
            </label>
            <button type="submit" class="ac-button primary" :disabled="!query.trim()">Check</button>
        </form>

        <div aria-live="polite">
            <p v-if="checked && found" class="ac-say good" data-word="Valid">
                Certificate <span class="ac-mono">{{ found.id }}</span> was given to <strong>{{ found.name }}</strong> on
                {{ day(found.date) }}.
            </p>
            <p v-else-if="checked" class="ac-say bad" data-word="Not found">
                No certificate has the ID <span class="ac-mono">{{ checked }}</span
                >. Check it for typos: a certificate that is not listed here was not given by Circuit Academy.
            </p>
        </div>

        <table v-if="graduates.length" class="list">
            <thead>
                <tr>
                    <th scope="col">Name</th>
                    <th scope="col">Certified</th>
                    <th scope="col">Certificate</th>
                </tr>
            </thead>
            <tbody>
                <tr v-for="graduate in newestFirst" :id="graduate.id" :key="graduate.id">
                    <th scope="row">
                        <a v-if="graduate.link" :href="graduate.link" rel="noopener">{{ graduate.name }}</a>
                        <template v-else>{{ graduate.name }}</template>
                    </th>
                    <td>{{ day(graduate.date) }}</td>
                    <td class="ac-mono">{{ graduate.id }}</td>
                </tr>
            </tbody>
        </table>

        <div v-else class="empty">
            <p class="chip">No graduates yet</p>
            <p>The certification has not opened yet, so nobody is listed here. The first people to pass it will be.</p>
        </div>
    </div>
</template>

<style scoped>
.lookup {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: 10px;
    margin: 24px 0 0;
}

.lookup .ac-field {
    flex: 1 1 260px;
}

.list {
    margin-top: 28px;
}

.list tbody th {
    text-align: left;
}

.empty {
    margin-top: 28px;
    padding: 18px 22px 8px;
    border: 2px dashed var(--circuit-line);
}

.chip {
    display: inline-block;
    margin: 0 0 6px !important;
    padding: 2px 8px;
    background: var(--circuit-ink);
    color: var(--circuit-paper);
    font-size: 12px !important;
    font-weight: 700;
    font-stretch: 120%;
    letter-spacing: 0.1em;
    line-height: 20px !important;
    text-transform: uppercase;
}
</style>
