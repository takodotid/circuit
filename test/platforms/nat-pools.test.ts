// NAT pools that hand out blocks of ports. FortiOS was tested on a FG-3700D with FortiOS 6.2.2 in multi-VDOM mode, with central NAT off, on documentation addresses. A pool was made, set to the default block sizes, moved, and removed. Its timeout was set to 120, 300, the default 30, and 3 seconds, then removed. Each plan was empty after.

import { expect, test } from "bun:test";
import type { Device, NatRule } from "../../src/model";
import { Platforms } from "../../src/platforms";
import { Fixtures } from "../fixtures";

const fortios = Platforms.get("fortios");
const options = { secrets: false, rollback: 10 };

const POOL = {
    description: "Subscribers out",
    if: { src: "100.64.0.0/22", out_interface: "uplink" },
    then: "snat",
    to_pool: "203.0.113.32/27",
    port_allocation: "dynamic",
    port_set_size: 512,
    port_sets_per_subscriber: 4,
} as const satisfies NatRule;

/** The firewall fixture with these source NAT rules. */
function withSourceNat(fixture: string, source: readonly NatRule[]): Device {
    const device = Fixtures.device(fixture);
    return { ...device, firewall: { ...device.firewall, nat: { ...device.firewall?.nat, source } } };
}

test("FortiOS writes a pool of port blocks, its type first, and a central SNAT entry that uses it, as the device printed them", () => {
    const device = withSourceNat("platforms--example-firewall", [POOL]);
    const desired = fortios.render(device);

    expect(fortios.unsupported(device)).toEqual([]);
    expect(desired).toContain(`config firewall ippool
    edit "203.0.113.32/27"
        set type port-block-allocation
        set startip 203.0.113.32
        set endip 203.0.113.63
        set block-size 512
        set num-blocks-per-user 4
    next
end`);
    expect(desired).toContain(`    edit 1
        set orig-addr "100.64.0.0/22"
        set srcintf "any"
        set dst-addr "all"
        set dstintf "uplink"
        set nat-ippool "203.0.113.32/27"
        set comments "Subscribers out"
    next`);
    expect(fortios.plan(desired, desired, options)).toEqual({ steps: [], problems: [] });
});

test("block sizes at the device's defaults, 128 ports and 8 blocks, which it does not print, plan nothing", () => {
    const desired = fortios.render(
        withSourceNat("platforms--example-firewall", [{ ...POOL, port_set_size: 128, port_sets_per_subscriber: 8 }])
    );
    const printed = desired.replace("        set block-size 128\n        set num-blocks-per-user 8\n", "");

    expect(printed).not.toEqual(desired);
    expect(fortios.plan(desired, printed, options)).toEqual({ steps: [], problems: [] });
});

test("FortiOS writes a pool's timeout as pba-timeout, and nothing for 30 seconds, its default, which the device doesn't print", () => {
    const pool = (port_set_timeout?: number) =>
        fortios.render(withSourceNat("platforms--example-firewall", [{ ...POOL, port_set_timeout }]));
    const longer = pool(120);

    expect(longer).toContain("        set num-blocks-per-user 4\n        set pba-timeout 120\n    next");
    expect(pool(30)).toEqual(pool());
    expect(fortios.plan(longer, longer, options)).toEqual({ steps: [], problems: [] });

    const back = fortios.plan(pool(30), longer, options).steps;
    expect(back.map((step) => step.send)).toEqual([
        ["config firewall ippool", 'edit "203.0.113.32/27"', "unset pba-timeout", "next", "end"],
    ]);
});

test("a pool that moves is made first, the entry points to it, and the old pool goes last", () => {
    const current = fortios.render(withSourceNat("platforms--example-firewall", [POOL]));
    const desired = fortios.render(withSourceNat("platforms--example-firewall", [{ ...POOL, to_pool: "203.0.113.64/27" }]));
    const steps = fortios.plan(desired, current, options).steps;

    expect(steps.map((step) => step.title)).toEqual(["firewall ippool", "firewall central-snat-map", "firewall ippool, removed"]);
    expect(steps.at(-1)?.send).toEqual(["config firewall ippool", 'delete "203.0.113.32/27"', "end"]);
});

// On a FG-3700D with 6.2.2, a fixed port range pool took no `startport` or `port-per-user`, and shared ports 5117 to 65532 alike.
test("FortiOS refuses a deterministic pool, block sizes it doesn't take, and a source port with a pool", () => {
    const device = withSourceNat("platforms--example-firewall", [
        { ...POOL, port_allocation: "deterministic", port_set_size: 2016, port_sets_per_subscriber: undefined },
        { ...POOL, to_pool: "203.0.113.64/27", port_set_size: 32, port_sets_per_subscriber: 129 },
        { ...POOL, to_pool: "203.0.113.96/27", if: { ...POOL.if, protocol: "udp", src_port: 53 } },
        { ...POOL, to_pool: "203.0.113.128/27", port_set_timeout: 2 },
        { ...POOL, to_pool: "203.0.113.160/27", port_set_timeout: 301 },
    ]);

    expect(fortios.unsupported(device).filter((gap) => gap.startsWith("firewall.nat"))).toEqual([
        "firewall.nat.source[0].port_allocation deterministic: FortiOS 6.2 shares ports 5117 to 65532 alike among the subscribers of a pool address, not port_set_size each from 1024, and may give a port past a share. Write dynamic, whose blocks the device logs",
        "firewall.nat.source[1].port_set_size 32, the platform takes 64 to 4096 ports in a block",
        "firewall.nat.source[1].port_sets_per_subscriber 129, the platform takes 1 to 128 blocks",
        "firewall.nat.source[2].if.src_port, with a pool, which translates every source port",
        "firewall.nat.source[3].port_set_timeout 2, the platform takes 3 to 300 seconds",
        "firewall.nat.source[4].port_set_timeout 301, the platform takes 3 to 300 seconds",
    ]);
});

test("RouterOS refuses a dynamic pool, and its timeout", () => {
    const router = Fixtures.device("platforms--example-router");
    const rule = { ...POOL, if: { src: "100.64.0.0/22" }, port_set_timeout: 120 } as const;
    const device: Device = { ...router, firewall: { ...router.firewall, nat: { source: [rule] } } };
    const refused = Platforms.get("routeros").unsupported(device);

    expect(refused).toContain(
        "firewall.nat.source[0].port_allocation dynamic, RouterOS has no port block allocation (TRAPS.md): write deterministic"
    );
    expect(refused).toContain("firewall.nat.source[0].port_set_timeout, RouterOS has no port block allocation (TRAPS.md)");
});

test("FortiOS warns when no syslog collector keeps a dynamic pool's log of its blocks, written at notice", () => {
    const device = withSourceNat("platforms--example-firewall", [POOL]);
    const warning = (syslog: NonNullable<Device["monitoring"]>["syslog"]) =>
        fortios.checks!({ ...device, monitoring: { ...device.monitoring, syslog } }).filter((finding) => finding.level === "warning");

    expect(warning(device.monitoring?.syslog)).toEqual([]);
    expect(warning([{ address: "192.0.2.99", level: "warning" }])).toEqual([
        {
            level: "warning",
            device: device.name,
            message:
                'firewall.nat.source, to_pool 203.0.113.32/27: the device logs each block of ports it gives and takes back at notice, and only that log finds the subscriber behind a pool address and port. No collector in monitoring.syslog takes notice: write one with level "notice" or "info".',
        },
    ]);
});
