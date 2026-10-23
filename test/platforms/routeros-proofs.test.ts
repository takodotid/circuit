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

/** The LLDP neighbors script, as the router printed it: a switch that sends its vendor as its system name, and a firewall port in a LAG. The far port is its description. */
const NEIGHBORS = ["qsfp28-1-1;bridge|Vendor|edge-01 uplink", "sfp28-1;lag-fw;bridge|fw-01|edge-01 sfp28-1"].join("\n");

const fake = new FakeSshDevice("operator+ct300w", (command) => {
    if (command.startsWith(':foreach n in=[/ip neighbor find where discovered-by~"lldp"]')) return NEIGHBORS + "\n";
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
    const running = platform.render(withVlan(3990)).replace("name=test-vlan01 vlan-id=3990", "name=test-vlan01 vlan-id=\\\n    3990");

    const plan = platform.plan(platform.render(withVlan(3991)), running, options);
    const sent = plan.steps.flatMap((step) => step.send);

    expect(plan.problems).toEqual([]);
    expect(sent).toEqual([
        "/interface vlan set [ find interface=bridge and vlan-id=3990 ] vlan-id=3991",
        "/interface bridge vlan add bridge=bridge tagged=bridge vlan-ids=3991",
        "/interface bridge vlan remove [ find vlan-ids=3990 and !dynamic ]",
    ]);
});

test("LLDP neighbors: our port by Circuit's name, and the far port by the description it reports", async () => {
    const firewall: Device = { ...edge, name: "fw-01", ports: { "25g-3": { description: "edge-01 sfp28-1" } } };

    expect(await platform.neighbors!(device, [device, firewall])).toEqual([
        { port: "100g-1", system: "Vendor", remote_port: "edge-01 uplink" },
        { port: "25g-1", system: "fw-01", remote_port: "25g-3" },
    ]);
});

/** The edge router with a multihop session to a controller, with BFD, and BFD timers when given. */
function withMultihopBfd(bfd?: { interval: number; multiplier: number }, sessionBfd = true): Device {
    const routing = edge.routing!;
    const controller = { address: "198.51.100.7", remote_as: 64512, multihop: true, bfd: sessionBfd || undefined } as const;

    return {
        ...edge,
        routing: { ...routing, bfd, bgp: { ...routing.bgp!, neighbors: { ...routing.bgp!.neighbors, controller } } },
    };
}

test("BFD timers and a multihop session: the configuration names the session's address, and its timers read back as the router printed them", () => {
    const desired = platform.render(withMultihopBfd({ interval: 300, multiplier: 3 }));

    // As the router printed it. Without a configuration naming the address, its BFD session was `BFD forbidden for destination address`.
    expect(desired).toContain("/routing bfd configuration\nadd addresses=198.51.100.7/32 min-rx=300ms min-tx=300ms multiplier=3\n");
    expect(desired).not.toContain("interfaces=all");

    const timersOnly: Device = { ...edge, routing: { ...edge.routing!, bfd: { interval: 300, multiplier: 3 } } };
    expect(platform.render(timersOnly)).toContain(
        "/routing bfd configuration\nadd interfaces=all min-rx=300ms min-tx=300ms multiplier=3\n"
    );
});

test("timers the config no longer states are set back to the router's own, which it then prints", () => {
    const running = platform.render(withMultihopBfd({ interval: 300, multiplier: 3 }));
    const plan = platform.plan(platform.render(withMultihopBfd()), running, options);

    expect(plan.problems).toEqual([]);
    expect(plan.steps.flatMap((step) => step.send)).toEqual([
        '/routing bfd configuration set [ find addresses="198.51.100.7/32" ] min-rx=200ms min-tx=200ms multiplier=5',
    ]);

    const printed = running.replace("min-rx=300ms min-tx=300ms multiplier=3", "min-rx=200ms min-tx=200ms multiplier=5");
    expect(platform.plan(platform.render(withMultihopBfd()), printed, options).steps).toEqual([]);
});

test("BFD taken off a session sets use-bfd=no, which the router then prints", () => {
    const running = platform.render(withMultihopBfd());
    const sent = platform.plan(platform.render(withMultihopBfd(undefined, false)), running, options).steps.flatMap((step) => step.send);

    expect(sent).toEqual([
        '/routing bgp connection set [ find remote.address="198.51.100.7/32" ] use-bfd=no',
        '/routing bfd configuration remove [ find addresses="198.51.100.7/32" ]',
    ]);

    const desired = platform.render(withMultihopBfd(undefined, false));
    const printed = desired.replace("remote.as=64512", "remote.as=64512 use-bfd=no");
    expect(printed).toContain("use-bfd=no");
    expect(platform.plan(desired, printed, options).steps).toEqual([]);
});

test("BFD timers and multihop BFD are no longer refused; BFD on a static route is, for the reason the router gave", () => {
    const route = { prefix: "192.0.2.0/24", via: "203.0.113.1", bfd: true } as const;
    const device: Device = {
        ...withMultihopBfd({ interval: 300, multiplier: 3 }),
        routing: { ...withMultihopBfd().routing, static: [route] },
    };

    expect(platform.unsupported(device)).toEqual([
        "routing.static 192.0.2.0/24 bfd, a static route's check-gateway takes arp, none or ping on 7.23",
    ]);
});
