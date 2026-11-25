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

test("Junos adds Option 82 to the relay's group, as experimental, and refuses a server for a relay's clients", () => {
    const junos = Platforms.get("junos");
    const device = relaying("platforms--example-aggregation-switch", "management");

    expect(junos.render(device)).toContain(
        "set routing-instances guests forwarding-options dhcp-relay group guests relay-option-82 circuit-id"
    );
    expect(junos.experimental!(device)).toContain("services.dhcp_relay.guests.relay_agent_information");
    expect(refusedDhcp("junos", device)).toEqual([
        "services.dhcp_server.relayed.relay, not built for Junos: its server picks the pool whose network holds the relay's address, untried",
    ]);
});

test("FortiOS leaves Option 82 on only when asked, as experimental, and refuses a server for a relay's clients", () => {
    const fortios = Platforms.get("fortios");
    const device = relaying("platforms--example-firewall", "servers");

    expect(fortios.render(device)).not.toContain("dhcp-relay-agent-option");
    expect(fortios.render(Fixtures.device("platforms--example-firewall"))).toContain("set dhcp-relay-agent-option disable");
    expect(fortios.experimental!(device)).toContain("services.dhcp_relay.guests.relay_agent_information");
    expect(refusedDhcp("fortios", device)).toEqual([
        "services.dhcp_server.relayed.relay, FortiOS 6.2 has no setting for a relay's clients: relay-agent comes in 7.4",
    ]);
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

test("VRP refuses both", () => {
    expect(refusedDhcp("vrp", relaying("platforms--example-switch", "guests"))).toEqual([
        "services.dhcp_relay.guests.relay_agent_information, Option 82, not built for VRP",
        "services.dhcp_server.relayed.relay, a server for a relay's clients, not built for VRP",
    ]);
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
