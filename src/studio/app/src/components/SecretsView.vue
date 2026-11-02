<!-- The secrets in `.env`: each name and how it is kept. To see the values, a person types the key that decrypts `.env`; they are decrypted here, in the browser, and the key is never sent or kept. -->
<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import type { EnvListing } from "../../../types";
import { EnvCrypto } from "../lib/ecies";
import { api } from "../lib/store";

const listing = ref<EnvListing>();
const loadError = ref("");
const key = ref("");
const keyError = ref("");
const shown = ref<Record<string, string>>({});

onMounted(async () => {
    try {
        listing.value = await api<EnvListing>("/api/env");
    } catch (error) {
        loadError.value = (error as Error).message;
    }
});

const encrypted = computed(() => listing.value?.entries.filter((entry) => entry.kind === "encrypted") ?? []);

/** Decrypt every encrypted value with the typed key, then forget the key. */
function reveal(): void {
    keyError.value = "";
    const typed = key.value.trim();
    key.value = "";

    try {
        if (listing.value?.publicKey && !EnvCrypto.fits(typed, listing.value.publicKey)) {
            keyError.value = "That key does not decrypt this .env: it belongs to another .env, or the key was rotated.";
            return;
        }
        shown.value = Object.fromEntries(encrypted.value.map((entry) => [entry.name, EnvCrypto.decrypt(typed, entry.ciphertext!)]));
    } catch (error) {
        keyError.value = (error as Error).message;
    }
}

const KIND: Record<string, string> = {
    encrypted: "encrypted",
    "1password": "kept in 1Password",
    reference: "a reference",
    empty: "empty",
    "not encrypted": "NOT ENCRYPTED: run circuit secret encrypt",
    missing: "missing: the project needs it",
};
</script>

<template>
    <h2>Secrets</h2>
    <p class="muted">
        Each secret in <code>.env</code>, and how it is kept. Add or change one with <code>circuit secret set NAME</code>. A value is never
        sent to this page in plain text.
    </p>
    <p v-if="loadError" class="verdict reject">{{ loadError }}</p>

    <template v-if="listing">
        <p class="muted">The key that decrypts <code>.env</code>: {{ listing.keyLocation ?? "not on this machine" }}.</p>

        <form v-if="encrypted.length" class="tool-form" autocomplete="off" @submit.prevent="reveal">
            <label class="field"
                >The key that decrypts .env
                <input
                    v-model="key"
                    type="password"
                    autocomplete="off"
                    spellcheck="false"
                    placeholder="DOTENV_PRIVATE_KEY, 64 hex characters"
                />
                <small>Used here in the browser to decrypt, then forgotten. It is never sent anywhere or kept.</small>
            </label>
            <button class="primary" type="submit">Show the values</button>
            <button v-if="Object.keys(shown).length" type="button" @click="shown = {}">Hide them</button>
        </form>
        <p v-if="keyError" class="verdict reject">{{ keyError }}</p>

        <p v-if="!listing.entries.length" class="muted">No secrets yet.</p>
        <table v-else class="data">
            <thead>
                <tr>
                    <th>Name</th>
                    <th>Kept</th>
                    <th>Value</th>
                </tr>
            </thead>
            <tbody>
                <tr v-for="entry in listing.entries" :key="entry.name">
                    <td>
                        <code>{{ entry.name }}</code>
                    </td>
                    <td>
                        <span v-if="entry.kind === 'not encrypted' || entry.kind === 'missing'" class="badge error">{{
                            KIND[entry.kind]
                        }}</span>
                        <template v-else>{{ KIND[entry.kind] }}</template>
                    </td>
                    <td>
                        <template v-if="entry.onePassword">vault {{ entry.onePassword.vault }}, item {{ entry.onePassword.item }}</template>
                        <code v-else-if="shown[entry.name] !== undefined">{{ shown[entry.name] }}</code>
                        <span v-else class="muted">{{ entry.kind === "encrypted" ? "hidden" : "" }}</span>
                    </td>
                </tr>
            </tbody>
        </table>
    </template>
</template>
