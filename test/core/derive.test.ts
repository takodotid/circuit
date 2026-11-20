import { expect, test } from "bun:test";
import { Derive } from "../../src/core/derive";
import type { Device } from "../../src/model";

type Routing = NonNullable<Device["routing"]>;

/** A router of AS64500 that originates one IPv4 and one IPv6 block, with these neighbors, policies, and aggregates. */
function router(
    bgp: Pick<NonNullable<Routing["bgp"]>, "neighbors" | "neighbor_groups" | "aggregates">,
    policies: Routing["policies"]
): Device {
    return {
        name: "edge-01",
        site: "lab",
        platform: "routeros",
        model: "CHR",
        connection: { host: "192.0.2.10", user: "operator" },
        routing: {
            prefix_sets: { ours: { prefixes: { v4: "198.51.100.0/24", v6: "2001:db8:100::/48" } } },
            policies,
            bgp: { asn: 64500, originated_prefixes: ["198.51.100.0/24", "2001:db8:100::/48"], ...bgp },
        },
    };
}

const OURS = { if: { prefix_set: "ours" }, then: "accept" } as const;
const NOTHING_ELSE = { then: "reject" } as const;

test("a neighbor gets what its export accepts, in the families its session carries, and nothing without an export", () => {
    const device = router(
        {
            neighbor_groups: { "route-servers": { address_families: ["ipv4", "ipv6"], export_policy: "exchange-export" } },
            neighbors: {
                "hurricane-electric": { address: "203.0.113.1", remote_as: 6939, export_policy: "export" },
                "de-cix-rs": { address: "192.0.2.1", neighbor_group: "route-servers" },
                "no-export": { address: "192.0.2.5", remote_as: 64501 },
            },
        },
        {
            export: [OURS, NOTHING_ELSE],
            "exchange-export": [{ if: { family: "ipv4" }, then: "reject" }, { call: "export" }],
        }
    );

    expect(Derive.announcements(device)).toEqual([
        { neighbor: "hurricane-electric", prefix: "198.51.100.0/24" },
        { neighbor: "de-cix-rs", prefix: "2001:db8:100::/48" },
    ]);
});

test("send_default_route sends a default route in each family, whatever the export says", () => {
    const device = router(
        {
            neighbors: {
                customer: {
                    address: "192.0.2.2",
                    remote_as: 64501,
                    address_families: ["ipv4", "ipv6"],
                    export_policy: "none",
                    send_default_route: true,
                },
            },
        },
        { none: [NOTHING_ELSE] }
    );

    expect(Derive.announcements(device)).toEqual([
        { neighbor: "customer", prefix: "0.0.0.0/0" },
        { neighbor: "customer", prefix: "::/0" },
    ]);
});

test("a community rule before the accept doesn't match a route that carries none, until a rule adds one", () => {
    // As a communities export writes out: rejects on requests, then our communities taken off.
    const requests = [
        { if: { large_community: "64500:1:0" }, then: "reject" },
        { if: { standard_community: "64500:*" }, then: "reject" },
        { set: { remove_large_communities: ["64500:*:*"] } },
    ] as const;
    const tagged = [{ set: { add_large_communities: ["64500:2:1"] } }, ...requests] as const;
    const device = router(
        {
            neighbors: {
                plain: { address: "203.0.113.1", remote_as: 6939, export_policy: "requests" },
                tagged: { address: "192.0.2.1", remote_as: 64501, export_policy: "tagged" },
            },
        },
        { requests: [...requests, OURS, NOTHING_ELSE], tagged: [...tagged, OURS, NOTHING_ELSE] }
    );

    expect(Derive.announcements(device)).toEqual([{ neighbor: "plain", prefix: "198.51.100.0/24" }]);
    expect(Derive.exportOf(device, "tagged", "198.51.100.0/24", "originated")).toBe("unknown");
});

test("an export decided by what the config can't tell sends nothing a check could wait for", () => {
    const device = router(
        { neighbors: { transit: { address: "203.0.113.1", remote_as: 6939, export_policy: "export" } } },
        {
            export: [{ if: { as_path_length: { max: 0 } }, then: "accept" }, { if: { rpki: "valid" }, then: "accept" }, NOTHING_ELSE],
        }
    );

    expect(Derive.exportOf(device, "export", "198.51.100.0/24", "originated")).toBe("unknown");
    expect(Derive.announcements(device)).toEqual([]);
});

test("an aggregate the export accepts is sent, and summary_only holds back the prefixes inside it", () => {
    const device = router(
        {
            aggregates: [{ prefix: "2001:db8::/32", summary_only: true }],
            neighbors: {
                transit: { address: "203.0.113.1", remote_as: 6939, address_families: ["ipv4", "ipv6"], export_policy: "export" },
            },
        },
        { export: [{ if: { prefix_length: { max: 32 } }, then: "accept" }, NOTHING_ELSE] }
    );

    expect(Derive.announcements(device)).toEqual([
        { neighbor: "transit", prefix: "198.51.100.0/24" },
        { neighbor: "transit", prefix: "2001:db8::/32" },
    ]);
});

test("an address shares a network of its VRF, a peer address too, and is unknown beside a DHCP client", () => {
    const base = router({}, {});
    const device: Device = {
        ...base,
        interfaces: {
            ethernet: {
                "virtual-1": { addresses: [{ address: "192.0.2.1/32", peer_address: "192.0.2.9" }, "2001:db8::1/64"] },
                "virtual-2": { dhcp_client: {}, vrf: "isp" },
            },
        },
        routing: { ...base.routing, vrfs: { isp: {} } },
    };

    expect(Derive.sharesNetwork(device, "192.0.2.9", undefined)).toBe(true);
    expect(Derive.sharesNetwork(device, "2001:db8::2", undefined)).toBe(true);
    expect(Derive.sharesNetwork(device, "192.0.2.2", undefined)).toBe(false);
    expect(Derive.sharesNetwork(device, "fe80::2%virtual-2", "isp")).toBe(true);
    expect(Derive.sharesNetwork(device, "192.0.2.9", "isp")).toBeUndefined();
    expect(Derive.sharesNetwork(device, "2001:db8::2", "isp")).toBe(false);
});

test("a pool gives each address the same number of subscribers, in address order, each with the next block of ports from 1024", () => {
    const addresses = Derive.poolAddresses({
        if: { src: "100.64.0.0/22" },
        then: "snat",
        to_pool: "198.51.100.0/27",
        port_allocation: "deterministic",
        port_set_size: 2016,
    });

    expect(addresses).toHaveLength(32);
    expect(addresses.every(({ blocks }) => blocks.length === 32)).toBe(true);
    expect(addresses[0]!.subscribers).toBe("100.64.0.0/27");
    expect(addresses[0]!.blocks.slice(0, 2)).toEqual([
        { subscriber: "100.64.0.0", ports: { min: 1024, max: 3039 } },
        { subscriber: "100.64.0.1", ports: { min: 3040, max: 5055 } },
    ]);
    expect(addresses[0]!.blocks.at(-1)).toEqual({ subscriber: "100.64.0.31", ports: { min: 63520, max: 65535 } });
    expect(addresses[31]).toMatchObject({ address: "198.51.100.31", subscribers: "100.64.3.224/27" });
    expect(addresses[31]!.blocks.at(-1)).toEqual({ subscriber: "100.64.3.255", ports: { min: 63520, max: 65535 } });
});
