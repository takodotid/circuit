import { expect, test } from "bun:test";
import { Checks } from "../../src/checks";
import type { Device } from "../../src/model";
import { Fixtures } from "../fixtures";

const router = Fixtures.device("platforms--example-router");

const messages = (device: Device) => Checks.run([device], undefined).map((finding) => finding.message);

test("a MAC limit is a whole number above 0, and an ethertype filter lets each kind in once", () => {
    const [port, settings] = Object.entries(router.interfaces?.ethernet ?? {})[0]!;
    const device: Device = {
        ...router,
        interfaces: {
            ...router.interfaces,
            ethernet: { ...router.interfaces?.ethernet, [port]: { ...settings, mac_limit: 0, ethertypes: ["ipv4", "ipv4"] } },
            lag: { ...router.interfaces?.lag, members: { mac_limit: 1.5, ethertypes: [] } },
        },
    };

    expect(messages(device)).toEqual(
        expect.arrayContaining([
            `interfaces.ethernet.${port}.mac_limit 0 is not a whole number above 0`,
            `interfaces.ethernet.${port}.ethertypes lists a kind twice`,
            "interfaces.lag.members.mac_limit 1.5 is not a whole number above 0",
            "interfaces.lag.members.ethertypes is empty, so it would drop every frame",
        ])
    );
});

test("a bound port is an access port, with each MAC address and each address written once and well", () => {
    const [port, settings] = Object.entries(router.interfaces?.ethernet ?? {})[0]!;
    const device: Device = {
        ...router,
        interfaces: {
            ...router.interfaces,
            ethernet: {
                ...router.interfaces?.ethernet,
                [port]: {
                    ...settings,
                    bound_to: [
                        { mac: "02:00:00:00:00:01", addresses: ["192.0.2.10", "192.0.2.9/29", "fe80::1"] },
                        { mac: "02:00:00:00:00:01", addresses: ["192.0.2.10"] },
                        { mac: "01:00:5e:00:00:01", addresses: [] },
                        { mac: "02:00:00:00:00:0g", addresses: [] },
                    ],
                },
            },
            lag: { ...router.interfaces?.lag, members: { access_vlan: "lan", bound_to: [] } },
        },
    };
    const where = `interfaces.ethernet.${port}.bound_to`;

    expect(messages(device)).toEqual(
        expect.arrayContaining([
            `${where} is on a port that is not an access port: bind the hosts of one VLAN`,
            `${where}[0].addresses 192.0.2.9/29 has bits past its length: write 192.0.2.8/29`,
            `${where}[0].addresses fe80::1 is link-local, which a bound host may always send from`,
            `${where}[1].mac 02:00:00:00:00:01 is listed twice`,
            `${where}[1].addresses 192.0.2.10 is listed twice on the port`,
            `${where}[2].mac 01:00:5e:00:00:01 is a multicast address, which no host sends from`,
            `${where}[3].mac '02:00:00:00:00:0g' is not a MAC address, such as 02:00:00:00:00:01`,
            "interfaces.lag.members.bound_to is empty, so it would drop every frame",
        ])
    );
});

test("a static route with bfd needs next_hop, the address BFD watches", () => {
    const viaInterface: Device = {
        ...router,
        routing: { ...router.routing, static_routes: [{ prefix: "198.51.100.128/25", interface: "uplink", bfd: true }] },
    };

    expect(messages(viaInterface)).toContain("routing.static_routes 198.51.100.128/25 has bfd without next_hop, the address BFD watches");
});

test("a next hop with an interface after % says where the interface goes", () => {
    const device: Device = {
        ...router,
        routing: { ...router.routing, static_routes: [{ prefix: "::/0", next_hop: "fe80::1%ether1" }] },
    };

    expect(messages(device)).toContain(
        'routing.static_routes ::/0 next_hop fe80::1%ether1 has an interface after %. Write next_hop: "fe80::1", and the interface in interface'
    );
});

// A blackhole route drops the traffic, so a next hop or an interface beside it says the opposite.
test("a blackhole route has neither next_hop nor interface", () => {
    const routes: Device["routing"] = {
        ...router.routing,
        static_routes: [
            { prefix: "198.51.100.0/24", blackhole: true, next_hop: "192.0.2.1" },
            { prefix: "198.51.100.0/25", blackhole: true, interface: "uplink" },
            { prefix: "2001:db8::/32", blackhole: true, next_hop: "2001:db8:1::1", interface: "uplink" },
            { prefix: "203.0.113.0/24", blackhole: true },
        ],
    };
    const firewall = Fixtures.device("platforms--example-firewall");
    const management: NonNullable<Device["system"]>["vdoms"] = {
        management: { name: "mgmt", interfaces: ["1g-1"], static_routes: [{ prefix: "0.0.0.0/0", blackhole: true, interface: "1g-1" }] },
    };

    const found = [
        ...messages({ ...router, routing: routes }),
        ...messages({ ...firewall, system: { ...firewall.system, vdoms: management } }),
    ].filter((message) => message.includes("blackhole"));

    expect(found).toEqual([
        "routing.static_routes 198.51.100.0/24 has blackhole with next_hop. Remove next_hop to drop the traffic, or remove blackhole to forward it",
        "routing.static_routes 198.51.100.0/25 has blackhole with interface. Remove interface to drop the traffic, or remove blackhole to forward it",
        "routing.static_routes 2001:db8::/32 has blackhole with next_hop and interface. Remove next_hop and interface to drop the traffic, or remove blackhole to forward it",
        "system.vdoms.management.static_routes 0.0.0.0/0 has blackhole with interface. Remove interface to drop the traffic, or remove blackhole to forward it",
    ]);
});

// GTSM accepts only TTL 255, which a packet from more than one hop away never has.
test("ttl_security with multihop is an error, once at a group that has both", () => {
    const bgp = router.routing!.bgp!;
    const device: Device = {
        ...router,
        routing: {
            ...router.routing,
            bgp: {
                ...bgp,
                neighbor_groups: { ...bgp.neighbor_groups, controllers: { remote_as: 64512, multihop: true, ttl_security: true } },
                neighbors: {
                    ...bgp.neighbors,
                    "controller-1": { address: "198.51.100.7", neighbor_group: "controllers" },
                    "controller-2": { address: "198.51.100.8", neighbor_group: "controllers", multihop: false },
                    cogent: { address: "203.0.113.5", neighbor_group: "upstream", multihop: true, ttl_security: true },
                },
            },
        },
    };

    expect(messages(device).filter((message) => message.includes("ttl_security"))).toEqual([
        "routing.bgp.neighbor_groups.controllers has ttl_security with multihop, but a packet from more than one hop away never arrives with TTL 255. Remove ttl_security, or remove multihop if the neighbor is directly connected",
        "routing.bgp.neighbors.cogent has ttl_security with multihop, but a packet from more than one hop away never arrives with TTL 255. Remove ttl_security, or remove multihop if the neighbor is directly connected",
    ]);
});

// A route reflector's clients are iBGP neighbors (RFC 4456), and a role is what an eBGP neighbor is to us (RFC 9234).
test("route_reflector_client on an eBGP neighbor is an error, once at a group that has both, and so is a client with a role", () => {
    const bgp = router.routing!.bgp!;
    const device: Device = {
        ...router,
        routing: {
            ...router.routing,
            bgp: {
                ...bgp,
                cluster_id: "192.0.2.256",
                neighbor_groups: {
                    ...bgp.neighbor_groups,
                    clients: { remote_as: 64500, route_reflector_client: true },
                    cogent: { remote_as: 174, route_reflector_client: true },
                },
                neighbors: {
                    ...bgp.neighbors,
                    "cogent-1": { address: "203.0.113.5", neighbor_group: "cogent" },
                    as64501: { address: "203.0.113.6", neighbor_group: "upstream", route_reflector_client: true },
                    "edge-02": { address: "192.0.2.2", neighbor_group: "clients" },
                    "edge-03": { address: "192.0.2.3", neighbor_group: "clients", role: "peer" },
                },
            },
        },
    };

    const found = messages(device).filter((message) => /route_reflector_client|cluster_id/.test(message));
    expect(found).toEqual([
        "routing.bgp.cluster_id: '192.0.2.256' is not an IPv4 address, such as 192.0.2.1",
        "routing.bgp.neighbor_groups.cogent has route_reflector_client, but AS174 is not ours, AS64500: a route reflector has iBGP clients only (RFC 4456). Remove route_reflector_client",
        "routing.bgp.neighbors.as64501 has route_reflector_client, but AS64501 is not ours, AS64500: a route reflector has iBGP clients only (RFC 4456). Remove route_reflector_client",
        "routing.bgp.neighbors.edge-03 has role with route_reflector_client, but a role is for eBGP neighbors (RFC 9234). Remove role",
    ]);
});
