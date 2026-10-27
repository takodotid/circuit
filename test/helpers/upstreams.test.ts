// Upstreams written once, and each device's part built from them: every name written in the catalog, policies as plain rule arrays with what they share through mapImports and mapExports, and a router and a switch built from one catalog that pass validate and render.

import { expect, test } from "bun:test";
import { defineDevice, defineNetwork, secret } from "../../src/core/define";
import { Validator } from "../../src/core/validator";
import { Bgp, Checks, Upstreams } from "../../src/helpers";
import { Platforms } from "../../src/platforms";

const OURS = [
    { prefix: "198.51.100.0/24", description: "Our IPv4" },
    { prefix: "2001:db8:100::/48", description: "Our IPv6" },
] as const;

const communities = Bgp.communityScheme({ asn: 64500, do_not_announce: 100 });

const upstreams = Upstreams.define(
    {
        transit_a: {
            name: "Transit A",
            asn: 64510,
            role: "provider",
            handoff: {
                vlan: { name: "transit-a", id: 3001 },
                native: { name: "transit-a-native", id: 3901 },
                interface: "uplink-transit-a",
                addresses: ["203.0.113.2/30", "2001:db8:1::2/64"],
                port: { device: "switch-1", port: "10g-4" },
            },
            sessions: { "transit-a": { address: "203.0.113.1" }, "transit-a-v6": { address: "2001:db8:1::1" } },
            limits: { ipv4: 1_200_000, ipv6: 300_000 },
            import: { name: "TRANSIT-A-IN", rules: Bgp.defaultOnly({ local_pref: 100, description: "Transit A default", reject: true }) },
            export: { name: "TRANSIT-A-OUT", rules: Bgp.announce(OURS) },
            drop_private: true,
        },
        ix_b: {
            name: "IX B",
            asn: 64511,
            role: "rs",
            handoff: {
                vlan: { name: "ix-b", id: 3002 },
                interface: "uplink-ix-b",
                addresses: ["192.0.2.10/24"],
                port: { device: "switch-1", port: "10g-5", lldp: true },
                exchange: { name: "IX B", speed: 10_000, peeringdb_ixlan: 1234 },
            },
            sessions: { "ix-b-rs1": { address: "192.0.2.1" }, "ix-b-rs2": { address: "192.0.2.2" } },
            group: "ix-b",
            limits: { ipv4: 50_000 },
            import: { name: "IX-B-IN", rules: [{ set: { local_pref: 200 } }, { action: "accept" }] },
            export: { name: "IX-B-OUT", rules: Bgp.announce(OURS) },
        },
        peer_c: {
            name: "Peer C",
            asn: 64512,
            role: "peer",
            tunnel: { interface: "gre-peer-c", local: "198.51.100.1", remote: "192.0.2.200", addresses: ["10.255.0.1/30"] },
            sessions: { "peer-c": { address: "10.255.0.2" } },
            export: { name: "PEER-C-OUT", rules: Bgp.announce([OURS[0]]) },
        },
    },
    {
        mapImports: (rules) => [{ call: "SANITY" }, ...rules],
        mapExports: (rules, _, upstream) => [...communities.actions(upstream.asn), ...rules],
    }
);

const users = { operator: { role: "admin" as const, password: secret("PASSWORD") } };

const router = defineDevice({
    name: "router-1",
    platform: "routeros",
    model: "CCR2216-1G-12XS-2XQ",
    connection: { host: "10.0.0.1", user: "operator" },
    users,
    vlans: upstreams.vlans(),
    ports: {
        "1g-1": { addresses: ["10.0.0.1/24"] },
        "25g-1": { trunk_vlans: upstreams.vlansOn("switch-1"), link: { device: "switch-1", port: "10g-1" } },
    },
    interfaces: { ...upstreams.interfaces() },
    routing: {
        router_id: "203.0.113.2",
        bgp: { asn: 64500, groups: upstreams.groups(), neighbors: upstreams.neighbors() },
    },
    policies: { SANITY: Bgp.sanity(), ...upstreams.policies() },
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
        nat: { source: upstreams.uplinks().map((uplink) => ({ match: { out_interface: uplink }, action: "masquerade" as const })) },
    },
});

const switchDevice = defineDevice({
    name: "switch-1",
    platform: "vrp",
    model: "CE6855-48S6Q-HI",
    connection: { host: "10.0.0.2", user: "operator" },
    users,
    lldp: true,
    vlans: upstreams.vlans("switch-1"),
    ports: {
        "10g-1": { trunk_vlans: upstreams.vlansOn("switch-1"), link: { device: "router-1", port: "25g-1" } },
        ...upstreams.ports("switch-1"),
    },
});

test("every name a device carries is the one the catalog writes", () => {
    expect(upstreams.vlans()).toEqual({
        "transit-a": { id: 3001, description: "Transit A" },
        "transit-a-native": { id: 3901, description: "Native toward Transit A, nothing else in it" },
        "ix-b": { id: 3002, description: "IX B" },
    });
    // With a device or without, the same set: the natives come along.
    expect(upstreams.vlans("switch-1")).toEqual(upstreams.vlans());
    expect(Object.keys(upstreams.interfaces())).toEqual(["uplink-transit-a", "uplink-ix-b", "gre-peer-c"]);
    expect(upstreams.uplinks()).toEqual(["uplink-transit-a", "uplink-ix-b"]);
    expect(Object.keys(upstreams.groups())).toEqual(["ix-b"]);
    expect(Object.keys(upstreams.policies())).toEqual(["TRANSIT-A-IN", "TRANSIT-A-OUT", "IX-B-IN", "IX-B-OUT", "PEER-C-OUT"]);
    expect(upstreams.untrusted()).toEqual(["transit-a", "ix-b", "transit-a-native"]);
    expect(upstreams.privateDrops()).toEqual(["transit-a"]);

    const vlan: keyof ReturnType<typeof upstreams.vlans> = "transit-a-native";
    // @ts-expect-error A name the catalog doesn't write.
    const unknown: keyof ReturnType<typeof upstreams.vlans> = "transit_a";
    expect([vlan, unknown]).toHaveLength(2);
});

test("a policy is the upstream's rules, through mapImports or mapExports, and nothing else", () => {
    // Typed to fit any device's policies; the rules themselves are what the device gets.
    const policies = upstreams.policies() as Record<string, readonly unknown[]>;

    expect(policies["TRANSIT-A-IN"]).toEqual([
        { call: "SANITY" },
        ...Bgp.defaultOnly({ local_pref: 100, description: "Transit A default", reject: true }),
    ]);
    expect(policies["IX-B-IN"]).toEqual([{ call: "SANITY" }, { set: { local_pref: 200 } }, { action: "accept" }]);
    expect(policies["PEER-C-OUT"]).toEqual([...communities.actions(64512), ...Bgp.announce([OURS[0]])]);

    // Without the functions, the rules as written.
    const plain = Upstreams.define({
        a: { asn: 1, role: "peer", sessions: {}, export: { name: "A-OUT", rules: [{ action: "reject" }] } },
    });
    expect(plain.policies()).toEqual({ "A-OUT": [{ action: "reject" }] });
});

test("a session in a group names it; one without holds its upstream's settings and its family's limit", () => {
    expect(upstreams.neighbors()).toEqual({
        "transit-a": {
            remote_as: 64510,
            description: "Transit A",
            role: "provider",
            import: "TRANSIT-A-IN",
            export: "TRANSIT-A-OUT",
            address: "203.0.113.1",
            max_prefixes: 1_200_000,
        },
        "transit-a-v6": {
            remote_as: 64510,
            description: "Transit A",
            role: "provider",
            import: "TRANSIT-A-IN",
            export: "TRANSIT-A-OUT",
            address: "2001:db8:1::1",
            max_prefixes: 300_000,
        },
        "ix-b-rs1": { group: "ix-b", address: "192.0.2.1", max_prefixes: 50_000 },
        "ix-b-rs2": { group: "ix-b", address: "192.0.2.2", max_prefixes: 50_000 },
        "peer-c": { remote_as: 64512, description: "Peer C", role: "peer", export: "PEER-C-OUT", address: "10.255.0.2" },
    });
    expect(upstreams.groups()).toEqual({
        "ix-b": { remote_as: 64511, description: "IX B", role: "rs", import: "IX-B-IN", export: "IX-B-OUT" },
    });
});

test("a handoff port has LLDP and spanning tree off unless it says otherwise", () => {
    expect(upstreams.ports("switch-1")).toEqual({
        "10g-4": { description: "Transit A", trunk_vlans: ["transit-a"], native_vlan: "transit-a-native", lldp: false, stp: false },
        "10g-5": { description: "IX B", access_vlan: "ix-b", lldp: true, stp: false },
    });
    expect(upstreams.tunnelRules()).toEqual([
        { description: "GRE from Peer C", match: { protocol: "gre", src: "192.0.2.200/32" }, action: "accept" },
    ]);
});

test("the router and the switch built from it pass validate and render, imports and exports end in a decision", () => {
    const network = defineNetwork({
        devices: [router, switchDevice],
        checks: [
            Checks.trustBoundary({ untrusted: upstreams.untrusted(), routers: ["router-1"] }),
            Checks.nativeVlansAreDeadEnds,
            Checks.exportsEndInReject,
            Checks.importsEndInAcceptOrReject,
        ],
    });

    expect(
        Validator.run(network)
            .filter((finding) => finding.level === "error")
            .map((finding) => finding.message)
    ).toEqual([]);
    expect(Platforms.get("routeros").unsupported(router)).toEqual([]);
    expect(Platforms.get("vrp").unsupported(switchDevice)).toEqual([]);
    expect(Platforms.get("routeros").render(router)).toContain("name=uplink-transit-a vlan-id=3001");

    // An import that leaves the last word to the platform is found.
    const open = { ...router, policies: { ...router.policies, "IX-B-IN": [{ set: { local_pref: 200 } }] } };
    expect(Checks.importsEndInAcceptOrReject([open]).map((finding) => finding.message)).toEqual([
        "ix-b-rs1: import IX-B-IN does not end in an unconditional accept or reject",
        "ix-b-rs2: import IX-B-IN does not end in an unconditional accept or reject",
    ]);
});

test("a name two upstreams share is refused, and a misspelled key is named by the type", () => {
    const upstream = { asn: 1, role: "peer", sessions: {}, export: { name: "OUT", rules: [] } } as const;

    expect(() => Upstreams.define({ a: upstream, b: upstream })).toThrow("Upstreams: a and b both have the policy OUT");

    const misspelled = () =>
        // @ts-expect-error Object literal may only specify known properties, and 'limts' does not exist in type 'Upstream'.
        Upstreams.define({ a: { asn: 1, role: "peer", sessions: {}, export: { name: "OUT", rules: [] }, limts: {} } });
    const pps = Upstreams.define({
        a: {
            asn: 1,
            role: "rs",
            handoff: {
                vlan: { name: "v", id: 1 },
                interface: "i",
                addresses: [],
                port: { device: "s", port: "p", storm_control: { broadcast: { pps: 1000 } } },
            },
            sessions: {},
            export: { name: "OUT", rules: [] },
        },
    });

    expect(pps.ports("s").p?.storm_control).toEqual({ broadcast: { pps: 1000 } });
    expect(misspelled).toBeFunction();
});

test("Upstreams.catalog gives the catalog back as written, and refuses a misspelled key", () => {
    const catalog = Upstreams.catalog({
        ix_d: {
            asn: 64513,
            role: "rs",
            sessions: { "ix-d-rs1": { address: "192.0.2.50" } },
            export: { name: "IX-D-OUT", rules: Bgp.announce(OURS) },
            communities: { do_not_announce_to: (asn) => `64513:0:${asn}` },
        },
    });

    expect(Object.keys(catalog)).toEqual(["ix_d"]);
    expect(catalog.ix_d.asn).toBe(64513);

    // @ts-expect-error A key the shape doesn't have is refused.
    Upstreams.catalog({ ix_e: { asn: 64514, role: "rs", sessions: {}, export: { name: "IX-E-OUT", rules: [] }, comunities: {} } });
});

test("doNotAnnounceTo asks with the upstream's own community, one per AS, and refuses an upstream that has none", () => {
    const rs = { asn: 64513, role: "rs", sessions: {}, export: { name: "OUT", rules: [] } } as const;

    expect(
        Upstreams.doNotAnnounceTo({ ...rs, communities: { do_not_announce_to: (asn) => `64513:0:${asn}` } }, [64600, 64601], "Not to them")
    ).toEqual([{ description: "Not to them", set: { add_large_communities: ["64513:0:64600", "64513:0:64601"] } }]);
    expect(Upstreams.doNotAnnounceTo({ ...rs, communities: { do_not_announce_to: (asn) => `0:${asn}` } }, [64600], "Not to them")).toEqual([
        { description: "Not to them", set: { add_communities: ["0:64600"] } },
    ]);
    expect(Upstreams.doNotAnnounceTo(rs, [], "Not to them")).toEqual([]);
    expect(() => Upstreams.doNotAnnounceTo(rs, [64600], "Not to them")).toThrow("has no communities.do_not_announce_to");
});

test("an upstream's blackhole community reaches the scheme's actions through the upstream", () => {
    const scheme = Bgp.communityScheme({ asn: 64500, blackhole: { function: 666 } });
    const transit = { asn: 64510, communities: { blackhole: "65535:666" } } as const;

    expect(scheme.blackholeExport(transit)[0]).toMatchObject({
        description: "Blackhole passed on to AS64510",
        set: { add_communities: ["65535:666"] },
        action: "accept",
    });
    expect(scheme.blackholeExport(64511)[0]).toMatchObject({ description: "Blackholed here, never announced", action: "reject" });
});
