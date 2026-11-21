// NAT64 (RFC 6146) and DNS64 (RFC 6147). FortiOS was tested on a FG-3700D with FortiOS 6.2.2, in a VDOM made for the test, between two loopbacks and on documentation addresses. Rules went to an address and to a pool, to another prefix, and into another order, with DNS64 on and off. Then all of it was removed. Each plan was empty after. No traffic crossed, so FortiOS stays experimental.

import { expect, test } from "bun:test";
import { Checks } from "../../src/checks";
import type { Device, NatRule } from "../../src/model";
import { Platforms } from "../../src/platforms";
import { Fixtures } from "../fixtures";

const fortios = Platforms.get("fortios");
const options = { secrets: false, rollback: 10 };

const TO_ADDRESS = {
    description: "IPv6 hosts to IPv4",
    if: { src: "2001:db8:100::/40", dst: "64:ff9b::/96", in_interface: "servers", out_interface: "uplink" },
    then: "nat64",
    to_address: "203.0.113.65",
} as const satisfies NatRule;

const TO_POOL = {
    description: "Subscribers to IPv4",
    if: { src: "2001:db8:200::/40", dst: "64:ff9b::/96" },
    then: "nat64",
    to_pool: "203.0.113.96/27",
    port_allocation: "dynamic",
    port_set_size: 512,
    port_sets_per_subscriber: 4,
} as const satisfies NatRule;

const DNS64 = { prefix: "64:ff9b::/96" } as const;

/** The firewall fixture with these source NAT rules, no destination NAT, and DNS64 when given. */
function withNat64(source: readonly NatRule[], dns64?: { prefix: `${string}:${string}/${number}` }): Device {
    const device = Fixtures.device("platforms--example-firewall");
    return { ...device, firewall: { ...device.firewall, nat: { source } }, services: { ...device.services, dns64 } };
}

/** The render as `show` printed it on the FG-3700D: the well-known prefix left out, and a UUID in each policy. */
function printed(render: string): string {
    return render
        .replace("    set nat64-prefix 64:ff9b::/96\n", "")
        .replace(/^( {4}edit \d+\n)(?= {8}set srcintf)/gm, "$1        set uuid 30870402-e5f0-51f1-0a86-e7acaf69e16d\n");
}

test("FortiOS turns NAT64 on, with DNS64 as RFC 6147 asks, and writes a NAT64 policy for each rule, as the device printed them", () => {
    const device = withNat64([TO_ADDRESS, TO_POOL], DNS64);
    const desired = fortios.render(device);

    expect(fortios.unsupported(device)).toEqual([]);
    expect(desired).toContain(`config system nat64
    set status enable
    set nat64-prefix 64:ff9b::/96
    set always-synthesize-aaaa-record disable
end`);
    expect(desired).toContain(`config firewall policy64
    edit 1
        set srcintf "servers"
        set dstintf "uplink"
        set srcaddr "2001:db8:100::/40"
        set dstaddr "all"
        set action accept
        set schedule "always"
        set service "ALL"
        set ippool enable
        set poolname "203.0.113.65"
        set comments "IPv6 hosts to IPv4"
    next
    edit 2
        set srcintf "any"
        set dstintf "any"
        set srcaddr "2001:db8:200::/40"
        set dstaddr "all"
        set action accept
        set schedule "always"
        set service "ALL"
        set ippool enable
        set poolname "203.0.113.96/27"
        set comments "Subscribers to IPv4"
    next
end`);
    expect(desired).toContain(`    edit "203.0.113.96/27"
        set type port-block-allocation`);
    expect(fortios.plan(desired, printed(desired), options)).toEqual({ steps: [], problems: [] });
});

test("NAT64 alone needs no central NAT, and the central SNAT entries are numbered without it", () => {
    const servers = {
        description: "Servers out",
        if: { src: "198.51.100.32/27", out_interface: "uplink" },
        then: "snat",
        to_address: "203.0.113.11",
    } as const;

    expect(fortios.render(withNat64([TO_ADDRESS], DNS64))).not.toContain("central-nat");
    expect(fortios.render(withNat64([TO_ADDRESS, servers], DNS64))).toContain(`config firewall central-snat-map
    edit 1
        set orig-addr "198.51.100.32/27"`);
});

test("a device with NAT64 the config doesn't have turns it off, and its policies go before the pools and addresses they name", () => {
    const current = printed(fortios.render(withNat64([TO_ADDRESS], DNS64)));
    const steps = fortios.plan(fortios.render(withNat64([])), current, options).steps;

    expect(steps.map((step) => step.title)).toContain("system nat64");
    expect(steps.find((step) => step.title === "system nat64")?.send).toEqual([
        "config system nat64",
        "unset always-synthesize-aaaa-record",
        "unset status",
        "end",
    ]);
    const removed = steps.filter((step) => step.title.endsWith(", removed")).map((step) => step.title);
    expect(removed.indexOf("firewall policy64, removed")).toBeLessThan(removed.indexOf("firewall ippool, removed"));
    expect(removed.indexOf("firewall policy64, removed")).toBeLessThan(removed.indexOf("firewall address6, removed"));
});

test("rules in another order move the device's policies, and another prefix is set", () => {
    const current = printed(fortios.render(withNat64([TO_ADDRESS, TO_POOL], DNS64)));
    const prefix = "2001:db8:64:ff9b::/96" as const;
    const moved = [TO_POOL, TO_ADDRESS].map((rule) => ({ ...rule, if: { ...rule.if, dst: prefix } }));
    const steps = fortios.plan(fortios.render(withNat64(moved, { prefix })), current, options).steps;

    expect(steps.find((step) => step.title === "system nat64")?.send).toEqual(["config system nat64", `set nat64-prefix ${prefix}`, "end"]);
    expect(steps.find((step) => step.title === "firewall policy64")?.send).toEqual(["config firewall policy64", "move 2 before 1", "end"]);
});

test("FortiOS refuses a prefix that isn't a /96, two prefixes, a protocol or port, and its DNS server without DNS64 beside NAT64", () => {
    const device = withNat64([
        { ...TO_ADDRESS, if: { ...TO_ADDRESS.if, dst: "2001:db8:64::/64" } },
        { ...TO_ADDRESS, if: { ...TO_ADDRESS.if, protocol: "tcp", dst_port: 443 } },
    ]);

    expect(fortios.unsupported(device).filter((gap) => /nat64|dns|NAT64|policy here/.test(gap))).toEqual([
        "firewall.nat.source[0].if.dst 2001:db8:64::/64, FortiOS 6.2 takes a NAT64 prefix of /96 only",
        "firewall.nat.source[1].if.protocol, a NAT64 policy here translates every protocol",
        "firewall.nat.source[1].if.dst_port, a NAT64 policy here translates every protocol",
        "firewall.nat.source, NAT64 prefixes 2001:db8:64::/64, 64:ff9b::/96: a VDOM has one, which NAT64 and DNS64 share. Write the same prefix in each",
        "services.dns_server beside a nat64 rule, without services.dns64: FortiOS's DNS server is DNS64 whenever NAT64 is on. Write services.dns64 with the rule's prefix",
    ]);
});

test("FortiOS warns that its forward chain doesn't filter NAT64 traffic", () => {
    const device = withNat64([TO_ADDRESS], DNS64);
    const nat64 = (one: Device) => fortios.checks!(one).filter((finding) => finding.message.includes("nat64"));

    expect(nat64(device)).toEqual([
        {
            level: "warning",
            device: device.name,
            message:
                "firewall.nat.source, nat64: FortiOS checks NAT64 traffic against NAT64 policies alone, so firewall.filter.forward doesn't filter it. A nat64 rule lets through what its if matches.",
        },
    ]);
    expect(nat64({ ...device, firewall: { ...device.firewall, filter: { input: device.firewall?.filter?.input } } })).toEqual([]);
});

test("FortiOS sends NAT64 and DNS64 only with --experimental: no traffic crossed them on the device", () => {
    expect(fortios.experimental!(withNat64([TO_ADDRESS, TO_POOL], DNS64))).toEqual(
        expect.arrayContaining(["firewall.nat.source[0].then nat64", "firewall.nat.source[1].then nat64", "services.dns64"])
    );
});

test("RouterOS refuses NAT64 and DNS64, and the platforms without a DNS server refuse DNS64", () => {
    const router = Fixtures.device("platforms--example-router");
    const device: Device = {
        ...router,
        firewall: { ...router.firewall, nat: { source: [{ ...TO_ADDRESS, if: { src: "2001:db8:100::/40", dst: "64:ff9b::/96" } }] } },
        services: { ...router.services, dns_server: true, dns64: DNS64 },
    };
    expect(Platforms.get("routeros").unsupported(device)).toEqual(
        expect.arrayContaining([
            "firewall.nat.source[0].then nat64, RouterOS has no NAT64",
            "services.dns64, RouterOS's DNS server has no DNS64",
        ])
    );

    for (const platform of ["junos", "vrp", "raisecom-ros"]) {
        const [fixture] = Fixtures.ofPlatform(platform);
        const base = Fixtures.device(fixture!);
        const refused = Platforms.get(platform).unsupported({ ...base, services: { ...base.services, dns64: DNS64 } });
        expect(refused).toContain("services.dns64, which needs services.dns_server");
    }
});

test("a NAT64 rule's prefix is one RFC 6052 allows, in if.dst, and DNS64 needs the DNS server", () => {
    const device = withNat64(
        [
            { ...TO_ADDRESS, if: { src: "2001:db8:100::/40", dst: "2001:db8:64::/80" } },
            { ...TO_ADDRESS, if: { src: "2001:db8:100::/40", dst: "2001:db8:64::1/96" } },
            { ...TO_ADDRESS, if: { src: "2001:db8:100::/40", dst: "2001:db8:64:0:ff00::/96" } },
            { ...TO_ADDRESS, if: { src: "198.51.100.0/24", dst_address_set: "nat64" } },
            { ...TO_ADDRESS, if: { family: "ipv4", dst: "203.0.113.0/24" } },
        ],
        { prefix: "2001:db8:64::/72" }
    );
    const { dns_server: _, ...services } = device.services ?? {};
    const messages = Checks.run([{ ...device, services }], undefined)
        .filter((finding) => finding.level === "error")
        .map((finding) => finding.message)
        // What validate says on any platform: the device's own refusals and experiments are FortiOS's.
        .filter((message) => !message.startsWith("fortios cannot express") && !message.includes("is not tested on a real device"));

    expect(messages).toEqual([
        "firewall.nat.source[0] (IPv6 hosts to IPv4): if.dst 2001:db8:64::/80: a NAT64 prefix is a /32, /40, /48, /56, /64, /96 (RFC 6052). Write one of those lengths.",
        "firewall.nat.source[1] (IPv6 hosts to IPv4): if.dst 2001:db8:64::1/96 has bits past its length. Write 2001:db8:64::/96.",
        "firewall.nat.source[2] (IPv6 hosts to IPv4): if.dst 2001:db8:64:0:ff00::/96: bits 64 to 71 of a NAT64 prefix are zero (RFC 6052 §2.2). Write a prefix with them zero.",
        "firewall.nat.source[3] (IPv6 hosts to IPv4): nat64 takes its NAT64 prefix from if.dst. Write it there, such as 64:ff9b::/96, not in dst_address_set.",
        "firewall.nat.source[3] (IPv6 hosts to IPv4): write one NAT64 prefix in if.dst, such as 64:ff9b::/96.",
        "firewall.nat.source[3] (IPv6 hosts to IPv4): if.src 198.51.100.0/24 is IPv4, and nat64 translates packets from IPv6 hosts. Write their IPv6 prefix.",
        "firewall.nat.source[4] (IPv6 hosts to IPv4): if.dst 203.0.113.0/24 is not an IPv6 prefix. Write the NAT64 prefix, such as 64:ff9b::/96.",
        'firewall.nat.source[4] (IPv6 hosts to IPv4): nat64 translates IPv6 packets. Write family: "ipv6", or leave it out.',
        "services.dns64 answers as the device's DNS server, which is off. Write services.dns_server: true beside it.",
        "services.dns64: prefix 2001:db8:64::/72: a NAT64 prefix is a /32, /40, /48, /56, /64, /96 (RFC 6052). Write one of those lengths.",
    ]);
});

test("NAT64 belongs in source NAT", () => {
    const device = withNat64([]);
    const messages = Checks.run([{ ...device, firewall: { ...device.firewall, nat: { destination: [TO_ADDRESS] } } }], undefined).map(
        (finding) => finding.message
    );

    expect(messages).toContain("firewall.nat.destination[0]: nat64 translates the source too. Move the rule to firewall.nat.source.");
});
