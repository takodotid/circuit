// BGP confederations (RFC 5065), tested on a QFX5100 with Junos 21.4R3 and a FortiGate 3700D with FortiOS 6.2.2. RouterOS is refused after tests on a CCR2216 and on three CHRs with 7.24.6 (TRAPS.md). Each device held a neighbor in another member AS and an external one. The lines it printed are fed to the adapters, with names and addresses replaced.

import { expect, test } from "bun:test";
import type { Device, Neighbor } from "../../src/model";
import { Platforms } from "../../src/platforms";
import { Fixtures } from "../fixtures";

const options = { secrets: false, rollback: 10 };

/** A fixture's device in member AS 65001, with a neighbor in member AS 65002 and one outside, and in confederation 64500 when its other members are given. */
function member(fixture: string, others?: number[]): Device {
    const device = Fixtures.device(fixture);
    const neighbors: Record<string, Neighbor> = {
        "core-02": { address: "192.0.2.2", remote_as: 65002 },
        "hurricane-electric": { address: "192.0.2.6", remote_as: 6939 },
    };
    const confederation = others ? { confederation: { identifier: 64500, member_as: others } } : {};
    return { ...device, routing: { ...device.routing, bgp: { asn: 65001, ...confederation, neighbors } } };
}

const sent = (platform: string, desired: string, current: string) =>
    Platforms.get(platform)
        .plan(desired, current, options)
        .steps.flatMap((step) => step.send);

test("RouterOS refuses a confederation", () => {
    expect(Platforms.get("routeros").unsupported(member("edge-router--edge-01", [65002]))).toContain(
        "routing.bgp.confederation, RouterOS 7.24 shows the identifier, not the member AS, to neighbors inside the confederation, which RFC 5065 forbids"
    );
});

test("Junos lists every member AS, its own too, as the device prints them, and changes or removes them as it takes them", () => {
    const junos = Platforms.get("junos");
    const confederation = (text: string) => text.split("\n").filter((line) => line.includes("confederation"));
    const desired = junos.render(member("platforms--example-aggregation-switch", [65002, 65003]));

    expect(confederation(desired)).toEqual([
        "set routing-options confederation 64500",
        "set routing-options confederation members 65001",
        "set routing-options confederation members 65002",
        "set routing-options confederation members 65003",
    ]);

    const changed = desired.replace("confederation 64500", "confederation 64496").replace(/^.*members 65003\n/m, "");
    expect(confederation(sent("junos", changed, desired).join("\n"))).toEqual([
        "delete routing-options confederation 64500",
        "delete routing-options confederation members 65003",
        "set routing-options confederation 64496",
    ]);

    const without = junos.render(member("platforms--example-aggregation-switch"));
    expect(sent("junos", without, desired)).toEqual(["delete routing-options confederation"]);
});

test("FortiOS writes the identifier and the other member ASes, plans nothing against how the device prints them, and unsets them", () => {
    const fortios = Platforms.get("fortios");
    const bgp = /^config router bgp\n[\s\S]*?^end\n/m;
    const desired = fortios.render(member("platforms--example-firewall", [65002, 65003])).match(bgp)![0];

    const printed = `config router bgp
    set as 65001
    set router-id 198.51.100.255
    set confederation-identifier 64500
    set confederation-peers "65002" "65003"
    config neighbor
        edit "192.0.2.2"
            set activate6 disable
            set remote-as 65002
            set route-map-in "circuit-reject-all"
            set route-map-out "circuit-reject-all"
        next
        edit "192.0.2.6"
            set activate6 disable
            set remote-as 6939
            set route-map-in "circuit-reject-all"
            set route-map-out "circuit-reject-all"
        next
    end
end
`;
    expect(sent("fortios", desired, printed)).toEqual([]);

    const without = fortios.render(member("platforms--example-firewall")).match(bgp)![0];
    expect(sent("fortios", without, printed)).toEqual([
        "config router bgp",
        "unset confederation-peers",
        "unset confederation-identifier",
        "end",
    ]);
});
