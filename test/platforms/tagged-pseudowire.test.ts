// Pseudowires that carry VLANs with their tags, or a QinQ VLAN: the TV station's between pe-02 and pe-03 of the MPLS core example, and the ISP's between pe-01 and pe-02. RouterOS 7.24.6 ran both on CHRs (test/platforms/routeros-chr-tagged-pseudowire.test.ts), and the lines it printed there are fed to the adapter here.

import { beforeAll, expect, test } from "bun:test";
import { Checks } from "../../src/checks";
import { DeviceChecks } from "../../src/checks/device";
import type { Device, Pseudowire } from "../../src/model";
import { Platforms } from "../../src/platforms";
import { Fixtures } from "../fixtures";

const options = { secrets: false, rollback: 10 };
const routeros = Platforms.get("routeros");

/** The three PEs of the MPLS core example. */
let core: Record<string, Device>;

beforeAll(async () => {
    core = await Fixtures.example("mpls-core");
});

/** A PE of the example with one pseudowire changed, or added. */
function withPseudowire(name: string, pseudowire: string, settings: Pseudowire): Device {
    const device = core[name]!;
    return { ...device, interfaces: { ...device.interfaces, pseudowire: { ...device.interfaces!.pseudowire, [pseudowire]: settings } } };
}

const errors = (device: Device) =>
    DeviceChecks.run(device)
        .filter((finding) => finding.level === "error")
        .map((finding) => finding.message);

test("RouterOS makes a trunk pseudowire tagged mode, a bridge port that takes tagged frames only, and a QinQ pseudowire a QinQ bridge port", () => {
    const desired = routeros.render(core["pe-02"]!);

    expect(desired).toContain(
        'add cisco-static-id=401 comment="TV station, to site 2 at pe-03" disabled=no name=pw-tv peer=10.255.0.3 pw-type=tagged-ethernet\n'
    );
    expect(desired).toContain("add bridge=bridge frame-types=admit-only-vlan-tagged horizon=2 interface=pw-tv\n");
    expect(desired).toContain('add bridge=bridge comment="TV station, studio" tagged="sfp28-4,pw-tv" vlan-ids=401\n');
    expect(desired).toContain('add cisco-static-id=500 comment="ISP, to handoff 1 at pe-01" disabled=no name=pw-isp peer=10.255.0.1\n');
    expect(desired).toContain("add bridge=bridge horizon=2 interface=pw-isp pvid=500 tag-stacking=yes\n");

    // As the CHRs printed them: each VPLS interface with the MAC it made up.
    const printed = desired
        .replace("name=pw-tv peer", "mac-address=02:F2:67:95:53:94 name=pw-tv peer")
        .replace("name=pw-isp peer", "mac-address=02:B1:67:31:64:95 name=pw-isp peer");
    expect(routeros.plan(desired, printed, options).steps).toEqual([]);
});

test("RouterOS changes a trunk pseudowire into an access port in place, back to raw mode", () => {
    const tv = core["pe-02"]!.interfaces!.pseudowire!["pw-tv"]!;
    const desired = routeros.render(core["pe-02"]!);
    const access = routeros.render(withPseudowire("pe-02", "pw-tv", { ...tv, trunk_vlans: undefined, access_vlan: "tv-studio" }));

    expect(routeros.plan(access, desired, options).steps.flatMap((step) => step.send)).toEqual([
        "/interface vpls set [ find name=pw-tv ] pw-type=raw-ethernet",
        "/interface bridge port set [ find interface=pw-tv ] frame-types=admit-only-untagged-and-priority-tagged pvid=401",
        "/interface bridge vlan set [ find vlan-ids=401 and !dynamic ] tagged=sfp28-4",
        "/interface bridge vlan set [ find vlan-ids=402 and !dynamic ] tagged=sfp28-4",
    ]);
});

test("a pseudowire is in its VLANs one way, and a trunk carries each VLAN once", () => {
    for (const name of ["pe-01", "pe-02", "pe-03"]) expect(errors(core[name]!)).toEqual([]);

    const tv = core["pe-03"]!.interfaces!.pseudowire!["pw-tv"]!;
    expect(errors(withPseudowire("pe-03", "pw-tv", { ...tv, trunk_vlans: undefined }))).toEqual([
        "interfaces.pseudowire.pw-tv is in no VLAN. Write access_vlan, trunk_vlans, or qinq_vlan",
    ]);
    expect(errors(withPseudowire("pe-03", "pw-tv", { ...tv, access_vlan: "museum", qinq_vlan: "library" }))).toEqual([
        "interfaces.pseudowire.pw-tv has access_vlan and trunk_vlans and qinq_vlan: write one of them",
    ]);
    expect(errors(withPseudowire("pe-03", "pw-tv", { ...tv, trunk_vlans: [] }))).toEqual([
        "interfaces.pseudowire.pw-tv.trunk_vlans lists no VLAN. Write the VLANs it carries, or access_vlan",
    ]);
    expect(errors(withPseudowire("pe-03", "pw-tv", { ...tv, trunk_vlans: ["tv-news", "tv-news"] }))).toEqual([
        "interfaces.pseudowire.pw-tv.trunk_vlans lists tv-news twice. Remove one",
    ]);
});

test("a pseudowire back at the far PE carries the same VLAN IDs tagged, or both carry their frames untagged", () => {
    const routers = Object.values(core);
    expect(Checks.run(routers, undefined).filter((finding) => finding.level === "error")).toEqual([]);

    const tv = core["pe-03"]!.interfaces!.pseudowire!["pw-tv"]!;
    const untagged = withPseudowire("pe-03", "pw-tv", { ...tv, trunk_vlans: undefined, access_vlan: "tv-studio" });
    expect(Checks.run([core["pe-02"]!, untagged], undefined).map((finding) => finding.message)).toEqual(
        expect.arrayContaining([
            "interfaces.pseudowire.pw-tv.trunk_vlans carries VLANs tagged, and pe-03's pseudowire back carries its frames untagged: RFC 4448 wants both ends tagged, or both untagged. Write trunk_vlans at both ends, or at neither",
            "interfaces.pseudowire.pw-tv carries its frames untagged, and pe-02's pseudowire back carries VLANs tagged: RFC 4448 wants both ends tagged, or both untagged. Write trunk_vlans at both ends, or at neither",
        ])
    );

    const fewer = withPseudowire("pe-03", "pw-tv", { ...tv, trunk_vlans: ["tv-studio"] });
    expect(Checks.run([core["pe-02"]!, fewer], undefined).map((finding) => finding.message)).toContain(
        "interfaces.pseudowire.pw-tv.trunk_vlans carries VLAN IDs 401, 402, and pe-03's pseudowire back carries 401: a frame keeps its VLAN ID across. Write the same VLAN IDs at both ends"
    );
});

test("RouterOS refuses what no CHR ran beside a tagged or QinQ pseudowire, saying why", () => {
    const pe02 = core["pe-02"]!;
    const snooping: Device = { ...pe02, switching: { ...pe02.switching, dhcp_snooping: true } };
    expect(routeros.unsupported(snooping)).toContain(
        "interfaces.pseudowire.pw-isp.qinq_vlan beside switching.dhcp_snooping, which the platform runs on every VLAN"
    );

    // An inner VLAN interface whose outer one the render adds, which RouterOS lowers beside a pseudowire.
    const inner: Device = {
        ...pe02,
        interfaces: { ...pe02.interfaces, vlan_interface: { "isp-inner": { vlan: "isp", inner_vlan_id: 10, mtu: 1492 } } },
    };
    expect(routeros.unsupported(inner)).toEqual([
        "switching.vlans.isp: Circuit adds the VLAN interface of its outer tag at MTU 1500, and RouterOS lowers it to 1496 beside a pseudowire. Write a plain VLAN interface on isp with mtu: 1496",
    ]);
});
