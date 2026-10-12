// The network as a graph, read from the config alone: cables, the VLANs they carry, shared segments, BGP sessions, OSPF adjacencies and tunnels. `circuit graph` prints it and `circuit studio` draws it.

import type { Device, Gre, Routed, Switched, Vxlan, WireGuardPeer } from "../schema";
import type { Finding } from "./define";
import { contains, familyOf, host, isAddress, isCidr, network as prefixOf, parse, split } from "./addr";

/** One view of the network. Every edge belongs to one. */
export type Layer = "l1" | "l2" | "l3" | "bgp" | "ospf" | "tunnels";

export const LAYERS: readonly Layer[] = ["l1", "l2", "l3", "bgp", "ospf", "tunnels"];

/** One of our devices, a segment several of them share, or something outside the network. */
export type GraphNode = {
    /** Unique among the nodes, such as `device:edge-01` or `as:64501`. */
    id: string;
    kind: "device" | "segment" | "outside";
    /** A word or two, drawn on the node. */
    label: string;
    /** One fact per line, for a closer look. */
    detail: string[];
};

/** A VLAN a cable carries. */
export type CarriedVlan = {
    name: string;
    id: number;
    /** Carried without a tag: the access VLAN, or a trunk's native VLAN. */
    untagged: boolean;
};

export type GraphEdge = {
    layer: Layer;
    /** Node ids. */
    from: string;
    to: string;
    /** A few words, drawn on the edge. */
    label: string;
    /** One fact per line, for a closer look. */
    detail: string[];
    /** Only one end declares it: the far device does not declare the cable, session or tunnel back. */
    oneSided?: true;
    /** On `l2`, the VLANs the cable carries. */
    vlans?: CarriedVlan[];
};

export type Graph = {
    nodes: GraphNode[];
    edges: GraphEdge[];
};

/** How a device compares with its last snapshot, found offline as `diff` finds it. */
export type Drift = {
    status: "matches" | "differs" | "no snapshot" | "cannot plan";
    /** The plan `diff` would show, when it differs. */
    lines: string[];
};

/** The graph with what `validate` found and how each device drawn compares with its snapshot. */
export type Annotated = Graph & {
    findings: Finding[];
    /** By device name. */
    drift: Record<string, Drift>;
};

/** An address one of the devices holds on a port or interface. */
export type Holder = {
    device: Device;
    /** The port or interface. */
    name: string;
    /** With its length. */
    address: string;
    /** The far end of a point-to-point address. */
    peer?: string;
    vrrp: NonNullable<Routed<string>["vrrp"]>;
};

export const deviceId = (name: string) => `device:${name}`;

/** An address as a key, so two spellings of one address compare equal. Undefined when it is not an address. */
export function keyOf(address: string | undefined): string | undefined {
    if (!address || !isAddress(address)) return undefined;
    return `${familyOf(address)}:${parse(address)}`;
}

const isHostRoute = (cidr: string) => {
    const { len, family } = split(cidr);
    return len === (family === "ipv4" ? 32 : 128);
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

/** Ports, then interfaces, that can hold an address. */
export function routedOf(device: Device): [string, Routed<string>][] {
    const ports = Object.entries(device.ports ?? {}).flatMap(([name, port]) => (port ? [[name, port] as [string, Routed<string>]] : []));
    const interfaces = Object.entries(device.interfaces ?? {}) as [string, Routed<string>][];

    return [...ports, ...interfaces];
}

/** Every valid address the devices hold. An invalid one is left for `validate` to report. */
export function holdersOf(devices: readonly Device[]): Holder[] {
    return devices.flatMap((device) =>
        routedOf(device).flatMap(([name, settings]) =>
            (settings.addresses ?? []).flatMap((entry) => {
                const address = typeof entry === "string" ? entry : entry.address;
                if (!isCidr(address)) return [];

                const peer = typeof entry === "string" ? undefined : entry.peer;
                return [{ device, name, address, peer, vrrp: settings.vrrp ?? [] }];
            })
        )
    );
}

function describeDevice(device: Device): string[] {
    const addresses = routedOf(device)
        .filter(([, settings]) => settings.addresses?.length)
        .map(([name, settings]) => {
            const list = (settings.addresses ?? []).map((entry) =>
                typeof entry === "string" ? entry : `${entry.address} to ${entry.peer}`
            );
            const vrf = settings.vrf ? `, VRF ${settings.vrf}` : "";
            return `${name}: ${list.join(", ")}${vrf}`;
        });

    return [`${device.platform} ${device.model}`, `reached at ${device.connection.host}`, ...addresses];
}

/** The VLANs a port or LAG carries, by id. */
function carriedBy(device: Device, settings: Switched<string> | undefined): CarriedVlan[] {
    const vlan = (name: string | undefined, untagged: boolean): CarriedVlan[] => {
        const id = name ? device.vlans?.[name]?.id : undefined;
        return name && id !== undefined ? [{ name, id, untagged }] : [];
    };

    const trunk = (settings?.trunk_vlans ?? []).filter((name) => name !== settings?.native_vlan);

    return [...vlan(settings?.access_vlan, true), ...vlan(settings?.native_vlan, true), ...trunk.flatMap((name) => vlan(name, false))].sort(
        (a, b) => a.id - b.id
    );
}

function vlanLabel(vlans: CarriedVlan[]): string {
    if (vlans.length === 1) return `${vlans[0]!.name}${vlans[0]!.untagged ? ", untagged" : ""}`;
    if (vlans.length <= 3) return vlans.map((vlan) => vlan.name).join(", ");

    return `${vlans.length} VLANs`;
}

/** `l1`, every cable, with a LAG's member cables as one edge; and `l2`, the VLANs each one carries. */
function cables(devices: readonly Device[], graph: Builder): void {
    const byName = new Map(devices.map((device) => [device.name, device]));
    const drawn = new Set<string>();
    const bundles = new Map<string, { cable: GraphEdge; members: number }>();

    for (const device of devices) {
        for (const [portName, port] of Object.entries(device.ports ?? {})) {
            const link = port?.link;
            if (!port || !link) continue;

            // The far end drew this cable already when both ends name each other.
            const here = `${device.name} ${portName}`;
            const there = `${link.device} ${link.port}`;
            if (drawn.has(`${there}|${here}`)) continue;
            drawn.add(`${here}|${there}`);

            const far = byName.get(link.device);
            const farPort = far?.ports?.[link.port];
            const linksBack = farPort?.link?.device === device.name && farPort.link.port === portName;

            const to = far
                ? deviceId(far.name)
                : graph.node(`missing:${link.device}`, "outside", link.device, ["named by a link, and not in the network"]);

            const cableLine = `${here} to ${there}`;

            // A LAG's member cables to one LAG on the far side are one edge.
            const lag = port.lag;
            const farLag = farPort?.lag;
            const bundleKey = `${device.name} ${lag}|${link.device} ${farLag}`;
            const bundle = lag && farLag && linksBack ? bundles.get(bundleKey) : undefined;

            if (bundle) {
                bundle.members++;
                bundle.cable.detail.push(cableLine);
                bundle.cable.label = `${lag} to ${farLag}, ${bundle.members} cables`;
                continue;
            }

            const isBundle = Boolean(lag && farLag && linksBack);

            const cable = graph.edge({
                layer: "l1",
                from: deviceId(device.name),
                to,
                label: isBundle ? `${lag} to ${farLag}` : `${portName} to ${link.port}`,
                detail: [cableLine],
                ...(linksBack ? {} : { oneSided: true as const }),
            });

            if (isBundle) bundles.set(bundleKey, { cable, members: 1 });

            // What carries the VLANs is the LAG when the port is in one.
            const lagSettings = lag ? device.interfaces?.[lag] : undefined;
            const carrier = lagSettings?.type === "lag" ? lagSettings : lag ? undefined : port;
            const vlans = carriedBy(device, carrier);
            if (!vlans.length) continue;

            graph.edge({
                layer: "l2",
                from: deviceId(device.name),
                to,
                label: vlanLabel(vlans),
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
function segments(holders: Holder[], owners: Map<string, Holder>, graph: Builder): void {
    const bySegment = new Map<string, Holder[]>();
    const pairs = new Set<string>();

    for (const holder of holders) {
        if (holder.peer) {
            const far = owners.get(keyOf(holder.peer) ?? "");
            if (!far || far.device === holder.device) continue;

            const ends = [`${holder.device.name} ${holder.name}`, `${far.device.name} ${far.name}`].sort().join("|");
            if (pairs.has(ends)) continue;
            pairs.add(ends);

            graph.edge({
                layer: "l3",
                from: deviceId(holder.device.name),
                to: deviceId(far.device.name),
                label: `${host(holder.address)} to ${host(far.address)}`,
                detail: [`${holder.device.name} ${holder.name} ${holder.address}`, `${far.device.name} ${far.name} ${far.address}`],
            });
            continue;
        }

        // A host route, such as a loopback's, is no segment.
        if (isHostRoute(holder.address)) continue;

        const segment = prefixOf(holder.address);
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
                from: deviceId(a.device.name),
                to: deviceId(b.device.name),
                label: segment,
                detail: [...memberLines, ...vrrpLines],
            });
            continue;
        }

        const id = graph.node(`segment:${segment}`, "segment", segment, [...memberLines, ...vrrpLines]);

        for (const member of members) {
            graph.edge({
                layer: "l3",
                from: deviceId(member.device.name),
                to: id,
                label: `${member.name} ${host(member.address)}`,
                detail: [`${member.device.name} ${member.name} ${member.address}`],
            });
        }
    }
}

/** `bgp`: sessions between our devices, matched by the address each names, and to every AS outside. */
function sessions(devices: readonly Device[], owners: Map<string, Holder>, graph: Builder): void {
    const all = devices.flatMap((device) => {
        const bgp = device.routing?.bgp;

        return Object.entries(bgp?.neighbors ?? {}).map(([name, neighbor]) => {
            const group = neighbor.group ? bgp?.groups?.[neighbor.group] : undefined;

            return {
                device,
                name,
                address: neighbor.address,
                ownAs: bgp!.asn,
                remoteAs: neighbor.remote_as ?? group?.remote_as,
                role: neighbor.role ?? group?.role,
                description: neighbor.description ?? group?.description,
                import: neighbor.import ?? group?.import,
                export: neighbor.export ?? group?.export,
            };
        });
    });

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

    const ownerOf = (session: Session) => owners.get(keyOf(session.address) ?? "")?.device;
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
                    familyOf(other.address) === familyOf(session.address)
            );
            if (back) paired.add(back);

            graph.edge({
                layer: "bgp",
                from: deviceId(session.device.name),
                to: deviceId(far.name),
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
            from: deviceId(session.device.name),
            to: outside,
            label: [session.name, session.role].filter(Boolean).join(", "),
            detail: [describe(session), ...(internal ? ["internal, and no device in the network holds the address"] : [])],
            ...(internal ? { oneSided: true as const } : {}),
        });
    }
}

/** `ospf`: two devices with OSPF on interfaces in one area and one prefix, neither passive. */
function adjacencies(devices: readonly Device[], graph: Builder): void {
    const byKey = new Map<string, { device: Device; name: string; line: string }[]>();

    for (const device of devices) {
        for (const [area, { interfaces }] of Object.entries(device.routing?.ospf?.areas ?? {})) {
            for (const [name, settings] of Object.entries(interfaces)) {
                if (settings?.passive) continue;

                const routed = (device.ports?.[name] ?? device.interfaces?.[name]) as Routed<string> | undefined;
                const cost = settings?.cost ? `, cost ${settings.cost}` : "";

                for (const entry of routed?.addresses ?? []) {
                    const address = typeof entry === "string" ? entry : entry.address;
                    if (!isCidr(address) || isHostRoute(address)) continue;

                    const key = `${area} ${prefixOf(address)}`;
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
                    from: deviceId(a.device.name),
                    to: deviceId(b.device.name),
                    label: `area ${area}`,
                    detail: [a.line, b.line],
                });
            }
        }
    }
}

/** `host:port` or `[host]:port` to the host. */
const endpointHost = (endpoint: string) => endpoint.replace(/:\d+$/, "").replace(/^\[(.*)\]$/, "$1");

/** `tunnels`: GRE and VXLAN tunnels matched by their endpoints, and WireGuard peers matched to the device at the far end. */
function tunnels(devices: readonly Device[], owners: Map<string, Holder>, graph: Builder): void {
    const ends = devices.flatMap((device) =>
        Object.entries(device.interfaces ?? {}).flatMap(([name, iface]) =>
            iface.type === "gre" || iface.type === "vxlan" ? [{ device, name, iface: iface as Gre<string> | Vxlan<string> }] : []
        )
    );

    type End = (typeof ends)[number];

    const same = (a: string, b: string) => keyOf(a) !== undefined && keyOf(a) === keyOf(b);
    const mirrors = (a: End, b: End) =>
        a.device !== b.device &&
        a.iface.type === b.iface.type &&
        same(a.iface.local, b.iface.remote) &&
        same(a.iface.remote, b.iface.local) &&
        (a.iface.type !== "vxlan" || (b.iface.type === "vxlan" && a.iface.vni === b.iface.vni));

    const describe = (end: End) => {
        const vni = end.iface.type === "vxlan" ? `, VNI ${end.iface.vni}` : "";
        return `${end.device.name} ${end.name}: ${end.iface.local} to ${end.iface.remote}${vni}`;
    };

    const paired = new Set<End>();

    for (const end of ends) {
        if (paired.has(end)) continue;

        const kind = end.iface.type === "gre" ? "GRE" : "VXLAN";
        const mirror = ends.find((other) => !paired.has(other) && mirrors(end, other));

        if (mirror) {
            paired.add(mirror);

            graph.edge({
                layer: "tunnels",
                from: deviceId(end.device.name),
                to: deviceId(mirror.device.name),
                label: `${kind} ${end.name} to ${mirror.name}`,
                detail: [describe(end), describe(mirror)],
            });
            continue;
        }

        // The far endpoint is one of our devices, which declares no tunnel back.
        const owner = owners.get(keyOf(end.iface.remote) ?? "")?.device;

        if (owner && owner !== end.device) {
            graph.edge({
                layer: "tunnels",
                from: deviceId(end.device.name),
                to: deviceId(owner.name),
                label: `${kind} ${end.name}`,
                detail: [describe(end), `${owner.name} declares no tunnel back`],
                oneSided: true,
            });
            continue;
        }

        const outside = graph.node(
            `address:${end.iface.remote}`,
            "outside",
            end.iface.remote,
            end.iface.description ? [end.iface.description] : []
        );

        graph.edge({
            layer: "tunnels",
            from: deviceId(end.device.name),
            to: outside,
            label: `${kind} ${end.name}`,
            detail: [describe(end)],
        });
    }

    wireguard(devices, owners, graph);
}

function wireguard(devices: readonly Device[], owners: Map<string, Holder>, graph: Builder): void {
    const interfaces = devices.flatMap((device) =>
        Object.entries(device.interfaces ?? {}).flatMap(([name, iface]) => (iface.type === "wireguard" ? [{ device, name, iface }] : []))
    );

    // A peer is another of our devices when it may send from that device's tunnel address, or when its endpoint is that device's.
    const farEndOf = (device: Device, peer: WireGuardPeer) =>
        interfaces.find(({ device: other, iface }) => {
            if (other === device) return false;

            const tunnelAddresses = (iface.addresses ?? []).map((entry) => host(typeof entry === "string" ? entry : entry.address));
            const sendsFrom = tunnelAddresses.some(
                (address) => isAddress(address) && peer.allowed_addresses.some((allowed) => isCidr(allowed) && contains(allowed, address))
            );

            const endpoint = peer.endpoint ? endpointHost(peer.endpoint) : undefined;
            const isEndpoint = endpoint !== undefined && owners.get(keyOf(endpoint) ?? "")?.device === other;

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
                    from: deviceId(device.name),
                    to: deviceId(far.device.name),
                    label: `WireGuard ${name} to ${far.name}`,
                    detail: [`${device.name} ${name} peer ${peer.name}`],
                });
                continue;
            }

            if (!peer.endpoint) {
                clients.push(peer);
                continue;
            }

            const endpoint = endpointHost(peer.endpoint);
            const outside = graph.node(`address:${endpoint}`, "outside", peer.name, [`WireGuard endpoint ${peer.endpoint}`]);

            graph.edge({
                layer: "tunnels",
                from: deviceId(device.name),
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
            from: deviceId(device.name),
            to: outside,
            label: `WireGuard ${name}`,
            detail: [`peers that dial in to ${device.name} ${name}`],
        });
    }
}

/** The network as a graph. It reads the config only, never a device, and works on a config that does not validate. */
export function graphOf(devices: readonly Device[]): Graph {
    const graph = new Builder();

    for (const device of devices) graph.node(deviceId(device.name), "device", device.name, describeDevice(device));

    const holders = holdersOf(devices);

    // Who holds each address, for matching a session or tunnel to the device at its far end. The first holder wins.
    const owners = new Map<string, Holder>();
    for (const holder of holders) {
        const key = keyOf(host(holder.address))!;
        if (!owners.has(key)) owners.set(key, holder);
    }

    cables(devices, graph);
    segments(holders, owners, graph);
    sessions(devices, owners, graph);
    adjacencies(devices, graph);
    tunnels(devices, owners, graph);

    return { nodes: [...graph.nodes.values()], edges: graph.edges };
}

/** Only the edges on these layers, and among those only the ones that touch these devices when any are named. Every device named stays. */
export function only(graph: Graph, layers: readonly Layer[], deviceNames: readonly string[] = []): Graph {
    const named = new Set(deviceNames.map(deviceId));
    const touches = (edge: GraphEdge) => !named.size || named.has(edge.from) || named.has(edge.to);

    const edges = graph.edges.filter((edge) => layers.includes(edge.layer) && touches(edge));
    const ends = new Set(edges.flatMap((edge) => [edge.from, edge.to]));

    const nodes = graph.nodes.filter((node) => (named.size ? named.has(node.id) : node.kind === "device") || ends.has(node.id));

    return { nodes, edges };
}
