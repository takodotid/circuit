// What `circuit bgp` and the check after an apply read on VRP. A CE6855 on V200R005C00SPC800 printed `NOT_UP`'s lists. Its sessions never came up: it has no peer, and refused a route from its main table to a VRF of its own. An established session's line is in the same columns, as Huawei's reference shows them.

import { expect, test } from "bun:test";
import type { Device } from "../../src/model";
import type { ReadSession } from "../../src/platforms/platform";
import { Vrp } from "../../src/platforms/vrp/index";
import { Fixtures } from "../fixtures";

const base = Fixtures.device("single-site--switch");

/** The switch with a session in each list: IPv4 and IPv6 in the main table, and IPv4 in VRF `ctest`. */
const device: Device = {
    ...base,
    switching: { ...base.switching, vlans: { ...base.switching!.vlans, "ctest-a": { id: 3981 } } },
    interfaces: {
        ...base.interfaces,
        vlan_interface: {
            ...base.interfaces!.vlan_interface,
            "ctest-a": { vlan: "ctest-a", addresses: ["192.0.2.1/28", "2001:db8:3981::1/64"] },
        },
        loopback: { "ctest-lo": { addresses: ["192.0.2.250/32"] }, "ctest-lo2": { vrf: "ctest", addresses: ["192.0.2.251/32"] } },
    },
    routing: {
        ...base.routing,
        vrfs: { ctest: {} },
        router_id: "192.0.2.250",
        bgp: {
            asn: 64500,
            neighbors: {
                "ctest-self": { address: "192.0.2.251", remote_as: 64500, local_address: "192.0.2.250" },
                "ctest-self-vrf": { address: "192.0.2.250", remote_as: 64500, local_address: "192.0.2.251", vrf: "ctest" },
                "ctest-down": { address: "192.0.2.2", remote_as: 64496 },
                "ctest-v6": { address: "2001:db8:3981::2", remote_as: 64496 },
                missing: { address: "192.0.2.3", remote_as: 64496 },
            },
        },
    },
};

const header = [
    " BGP local router ID        : 192.0.2.250",
    " Local AS number            : 64500",
    " Total number of peers      : 2                ",
    " Peers in established state : 0",
    "",
    "  Peer            V          AS  MsgRcvd  MsgSent  OutQ  Up/Down       State  PrefRcv",
];

/** What the CE6855 printed. */
const NOT_UP: Record<string, string> = {
    "display bgp peer": [
        ...header,
        "  192.0.2.2       4       64496        0        0     0 00:01:00        Idle        0",
        "  192.0.2.251     4       64500        0        0     0 00:01:00     Connect        0",
    ].join("\r\n"),
    "display bgp ipv6 peer": [...header, "  2001:DB8:3981::2 4       64496        0        0     0 00:01:03        Idle        0"].join(
        "\r\n"
    ),
    "display bgp vpnv4 vpn-instance ctest peer": [
        " BGP local router ID : 192.0.2.250",
        " Local AS number : 64500",
        "",
        " VPN-Instance ctest, Router ID 192.0.2.251:",
        " Total number of peers      : 1                 ",
        " Peers in established state : 0",
        "",
        "  Peer            V          AS  MsgRcvd  MsgSent  OutQ  Up/Down       State  PrefRcv",
        "  192.0.2.250     4       64500        0        0     0 00:01:06      Active        0",
    ].join("\r\n"),
};

/** The same, with the session in the main table up. */
const UP = {
    ...NOT_UP,
    "display bgp peer": NOT_UP["display bgp peer"]!.replace(
        "192.0.2.251     4       64500        0        0     0 00:01:00     Connect        0",
        "192.0.2.251     4       64500       12       14     0 00:05:10 Established        3"
    ),
};

/** A login that answers each list as `answers` has it, and counts what it was asked. */
function answering(answers: Record<string, string>): ReadSession & { asked: string[] } {
    const asked: string[] = [];
    return {
        asked,
        run: async (command) => {
            asked.push(command);
            return answers[command] ?? "";
        },
        close: () => {},
    };
}

test("VRP reads each neighbor's session from the list of its family or its VRF, once each", async () => {
    const session = answering(NOT_UP);
    const sessions = await new Vrp().bgpSessions(device, session);

    expect(sessions).toEqual([
        { neighbor: "ctest-self", remote: "192.0.2.251", established: false, prefixes: "-", uptime: "-", reason: "Connect" },
        { neighbor: "ctest-self-vrf", remote: "192.0.2.250", established: false, prefixes: "-", uptime: "-", reason: "Active" },
        { neighbor: "ctest-down", remote: "192.0.2.2", established: false, prefixes: "-", uptime: "-", reason: "Idle" },
        { neighbor: "ctest-v6", remote: "2001:DB8:3981::2", established: false, prefixes: "-", uptime: "-", reason: "Idle" },
        { neighbor: "missing", remote: "-", established: false, prefixes: "-", uptime: "no session" },
    ]);
    expect(session.asked).toEqual(["display bgp peer", "display bgp vpnv4 vpn-instance ctest peer", "display bgp ipv6 peer"]);
});

test("VRP shows an established session's prefixes and uptime, and nothing without BGP", async () => {
    const sessions = await new Vrp().bgpSessions(device, answering(UP));
    expect(sessions[0]).toEqual({ neighbor: "ctest-self", remote: "192.0.2.251", established: true, prefixes: "3", uptime: "00:05:10" });

    // A switch without BGP prints nothing for each list.
    const none = await new Vrp().bgpSessions(device, answering({}));
    expect(none.every((session) => session.uptime === "no session")).toBe(true);
});

test("VRP's check after an apply waits for each session established before, and names one that is not back", async () => {
    let answers: Record<string, string> = UP;
    const vrp = new (class extends Vrp {
        override session(): Promise<ReadSession> {
            return Promise.resolve(answering(answers));
        }
    })();

    const check = await vrp.health(device, { steps: [], problems: [] }, { bgp: { seconds: 0.2, every: 0.05 } });
    expect(await check.run()).toEqual([]);

    answers = NOT_UP;
    expect(await check.run()).toEqual([
        "BGP session ctest-self was established before the apply and is not 0.2 s after it (Connect). Look with: circuit bgp switch",
    ]);
});
