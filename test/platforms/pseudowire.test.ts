// Ethernet pseudowires, a VPWS between two PEs and a VPLS among three. RouterOS 7.24.6 ran both on three CHRs (test/platforms/routeros-chr-pseudowire.test.ts), and the lines it printed there are fed to the adapter here. Every other platform refuses them.

import { beforeAll, expect, test } from "bun:test";
import { Checks } from "../../src/checks";
import { DeviceChecks } from "../../src/checks/device";
import type { Device, Pseudowire } from "../../src/model";
import { Platforms } from "../../src/platforms";
import { Fixtures } from "../fixtures";

const options = { secrets: false, rollback: 10 };
const routeros = Platforms.get("routeros");

/** The two PEs of the MPLS core example, with the clinic's pseudowire between them. */
let pe01: Device;
let pe02: Device;

beforeAll(async () => {
    const devices = await Fixtures.example("mpls-core");
    pe01 = devices["pe-01"]!;
    pe02 = devices["pe-02"]!;
});

/** A device with these pseudowires instead of its own. */
const withPseudowires = (device: Device, pseudowire: Record<string, Pseudowire>): Device => ({
    ...device,
    interfaces: { ...device.interfaces, pseudowire },
});

const errors = (device: Device) =>
    DeviceChecks.run(device)
        .filter((finding) => finding.level === "error")
        .map((finding) => finding.message);

const sent = (desired: string, current: string) => routeros.plan(desired, current, options).steps.flatMap((step) => step.send);

test("RouterOS makes a pseudowire a VPLS interface with its PW ID, a port of its VLAN in a split horizon of its own", () => {
    const desired = routeros.render(pe01);

    expect(desired).toContain(
        '/interface vpls\nadd cisco-static-id=201 comment="Clinic, to site 2 at pe-02" disabled=no name=pw-clinic peer=10.255.0.2\n'
    );
    expect(desired).toContain(
        "add bridge=bridge frame-types=admit-only-untagged-and-priority-tagged horizon=2 interface=pw-clinic pvid=201\n"
    );

    // As the CHRs printed them: the MAC each VPLS interface made up for itself, which the plan leaves alone.
    const printed = desired.replace("disabled=no name=pw-clinic", "disabled=no mac-address=02:90:98:64:A6:F7 name=pw-clinic");
    expect(routeros.plan(desired, printed, options).steps).toEqual([]);
});

test("RouterOS adds the VPLS interface before its bridge port, and removes the bridge port first, which would otherwise name a removed interface", () => {
    const desired = routeros.render(pe01);
    const without = routeros.render(withPseudowires(pe01, {}));

    const adding = sent(desired, without);
    const vpls = adding.findIndex((line) => line.startsWith("/interface vpls add"));
    const port = adding.findIndex((line) => line.startsWith("/interface bridge port add") && line.includes("interface=pw-clinic"));
    expect(vpls).toBeGreaterThan(-1);
    expect(port).toBeGreaterThan(vpls);

    const removing = sent(without, desired);
    expect(removing.indexOf("/interface bridge port remove [ find interface=pw-clinic ]")).toBeLessThan(
        removing.indexOf("/interface vpls remove [ find name=pw-clinic ]")
    );
});

test("RouterOS changes a pseudowire's peer and PW ID in place", () => {
    const desired = routeros.render(pe01);
    const moved = routeros.render(
        withPseudowires(pe01, {
            "pw-clinic": { peer: "10.255.0.3", pw_id: 202, access_vlan: "clinic", description: "Clinic, to site 2 at pe-02" },
        })
    );
    expect(sent(moved, desired)).toEqual(["/interface vpls set [ find name=pw-clinic ] cisco-static-id=202 peer=10.255.0.3"]);
});

test("a pseudowire runs over MPLS to another PE's LSR ID, with a PW ID of its own to that peer, and one back there", () => {
    expect(errors(pe01)).toEqual([]);
    expect(Checks.run([pe01, pe02], undefined).filter((finding) => finding.level === "error")).toEqual([]);

    const twice = withPseudowires(pe01, {
        "pw-a": { peer: "10.255.0.2", pw_id: 0, access_vlan: "clinic" },
        "pw-b": { peer: "10.255.0.1", pw_id: 7, access_vlan: "clinic" },
        "pw-c": { peer: "10.255.0.3", pw_id: 7, access_vlan: "clinic" },
        "pw-d": { peer: "10.255.0.3", pw_id: 7, access_vlan: "clinic" },
    });
    expect(errors(twice)).toEqual([
        "interfaces.pseudowire.pw-a.pw_id 0: write a whole number from 1 to 4294967295, the same at both ends",
        "interfaces.pseudowire.pw-b.peer 10.255.0.1 is this router's own LSR ID. Write the far PE's",
        "interfaces.pseudowire.pw-d has pw_id 7 to 10.255.0.3, as interfaces.pseudowire.pw-c has. Give each pseudowire to one peer its own pw_id",
    ]);

    const withoutMpls: Device = {
        ...pe01,
        routing: { ...pe01.routing, mpls: undefined, bgp: undefined, vrfs: undefined, static_routes: undefined },
    };
    expect(errors(withoutMpls)).toContain(
        "interfaces.pseudowire.pw-clinic needs routing.mpls: LDP sets up the pseudowire, and its frames cross the core by label. Write routing.mpls.ldp"
    );

    const otherId = withPseudowires(pe02, { "pw-clinic": { peer: "10.255.0.1", pw_id: 202, access_vlan: "clinic" } });
    expect(Checks.run([pe01, otherId], undefined).map((finding) => finding.message)).toContain(
        "interfaces.pseudowire.pw-clinic: 10.255.0.2 is pe-02's LSR ID, and pe-02 has no pseudowire to 10.255.0.1 with pw_id 201. Write one there, or fix peer and pw_id here"
    );
});

test("Junos, FortiOS, VRP, and Raisecom ROS refuse a pseudowire, each saying why", () => {
    const reasons: Record<string, string> = {
        junos: "a pseudowire, not built for Junos yet: its MPLS is experimental, untested on a router that runs it",
        fortios: "a pseudowire: FortiOS has no MPLS",
        vrp: "a pseudowire, not built yet",
        "raisecom-ros": "a pseudowire, not built yet",
    };

    for (const [platform, reason] of Object.entries(reasons)) {
        const device = Fixtures.device(Fixtures.ofPlatform(platform)[0]!);
        const vlan = Object.keys(device.switching?.vlans ?? {})[0] ?? "clinic";
        const pseudowire: Pseudowire = { peer: "192.0.2.2", pw_id: 201, access_vlan: vlan };
        expect(Platforms.get(platform).unsupported(withPseudowires(device, { "pw-clinic": pseudowire }))).toContain(
            `interfaces.pseudowire.pw-clinic, ${reason}`
        );
    }
});
