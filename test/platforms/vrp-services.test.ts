// The services of a VRP switch, tried on a CE6855 on V200R005C00SPC800 with VLAN interfaces of VLANs no port carries and a VRF, committed with `commit trial`. The plan after each was empty, and a change and the removal went into a candidate. What the switch refused is refused here with what it said.

import { expect, test } from "bun:test";
import type { Device } from "../../src/model";
import { Vrp } from "../../src/platforms/vrp/index";
import { Fixtures } from "../fixtures";

const vrp = new Vrp();
const options = { secrets: false, rollback: 10 };
const base = Fixtures.device("single-site--switch");
const sent = (desired: string, current: string) => vrp.plan(desired, current, options).steps.flatMap((step) => step.send);

test("a new VRF leaves the views its families enter, so the next block is not sent into one", () => {
    const device: Device = { ...base, routing: { ...base.routing, vrfs: { ctest: {} } } };
    const lines = sent(vrp.render(device), vrp.render(base));
    const at = lines.indexOf("ip vpn-instance ctest");

    expect(lines.slice(at, at + 6)).toEqual(["ip vpn-instance ctest", "ipv4-family", "quit", "ipv6-family", "quit", "quit"]);
});

test("a VRF has both families, so an interface, a route, and a DNS server in it take IPv6, as a CE6855 printed them", () => {
    const device: Device = {
        ...base,
        switching: { ...base.switching, vlans: { ...base.switching?.vlans, ctest: { id: 3981 } } },
        interfaces: {
            ...base.interfaces,
            vlan_interface: {
                ...base.interfaces?.vlan_interface,
                ctest: { vlan: "ctest", vrf: "ctest", addresses: ["2001:db8:3981::1/64"] },
            },
        },
        routing: {
            ...base.routing,
            vrfs: { ctest: {} },
            static_routes: [{ prefix: "2001:db8:1::/48", blackhole: true, vrf: "ctest" }],
        },
        system: { ...base.system, dns: { servers: ["2001:db8::53"], vrf: "ctest" } },
    };
    const desired = vrp.render(device);
    // As `display current-configuration` prints them, but for the space after `ipv6-family`.
    const printed = [
        "ip vpn-instance ctest\n ipv4-family\n ipv6-family\n#\n",
        "interface Vlanif3981\n ip binding vpn-instance ctest\n ipv6 enable\n ipv6 address 2001:DB8:3981::1/64\n#\n",
        "ipv6 route-static vpn-instance ctest 2001:DB8:1:: 48 NULL0\n",
        "dns server ipv6 2001:DB8::53 vpn-instance ctest\n",
    ];

    for (const part of printed) expect(desired).toContain(part);
    expect(vrp.unsupported(device).filter((gap) => /vrf|dns/i.test(gap))).toEqual([]);
    expect(sent(desired, desired)).toEqual([]);
});

test("a CloudEngine answers no DNS queries for others, so VRP refuses a DNS server", () => {
    const device: Device = { ...base, services: { dns_server: true } };
    expect(vrp.unsupported(device)).toContain("services.dns_server, a CloudEngine answers no DNS queries for others");
});

test("VRP has no web interface, guards no API, and takes no certificate, and says why", () => {
    const device: Device = { ...base, management: { ...base.management, http: {}, https: {}, api: {}, api_tls: {} } };
    expect(vrp.unsupported(device).filter((gap) => gap.startsWith("management."))).toEqual([
        "management.http, a CloudEngine has no web interface",
        "management.https, a CloudEngine has no web interface",
        "management.api, RESTCONF over HTTP, which no ACL guards on V200R005, so management.allow can't: not built",
        "management.api_tls, V200R005 has no PKI, and loads a certificate only from a file on the switch's flash, which Circuit does not copy there",
    ]);
});

test("VRP turns its resolver on and names each server, in a VRF too, as a CE6855 printed them", () => {
    const device: Device = { ...base, system: { ...base.system, dns: { servers: ["198.51.100.53", "2001:db8:3981::53"] } } };
    const desired = vrp.render(device);

    expect(desired).toContain("dns resolve\ndns server 198.51.100.53\ndns server ipv6 2001:DB8:3981::53\n");
    expect(sent(desired, desired)).toEqual([]);

    // Each server is one of a list: a new one is added beside the old, which is undone.
    const changed: Device = { ...base, system: { ...base.system, dns: { servers: ["198.51.100.54"] } } };
    expect(sent(vrp.render(changed), desired)).toEqual([
        "undo dns server ipv6 2001:DB8:3981::53",
        "undo dns server 198.51.100.53",
        "dns server 198.51.100.54",
    ]);

    const inVrf: Device = {
        ...base,
        system: { ...base.system, dns: { servers: ["192.0.2.53", "2001:db8::53"], vrf: "ctest" } },
        routing: { ...base.routing, vrfs: { ctest: {} } },
    };
    expect(vrp.render(inVrf)).toContain("dns server 192.0.2.53 vpn-instance ctest\ndns server ipv6 2001:DB8::53 vpn-instance ctest\n");
});
