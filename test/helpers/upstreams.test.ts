// Upstreams written once, and each device's part built from them: a router and a switch built from one catalog pass validate, render, and keep untrusted VLANs behind the router.

import { expect, test } from "bun:test";
import { defineDevice, defineNetwork, secret } from "../../src/core/define";
import { Validator } from "../../src/core/validator";
import { Bgp, Checks, Upstreams } from "../../src/helpers";
import { Platforms } from "../../src/platforms";

const OURS = [
    { prefix: "198.51.100.0/24", description: "Our IPv4" },
    { prefix: "2001:db8:100::/48", description: "Our IPv6" },
] as const;

const upstreams = Upstreams.define({
    transit_a: {
        name: "Transit A",
        asn: 64510,
        role: "provider",
        handoff: {
            vlan: 3001,
            native: 3901,
            addresses: ["203.0.113.2/30", "2001:db8:1::2/64"],
            port: { device: "switch-1", port: "10g-4" },
        },
        sessions: { "transit-a": { address: "203.0.113.1" }, "transit-a-v6": { address: "2001:db8:1::1" } },
        limits: { ipv4: 1_200_000, ipv6: 300_000 },
        import: { default: { local_pref: 100, description: "Transit A default" } },
        announce: OURS,
        drop_private: true,
    },
    ix_b: {
        name: "IX B",
        asn: 64511,
        role: "rs",
        handoff: {
            vlan: 3002,
            addresses: ["192.0.2.10/24"],
            port: { device: "switch-1", port: "10g-5" },
            exchange: { name: "IX B", speed: 10_000, peeringdb_ixlan: 1234 },
        },
        sessions: { "ix-b-rs1": { address: "192.0.2.1" }, "ix-b-rs2": { address: "192.0.2.2" } },
        limits: { ipv4: 50_000 },
        import: { learn: { local_pref: 200 } },
        announce: OURS,
    },
    peer_c: {
        name: "Peer C",
        asn: 64512,
        role: "peer",
        tunnel: { local: "198.51.100.1", remote: "192.0.2.200", addresses: ["10.255.0.1/30"] },
        sessions: { "peer-c": { address: "10.255.0.2" } },
        import: { learn: { local_pref: 300 } },
        announce: [OURS[0]],
    },
});

const users = { operator: { role: "admin" as const, password: secret("PASSWORD") } };

const router = defineDevice({
    name: "router-1",
    platform: "routeros",
    model: "CCR2216-1G-12XS-2XQ",
    connection: { host: "10.0.0.1", user: "operator" },
    users,
    vlans: { ...upstreams.vlans() },
    ports: {
        "1g-1": { addresses: ["10.0.0.1/24"] },
        "25g-1": { trunk_vlans: upstreams.vlansOn("switch-1"), link: { device: "switch-1", port: "10g-1" } },
    },
    interfaces: { ...upstreams.interfaces() },
    routing: {
        router_id: "203.0.113.2",
        bgp: { asn: 64500, groups: upstreams.groups(), neighbors: upstreams.neighbors() },
    },
    policies: {
        SANITY: Bgp.sanity(),
        ...upstreams.policies({ sanity: "SANITY", tag: (_, upstream) => `64500:1:${upstream.asn}` as const, sources: ["203.0.113.2"] }),
    },
    firewall: {
        address_sets: { "bgp-neighbors": upstreams.addresses() },
        filter: {
            input: {
                default: "drop",
                rules: [
                    ...upstreams.tunnelRules(),
                    { description: "BGP", match: { protocol: "tcp", dst_port: 179, src_set: "bgp-neighbors" }, action: "accept" },
                ],
            },
        },
    },
});

const switchDevice = defineDevice({
    name: "switch-1",
    platform: "vrp",
    model: "CE6855-48S6Q-HI",
    connection: { host: "10.0.0.2", user: "operator" },
    users,
    vlans: { ...upstreams.vlans("switch-1") },
    ports: {
        "10g-1": { trunk_vlans: upstreams.vlansOn("switch-1"), link: { device: "router-1", port: "25g-1" } },
        ...upstreams.ports("switch-1"),
    },
});

test("names come from each key: VLANs, natives, interfaces, groups and policies", () => {
    expect(Object.keys(upstreams.vlans())).toEqual(["transit_a", "ix_b"]);
    expect(upstreams.vlans("switch-1")).toEqual({
        transit_a: { id: 3001, description: "Transit A" },
        "transit_a-native": { id: 3901, description: "Native toward Transit A, nothing else in it" },
        ix_b: { id: 3002, description: "IX B" },
    });
    expect(Object.keys(upstreams.interfaces())).toEqual(["transit_a", "ix_b", "peer_c"]);
    expect(Object.keys(upstreams.groups())).toEqual(["ix_b"]);
    expect(Object.keys(upstreams.policies())).toEqual(["TRANSIT_A-OUT", "TRANSIT_A-IN", "IX_B-OUT", "IX_B-IN", "PEER_C-OUT", "PEER_C-IN"]);
    expect(upstreams.untrusted()).toEqual(["transit_a", "ix_b", "transit_a-native"]);
    expect(upstreams.privateDrops()).toEqual(["transit_a"]);
});

test("a session takes its upstream's AS, role, policies and its family's limit, or its group", () => {
    expect(upstreams.neighbors()).toEqual({
        "transit-a": {
            address: "203.0.113.1",
            remote_as: 64510,
            description: "Transit A",
            role: "provider",
            import: "TRANSIT_A-IN",
            export: "TRANSIT_A-OUT",
            max_prefixes: 1_200_000,
        },
        "transit-a-v6": {
            address: "2001:db8:1::1",
            remote_as: 64510,
            description: "Transit A",
            role: "provider",
            import: "TRANSIT_A-IN",
            export: "TRANSIT_A-OUT",
            max_prefixes: 300_000,
        },
        "ix-b-rs1": { address: "192.0.2.1", group: "ix_b", max_prefixes: 50_000 },
        "ix-b-rs2": { address: "192.0.2.2", group: "ix_b", max_prefixes: 50_000 },
        "peer-c": {
            address: "10.255.0.2",
            remote_as: 64512,
            description: "Peer C",
            role: "peer",
            import: "PEER_C-IN",
            export: "PEER_C-OUT",
        },
    });
});

test("a transit's import takes only its default; an exchange's learns; every export announces ours and nothing else", () => {
    const policies = upstreams.policies({ sanity: "SANITY", sources: ["203.0.113.2"] });

    expect(policies["TRANSIT_A-IN"]).toEqual([
        ...Bgp.defaultOnly({ local_pref: 100, description: "Transit A default", sources: ["203.0.113.2"] }),
        { description: "Nothing else", action: "reject" },
    ]);
    expect(policies["IX_B-IN"]).toEqual(Bgp.learn({ sanity: "SANITY", sources: ["203.0.113.2"], local_pref: 200 }));
    expect(policies["PEER_C-OUT"]).toEqual(Bgp.announce([OURS[0]]));
    expect(Checks.exportsEndInReject([router])).toEqual([]);
});

test("the switch port takes the handoff, tagged with a native of its own or untagged, with no LLDP or spanning tree", () => {
    expect(upstreams.ports("switch-1")).toEqual({
        "10g-4": { description: "Transit A", trunk_vlans: ["transit_a"], native_vlan: "transit_a-native", lldp: false, stp: false },
        "10g-5": { description: "IX B", access_vlan: "ix_b", lldp: false, stp: false },
    });
    expect(upstreams.tunnelRules()).toEqual([
        { description: "GRE from Peer C", match: { protocol: "gre", src: "192.0.2.200/32" }, action: "accept" },
    ]);
});

test("the router and the switch built from it pass validate, render, and keep the handoffs behind the router", () => {
    const network = defineNetwork({
        devices: [router, switchDevice],
        checks: [Checks.trustBoundary({ untrusted: upstreams.untrusted(), routers: ["router-1"] }), Checks.nativeVlansAreDeadEnds],
    });

    expect(Validator.run(network).filter((finding) => finding.level === "error")).toEqual([]);
    expect(Platforms.get("routeros").unsupported(router)).toEqual([]);
    expect(Platforms.get("vrp").unsupported(switchDevice)).toEqual([]);
    expect(Platforms.get("routeros").render(router)).toContain("remote.address=203.0.113.1");
});

test("a key the shape does not have is refused at every level", () => {
    // @ts-expect-error `sesions` is not a field.
    const top = () => Upstreams.define({ a: { asn: 1, role: "peer", sesions: {}, sessions: {}, announce: [] } });
    const handoff = { vlan: 1, addresses: [], prot: {} } as const;
    // @ts-expect-error `prot` is not a field of a handoff.
    const nested = () => Upstreams.define({ a: { asn: 1, role: "peer", handoff, sessions: {}, announce: [] } });
    // A field whose shape is a union takes any member's keys, and only those.
    const port = { device: "switch-1", port: "10g-1" } as const;
    const pps = Upstreams.define({
        a: {
            asn: 1,
            role: "rs",
            handoff: { vlan: 1, addresses: [], port: { ...port, storm_control: { broadcast: { pps: 1000 } } } },
            sessions: {},
            announce: [],
        },
    });
    const percent = Upstreams.define({
        a: {
            asn: 1,
            role: "rs",
            handoff: { vlan: 1, addresses: [], port: { ...port, storm_control: { multicast: { percent: 1 } } } },
            sessions: {},
            announce: [],
        },
    });
    const threshold = { pss: 1000 } as const;
    const misspelledThreshold = () =>
        Upstreams.define({
            a: {
                asn: 1,
                role: "rs",
                // @ts-expect-error `pss` is in no member of a threshold.
                handoff: { vlan: 1, addresses: [], port: { ...port, storm_control: { broadcast: threshold } } },
                sessions: {},
                announce: [],
            },
        });
    expect(pps.ports("switch-1")["10g-1"]?.storm_control).toEqual({ broadcast: { pps: 1000 } });
    expect(percent.ports("switch-1")["10g-1"]?.storm_control).toEqual({ multicast: { percent: 1 } });
    expect(misspelledThreshold).toBeFunction();

    // @ts-expect-error `customer` is not a role an upstream has.
    const role = () => Upstreams.define({ a: { asn: 1, role: "customer", sessions: {}, announce: [] } });

    expect([top, nested, role]).toHaveLength(3);
});

/** A project's own naming: an owner, a role and a number on each interface, `-ipt` on a transit's VLAN, natives first, IMPORT and EXPORT. */
const named = Upstreams.define(
    {
        transita: {
            asn: 64510,
            role: "provider",
            handoff: { vlan: 3001, native: 3901, number: 1, addresses: ["203.0.113.2/30"], port: { device: "switch-1", port: "10g-4" } },
            sessions: { transita: { address: "203.0.113.1" } },
            import: { default: { local_pref: 100 } },
            announce: OURS,
        },
        exchangeb: {
            asn: 64511,
            role: "rs",
            handoff: { vlan: 3002, number: 2, addresses: ["192.0.2.10/24"], port: { device: "switch-1", port: "10g-5" } },
            sessions: { "exchangeb-rs1": { address: "192.0.2.1" } },
            import: { learn: { local_pref: 200 } },
            announce: OURS,
        },
        peerc: {
            asn: 64512,
            role: "peer",
            tunnel: { local: "198.51.100.1", remote: "192.0.2.200", addresses: ["10.255.0.1/30"], number: 3 },
            sessions: { peerc: { address: "10.255.0.2" } },
            announce: OURS,
        },
    },
    {
        names: {
            vlan: { provider: "{key}-ipt" },
            native: "native-{key}",
            interface: { provider: "core-ipt0{number}-{key}", rs: "core-ix0{number}-{key}", tunnel: "core-gre0{number}-{key}" },
            import: "{KEY}-IMPORT",
            export: "{KEY}-EXPORT",
            port: (key, upstream) => `${key.toUpperCase()}-${upstream.role === "provider" ? "IPTRANSIT" : "PEERING"}-10G`,
        },
    }
);

test("names of the project's own: per role, with the upstream's number, and literal types a device is checked against", () => {
    expect(named.vlans("switch-1")).toEqual({
        "transita-ipt": { id: 3001, description: "transita" },
        "native-transita": { id: 3901, description: "Native toward transita, nothing else in it" },
        exchangeb: { id: 3002, description: "exchangeb" },
    });
    expect(Object.keys(named.interfaces())).toEqual(["core-ipt01-transita", "core-ix02-exchangeb", "core-gre03-peerc"]);
    expect(named.uplinks()).toEqual(["core-ipt01-transita", "core-ix02-exchangeb"]);
    expect(Object.keys(named.policies())).toEqual([
        "TRANSITA-EXPORT",
        "TRANSITA-IMPORT",
        "EXCHANGEB-EXPORT",
        "EXCHANGEB-IMPORT",
        "PEERC-EXPORT",
    ]);
    expect(named.neighbors().transita).toMatchObject({ import: "TRANSITA-IMPORT", export: "TRANSITA-EXPORT" });
    expect(named.ports("switch-1")["10g-4"]).toEqual({
        description: "TRANSITA-IPTRANSIT-10G",
        trunk_vlans: ["transita-ipt"],
        native_vlan: "native-transita",
        lldp: false,
        stp: false,
    });

    const vlan: keyof ReturnType<typeof named.vlans> = "transita-ipt";
    // @ts-expect-error A transit's VLAN is `<key>-ipt` in this project.
    const plain: keyof ReturnType<typeof named.vlans> = "transita";
    const iface: ReturnType<typeof named.uplinks>[number] = "core-ix02-exchangeb";
    // @ts-expect-error An exchange's interface is `core-ix0<number>-<key>`.
    const wrongRole: ReturnType<typeof named.uplinks>[number] = "core-ipt02-exchangeb";
    const policy: keyof ReturnType<typeof named.policies> = "EXCHANGEB-IMPORT";
    // @ts-expect-error peerc has no import, so no import policy.
    const noImport: keyof ReturnType<typeof named.policies> = "PEERC-IMPORT";

    expect([vlan, plain, iface, wrongRole, policy, noImport]).toHaveLength(6);
});

test("a name two upstreams share, or a {number} an upstream does not have, is refused", () => {
    const upstream = { asn: 1, role: "provider", handoff: { vlan: 1, addresses: [] }, sessions: {}, announce: [] } as const;

    expect(() =>
        Upstreams.define({ a: upstream, b: { ...upstream, handoff: { vlan: 2, addresses: [] } } }, { names: { vlan: "transit" } })
    ).toThrow("Upstreams: a and b both have the vlan name transit");
    expect(() => Upstreams.define({ a: upstream }, { names: { interface: "core-ipt0{number}-{key}" } })).toThrow(
        "Upstreams: a needs a number for interface name core-ipt0{number}-{key}"
    );
    // @ts-expect-error `vlans` is not a name Upstreams makes.
    const misspelled = () => Upstreams.define({ a: upstream }, { names: { vlans: "x" } });

    expect(misspelled).toBeFunction();
});

test("a router built with the project's own names passes validate", () => {
    const core = defineDevice({
        name: "core-1",
        platform: "routeros",
        model: "CCR2216-1G-12XS-2XQ",
        connection: { host: "10.0.0.1", user: "operator" },
        users,
        vlans: { ...named.vlans() },
        ports: { "1g-1": { addresses: ["10.0.0.1/24"] }, "25g-1": { trunk_vlans: named.vlansOn("switch-1") } },
        interfaces: { ...named.interfaces() },
        routing: { router_id: "203.0.113.2", bgp: { asn: 64500, groups: named.groups(), neighbors: named.neighbors() } },
        policies: { ...named.policies() },
        firewall: {
            nat: { source: named.uplinks().map((uplink) => ({ match: { out_interface: uplink }, action: "masquerade" as const })) },
        },
    });

    expect(Validator.run(defineNetwork({ devices: [core] })).filter((finding) => finding.level === "error")).toEqual([]);
    expect(Platforms.get("routeros").render(core)).toContain("name=core-ipt01-transita vlan-id=3001");
});
