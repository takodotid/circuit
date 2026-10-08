// The neutral model as a RouterOS 7 export, written in the form `/export` prints so the two compare line for line.

import { X509Certificate } from "node:crypto";
import { familyOf, host, split } from "../../../core/addr";
import { marker } from "../../../core/secrets";
import type {
    Device,
    Family,
    FilterMatch,
    Interface,
    NatRule,
    Neighbor,
    NeighborSettings,
    PolicyRule,
    Port,
    Ports,
    Service,
    Severity,
} from "../../../schema";
import { portsOf, spell } from "../catalog";

/** A property value as a command takes it. `undefined` and `false` leave the property out. */
export type Value = string | number | undefined | false;

/** Collects commands under their menu. */
export class Output {
    private readonly menus = new Map<string, string[]>();

    /** Add a command to a menu. */
    add(menu: string, command: string): void {
        const commands = this.menus.get(menu) ?? [];
        commands.push(command);
        this.menus.set(menu, commands);
    }

    /** The whole configuration as text. */
    text(): string {
        const blocks = [...this.menus].map(([menu, commands]) => [menu, ...commands].join("\n"));
        return blocks.join("\n") + "\n";
    }
}

/** Quote a value when it holds anything but plain characters. */
export function quote(value: string): string {
    const plain = /^[\w.:/@-]+$/.test(value);
    if (plain) return value;
    // Inside a quoted string `$` starts a variable, so it is escaped like a quote.
    const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\$/g, "\\$");
    return `"${escaped}"`;
}

/**
 * A command: a verb such as `add` or `set [ find name=x ]`, then `property=value` for every property that has a value.
 *
 * Properties are written in the order given.
 */
export function command(verb: string, properties: Record<string, Value>): string {
    const words = [verb];

    for (const [name, value] of Object.entries(properties)) {
        if (value === undefined || value === false) continue;

        const written = typeof value === "number" ? String(value) : quote(value);
        words.push(`${name}=${written}`);
    }

    return words.join(" ");
}

/** `yes` or `no`. */
export const yesNo = (on: boolean | undefined): string => (on ? "yes" : "no");

/** `V4` or `V6`, the suffix of a chain rendered for one family. */
export const familySuffix = (family: Family): string => (family === "ipv4" ? "V4" : "V6");

/** Each port or range of ports as the platform writes it: `53`, `0-52`. */
export const eachPort = (ports: Ports): string[] =>
    [ports].flat().map((port) => (typeof port === "number" ? String(port) : `${port.min}-${port.max}`));

/** One port, a range, or a list of them, as `53,0-52`. */
export function portList(ports: Ports | undefined): string | undefined {
    if (ports === undefined) return undefined;

    return eachPort(ports).join(",");
}

/** Seconds as the platform writes a duration: `3600` becomes `1h`, `90` becomes `1m30s`. */
export function duration(seconds: number): string {
    const units = [
        ["w", 604800],
        ["d", 86400],
        ["h", 3600],
        ["m", 60],
        ["s", 1],
    ] as const;
    let remaining = seconds;
    let text = "";

    for (const [unit, size] of units) {
        const count = Math.floor(remaining / size);
        if (count > 0) text += `${count}${unit}`;
        remaining %= size;
    }

    return text || "0s";
}

/** A rate as the switch chip takes it: `2G` becomes `2.0Gbps`. */
export function bitrate(rate: string): string {
    const match = /^([\d.]+)([kMG])$/.exec(rate);
    if (!match) return rate;

    const [, amount, unit] = match;
    const suffix = unit === "k" ? "kbps" : `${unit}bps`;
    return `${Number(amount).toFixed(1)}${suffix}`;
}

/** An IPv4 prefix with a dotted mask, as the switch chip takes it: `10.0.0.0/8` becomes `10.0.0.0/255.0.0.0`. */
export function dottedMask(cidr: string): string {
    const { addr, len } = split(cidr);
    const mask = len === 0 ? 0 : (0xffffffff << (32 - len)) >>> 0;
    const octets = [24, 16, 8, 0].map((shift) => (mask >>> shift) & 255);
    return `${addr}/${octets.join(".")}`;
}

/** A community pattern with `*` as a regular expression the platform matches on: `64500:*:*` becomes `^64500:[0-9]+:[0-9]+$`. */
export function communityPattern(pattern: string): string {
    const fields = pattern.split(":").map((field) => (field === "*" ? "[0-9]+" : field));
    return `^${fields.join(":")}$`;
}

/** The bridge every switched port joins. One per device. */
export const BRIDGE = "bridge";

export type AnyPort = Port<string, string, string, string>;
export type AnyInterface = Interface<string, string>;

export class Context {
    readonly ports: Record<string, AnyPort>;
    readonly interfaces: Record<string, AnyInterface>;

    constructor(readonly device: Device) {
        this.ports = Object.fromEntries(
            Object.entries(device.ports ?? {}).filter((entry): entry is [string, AnyPort] => entry[1] !== undefined)
        );
        this.interfaces = device.interfaces ?? {};
    }

    /** What the platform calls a port or an interface. A port is spelled by the model; an interface keeps its config name. */
    name(portOrInterface: string): string {
        if (portOrInterface in this.interfaces) return portOrInterface;

        return spell(this.device.platform, this.device.model, portOrInterface);
    }

    /** The number of a VLAN, by its config name. */
    vlanId(vlan: string): number {
        const declared = this.device.vlans?.[vlan];
        if (!declared) throw new Error(`${this.device.name}: VLAN ${vlan} is not declared`);
        return declared.id;
    }

    /** Ports and LAGs that are layer 2 members of a VLAN, with their settings. A port in a LAG is represented by the LAG. */
    switched(): [string, AnyPort | Extract<AnyInterface, { type: "lag" }>][] {
        const ports = Object.entries(this.ports).filter(([, port]) => !port.lag && (port.access_vlan || port.trunk_vlans));
        const lags = Object.entries(this.interfaces).filter((entry): entry is [string, Extract<AnyInterface, { type: "lag" }>] => {
            const lag = entry[1];
            return lag.type === "lag" && Boolean(lag.access_vlan || lag.trunk_vlans);
        });
        return [...ports, ...lags];
    }

    /** VLAN interfaces, with their settings. */
    vlanInterfaces(): [string, Extract<AnyInterface, { type: "vlan" }>][] {
        return Object.entries(this.interfaces).filter(
            (
                entry
            ): entry is [
                string,
                Extract<
                    AnyInterface,
                    {
                        type: "vlan";
                    }
                >,
            ] => entry[1].type === "vlan"
        );
    }

    /** Every port and interface that holds addresses or other layer 3 settings. Ports are named as the platform spells them. */
    routed(): { name: string; settings: AnyPort | AnyInterface }[] {
        const ports = Object.entries(this.ports).map(([port, settings]) => ({ name: this.name(port), settings }));
        const interfaces = Object.entries(this.interfaces).map(([name, settings]) => ({ name, settings }));
        return [...ports, ...interfaces];
    }
}

/** Destination of spanning tree BPDUs, so a filter can drop them on one port. */
const BPDU_DESTINATION = "01:80:C2:00:00:00/FF:FF:FF:FF:FF:FF";

export function renderInterfaces(out: Output, ctx: Context): void {
    hardwareOffload(out, ctx);
    bridge(out, ctx);
    ethernet(out, ctx);
    switchPorts(out, ctx);
    lags(out, ctx);
    vlanInterfaces(out, ctx);
    tunnels(out, ctx);
    wireguard(out, ctx);
    vrrp(out, ctx);
    bridgePorts(out, ctx);
    bridgeVlans(out, ctx);
    bridgeFilters(out, ctx);
    interfaceLists(out, ctx);
    vrfs(out, ctx);
}

/**
 * Routing in the switch chip. With it on, routed traffic bypasses the forward chain unless its interface opts out.
 *
 * Restarting the offload after a failure, and offloading IPv6 too, follow the same switch.
 */
function hardwareOffload(out: Output, ctx: Context): void {
    const on = yesNo(ctx.device.hardware_offload);
    out.add("/interface ethernet switch", command("set switch1", { "l3-hw-offloading": on }));
    out.add("/interface ethernet switch l3hw-settings", command("set", { autorestart: on, "ipv6-hw": on }));
}

/** One VLAN-filtering bridge carries every switched port. A loopback is a bridge with no ports, the platform's idiom for one. */
function bridge(out: Output, ctx: Context): void {
    const { device } = ctx;
    const needsBridge = ctx.switched().length > 0 || ctx.vlanInterfaces().length > 0;

    if (needsBridge) {
        const stp = device.stp;
        const protocolMode = stp ? (stp.mode ?? "rstp") : "none";
        const priority = stp?.priority === undefined ? undefined : `0x${stp.priority.toString(16)}`;
        out.add("/interface bridge", command("add", { name: BRIDGE, "protocol-mode": protocolMode, priority, "vlan-filtering": "yes" }));
    }

    for (const [name, iface] of Object.entries(ctx.interfaces)) {
        if (iface.type !== "loopback") continue;

        out.add("/interface bridge", command("add", { comment: iface.description, name }));
    }
}

type Speed = NonNullable<AnyPort["speed"]>;

/** The platform names a fixed speed by its medium: an optic in a cage, or copper. */
const MEDIUM: Record<"optical" | "copper", Partial<Record<Speed, string>>> = {
    optical: {
        "1g": "1G-baseX",
        "10g": "10G-baseSR-LR",
        "25g": "25G-baseSR-LR",
        "40g": "40G-baseSR4-LR4",
        "50g": "50G-baseSR2-LR2",
        "100g": "100G-baseSR4-LR4",
    },
    copper: {
        "100m": "100M-baseT-full",
        "1g": "1G-baseT-full",
    },
};

/** The platform's name for a fixed speed on a port, or undefined when it has none. */
export function mediumOf(platformPortName: string, speed: Speed): string | undefined {
    const medium = platformPortName.startsWith("ether") ? "copper" : "optical";
    return MEDIUM[medium][speed];
}

/** Every port of the model is stated. One the config does not declare is disabled. */
function ethernet(out: Output, ctx: Context): void {
    const { device } = ctx;

    for (const port of portsOf(device.platform, device.model)) {
        const selector = `set [ find default-name=${spell(device.platform, device.model, port)} ]`;
        const settings = ctx.ports[port];
        if (!settings) {
            out.add("/interface ethernet", command(selector, { disabled: "yes" }));
            continue;
        }

        const fixedSpeed = settings.speed && mediumOf(spell(device.platform, device.model, port), settings.speed);

        out.add(
            "/interface ethernet",
            command(selector, {
                "auto-negotiation": fixedSpeed ? "no" : undefined,
                comment: settings.description,
                mtu: settings.mtu,
                speed: fixedSpeed,
            })
        );
    }
}

/**
 * Storm control in the switch chip. The platform takes one rate, in percent, and which kinds of flooded traffic it limits.
 *
 * `unsupported()` refuses packets per second and different percentages per kind, so here they are always one shared percent.
 */
function switchPorts(out: Output, ctx: Context): void {
    for (const [port, settings] of Object.entries(ctx.ports)) {
        const storm = settings.storm_control;
        if (!storm) continue;

        const thresholds = [storm.broadcast, storm.multicast, storm.unknown_unicast].filter((threshold) => threshold !== undefined);
        const percent = thresholds.find((threshold) => "percent" in threshold);
        if (!percent || !("percent" in percent)) continue;

        out.add(
            "/interface ethernet switch port",
            command(`set ${ctx.name(port)}`, {
                "limit-broadcasts": yesNo(storm.broadcast !== undefined),
                "limit-unknown-multicasts": yesNo(storm.multicast !== undefined),
                "limit-unknown-unicasts": yesNo(storm.unknown_unicast !== undefined),
                "storm-rate": percent.percent,
            })
        );
    }
}

/** A LAG is a bonding interface. Its members are named as the platform spells them. */
function lags(out: Output, ctx: Context): void {
    for (const [name, lag] of Object.entries(ctx.interfaces)) {
        if (lag.type !== "lag") continue;

        const members = Object.entries(ctx.ports)
            .filter(([, port]) => port.lag === name)
            .map(([port]) => ctx.name(port));
        const mode = lag.mode === "static" ? "balance-xor" : "802.3ad";
        out.add(
            "/interface bonding",
            command("add", {
                comment: lag.description,
                mode,
                mtu: lag.mtu,
                name,
                slaves: members.join(","),
                "transmit-hash-policy": "layer-2-and-3",
            })
        );
    }
}

/** A VLAN interface sits on the bridge. When the device offloads, one that opts out is routed in software so the firewall applies. */
function vlanInterfaces(out: Output, ctx: Context): void {
    for (const [name, iface] of ctx.vlanInterfaces()) {
        const softwareOnly = ctx.device.hardware_offload && iface.hardware_offload === false;
        out.add(
            "/interface vlan",
            command("add", {
                comment: iface.description,
                interface: BRIDGE,
                "l3-hw-offloading": softwareOnly ? "no" : undefined,
                mtu: iface.mtu,
                name,
                "vlan-id": ctx.vlanId(iface.vlan),
            })
        );
    }
}

function tunnels(out: Output, ctx: Context): void {
    for (const [name, iface] of Object.entries(ctx.interfaces)) {
        if (iface.type === "gre") {
            out.add(
                "/interface gre",
                command("add", {
                    comment: iface.description,
                    "local-address": iface.local,
                    mtu: iface.mtu,
                    name,
                    "remote-address": iface.remote,
                })
            );
        }

        if (iface.type === "vxlan") {
            // 4789 is the platform's default and is not written.
            const port = iface.port && iface.port !== 4789 ? iface.port : undefined;
            out.add(
                "/interface vxlan",
                command("add", {
                    comment: iface.description,
                    "local-address": iface.local,
                    "mac-address": iface.mac,
                    mtu: iface.mtu,
                    name,
                    port,
                    vni: iface.vni,
                })
            );
            out.add("/interface vxlan vteps", command("add", { interface: name, "remote-ip": iface.remote }));
        }
    }
}

function wireguard(out: Output, ctx: Context): void {
    for (const [name, iface] of Object.entries(ctx.interfaces)) {
        if (iface.type !== "wireguard") continue;

        out.add(
            "/interface wireguard",
            command("add", {
                comment: iface.description,
                "listen-port": iface.listen_port,
                mtu: iface.mtu,
                name,
                "private-key": marker(iface.private_key),
            })
        );

        for (const peer of iface.peers ?? []) {
            const endpoint = peer.endpoint ? splitEndpoint(peer.endpoint) : undefined;
            out.add(
                "/interface wireguard peers",
                command("add", {
                    "allowed-address": peer.allowed_addresses.join(","),
                    "client-allowed-address": peer.client_allowed_addresses?.join(","),
                    "endpoint-address": endpoint?.host,
                    "endpoint-port": endpoint?.port,
                    interface: name,
                    // Peer names are unique across the device, so they carry the interface.
                    name: `${name}-${peer.name}`,
                    "persistent-keepalive": peer.keepalive ? duration(peer.keepalive) : undefined,
                    "public-key": peer.public_key,
                })
            );
        }
    }
}

/** `host:port` into its parts. The last colon separates them, so an IPv6 host keeps its own. */
function splitEndpoint(endpoint: string): { host: string; port: string } {
    const colon = endpoint.lastIndexOf(":");
    return { host: endpoint.slice(0, colon), port: endpoint.slice(colon + 1) };
}

/** Each VRRP group is an interface of its own, holding the shared address. Version 3 carries IPv6. */
function vrrp(out: Output, ctx: Context): void {
    for (const { name, settings } of ctx.routed()) {
        for (const group of settings.vrrp ?? []) {
            const ipv6 = familyOf(group.address) === "ipv6";
            out.add(
                "/interface vrrp",
                command("add", {
                    interface: name,
                    interval: group.interval ? duration(group.interval) : undefined,
                    name: vrrpName(name, group.id),
                    "preemption-mode": yesNo(group.preempt),
                    priority: group.priority,
                    "v3-protocol": ipv6 ? "ipv6" : undefined,
                    version: ipv6 ? 3 : undefined,
                    vrid: group.id,
                })
            );
        }
    }
}

/** The interface holding one VRRP group. */
export const vrrpName = (iface: string, id: number) => `${iface}-vrrp${id}`;

/** A switched port or LAG joins the bridge. Its untagged VLAN is its port VLAN ID. */
function bridgePorts(out: Output, ctx: Context): void {
    for (const [port, settings] of ctx.switched()) {
        const isTrunk = Boolean(settings.trunk_vlans);
        const untagged = isTrunk ? settings.native_vlan : settings.access_vlan;
        const pvid = untagged ? ctx.vlanId(untagged) : undefined;

        // A trunk without a native VLAN takes tagged frames only; an access port untagged only.
        let frameTypes: string | undefined;
        if (!isTrunk) frameTypes = "admit-only-untagged-and-priority-tagged";
        else if (pvid === undefined) frameTypes = "admit-only-vlan-tagged";

        const stp = typeof settings.stp === "object" ? settings.stp : undefined;
        out.add(
            "/interface bridge port",
            command("add", {
                bridge: BRIDGE,
                edge: stp?.edge ? "yes" : undefined,
                "frame-types": frameTypes,
                interface: ctx.name(port),
                "path-cost": stp?.cost,
                priority: stp?.priority === undefined ? undefined : `0x${stp.priority.toString(16)}`,
                pvid,
            })
        );
    }
}

/** A VLAN is tagged on every trunk carrying it, and on the bridge itself when the router has an interface in it. */
function bridgeVlans(out: Output, ctx: Context): void {
    for (const [vlanName, vlan] of Object.entries(ctx.device.vlans ?? {})) {
        const routedHere = ctx.vlanInterfaces().some(([, iface]) => iface.vlan === vlanName);
        const trunks = ctx
            .switched()
            .filter(([, settings]) => settings.trunk_vlans?.includes(vlanName))
            .map(([port]) => ctx.name(port));
        const tagged = [...(routedHere ? [BRIDGE] : []), ...trunks];
        if (!tagged.length) continue;

        out.add(
            "/interface bridge vlan",
            command("add", {
                bridge: BRIDGE,
                comment: vlan.description,
                tagged: tagged.join(","),
                "vlan-ids": vlan.id,
            })
        );
    }
}

/** The platform cannot take a port out of spanning tree, so `stp: false` drops the BPDUs it would send and receive. */
function bridgeFilters(out: Output, ctx: Context): void {
    for (const [port, settings] of ctx.switched()) {
        if (settings.stp !== false) continue;

        const name = ctx.name(port);
        const comment = `${name} out of spanning tree`;
        out.add(
            "/interface bridge filter",
            command("add", {
                action: "drop",
                chain: "input",
                comment,
                "dst-mac-address": BPDU_DESTINATION,
                "in-interface": name,
            })
        );
        out.add(
            "/interface bridge filter",
            command("add", {
                action: "drop",
                chain: "output",
                comment,
                "dst-mac-address": BPDU_DESTINATION,
                "out-interface": name,
            })
        );
    }
}

/**
 * Interface lists scope what works at layer 2: neighbor discovery, and the platform's own client over MAC. The IP firewall never sees either.
 */
function interfaceLists(out: Output, ctx: Context): void {
    const lists = new Map<string, string[]>();

    const lldp = lldpMembers(ctx);
    if (lldp) lists.set("lldp", lldp);

    const native = ctx.device.management?.native?.interfaces;
    if (native)
        lists.set(
            "native",
            native.map((member) => ctx.name(member))
        );

    for (const list of lists.keys()) out.add("/interface list", command("add", { name: list }));
    for (const [list, members] of lists)
        for (const member of members)
            out.add(
                "/interface list member",
                command("add", {
                    interface: member,
                    list,
                })
            );
}

/**
 * Where LLDP runs, when it is limited to some ports. Undefined when it runs everywhere or nowhere, which the discovery settings say directly.
 */
export function lldpMembers(ctx: Context): string[] | undefined {
    const lldp = ctx.device.lldp;
    if (!lldp) return undefined;

    const overridden = Object.entries(ctx.ports).filter(([, port]) => port.lldp !== undefined);
    if (lldp === true && !overridden.length) return undefined;

    const base = lldp === true ? Object.keys(ctx.ports) : [...lldp.interfaces];
    const members = new Set(base.map((member) => ctx.name(member)));

    for (const [port, settings] of overridden) {
        if (settings.lldp) members.add(ctx.name(port));
        else members.delete(ctx.name(port));
    }

    return [...members];
}

/** A VRF lists its interfaces. */
function vrfs(out: Output, ctx: Context): void {
    for (const [vrf, settings] of Object.entries(ctx.device.vrfs ?? {})) {
        const members = ctx
            .routed()
            .filter(({ settings: iface }) => iface.vrf === vrf)
            .map(({ name }) => name);
        out.add("/ip vrf", command("add", { comment: settings.description, interfaces: members.join(","), name: vrf }));
    }
}

/** Address lists holding the prefixes BGP originates. A session reads the one of its family. */
export const NETWORKS: Record<Family, string> = { ipv4: "bgp-networks-v4", ipv6: "bgp-networks-v6" };

export function renderAddressing(out: Output, ctx: Context): void {
    addresses(out, ctx);
    dhcp(out, ctx);
    dns(out, ctx);
    addressLists(out, ctx);
}

/** Every address goes on the menu of its family, with the interface's description as its comment. */
function addresses(out: Output, ctx: Context): void {
    for (const { name, settings } of ctx.routed()) {
        for (const entry of settings.addresses ?? []) {
            const address = typeof entry === "string" ? entry : entry.address;
            // The far end of a point-to-point address, which the platform calls its network.
            const peer = typeof entry === "string" ? undefined : entry.peer;

            if (familyOf(address) === "ipv4") {
                out.add("/ip address", command("add", { address, comment: settings.description, interface: name, network: peer }));
            } else {
                out.add(
                    "/ipv6 address",
                    command("add", { address, advertise: yesNo(settings.ipv6_ra), comment: settings.description, interface: name })
                );
            }
        }

        // A VRRP address lives on the group's own interface, as a host address.
        for (const group of settings.vrrp ?? []) {
            const vrrpInterface = vrrpName(name, group.id);
            const comment = `VRRP ${group.id} on ${name}`;
            if (familyOf(group.address) === "ipv4") {
                out.add("/ip address", command("add", { address: `${group.address}/32`, comment, interface: vrrpInterface }));
            } else {
                out.add(
                    "/ipv6 address",
                    command("add", {
                        address: `${group.address}/128`,
                        advertise: "no",
                        comment,
                        interface: vrrpInterface,
                    })
                );
            }
        }
    }
}

function dhcp(out: Output, ctx: Context): void {
    for (const [name, server] of Object.entries(ctx.device.dhcp ?? {})) {
        const [first, last] = server.pool;
        // The pool shares the server's name.
        out.add("/ip pool", command("add", { name, ranges: `${first}-${last}` }));
        out.add(
            "/ip dhcp-server",
            command("add", {
                "address-pool": name,
                interface: ctx.name(server.interface),
                "lease-time": server.lease_time ? duration(server.lease_time) : undefined,
                name,
            })
        );
        out.add(
            "/ip dhcp-server network",
            command("add", {
                address: server.network,
                "dns-server": server.dns?.join(","),
                gateway: server.gateway,
            })
        );

        for (const reservation of server.reservations ?? []) {
            out.add(
                "/ip dhcp-server lease",
                command("add", {
                    address: reservation.address,
                    comment: reservation.description,
                    "mac-address": reservation.mac,
                    server: name,
                })
            );
        }
    }

    for (const [name, relay] of Object.entries(ctx.device.dhcp_relay ?? {})) {
        out.add("/ip dhcp-relay", command("add", { "dhcp-server": relay.servers.join(","), interface: ctx.name(relay.interface), name }));
    }
}

function dns(out: Output, ctx: Context): void {
    const dns = ctx.device.system?.dns;
    out.add("/ip dns", command("set", { "allow-remote-requests": yesNo(dns?.serve), servers: dns?.servers.join(",") ?? "" }));
}

/**
 * Address lists come from firewall address sets, prefix sets typed in the config, and what BGP originates.
 *
 * A prefix set fetched from a registry is filled by `refresh`, so only its name is marked, and the plan leaves its entries alone.
 */
function addressLists(out: Output, ctx: Context): void {
    const { device } = ctx;
    const entries: { list: string; address: string }[] = [];

    for (const [list, members] of Object.entries(device.firewall?.address_sets ?? {})) {
        for (const address of members) entries.push({ list, address });
    }

    for (const [list, set] of Object.entries(device.prefix_sets ?? {})) {
        if ("prefixes" in set) for (const address of set.prefixes) entries.push({ list, address });
        else out.add("/ip firewall address-list", `# generated ${list}`);
    }

    for (const prefix of device.routing?.bgp?.networks ?? []) {
        entries.push({ list: NETWORKS[familyOf(host(prefix))], address: prefix });
    }

    for (const family of ["ipv4", "ipv6"] as const) {
        const menu = family === "ipv4" ? "/ip firewall address-list" : "/ipv6 firewall address-list";

        for (const { list, address } of entries) {
            if (familyOf(host(address)) !== family) continue;

            out.add(menu, command("add", { address, list }));
        }
    }
}

/** Helpers the platform has, all stated so that one the config does not list is off. */
const HELPERS = ["ftp", "tftp", "irc", "h323", "sip", "pptp", "rtsp"] as const;

const CHAINS = ["input", "forward", "output"] as const;

export function renderFirewall(out: Output, ctx: Context): void {
    for (const family of ["ipv4", "ipv6"] as const) {
        untracked(out, ctx, family);
        filter(out, ctx, family);
        nat(out, ctx, family);
    }

    helpers(out, ctx);
    switchAcls(out, ctx);
}

/** Untracked prefixes skip connection tracking in the raw table, both ways, before a connection is ever made. */
function untracked(out: Output, ctx: Context, family: Family): void {
    const menu = family === "ipv4" ? "/ip firewall raw" : "/ipv6 firewall raw";

    for (const prefix of ctx.device.firewall?.untracked ?? []) {
        if (familyOf(prefix) !== family) continue;

        for (const [direction, property] of [
            ["to", "dst-address"],
            ["from", "src-address"],
        ] as const) {
            out.add(
                menu,
                command("add", { action: "notrack", chain: "prerouting", comment: `Untracked ${direction} ${prefix}`, [property]: prefix })
            );
        }
    }
}

/**
 * The families a rule applies to. An address in the rule decides it; otherwise it applies to both.
 *
 * A rule naming an address set applies only to the families the set has members in.
 */
function families(ctx: Context, match: FilterMatch<string, string> | undefined): Family[] {
    const sets = ctx.device.firewall?.address_sets ?? {};
    const address = match?.src ?? match?.dst;

    let candidates: Family[] = ["ipv4", "ipv6"];
    if (match?.family) candidates = [match.family];
    else if (address) candidates = [familyOf(address)];

    const setHas = (set: string | undefined, family: Family) => !set || (sets[set] ?? []).some((member) => familyOf(member) === family);
    return candidates.filter((family) => setHas(match?.src_set, family) && setHas(match?.dst_set, family));
}

/** The match properties of a rule, as the platform names them. */
function matchProperties(ctx: Context, match: FilterMatch<string, string> | undefined, family: Family) {
    const protocol = match?.protocol === "icmp" && family === "ipv6" ? "icmpv6" : match?.protocol;
    const setFlags = match?.tcp_flags?.set ?? [];
    const unsetFlags = (match?.tcp_flags?.unset ?? []).map((flag) => `!${flag}`);
    const flags = match?.tcp_flags ? [...setFlags, ...unsetFlags].join(",") : undefined;
    return {
        "connection-state": match?.state?.join(","),
        "dst-address": match?.dst,
        "dst-address-list": match?.dst_set,
        "dst-port": portList(match?.dst_port),
        "in-interface": match?.in_interface && ctx.name(match.in_interface),
        "out-interface": match?.out_interface && ctx.name(match.out_interface),
        protocol,
        "src-address": match?.src,
        "src-address-list": match?.src_set,
        "src-port": portList(match?.src_port),
        "tcp-flags": flags,
    };
}

function filter(out: Output, ctx: Context, family: Family): void {
    const menu = family === "ipv4" ? "/ip firewall filter" : "/ipv6 firewall filter";

    for (const chain of CHAINS) {
        const settings = ctx.device.firewall?.filter?.[chain];
        if (!settings) continue;

        for (const rule of settings.rules ?? []) {
            if (!families(ctx, rule.match).includes(family)) continue;

            const match = matchProperties(ctx, rule.match, family);
            // The platform's fast path takes a flow only on IPv4. The accept below still applies on both.
            if (rule.offload && family === "ipv4") {
                out.add(menu, command("add", { action: "fasttrack-connection", chain, comment: rule.description, ...match }));
            }

            out.add(menu, command("add", { action: rule.action, chain, comment: rule.description, ...match }));
        }

        if (settings.default === "drop") out.add(menu, command("add", { action: "drop", chain, comment: "Default" }));
    }
}

function nat(out: Output, ctx: Context, family: Family): void {
    const menu = family === "ipv4" ? "/ip firewall nat" : "/ipv6 firewall nat";
    const chains: [string, readonly NatRule<string, string>[] | undefined][] = [
        ["srcnat", ctx.device.firewall?.nat?.source],
        ["dstnat", ctx.device.firewall?.nat?.destination],
    ];

    for (const [chain, rules] of chains) {
        for (const rule of rules ?? []) {
            if (!families(ctx, rule.match).includes(family)) continue;
            // A translation to an address belongs to that address's family.
            if (rule.action !== "masquerade" && familyOf(rule.to) !== family) continue;

            const action =
                rule.action === "masquerade"
                    ? {
                          action: "masquerade",
                      }
                    : { action: rule.action === "snat" ? "src-nat" : "dst-nat", "to-addresses": rule.to, "to-ports": rule.to_port };
            out.add(menu, command("add", { ...action, chain, comment: rule.description, ...matchProperties(ctx, rule.match, family) }));
        }
    }
}

function helpers(out: Output, ctx: Context): void {
    const enabled = ctx.device.firewall?.helpers ?? [];

    for (const helper of HELPERS) {
        out.add("/ip firewall service-port", command(`set ${helper}`, { disabled: yesNo(!enabled.includes(helper)) }));
    }
}

/**
 * ACLs run in the switch chip on the port traffic arrives on. The chip matches addresses with a dotted mask on IPv4, drops by forwarding to no port, and limits by rate. A rule takes one port or range, so a list becomes one rule for each.
 */
function switchAcls(out: Output, ctx: Context): void {
    const each = (ports: Ports | undefined) => (ports === undefined ? [undefined] : eachPort(ports));

    for (const [port, settings] of Object.entries(ctx.ports)) {
        if (!settings.acl) continue;

        for (const rule of ctx.device.acls?.[settings.acl] ?? []) {
            const match = rule.match ?? {};
            const ipv6 = match.family === "ipv6" || [match.src, match.dst].some((address) => address && familyOf(address) === "ipv6");
            const address = (prefix: string | undefined) => (prefix && !ipv6 ? dottedMask(prefix) : prefix);

            for (const srcPort of each(match.src_port)) {
                for (const dstPort of each(match.dst_port)) {
                    out.add(
                        "/interface ethernet switch rule",
                        command("add", {
                            comment: rule.description,
                            [ipv6 ? "dst-address6" : "dst-address"]: address(match.dst),
                            "dst-port": dstPort,
                            "mac-protocol": ipv6 ? "ipv6" : "ip",
                            "new-dst-ports": rule.action === "drop" ? "" : undefined,
                            ports: ctx.name(port),
                            protocol: match.protocol,
                            rate: rule.rate && bitrate(rule.rate),
                            [ipv6 ? "src-address6" : "src-address"]: address(match.src),
                            "src-port": srcPort,
                            switch: "switch1",
                            "vlan-id": match.vlan && ctx.vlanId(match.vlan),
                        })
                    );
                }
            }
        }
    }
}

/** The validator group every RPKI server joins. */
export const RPKI_GROUP = "rpki";

/** The chain a session without a policy uses, so that it learns or announces nothing. */
export const REJECT_ALL = "REJECT-ALL";

// RouterOS takes our own role. The config states the neighbor's, so each becomes its opposite: a neighbor that is our provider makes us its customer.
const ROLES = {
    provider: "ebgp-customer",
    customer: "ebgp-provider",
    peer: "ebgp-peer",
    rs: "ebgp-rs-client",
    "rs-client": "ebgp-rs",
} as const;

type AnyRule = PolicyRule<string, string>;
type AnyNeighbor = Neighbor<string, string>;

export function renderRouting(out: Output, ctx: Context): void {
    staticRoutes(out, ctx);
    rpki(out, ctx);
    if (ctx.device.routing?.bgp) {
        bgpInstance(out, ctx);
        policies(out, ctx);
        bgpConnections(out, ctx);
    }

    ospf(out, ctx);
    bfd(out, ctx);
}

function staticRoutes(out: Output, ctx: Context): void {
    for (const route of ctx.device.routing?.static ?? []) {
        const menu = familyOf(host(route.prefix)) === "ipv4" ? "/ip route" : "/ipv6 route";
        const verb = route.blackhole ? "add blackhole" : "add";
        const gateway = route.via ?? (route.interface ? ctx.name(route.interface) : undefined);
        out.add(
            menu,
            command(verb, {
                comment: route.description,
                distance: route.distance,
                "dst-address": route.prefix,
                gateway,
                "routing-table": route.vrf,
            })
        );
    }
}

function rpki(out: Output, ctx: Context): void {
    for (const server of ctx.device.routing?.rpki ?? []) {
        out.add(
            "/routing rpki",
            command("add", {
                address: server.address,
                comment: server.description,
                group: RPKI_GROUP,
                port: server.port,
            })
        );
    }
}

/** The default instance exists on every device; it is stated in the form the export prints it. */
function bgpInstance(out: Output, ctx: Context): void {
    const bgp = ctx.device.routing!.bgp!;
    out.add("/routing bgp instance", command("add", { as: bgp.asn, name: "default", "router-id": ctx.device.routing?.router_id }));
}

/** A neighbor's settings with its group's beneath them. */
function settingsOf(ctx: Context, neighbor: AnyNeighbor): NeighborSettings<string> {
    const group = neighbor.group ? ctx.device.routing?.bgp?.groups?.[neighbor.group] : undefined;
    return { ...group, ...neighbor };
}

/** The families a neighbor exchanges: the ones it states, or its address's. */
function familiesOf(ctx: Context, neighbor: AnyNeighbor): readonly Family[] {
    return settingsOf(ctx, neighbor).families ?? [familyOf(neighbor.address)];
}

/** The chain a policy is rendered as for one family. A policy can test prefix lengths that mean different things per family, so each family gets its own. */
const chainName = (policy: string, family: Family) => `${policy}-${familySuffix(family)}`;

/** Does a rule belong on a family's chain? A rule naming a prefix, a family, or a prefix set of one family belongs only there. */
function appliesTo(ctx: Context, rule: AnyRule, family: Family): boolean {
    const match = rule.match;
    if (match?.family && match.family !== family) return false;

    if (match?.prefix && familyOf(host(match.prefix)) !== family) return false;

    if (match?.prefix_set) {
        const set = ctx.device.prefix_sets?.[match.prefix_set];
        if (!set) return false;

        const firstPrefix = "source" in set ? undefined : set.prefixes[0];
        const setFamily = "source" in set ? set.source.family : firstPrefix && familyOf(host(firstPrefix));
        if (setFamily !== family) return false;
    }

    return true;
}

/** The conditions of a rule, as the platform's filter language writes them. */
function conditions(rule: AnyRule): string[] {
    const match = rule.match ?? {};
    const tests: string[] = [];
    if (match.prefix) tests.push(`dst==${match.prefix}`);
    if (match.prefix_set) tests.push(`dst in ${match.prefix_set}`);
    if (match.prefix_length?.min !== undefined) tests.push(`dst-len>${match.prefix_length.min - 1}`);
    if (match.prefix_length?.max !== undefined) tests.push(`dst-len<${match.prefix_length.max + 1}`);
    if (match.as_path_length?.min !== undefined) tests.push(`bgp-path-len>${match.as_path_length.min - 1}`);
    if (match.as_path_length?.max !== undefined) tests.push(`bgp-path-len<${match.as_path_length.max + 1}`);
    if (match.rpki) tests.push(`rpki ${match.rpki}`);
    if (match.community) tests.push(`bgp-communities includes ${match.community}`);
    if (match.large_community) tests.push(`bgp-large-communities includes ${match.large_community}`);
    return tests;
}

/** What a rule does to a matching route, then its decision. */
function actions(rule: AnyRule, family: Family): string[] {
    const set = rule.set ?? {};
    const steps: string[] = [];
    if (set.local_pref !== undefined) steps.push(`set bgp-local-pref ${set.local_pref}`);
    if (set.med !== undefined) steps.push(`set bgp-med ${set.med}`);
    if (set.prepend !== undefined) steps.push(`set bgp-path-prepend ${set.prepend}`);
    for (const pattern of set.remove_communities ?? []) steps.push(`delete bgp-communities regexp "${communityPattern(pattern)}"`);
    if (set.communities) steps.push(`set bgp-communities ${set.communities.join(",")}`);
    if (set.add_communities) steps.push(`append bgp-communities ${set.add_communities.join(",")}`);

    for (const pattern of set.remove_large_communities ?? []) {
        steps.push(`delete bgp-large-communities regexp "${communityPattern(pattern)}"`);
    }

    if (set.large_communities) steps.push(`set bgp-large-communities ${set.large_communities.join(",")}`);
    if (set.add_large_communities) steps.push(`append bgp-large-communities ${set.add_large_communities.join(",")}`);
    // An address only means something to routes of its own family.
    if (set.next_hop && familyOf(set.next_hop) === family) steps.push(`set gw ${set.next_hop}`);
    if (set.preferred_source && familyOf(set.preferred_source) === family) steps.push(`set pref-src ${set.preferred_source}`);
    if (set.blackhole) steps.push("set blackhole yes");
    if (rule.action) steps.push(rule.action);
    return steps;
}

/** One rule as the platform writes it: hand off, ask the validator, test, change, decide. */
function ruleText(rule: AnyRule, family: Family): string {
    const parts: string[] = [];
    if (rule.call) parts.push(`jump ${chainName(rule.call, family)}`);
    // An RPKI state is only known once the validator has been asked, per route, so the question goes on the same rule.
    if (rule.match?.rpki) parts.push(`rpki-verify ${RPKI_GROUP}`);

    const tests = conditions(rule);
    const steps = actions(rule, family);
    if (tests.length) parts.push(`if (${tests.join(" && ")})${steps.length ? ` { ${steps.join("; ")} }` : ""}`);
    else parts.push(...steps);
    return parts.join("; ");
}

/**
 * Policies become filter chains, one per family a session uses, plus every chain those call.
 *
 * A chain a session uses directly ends in a reject when its last rule does not decide, so a route nothing accepted is rejected on any platform default. A chain only called returns to its caller instead.
 */
function policies(out: Output, ctx: Context): void {
    const bgp = ctx.device.routing!.bgp!;
    const policies = ctx.device.policies ?? {};

    const wanted = new Map<string, Set<Family>>();
    const want = (policy: string, family: Family) => {
        const families = wanted.get(policy) ?? new Set();
        if (families.has(family)) return;

        families.add(family);
        wanted.set(policy, families);
        for (const rule of policies[policy] ?? []) if (rule.call && appliesTo(ctx, rule, family)) want(rule.call, family);
    };

    let rejectAllNeeded = false;

    for (const neighbor of Object.values(bgp.neighbors ?? {})) {
        const settings = settingsOf(ctx, neighbor);

        for (const family of familiesOf(ctx, neighbor)) {
            for (const policy of [settings.import, settings.export]) {
                if (policy) want(policy, family);
                else rejectAllNeeded = true;
            }
        }
    }

    const called = new Set(Object.values(policies).flatMap((rules) => rules.flatMap((rule) => (rule.call ? [rule.call] : []))));

    for (const policy of [...wanted.keys()].sort()) {
        for (const family of ["ipv4", "ipv6"] as const) {
            if (!wanted.get(policy)!.has(family)) continue;

            const chain = chainName(policy, family);
            const rules = (policies[policy] ?? []).filter((rule) => appliesTo(ctx, rule, family));

            for (const rule of rules) {
                const text = ruleText(rule, family);
                if (text) out.add("/routing filter rule", command("add", { chain, comment: rule.description, rule: text }));
            }

            const last = rules.at(-1);
            const decides = last !== undefined && !last.match && !last.call && last.action !== undefined;
            if (!called.has(policy) && !decides) out.add("/routing filter rule", command("add", { chain, rule: "reject" }));
        }
    }

    if (rejectAllNeeded) {
        for (const family of ["ipv4", "ipv6"] as const)
            out.add(
                "/routing filter rule",
                command("add", {
                    chain: chainName(REJECT_ALL, family),
                    rule: "reject",
                })
            );
    }
}

/** One connection per neighbor. The platform carries one family per connection. */
function bgpConnections(out: Output, ctx: Context): void {
    const bgp = ctx.device.routing!.bgp!;

    for (const [name, neighbor] of Object.entries(bgp.neighbors ?? {})) {
        const settings = settingsOf(ctx, neighbor);
        const [family] = familiesOf(ctx, neighbor) as [Family];
        const addressFamily = familyOf(neighbor.address);
        const internal = settings.remote_as === bgp.asn;
        const originates = bgp.networks?.some((prefix) => familyOf(host(prefix)) === family);
        const role = settings.role ? ROLES[settings.role] : internal ? "ibgp" : "ebgp";

        out.add(
            "/routing bgp connection",
            command("add", {
                // Only stated when the routes differ in family from the address they are carried over.
                afi: addressFamily === family ? undefined : family === "ipv6" ? "ipv6" : "ip",
                as: bgp.asn,
                connect: settings.passive ? "no" : undefined,
                "hold-time": settings.hold_time ? duration(settings.hold_time) : undefined,
                "input.filter": chainName(settings.import ?? REJECT_ALL, family),
                [`input.limit-process-routes-${family}`]: settings.max_prefixes,
                "keepalive-time": settings.keepalive ? duration(settings.keepalive) : undefined,
                listen: settings.passive ? "yes" : undefined,
                "local.address": settings.local_address,
                "local.role": role,
                multihop: settings.multihop ? "yes" : undefined,
                name,
                "output.filter-chain": chainName(settings.export ?? REJECT_ALL, family),
                "output.network": originates ? NETWORKS[family] : undefined,
                "remote.address": `${neighbor.address}/${addressFamily === "ipv4" ? 32 : 128}`,
                "remote.as": settings.remote_as,
                "tcp-md5-key": settings.password && marker(settings.password),
                "use-bfd": settings.bfd ? "yes" : undefined,
            })
        );
    }
}

/** One instance per OSPF version, an area per area and instance, and a template per interface. */
function ospf(out: Output, ctx: Context): void {
    const ospf = ctx.device.routing?.ospf;
    if (!ospf) return;

    for (const family of ospf.families ?? ["ipv4"]) {
        const version = family === "ipv4" ? 2 : 3;
        const instance = `ospf-v${version}`;
        out.add(
            "/routing ospf instance",
            command("add", {
                name: instance,
                redistribute: ospf.redistribute?.join(","),
                "router-id": ctx.device.routing?.router_id,
                version,
            })
        );

        for (const [areaId, area] of Object.entries(ospf.areas)) {
            const areaName = `${instance}-${areaId}`;
            out.add("/routing ospf area", command("add", { "area-id": areaId, instance, name: areaName }));

            for (const [iface, settings] of Object.entries(area.interfaces)) {
                // `passive` is a flag, written without a value.
                const verb = settings?.passive ? "add passive" : "add";
                out.add(
                    "/routing ospf interface-template",
                    command(verb, {
                        area: areaName,
                        cost: settings?.cost,
                        interfaces: ctx.name(iface),
                        type: settings?.network === "point-to-point" ? "ptp" : undefined,
                        "use-bfd": settings?.bfd ? "yes" : undefined,
                    })
                );
            }
        }
    }
}

/** BFD runs where a session or an OSPF interface asks for it. One configuration covers every interface. */
function bfd(out: Output, ctx: Context): void {
    const routing = ctx.device.routing;
    const bgpWants = Object.values(routing?.bgp?.neighbors ?? {}).some((neighbor) => settingsOf(ctx, neighbor).bfd);
    const ospfWants = Object.values(routing?.ospf?.areas ?? {}).some((area) => Object.values(area.interfaces).some((iface) => iface?.bfd));
    if (bgpWants || ospfWants) out.add("/routing bfd configuration", command("add", { interfaces: "all" }));
}

/** Neutral service name to the platform's. `native` is the platform's own desktop client. */
export const SERVICES = {
    ftp: "ftp",
    ssh: "ssh",
    telnet: "telnet",
    http: "www",
    https: "www-ssl",
    api: "api",
    api_tls: "api-ssl",
    native: "winbox",
} as const;

const USER_GROUPS = { admin: "full", operator: "write", "read-only": "read" } as const;

const SNMP_AUTH = { sha1: "SHA1", sha256: "SHA1" } as const;
const SNMP_PRIVACY = { aes128: "AES", des: "DES" } as const;

export function renderManagement(out: Output, ctx: Context): void {
    services(out, ctx);
    layerTwo(out, ctx);
    snmp(out, ctx);
    users(out, ctx);
    certificates(out, ctx);
}

/** Every service the platform has is stated. One the config does not name is disabled. */
function services(out: Output, ctx: Context): void {
    const management = ctx.device.management ?? {};

    for (const [neutral, platform] of Object.entries(SERVICES)) {
        const service = management[neutral as keyof typeof SERVICES] as (Service & { certificate?: string }) | undefined;
        if (!service) {
            out.add("/ip service", command(`set ${platform}`, { disabled: "yes" }));
            continue;
        }

        const allow = service.allow ?? management.allow ?? [];
        out.add(
            "/ip service",
            command(`set ${platform}`, {
                address: allow.join(","),
                certificate: service.certificate,
                disabled: "no",
                port: service.port,
            })
        );
    }

    // A newer service with no neutral name. Off, as everything not stated is.
    out.add("/ip service", command("set reverse-proxy", { disabled: "yes" }));
    out.add("/ip ssh", command("set", { "strong-crypto": yesNo(!management.ssh?.weak_crypto) }));
}

/** What works at layer 2: the platform's client over MAC, MAC ping, the bandwidth test server and neighbor discovery. */
function layerTwo(out: Output, ctx: Context): void {
    const nativeList = ctx.device.management?.native?.interfaces ? "native" : "none";
    out.add("/tool mac-server", command("set", { "allowed-interface-list": nativeList }));
    out.add("/tool mac-server mac-winbox", command("set", { "allowed-interface-list": nativeList }));
    out.add("/tool mac-server ping", command("set", { enabled: "no" }));
    out.add("/tool bandwidth-server", command("set", { enabled: "no" }));

    let discovery = "none";
    if (lldpMembers(ctx)) discovery = "lldp";
    else if (ctx.device.lldp) discovery = "all";
    out.add("/ip neighbor discovery-settings", command("set", { "discover-interface-list": discovery, protocol: "lldp" }));
}

/**
 * The platform keeps one community it will not delete. With version 2c it becomes the read community; without, it is disabled. Version 3 users are communities of their own.
 */
function snmp(out: Output, ctx: Context): void {
    const management = ctx.device.management ?? {};
    const snmp = management.snmp;

    if (!snmp) {
        out.add("/snmp", command("set", { enabled: "no" }));
        out.add("/snmp community", command("set [ find default=yes ]", { addresses: "::/0", name: "public" }));
        return;
    }

    const allow = (snmp.allow ?? management.allow ?? []).join(",");
    out.add("/snmp", command("set", { contact: snmp.contact ?? "", enabled: "yes", location: snmp.location ?? "" }));

    if (snmp.community) out.add("/snmp community", command("set [ find default=yes ]", { addresses: allow, name: marker(snmp.community) }));
    else out.add("/snmp community", command("set [ find default=yes ]", { addresses: "::/0", disabled: "yes", name: "public" }));

    for (const [name, user] of Object.entries(snmp.users ?? {})) {
        out.add(
            "/snmp community",
            command("add", {
                addresses: allow,
                "authentication-password": marker(user.auth_password),
                "authentication-protocol": SNMP_AUTH[user.auth],
                "encryption-password": marker(user.privacy_password),
                "encryption-protocol": SNMP_PRIVACY[user.privacy],
                name,
                security: "private",
            })
        );
    }
}

function users(out: Output, ctx: Context): void {
    for (const [name, user] of Object.entries(ctx.device.users ?? {})) {
        out.add(
            "/user",
            command("add", {
                comment: user.description,
                group: USER_GROUPS[user.role],
                name,
                password: marker(user.password),
            })
        );
        for (const key of user.ssh_keys ?? []) out.add("/user ssh-keys", command("add", { key, user: name }));
    }
}

/**
 * Certificates are not part of an export, so the reader lists them in this same form: a name, the SHA-256 fingerprint of the certificate, and whether the device holds its private key. A difference is installed from the config, not edited.
 */
function certificates(out: Output, ctx: Context): void {
    for (const [name, certificate] of Object.entries(ctx.device.certificates ?? {})) {
        out.add(
            "/certificate",
            command("add", {
                fingerprint: fingerprint(certificate.certificate),
                name,
                "private-key": yesNo(Boolean(certificate.private_key)),
            })
        );
    }
}

/** SHA-256 of the certificate's DER encoding, lowercase hex, as the platform prints it. */
export function fingerprint(pem: string): string {
    return new X509Certificate(pem).fingerprint256.replace(/:/g, "").toLowerCase();
}

/** Severity threshold to the topics the platform logs under, most severe first. */
const TOPICS: [Severity, string][] = [
    ["critical", "critical"],
    ["error", "error"],
    ["warning", "warning"],
    ["info", "info"],
    ["debug", "debug"],
];
const SEVERITY_ORDER: Severity[] = ["emergency", "alert", "critical", "error", "warning", "notice", "info", "debug"];

/** Every topic at or above a severity. Emergency and alert are logged as critical; the platform has no notice topic. */
function topicsFrom(level: Severity): string[] {
    // Emergency and alert fall back to critical, the most severe topic the platform has.
    const threshold = Math.max(SEVERITY_ORDER.indexOf(level), SEVERITY_ORDER.indexOf("critical"));

    return TOPICS.filter(([severity]) => SEVERITY_ORDER.indexOf(severity) <= threshold).map(([, topic]) => topic);
}

export function renderSystem(out: Output, ctx: Context): void {
    const system = ctx.device.system ?? {};

    out.add(
        "/ip settings",
        command("set", {
            "send-redirects": yesNo(system.ip?.icmp_redirects),
            "tcp-syncookies": yesNo(system.ip?.syn_cookies),
        })
    );
    out.add("/system identity", command("set", { name: ctx.device.name }));

    // Autodetect wins after a restart and has moved a router to another zone, so it is always off.
    out.add("/system clock", command("set", { "time-zone-autodetect": "no", "time-zone-name": system.timezone ?? "UTC" }));
    out.add("/system note", command("set", { note: system.banner ?? "", "show-at-login": "yes" }));

    out.add("/system ntp client", command("set", { enabled: yesNo(Boolean(system.ntp?.servers.length)) }));
    out.add("/system ntp server", command("set", { enabled: yesNo(system.ntp?.serve) }));
    for (const server of system.ntp?.servers ?? []) out.add("/system ntp client servers", command("add", { address: server }));

    logging(out, ctx);

    out.add("/system package update", command("set", { channel: system.release_channel ?? "stable" }));
    // Bootloader setup only from a deliberate key on the console, so line noise on a serial cable cannot enter it.
    out.add("/system routerboard settings", command("set", { "enter-setup-on": "delete-key" }));

    flowExport(out, ctx);
}

/** Local logging uses the platform's built-in disk action, number 1. Each remote collector gets an action of its own. */
function logging(out: Output, ctx: Context): void {
    const logging = ctx.device.system?.logging;
    const local = logging?.local;

    out.add(
        "/system logging action",
        command("set 1", {
            "disk-file-count": local?.files ?? 2,
            "disk-lines-per-file": local?.lines_per_file ?? 1000,
        })
    );
    for (const topic of local ? topicsFrom(local.level) : []) out.add("/system logging", command("add", { action: "disk", topics: topic }));

    (logging?.remote ?? []).forEach((collector, index) => {
        const action = `remote${index + 1}`;
        out.add(
            "/system logging action",
            command("add", {
                name: action,
                remote: collector.address,
                "remote-port": collector.port,
                target: "remote",
            })
        );
        for (const topic of topicsFrom(collector.level)) out.add("/system logging", command("add", { action, topics: topic }));
    });
}

/** NetFlow version 9 and IPFIX through traffic flow. The platform has no sFlow, which `unsupported()` reports. */
function flowExport(out: Output, ctx: Context): void {
    const flow = ctx.device.flow_export;
    if (!flow) {
        out.add("/ip traffic-flow", command("set", { enabled: "no" }));
        return;
    }

    const sampled = flow.sampling !== undefined && flow.sampling > 1;
    const interfaces = flow.interfaces?.map((iface) => ctx.name(iface)).join(",") ?? "all";
    out.add(
        "/ip traffic-flow",
        command("set", {
            enabled: "yes",
            interfaces,
            "packet-sampling": yesNo(sampled),
            "sampling-interval": sampled ? flow.sampling : undefined,
            "sampling-space": sampled ? 1 : undefined,
        })
    );

    const version = flow.protocol === "ipfix" ? "ipfix" : "9";

    for (const collector of flow.collectors) {
        out.add("/ip traffic-flow target", command("add", { "dst-address": collector.address, port: collector.port ?? 2055, version }));
    }
}

export function render(device: Device): string {
    const out = new Output();
    const ctx = new Context(device);

    renderInterfaces(out, ctx);
    renderAddressing(out, ctx);
    renderFirewall(out, ctx);
    renderRouting(out, ctx);
    renderManagement(out, ctx);
    renderSystem(out, ctx);

    return out.text();
}
