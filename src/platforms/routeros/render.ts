// The neutral model as a RouterOS 7 export, written in the form `/export` prints so the two compare line for line.

import { X509Certificate } from "node:crypto";
import { Utils } from "../../core/utils";
import { Address } from "../../core/address";
import { Secrets } from "../../core/secrets";
import type { Device, Family, Lag, Port, Prefix, Service, Severity, VlanInterface } from "../../model";
import { Catalog } from "../../core/catalog";
import { Derive, type NamedInterface } from "../../core/derive";
import { RouterOsFirewall } from "./firewall";
import { RouterOsRouting } from "./routing";

/** A property value as a command takes it. `undefined` and `false` leave the property out. */
export type Value = string | number | undefined | false;

type Speed = NonNullable<Port["speed"]>;

/** One device's render: the device, and the commands collected under their menu. */
export class RouterOsRender {
    /** The bridge every switched port joins. One per device. */
    private static readonly BRIDGE = "bridge";

    /** Destination of spanning tree BPDUs, so a filter can drop them on one port. */
    private static readonly BPDU_DESTINATION = "01:80:C2:00:00:00/FF:FF:FF:FF:FF:FF";

    /** The platform names a fixed speed by its medium: an optic in a cage, or copper. */
    private static readonly MEDIUM: Record<"optical" | "copper", Partial<Record<Speed, string>>> = {
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

    /** Address lists holding the prefixes BGP originates. A session reads the one of its family. */
    static readonly NETWORKS: Record<Family, string> = { ipv4: "bgp-networks-v4", ipv6: "bgp-networks-v6" };

    /** Neutral service name to the platform's. `native_protocol` is the platform's own desktop client. */
    private static readonly SERVICES = {
        ftp: "ftp",
        ssh: "ssh",
        telnet: "telnet",
        http: "www",
        https: "www-ssl",
        api: "api",
        api_tls: "api-ssl",
        native_protocol: "winbox",
    } as const;

    private static readonly USER_GROUPS = { admin: "full", operator: "write", "read-only": "read" } as const;

    private static readonly SNMP_PRIVACY = { aes128: "AES", des: "DES" } as const;

    /** Severity threshold to the topics the platform logs under, most severe first. */
    private static readonly TOPICS: [Severity, string][] = [
        ["critical", "critical"],
        ["error", "error"],
        ["warning", "warning"],
        ["info", "info"],
        ["debug", "debug"],
    ];
    private static readonly SEVERITY_ORDER: Severity[] = ["emergency", "alert", "critical", "error", "warning", "notice", "info", "debug"];

    private readonly ports: Record<string, Port>;

    /** Every interface that is not a port, kind by kind. */
    private readonly interfaces: NamedInterface[];

    /** Commands under their menu. */
    private readonly menus = new Map<string, string[]>();

    private constructor(private readonly device: Device) {
        this.ports = Object.fromEntries(Derive.ports(device));
        this.interfaces = Derive.interfaces(device);
    }

    /** The entries of a map keyed by name, without the names whose value is left out. */
    static entries<V>(map: { readonly [name: string]: V | undefined } | undefined): [string, V][] {
        return Object.entries(map ?? {}).flatMap(([name, value]) => (value === undefined ? [] : [[name, value] as [string, V]]));
    }

    /** A prefix set's prefixes, written as a list or as a map of named prefixes. Undefined for a set fetched from a registry. */
    static prefixesOf(device: Device, set: string): readonly Prefix[] | undefined {
        const declared = device.routing?.prefix_sets?.[set];
        if (!declared || !("prefixes" in declared)) return undefined;

        const prefixes = declared.prefixes;
        return Array.isArray(prefixes) ? prefixes : Object.values(prefixes);
    }

    /** The whole configuration the device should run. */
    static of(device: Device): string {
        const render = new RouterOsRender(device);

        render.interfaceMenus();
        render.addressing();
        RouterOsFirewall.render(render, device);
        RouterOsRouting.render(render, device);
        render.management();
        render.system();

        return render.text();
    }

    /** The platform's name for a fixed speed on a port, or undefined when it has none. */
    static medium(platformPortName: string, speed: Speed): string | undefined {
        const medium = platformPortName.startsWith("ether") ? "copper" : "optical";
        return RouterOsRender.MEDIUM[medium][speed];
    }

    /** Quote a value when it holds anything but plain characters. */
    private static quote(value: string): string {
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
    private static command(verb: string, properties: Record<string, Value>): string {
        const words = [verb];

        for (const [name, value] of Object.entries(properties)) {
            if (value === undefined || value === false) continue;

            const written = typeof value === "number" ? String(value) : RouterOsRender.quote(value);
            words.push(`${name}=${written}`);
        }

        return words.join(" ");
    }

    /** `yes` or `no`. */
    static yesNo(on: boolean | undefined): string {
        return on ? "yes" : "no";
    }

    /** Seconds as the platform writes a duration: `3600` becomes `1h`, `90` becomes `1m30s`. */
    static duration(seconds: number): string {
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

    /** The name of the VLAN interface under one with a MAC of its own, which takes the configured name itself. */
    private static underMacvlan(name: string): string {
        return `${name}-vlan`;
    }

    /** The interface holding one VRRP group. */
    private static vrrpName(iface: string, id: number): string {
        return `${iface}-vrrp${id}`;
    }

    /** `host:port` into its parts. The last colon separates them, so an IPv6 host keeps its own. */
    private static splitEndpoint(endpoint: string): { host: string; port: string } {
        const colon = endpoint.lastIndexOf(":");
        return { host: endpoint.slice(0, colon), port: endpoint.slice(colon + 1) };
    }

    /** SHA-256 of the certificate's DER encoding, lowercase hex, as the platform prints it. */
    private static fingerprint(pem: string): string {
        return new X509Certificate(pem).fingerprint256.replace(/:/g, "").toLowerCase();
    }

    /** Every topic at or above a severity. Emergency and alert are logged as critical; the platform has no notice topic. */
    private static topicsFrom(level: Severity): string[] {
        const order = RouterOsRender.SEVERITY_ORDER;
        // Emergency and alert fall back to critical, the most severe topic the platform has.
        const threshold = Math.max(order.indexOf(level), order.indexOf("critical"));

        return RouterOsRender.TOPICS.filter(([severity]) => order.indexOf(severity) <= threshold).map(([, topic]) => topic);
    }

    /** Add a line to a menu as it is. */
    private addLine(menu: string, line: string): void {
        const commands = this.menus.get(menu) ?? [];
        commands.push(line);
        this.menus.set(menu, commands);
    }

    /** Add a command to a menu. */
    add(menu: string, verb: string, properties: Record<string, Value>): void {
        this.addLine(menu, RouterOsRender.command(verb, properties));
    }

    /** The whole configuration as text. */
    private text(): string {
        const blocks = [...this.menus].map(([menu, commands]) => [menu, ...commands].join("\n"));
        return blocks.join("\n") + "\n";
    }

    /** What the platform calls a port or an interface. A port is spelled by the model; an interface keeps its config name. */
    name(portOrInterface: string): string {
        if (this.interfaces.some((entry) => entry.name === portOrInterface)) return portOrInterface;

        return Catalog.spell(this.device.platform, this.device.model, portOrInterface);
    }

    /** The number of a VLAN, by its config name. */
    vlanId(vlan: string): number {
        const declared = this.device.switching?.vlans?.[vlan];
        if (!declared) throw new Error(`${this.device.name}: VLAN ${vlan} is not declared`);
        return declared.id;
    }

    /** Ports and LAGs that are layer 2 members of a VLAN, with their settings. A port in a LAG is represented by the LAG. */
    private switched(): [string, Port | Lag][] {
        const ports = Object.entries(this.ports).filter(([, port]) => !port.in_lag && (port.access_vlan || port.trunk_vlans));
        const lags = RouterOsRender.entries(this.device.interfaces?.lag).filter(([, lag]) => Boolean(lag.access_vlan || lag.trunk_vlans));
        return [...ports, ...lags];
    }

    /** VLAN interfaces, with their settings. */
    private declaredVlanInterfaces(): [string, VlanInterface][] {
        return RouterOsRender.entries(this.device.interfaces?.vlan_interface);
    }

    /** Every port and interface that holds addresses or other layer 3 settings. Ports are named as the platform spells them. */
    private routed(): { name: string; settings: Port | NamedInterface["settings"] }[] {
        const ports = Object.entries(this.ports).map(([port, settings]) => ({ name: this.name(port), settings }));
        const interfaces = this.interfaces.map(({ name, settings }) => ({ name, settings }));
        return [...ports, ...interfaces];
    }

    private interfaceMenus(): void {
        this.hardwareOffload();
        this.bridge();
        this.ethernet();
        this.switchPorts();
        this.eoip();
        this.lags();
        this.vlanInterfaces();
        this.tunnels();
        this.wireguard();
        this.vrrp();
        this.bridgePorts();
        this.bridgeVlans();
        this.bridgeFilters();
        this.interfaceLists();
        this.vrfs();
        this.shaping();
    }

    /**
     * Routing in the switch chip. With it on, routed traffic bypasses the forward chain unless its interface opts out.
     *
     * Restarting the offload after a failure, and offloading IPv6 too, follow the same switch.
     */
    private hardwareOffload(): void {
        const on = RouterOsRender.yesNo(this.device.system?.hardware_offload);
        this.add("/interface ethernet switch", "set switch1", { "l3-hw-offloading": on });
        this.add("/interface ethernet switch l3hw-settings", "set", { autorestart: on, "ipv6-hw": on });
    }

    /** One VLAN-filtering bridge carries every switched port. A loopback is a bridge with no ports, the platform's idiom for one. */
    private bridge(): void {
        const { device } = this;
        const needsBridge = this.switched().length > 0 || this.declaredVlanInterfaces().length > 0;

        if (needsBridge) {
            const stp = device.switching?.stp;
            const protocolMode = stp ? (stp.mode ?? "rstp") : "none";
            const priority = stp?.priority === undefined ? undefined : `0x${stp.priority.toString(16)}`;
            this.add("/interface bridge", "add", {
                name: RouterOsRender.BRIDGE,
                "protocol-mode": protocolMode,
                priority,
                "vlan-filtering": "yes",
            });
        }

        for (const [name, loopback] of RouterOsRender.entries(device.interfaces?.loopback)) {
            this.add("/interface bridge", "add", { comment: loopback.description, name });
        }
    }

    /** Every port of the model is stated. One the config does not declare is disabled. */
    private ethernet(): void {
        const { device } = this;

        for (const port of Catalog.ports(device.platform, device.model)) {
            const selector = `set [ find default-name=${Catalog.spell(device.platform, device.model, port)} ]`;
            const settings = this.ports[port];
            if (!settings) {
                this.add("/interface ethernet", selector, { disabled: "yes" });
                continue;
            }

            const fixedSpeed = settings.speed && RouterOsRender.medium(Catalog.spell(device.platform, device.model, port), settings.speed);

            this.add("/interface ethernet", selector, {
                "auto-negotiation": fixedSpeed ? "no" : undefined,
                comment: settings.description,
                mtu: settings.mtu,
                speed: fixedSpeed,
            });
        }
    }

    /**
     * Storm control in the switch chip. The platform takes one rate, in percent, and which kinds of flooded traffic it limits.
     *
     * `unsupported()` refuses packets per second and different percentages per kind, so here they are always one shared percent.
     */
    private switchPorts(): void {
        for (const [port, settings] of Object.entries(this.ports)) {
            const storm = settings.storm_control;
            if (!storm) continue;

            const thresholds = [storm.broadcast, storm.multicast, storm.unknown_unicast].filter((threshold) => threshold !== undefined);
            const percent = thresholds.find((threshold) => "percent" in threshold);
            if (!percent || !("percent" in percent)) continue;

            this.add("/interface ethernet switch port", `set ${this.name(port)}`, {
                "limit-broadcasts": RouterOsRender.yesNo(storm.broadcast !== undefined),
                "limit-unknown-multicasts": RouterOsRender.yesNo(storm.multicast !== undefined),
                "limit-unknown-unicasts": RouterOsRender.yesNo(storm.unknown_unicast !== undefined),
                "storm-rate": percent.percent,
            });
        }
    }

    /** A LAG is a bonding interface. Its members, ports named as the platform spells them and then EoIP tunnels, are its slaves. */
    private lags(): void {
        for (const [name, lag] of RouterOsRender.entries(this.device.interfaces?.lag)) {
            const ports = Object.entries(this.ports)
                .filter(([, port]) => port.in_lag === name)
                .map(([port]) => this.name(port));
            const tunnels = RouterOsRender.entries(this.device.interfaces?.eoip)
                .filter(([, tunnel]) => tunnel.in_lag === name)
                .map(([tunnel]) => tunnel);
            const roundRobin = lag.mode === "round_robin";
            const check = lag.link_check;

            this.add("/interface bonding", "add", {
                "arp-interval": check && `${check.interval_ms}ms`,
                "arp-ip-targets": check?.arp_targets.join(","),
                comment: lag.description,
                "forced-mac-address": lag.mac?.toUpperCase(),
                "link-monitoring": check && "arp",
                mode: roundRobin ? "balance-rr" : lag.mode === "static" ? "balance-xor" : "802.3ad",
                mtu: lag.mtu,
                name,
                slaves: [...ports, ...tunnels].join(","),
                // Round robin sends each packet over the next member, whatever its flow.
                "transmit-hash-policy": roundRobin ? undefined : "layer-2-and-3",
            });
        }
    }

    /** An EoIP tunnel. A member of a LAG is listed among its slaves (`lags()`). */
    private eoip(): void {
        for (const [name, tunnel] of RouterOsRender.entries(this.device.interfaces?.eoip)) {
            this.add("/interface eoip", "add", {
                comment: tunnel.description,
                "local-address": Address.host(tunnel.local_address),
                mtu: tunnel.mtu,
                name,
                "remote-address": tunnel.remote_address,
                "tunnel-id": tunnel.tunnel_id,
            });
        }
    }

    /**
     * CAKE on what leaves an interface: what leaves it, of either family, is marked on its way out, and a queue tree under `global` holds the marked packets to the rate, CAKE as its queue. A virtual interface refuses a queue of its own that sets no rate, and a queue tree under the interface itself sees no packet (TRAPS.md).
     */
    private shaping(): void {
        const ports = Object.entries(this.ports).map(([port, settings]) => ({ name: this.name(port), settings }));
        for (const { name, settings } of [...ports, ...this.interfaces]) {
            const shaping = settings.shaping;
            if (!shaping) continue;

            const queue = RouterOsRender.shapingQueue(name);
            for (const menu of ["/ip firewall mangle", "/ipv6 firewall mangle"]) {
                this.add(menu, "add", {
                    action: "mark-packet",
                    chain: "postrouting",
                    comment: `Shaping of ${name}`,
                    "new-packet-mark": queue,
                    "out-interface": name,
                });
            }
            this.add("/queue type", "add", { kind: "cake", name: queue });
            this.add("/queue tree", "add", { "max-limit": `${shaping.mbps}M`, name: queue, "packet-mark": queue, parent: "global", queue });
        }
    }

    /** The queue type that shapes what leaves an interface: the interface's name, then `-cake`. */
    static shapingQueue(iface: string): string {
        return `${iface}-cake`;
    }

    /**
     * A VLAN interface sits on the bridge. When the device offloads, one that opts out is routed in software so the firewall applies.
     *
     * Every VLAN interface on the bridge has the bridge's MAC. One with a MAC of its own is a MACVLAN on top of the VLAN interface: the MACVLAN takes the configured name, so its addresses and every rule naming it land on it.
     */
    private vlanInterfaces(): void {
        for (const [name, iface] of this.declaredVlanInterfaces()) {
            const softwareOnly = this.device.system?.hardware_offload && iface.hardware_offload === false;
            const vlanName = iface.mac ? RouterOsRender.underMacvlan(name) : name;

            this.add("/interface vlan", "add", {
                comment: iface.description,
                interface: RouterOsRender.BRIDGE,
                "l3-hw-offloading": softwareOnly ? "no" : undefined,
                mtu: iface.mtu,
                name: vlanName,
                "vlan-id": this.vlanId(iface.vlan),
            });

            if (iface.mac) {
                this.add("/interface macvlan", "add", {
                    comment: iface.description,
                    interface: vlanName,
                    "mac-address": iface.mac.toUpperCase(),
                    mtu: iface.mtu,
                    name,
                });
            }
        }
    }

    private tunnels(): void {
        for (const [name, gre] of RouterOsRender.entries(this.device.interfaces?.gre)) {
            this.add("/interface gre", "add", {
                comment: gre.description,
                "local-address": Address.host(gre.local_address),
                mtu: gre.mtu,
                name,
                "remote-address": gre.remote_address,
            });
        }

        for (const [name, vxlan] of RouterOsRender.entries(this.device.interfaces?.vxlan)) {
            // 4789 is the platform's default and is not written.
            const port = vxlan.port && vxlan.port !== 4789 ? vxlan.port : undefined;
            this.add("/interface vxlan", "add", {
                comment: vxlan.description,
                "local-address": Address.host(vxlan.local_address),
                "mac-address": vxlan.mac,
                mtu: vxlan.mtu,
                name,
                port,
                vni: vxlan.vni,
            });
            this.add("/interface vxlan vteps", "add", { interface: name, "remote-ip": vxlan.remote_address });
        }
    }

    private wireguard(): void {
        for (const [name, iface] of RouterOsRender.entries(this.device.interfaces?.wireguard)) {
            this.add("/interface wireguard", "add", {
                comment: iface.description,
                "listen-port": iface.listen_port,
                mtu: iface.mtu,
                name,
                "private-key": Secrets.marker(iface.private_key),
            });

            // The tunnel's own packets leave from its port: marked in the output chain, they are routed by the table alone.
            if (iface.routing_table) {
                for (const menu of ["/ip firewall mangle", "/ipv6 firewall mangle"]) {
                    this.add(menu, "add", {
                        action: "mark-routing",
                        chain: "output",
                        comment: `${name} by ${iface.routing_table}`,
                        "new-routing-mark": iface.routing_table,
                        passthrough: "no",
                        protocol: "udp",
                        "src-port": iface.listen_port,
                    });
                }
            }

            for (const peer of iface.peers ?? []) {
                const endpoint = peer.endpoint ? RouterOsRender.splitEndpoint(peer.endpoint) : undefined;
                this.add("/interface wireguard peers", "add", {
                    "allowed-address": peer.allowed_addresses.join(","),
                    "client-allowed-address": peer.client_allowed_addresses?.join(","),
                    "endpoint-address": endpoint?.host,
                    "endpoint-port": endpoint?.port,
                    interface: name,
                    // Peer names are unique across the device, so they carry the interface.
                    name: `${name}-${peer.name}`,
                    "persistent-keepalive": peer.keepalive ? RouterOsRender.duration(peer.keepalive) : undefined,
                    "public-key": peer.public_key,
                });
            }
        }
    }

    /** Each VRRP group is an interface of its own, holding the shared address. Version 3 carries IPv6. */
    private vrrp(): void {
        for (const { name, settings } of this.routed()) {
            for (const group of settings.vrrp ?? []) {
                const ipv6 = Address.family(group.address) === "ipv6";
                this.add("/interface vrrp", "add", {
                    interface: name,
                    interval: group.interval ? RouterOsRender.duration(group.interval) : undefined,
                    name: RouterOsRender.vrrpName(name, group.id),
                    "preemption-mode": RouterOsRender.yesNo(group.preempt),
                    priority: group.priority,
                    "v3-protocol": ipv6 ? "ipv6" : undefined,
                    version: ipv6 ? 3 : undefined,
                    vrid: group.id,
                });
            }
        }
    }

    /** A switched port or LAG joins the bridge. Its untagged VLAN is its port VLAN ID. */
    private bridgePorts(): void {
        for (const [port, settings] of this.switched()) {
            const isTrunk = Boolean(settings.trunk_vlans);
            const untagged = isTrunk ? settings.native_vlan : settings.access_vlan;
            const pvid = untagged ? this.vlanId(untagged) : undefined;

            // A trunk without a native VLAN takes tagged frames only; an access port untagged only.
            let frameTypes: string | undefined;
            if (!isTrunk) frameTypes = "admit-only-untagged-and-priority-tagged";
            else if (pvid === undefined) frameTypes = "admit-only-vlan-tagged";

            const stp = typeof settings.stp === "object" ? settings.stp : undefined;
            this.add("/interface bridge port", "add", {
                bridge: RouterOsRender.BRIDGE,
                edge: stp?.edge ? "yes" : undefined,
                "frame-types": frameTypes,
                interface: this.name(port),
                "path-cost": stp?.cost,
                priority: stp?.priority === undefined ? undefined : `0x${stp.priority.toString(16)}`,
                pvid,
            });
        }
    }

    /** A VLAN is tagged on every trunk carrying it, and on the bridge itself when the router has an interface in it. */
    private bridgeVlans(): void {
        for (const [vlanName, vlan] of RouterOsRender.entries(this.device.switching?.vlans)) {
            const routedHere = this.declaredVlanInterfaces().some(([, iface]) => iface.vlan === vlanName);
            const trunks = this.switched()
                .filter(([, settings]) => settings.trunk_vlans?.includes(vlanName))
                .map(([port]) => this.name(port));
            const tagged = [...(routedHere ? [RouterOsRender.BRIDGE] : []), ...trunks];
            if (!tagged.length) continue;

            this.add("/interface bridge vlan", "add", {
                bridge: RouterOsRender.BRIDGE,
                comment: vlan.description,
                tagged: tagged.join(","),
                "vlan-ids": vlan.id,
            });
        }
    }

    /** The platform cannot take a port out of spanning tree, so `stp: false` drops the BPDUs it would send and receive. */
    private bridgeFilters(): void {
        for (const [port, settings] of this.switched()) {
            if (settings.stp !== false) continue;

            const name = this.name(port);
            const comment = `${name} out of spanning tree`;
            this.add("/interface bridge filter", "add", {
                action: "drop",
                chain: "input",
                comment,
                "dst-mac-address": RouterOsRender.BPDU_DESTINATION,
                "in-interface": name,
            });
            this.add("/interface bridge filter", "add", {
                action: "drop",
                chain: "output",
                comment,
                "dst-mac-address": RouterOsRender.BPDU_DESTINATION,
                "out-interface": name,
            });
        }
    }

    /**
     * Interface lists scope what works at layer 2: neighbor discovery, and the platform's own client over MAC. The IP firewall never sees either.
     */
    private interfaceLists(): void {
        const lists = new Map<string, string[]>();

        const lldp = this.lldpMembers();
        if (lldp) lists.set("lldp", lldp);

        const native = this.device.management?.native_protocol?.interfaces;
        if (native)
            lists.set(
                "native",
                native.map((member) => this.name(member))
            );

        for (const list of lists.keys()) this.add("/interface list", "add", { name: list });
        for (const [list, members] of lists)
            for (const member of members)
                this.add("/interface list member", "add", {
                    interface: member,
                    list,
                });
    }

    /**
     * Where LLDP runs, when it is limited to some ports. Undefined when it runs everywhere or nowhere, which the discovery settings say directly.
     */
    private lldpMembers(): string[] | undefined {
        const lldp = this.device.switching?.lldp;
        if (!lldp) return undefined;

        const overridden = Object.entries(this.ports).filter(([, port]) => port.lldp !== undefined);
        if (lldp === true && !overridden.length) return undefined;

        const base = lldp === true ? Object.keys(this.ports) : [...lldp.interfaces];
        const members = new Set(base.map((member) => this.name(member)));

        for (const [port, settings] of overridden) {
            if (settings.lldp) members.add(this.name(port));
            else members.delete(this.name(port));
        }

        return [...members];
    }

    /** A VRF lists its interfaces. */
    private vrfs(): void {
        for (const [vrf, settings] of RouterOsRender.entries(this.device.routing?.vrfs)) {
            const members = this.routed()
                .filter(({ settings: iface }) => iface.vrf === vrf)
                .map(({ name }) => name);
            this.add("/ip vrf", "add", { comment: settings.description, interfaces: members.join(","), name: vrf });
        }
    }

    private addressing(): void {
        this.addresses();
        this.routerAdvertisements();
        this.dhcpClients();
        this.dhcp();
        this.dns();
        this.upnp();
        this.addressLists();
    }

    /** Every address goes on the menu of its family, with the interface's description as its comment. */
    private addresses(): void {
        for (const { name, settings } of this.routed()) {
            for (const entry of settings.addresses ?? []) {
                const address = typeof entry === "string" ? entry : entry.address;
                // The far end of a point-to-point address, which the platform calls its network.
                const peer = typeof entry === "string" ? undefined : entry.peer_address;

                if (Address.family(address) === "ipv4") {
                    this.add("/ip address", "add", { address, comment: settings.description, interface: name, network: peer });
                } else {
                    this.add("/ipv6 address", "add", {
                        address,
                        advertise: RouterOsRender.yesNo(settings.ipv6_ra),
                        comment: settings.description,
                        interface: name,
                    });
                }
            }

            // A VRRP address lives on the group's own interface, as a host address.
            for (const group of settings.vrrp ?? []) {
                const vrrpInterface = RouterOsRender.vrrpName(name, group.id);
                const comment = `VRRP ${group.id} on ${name}`;
                if (Address.family(group.address) === "ipv4") {
                    this.add("/ip address", "add", { address: `${group.address}/32`, comment, interface: vrrpInterface });
                } else {
                    this.add("/ipv6 address", "add", {
                        address: `${group.address}/128`,
                        advertise: "no",
                        comment,
                        interface: vrrpInterface,
                    });
                }
            }
        }
    }

    /**
     * Router advertisements only where the config sends them. The platform's default entry sends them on every interface, so it is turned off once one interface names its own. A device that uses none keeps the platform's default.
     */
    private routerAdvertisements(): void {
        const sending = this.routed().filter(({ settings }) => settings.ipv6_ra);
        if (!sending.length) return;

        this.add("/ipv6 nd", "set [ find default=yes ]", { disabled: "yes" });
        for (const { name } of sending) this.add("/ipv6 nd", "add", { interface: name });
    }

    /** A port that takes its address by DHCP. The client is named after its port, and the server's DNS and time servers are never used. */
    private dhcpClients(): void {
        for (const [port, settings] of Object.entries(this.ports)) {
            const client = settings.dhcp_client;
            if (!client) continue;

            const routes = client.default_routes;
            const name = this.name(port);
            this.add("/ip dhcp-client", "add", {
                "add-default-route": routes && !routes.length ? "no" : undefined,
                "default-route-tables": routes?.length
                    ? routes.map((route) => `${route.routing_table ?? "main"}:${route.distance ?? 1}`).join(",")
                    : undefined,
                interface: name,
                name,
                "use-peer-dns": "no",
                "use-peer-ntp": "no",
            });
        }
    }

    private dhcp(): void {
        for (const [name, server] of Object.entries(this.device.services?.dhcp_server ?? {})) {
            const [first, last] = server.pool;
            // The pool shares the server's name.
            this.add("/ip pool", "add", { name, ranges: `${first}-${last}` });
            this.add("/ip dhcp-server", "add", {
                "address-pool": name,
                interface: this.name(server.interface),
                "lease-time": server.lease_time ? RouterOsRender.duration(server.lease_time) : undefined,
                name,
            });
            this.add("/ip dhcp-server network", "add", {
                address: server.network,
                "dns-server": server.dns?.join(","),
                gateway: server.gateway,
            });

            for (const reservation of server.reservations ?? []) {
                this.add("/ip dhcp-server lease", "add", {
                    address: reservation.address,
                    comment: reservation.description,
                    "mac-address": reservation.mac,
                    server: name,
                });
            }
        }

        for (const [name, relay] of Object.entries(this.device.services?.dhcp_relay ?? {})) {
            this.add("/ip dhcp-relay", "add", { "dhcp-server": relay.servers.join(","), interface: this.name(relay.interface), name });
        }
    }

    /** UPnP: on, with where hosts ask and where the opened ports are reached from. */
    private upnp(): void {
        const upnp = this.device.services?.upnp;
        if (!upnp) return;

        this.add("/ip upnp", "set", { enabled: "yes" });
        for (const iface of upnp.internal) this.add("/ip upnp interfaces", "add", { interface: this.name(iface), type: "internal" });
        this.add("/ip upnp interfaces", "add", {
            "forced-ip": upnp.external_address,
            interface: this.name(upnp.external),
            type: "external",
        });
    }

    private dns(): void {
        const servers = this.device.system?.dns?.servers;
        this.add("/ip dns", "set", {
            "allow-remote-requests": RouterOsRender.yesNo(this.device.services?.dns_server),
            servers: servers?.join(",") ?? "",
        });
    }

    /**
     * Address lists come from firewall address sets, prefix sets typed in the config, and what BGP originates.
     *
     * A prefix set fetched from a registry is filled by `refresh`, so only its name is marked, and the plan leaves its entries alone.
     */
    private addressLists(): void {
        const { device } = this;
        const entries: { list: string; address: string }[] = [];

        for (const [list, members] of RouterOsRender.entries(device.firewall?.address_sets)) {
            for (const address of members) entries.push({ list, address });
        }

        for (const [list] of RouterOsRender.entries(device.routing?.prefix_sets)) {
            const prefixes = RouterOsRender.prefixesOf(device, list);
            if (prefixes) for (const address of prefixes) entries.push({ list, address });
            else this.addLine("/ip firewall address-list", `# generated ${list}`);
        }

        for (const prefix of device.routing?.bgp?.originated_prefixes ?? []) {
            entries.push({ list: RouterOsRender.NETWORKS[Address.family(Address.host(prefix))], address: prefix });
        }

        for (const family of ["ipv4", "ipv6"] as const) {
            const menu = family === "ipv4" ? "/ip firewall address-list" : "/ipv6 firewall address-list";

            for (const { list, address } of entries) {
                if (Address.family(Address.host(address)) !== family) continue;

                this.add(menu, "add", { address, list });
            }
        }
    }

    private management(): void {
        this.services();
        this.layerTwo();
        this.snmp();
        this.users();
        this.certificates();
    }

    /** The sources a service takes: its own, or `management.allow`. `unsupported()` refuses an address set named there. */
    private allowed(own: readonly Prefix[] | undefined): readonly string[] {
        const shared = this.device.management?.allow;
        return own ?? (typeof shared === "string" ? [] : shared) ?? [];
    }

    /** Every service the platform has is stated. One the config does not name is disabled. */
    private services(): void {
        const management = this.device.management ?? {};

        for (const [neutral, platform] of Object.entries(RouterOsRender.SERVICES)) {
            const service = management[neutral as keyof typeof RouterOsRender.SERVICES] as (Service & { certificate?: string }) | undefined;
            if (!service) {
                this.add("/ip service", `set ${platform}`, { disabled: "yes" });
                continue;
            }

            const allow = this.allowed(service.allow);
            this.add("/ip service", `set ${platform}`, {
                address: allow.join(","),
                certificate: service.certificate,
                disabled: "no",
                port: service.port,
            });
        }

        // A newer service with no neutral name. Off, as everything not stated is.
        this.add("/ip service", "set reverse-proxy", { disabled: "yes" });
        // A user with a key of its own may otherwise not log in by password, which is how Circuit logs in (RB5009, 7.24.6).
        const keys = Object.values(this.device.system?.users ?? {}).some((user) => user?.ssh_keys?.length);
        this.add("/ip ssh", "set", {
            "password-authentication": keys ? "yes" : undefined,
            "strong-crypto": RouterOsRender.yesNo(!management.ssh?.weak_crypto),
        });
    }

    /** What works at layer 2: the platform's client over MAC, MAC ping, the bandwidth test server and neighbor discovery. */
    private layerTwo(): void {
        const nativeList = this.device.management?.native_protocol?.interfaces ? "native" : "none";
        this.add("/tool mac-server", "set", { "allowed-interface-list": nativeList });
        this.add("/tool mac-server mac-winbox", "set", { "allowed-interface-list": nativeList });
        this.add("/tool mac-server ping", "set", { enabled: "no" });
        this.add("/tool bandwidth-server", "set", { enabled: "no" });

        let discovery = "none";
        if (this.lldpMembers()) discovery = "lldp";
        else if (this.device.switching?.lldp) discovery = "all";
        this.add("/ip neighbor discovery-settings", "set", { "discover-interface-list": discovery, protocol: "lldp" });
    }

    /**
     * The platform keeps one community it will not delete. With version 2c it becomes the read community; without, it is disabled. Version 3 users are communities of their own.
     */
    private snmp(): void {
        const snmp = this.device.monitoring?.snmp;

        if (!snmp) {
            this.add("/snmp", "set", { enabled: "no" });
            this.add("/snmp community", "set [ find default=yes ]", { addresses: "::/0", name: "public" });
            return;
        }

        const allow = this.allowed(snmp.allow).join(",");
        this.add("/snmp", "set", { contact: snmp.contact ?? "", enabled: "yes", location: snmp.location ?? "" });

        if (snmp.community)
            this.add("/snmp community", "set [ find default=yes ]", { addresses: allow, name: Secrets.marker(snmp.community) });
        else this.add("/snmp community", "set [ find default=yes ]", { addresses: "::/0", disabled: "yes", name: "public" });

        for (const [name, user] of Object.entries(snmp.users ?? {})) {
            this.add("/snmp community", "add", {
                addresses: allow,
                "authentication-password": Secrets.marker(user.auth_password),
                // SHA1 only: unsupported() refuses sha256, so it is never written as SHA1.
                "authentication-protocol": "SHA1",
                "encryption-password": Secrets.marker(user.privacy_password),
                "encryption-protocol": RouterOsRender.SNMP_PRIVACY[user.privacy],
                name,
                security: "private",
            });
        }
    }

    private users(): void {
        for (const [name, user] of RouterOsRender.entries(this.device.system?.users)) {
            this.add("/user", "add", {
                comment: user.description,
                group: RouterOsRender.USER_GROUPS[user.role],
                name,
                password: Secrets.marker(user.password),
            });
            for (const key of user.ssh_keys ?? []) this.add("/user ssh-keys", "add", { key, user: name });
        }
    }

    /**
     * Certificates are not part of an export, so the reader lists them in this same form: a name, the SHA-256 fingerprint of the certificate, and whether the device holds its private key. A difference is installed from the config, not edited.
     */
    private certificates(): void {
        for (const [name, certificate] of RouterOsRender.entries(this.device.system?.certificates)) {
            this.add("/certificate", "add", {
                fingerprint: RouterOsRender.fingerprint(Utils.projectFile(certificate.certificate_file)),
                name,
                "private-key": RouterOsRender.yesNo(Boolean(certificate.private_key)),
            });
        }
    }

    private system(): void {
        const system = this.device.system ?? {};

        this.add("/ip settings", "set", {
            "send-redirects": RouterOsRender.yesNo(system.ip_stack?.icmp_redirects),
            "tcp-syncookies": RouterOsRender.yesNo(system.ip_stack?.syn_cookies),
        });
        this.add("/system identity", "set", { name: this.device.name });

        // Autodetect wins after a restart and has moved a router to another zone, so it is always off.
        this.add("/system clock", "set", { "time-zone-autodetect": "no", "time-zone-name": system.timezone ?? "UTC" });
        this.add("/system note", "set", { note: system.banner ?? "", "show-at-login": "yes" });

        this.add("/system ntp client", "set", { enabled: RouterOsRender.yesNo(Boolean(system.ntp?.servers.length)) });
        this.add("/system ntp server", "set", { enabled: RouterOsRender.yesNo(this.device.services?.ntp_server) });
        for (const server of system.ntp?.servers ?? []) this.add("/system ntp client servers", "add", { address: server });

        this.logging();

        this.add("/system package update", "set", { channel: system.release_channel ?? "stable" });
        // Bootloader setup only from a deliberate key on the console, so line noise on a serial cable cannot enter it.
        if (Catalog.serialConsole(this.device.platform, this.device.model))
            this.add("/system routerboard settings", "set", { "enter-setup-on": "delete-key" });

        this.flowExport();
    }

    /** Local logging uses the platform's built-in disk action, number 1. Each syslog collector gets an action of its own. */
    private logging(): void {
        const local = this.device.system?.logging?.local;

        this.add("/system logging action", "set 1", {
            "disk-file-count": local?.files ?? 2,
            "disk-lines-per-file": local?.lines_per_file ?? 1000,
        });
        for (const topic of local ? RouterOsRender.topicsFrom(local.level) : []) {
            this.add("/system logging", "add", { action: "disk", topics: topic });
        }

        (this.device.monitoring?.syslog ?? []).forEach((collector, index) => {
            const action = `remote${index + 1}`;
            this.add("/system logging action", "add", {
                name: action,
                remote: collector.address,
                "remote-port": collector.port,
                target: "remote",
            });
            for (const topic of RouterOsRender.topicsFrom(collector.level)) this.add("/system logging", "add", { action, topics: topic });
        });
    }

    /** NetFlow version 9 and IPFIX through traffic flow. The platform has no sFlow, which `unsupported()` reports. */
    private flowExport(): void {
        const flow = this.device.monitoring?.flow_export;
        if (!flow) {
            this.add("/ip traffic-flow", "set", { enabled: "no" });
            return;
        }

        const sampled = flow.sampling !== undefined && flow.sampling > 1;
        const interfaces = flow.interfaces?.map((iface) => this.name(iface)).join(",") ?? "all";
        this.add("/ip traffic-flow", "set", {
            enabled: "yes",
            interfaces,
            "packet-sampling": RouterOsRender.yesNo(sampled),
            "sampling-interval": sampled ? flow.sampling : undefined,
            "sampling-space": sampled ? 1 : undefined,
        });

        const version = flow.protocol === "ipfix" ? "ipfix" : "9";

        for (const collector of flow.collectors) {
            this.add("/ip traffic-flow target", "add", { "dst-address": collector.address, port: collector.port ?? 2055, version });
        }
    }
}
