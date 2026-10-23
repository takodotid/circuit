// What a real RouterOS device printed, proved on a CCR2216 on 7.23.5, with names and addresses replaced. Each test feeds the device's own lines to the adapter.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { Platforms } from "../../src/platforms";
import type { Device } from "../../src/schema";
import edge from "../../templates/edge-router/edge-01";
import { FakeSshDevice } from "./fake-ssh";

const platform = Platforms.get("routeros");
const options = { secrets: false, rollback: 10 };

/** The `:foreach` over `/routing bgp session`, as the router printed it. The transit's connection was renamed, so its session keeps the old name; a session that never established prints `established` empty and no uptime. */
const SESSIONS = [
    "transit-global-v4-1|203.0.113.1|true|1099935|13:35:26.440",
    "sgix-rs-v4-1|192.0.2.1|true|9204|13:35:04.930",
    "sgix-rs-v6-1|2001:db8:ffff::1||0|",
].join("\n");

/** A BGP log line as the router printed it, trailing space included. */
const LOG_LINE =
    "2026-10-24 04:50:03 route,bgp,warning sgix-rs-v6-1 {l_addr: 2001:db8:ffff::10, r_addr: 2001:db8:ffff::1} Starter {openOk: false} Received Notification [ code: (6,5), msg: (cease: connection rejected)] ";

const fake = new FakeSshDevice("operator+ct300w", (command) => {
    if (command.startsWith(":foreach s in=[/routing bgp session find]")) return SESSIONS + "\n";
    if (command === ':put ([/system clock get date] . " " . [/system clock get time])') return "2026-10-24 04:53:08\n";
    if (command === '/log print where topics~"bgp" and !(message~"^connection ")') return LOG_LINE + "\n";
    return `bad command name ${command}\n`;
});

let device: Device;

beforeAll(async () => {
    process.env.EDGE_01_PASSWORD = FakeSshDevice.PASSWORD;
    device = { ...edge, connection: { host: "127.0.0.1", port: await fake.listen(), user: "operator" } };
});

afterAll(() => fake.close());

test("circuit bgp reads the router's sessions: a renamed connection by its address, one never established as down", async () => {
    const session = await platform.session(device);

    try {
        expect(await platform.bgpSessions!(device, session)).toEqual([
            { neighbor: "hurricane-electric", remote: "203.0.113.1", established: true, prefixes: "1099935", uptime: "13:35:26.440" },
            { neighbor: "sgix-rs-v4", remote: "192.0.2.1", established: true, prefixes: "9204", uptime: "13:35:04.930" },
            { neighbor: "sgix-rs-v6", remote: "2001:db8:ffff::1", established: false, prefixes: "0", uptime: "-" },
        ]);

        const [line] = await platform.bgpLog!(session, 10);
        expect(line?.at).toBe("2026-10-24 04:50:03");
        expect(line?.message.endsWith("(cease: connection rejected)]")).toBe(true);
    } finally {
        session.close();
    }
});

test("a VLAN interface that keeps its name and takes a new VLAN ID is changed with a set, and its address stays", () => {
    const withVlan = (id: number): Device => ({
        ...edge,
        vlans: { ...edge.vlans, test: { id } },
        interfaces: { ...edge.interfaces, "test-vlan01": { type: "vlan", vlan: "test", addresses: ["192.0.2.201/30"] } },
    });

    // The export as the router printed it, wrapped, after the interface was added on VLAN 3990.
    const running = platform
        .render(withVlan(3990))
        .replace("name=test-vlan01 vlan-id=3990", "name=test-vlan01 vlan-id=\\\n    3990");

    const plan = platform.plan(platform.render(withVlan(3991)), running, options);
    const sent = plan.steps.flatMap((step) => step.send);

    expect(plan.problems).toEqual([]);
    expect(sent).toEqual([
        "/interface vlan set [ find interface=bridge and vlan-id=3990 ] vlan-id=3991",
        "/interface bridge vlan add bridge=bridge tagged=bridge vlan-ids=3991",
        "/interface bridge vlan remove [ find vlan-ids=3990 and !dynamic ]",
    ]);
});
