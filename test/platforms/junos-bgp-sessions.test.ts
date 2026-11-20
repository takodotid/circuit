// What `circuit bgp` and the check after an apply read on Junos, over real SSH against a fake device. `NOT_RUNNING` is what a QFX5100 on 21.4R3-S8.5 printed. No device running BGP was at hand, so the sessions are in the form of Juniper's documentation of `show bgp neighbor` and `show bgp summary`.

import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import type { Device } from "../../src/model";
import { Platforms } from "../../src/platforms";
import { JunosBgpSessions } from "../../src/platforms/junos/bgp-sessions";
import { Fixtures } from "../fixtures";
import { FakeSshDevice } from "./fake-ssh";

const platform = Platforms.get("junos");
const aggregationSwitch = Fixtures.device("platforms--example-aggregation-switch");
const [transit, customer, collector] = Object.values(aggregationSwitch.routing!.bgp!.neighbors!);
/** The fixture's three neighbors, named for who they are: Hurricane Electric, a customer, and a route collector in our own AS. */
const withNeighbors: Device = {
    ...aggregationSwitch,
    routing: {
        ...aggregationSwitch.routing,
        bgp: {
            ...aggregationSwitch.routing!.bgp!,
            neighbors: {
                "hurricane-electric": { ...transit!, remote_as: 6939 },
                as64501: { ...customer!, remote_as: 64501 },
                "route-collector": collector!,
            },
        },
    },
};
const quick = { bgp: { seconds: 0.5, every: 0.05 } };
const noPlan = { steps: [], problems: [] };

/** What a switch with no BGP configured printed for both commands, as JSON. */
const NOT_RUNNING = `{
    "output" : [
    {
        "data" : "BGP is not running"
    }
    ]
}`;

/** An element as `| display json` writes it: a list of objects, the value in `data`. */
const value = (data: string) => [{ data }];

type PeerShape = {
    address: string;
    group?: string;
    instance?: string;
    state: string;
    flags?: string;
    elapsed?: string;
    ribs?: Record<string, number>;
};

/** A peer as `show bgp neighbor` or `show bgp summary` prints it, with only the fields Circuit reads and a few around them. */
function peer(shape: PeerShape): Record<string, unknown> {
    return {
        attributes: { "junos:style": shape.group ? "detail" : "terse" },
        "peer-address": value(shape.address),
        ...(shape.group
            ? { "peer-group": value(shape.group), "peer-cfg-rti": value(shape.instance ?? "master"), "peer-type": value("External") }
            : {}),
        "peer-state": value(shape.state),
        ...(shape.flags !== undefined ? { "peer-flags": value(shape.flags) } : {}),
        ...(shape.elapsed ? { "elapsed-time": [{ data: shape.elapsed, attributes: { "junos:seconds": "273845" } }] } : {}),
        ...(shape.ribs
            ? {
                  "bgp-rib": Object.entries(shape.ribs).map(([name, received]) => ({
                      name: value(name),
                      "active-prefix-count": value(String(received)),
                      "received-prefix-count": value(String(received)),
                      "accepted-prefix-count": value(String(received)),
                  })),
              }
            : {}),
    };
}

function answer(peers: PeerShape[]): string {
    const information = { attributes: { xmlns: "http://xml.juniper.net/junos/21.4R0/junos-routing" }, "bgp-peer": peers.map(peer) };
    return JSON.stringify({ "bgp-information": [information] }, null, 4);
}

/** Hurricane Electric and the customer are up, the customer in both families. The collector is passive and still waits. A peer in the VRF `guests` has the collector's address. */
const UP: PeerShape[] = [
    { address: "198.51.100.4+179", group: "hurricane-electric", state: "Established", flags: "Sync", ribs: { "inet.0": 812345 } },
    { address: "192.0.2.30+51234", group: "as64501", state: "Established", flags: "Sync", ribs: { "inet.0": 3, "inet6.0": 2 } },
    { address: "192.0.2.90", group: "route-collector", state: "Active", flags: "" },
    {
        address: "192.0.2.90+179",
        group: "guests-collector",
        instance: "guests",
        state: "Established",
        flags: "Sync",
        ribs: { "guests.inet.0": 1 },
    },
];

const SUMMARY: PeerShape[] = [
    { address: "198.51.100.4", state: "Established", elapsed: "3d 4:04:05", ribs: { "inet.0": 812345 } },
    { address: "192.0.2.30", state: "Established", elapsed: "1w2d 3:04:05", ribs: { "inet.0": 3, "inet6.0": 2 } },
    { address: "192.0.2.90", state: "Active", elapsed: "29w5d 22:42:36" },
    { address: "192.0.2.90", state: "Established", elapsed: "5:00", ribs: { "guests.inet.0": 1 } },
];

/** Hurricane Electric's session closed on its prefix limit. */
const LIMIT_CLOSED: PeerShape[] = [
    { address: "198.51.100.4", group: "hurricane-electric", state: "Idle", flags: "PrefixLimitIdle" },
    ...UP.slice(1),
];

/** The customer's session is down and connecting again. */
const ONE_DOWN: PeerShape[] = [UP[0]!, { address: "192.0.2.30", group: "as64501", state: "Connect", flags: "" }, ...UP.slice(2)];

/** What `show bgp neighbor` answers, read by read. The last read repeats. */
let neighborReads: string[];
let summary: string;

const fake = new FakeSshDevice("netops", (command) => {
    if (command === JunosBgpSessions.NEIGHBORS) return neighborReads.length > 1 ? neighborReads.shift()! : neighborReads[0]!;
    if (command === JunosBgpSessions.SUMMARY) return summary;
    return `error: syntax error, expecting <command>: ${command}\n`;
});

let device: Device;

beforeAll(async () => {
    process.env.EXAMPLE_NETOPS_PASSWORD = FakeSshDevice.PASSWORD;
    device = { ...withNeighbors, connection: { host: "127.0.0.1", port: await fake.listen(), user: "netops" } };
});

beforeEach(() => {
    neighborReads = [answer(UP)];
    summary = answer(SUMMARY);
});

afterAll(() => {
    delete process.env.EXAMPLE_NETOPS_PASSWORD;
    fake.close();
});

async function read(): Promise<Awaited<ReturnType<NonNullable<typeof platform.bgpSessions>>>> {
    const session = await platform.session(device);
    try {
        return await platform.bgpSessions!(device, session);
    } finally {
        session.close();
    }
}

test("where BGP is not running, as the switch says, every neighbor has no session", async () => {
    neighborReads = [NOT_RUNNING];
    summary = NOT_RUNNING;

    expect(await read()).toEqual([
        { neighbor: "hurricane-electric", remote: "-", established: false, prefixes: "-", uptime: "no session" },
        { neighbor: "as64501", remote: "-", established: false, prefixes: "-", uptime: "no session" },
        { neighbor: "route-collector", remote: "-", established: false, prefixes: "-", uptime: "no session" },
    ]);
});

test("each neighbor is its peer in its routing instance, with the prefixes of every table and the uptime from the summary", async () => {
    expect(await read()).toEqual([
        { neighbor: "hurricane-electric", remote: "198.51.100.4", established: true, prefixes: "812345", uptime: "3d 4:04:05" },
        { neighbor: "as64501", remote: "192.0.2.30", established: true, prefixes: "5", uptime: "1w2d 3:04:05" },
        { neighbor: "route-collector", remote: "192.0.2.90", established: false, prefixes: "-", uptime: "-", reason: "Active" },
    ]);
});

test("a peer idle on its prefix limit is down because of it", async () => {
    neighborReads = [answer(LIMIT_CLOSED)];

    const [hurricane] = await read();
    expect(hurricane).toEqual({
        neighbor: "hurricane-electric",
        remote: "198.51.100.4",
        established: false,
        prefixes: "-",
        uptime: "-",
        reason: "limit exceeded",
        limit: {},
    });
});

test("on the console, the line before the prompt that names the routing engine is not part of the JSON", () => {
    expect(JunosBgpSessions.peers(`${NOT_RUNNING}\n\n{master:0}`)).toEqual([]);
    expect(JunosBgpSessions.peers(`${answer(SUMMARY)}\n\n{master:0}`).map((peer) => peer.elapsed)).toEqual([
        "3d 4:04:05",
        "1w2d 3:04:05",
        "29w5d 22:42:36",
        "5:00",
    ]);
});

test("an answer that is not the JSON asked for fails, quoting the device", async () => {
    neighborReads = ["error: the routing subsystem is not running"];

    await expect(read()).rejects.toThrow(
        "the device's answer is not the JSON Circuit asked for: error: the routing subsystem is not running"
    );
});

test("after an apply, a session established before must be again: one that is not is named, one closed on its limit is told to be cleared", async () => {
    neighborReads = [answer(UP), answer(ONE_DOWN), answer(ONE_DOWN), answer(UP)];
    expect(await (await platform.health!(device, noPlan, quick)).run()).toEqual([]);

    neighborReads = [answer(UP), answer(ONE_DOWN)];
    expect(await (await platform.health!(device, noPlan, quick)).run()).toEqual([
        "BGP session as64501 was established before the apply and is not 0.5 s after it (Connect). Look with: circuit bgp example-aggregation-switch",
    ]);

    neighborReads = [answer(UP), answer(LIMIT_CLOSED)];
    expect(await (await platform.health!(device, noPlan, quick)).run()).toEqual([
        "BGP session hurricane-electric was established before the apply and closed on its limit: the neighbor sends more than it may. Find out why, then: clear the session on the device",
    ]);
});

test("after an apply on a device whose sessions were all down, there is nothing to wait for", async () => {
    neighborReads = [NOT_RUNNING];
    summary = NOT_RUNNING;
    const count = fake.commands.length;

    expect(await (await platform.health!(device, noPlan, quick)).run()).toEqual([]);
    expect(fake.commands.slice(count)).toEqual([JunosBgpSessions.NEIGHBORS, JunosBgpSessions.SUMMARY]);
});
