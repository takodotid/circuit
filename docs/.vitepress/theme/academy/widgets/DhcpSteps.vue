<script setup lang="ts">
// Lesson: DHCP. The reader steps through the four DHCP messages between a laptop that has just joined VLAN 20 and the router, and reads what each message says.

import { useTravel, type Point } from "../travel";

type Place = "laptop" | "switch" | "router" | "printer";

const at: Record<Place, Point> = {
    laptop: [90, 70],
    switch: [320, 70],
    router: [550, 70],
    printer: [320, 170],
};

type Message = { name: string; from: string; to: string; says: string; path: Place[]; broadcast: boolean };

const steps = [
    {
        title: "A laptop joins, with nothing",
        text: "The laptop is plugged into a port in VLAN 20. It has its hardware address, but no IP address, no gateway and no DNS server. It cannot talk to anyone by IP yet.",
    },
    {
        title: "1. Discover",
        text: "The laptop shouts to the whole VLAN: is there a DHCP server here? It has no address of its own to send from, and no idea where the server is, so it sends a broadcast. The switch passes it to every port in VLAN 20.",
    },
    {
        title: "2. Offer",
        text: "The router is the DHCP server for this VLAN. It picks a free address from its pool and offers it, with everything else the laptop needs. The printer heard the discover too, but it is not a DHCP server, so it said nothing.",
    },
    {
        title: "3. Request",
        text: "The laptop asks for the address it was offered. It broadcasts again, so that if more than one server made an offer, all of them hear which one was taken.",
    },
    {
        title: "4. Acknowledge",
        text: "The router confirms: the address is the laptop's for one day. It writes down the lease, this address for this hardware address, until this time.",
    },
    {
        title: "The laptop is on the network",
        text: "The laptop sets its address, mask, gateway and DNS server, and can now reach anything. Halfway through the lease, it asks the router to renew it, so while it stays, it keeps the same address.",
    },
];

// What travels on each step, from step 1 to step 4.
const messages: (Message | undefined)[] = [
    undefined,
    {
        name: "Discover",
        from: "0.0.0.0, port 68",
        to: "255.255.255.255, port 67 (everyone)",
        says: "Is there a DHCP server? My hardware address is 3c:22:fb:0a:91:7e.",
        path: ["laptop", "switch"],
        broadcast: true,
    },
    {
        name: "Offer",
        from: "192.168.20.1, port 67",
        to: "the laptop, port 68",
        says: "You can have 192.168.20.100, mask 255.255.255.0, gateway 192.168.20.1, DNS server 192.168.20.1, for 1 day.",
        path: ["router", "switch", "laptop"],
        broadcast: false,
    },
    {
        name: "Request",
        from: "0.0.0.0, port 68",
        to: "255.255.255.255, port 67 (everyone)",
        says: "I would like 192.168.20.100, from the server 192.168.20.1.",
        path: ["laptop", "switch"],
        broadcast: true,
    },
    {
        name: "Acknowledge",
        from: "192.168.20.1, port 67",
        to: "the laptop, port 68",
        says: "192.168.20.100 is yours for 1 day.",
        path: ["router", "switch", "laptop"],
        broadcast: false,
    },
    undefined,
];

// The devices with a cable to the switch.
const spokes: Place[] = ["laptop", "router", "printer"];

const toRouter = useTravel();
const toPrinter = useTravel();

/** Where the message on a step goes, cable by cable, so the drawing can light them. */
function cablesOf(step: number): Place[] {
    const sent = messages[step];
    if (!sent) return [];
    return sent.broadcast ? ["laptop", "router", "printer"] : ["router", "laptop"];
}

async function show(step: number) {
    const sent = messages[step];
    if (!sent) return;

    const points = sent.path.map((place) => at[place]);

    if (!sent.broadcast) {
        await toRouter.travel(points);
        return;
    }

    await toRouter.travel(points);
    await Promise.all([toRouter.travel([at.switch, at.router]), toPrinter.travel([at.switch, at.printer])]);
}

const laptopNote = (step: number) => (step >= 4 ? "192.168.20.100" : "no address yet");
</script>

<template>
    <StepThrough :steps="steps" @change="show" v-slot="{ step }">
        <svg
            class="ac-drawing"
            viewBox="0 0 640 235"
            role="img"
            :aria-label="`A laptop, a switch, a router that is the DHCP server, and a printer, all in VLAN 20. Step ${step + 1}.`"
        >
            <line
                v-for="place in spokes"
                :key="place"
                class="cable"
                :class="{ lit: cablesOf(step).includes(place) }"
                :x1="at.switch[0]"
                :y1="at.switch[1]"
                :x2="at[place][0]"
                :y2="at[place][1]"
            />

            <SvgDevice kind="laptop" :x="at.laptop[0]" :y="at.laptop[1]" label="Laptop" :note="laptopNote(step)" :lit="step === 5" />
            <SvgDevice kind="switch" :x="at.switch[0]" :y="at.switch[1]" label="Switch" note="VLAN 20" />
            <SvgDevice kind="router" :x="at.router[0]" :y="at.router[1]" label="Router, DHCP server" note="192.168.20.1" />
            <SvgDevice kind="printer" :x="at.printer[0]" :y="at.printer[1]" label="Printer" note="192.168.20.20" />

            <circle
                v-if="toRouter.travelling.value"
                class="packet"
                :cx="toRouter.position.value[0]"
                :cy="toRouter.position.value[1]"
                r="9"
            />
            <circle
                v-if="toPrinter.travelling.value"
                class="packet"
                :cx="toPrinter.position.value[0]"
                :cy="toPrinter.position.value[1]"
                r="9"
            />
        </svg>

        <dl v-if="messages[step]" class="message">
            <div class="name">{{ messages[step]?.name }}</div>
            <div>
                <dt>From</dt>
                <dd>{{ messages[step]?.from }}</dd>
            </div>
            <div>
                <dt>To</dt>
                <dd>{{ messages[step]?.to }}</dd>
            </div>
            <div>
                <dt>Says</dt>
                <dd>{{ messages[step]?.says }}</dd>
            </div>
        </dl>
    </StepThrough>
</template>

<style scoped>
.message {
    display: grid;
    gap: 4px;
    margin: 10px 0 0;
    padding: 10px 14px;
    border: 2px solid var(--circuit-ink);
}

.message .name {
    justify-self: start;
    padding: 0 6px;
    background: var(--circuit-cobalt);
    color: #ffffff;
    font-size: 11px;
    font-weight: 700;
    font-stretch: 115%;
    letter-spacing: 0.08em;
    line-height: 20px;
    text-transform: uppercase;
}

.message > div:not(.name) {
    display: grid;
    grid-template-columns: 4.5em 1fr;
    gap: 8px;
}

dt {
    color: var(--circuit-soft);
    font-size: 13px;
    font-weight: 600;
}

dd {
    margin: 0;
    font-family: var(--circuit-mono);
    font-size: 13px;
    line-height: 1.5;
}
</style>
