// A relay that adds Option 82 (RFC 3046), and a DHCP server for a relay's clients. RouterOS's is proven in test/platforms/routeros-chr-dhcp-relay.test.ts.

import { expect, test } from "bun:test";
import { Checks } from "../../src/checks";
import type { Device, DhcpServer, IPv4 } from "../../src/model";
import { Platforms } from "../../src/platforms";
import { Fixtures } from "../fixtures";

const options = { secrets: false, rollback: 10 };

/** A server on `servers` for the clients behind a relay whose address is 198.51.100.129. */
const RELAYED: DhcpServer = {
    interface: "servers",
    relay: "198.51.100.129",
    network: "198.51.100.128/26",
    gateway: "198.51.100.129",
    pool: ["198.51.100.140", "198.51.100.160"],
};

/** A fixture whose `guests` relay adds Option 82, with a server for a relay's clients on `serverOn`, if given. */
function relaying(name: string, serverOn?: string): Device {
    const device = structuredClone(Fixtures.device(name));
    const relays = device.services?.dhcp_relay ?? {};
    device.services = {
        ...device.services,
        dhcp_relay: { ...relays, guests: { ...relays.guests!, relay_agent_information: true } },
        ...(serverOn ? { dhcp_server: { relayed: { ...RELAYED, interface: serverOn } } } : {}),
    };
    return device;
}

/** What a platform refuses about DHCP. */
const refusedDhcp = (platform: string, device: Device) =>
    Platforms.get(platform)
        .unsupported(device)
        .filter((reason) => reason.startsWith("services.dhcp_"));

const errors = (device: Device) =>
    Checks.run([device], undefined)
        .filter((finding) => finding.level === "error" && finding.message.startsWith("services.dhcp_"))
        .map((finding) => finding.message);

test("RouterOS writes the server's relay and the relay's Option 82, and sets both back once they are gone", () => {
    const routeros = Platforms.get("routeros");
    const device = relaying("platforms--example-router", "servers");
    const desired = routeros.render(device);

    expect(desired).toContain("add address-pool=relayed interface=servers name=relayed relay=198.51.100.129");
    expect(desired).toContain("add add-relay-info=yes dhcp-server=198.51.100.66 disabled=no interface=guests name=guests");
    expect(refusedDhcp("routeros", device)).toEqual([]);

    const plain = structuredClone(device);
    delete plain.services!.dhcp_relay!.guests!.relay_agent_information;
    delete plain.services!.dhcp_server!.relayed!.relay;
    const sent = routeros.plan(routeros.render(plain), desired, options).steps.flatMap((step) => step.send);
    expect(sent).toContain("/ip dhcp-relay set [ find name=guests ] add-relay-info=no");
    expect(sent).toContain("/ip dhcp-server set [ find name=relayed ] relay=0.0.0.0");
});

// A QFX5100 on 21.4R3-S8.5 took a pool for a relay's clients beside one for the interface's own in `commit check`, in one group on the interface. A second group there failed it with `Interface irb.3541 already configured.` Nothing was committed.
test("Junos adds Option 82 to the relay's group, and serves a relay's clients in the interface's one group, experimentally", () => {
    const junos = Platforms.get("junos");
    const device = relaying("platforms--example-aggregation-switch", "management");
    const own = Fixtures.device("platforms--example-aggregation-switch").services!.dhcp_server!.management!;
    device.services!.dhcp_server = { management: own, relayed: device.services!.dhcp_server!.relayed! };
    const desired = junos.render(device);

    expect(desired).toContain("set routing-instances guests forwarding-options dhcp-relay group guests relay-option-82 circuit-id");
    expect(desired).toContain("set system services dhcp-local-server group management interface irb.10");
    expect(desired).not.toContain("dhcp-local-server group relayed");
    expect(desired).toContain("set access address-assignment pool relayed family inet network 198.51.100.128/26");
    expect(junos.experimental!(device)).toEqual(
        expect.arrayContaining(["services.dhcp_relay.guests.relay_agent_information", "services.dhcp_server.relayed.relay"])
    );
    expect(refusedDhcp("junos", device)).toEqual([]);
});

test("Junos refuses a relay outside the network it serves, as the switch picks the pool by the relay's address", () => {
    const device = relaying("platforms--example-aggregation-switch", "management");
    device.services!.dhcp_server!.relayed = { ...RELAYED, interface: "management", relay: "192.0.2.1" };

    expect(refusedDhcp("junos", device)).toEqual([
        "services.dhcp_server.relayed.relay 192.0.2.1, outside network 198.51.100.128/26: Junos picks the pool whose network holds the relay's address, so write the network the relay is in",
    ]);
});

// On a FG-3700D with 6.2.2, a client in one test VDOM got a lease through a relay in a second, from a server in a third. A server for another network didn't answer it. A client asking on the server's interface itself got nothing from it.
test("FortiOS leaves Option 82 on only when asked, as experimental, and serves a relay's clients in the relay's network", () => {
    const fortios = Platforms.get("fortios");
    const device = relaying("platforms--example-firewall", "servers");

    expect(fortios.render(device)).not.toContain("dhcp-relay-agent-option");
    expect(fortios.render(Fixtures.device("platforms--example-firewall"))).toContain("set dhcp-relay-agent-option disable");
    expect(fortios.experimental!(device)).toContain("services.dhcp_relay.guests.relay_agent_information");
    expect(refusedDhcp("fortios", device)).toEqual([]);
    expect(fortios.render(device)).toMatch(
        /config system dhcp server\n {4}edit 1\n {8}set default-gateway 198\.51\.100\.129\n {8}set netmask 255\.255\.255\.192\n {8}set interface "servers"\n/
    );

    device.services!.dhcp_server!.relayed = { ...RELAYED, interface: "servers", relay: "192.0.2.1" };
    expect(refusedDhcp("fortios", device)).toEqual([
        "services.dhcp_server.relayed.relay 192.0.2.1, outside network 198.51.100.128/26: FortiOS answers a relay from the server whose network holds its address, so write the network the relay is in",
    ]);
});

// On a FG-3700D with 6.2.2, a server whose range another server held was refused at `next`: `object set operator error, -526 discard the setting`.
test("FortiOS knows a DHCP server by its network, and deletes one that goes before it creates or changes any", () => {
    const fortios = Platforms.get("fortios");
    const relayed = relaying("platforms--example-firewall", "servers");
    const both = structuredClone(relayed);
    both.services!.dhcp_server = {
        ...Fixtures.device("platforms--example-firewall").services!.dhcp_server,
        ...relayed.services!.dhcp_server,
    };
    // What the plan sends first in the servers' table.
    const opening = (device: Device, current: string) => {
        const sent = fortios.plan(fortios.render(device), current, options).steps.flatMap((step) => step.send);
        const table = sent.indexOf("config system dhcp server");
        return sent.slice(table + 1, table + 3);
    };

    // The relay's server, first on the device, keeps its number when another comes before it.
    expect(opening(both, fortios.render(relayed))).toEqual(["edit 2", "set lease-time 3600"]);

    const moved = structuredClone(relayed);
    moved.services!.dhcp_server!.relayed = { ...RELAYED, interface: "servers", gateway: "198.51.100.130" };
    expect(opening(moved, fortios.render(relayed))).toEqual(["delete 1", "edit 2"]);
});

test("FortiOS converges a relay with and without Option 82, and unsets the option and the servers before the relay", () => {
    const fortios = Platforms.get("fortios");
    const plain = Fixtures.device("platforms--example-firewall");
    const none = structuredClone(plain);
    delete none.services!.dhcp_relay!.guests;
    const sent = (device: Device, current: string) =>
        fortios.plan(fortios.render(device), current, options).steps.flatMap((step) => step.send);

    // A FG-3700D on FortiOS 6.2.2 prints the option only once it is `disable`.
    const withoutOption = fortios.render(plain);
    const withOption = withoutOption.replace(/^ *set dhcp-relay-agent-option disable\n/m, "");

    expect(sent(relaying("platforms--example-firewall"), withOption)).toEqual([]);
    expect(sent(relaying("platforms--example-firewall"), withoutOption)).toContain("unset dhcp-relay-agent-option");
    expect(sent(plain, withOption)).toContain("set dhcp-relay-agent-option disable");
    // With the relay off, the device hides its servers and the option but keeps them, and unsetting either is a parse error.
    expect(sent(none, withoutOption).filter((line) => line.startsWith("unset dhcp-relay"))).toEqual([
        "unset dhcp-relay-agent-option",
        "unset dhcp-relay-ip",
        "unset dhcp-relay-service",
    ]);
});

test("FortiOS refuses two relays on one interface when only one adds Option 82", () => {
    const fortios = Platforms.get("fortios");
    const device = relaying("platforms--example-firewall");
    device.services!.dhcp_relay!.more = { interface: "guests", servers: ["198.51.100.67"] };

    expect(fortios.unsupported(device)).toContain(
        "services.dhcp_relay.guests.relay_agent_information, FortiOS has one relay on guests, and services.dhcp_relay.more adds no Option 82: write it on both or neither"
    );
});

test("FortiOS refuses a relay on a loopback, which takes none", () => {
    const fortios = Platforms.get("fortios");
    const device = relaying("platforms--example-firewall");
    device.interfaces = { ...device.interfaces, loopback: { ...device.interfaces?.loopback, "relay-lo": { addresses: ["192.0.2.1/32"] } } };
    device.services!.dhcp_relay!.more = { interface: "relay-lo", servers: ["198.51.100.67"] };

    expect(fortios.unsupported(device)).toContain(
        "services.dhcp_relay.more.interface relay-lo, a loopback, which takes no DHCP relay on FortiOS: write the interface the clients are on"
    );
});

test("VRP serves a relay's clients from a pool for their network, as experimental, and refuses Option 82", () => {
    const vrp = Platforms.get("vrp");
    const device = relaying("platforms--example-switch", "guests");

    expect(refusedDhcp("vrp", device)).toEqual([
        "services.dhcp_relay.guests.relay_agent_information, V200R005 adds no Option 82 where it relays",
    ]);
    expect(vrp.experimental!(device)).toContain("services.dhcp_server.relayed");
    // The switch picks a pool by the relay's address, as it picks one for its own clients by the interface's: nothing names the relay.
    expect(vrp.render(device)).toContain(
        "ip pool relayed\n vpn-instance guests\n gateway-list 198.51.100.129\n network 198.51.100.128 mask 255.255.255.192\n"
    );

    device.services!.dhcp_server!.relayed!.relay = "198.51.100.1";
    expect(refusedDhcp("vrp", device)).toContain(
        "services.dhcp_server.relayed.relay, outside 198.51.100.128/26: the switch picks a pool by the relay's address"
    );
});

test("validate wants an IPv4 relay address, and an IPv4 server for Option 82", () => {
    const device = relaying("platforms--example-router", "servers");
    device.services!.dhcp_server!.relayed!.relay = "2001:db8::1" as unknown as IPv4;
    device.services!.dhcp_relay!.guests!.servers = ["2001:db8::67"];

    expect(errors(device)).toEqual([
        "services.dhcp_server.relayed.relay 2001:db8::1 is IPv6, and a relay's address in a DHCP request (giaddr) is IPv4: write the relay's IPv4 address",
        "services.dhcp_relay.guests.relay_agent_information: Option 82 goes only to IPv4 servers, and servers lists none. Remove it, or add an IPv4 server",
    ]);
});
