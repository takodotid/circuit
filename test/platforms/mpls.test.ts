// MPLS with LDP. RouterOS 7.24.6 ran it on three CHRs (test/platforms/routeros-chr-mpls.test.ts). Junos 21.4R3 took the statements in a `commit check` on a QFX5100, nothing committed (TRAPS.md), so it is experimental there.

import { expect, test } from "bun:test";
import { Checks } from "../../src/checks";
import { DeviceChecks } from "../../src/checks/device";
import type { Device, Mpls, PolicyRule } from "../../src/model";
import { Platforms } from "../../src/platforms";
import { Fixtures } from "../fixtures";

const options = { secrets: false, rollback: 10 };

/** A fixture's device with `mpls`, its loopback announced by OSPF. */
function withMpls(fixture: string, mpls: Mpls): Device {
    const device = Fixtures.device(fixture);
    const ospf = device.routing!.ospf!;
    const backbone = ospf.areas["0.0.0.0"]!;
    const areas = { ...ospf.areas, "0.0.0.0": { ...backbone, interfaces: { ...backbone.interfaces, loopback: { passive: true } } } };
    return { ...device, routing: { ...device.routing, ospf: { ...ospf, areas }, mpls } };
}

/** What the device checks find, before any platform's own. */
const errors = (device: Device) =>
    DeviceChecks.run(device)
        .filter((finding) => finding.level === "error")
        .map((finding) => finding.message);

const sent = (platform: string, desired: string, current: string) =>
    Platforms.get(platform)
        .plan(desired, current, options)
        .steps.flatMap((step) => step.send);

/** The router's loopback, its router ID, and its LAG toward another LDP router. */
const ROUTER: Mpls = { ldp: { lsr_id: "192.0.2.255", interfaces: ["uplink"] } };

test("RouterOS enables MPLS on each LDP interface, then runs LDP from the LSR ID, and removes them in the reverse order", () => {
    const routeros = Platforms.get("routeros");
    const device = withMpls("platforms--example-router", ROUTER);
    const desired = routeros.render(device);
    const without = routeros.render({ ...device, routing: { ...device.routing, mpls: undefined } });

    expect(sent("routeros", desired, without)).toEqual([
        "/mpls interface add interface=uplink",
        "/mpls ldp add afi=ip lsr-id=192.0.2.255 transport-addresses=192.0.2.255",
        "/mpls ldp interface add interface=uplink",
    ]);
    expect(sent("routeros", without, desired)).toEqual([
        "/mpls ldp interface remove [ find interface=uplink ]",
        "/mpls ldp remove [ find (vrf=main or !vrf) ]",
        "/mpls interface remove [ find interface=uplink ]",
    ]);

    // As the CHRs printed theirs, with this router's names.
    const printed = `${without}/mpls interface
add interface=uplink
/mpls ldp
add afi=ip lsr-id=192.0.2.255 transport-addresses=192.0.2.255
/mpls ldp interface
add interface=uplink
`;
    expect(sent("routeros", desired, printed)).toEqual([]);
});

test("Junos puts the MPLS family on each LDP interface, runs MPLS and LDP there, and deletes them whole", () => {
    const junos = Platforms.get("junos");
    const device = withMpls("platforms--example-aggregation-switch", { ldp: { lsr_id: "203.0.113.65", interfaces: ["10g-48"] } });
    const desired = junos.render(device);

    // As `show | display set` printed them in the candidate of a `commit check`. Nothing was committed.
    for (const statement of [
        "set interfaces xe-0/0/47 unit 0 family mpls",
        "set protocols mpls interface xe-0/0/47.0",
        "set protocols ldp interface xe-0/0/47.0",
    ])
        expect(desired).toContain(statement);

    const without = junos.render({ ...device, routing: { ...device.routing, mpls: undefined } });
    expect(sent("junos", without, desired)).toEqual([
        "delete interfaces xe-0/0/47 unit 0 family mpls",
        "delete protocols mpls",
        "delete protocols ldp",
    ]);
});

// Nothing was committed, and the switch has no license to run MPLS or LDP.
test("MPLS on Junos is experimental", () => {
    const device = withMpls("platforms--example-aggregation-switch", { ldp: { lsr_id: "203.0.113.65", interfaces: ["10g-48"] } });

    expect(Platforms.get("junos").experimental!(device)).toEqual(["routing.mpls"]);
});

test("Junos refuses an LSR ID other than the router ID, which LDP takes as its own", () => {
    const device = withMpls("platforms--example-aggregation-switch", { ldp: { lsr_id: "203.0.113.66", interfaces: ["10g-48"] } });

    expect(Platforms.get("junos").unsupported(device)).toContain(
        "routing.mpls.ldp.lsr_id 203.0.113.66, Junos takes the LSR ID from routing.router_id: write the same address in both"
    );
});

test("FortiOS, VRP, and Raisecom ROS refuse MPLS", () => {
    const device = withMpls("platforms--example-router", ROUTER);

    expect(Platforms.get("fortios").unsupported({ ...device, platform: "fortios", model: "FG-3700D" })).toContain(
        "routing.mpls, FortiOS has no MPLS"
    );
    for (const platform of ["vrp", "raisecom-ros"])
        expect(Platforms.get(platform).unsupported({ ...device, platform } as Device)).toContain("routing.mpls, not built yet");
});

test("the LSR ID is the address of a loopback that OSPF or IS-IS announces", () => {
    expect(errors(withMpls("platforms--example-router", ROUTER))).toEqual([]);

    expect(errors(withMpls("platforms--example-router", { ldp: { lsr_id: "192.0.2.254", interfaces: ["uplink"] } }))).toContain(
        "routing.mpls.ldp.lsr_id 192.0.2.254 is no address of a loopback, and LDP sessions run between LSR IDs. Write the address of a loopback, such as 192.0.2.255"
    );

    const unannounced = { ...Fixtures.device("platforms--example-router") };
    unannounced.routing = { ...unannounced.routing, mpls: ROUTER };
    expect(errors(unannounced)).toContain(
        "routing.mpls.ldp.lsr_id 192.0.2.255 is on loopback loopback, which neither OSPF nor IS-IS announces, so other LDP routers can't reach it. Add loopback to routing.isis.interfaces, or to an area of routing.ospf, with passive: true"
    );
});

test("an LDP interface is a link in the main table, with an IPv4 address, and listed once", () => {
    const device = withMpls("platforms--example-router", {
        ldp: { lsr_id: "192.0.2.255", interfaces: ["uplink", "uplink", "loopback", "guests"] },
    });

    expect(errors(device)).toEqual([
        "routing.mpls.ldp.interfaces uplink is listed twice. Remove one",
        "routing.mpls.ldp.interfaces loopback is a loopback, and LDP runs on links to other routers. Remove it",
        "routing.mpls.ldp.interfaces guests routes in VRF guests, and MPLS runs in the main table. Remove it",
    ]);

    const switchDevice = withMpls("platforms--example-aggregation-switch", { ldp: { lsr_id: "203.0.113.65", interfaces: ["40g-1"] } });
    expect(errors(switchDevice)).toContain(
        "routing.mpls.ldp.interfaces 40g-1 has no IPv4 address, which LDP needs to find its neighbors. Give it one, or remove it"
    );
});

test("a targeted LDP session runs to another router's LSR ID, listed once", () => {
    expect(errors(withMpls("platforms--example-router", { ldp: { ...ROUTER.ldp, targets: ["192.0.2.2", "192.0.2.3"] } }))).toEqual([]);

    const device = withMpls("platforms--example-router", {
        ldp: { ...ROUTER.ldp, targets: ["192.0.2.2", "192.0.2.2", "192.0.2.255", "192.0.2.256"] },
    });
    expect(errors(device)).toEqual([
        "routing.mpls.ldp.targets 192.0.2.2 is listed twice. Remove one",
        "routing.mpls.ldp.targets 192.0.2.255 is this router's own LSR ID. Write the far router's",
        "routing.mpls.ldp.targets 192.0.2.256 is not an IPv4 address. Write the far router's LSR ID, such as 192.0.2.2",
    ]);
});

test("a target that is another of our routers has a target back there, which RouterOS needs before it answers", async () => {
    const devices = await Fixtures.example("mpls-core");
    const pe01 = devices["pe-01"]!;
    const pe03 = devices["pe-03"]!;
    const crossErrors = (network: Device[]) =>
        Checks.run(network, undefined)
            .filter((finding) => finding.level === "error")
            .map((finding) => `${finding.device}: ${finding.message}`);
    expect(crossErrors([pe01, devices["pe-02"]!, pe03])).toEqual([]);

    const oneWay = { ...pe03, routing: { ...pe03.routing, mpls: { ldp: { ...pe03.routing!.mpls!.ldp, targets: [] } } } };
    expect(crossErrors([pe01, devices["pe-02"]!, oneWay])).toEqual([
        "pe-01: routing.mpls.ldp.targets 10.255.0.3 is pe-03's LSR ID, and pe-03 has no target back to 10.255.0.1, so it may ignore this router's targeted hellos. Write 10.255.0.1 in its routing.mpls.ldp.targets",
    ]);
});

test("RouterOS writes each target as a static LDP neighbor that sends targeted hellos, and removes only those it wrote", () => {
    const routeros = Platforms.get("routeros");
    const device = withMpls("platforms--example-router", { ldp: { ...ROUTER.ldp, targets: ["192.0.2.2"] } });
    const desired = routeros.render(device);
    const without = routeros.render(withMpls("platforms--example-router", ROUTER));

    expect(desired).toContain("/mpls ldp neighbor\nadd send-targeted=yes transport=192.0.2.2\n");
    expect(sent("routeros", desired, without)).toEqual(["/mpls ldp neighbor add send-targeted=yes transport=192.0.2.2"]);
    // LDP lists the neighbors it finds beside those it was told, and refuses to remove one it found.
    expect(sent("routeros", without, desired)).toEqual(["/mpls ldp neighbor remove [ find transport=192.0.2.2 and !dynamic ]"]);
    expect(sent("routeros", desired, desired)).toEqual([]);
});

test("Junos refuses targeted LDP while its MPLS is experimental", () => {
    const device = withMpls("platforms--example-aggregation-switch", {
        ldp: { lsr_id: "203.0.113.65", interfaces: ["10g-48"], targets: ["203.0.113.66"] },
    });

    expect(Platforms.get("junos").unsupported(device)).toContain(
        "routing.mpls.ldp.targets, not built for Junos yet: its MPLS is experimental, untested on a router that runs it"
    );
});

/** The example router with LDP's policies, and the policies and prefix sets they use beside its own. */
function withLdpPolicies(ldp: Pick<Mpls["ldp"], "import_policy" | "export_policy">, policies: Record<string, PolicyRule[]>): Device {
    const device = withMpls("platforms--example-router", { ldp: { ...ROUTER.ldp, ...ldp } });
    const routing = device.routing!;
    return {
        ...device,
        routing: {
            ...routing,
            policies: { ...routing.policies, ...policies },
            prefix_sets: { ...routing.prefix_sets, loopbacks: { prefixes: ["192.0.2.0/24", "2001:db8::/32"] } },
        },
    };
}

/** What RouterOS refuses of a device's policies that LDP uses, without what it refuses of the example router itself. */
const ldpGaps = (device: Device) =>
    Platforms.get("routeros")
        .unsupported(device)
        .filter((refused) => refused.includes("LDP"));

/** Labels for the loopbacks, which a policy LDP calls holds. */
const LOOPBACKS: Record<string, PolicyRule[]> = {
    loopbacks: [{ if: { prefix_set: "loopbacks" }, then: "accept" }],
    own: [{ if: { prefix: "192.0.2.255/32" }, then: "accept" }, { call: "loopbacks" }, { if: { family: "ipv6" }, then: "accept" }],
};

test("an LDP policy matches a label's prefix only, and sets nothing, nor does a policy it calls", () => {
    expect(errors(withLdpPolicies({ import_policy: "loopbacks", export_policy: "own" }, LOOPBACKS))).toEqual([]);

    const device = withLdpPolicies(
        { export_policy: "labels" },
        {
            labels: [{ if: { prefix_set: "loopbacks", as_path_length: { max: 2 } }, then: "accept" }, { call: "more" }],
            more: [{ set: { local_pref: 200 }, then: "accept" }],
        }
    );
    expect(errors(device)).toEqual([
        "routing.mpls.ldp.export_policy labels: routing.policies.labels[0].if has as_path_length, and an LDP label has only a prefix. Match family, prefix, prefix_set, prefix_length",
        'routing.mpls.ldp.export_policy labels: routing.policies.more[0].set, and an LDP label has nothing to set. Remove set, and write then: "accept" or "reject"',
    ]);
});

test("RouterOS writes an LDP policy as label filters in its order, a called policy's in its place, and a last filter that rejects the rest", () => {
    const routeros = Platforms.get("routeros");
    const device = withLdpPolicies({ import_policy: "loopbacks", export_policy: "own" }, LOOPBACKS);
    expect(ldpGaps(device)).toEqual([]);

    const desired = routeros.render(device);
    // IPv6 has no labels: LDP runs for IPv4 only.
    expect(desired).toContain("/mpls ldp accept-filter\nadd accept=yes prefix=192.0.2.0/24\nadd accept=no prefix=0.0.0.0/0\n");
    expect(desired).toContain(
        "/mpls ldp advertise-filter\nadd advertise=yes prefix=192.0.2.255/32\nadd advertise=yes prefix=192.0.2.0/24\nadd advertise=no prefix=0.0.0.0/0\n"
    );

    const decided = withLdpPolicies({ export_policy: "all" }, { all: [{ if: { family: "ipv4" }, then: "accept" }] });
    expect(routeros.render(decided)).toContain("/mpls ldp advertise-filter\nadd advertise=yes prefix=0.0.0.0/0\n/");
});

test("RouterOS refuses an LDP policy's rule that a label filter can't hold", () => {
    const device = withLdpPolicies(
        { import_policy: "labels" },
        {
            labels: [
                { if: { prefix: "192.0.2.0/24" }, then: "accept" },
                { if: { prefix: "192.0.2.1/32", prefix_set: "loopbacks" }, then: "accept" },
                { if: { prefix_length: { max: 32 } }, then: "accept" },
                { call: "fetched" },
            ],
            fetched: [{ if: { prefix_set: "upstream-origins" }, then: "reject" }],
        }
    );

    expect(ldpGaps(device)).toEqual([
        "routing.policies.labels[0].if.prefix 192.0.2.0/24 in an LDP policy: a RouterOS label filter matches the prefixes inside it too. Write a prefix set, which matches so",
        "routing.policies.labels[1].if, prefix and prefix_set at once in an LDP policy: a RouterOS label filter matches one prefix",
        "routing.policies.labels[2].if.prefix_length in an LDP policy: a RouterOS label filter matches a prefix only",
        "routing.policies.fetched[0].if.prefix_set upstream-origins, from a registry, in an LDP policy: RouterOS writes a label filter for each prefix. Write the prefixes",
    ]);
});

test("Junos refuses LDP's policies while its MPLS is experimental", () => {
    const device = withMpls("platforms--example-aggregation-switch", {
        ldp: { lsr_id: "203.0.113.65", interfaces: ["10g-48"], import_policy: "labels", export_policy: "labels" },
    });

    expect(Platforms.get("junos").unsupported(device)).toEqual(
        expect.arrayContaining([
            "routing.mpls.ldp.import_policy, not built for Junos yet: its MPLS is experimental, untested on a router that runs it",
            "routing.mpls.ldp.export_policy, not built for Junos yet: its MPLS is experimental, untested on a router that runs it",
        ])
    );
});

test("RouterOS rewrites the label filters in order, then restarts LDP so its sessions take them, and leaves it running when they don't change", () => {
    const routeros = Platforms.get("routeros");
    const device = withLdpPolicies({ export_policy: "own" }, LOOPBACKS);
    const desired = routeros.render(device);
    const without = routeros.render({ ...device, routing: { ...device.routing, mpls: { ldp: ROUTER.ldp } } });

    const restart = [
        "/mpls ldp set [ find (vrf=main or !vrf) ] disabled=yes",
        ":local waited 0; :while ([:len [/mpls ldp neighbor find where dynamic]] > 0 and $waited < 15) do={ :delay 1s; :set waited ($waited + 1) }",
        "/mpls ldp set [ find (vrf=main or !vrf) ] disabled=no",
    ];
    expect(sent("routeros", desired, without)).toEqual([
        ":global frameworkOldRules [/mpls ldp advertise-filter find]",
        "/mpls ldp advertise-filter add advertise=yes prefix=192.0.2.255/32",
        "/mpls ldp advertise-filter add advertise=yes prefix=192.0.2.0/24",
        "/mpls ldp advertise-filter add advertise=no prefix=0.0.0.0/0",
        ':global frameworkOldRules; /mpls ldp advertise-filter remove $frameworkOldRules; /system script environment remove [find name="frameworkOldRules"]',
        ...restart,
    ]);
    expect(sent("routeros", without, desired).slice(-restart.length)).toEqual(restart);

    // As a CHR printed them, after a restart that left `disabled=no` on the instance.
    const printed = desired.replace("add afi=ip lsr-id=", "add afi=ip disabled=no lsr-id=");
    expect(sent("routeros", desired, printed)).toEqual([]);
    const noMpls = routeros.render({ ...device, routing: { ...device.routing, mpls: undefined } });
    expect(sent("routeros", noMpls, desired).filter((line) => line.includes("disabled="))).toEqual([]);
});
