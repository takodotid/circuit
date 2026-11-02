<script setup lang="ts">
// Lesson: layers. The reader follows one wrapped DNS question from a laptop through a switch and a router to a server, and sees which layers each device opens and which it rewrites.

type State = "made" | "read" | "changed" | "closed";

type Row = { number: number; name: string; state: State; text: string };

type Stop = { id: string; kind: "laptop" | "switch" | "router" | "server"; label: string; note: string; x: number };

const stops: Stop[] = [
    { id: "laptop", kind: "laptop", label: "Laptop", note: "192.168.20.10", x: 70 },
    { id: "switch", kind: "switch", label: "Switch", note: "", x: 250 },
    { id: "router", kind: "router", label: "Router", note: "", x: 430 },
    { id: "server", kind: "server", label: "DNS server", note: "192.168.30.53", x: 610 },
];

const steps = [
    {
        title: "The laptop wraps the question",
        text: "Each layer adds its header on the way down, and the physical layer sends the whole frame as signals. The frame is addressed to the router, because the server is on another network.",
    },
    {
        title: "The switch reads only the frame header",
        text: "The switch turns the signals back into a frame, reads the hardware address it is sent to, finds that address behind the port to the router, and sends the frame out there. It changes nothing.",
    },
    {
        title: "The router opens one layer more",
        text: "The frame was addressed to the router, so it takes the frame header off. It reads the IP address the packet is going to, finds the way in its routing table, lowers the TTL, and wraps the packet in a new frame for the server.",
    },
    {
        title: "The server unwraps every layer",
        text: "Each layer checks its header and hands what is inside up to the next: the frame is for this server, the packet is for this server, and port 53 is the DNS program, which finally reads the question.",
    },
];

const unopened = (number: number, name: string): Row => ({ number, name, state: "closed", text: "Not opened" });

// What each device does with each layer, from layer 5 down to layer 1.
const rows: Row[][] = [
    [
        { number: 5, name: "Application", state: "made", text: "Writes the question: what is the address of circuit.tako.id?" },
        { number: 4, name: "Transport", state: "made", text: "Adds a UDP header: from port 51000 to port 53" },
        { number: 3, name: "Network", state: "made", text: "Adds an IP header: from 192.168.20.10 to 192.168.30.53, TTL 64" },
        { number: 2, name: "Link", state: "made", text: "Adds a frame header: from 3c:22:fb:0a:91:7e to 00:00:5e:00:53:01, the router" },
        { number: 1, name: "Physical", state: "made", text: "Sends every bit as signals on the cable" },
    ],
    [
        unopened(5, "Application"),
        unopened(4, "Transport"),
        unopened(3, "Network"),
        { number: 2, name: "Link", state: "read", text: "Reads: to 00:00:5e:00:53:01. That address is behind the port to the router." },
        { number: 1, name: "Physical", state: "read", text: "Turns signals into bits, and back into signals on the way out" },
    ],
    [
        unopened(5, "Application"),
        unopened(4, "Transport"),
        { number: 3, name: "Network", state: "changed", text: "Reads: to 192.168.30.53. Lowers the TTL from 64 to 63." },
        {
            number: 2,
            name: "Link",
            state: "changed",
            text: "Removes the old frame header. Adds a new one: from 00:00:5e:00:53:02 to 00:00:5e:00:53:03, the server",
        },
        { number: 1, name: "Physical", state: "read", text: "Turns signals into bits, and back into signals on the way out" },
    ],
    [
        { number: 5, name: "Application", state: "read", text: "The DNS program reads the question" },
        { number: 4, name: "Transport", state: "read", text: "Port 53: hands what is inside to the DNS program" },
        { number: 3, name: "Network", state: "read", text: "To 192.168.30.53: that is this server" },
        { number: 2, name: "Link", state: "read", text: "To 00:00:5e:00:53:03: that is this server" },
        { number: 1, name: "Physical", state: "read", text: "Turns signals into bits" },
    ],
];

const word: Record<State, string> = { made: "Added", read: "Read", changed: "Changed", closed: "Closed" };
</script>

<template>
    <StepThrough :steps="steps" v-slot="{ step }">
        <svg
            class="ac-drawing"
            viewBox="0 0 680 120"
            role="img"
            :aria-label="`A laptop, a switch, a router and a DNS server in a row. The question is at the ${stops[step]?.label.toLowerCase()}.`"
        >
            <line
                v-for="(stop, index) in stops.slice(1)"
                :key="stop.id"
                class="cable"
                :class="{ lit: index < step }"
                :x1="stops[index]?.x"
                :y1="50"
                :x2="stop.x"
                :y2="50"
            />
            <SvgDevice
                v-for="(stop, index) in stops"
                :key="stop.id"
                :kind="stop.kind"
                :x="stop.x"
                :y="50"
                :label="stop.label"
                :note="stop.note"
                :lit="index === step"
                :dim="index > step"
            />
        </svg>

        <table class="ac-table layers">
            <thead>
                <tr>
                    <th scope="col">Layer</th>
                    <th scope="col">At the {{ stops[step]?.label.toLowerCase() }}</th>
                </tr>
            </thead>
            <tbody>
                <tr v-for="row in rows[step]" :key="row.number" :class="row.state">
                    <td class="name">{{ row.number }} {{ row.name }}</td>
                    <td>
                        <span class="state">{{ word[row.state] }}</span>
                        {{ row.text }}
                    </td>
                </tr>
            </tbody>
        </table>
    </StepThrough>
</template>

<style scoped>
.layers {
    display: table;
}

.name {
    width: 8.5em;
    font-weight: 700;
    white-space: nowrap;
}

.state {
    display: inline-block;
    min-width: 5.6em;
    margin-right: 6px;
    padding: 0 6px;
    border: 1.5px solid var(--circuit-ink);
    font-size: 11px;
    font-weight: 700;
    font-stretch: 115%;
    letter-spacing: 0.08em;
    line-height: 18px;
    text-align: center;
    text-transform: uppercase;
}

.made .state {
    border-color: var(--circuit-cobalt);
    background: var(--circuit-cobalt);
    color: #ffffff;
}

.changed td {
    background: var(--circuit-selected);
}

.changed .state {
    border-color: #0a1a36;
    background: var(--circuit-yellow);
    color: #0a1a36;
}

.closed td {
    color: var(--circuit-soft);
}

.closed .state {
    border-style: dashed;
    border-color: var(--circuit-soft);
}

@media (max-width: 640px) {
    .name {
        width: auto;
        white-space: normal;
    }
}
</style>
