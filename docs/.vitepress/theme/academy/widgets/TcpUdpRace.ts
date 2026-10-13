// The race in the ports lesson, worked out in advance: when each piece of a message is sent, lost, resent and delivered over TCP and over UDP, from one loss pattern.

export const WORD = "NETWORKING";

/** Milliseconds between two pieces leaving the sender. */
const GAP = 10;
/** How long TCP waits for a "got it" before it sends a piece again. */
const WAIT_FOR_REPLY = 110;

export type Flight = {
    lane: "tcp" | "udp";
    kind: "piece" | "reply" | "hello";
    text: string;
    /** True when it travels from the server back to the laptop. */
    back: boolean;
    start: number;
    /** When it arrives, or when it is lost on the way. */
    end: number;
    lost: boolean;
};

export type Race = {
    flights: Flight[];
    /** When each piece reaches the server over TCP, and when the program there gets it, in order. */
    tcpArrived: number[];
    tcpGiven: number[];
    tcpDone: number;
    tcpResent: number;
    /** The pieces that reach the server over UDP, in the order they arrive. */
    udpArrivals: { index: number; at: number }[];
    udpDone: number;
    lostPieces: number[];
    end: number;
};

/** The same numbers every time for the same seed, so a race can be run again. */
function numbers(seed: number) {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let value = state;
        value = Math.imul(value ^ (value >>> 15), value | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
}

export function runRace(pattern: number, lossRate: number): Race {
    // Pattern 1 starts a few seeds in, where a little loss already shows both a lost piece and a late one.
    const seed = pattern + 5;
    const lossDraw = numbers(seed * 101);
    const tcpDraw = numbers(seed * 211 + 7);
    const udpDraw = numbers(seed * 307 + 13);
    const trip = (draw: () => number) => 34 + Math.round(draw() * 14);

    // The same pieces are lost the first time on both lanes, so the two can be compared.
    const lostFirst = [...WORD].map(() => lossDraw() < lossRate);
    const flights: Flight[] = [];

    // UDP: every piece is sent once, straight away, and nothing is checked.
    const udpArrivals: { index: number; at: number }[] = [];
    [...WORD].forEach((letter, index) => {
        const start = index * GAP;
        const time = trip(udpDraw);

        if (lostFirst[index]) {
            flights.push({ lane: "udp", kind: "piece", text: letter, back: false, start, end: start + time / 2, lost: true });
            return;
        }

        flights.push({ lane: "udp", kind: "piece", text: letter, back: false, start, end: start + time, lost: false });
        udpArrivals.push({ index, at: start + time });
    });
    udpArrivals.sort((a, b) => a.at - b.at);
    const udpDone = Math.max(...flights.filter((flight) => flight.lane === "udp").map((flight) => flight.end));

    // TCP: a handshake of three messages first, then every piece, each answered with a "got it".
    const hello = trip(tcpDraw);
    const helloBack = trip(tcpDraw);
    const ready = hello + helloBack;
    flights.push({ lane: "tcp", kind: "hello", text: "hello?", back: false, start: 0, end: hello, lost: false });
    flights.push({ lane: "tcp", kind: "hello", text: "hello!", back: true, start: hello, end: ready, lost: false });
    flights.push({ lane: "tcp", kind: "hello", text: "ok", back: false, start: ready, end: ready + trip(tcpDraw), lost: false });

    const tcpArrived: number[] = [];
    let tcpResent = 0;

    [...WORD].forEach((letter, index) => {
        let start = ready + GAP * (index + 1);

        for (let attempt = 0; ; attempt++) {
            const time = trip(tcpDraw);
            const lost = attempt === 0 ? lostFirst[index]! : attempt < 5 && tcpDraw() < lossRate;

            if (lost) {
                flights.push({ lane: "tcp", kind: "piece", text: letter, back: false, start, end: start + time / 2, lost: true });
                start += WAIT_FOR_REPLY;
                tcpResent += 1;
                continue;
            }

            const arrived = start + time;
            flights.push({ lane: "tcp", kind: "piece", text: letter, back: false, start, end: arrived, lost: false });
            flights.push({ lane: "tcp", kind: "reply", text: "", back: true, start: arrived, end: arrived + trip(tcpDraw), lost: false });
            tcpArrived.push(arrived);
            break;
        }
    });

    // The program gets each piece only when every piece before it is there too.
    const tcpGiven: number[] = [];
    tcpArrived.forEach((arrived, index) => tcpGiven.push(Math.max(arrived, tcpGiven[index - 1] ?? 0)));
    const tcpDone = tcpGiven[tcpGiven.length - 1]!;

    const end = Math.max(...flights.map((flight) => flight.end)) + 20;
    const lostPieces = lostFirst.flatMap((lost, index) => (lost ? [index] : []));

    return { flights, tcpArrived, tcpGiven, tcpDone, tcpResent, udpArrivals, udpDone, lostPieces, end };
}
