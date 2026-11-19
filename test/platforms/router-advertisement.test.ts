// Router advertisements (RFC 4861, RFC 8106), tested on a CCR2216 with RouterOS 7.24.6, a QFX5100 with Junos 21.4R3, and a FortiGate 3700D with FortiOS 6.2.2. On each, the plan converged as the settings were set, changed, and taken back to `ipv6_ra: true`. The tests copy how each device prints them.

import { expect, test } from "bun:test";
import { Checks } from "../../src/checks";
import type { Device, RouterAdvertisement } from "../../src/model";
import { Platforms } from "../../src/platforms";
import { Fixtures } from "../fixtures";

const options = { secrets: false, rollback: 10 };

/** A fixture's device whose VLAN interface `name` sends `ra`. */
function advertising(fixture: string, name: string, ra: true | RouterAdvertisement): Device {
    const device = structuredClone(Fixtures.device(fixture));
    device.interfaces!.vlan_interface![name]!.ipv6_ra = ra;
    return device;
}

const sent = (platform: string, desired: string, current: string) =>
    Platforms.get(platform)
        .plan(desired, current, options)
        .steps.flatMap((step) => step.send);

const FULL: RouterAdvertisement = {
    interval: 60,
    lifetime: 600,
    prefixes: [{ prefix: "2001:db8:20::/64", disable_autoconfiguration: true, valid_lifetime: 86_400, preferred_lifetime: 14_400 }],
    dns_servers: ["2001:db8:20::53", "2001:db8:20::54"],
};

test("RouterOS writes the settings on the interface's entry and the prefixes as entries of their own, as the router prints them", () => {
    const routeros = Platforms.get("routeros");
    const desired = routeros.render(advertising("platforms--example-router", "servers", FULL));

    expect(desired).toContain("add address=2001:db8:20::1/64 advertise=no");
    expect(desired).toContain(
        'add advertise-dns=yes dns="2001:db8:20::53,2001:db8:20::54" interface=servers ra-interval=20s-1m ra-lifetime=10m'
    );
    expect(desired).toContain("add autonomous=no interface=servers preferred-lifetime=4h prefix=2001:db8:20::/64 valid-lifetime=1d");
    expect(sent("routeros", desired, desired)).toEqual([]);
});

test("RouterOS writes a lifetime of 0 as none and a prefix lifetime of all ones as infinity, and resets what the config leaves out", () => {
    const routeros = Platforms.get("routeros");
    const full = routeros.render(advertising("platforms--example-router", "servers", FULL));
    const bare = routeros.render(
        advertising("platforms--example-router", "servers", {
            lifetime: 0,
            prefixes: [{ prefix: "2001:db8:20::/64", valid_lifetime: 4_294_967_295 }],
        })
    );

    expect(sent("routeros", bare, full)).toEqual([
        '/ipv6 nd set [ find interface=servers ] ra-lifetime=none advertise-dns=no dns="" ra-interval=3m20s-10m',
        '/ipv6 nd prefix set [ find prefix="2001:db8:20::/64" and interface=servers and !dynamic ] valid-lifetime=infinity autonomous=yes preferred-lifetime=1w',
    ]);
});

test("RouterOS waits for the prefix an address stops advertising before it adds the prefix as an entry of its own", () => {
    const routeros = Platforms.get("routeros");
    const on = routeros.render(advertising("platforms--example-router", "servers", true));
    const full = routeros.render(advertising("platforms--example-router", "servers", FULL));

    const plan = sent("routeros", full, on);
    const wait = plan.findIndex((line) => line.startsWith(":local waited 0; :while ([:len [/ipv6 nd prefix find dynamic and"));
    expect(wait).toBeGreaterThan(plan.findIndex((line) => line.includes('address="2001:db8:20::1/64"') && line.endsWith("advertise=no")));
    expect(plan[wait + 1]).toStartWith("/ipv6 nd prefix add ");

    expect(sent("routeros", on, full)).toContain(
        '/ipv6 nd prefix remove [ find prefix="2001:db8:20::/64" and interface=servers and !dynamic ]'
    );
});

test("RouterOS refuses a search list", () => {
    const device = advertising("platforms--example-router", "servers", { dns_search_list: ["example.net"] });
    expect(Platforms.get("routeros").unsupported(device)).toContain(
        "interfaces.vlan_interface.servers.ipv6_ra.dns_search_list, RouterOS announces no search domains (DNSSL)"
    );
});

test("Junos writes each setting, and plans nothing against how the switch prints them", () => {
    const junos = Platforms.get("junos");
    const desired = junos.render(
        advertising("platforms--example-aggregation-switch", "management", {
            ...FULL,
            prefixes: [{ ...FULL.prefixes![0]!, prefix: "2001:db8::/64" }, { prefix: "2001:db8:1::/64" }],
            dns_search_list: ["example.net"],
        })
    );
    const at = "set protocols router-advertisement interface irb.10";

    // The switch prints the DNS servers before the prefixes, and a prefix's lifetimes before `no-autonomous`.
    const printed = [
        ...desired.split("\n").filter((line) => !line.startsWith(at)),
        `${at} max-advertisement-interval 60`,
        `${at} default-lifetime 600`,
        `${at} dns-server-address 2001:db8:20::53`,
        `${at} dns-server-address 2001:db8:20::54`,
        `${at} prefix 2001:db8::/64 valid-lifetime 86400`,
        `${at} prefix 2001:db8::/64 preferred-lifetime 14400`,
        `${at} prefix 2001:db8::/64 no-autonomous`,
        `${at} prefix 2001:db8:1::/64`,
        `${at} dns-search-list example.net`,
    ].join("\n");

    expect(desired).toContain(`${at} prefix 2001:db8::/64 no-autonomous`);
    expect(desired).not.toContain(`${at} prefix 2001:db8::/64\n`);
    expect(sent("junos", desired, printed)).toEqual([]);
});

test("FortiOS writes the settings and the DNS servers on each prefix, and plans nothing against how the firewall prints them", () => {
    const fortios = Platforms.get("fortios");
    const device = advertising("platforms--example-firewall", "servers", {
        ...FULL,
        prefixes: [{ ...FULL.prefixes![0]!, prefix: "2001:db8:40::/64" }, { prefix: "2001:db8:41::/64" }],
        dns_search_list: ["example.net", "example.org"],
    });
    const desired = fortios.render(device);

    expect(desired).toContain("set ip6-max-interval 60\n            set ip6-min-interval 20\n            set ip6-default-life 600");
    expect(desired).toContain('set dnssl "example.net" "example.org"');

    // The firewall prints a space after the last DNS server.
    const printed = desired.replace(/set rdnss (.+)$/gm, "set rdnss $1 ");
    expect(sent("fortios", desired, printed)).toEqual([]);

    const plain = fortios.render(advertising("platforms--example-firewall", "servers", true));
    expect(sent("fortios", plain, desired)).toContain("unset ip6-max-interval");
});

test("validate holds a router advertisement to RFC 4861's ranges", () => {
    const device = advertising("platforms--example-router", "servers", {
        interval: 2,
        lifetime: 1,
        prefixes: [
            { prefix: "192.0.2.0/24" },
            { prefix: "2001:db8:20::1/64" },
            { prefix: "2001:db8:21::/64", valid_lifetime: 60, preferred_lifetime: 120 },
        ],
    });
    const errors = Checks.run([device], undefined)
        .filter((finding) => finding.level === "error")
        .map((finding) => finding.message);

    const where = "interfaces.vlan_interface.servers.ipv6_ra";
    expect(errors).toEqual(
        expect.arrayContaining([
            `${where}.interval 2 is not a whole number from 4 to 1800`,
            `${where}.lifetime 1 is below interval 2: hosts would drop the router between two advertisements`,
            `${where}.prefixes[0].prefix '192.0.2.0/24' is not an IPv6 prefix, such as 2001:db8:100:1::/64`,
            `${where}.prefixes[1].prefix 2001:db8:20::1/64 has bits past its length: write 2001:db8:20::/64`,
            `${where}.prefixes[2].preferred_lifetime 120 is above valid_lifetime 60, so hosts ignore the prefix`,
        ])
    );
});

test("validate warns of a prefix that is not a /64, where hosts make no address of their own", () => {
    const device = advertising("platforms--example-router", "servers", { prefixes: [{ prefix: "2001:db8:20::/56" }] });
    const warnings = Checks.run([device], undefined).filter((finding) => finding.level === "warning");
    expect(warnings.map((finding) => finding.message)).toContain(
        "interfaces.vlan_interface.servers.ipv6_ra announces 2001:db8:20::/56, where hosts make no address of their own: they do only in a /64. Write disable_autoconfiguration: true for it, or announce a /64"
    );
});
