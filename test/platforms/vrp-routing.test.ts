// Routing on VRP, tried on a CE6855 on V200R005C00SPC800 with VLAN interfaces of VLANs no port carries and sessions to documentation addresses that never came up. Each plan was committed with `commit trial`, and the plan after it was empty. A change and the removal went into a candidate during the trial.

import { expect, test } from "bun:test";
import type { Device } from "../../src/model";
import { Vrp } from "../../src/platforms/vrp/index";
import { Fixtures } from "../fixtures";

const vrp = new Vrp();
const options = { secrets: false, rollback: 10 };
const base = Fixtures.device("single-site--switch");
const plan = (desired: string, current: string) => vrp.plan(desired, current, options);

/** The single-site switch with a VLAN interface on a VLAN no port carries, these other interfaces, and this routing. */
function routed(routing: Device["routing"], interfaces: Device["interfaces"] = {}): Device {
    return {
        ...base,
        switching: { ...base.switching, vlans: { ...base.switching!.vlans, "ctest-a": { id: 3981 } } },
        interfaces: {
            ...base.interfaces,
            vlan_interface: {
                ...base.interfaces!.vlan_interface,
                "ctest-a": { vlan: "ctest-a", addresses: ["192.0.2.1/28", "2001:db8:3981::1/64"] },
            },
            ...interfaces,
        },
        routing: { ...base.routing, ...routing },
    };
}

test("a static route through an interface names it before its next hop, and goes after the interfaces", () => {
    const device = routed({
        static_routes: [
            ...base.routing!.static_routes!,
            { prefix: "198.51.100.0/24", next_hop: "192.0.2.2", interface: "ctest-a" },
            { prefix: "2001:db8:1::/48", next_hop: "fe80::2", interface: "ctest-a" },
        ],
    });
    const rendered = vrp.render(device);

    expect(rendered).toContain("ip route-static 198.51.100.0 255.255.255.0 Vlanif3981 192.0.2.2\n");
    expect(rendered).toContain("ipv6 route-static 2001:DB8:1:: 48 Vlanif3981 FE80::2\n");
    expect(vrp.unsupported(device)).toEqual([]);

    // The switch refuses a route through an interface that does not exist yet, and its undo once the interface is gone.
    const titles = plan(rendered, vrp.render(base)).steps.map((step) => step.title);
    expect(titles.indexOf("Static routes through interfaces")).toBe(titles.indexOf("interface Vlanif3981") + 1);
    expect(plan(vrp.render(base), rendered).steps.slice(0, 2)).toEqual([
        {
            title: "Static routes through interfaces, removed",
            show: [
                "- ipv6 route-static 2001:DB8:1:: 48 Vlanif3981 FE80::2",
                "- ip route-static 198.51.100.0 255.255.255.0 Vlanif3981 192.0.2.2",
            ],
            send: [
                "undo ipv6 route-static 2001:DB8:1:: 48 Vlanif3981 FE80::2",
                "undo ip route-static 198.51.100.0 255.255.255.0 Vlanif3981 192.0.2.2",
            ],
        },
        {
            title: "VLANs no longer used",
            show: ["- interface Vlanif3981", "- vlan 3981", "- vlan batch 3981"],
            send: ["undo interface Vlanif3981", "undo vlan batch 3981"],
        },
    ]);

    const watched = routed({
        bfd: { interval: 300, multiplier: 3 },
        static_routes: [{ prefix: "198.51.100.0/24", next_hop: "192.0.2.2", interface: "ctest-a", bfd: true }],
    });
    expect(vrp.unsupported(watched)).toEqual(["routing.static_routes 198.51.100.0/24 bfd beside interface, not tested"]);
});

test("loopbacks are LoopBack0 and on, in the order the config lists them, with OSPF, and a BGP session may start from one", () => {
    const device = routed(
        {
            router_id: "192.0.2.250",
            ospf: { areas: { "0.0.0.0": { interfaces: { "ctest-lo": { passive: true, cost: 10 } } } } },
            bgp: { asn: 64500, neighbors: { member: { address: "192.0.2.3", remote_as: 64500, local_address: "192.0.2.250" } } },
        },
        {
            loopback: {
                "ctest-lo": { description: "ctest loopback", addresses: ["192.0.2.250/32", "2001:db8:39::1/128"] },
                second: { addresses: ["192.0.2.251/32"] },
            },
        }
    );
    const rendered = vrp.render(device);

    expect(rendered).toContain(
        "interface LoopBack0\n description ctest loopback\n ipv6 enable\n ip address 192.0.2.250 255.255.255.255\n ipv6 address 2001:DB8:39::1/128\n ospf cost 10\n#"
    );
    expect(rendered).toContain("interface LoopBack1\n ip address 192.0.2.251 255.255.255.255\n#");
    expect(rendered).toContain(" silent-interface LoopBack0\n");
    expect(rendered).toContain(" peer 192.0.2.3 connect-interface LoopBack0 192.0.2.250\n");
    expect(vrp.unsupported(device)).toEqual([]);

    const vrrp = routed({}, { loopback: { "ctest-lo": { addresses: ["192.0.2.250/32"], vrrp: [{ id: 1, address: "192.0.2.249" }] } } });
    expect(vrp.unsupported(vrrp)).toContain("interfaces.loopback.ctest-lo.vrrp, on VLAN interfaces only");
});

/** How the switch printed the tunnel: its addresses before its ends. */
const PRINTED_TUNNEL = [
    "interface Tunnel0",
    " description ctest tunnel",
    " ipv6 enable",
    " ip address 192.0.2.37 255.255.255.252",
    " ipv6 address 2001:DB8:3982::1/64",
    " tunnel-protocol gre",
    " source 192.0.2.250",
    " destination 203.0.113.1",
    "#",
].join("\n");

test("a GRE tunnel is Tunnel0 and on, and sends its protocol and its ends before its addresses", () => {
    const tunnel = { description: "ctest tunnel", local_address: "192.0.2.250", remote_address: "203.0.113.1" } as const;
    const device = routed(
        {
            static_routes: [
                { prefix: "203.0.113.0/24", blackhole: true },
                { prefix: "198.18.0.0/24", interface: "ctest-gre" },
            ],
        },
        {
            loopback: { "ctest-lo": { addresses: ["192.0.2.250/32"] } },
            gre: { "ctest-gre": { ...tunnel, addresses: ["192.0.2.37/30", "2001:db8:3982::1/64"] } },
        }
    );
    const rendered = vrp.render(device);
    const block = rendered.slice(rendered.indexOf("interface Tunnel0"), rendered.indexOf("#", rendered.indexOf("interface Tunnel0")) + 1);

    expect(block.split("\n")).toEqual([
        "interface Tunnel0",
        " description ctest tunnel",
        " tunnel-protocol gre",
        " source 192.0.2.250",
        " destination 203.0.113.1",
        " ipv6 enable",
        " ip address 192.0.2.37 255.255.255.252",
        " ipv6 address 2001:DB8:3982::1/64",
        "#",
    ]);
    expect(rendered).toContain("ip route-static 198.18.0.0 255.255.255.0 Tunnel0\n");
    expect(plan(rendered, rendered.replace(block, PRINTED_TUNNEL)).steps).toEqual([]);
    expect(vrp.unsupported(device)).toEqual([]);

    const overIpv6 = routed({}, { gre: { "ctest-gre": { local_address: "2001:db8:39::1", remote_address: "2001:db8:ffff::1" } } });
    expect(vrp.unsupported(overIpv6)).toContain("interfaces.gre.ctest-gre, GRE between IPv6 addresses, not built yet");
    const inVrf = routed({ vrfs: { ctest: {} } }, { gre: { "ctest-gre": { ...tunnel, vrf: "ctest" } } });
    expect(vrp.unsupported(inVrf)).toContain("interfaces.gre.ctest-gre.vrf, a GRE tunnel in a VRF, not tested");
});

test("a routed port, a bridge, and a VLAN interface on an inner VLAN are refused with what the switch said", () => {
    const device = routed(
        {},
        {
            ethernet: { ...base.interfaces!.ethernet, "10g-48": { addresses: ["192.0.2.33/30"] } },
            vlan_interface: { inner: { vlan: "home", inner_vlan_id: 100, addresses: ["192.0.2.65/28"] } },
            bridge: { both: { member_interfaces: ["inner"] } },
        }
    );

    expect(vrp.unsupported(device)).toEqual(
        expect.arrayContaining([
            "interfaces.bridge.both, a bridge: a CloudEngine bridge domain binds one VLAN, and no VLAN that has a VLAN interface",
            "interfaces.ethernet.10g-48.addresses, a routed port: the switch routes a port only on a VLAN it reserves for it, which Circuit has no key for. Use a VLAN interface",
            "interfaces.vlan_interface.inner.inner_vlan_id, a VLAN interface on V200R005 ends no inner VLAN, and a sub-interface needs a routed port",
        ])
    );
});

const sent = (desired: string, current: string) => plan(desired, current).steps.flatMap((step) => step.send);

/** Sessions to documentation addresses on the VLAN interface `ctest-a`, with these settings. */
function sessions(settings: Record<string, unknown>, bgp: Record<string, unknown> = {}): Device {
    return routed({
        router_id: "192.0.2.250",
        bgp: {
            asn: 65001,
            ...bgp,
            neighbors: {
                transit: { address: "192.0.2.2", remote_as: 64496, ...settings },
                member: { address: "192.0.2.3", remote_as: 65002, ...settings },
            },
        },
    });
}

test("GTSM is valid-ttl-hops 1, undone without its value", () => {
    const rendered = vrp.render(sessions({ ttl_security: true }));

    expect(rendered).toContain(" peer 192.0.2.2 valid-ttl-hops 1\n");
    expect(sent(vrp.render(sessions({})), rendered)).toEqual([
        "bgp 65001",
        "undo peer 192.0.2.3 valid-ttl-hops",
        "undo peer 192.0.2.2 valid-ttl-hops",
        "quit",
    ]);
});

test("a default route to a neighbor is default-route-advertise in its family, printed with a space after it", () => {
    const rendered = vrp.render(sessions({ send_default_route: true }));

    expect(rendered).toContain("  peer 192.0.2.2 default-route-advertise\n");
    expect(plan(rendered, rendered.replace(/default-route-advertise\n/g, "default-route-advertise \n")).steps).toEqual([]);
    expect(sent(vrp.render(sessions({})), rendered)).toEqual([
        "bgp 65001",
        "ipv4-family unicast",
        "undo peer 192.0.2.3 default-route-advertise",
        "undo peer 192.0.2.2 default-route-advertise",
        "quit",
        "quit",
    ]);
});
