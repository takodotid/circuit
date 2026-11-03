<!-- The secrets, file by file: each name and how it is kept. To see the values, a person types the file's password; they are decrypted here, in the browser, and the password is never sent or kept. -->
<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import type { SecretsFileListing, SecretsListing } from "../../../types";
import { SecretsCrypto } from "../lib/secrets-crypto";
import { api } from "../lib/store";

const listing = ref<SecretsListing>();
const loadError = ref("");
/** By file: the password being typed, why it failed, whether it is being tried, and the values it opened. */
const typed = reactive<Record<string, string>>({});
const failed = reactive<Record<string, string>>({});
const busy = reactive<Record<string, boolean>>({});
const shown = reactive<Record<string, Record<string, string>>>({});

onMounted(async () => {
    try {
        listing.value = await api<SecretsListing>("/api/secrets");
    } catch (error) {
        loadError.value = (error as Error).message;
    }
});

const encryptedOf = (file: SecretsFileListing) => file.entries.filter((entry) => entry.kind === "encrypted");

/** Decrypt every encrypted value of a file with the typed password, then forget the password. */
async function reveal(file: SecretsFileListing): Promise<void> {
    failed[file.file] = "";
    const crypto = new SecretsCrypto(typed[file.file] ?? "");
    typed[file.file] = "";
    busy[file.file] = true;

    try {
        const values: Record<string, string> = {};
        for (const entry of encryptedOf(file)) values[entry.name] = await crypto.decrypt(entry.name, entry.ciphertext!);
        shown[file.file] = values;
    } catch {
        failed[file.file] = `That password does not open ${file.file}.`;
    } finally {
        busy[file.file] = false;
    }
}

const KIND: Record<string, string> = {
    encrypted: "encrypted",
    "1password": "kept in 1Password",
    empty: "empty",
    "not encrypted": "NOT ENCRYPTED: run circuit secrets encrypt",
    missing: "missing: the project needs it",
};
</script>

<template>
    <h2>Secrets</h2>
    <p class="muted">
        Each secret, and how it is kept. Add or change one with <code>circuit secrets</code>. A value is never sent to this page in plain
        text.
    </p>
    <p v-if="loadError" class="verdict reject">{{ loadError }}</p>

    <section v-for="file in listing?.files ?? []" :key="file.file">
        <h3>
            <code>{{ file.file }}</code>
        </h3>
        <p class="muted">
            {{ file.networks.length > 1 ? "Networks" : "Network" }} {{ file.networks.join(", ") }}. Its password:
            {{ file.passwordLocation ?? "typed when Circuit asks" }}.
        </p>

        <form v-if="encryptedOf(file).length" class="tool-form" autocomplete="off" @submit.prevent="reveal(file)">
            <label class="field"
                >The password of {{ file.file }}
                <input v-model="typed[file.file]" type="password" autocomplete="off" spellcheck="false" />
                <small>Used here in the browser to decrypt, then forgotten. It is never sent anywhere or kept.</small>
            </label>
            <button class="primary" type="submit" :disabled="busy[file.file]">
                {{ busy[file.file] ? "Opening…" : "Show the values" }}
            </button>
            <button v-if="shown[file.file]" type="button" @click="delete shown[file.file]">Hide them</button>
        </form>
        <p v-if="failed[file.file]" class="verdict reject">{{ failed[file.file] }}</p>

        <p v-if="!file.entries.length" class="muted">No secrets yet.</p>
        <table v-else class="data">
            <thead>
                <tr>
                    <th>Name</th>
                    <th>Kept</th>
                    <th>Value</th>
                </tr>
            </thead>
            <tbody>
                <tr v-for="entry in file.entries" :key="entry.name">
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
                        <code v-else-if="shown[file.file]?.[entry.name] !== undefined">{{ shown[file.file]![entry.name] }}</code>
                        <span v-else class="muted">{{ entry.kind === "encrypted" ? "hidden" : "" }}</span>
                    </td>
                </tr>
            </tbody>
        </table>
    </section>
</template>
