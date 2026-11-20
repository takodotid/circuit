// What `circuit bgp` and the check after an apply read on FortiOS, over real SSH against a fake device. In multi-VDOM mode a FortiGate 3700D on 6.2.2 without BGP answered as the fake does. No device running BGP was at hand, so the summaries are in the form of Fortinet's documentation.

import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import type { Device } from "../../src/model";
import { Platforms } from "../../src/platforms";
import { FortiOsBgpSessions } from "../../src/platforms/fortios/bgp-sessions";
import { Fixtures } from "../fixtures";
import { FakeSshDevice } from "./fake-ssh";

const platform = Platforms.get("fortios");
const firewall = Fixtures.device("platforms--example-firewall");
const [ipv4, ipv6, internal] = Object.values(firewall.routing!.bgp!.neighbors!);
/** The fixture's three neighbors, named for who they are: Cogent over IPv4 and IPv6, and a router in our own AS. */
const withNeighbors: Device = {
    ...firewall,
    routing: {
        ...firewall.routing,
        bgp: {
            ...firewall.routing!.bgp!,
            neighbors: { cogent: { ...ipv4!, remote_as: 174 }, "cogent-v6": { ...ipv6!, remote_as: 174 }, internal: internal! },
        },
    },
};
const quick = { bgp: { seconds: 0.5, every: 0.05 } };
const noPlan = { steps: [], problems: [] };

const V4 = FortiOsBgpSessions.SUMMARY.ipv4;
const V6 = FortiOsBgpSessions.SUMMARY.ipv6;

/** Cogent is up. The internal neighbor is passive and still waits. */
const V4_UP = [
    "BGP router identifier 198.51.100.255, local AS number 64500",
    "BGP table version is 5",
    "1 BGP AS-PATH entries",
    "0 BGP community entries",
    "",
    "Neighbor        V         AS MsgRcvd MsgSent   TblVer  InQ OutQ Up/Down  State/PfxRcd",
    "192.0.2.130     4      64500       0       0        0    0    0 never    Active",
    "203.0.113.9     4        174   12034   11876        5    0    0 3d04h12m      812",
    "",
    "Total number of neighbors 2",
    "",
].join("\r\n");

/** Cogent's IPv6 session, its address on a line of its own, as GNU Zebra's summary prints an address wider than its column. */
const V6_UP = [
    "BGP router identifier 198.51.100.255, local AS number 64500",
    "BGP table version is 2",
    "1 BGP AS-PATH entries",
    "0 BGP community entries",
    "",
    "Neighbor        V         AS MsgRcvd MsgSent   TblVer  InQ OutQ Up/Down  State/PfxRcd",
    "2001:db8:fff0::1",
    "                4        174    9021    8840        2    0    0 3d04h11m      140",
    "",
    "Total number of neighbors 1",
    "",
].join("\r\n");

/** Cogent's session closed on its prefix limit, and the device keeps it closed. */
const V4_LIMIT = V4_UP.replace("3d04h12m      812", "never    Idle (PfxCt)");

let answers: Record<string, string>;
/** Each IPv4 summary, read by read. The last read repeats. */
let v4Reads: string[];

const fake = new FakeSshDevice(
    "netops",
    (command) => {
        if (command === V4) return v4Reads.length > 1 ? v4Reads.shift()! : v4Reads[0]!;
        return answers[command] ?? "\r\ncommand parse error before 'x'\r\nCommand fail. Return code -61\r\n";
    },
    { banner: "example-firewall # ", prompt: () => "example-firewall # " }
);

let device: Device;

beforeAll(async () => {
    process.env.EXAMPLE_NETOPS_PASSWORD = FakeSshDevice.PASSWORD;
    device = { ...withNeighbors, connection: { host: "127.0.0.1", port: await fake.listen(), user: "netops" } };
});

beforeEach(() => {
    answers = { [V6]: V6_UP };
    v4Reads = [V4_UP];
});

afterAll(() => {
    delete process.env.EXAMPLE_NETOPS_PASSWORD;
    fake.close();
});

async function read(target: Device = device): Promise<Awaited<ReturnType<NonNullable<typeof platform.bgpSessions>>>> {
    const session = await platform.session(target);
    try {
        return await platform.bgpSessions!(target, session);
    } finally {
        session.close();
    }
}

test("each neighbor is its line in the summary of each family it carries, up when the line counts prefixes", async () => {
    const count = fake.commands.length;

    expect(await read()).toEqual([
        { neighbor: "cogent", remote: "203.0.113.9", established: true, prefixes: "812", uptime: "3d04h12m" },
        { neighbor: "cogent-v6", remote: "2001:db8:fff0::1", established: true, prefixes: "140", uptime: "3d04h11m" },
        { neighbor: "internal", remote: "192.0.2.130", established: false, prefixes: "-", uptime: "-", reason: "Active" },
    ]);
    // In one VDOM, each summary runs on its own.
    expect(fake.commands.slice(count)).toEqual([V4, V6]);
});

test("a neighbor idle on its prefix limit is down because of it", async () => {
    v4Reads = [V4_LIMIT];

    const [cogent] = await read();
    expect(cogent).toEqual({
        neighbor: "cogent",
        remote: "203.0.113.9",
        established: false,
        prefixes: "-",
        uptime: "-",
        reason: "limit exceeded",
        limit: {},
    });
});

test("in multi-VDOM mode the summaries are read in root; without BGP there, as on the FG-3700D, every neighbor has no session", async () => {
    const multi: Device = { ...device, system: { ...device.system, vdoms: { management: { name: "mgmt", interfaces: [] } } } };
    answers = { "config vdom": "", "edit root": "current vf=root:0\r\n", [V6]: "", end: "" };
    v4Reads = [""];
    const lines = fake.shellLines.length;

    expect(await read(multi)).toEqual([
        { neighbor: "cogent", remote: "-", established: false, prefixes: "-", uptime: "no session" },
        { neighbor: "cogent-v6", remote: "-", established: false, prefixes: "-", uptime: "no session" },
        { neighbor: "internal", remote: "-", established: false, prefixes: "-", uptime: "no session" },
    ]);
    expect(fake.shellLines.slice(lines)).toEqual(["config vdom", "edit root", V4, V6, "end"]);
});

test("a summary the device refuses fails, quoting it", async () => {
    answers = {};

    await expect(read()).rejects.toThrow("the device refused its BGP summary: command parse error before 'x'");
});

test("after an apply, a session established before must be again: one that is not is named, one closed on its limit is told to be cleared", async () => {
    const down = V4_UP.replace("3d04h12m      812", "00:00:12 Connect");

    v4Reads = [V4_UP, down, down, V4_UP];
    expect(await (await platform.health!(device, noPlan, quick)).run()).toEqual([]);

    v4Reads = [V4_UP, down];
    expect(await (await platform.health!(device, noPlan, quick)).run()).toEqual([
        "BGP session cogent was established before the apply and is not 0.5 s after it (Connect). Look with: circuit bgp example-firewall",
    ]);

    v4Reads = [V4_UP, V4_LIMIT];
    expect(await (await platform.health!(device, noPlan, quick)).run()).toEqual([
        "BGP session cogent was established before the apply and closed on its limit: the neighbor sends more than it may. Find out why, then: clear the session on the device",
    ]);
});
