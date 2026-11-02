// The network as a graph, read from the project alone: cables, the VLANs they carry, shared segments, BGP sessions, OSPF adjacencies and tunnels. `circuit studio` draws it.

import type { Device, Gre, Port, Routed, Switched, Vrrp, Vxlan, WireGuardPeer } from "../model";
import { Derive } from "../platforms/derive";
import { Address } from "./address";
import type { CarriedVlan, Graph, GraphEdge, GraphNode, Layer } from "./graph";

export type { CarriedVlan, Graph, GraphEdge, GraphNode, Layer } from "./graph";

/** An address one of the devices holds on a port or interface. */
export type Holder = {
    device: Device;
    /** The port or interface. */
    name: string;
    /** With its length. */
    address: string;
    /** The far end of a point-to-point address. */
    peer?: string;
    vrrp: readonly Vrrp[];
    /** The VRF the address is in. The main table when absent. */
    vrf?: string;
};

class Builder {
    readonly nodes = new Map<string, GraphNode>();
    readonly edges: GraphEdge[] = [];

    /** Add a node, or add the lines it does not hold yet to the one with that id. */
    node(id: string, kind: GraphNode["kind"], label: string, detail: string[] = []): string {
        const existing = this.nodes.get(id);

        if (!existing) this.nodes.set(id, { id, kind, label, detail: [...detail] });
        else for (const line of detail) if (!existing.detail.includes(line)) existing.detail.push(line);

        return id;
    }

    edge(edge: GraphEdge): GraphEdge {
        this.edges.push(edge);
        return edge;
    }
}

export class Topology {
    static readonly LAYERS: readonly Layer[] = ["l1", "l2", "l3", "bgp", "ospf", "tunnels"];

    static deviceId(name: string): string {
        return `device:${name}`;
    }

    /** An address as a key, so two spellings of one address compare equal. Undefined when it is not an address. */
    static keyOf(address: string | undefined): string | undefined {
        if (!address || !Address.isValid(address)) return undefined;
        return `${Address.family(address)}:${Address.toNumber(address)}`;
    }

    private static isHostRoute(cidr: string): boolean {
        const { len, family } = Address.split(cidr);
        return len === Address.bits(family);
    }

    /** Ports, then every other interface, that can hold an address. */
    static routedOf(device: Device): [string, Routed][] {
        return [
            ...Derive.ports(device).map(([name, port]) => [name, port] as [string, Routed]),
            ...Derive.interfaces(device).map(({ name, settings }) => [name, settings as Routed] as [string, Routed]),
        ];
    }

    /** Every valid address the devices hold. An invalid one is left for `validate` to report. */
    static holders(devices: readonly Device[]): Holder[] {
        return devices.flatMap((device) =>
            Topology.routedOf(device).flatMap(([name, settings]) =>
                (settings.addresses ?? []).flatMap((entry) => {
                    const address = typeof entry === "string" ? entry : entry.address;
                    if (!Address.isCidr(address)) return [];

                    const peer = typeof entry === "string" ? undefined : entry.peer_address;
                    return [
                        {
                            device,
                            name,
                            address,
                            vrrp: settings.vrrp ?? [],
                            ...(peer ? { peer } : {}),
                            ...(settings.vrf ? { vrf: settings.vrf } : {}),
                        },
                    ];
                })
            )
        );
    }

    /** Who holds each address: the first holder of it. */
    static owners(holders: readonly Holder[]): Map<string, Holder> {
        const owners = new Map<string, Holder>();
        for (const holder of holders) {
            const key = Topology.keyOf(Address.host(holder.address))!;
            if (!owners.has(key)) owners.set(key, holder);
        }
        return owners;
    }

    private static describeDevice(device: Device): string[] {
        const addresses = Topology.routedOf(device)
            .filter(([, settings]) => settings.addresses?.length)
            .map(([name, settings]) => {
                const list = (settings.addresses ?? []).map((entry) =>
                    typeof entry === "string" ? entry : `${entry.address} to ${entry.peer_address}`
                );
                const vrf = settings.vrf ? `, VRF ${settings.vrf}` : "";
                return `${name}: ${list.join(", ")}${vrf}`;
            });

        return [
            `${device.platform} ${device.model}`,
            device.connection.host ? `reached at ${device.connection.host}` : "reached through its console",
            ...addresses,
        ];
    }

    /** The VLANs a port or LAG carries, by ID. */
    static carriedBy(device: Device, settings: Switched | undefined): CarriedVlan[] {
        const vlan = (name: string | undefined, untagged: boolean): CarriedVlan[] => {
            const id = name ? device.switching?.vlans?.[name]?.id : undefined;
            return name && id !== undefined ? [{ name, id, untagged }] : [];
        };

        const trunk = (settings?.trunk_vlans ?? []).filter((name) => name !== settings?.native_vlan);

        return [
            ...vlan(settings?.access_vlan, true),
            ...vlan(settings?.native_vlan, true),
            ...trunk.flatMap((name) => vlan(name, false)),
        ].sort((a, b) => a.id - b.id);
    }

    /** What carries a port's VLANs: the LAG it is in, or the port itself. */
    static carrierOf(device: Device, port: Port): Switched | undefined {
        return port.in_lag ? device.interfaces?.lag?.[port.in_lag] : port;
    }

    private static vlanLabel(vlans: CarriedVlan[]): string {
        if (vlans.length === 1) return `${vlans[0]!.name}${vlans[0]!.untagged ? ", untagged" : ""}`;
        if (vlans.length <= 3) return vlans.map((vlan) => vlan.name).join(", ");

        return `${vlans.length} VLANs`;
    }

    /** `l1`, every cable, with a LAG's member cables as one edge; and `l2`, the VLANs each one carries. */
    private static cables(devices: readonly Device[], graph: Builder): void {
        const byName = new Map(devices.map((device) => [device.name, device]));
        const drawn = new Set<string>();
        const bundles = new Map<string, { cable: GraphEdge; members: number }>();

        for (const device of devices) {
            for (const [portName, port] of Derive.ports(device)) {
                const link = port.link;
                if (!link) continue;

                // The far end drew this cable already when both ends name each other.
                const here = `${device.name} ${portName}`;
                const there = `${link.device} ${link.port}`;
                if (drawn.has(`${there}|${here}`)) continue;
                drawn.add(`${here}|${there}`);

                const far = byName.get(link.device);
                const farPort = far?.interfaces?.ethernet?.[link.port];
                const linksBack = farPort?.link?.device === device.name && farPort.link.port === portName;

                const to = far
                    ? Topology.deviceId(far.name)
                    : graph.node(`missing:${link.device}`, "outside", link.device, ["named by a link, and not in the network"]);

                const through = link.through ? `, through ${link.through}` : "";
                const cableLine = `${here} to ${there}${through}`;

                // A LAG's member cables to one LAG on the far side are one edge.
                const lag = port.in_lag;
                const farLag = farPort?.in_lag;
                const bundleKey = `${device.name} ${lag}|${link.device} ${farLag}`;
                const bundle = lag && farLag && linksBack ? bundles.get(bundleKey) : undefined;

                if (bundle) {
                    bundle.members++;
                    bundle.cable.detail.push(cableLine);
                    bundle.cable.label = `${lag} to ${farLag}, ${bundle.members} cables${through}`;
                    continue;
                }

                const isBundle = Boolean(lag && farLag && linksBack);

                const cable = graph.edge({
                    layer: "l1",
                    from: Topology.deviceId(device.name),
                    to,
                    label: `${isBundle ? `${lag} to ${farLag}` : `${portName} to ${link.port}`}${through}`,
                    detail: [cableLine],
                    ...(linksBack ? {} : { oneSided: true as const }),
                });

                if (isBundle) bundles.set(bundleKey, { cable, members: 1 });

                const vlans = Topology.carriedBy(device, Topology.carrierOf(device, port));
                if (!vlans.length) continue;

                graph.edge({
                    layer: "l2",
                    from: Topology.deviceId(device.name),
                    to,
                    label: Topology.vlanLabel(vlans),
                    detail: [
                        `${device.name} ${lag ?? portName}`,
                        ...vlans.map((vlan) => `${vlan.name}, VLAN ${vlan.id}${vlan.untagged ? ", untagged" : ""}`),
                    ],
                    vlans,
                    ...(linksBack ? {} : { oneSided: true as const }),
                });
            }
        }
    }

    /** `l3`: prefixes several devices hold an address in, and point-to-point addresses whose far end is another device. */
    private static segments(holders: Holder[], owners: Map<string, Holder>, graph: Builder): void {
        const bySegment = new Map<string, Holder[]>();
        const pairs = new Set<string>();

        for (const holder of holders) {
            if (holder.peer) {
                const far = owners.get(Topology.keyOf(holder.peer) ?? "");
                if (!far || far.device === holder.device) continue;

                const ends = [`${holder.device.name} ${holder.name}`, `${far.device.name} ${far.name}`].sort().join("|");
                if (pairs.has(ends)) continue;
                pairs.add(ends);

                graph.edge({
                    layer: "l3",
                    from: Topology.deviceId(holder.device.name),
                    to: Topology.deviceId(far.device.name),
                    label: `${Address.host(holder.address)} to ${Address.host(far.address)}`,
                    detail: [`${holder.device.name} ${holder.name} ${holder.address}`, `${far.device.name} ${far.name} ${far.address}`],
                });
                continue;
            }

            // A host route, such as a loopback's, is no segment.
            if (Topology.isHostRoute(holder.address)) continue;

            const segment = Address.prefixOf(holder.address);
            bySegment.set(segment, [...(bySegment.get(segment) ?? []), holder]);
        }

        for (const [segment, members] of bySegment) {
            if (new Set(members.map((member) => member.device.name)).size < 2) continue;

            const memberLines = members.map((member) => `${member.device.name} ${member.name} ${member.address}`);
            const vrrpLines = members.flatMap((member) =>
                member.vrrp.map((group) => `VRRP ${group.id} ${group.address} on ${member.device.name}, priority ${group.priority ?? 100}`)
            );

            // Two ends are a line between them; more share a segment drawn as its own node.
            if (members.length === 2) {
                const [a, b] = members as [Holder, Holder];

                graph.edge({
                    layer: "l3",
                    from: Topology.deviceId(a.device.name),
                    to: Topology.deviceId(b.device.name),
                    label: segment,
                    detail: [...memberLines, ...vrrpLines],
                });
                continue;
            }

            const id = graph.node(`segment:${segment}`, "segment", segment, [...memberLines, ...vrrpLines]);

            for (const member of members) {
                graph.edge({
                    layer: "l3",
                    from: Topology.deviceId(member.device.name),
                    to: id,
                    label: `${member.name} ${Address.host(member.address)}`,
                    detail: [`${member.device.name} ${member.name} ${member.address}`],
                });
            }
        }
    }

    /** Every BGP session of every device, with what it takes from its neighbor group. */
    static sessionsOf(devices: readonly Device[]) {
        return devices.flatMap((device) => {
            const bgp = device.routing?.bgp;

            return Object.entries(bgp?.neighbors ?? {}).flatMap(([name, neighbor]) => {
                if (!neighbor) return [];
                const group = neighbor.neighbor_group ? bgp?.neighbor_groups?.[neighbor.neighbor_group] : undefined;
                const settings = { ...group, ...neighbor };

                return [
                    {
                        device,
                        name,
                        address: neighbor.address,
                        ownAs: bgp?.asn,
                        group: neighbor.neighbor_group,
                        remoteAs: settings.remote_as,
                        role: settings.role,
                        description: settings.description,
                        import: settings.import_policy,
                        export: settings.export_policy,
                    },
                ];
            });
        });
    }

    /** `bgp`: sessions between our devices, matched by the address each names, and to every AS outside. */
    private static sessions(devices: readonly Device[], owners: Map<string, Holder>, graph: Builder): void {
        const all = Topology.sessionsOf(devices);
        type Session = (typeof all)[number];

        const describe = (session: Session) => {
            const parts = [
                session.address,
                session.remoteAs ? `AS${session.remoteAs}` : "no remote AS",
                session.role,
                session.import ? `import ${session.import}` : "imports nothing",
                session.export ? `export ${session.export}` : "exports nothing",
            ];

            return `${session.device.name} ${session.name}: ${parts.filter(Boolean).join(", ")}`;
        };

        const ownerOf = (session: Session) => owners.get(Topology.keyOf(session.address) ?? "")?.device;
        const paired = new Set<Session>();

        for (const session of all) {
            if (paired.has(session)) continue;

            const far = ownerOf(session);

            if (far && far !== session.device) {
                // The far device's session back: one of the same family that names an address this device holds.
                const back = all.find(
                    (other) =>
                        other.device === far &&
                        !paired.has(other) &&
                        ownerOf(other) === session.device &&
                        Address.family(other.address) === Address.family(session.address)
                );
                if (back) paired.add(back);

                graph.edge({
                    layer: "bgp",
                    from: Topology.deviceId(session.device.name),
                    to: Topology.deviceId(far.name),
                    label: session.remoteAs === session.ownAs ? "iBGP" : "eBGP",
                    detail: [describe(session), ...(back ? [describe(back)] : [`${far.name} has no session back`])],
                    ...(back ? {} : { oneSided: true as const }),
                });
                continue;
            }

            const outside = session.remoteAs
                ? graph.node(`as:${session.remoteAs}`, "outside", `AS${session.remoteAs}`, session.description ? [session.description] : [])
                : graph.node(`address:${session.address}`, "outside", session.address, ["a BGP neighbor without a remote AS"]);

            // A session inside our own AS should reach one of our devices.
            const internal = session.remoteAs === session.ownAs;

            graph.edge({
                layer: "bgp",
                from: Topology.deviceId(session.device.name),
                to: outside,
                label: [session.name, session.role].filter(Boolean).join(", "),
                detail: [describe(session), ...(internal ? ["internal, and no device in the network holds the address"] : [])],
                ...(internal ? { oneSided: true as const } : {}),
            });
        }
    }

    /** `ospf`: two devices with OSPF on interfaces in one area and one prefix, neither passive. */
    private static adjacencies(devices: readonly Device[], graph: Builder): void {
        const byKey = new Map<string, { device: Device; name: string; line: string }[]>();

        for (const device of devices) {
            for (const [area, { interfaces }] of Object.entries(device.routing?.ospf?.areas ?? {})) {
                for (const [name, settings] of Object.entries(interfaces ?? {})) {
                    if (settings?.passive) continue;

                    const routed = Derive.settings(device, name) as Routed | undefined;
                    const cost = settings?.cost ? `, cost ${settings.cost}` : "";

                    for (const entry of routed?.addresses ?? []) {
                        const address = typeof entry === "string" ? entry : entry.address;
                        if (!Address.isCidr(address) || Topology.isHostRoute(address)) continue;

                        const key = `${area} ${Address.prefixOf(address)}`;
                        const member = { device, name, line: `${device.name} ${name} ${address}${cost}` };
                        byKey.set(key, [...(byKey.get(key) ?? []), member]);
                    }
                }
            }
        }

        for (const [key, members] of byKey) {
            const [area] = key.split(" ");

            for (const [index, a] of members.entries()) {
                for (const b of members.slice(index + 1)) {
                    if (a.device === b.device) continue;

                    graph.edge({
                        layer: "ospf",
                        from: Topology.deviceId(a.device.name),
                        to: Topology.deviceId(b.device.name),
                        label: `area ${area}`,
                        detail: [a.line, b.line],
                    });
                }
            }
        }
    }

    /** `host:port` or `[host]:port` to the host. */
    private static endpointHost(endpoint: string): string {
        return endpoint.replace(/:\d+$/, "").replace(/^\[(.*)\]$/, "$1");
    }

    /** `tunnels`: GRE and VXLAN tunnels matched by their endpoints, and WireGuard peers matched to the device at the far end. */
    private static tunnels(devices: readonly Device[], owners: Map<string, Holder>, graph: Builder): void {
        type End = { device: Device; name: string; kind: "GRE" | "VXLAN"; iface: Gre | Vxlan; vni?: number };

        const ends: End[] = devices.flatMap((device) => [
            ...Object.entries(device.interfaces?.gre ?? {}).flatMap(([name, iface]) =>
                iface ? [{ device, name, kind: "GRE" as const, iface }] : []
            ),
            ...Object.entries(device.interfaces?.vxlan ?? {}).flatMap(([name, iface]) =>
                iface ? [{ device, name, kind: "VXLAN" as const, iface, vni: iface.vni }] : []
            ),
        ]);

        const same = (a: string, b: string) => Topology.keyOf(a) !== undefined && Topology.keyOf(a) === Topology.keyOf(b);
        const local = (end: End) => Address.host(end.iface.local_address);
        const mirrors = (a: End, b: End) =>
            a.device !== b.device &&
            a.kind === b.kind &&
            same(local(a), b.iface.remote_address) &&
            same(a.iface.remote_address, local(b)) &&
            a.vni === b.vni;

        const describe = (end: End) => {
            const vni = end.vni !== undefined ? `, VNI ${end.vni}` : "";
            return `${end.device.name} ${end.name}: ${local(end)} to ${end.iface.remote_address}${vni}`;
        };

        const paired = new Set<End>();

        for (const end of ends) {
            if (paired.has(end)) continue;

            const mirror = ends.find((other) => !paired.has(other) && mirrors(end, other));

            if (mirror) {
                paired.add(mirror);

                graph.edge({
                    layer: "tunnels",
                    from: Topology.deviceId(end.device.name),
                    to: Topology.deviceId(mirror.device.name),
                    label: `${end.kind} ${end.name} to ${mirror.name}`,
                    detail: [describe(end), describe(mirror)],
                });
                continue;
            }

            // The far endpoint is one of our devices, which declares no tunnel back.
            const owner = owners.get(Topology.keyOf(end.iface.remote_address) ?? "")?.device;

            if (owner && owner !== end.device) {
                graph.edge({
                    layer: "tunnels",
                    from: Topology.deviceId(end.device.name),
                    to: Topology.deviceId(owner.name),
                    label: `${end.kind} ${end.name}`,
                    detail: [describe(end), `${owner.name} declares no tunnel back`],
                    oneSided: true,
                });
                continue;
            }

            const outside = graph.node(
                `address:${end.iface.remote_address}`,
                "outside",
                end.iface.remote_address,
                end.iface.description ? [end.iface.description] : []
            );

            graph.edge({
                layer: "tunnels",
                from: Topology.deviceId(end.device.name),
                to: outside,
                label: `${end.kind} ${end.name}`,
                detail: [describe(end)],
            });
        }

        Topology.wireguard(devices, owners, graph);
    }

    private static wireguard(devices: readonly Device[], owners: Map<string, Holder>, graph: Builder): void {
        const interfaces = devices.flatMap((device) =>
            Object.entries(device.interfaces?.wireguard ?? {}).flatMap(([name, iface]) => (iface ? [{ device, name, iface }] : []))
        );

        // A peer is another of our devices when it may send from that device's tunnel address, or when its endpoint is that device's.
        const farEndOf = (device: Device, peer: WireGuardPeer) =>
            interfaces.find(({ device: other, iface }) => {
                if (other === device) return false;

                const tunnelAddresses = (iface.addresses ?? []).map((entry) =>
                    Address.host(typeof entry === "string" ? entry : entry.address)
                );
                const sendsFrom = tunnelAddresses.some(
                    (address) =>
                        Address.isValid(address) &&
                        peer.allowed_addresses.some((allowed) => Address.isCidr(allowed) && Address.contains(allowed, address))
                );

                const endpoint = peer.endpoint ? Topology.endpointHost(peer.endpoint) : undefined;
                const isEndpoint = endpoint !== undefined && owners.get(Topology.keyOf(endpoint) ?? "")?.device === other;

                return sendsFrom || isEndpoint;
            });

        const drawn = new Set<string>();

        for (const { device, name, iface } of interfaces) {
            const clients: WireGuardPeer[] = [];

            for (const peer of iface.peers ?? []) {
                const far = farEndOf(device, peer);

                if (far) {
                    const ends = [`${device.name} ${name}`, `${far.device.name} ${far.name}`].sort().join("|");
                    if (drawn.has(ends)) continue;
                    drawn.add(ends);

                    graph.edge({
                        layer: "tunnels",
                        from: Topology.deviceId(device.name),
                        to: Topology.deviceId(far.device.name),
                        label: `WireGuard ${name} to ${far.name}`,
                        detail: [`${device.name} ${name} peer ${peer.name}`],
                    });
                    continue;
                }

                if (!peer.endpoint) {
                    clients.push(peer);
                    continue;
                }

                const endpoint = Topology.endpointHost(peer.endpoint);
                const outside = graph.node(`address:${endpoint}`, "outside", peer.name, [`WireGuard endpoint ${peer.endpoint}`]);

                graph.edge({
                    layer: "tunnels",
                    from: Topology.deviceId(device.name),
                    to: outside,
                    label: `WireGuard ${name}`,
                    detail: [`${device.name} ${name} peer ${peer.name}, allowed ${peer.allowed_addresses.join(", ")}`],
                });
            }

            if (!clients.length) continue;

            // Peers that dial in are drawn as one node, so a VPN with many clients stays readable.
            const outside = graph.node(
                `clients:${device.name}:${name}`,
                "outside",
                `${clients.length} ${clients.length === 1 ? "client" : "clients"}`,
                clients.map((peer) => `${peer.name}: ${peer.allowed_addresses.join(", ")}`)
            );

            graph.edge({
                layer: "tunnels",
                from: Topology.deviceId(device.name),
                to: outside,
                label: `WireGuard ${name}`,
                detail: [`peers that dial in to ${device.name} ${name}`],
            });
        }
    }

    /** The network as a graph. It reads the project only, never a device, and works on a project that does not validate. */
    static of(devices: readonly Device[]): Graph {
        const graph = new Builder();

        for (const device of devices) graph.node(Topology.deviceId(device.name), "device", device.name, Topology.describeDevice(device));

        const holders = Topology.holders(devices);
        const owners = Topology.owners(holders);

        Topology.cables(devices, graph);
        Topology.segments(holders, owners, graph);
        Topology.sessions(devices, owners, graph);
        Topology.adjacencies(devices, graph);
        Topology.tunnels(devices, owners, graph);

        return { nodes: [...graph.nodes.values()], edges: graph.edges };
    }
}
