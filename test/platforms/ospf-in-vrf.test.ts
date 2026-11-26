// OSPF in a VRF, tested on a QFX5100 with Junos 21.4R3, a FG-3700D with FortiOS 6.2.2, and the CI CHRs (test/platforms/routeros-chr-vrf.test.ts). The QFX5100 ran OSPF in a new routing instance on a loopback in it. The FG-3700D ran it in a VRF toward another VDOM, across a link between VDOMs. The lines each printed are fed to the adapters, with names and addresses replaced.

import { expect, test } from "bun:test";
import { Checks } from "../../src/checks";
import type { Device, Ospf } from "../../src/model";
import { Platforms } from "../../src/platforms";
import { Fixtures } from "../fixtures";

const options = { secrets: false, rollback: 10 };

/** A fixture's device with VRF `terramix`, a loopback in it, and only this OSPF, in the VRF unless it says otherwise. */
function inVrf(fixture: string, ospf: Partial<Ospf> = {}): Device {
    const device = Fixtures.device(fixture);
    return {
        ...device,
        interfaces: {
            ...device.interfaces,
            loopback: { ...device.interfaces?.loopback, "terramix-loopback": { addresses: ["192.0.2.1/32"], vrf: "terramix" } },
        },
        routing: {
            ...device.routing,
            vrfs: { terramix: {} },
            ospf: {
                vrf: "terramix",
                areas: { "0.0.0.0": { interfaces: { "terramix-loopback": { passive: true, cost: 10 } } } },
                redistribute: ["connected"],
                ...ospf,
            },
        },
    };
}

const messages = (device: Device) => Checks.run([device], undefined).map((finding) => finding.message);

test("RouterOS runs the OSPF instance in the VRF, and plans nothing against the same instance", () => {
    const routeros = Platforms.get("routeros");
    const desired = routeros.render(inVrf("platforms--example-router"));

    expect(desired).toContain("add name=ospf-v2 redistribute=connected router-id=192.0.2.255 version=2 vrf=terramix");
    expect(routeros.plan(desired, desired, options).steps).toEqual([]);
});

test("RouterOS moves OSPF back to the main table with vrf=main", () => {
    const routeros = Platforms.get("routeros");
    const device = inVrf("platforms--example-router");
    const main = { ...device, routing: { ...device.routing, ospf: { ...device.routing!.ospf!, vrf: undefined, areas: {} } } };

    const sent = routeros.plan(routeros.render(main), routeros.render(device), options).steps.flatMap((step) => step.send);
    expect(sent).toContainEqual(expect.stringMatching(/^\/routing ospf instance set \[ find name=ospf-v2 \] .*vrf=main/));
});

test("Junos runs OSPF in the VRF's routing instance, with the router's ID, as the switch printed it", () => {
    const desired = Platforms.get("junos").render(inVrf("platforms--example-aggregation-switch"));

    // As `show configuration | display set` printed them, the router ID aside.
    for (const line of [
        "set routing-instances terramix instance-type virtual-router",
        "set routing-instances terramix interface lo0.1",
        "set routing-instances terramix protocols ospf area 0.0.0.0 interface lo0.1 passive",
        "set routing-instances terramix protocols ospf area 0.0.0.0 interface lo0.1 metric 10",
        "set routing-instances terramix protocols ospf export circuit-ospf-redistribute",
        "set routing-instances terramix routing-options router-id 203.0.113.65",
        "set policy-options policy-statement circuit-ospf-redistribute term connected from protocol direct",
    ])
        expect(desired).toContain(line);
    expect(desired).not.toContain("set protocols ospf");
});

/** The firewall with OSPF in VRF `guests`: the VRF's VLAN interface with BFD, and a passive loopback in the VRF. */
function fortiosInVrf(ospf: Partial<Ospf> = {}): Device {
    const device = Fixtures.device("platforms--example-firewall");
    return {
        ...device,
        interfaces: {
            ...device.interfaces,
            loopback: { ...device.interfaces?.loopback, "guest-lo": { addresses: ["192.0.2.65/26"], vrf: "guests" } },
        },
        routing: {
            ...device.routing,
            ospf: {
                vrf: "guests",
                areas: { "0.0.0.0": { interfaces: { guests: { bfd: true }, "guest-lo": { passive: true } } } },
                redistribute: ["connected", "static"],
                ...ospf,
            },
        },
    };
}

test("FortiOS runs OSPFv2 in the VRF its interfaces route in, and plans nothing against how the firewall printed it", () => {
    const fortios = Platforms.get("fortios");
    const device = fortiosInVrf();
    const rendered = fortios.render(device);
    const desired = rendered.match(/^config router ospf\n[\s\S]*?^end\n/m)![0];

    expect(fortios.unsupported(device).filter((gap) => gap.includes("ospf"))).toEqual([]);
    expect(rendered.match(/^ +edit "guest-lo"\n[\s\S]*?^ +next\n/m)![0]).toContain("set vrf 1");

    // As the firewall printed it, with OSPF up in VRF 1 and BFD up on the link.
    const printed = `config router ospf
    set router-id 198.51.100.255
    set passive-interface "guest-lo"
    config area
        edit 0.0.0.0
        next
    end
    config ospf-interface
        edit "guests"
            set interface "guests"
            set bfd enable
        next
    end
    config network
        edit 1
            set prefix 198.51.100.96 255.255.255.224
        next
        edit 2
            set prefix 192.0.2.64 255.255.255.192
        next
    end
    config redistribute "connected"
        set status enable
    end
    config redistribute "static"
        set status enable
    end
    config redistribute "rip"
    end
    config redistribute "bgp"
    end
    config redistribute "isis"
    end
end
`;
    expect(fortios.plan(desired, printed, options).steps).toEqual([]);
});

test("FortiOS refuses OSPFv3 in a VRF", () => {
    expect(Platforms.get("fortios").unsupported(fortiosInVrf({ address_families: ["ipv4", "ipv6"] }))).toContain(
        "routing.ospf.vrf with ipv6 in address_families, FortiOS 6.2 runs OSPFv3 in the default VRF only"
    );
});

test("an OSPF interface that routes in another table than OSPF is refused, with what to write", () => {
    expect(messages(inVrf("platforms--example-router", { vrf: undefined }))).toContain(
        'routing.ospf.areas.0.0.0.0.interfaces.terramix-loopback: terramix-loopback routes in VRF terramix, and OSPF in the main table. Write vrf: "terramix" in routing.ospf'
    );

    const both = inVrf("platforms--example-router", {
        areas: { "0.0.0.0": { interfaces: { "terramix-loopback": {}, loopback: { passive: true } } } },
    });
    expect(messages(both)).toContain(
        'routing.ospf.areas.0.0.0.0.interfaces.loopback: loopback routes in the main table, and OSPF in VRF terramix. Write vrf: "terramix" on loopback, or remove it from the area'
    );
});
