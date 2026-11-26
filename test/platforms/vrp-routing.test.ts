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
