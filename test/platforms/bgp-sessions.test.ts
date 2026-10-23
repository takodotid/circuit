// What `circuit bgp` reads on RouterOS, over a real SSH session against a fake device: each configured neighbor matched with its live session, and the BGP log kept to a window by the device's clock.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { BgpWait } from "../../src/platforms/bgp-wait";
import { Platforms } from "../../src/platforms";
import type { Device } from "../../src/schema";
import edge from "../../templates/edge-router/edge-01";
import { FakeSshDevice } from "./fake-ssh";

const platform = Platforms.get("routeros");

/** Sessions as the `:foreach` script prints them. `hurricane-electric` was renamed from `he`, and its session keeps the old name. */
let sessions = ["he-1|203.0.113.1|true|987654|1w2d03:04:05", "sgix-rs-v4-1|192.0.2.1|false||"];

const LOG = [
    "2026-10-24 02:40:00 route,bgp,info old line, outside the window",
    "2026-10-24 03:01:00 route,bgp,error sgix-rs-v4-1 hold timer expired",
    "2026-10-24 03:05:00 route,bgp,info hurricane-electric-1 established",
].join("\n");

const fake = new FakeSshDevice("operator+ct300w", (command) => {
    if (command.startsWith(":foreach s in=[/routing bgp session find]")) return sessions.join("\n") + "\n";
    if (command === ':put ([/system clock get date] . " " . [/system clock get time])') return "2026-10-24 03:10:00\n";
    if (command === '/log print where topics~"bgp" and !(message~"^connection ")') return LOG + "\n";
    return `bad command name ${command}\n`;
});

let device: Device;

beforeAll(async () => {
    process.env.EDGE_01_PASSWORD = FakeSshDevice.PASSWORD;
    device = { ...edge, connection: { host: "127.0.0.1", port: await fake.listen(), user: "operator" } };
});

afterAll(() => fake.close());

test("each configured neighbor gets a row: matched by address first, then by name, and down when there is no session", async () => {
    const session = await platform.session(device);

    try {
        expect(await platform.bgpSessions!(device, session)).toEqual([
            { neighbor: "hurricane-electric", remote: "203.0.113.1", established: true, prefixes: "987654", uptime: "1w2d03:04:05" },
            { neighbor: "sgix-rs-v4", remote: "192.0.2.1", established: false, prefixes: "-", uptime: "-" },
            { neighbor: "sgix-rs-v6", remote: "-", established: false, prefixes: "-", uptime: "no session" },
        ]);

        sessions = ["sgix-rs-v6-1|2001:db8:ffff::9|true|12|5m"];
        const [, , v6] = await platform.bgpSessions!(device, session);
        expect(v6).toMatchObject({ neighbor: "sgix-rs-v6", remote: "2001:db8:ffff::9", established: true });
    } finally {
        session.close();
    }
});

test("the log keeps the lines of the last minutes by the device's clock", async () => {
    const session = await platform.session(device);

    try {
        expect(await platform.bgpLog!(session, 10)).toEqual([
            { at: "2026-10-24 03:01:00", message: "route,bgp,error sgix-rs-v4-1 hold timer expired" },
            { at: "2026-10-24 03:05:00", message: "route,bgp,info hurricane-electric-1 established" },
        ]);
    } finally {
        session.close();
    }
});

test("waiting reads again until enough sessions are up, and gives up at the limit", async () => {
    let reads = 0;
    const read = async () => {
        reads++;
        return [{ neighbor: "a", remote: "-", established: reads >= 3, prefixes: "-", uptime: "-" }];
    };

    const up = await BgpWait.until(read, (rows) => BgpWait.upCount(rows) >= 1, { seconds: 5, every: 0.01 });
    expect(BgpWait.upCount(up)).toBe(1);
    expect(reads).toBe(3);

    const never = async () => [{ neighbor: "a", remote: "-", established: false, prefixes: "-", uptime: "-" }];
    const started = Date.now();
    expect(BgpWait.upCount(await BgpWait.until(never, (rows) => BgpWait.upCount(rows) >= 1, { seconds: 0.2, every: 0.05 }))).toBe(0);
    expect(Date.now() - started).toBeLessThan(2000);
});

test("only RouterOS reads BGP sessions so far", () => {
    const reading = Platforms.all().filter((candidate) => candidate.bgpSessions && candidate.bgpLog);
    expect(reading.map((candidate) => candidate.name)).toEqual(["routeros"]);
});
