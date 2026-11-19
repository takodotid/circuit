// The model as a RouterOS 7 export, written in the form `/export` prints so the two compare line for line.

import { X509Certificate } from "node:crypto";
import { Utils } from "../../core/utils";
import { Address } from "../../core/address";
import { Secrets } from "../../core/secrets";
import type { Device, Lag, Port, Prefix, Service, Severity, VlanInterface } from "../../model";
import { Catalog } from "../../core/catalog";
import { Derive } from "../../core/derive";
import type { NamedInterface } from "../../core/derive";
import { RouterOsDhcp } from "./dhcp";
import { RouterOsFirewall } from "./firewall";
import { RouterOsMonitoring } from "./monitoring";
import { RouterOsRouting } from "./routing";
import { RouterOsSyntax } from "./syntax";

/** A property value as a command takes it. `undefined` and `false` leave the property out. */
export type Value = string | number | undefined | false;

type Speed = NonNullable<Port["speed"]>;

export class RouterOsRender {
    /** The bridge every switched port joins. One per device. */
    private static readonly BRIDGE = "bridge";

    /** The split horizon of every isolated port: ports with the same horizon never forward to each other. */
    private static readonly ISOLATED_HORIZON = 1;

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

    /** `native_protocol` is the platform's own desktop client. */
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

    private readonly menus = new Map<string, string[]>();

    private constructor(private readonly device: Device) {
        this.ports = Object.fromEntries(Derive.ports(device));
        this.interfaces = Derive.interfaces(device);
    }

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

    /** A verb such as `add` or `set [ find name=x ]`, then `property=value` for each property that has a value, in the order given. */
    private static command(verb: string, properties: Record<string, Value>): string {
        const words = [verb];

        for (const [name, value] of Object.entries(properties)) {
            if (value === undefined || value === false) continue;

            const written = typeof value === "number" ? String(value) : RouterOsRender.quote(value);
            words.push(`${name}=${written}`);
        }

        return words.join(" ");
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

    /** Every topic at or above a severity. Emergency and alert are logged as critical, the most severe topic the platform has. It has no notice topic. */
    private static topicsFrom(level: Severity): string[] {
        const order = RouterOsRender.SEVERITY_ORDER;
        const threshold = Math.max(order.indexOf(level), order.indexOf("critical"));

        return RouterOsRender.TOPICS.filter(([severity]) => order.indexOf(severity) <= threshold).map(([, topic]) => topic);
    }

    /** Add a line to a menu as it is. */
    private addLine(menu: string, line: string): void {
        const commands = this.menus.get(menu) ?? [];
        commands.push(line);
        this.menus.set(menu, commands);
    }

    add(menu: string, verb: string, properties: Record<string, Value>): void {
        this.addLine(menu, RouterOsRender.command(verb, properties));
    }

    private text(): string {
        const blocks = [...this.menus].map(([menu, commands]) => [menu, ...commands].join("\n"));
        return `${blocks.join("\n")}\n`;
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
        const switches = (settings: Port | Lag) => Boolean(settings.access_vlan || settings.trunk_vlans || settings.qinq_vlan);
        const ports = Object.entries(this.ports).filter(([, port]) => !port.in_lag && switches(port));
        const lags = RouterOsSyntax.entries(this.device.interfaces?.lag).filter(([, lag]) => switches(lag));
        return [...ports, ...lags];
    }

    private declaredVlanInterfaces(): [string, VlanInterface][] {
        return RouterOsSyntax.entries(this.device.interfaces?.vlan_interface);
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

    /** Routing in the switch chip. With it on, routed traffic bypasses the forward chain unless its interface opts out. Restarting after a failure, and offloading IPv6, follow it. */
    private hardwareOffload(): void {
        const on = RouterOsSyntax.yesNo(this.device.system?.hardware_offload);
        this.add("/interface ethernet switch", "set switch1", { "l3-hw-offloading": on });
        this.add("/interface ethernet switch l3hw-settings", "set", { autorestart: on, "ipv6-hw": on });
    }

    /** One VLAN-filtering bridge carries every switched port. A loopback is a bridge with no ports, the platform's idiom for one. */
    private bridge(): void {
        const { device } = this;
        if (this.switched().length > 0 || this.declaredVlanInterfaces().length > 0) {
            const stp = device.switching?.stp;
            this.add("/interface bridge", "add", {
                "dhcp-snooping": RouterOsSyntax.yesWhen(device.switching?.dhcp_snooping),
                name: RouterOsRender.BRIDGE,
                "protocol-mode": stp ? (stp.mode ?? "rstp") : "none",
                priority: RouterOsSyntax.hex(stp?.priority),
                "ra-guard": RouterOsSyntax.yesWhen(device.switching?.ra_guard),
                "vlan-filtering": "yes",
            });
        }

        for (const [name, loopback] of RouterOsSyntax.entries(device.interfaces?.loopback)) {
            this.add("/interface bridge", "add", { comment: loopback.description, name });
        }
    }

    /** Every port of the model is stated. One the config does not declare is disabled. A virtual router's adapters are known only to the read, so there the plan disables those the render does not state. */
    private ethernet(): void {
        const { device } = this;

        for (const port of Catalog.devicePorts(device)) {
            const selector = `set ${RouterOsSyntax.port(Catalog.spell(device.platform, device.model, port))}`;
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

    /** Storm control in the switch chip: one rate, in percent, and the kinds of flooded traffic it limits. `unsupported()` refuses packets per second and a percent per kind. */
    private switchPorts(): void {
        for (const [port, settings] of Object.entries(this.ports)) {
            const storm = settings.storm_control;
            if (!storm) continue;

            const thresholds = [storm.broadcast, storm.multicast, storm.unknown_unicast].filter((threshold) => threshold !== undefined);
            const percent = thresholds.find((threshold) => "percent" in threshold);
            if (!percent || !("percent" in percent)) continue;

            this.add("/interface ethernet switch port", `set ${this.name(port)}`, {
                "limit-broadcasts": RouterOsSyntax.yesNo(storm.broadcast !== undefined),
                "limit-unknown-multicasts": RouterOsSyntax.yesNo(storm.multicast !== undefined),
                "limit-unknown-unicasts": RouterOsSyntax.yesNo(storm.unknown_unicast !== undefined),
                "storm-rate": percent.percent,
            });
        }
    }

    /** A LAG is a bonding interface. Its members, ports named as the platform spells them and then EoIP tunnels, are its slaves. */
    private lags(): void {
        for (const [name, lag] of RouterOsSyntax.entries(this.device.interfaces?.lag)) {
            const ports = Object.entries(this.ports)
                .filter(([, port]) => port.in_lag === name)
                .map(([port]) => this.name(port));
            const tunnels = RouterOsSyntax.entries(this.device.interfaces?.eoip)
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

    /** A tunnel in a LAG is listed among the LAG's slaves (`lags()`). */
    private eoip(): void {
        for (const [name, tunnel] of RouterOsSyntax.entries(this.device.interfaces?.eoip)) {
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
     * CAKE on what leaves an interface. What leaves it, of either family, is marked on its way out. A queue tree under `global` holds the marked packets to the rate, with CAKE as its queue. A virtual interface refuses a queue of its own that sets no rate, and a queue tree under the interface sees no packet (TRAPS.md).
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

    /** The queue type that shapes what leaves an interface. */
    private static shapingQueue(iface: string): string {
        return `${iface}-cake`;
    }

    /**
     * When the device offloads, a VLAN interface that opts out is routed in software, so the firewall applies. Every VLAN interface on the bridge has the bridge's MAC. One with a MAC of its own is a MACVLAN on the VLAN interface. The MACVLAN takes the configured name, so its addresses and the rules naming it land on it.
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
        for (const [name, gre] of RouterOsSyntax.entries(this.device.interfaces?.gre)) {
            this.add("/interface gre", "add", {
                comment: gre.description,
                "local-address": Address.host(gre.local_address),
                mtu: gre.mtu,
                name,
                "remote-address": gre.remote_address,
            });
        }

        for (const [name, vxlan] of RouterOsSyntax.entries(this.device.interfaces?.vxlan)) {
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
        for (const [name, iface] of RouterOsSyntax.entries(this.device.interfaces?.wireguard)) {
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
                    // The router's generated client config ends it with the interface's listen port.
                    "client-endpoint": iface.endpoint && Address.host(iface.endpoint),
                    "endpoint-address": endpoint?.host,
                    "endpoint-port": endpoint?.port,
                    interface: name,
                    // Peer names are unique across the device, so they carry the interface.
                    name: `${name}-${peer.name}`,
                    "persistent-keepalive": peer.keepalive ? RouterOsSyntax.duration(peer.keepalive) : undefined,
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
                    interval: group.interval ? RouterOsSyntax.duration(group.interval) : undefined,
                    name: RouterOsRender.vrrpName(name, group.id),
                    "preemption-mode": RouterOsSyntax.yesNo(group.preempt),
                    priority: group.priority,
                    "v3-protocol": ipv6 ? "ipv6" : undefined,
                    version: ipv6 ? 3 : undefined,
                    vrid: group.id,
                });
            }
        }
    }

    /** A switched port or LAG joins the bridge. Its untagged VLAN is its port VLAN ID. A port in a secondary VLAN (RFC 5517) is in its primary VLAN, and an isolated one is kept from the others by its split horizon. A QinQ port takes every frame as untagged, and tags it. */
    private bridgePorts(): void {
        for (const [port, settings] of this.switched()) {
            const isTrunk = Boolean(settings.trunk_vlans);
            const untagged = settings.qinq_vlan ?? (isTrunk ? settings.native_vlan : settings.access_vlan);
            const secondary = untagged ? this.device.switching?.vlans?.[untagged]?.private_vlan : undefined;
            const pvid = untagged ? this.vlanId(secondary?.primary ?? untagged) : undefined;

            // A trunk without a native VLAN takes tagged frames only; an access port untagged only.
            let frameTypes: string | undefined;
            if (settings.access_vlan) frameTypes = "admit-only-untagged-and-priority-tagged";
            else if (pvid === undefined) frameTypes = "admit-only-vlan-tagged";

            const stp = typeof settings.stp === "object" ? settings.stp : undefined;
            this.add("/interface bridge port", "add", {
                "bpdu-guard": RouterOsSyntax.yesWhen(stp?.bpdu_guard),
                bridge: RouterOsRender.BRIDGE,
                edge: stp?.edge ? "yes" : undefined,
                "frame-types": frameTypes,
                horizon: secondary?.type === "isolated" ? RouterOsRender.ISOLATED_HORIZON : undefined,
                interface: this.name(port),
                "path-cost": stp?.cost,
                priority: RouterOsSyntax.hex(stp?.priority),
                pvid,
                "restricted-role": RouterOsSyntax.yesWhen(stp?.guard === "root"),
                "tag-stacking": RouterOsSyntax.yesWhen(Boolean(settings.qinq_vlan)),
                trusted: RouterOsSyntax.yesWhen(settings.dhcp_trusted),
                "trusted-ra": RouterOsSyntax.yesWhen(settings.ra_trusted),
            });
        }
    }

    /** A VLAN is tagged on every trunk carrying it, and on the bridge itself when the router has an interface in it. */
    private bridgeVlans(): void {
        for (const [vlanName, vlan] of RouterOsSyntax.entries(this.device.switching?.vlans)) {
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

    /** Interface lists scope what works at layer 2: neighbor discovery, and the platform's own client over MAC. The IP firewall never sees either. */
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

    /** Where LLDP runs, when it is limited to some ports. Undefined when it runs everywhere or nowhere, which the discovery settings say directly. */
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

    private vrfs(): void {
        for (const [vrf, settings] of RouterOsSyntax.entries(this.device.routing?.vrfs)) {
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
        RouterOsDhcp.render(this, this.device);
        this.dns();
        this.upnp();
        this.addressLists();
    }

    private addresses(): void {
        for (const { name, settings } of this.routed()) {
            for (const entry of settings.addresses ?? []) {
                const address = typeof entry === "string" ? entry : entry.address;
                // The far end of a point-to-point address, which the platform calls its network.
                const peer = typeof entry === "string" ? undefined : entry.peer_address;

                if (Address.family(address) === "ipv4") {
                    this.add("/ip address", "add", { address, comment: settings.description, interface: name, network: peer });
                } else {
                    // The address announces its own network. Prefixes written in `ipv6_ra` are announced instead, each with its settings.
                    const ra = Derive.routerAdvertisement(settings);
                    this.add("/ipv6 address", "add", {
                        address,
                        advertise: RouterOsSyntax.yesNo(ra && !ra.prefixes),
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

    /** The platform's default entry covers every interface, and sends router advertisements only where an address has `advertise=yes` (TRAPS.md). Once one interface sends its own, the default is turned off. A device that sends none keeps it. */
    private routerAdvertisements(): void {
        const sending = this.routed().flatMap(({ name, settings }) => {
            const ra = Derive.routerAdvertisement(settings);
            return ra ? [{ name, ra }] : [];
        });
        if (!sending.length) return;

        this.add("/ipv6 nd", "set [ find default=yes ]", { disabled: "yes" });

        for (const { name, ra } of sending) {
            const { interval, lifetime } = ra;
            const servers = ra.dns_servers?.length ? ra.dns_servers : undefined;
            this.add("/ipv6 nd", "add", {
                // Without `advertise-dns`, the servers are kept but not announced.
                "advertise-dns": servers && "yes",
                dns: servers?.join(","),
                interface: name,
                "managed-address-configuration": ra.managed && "yes",
                "other-configuration": ra.other_config && "yes",
                "ra-interval":
                    interval !== undefined &&
                    `${RouterOsSyntax.duration(Derive.minAdvertisementInterval(interval))}-${RouterOsSyntax.duration(interval)}`,
                // The device prints a lifetime of 0 as `none`.
                "ra-lifetime": lifetime !== undefined && (lifetime ? RouterOsSyntax.duration(lifetime) : "none"),
            });

            for (const advertised of ra.prefixes ?? []) {
                this.add("/ipv6 nd prefix", "add", {
                    autonomous: advertised.disable_autoconfiguration && "no",
                    interface: name,
                    "preferred-lifetime": RouterOsSyntax.lifetime(advertised.preferred_lifetime),
                    prefix: Address.prefixOf(advertised.prefix),
                    "valid-lifetime": RouterOsSyntax.lifetime(advertised.valid_lifetime),
                });
            }
        }
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
            "allow-remote-requests": RouterOsSyntax.yesNo(this.device.services?.dns_server),
            servers: servers?.join(",") ?? "",
        });
    }

    /** Address lists come from firewall address sets, prefix sets typed in the config, and what BGP originates. A prefix set from a registry that was not fetched, as Studio renders it, is only marked, and the plan leaves its entries alone. */
    private addressLists(): void {
        const { device } = this;
        const entries: { list: string; address: string }[] = [];

        for (const [list, members] of RouterOsSyntax.entries(device.firewall?.address_sets)) {
            for (const address of members) entries.push({ list, address });
        }

        for (const [list] of RouterOsSyntax.entries(device.routing?.prefix_sets)) {
            const prefixes = RouterOsSyntax.prefixesOf(device, list);
            if (prefixes) for (const address of prefixes) entries.push({ list, address });
            else this.addLine("/ip firewall address-list", `# generated ${list}`);
        }

        for (const prefix of device.routing?.bgp?.originated_prefixes ?? []) {
            entries.push({ list: RouterOsSyntax.NETWORKS[Address.family(Address.host(prefix))], address: prefix });
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
        RouterOsMonitoring.snmp(this, this.device);
        this.users();
        this.aaa();
        this.certificates();
    }

    /** The sources a service takes: its own, or `management.allow`. `unsupported()` refuses an address set named there. */
    allowed(own: readonly Prefix[] | undefined): readonly string[] {
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
            "strong-crypto": RouterOsSyntax.yesNo(!management.ssh?.weak_crypto),
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

    private users(): void {
        for (const [name, user] of RouterOsSyntax.entries(this.device.system?.users)) {
            this.add("/user", "add", {
                comment: user.description,
                group: RouterOsRender.USER_GROUPS[user.role],
                name,
                password: Secrets.marker(user.password),
            });
            for (const key of user.ssh_keys ?? []) this.add("/user ssh-keys", "add", { key, user: name });
        }
    }

    /** RADIUS logins. Every group a server may name is excluded, so each user a server accepts gets the default group, `remote_role`. `unsupported()` refuses TACACS+. */
    private aaa(): void {
        const aaa = this.device.system?.aaa;
        if (!aaa?.radius) return;

        for (const server of aaa.radius) {
            this.add("/radius", "add", {
                "accounting-port": server.acct_port,
                address: server.address,
                "authentication-port": server.auth_port,
                secret: Secrets.marker(server.secret_key),
                service: "login",
                "src-address": server.source_address,
            });
        }

        this.add("/user aaa", "set", {
            accounting: RouterOsSyntax.yesNo(aaa.accounting_events?.includes("login")),
            "default-group": RouterOsRender.USER_GROUPS[aaa.remote_role],
            "exclude-groups": Object.values(RouterOsRender.USER_GROUPS).sort().join(","),
            "use-radius": "yes",
        });
    }

    /** An export leaves certificates out, so the reader lists them in this same form: the name, the SHA-256 fingerprint, and whether the device holds the private key. A difference is installed from the config, not edited. */
    private certificates(): void {
        for (const [name, certificate] of RouterOsSyntax.entries(this.device.system?.certificates)) {
            this.add("/certificate", "add", {
                fingerprint: RouterOsRender.fingerprint(Utils.projectFile(certificate.certificate_file)),
                name,
                "private-key": RouterOsSyntax.yesNo(Boolean(certificate.private_key)),
            });
        }
    }

    private system(): void {
        const system = this.device.system ?? {};

        // One mode for the whole router: `unsupported()` names the interfaces that don't share it.
        this.add("/ip settings", "set", {
            "rp-filter": Derive.sharedUrpf(Derive.holders(this.device), "ipv4").mode,
            "send-redirects": RouterOsSyntax.yesNo(system.ip_stack?.icmp_redirects),
            "tcp-syncookies": RouterOsSyntax.yesNo(system.ip_stack?.syn_cookies),
        });
        this.add("/system identity", "set", { name: this.device.name });

        // Autodetect wins after a restart and has moved a router to another zone, so it is always off.
        this.add("/system clock", "set", { "time-zone-autodetect": "no", "time-zone-name": system.timezone ?? "UTC" });
        this.add("/system note", "set", { note: system.banner ?? "", "show-at-login": "yes" });

        this.add("/system ntp client", "set", { enabled: RouterOsSyntax.yesNo(Boolean(system.ntp?.servers.length)) });
        this.add("/system ntp server", "set", { enabled: RouterOsSyntax.yesNo(this.device.services?.ntp_server) });
        for (const server of system.ntp?.servers ?? []) this.add("/system ntp client servers", "add", { address: server });

        this.logging();

        this.add("/system package update", "set", { channel: system.release_channel ?? "stable" });
        // Bootloader setup only from a deliberate key on the console, so line noise on a serial cable cannot enter it. A CHR has no bootloader of its own (TRAPS.md).
        const { platform, model } = this.device;
        if (Catalog.serialConsole(platform, model) && !Catalog.virtual(platform, model))
            this.add("/system routerboard settings", "set", { "enter-setup-on": "delete-key" });

        RouterOsMonitoring.flowExport(this, this.device);
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
}
