// TCP MSS clamps. RouterOS's are in test/platforms/routeros-plan.test.ts.

import { expect, test } from "bun:test";
import type { Device, TcpMssRule } from "../../src/model";
import { Platforms } from "../../src/platforms";
import { Fixtures } from "../fixtures";

const options = { secrets: false, rollback: 10 };

/** The example firewall with these clamps. */
function clamping(...rules: TcpMssRule[]): Device {
    const device = structuredClone(Fixtures.device("platforms--example-firewall"));
    device.firewall = { ...device.firewall, tcp_mss: rules };
    return device;
}

const refused = (device: Device) =>
    Platforms.get("fortios")
        .unsupported(device)
        .filter((gap) => gap.startsWith("firewall.tcp_mss"));

// On a FG-3700D with 6.2.2, `tcp-mss` 1200 was on the interface where a SYN arrived, and 1300 on the one it left by. The SYN left with 1200, and the SYN-ACK with 1300, IPv4 and IPv6. 1480 left a SYN of 1460 as it was.
test("FortiOS clamps on the interface a SYN arrives on, and unsets the clamp once it is gone", () => {
    const fortios = Platforms.get("fortios");
    const device = clamping(
        { description: "guests", if: { in_interface: "guests" }, mss: 1360 },
        { if: { in_interface: "uplink" }, mss: 1400 }
    );

    const desired = fortios.render(device);
    expect(refused(device)).toEqual([]);
    expect(desired).toMatch(/edit "guests"\n(?:(?! {4}next)[^\n]*\n)*? {8}set tcp-mss 1360\n/);
    expect(desired).toMatch(/edit "uplink"\n(?:(?! {4}next)[^\n]*\n)*? {8}set tcp-mss 1400\n/);
    expect(fortios.plan(desired, desired, options).steps).toEqual([]);

    const sent = fortios.plan(fortios.render(clamping()), desired, options).steps.flatMap((step) => step.send);
    expect(sent).toContain("unset tcp-mss");
});

test("FortiOS refuses a clamp to the path MTU, one that matches more than the interface, and one on a loopback", () => {
    const device = clamping(
        { if: { in_interface: "guests" }, mss: "path_mtu" },
        { if: { out_interface: "uplink" }, mss: 1400 },
        { if: { in_interface: "servers", src: "198.51.100.32/27" }, mss: 1400 },
        { if: { in_interface: "loopback" }, mss: 1400 },
        { if: { in_interface: "servers" }, mss: 1300 },
        { if: { in_interface: "servers" }, mss: 1200 }
    );

    expect(refused(device)).toEqual([
        "firewall.tcp_mss[0].mss path_mtu, FortiOS 6.2 clamps to a number of bytes: write it",
        "firewall.tcp_mss[1].if, FortiOS clamps every SYN that arrives on an interface, of both families: write if.in_interface alone",
        "firewall.tcp_mss[2].if, FortiOS clamps every SYN that arrives on an interface, of both families: write if.in_interface alone",
        "firewall.tcp_mss[3].if.in_interface loopback, which is not a port, LAG, or VLAN interface: FortiOS clamps on those",
        "firewall.tcp_mss[5].mss 1200, unlike 1300 before it on servers: FortiOS clamps on an interface to one MSS",
    ]);
});
