<script setup lang="ts">
// Lesson: DHCP. The reader sets a guest VLAN's pool and lease time, lets guests arrive and leave, moves the clock on, and watches the pool fill and empty, with the router's dhcp block written beside it.

import { computed, ref } from "vue";

type Guest = { name: string; mac: string; here: boolean; address?: number; leasedAt: number; leaseEnds: number };

const FIRST = 100;
const sizes = [4, 8, 12];
const leases = [
    { hours: 1, seconds: 3600, label: "1 hour" },
    { hours: 8, seconds: 28800, label: "8 hours" },
    { hours: 24, seconds: 86400, label: "1 day" },
];

const size = ref(4);
const leaseHours = ref(24);
const clock = ref(0);
const guests = ref<Guest[]>([]);
const log = ref<string[]>([]);
const said = ref<{ kind: "good" | "bad" | "warn"; word?: string; text: string }>();
let arrivals = 0;

const pool = computed(() => Array.from({ length: size.value }, (_, index) => FIRST + index));
const lease = computed(() => leases.find((entry) => entry.hours === leaseHours.value)!);
const holderOf = (address: number) => guests.value.find((guest) => guest.address === address);
const freeCount = computed(() => pool.value.filter((address) => !holderOf(address)).length);

const ip = (last: number) => `192.168.30.${last}`;

const present = computed(() => guests.value.filter((guest) => guest.here));

/** Each address in the pool, and who holds it. */
const slots = computed(() =>
    pool.value.map((address) => {
        const holder = holderOf(address);

        if (!holder) return { address, state: "free", text: "free" };
        if (holder.here) return { address, state: "here", text: `${holder.name}, here` };
        return { address, state: "held", text: `${holder.name} left, kept until ${when(holder.leaseEnds)}` };
    })
);

/** A day and an hour, from hours since the start. */
const when = (hours: number) => `day ${Math.floor(hours / 24) + 1}, ${String(hours % 24).padStart(2, "0")}:00`;

function note(line: string) {
    log.value = [`${when(clock.value)}: ${line}`, ...log.value].slice(0, 5);
}

function restart() {
    clock.value = 0;
    guests.value = [];
    log.value = [];
    arrivals = 0;
}

function setSize(value: number) {
    size.value = value;
    restart();
    said.value = { kind: "warn", word: "New pool", text: "The router starts again with a new pool and no leases." };
}

function setLease(hours: number) {
    leaseHours.value = hours;
    restart();
    said.value = { kind: "warn", word: "New lease time", text: "The router starts again with the new lease time and no leases." };
}

function onSize(event: Event) {
    setSize(Number((event.target as HTMLSelectElement).value));
}

function onLease(event: Event) {
    setLease(Number((event.target as HTMLSelectElement).value));
}

function arrive() {
    arrivals += 1;
    const name = `Guest ${arrivals}`;
    const mac = `00:00:5e:00:53:${arrivals.toString(16).padStart(2, "0")}`;
    const free = pool.value.find((address) => !holderOf(address));

    if (free === undefined) {
        guests.value = [...guests.value, { name, mac, here: true, leasedAt: clock.value, leaseEnds: clock.value }];
        note(`${name} asked, and got no answer: the pool is empty.`);
        said.value = {
            kind: "bad",
            word: "No address",
            text: `Every address in the pool is leased, so ${name} gets no offer. Most phones and laptops then make up an address starting with 169.254, which reaches nothing beyond their own network: no internet for ${name}.`,
        };
        return;
    }

    guests.value = [
        ...guests.value,
        { name, mac, here: true, address: free, leasedAt: clock.value, leaseEnds: clock.value + leaseHours.value },
    ];
    note(`${name} leased ${ip(free)} until ${when(clock.value + leaseHours.value)}.`);
    said.value = {
        kind: "good",
        word: "Leased",
        text: `${name} got ${ip(free)} for ${lease.value.label}. ${freeCount.value} of ${size.value} addresses are still free.`,
    };
}

function leave(guest: Guest) {
    guests.value = guests.value.map((entry) => (entry === guest ? { ...entry, here: false } : entry));

    if (guest.address === undefined) {
        guests.value = guests.value.filter((entry) => entry.name !== guest.name);
        said.value = { kind: "warn", word: "Gone", text: `${guest.name} left. It never had an address, so nothing changes.` };
        return;
    }

    note(`${guest.name} left without a word. ${ip(guest.address)} stays leased until ${when(guest.leaseEnds)}.`);
    said.value = {
        kind: "warn",
        word: "Still held",
        text: `${guest.name} walked out, but phones do not say goodbye. The router keeps ${ip(guest.address)} for it until the lease ends, ${when(guest.leaseEnds)}.`,
    };
}

function wait(hours: number) {
    let freed = 0;

    for (let hour = 0; hour < hours; hour++) {
        clock.value += 1;

        for (const guest of guests.value) {
            if (guest.address === undefined) continue;

            // A device that is still here renews its lease once half of it has passed.
            if (guest.here && clock.value - guest.leasedAt >= leaseHours.value / 2) {
                guest.leasedAt = clock.value;
                guest.leaseEnds = clock.value + leaseHours.value;
            }
        }

        const ended = guests.value.filter((guest) => !guest.here && guest.address !== undefined && clock.value >= guest.leaseEnds);
        for (const guest of ended) note(`the lease of ${guest.name} ended. ${ip(guest.address!)} is free again.`);
        freed += ended.length;
        guests.value = guests.value.filter((guest) => !ended.includes(guest));

        // A device still waiting for an address asks again, and takes one if a lease has ended.
        for (const guest of guests.value) {
            if (!guest.here || guest.address !== undefined) continue;

            const free = pool.value.find((address) => !holderOf(address));
            if (free === undefined) continue;

            guest.address = free;
            guest.leasedAt = clock.value;
            guest.leaseEnds = clock.value + leaseHours.value;
            note(`${guest.name} asked again, and leased ${ip(free)}.`);
        }
    }

    const here = guests.value.filter((guest) => guest.here && guest.address !== undefined).length;
    const keeping = here ? `Guests still here keep their addresses, because they renew each lease halfway through. ` : "";

    said.value = {
        kind: freed ? "good" : "warn",
        word: freed ? `${freed} freed` : "Nothing freed",
        text: `It is now ${when(clock.value)}. ${keeping}${freeCount.value} of ${size.value} addresses are free.`,
    };
}

/** The router's dhcp block, as the reader has set it. */
const file = computed(() =>
    [
        "dhcp: {",
        "    guests: {",
        '        interface: "guests",',
        '        network: "192.168.30.0/24",',
        '        gateway: "192.168.30.1",',
        '        dns: ["192.168.30.1"],',
        `        pool: ["${ip(FIRST)}", "${ip(FIRST + size.value - 1)}"],`,
        `        lease_time: ${lease.value.seconds},`,
        "    },",
        "},",
    ].join("\n")
);
</script>

<template>
    <div class="dhcp-pool">
        <div class="settings">
            <label class="ac-field">
                <span>Pool size</span>
                <select class="ac-select" :value="size" @change="onSize">
                    <option v-for="entry in sizes" :key="entry" :value="entry">{{ entry }} addresses</option>
                </select>
            </label>
            <label class="ac-field">
                <span>Lease time</span>
                <select class="ac-select" :value="leaseHours" @change="onLease">
                    <option v-for="entry in leases" :key="entry.hours" :value="entry.hours">{{ entry.label }}</option>
                </select>
            </label>
        </div>

        <CodeView :code="file" lang="ts" title="router.ts, the guest VLAN's DHCP server" :highlight="[7, 8]" />

        <p class="clock">
            <strong>{{ when(clock) }}</strong>
            <span>{{ freeCount }} of {{ size }} addresses free</span>
        </p>

        <ul class="pool" aria-label="The addresses in the pool">
            <li v-for="slot in slots" :key="slot.address" :class="slot.state">
                <span class="address">{{ ip(slot.address) }}</span>
                <span class="who">{{ slot.text }}</span>
            </li>
        </ul>

        <div class="ac-row actions">
            <button type="button" class="ac-button primary" @click="arrive">A guest arrives</button>
            <button type="button" class="ac-button" @click="wait(1)">Wait 1 hour</button>
            <button type="button" class="ac-button" @click="wait(24)">Wait 1 day</button>
        </div>

        <div v-if="present.length" class="ac-row leaving">
            <span class="leave-label">Who leaves?</span>
            <button v-for="guest in present" :key="guest.name" type="button" class="ac-button small" @click="leave(guest)">
                {{ guest.name }} leaves
            </button>
        </div>

        <p v-if="said" class="ac-say" :class="said.kind" :data-word="said.word" aria-live="polite">{{ said.text }}</p>
        <p v-else class="ac-say hint" aria-live="polite">
            This is a guest Wi-Fi with a small pool and day-long leases. Let a few guests arrive, let some leave, and keep more arriving.
        </p>

        <ol v-if="log.length" class="log" aria-label="What the router did, newest first">
            <li v-for="line in log" :key="line">{{ line }}</li>
        </ol>
    </div>
</template>

<style scoped>
.settings {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
}

.dhcp-pool :deep(.code-view) {
    margin: 14px 0;
}

.clock {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 6px 16px;
    margin: 0 0 8px !important;
}

.clock span {
    color: var(--circuit-soft);
}

.pool {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 8px;
    margin: 0 !important;
    padding: 0 !important;
    list-style: none;
}

.pool li {
    display: grid;
    gap: 2px;
    margin: 0 !important;
    padding: 6px 10px;
    border: 1.5px solid var(--circuit-line);
    font-size: 13.5px;
    line-height: 1.35;
}

.pool li.here {
    border-color: var(--circuit-cobalt);
    background: var(--circuit-cobalt);
    color: #ffffff;
}

.pool li.held {
    border: 2px dashed var(--circuit-warning);
}

.address {
    font-family: var(--circuit-mono);
    font-size: 12.5px;
}

.who {
    font-weight: 600;
}

.actions {
    margin-top: 14px;
}

.leaving {
    margin-top: 10px;
}

.leave-label {
    color: var(--circuit-soft);
    font-size: 13px;
    font-weight: 600;
}

.log {
    margin: 12px 0 0 !important;
    padding-left: 1.2em !important;
    color: var(--circuit-soft);
    font-size: 13.5px;
}

.log li {
    margin: 2px 0 !important;
}

.hint {
    color: var(--circuit-soft);
}
</style>
