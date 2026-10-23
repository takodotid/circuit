// The neutral model as a RouterOS 7 export, written in the form `/export` prints so the two compare line for line.

import { X509Certificate } from "node:crypto";
import { Address } from "../../core/address";
import { Secrets } from "../../core/secrets";
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
} from "../../schema";
import { Catalog } from "../catalog";

/** A property value as a command takes it. `undefined` and `false` leave the property out. */
export type Value = string | number | undefined | false;

export type AnyPort = Port<string, string, string, string>;
export type AnyInterface = Interface<string, string>;

type Speed = NonNullable<AnyPort["speed"]>;
type AnyRule = PolicyRule<string, string>;
type AnyNeighbor = Neighbor<string, string>;

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
    private static readonly NETWORKS: Record<Family, string> = { ipv4: "bgp-networks-v4", ipv6: "bgp-networks-v6" };

    /** Helpers the platform has, all stated so that one the config does not list is off. */
    private static readonly HELPERS = ["ftp", "tftp", "irc", "h323", "sip", "pptp", "rtsp"] as const;

    private static readonly CHAINS = ["input", "forward", "output"] as const;

    /** The validator group every RPKI server joins. */
    private static readonly RPKI_GROUP = "rpki";

    /** The chain a session without a policy uses, so that it learns or announces nothing. */
    private static readonly REJECT_ALL = "REJECT-ALL";

    // RouterOS takes our own role. The config states the neighbor's, so each becomes its opposite: a neighbor that is our provider makes us its customer.
    private static readonly ROLES = {
        provider: "ebgp-customer",
        customer: "ebgp-provider",
        peer: "ebgp-peer",
        rs: "ebgp-rs-client",
        "rs-client": "ebgp-rs",
    } as const;

    /** Neutral service name to the platform's. `native` is the platform's own desktop client. */
    private static readonly SERVICES = {
        ftp: "ftp",
        ssh: "ssh",
        telnet: "telnet",
        http: "www",
        https: "www-ssl",
        api: "api",
        api_tls: "api-ssl",
        native: "winbox",
    } as const;

    private static readonly USER_GROUPS = { admin: "full", operator: "write", "read-only": "read" } as const;

    private static readonly SNMP_AUTH = { sha1: "SHA1", sha256: "SHA1" } as const;
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

    private readonly ports: Record<string, AnyPort>;
    private readonly interfaces: Record<string, AnyInterface>;

    /** Commands under their menu. */
    private readonly menus = new Map<string, string[]>();

    private constructor(private readonly device: Device) {
        this.ports = Object.fromEntries(
            Object.entries(device.ports ?? {}).filter((entry): entry is [string, AnyPort] => entry[1] !== undefined)
        );
        this.interfaces = device.interfaces ?? {};
    }

    /** The whole configuration the device should run. */
    static of(device: Device): string {
        const render = new RouterOsRender(device);

        render.interfaceMenus();
        render.addressing();
        render.firewall();
        render.routing();
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
    private static yesNo(on: boolean | undefined): string {
        return on ? "yes" : "no";
    }

    /** `V4` or `V6`, the suffix of a chain rendered for one family. */
    private static familySuffix(family: Family): string {
        return family === "ipv4" ? "V4" : "V6";
    }

    /** Each port or range of ports as the platform writes it: `53`, `0-52`. */
    private static eachPort(ports: Ports): string[] {
        return [ports].flat().map((port) => (typeof port === "number" ? String(port) : `${port.min}-${port.max}`));
    }

    /** One port, a range, or a list of them, as `53,0-52`. */
    private static portList(ports: Ports | undefined): string | undefined {
        if (ports === undefined) return undefined;

        return RouterOsRender.eachPort(ports).join(",");
    }

    /** Seconds as the platform writes a duration: `3600` becomes `1h`, `90` becomes `1m30s`. */
    private static duration(seconds: number): string {
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
    private static bitrate(rate: string): string {
        const match = /^([\d.]+)([kMG])$/.exec(rate);
        if (!match) return rate;

        const [, amount, unit] = match;
        const suffix = unit === "k" ? "kbps" : `${unit}bps`;
        return `${Number(amount).toFixed(1)}${suffix}`;
    }

    /** An IPv4 prefix with a dotted mask, as the switch chip takes it: `10.0.0.0/8` becomes `10.0.0.0/255.0.0.0`. */
    private static dottedMask(cidr: string): string {
        const { addr, len } = Address.split(cidr);
        const mask = len === 0 ? 0 : (0xffffffff << (32 - len)) >>> 0;
        const octets = [24, 16, 8, 0].map((shift) => (mask >>> shift) & 255);
        return `${addr}/${octets.join(".")}`;
    }

    /** A community pattern with `*` as a regular expression the platform matches on: `64500:*:*` becomes `^64500:[0-9]+:[0-9]+$`. */
    private static communityPattern(pattern: string): string {
        const fields = pattern.split(":").map((field) => (field === "*" ? "[0-9]+" : field));
        return `^${fields.join(":")}$`;
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

    /** The chain a policy is rendered as for one family. A policy can test prefix lengths that mean different things per family, so each family gets its own. */
    private static chainName(policy: string, family: Family): string {
        return `${policy}-${RouterOsRender.familySuffix(family)}`;
    }

    /** The conditions of a rule, as the platform's filter language writes them. */
    private static conditions(rule: AnyRule): string[] {
        const match = rule.match ?? {};
        const tests: string[] = [];
        if (match.prefix) tests.push(`dst==${match.prefix}`);
        if (match.prefix_set) tests.push(`dst in ${match.prefix_set}`);
        if (match.prefix_length?.min !== undefined) tests.push(`dst-len>${match.prefix_length.min - 1}`);
        if (match.prefix_length?.max !== undefined) tests.push(`dst-len<${match.prefix_length.max + 1}`);
        if (match.as_path_length?.min !== undefined) tests.push(`bgp-path-len>${match.as_path_length.min - 1}`);
        if (match.as_path_length?.max !== undefined) tests.push(`bgp-path-len<${match.as_path_length.max + 1}`);
        // The platform's AS path regexp matches each AS as a whole number, so a bare number is that AS anywhere in the path.
        if (match.through_as !== undefined) tests.push(`bgp-as-path ${match.through_as}`);
        if (match.rpki) tests.push(`rpki ${match.rpki}`);
        if (match.community) tests.push(`bgp-communities includes ${match.community}`);
        if (match.large_community) tests.push(`bgp-large-communities includes ${match.large_community}`);
        return tests;
    }

    /** What a rule does to a matching route, then its decision. */
    private static actions(rule: AnyRule, family: Family): string[] {
        const set = rule.set ?? {};
        const steps: string[] = [];
        if (set.local_pref !== undefined) steps.push(`set bgp-local-pref ${set.local_pref}`);
        if (set.med !== undefined) steps.push(`set bgp-med ${set.med}`);
        if (set.prepend !== undefined) steps.push(`set bgp-path-prepend ${set.prepend}`);
        for (const pattern of set.remove_communities ?? []) {
            steps.push(`delete bgp-communities regexp "${RouterOsRender.communityPattern(pattern)}"`);
        }
        if (set.communities) steps.push(`set bgp-communities ${set.communities.join(",")}`);
        if (set.add_communities) steps.push(`append bgp-communities ${set.add_communities.join(",")}`);

        for (const pattern of set.remove_large_communities ?? []) {
            steps.push(`delete bgp-large-communities regexp "${RouterOsRender.communityPattern(pattern)}"`);
        }

        if (set.large_communities) steps.push(`set bgp-large-communities ${set.large_communities.join(",")}`);
        if (set.add_large_communities) steps.push(`append bgp-large-communities ${set.add_large_communities.join(",")}`);
        // An address only means something to routes of its own family.
        if (set.next_hop && Address.family(set.next_hop) === family) steps.push(`set gw ${set.next_hop}`);
        if (set.preferred_source && Address.family(set.preferred_source) === family) steps.push(`set pref-src ${set.preferred_source}`);
        if (set.blackhole) steps.push("set blackhole yes");
        if (rule.action) steps.push(rule.action);
        return steps;
    }

    /** One rule as the platform writes it: hand off, ask the validator, test, change, decide. */
    private static ruleText(rule: AnyRule, family: Family): string {
        const parts: string[] = [];
        if (rule.call) parts.push(`jump ${RouterOsRender.chainName(rule.call, family)}`);
        // An RPKI state is only known once the validator has been asked, per route, so the question goes on the same rule.
        if (rule.match?.rpki) parts.push(`rpki-verify ${RouterOsRender.RPKI_GROUP}`);

        const tests = RouterOsRender.conditions(rule);
        const steps = RouterOsRender.actions(rule, family);
        if (tests.length) parts.push(`if (${tests.join(" && ")})${steps.length ? ` { ${steps.join("; ")} }` : ""}`);
        else parts.push(...steps);
        return parts.join("; ");
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
    private add(menu: string, verb: string, properties: Record<string, Value>): void {
        this.addLine(menu, RouterOsRender.command(verb, properties));
    }

    /** The whole configuration as text. */
    private text(): string {
        const blocks = [...this.menus].map(([menu, commands]) => [menu, ...commands].join("\n"));
        return blocks.join("\n") + "\n";
    }

    /** What the platform calls a port or an interface. A port is spelled by the model; an interface keeps its config name. */
    private name(portOrInterface: string): string {
        if (portOrInterface in this.interfaces) return portOrInterface;

        return Catalog.spell(this.device.platform, this.device.model, portOrInterface);
    }

    /** The number of a VLAN, by its config name. */
    private vlanId(vlan: string): number {
        const declared = this.device.vlans?.[vlan];
        if (!declared) throw new Error(`${this.device.name}: VLAN ${vlan} is not declared`);
        return declared.id;
    }

    /** Ports and LAGs that are layer 2 members of a VLAN, with their settings. A port in a LAG is represented by the LAG. */
    private switched(): [string, AnyPort | Extract<AnyInterface, { type: "lag" }>][] {
        const ports = Object.entries(this.ports).filter(([, port]) => !port.lag && (port.access_vlan || port.trunk_vlans));
        const lags = Object.entries(this.interfaces).filter((entry): entry is [string, Extract<AnyInterface, { type: "lag" }>] => {
            const lag = entry[1];
            return lag.type === "lag" && Boolean(lag.access_vlan || lag.trunk_vlans);
        });
        return [...ports, ...lags];
    }

    /** VLAN interfaces, with their settings. */
    private declaredVlanInterfaces(): [string, Extract<AnyInterface, { type: "vlan" }>][] {
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
    private routed(): { name: string; settings: AnyPort | AnyInterface }[] {
        const ports = Object.entries(this.ports).map(([port, settings]) => ({ name: this.name(port), settings }));
        const interfaces = Object.entries(this.interfaces).map(([name, settings]) => ({ name, settings }));
        return [...ports, ...interfaces];
    }

    private interfaceMenus(): void {
        this.hardwareOffload();
        this.bridge();
        this.ethernet();
        this.switchPorts();
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
    }

    /**
     * Routing in the switch chip. With it on, routed traffic bypasses the forward chain unless its interface opts out.
     *
     * Restarting the offload after a failure, and offloading IPv6 too, follow the same switch.
     */
    private hardwareOffload(): void {
        const on = RouterOsRender.yesNo(this.device.hardware_offload);
        this.add("/interface ethernet switch", "set switch1", { "l3-hw-offloading": on });
        this.add("/interface ethernet switch l3hw-settings", "set", { autorestart: on, "ipv6-hw": on });
    }

    /** One VLAN-filtering bridge carries every switched port. A loopback is a bridge with no ports, the platform's idiom for one. */
    private bridge(): void {
        const { device } = this;
        const needsBridge = this.switched().length > 0 || this.declaredVlanInterfaces().length > 0;

        if (needsBridge) {
            const stp = device.stp;
            const protocolMode = stp ? (stp.mode ?? "rstp") : "none";
            const priority = stp?.priority === undefined ? undefined : `0x${stp.priority.toString(16)}`;
            this.add("/interface bridge", "add", {
                name: RouterOsRender.BRIDGE,
                "protocol-mode": protocolMode,
                priority,
                "vlan-filtering": "yes",
            });
        }

        for (const [name, iface] of Object.entries(this.interfaces)) {
            if (iface.type !== "loopback") continue;

            this.add("/interface bridge", "add", { comment: iface.description, name });
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

    /** A LAG is a bonding interface. Its members are named as the platform spells them. */
    private lags(): void {
        for (const [name, lag] of Object.entries(this.interfaces)) {
            if (lag.type !== "lag") continue;

            const members = Object.entries(this.ports)
                .filter(([, port]) => port.lag === name)
                .map(([port]) => this.name(port));
            const mode = lag.mode === "static" ? "balance-xor" : "802.3ad";
            this.add("/interface bonding", "add", {
                comment: lag.description,
                mode,
                mtu: lag.mtu,
                name,
                slaves: members.join(","),
                "transmit-hash-policy": "layer-2-and-3",
            });
        }
    }

    /**
     * A VLAN interface sits on the bridge. When the device offloads, one that opts out is routed in software so the firewall applies.
     *
     * Every VLAN interface on the bridge has the bridge's MAC. One with a MAC of its own is a MACVLAN on top of the VLAN interface: the MACVLAN takes the configured name, so its addresses and every rule naming it land on it.
     */
    private vlanInterfaces(): void {
        for (const [name, iface] of this.declaredVlanInterfaces()) {
            const softwareOnly = this.device.hardware_offload && iface.hardware_offload === false;
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
        for (const [name, iface] of Object.entries(this.interfaces)) {
            if (iface.type === "gre") {
                this.add("/interface gre", "add", {
                    comment: iface.description,
                    "local-address": iface.local,
                    mtu: iface.mtu,
                    name,
                    "remote-address": iface.remote,
                });
            }

            if (iface.type === "vxlan") {
                // 4789 is the platform's default and is not written.
                const port = iface.port && iface.port !== 4789 ? iface.port : undefined;
                this.add("/interface vxlan", "add", {
                    comment: iface.description,
                    "local-address": iface.local,
                    "mac-address": iface.mac,
                    mtu: iface.mtu,
                    name,
                    port,
                    vni: iface.vni,
                });
                this.add("/interface vxlan vteps", "add", { interface: name, "remote-ip": iface.remote });
            }
        }
    }

    private wireguard(): void {
        for (const [name, iface] of Object.entries(this.interfaces)) {
            if (iface.type !== "wireguard") continue;

            this.add("/interface wireguard", "add", {
                comment: iface.description,
                "listen-port": iface.listen_port,
                mtu: iface.mtu,
                name,
                "private-key": Secrets.marker(iface.private_key),
            });

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
        for (const [vlanName, vlan] of Object.entries(this.device.vlans ?? {})) {
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

        const native = this.device.management?.native?.interfaces;
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
        const lldp = this.device.lldp;
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
        for (const [vrf, settings] of Object.entries(this.device.vrfs ?? {})) {
            const members = this.routed()
                .filter(({ settings: iface }) => iface.vrf === vrf)
                .map(({ name }) => name);
            this.add("/ip vrf", "add", { comment: settings.description, interfaces: members.join(","), name: vrf });
        }
    }

    private addressing(): void {
        this.addresses();
        this.dhcp();
        this.dns();
        this.addressLists();
    }

    /** Every address goes on the menu of its family, with the interface's description as its comment. */
    private addresses(): void {
        for (const { name, settings } of this.routed()) {
            for (const entry of settings.addresses ?? []) {
                const address = typeof entry === "string" ? entry : entry.address;
                // The far end of a point-to-point address, which the platform calls its network.
                const peer = typeof entry === "string" ? undefined : entry.peer;

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

    private dhcp(): void {
        for (const [name, server] of Object.entries(this.device.dhcp ?? {})) {
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

        for (const [name, relay] of Object.entries(this.device.dhcp_relay ?? {})) {
            this.add("/ip dhcp-relay", "add", { "dhcp-server": relay.servers.join(","), interface: this.name(relay.interface), name });
        }
    }

    private dns(): void {
        const dns = this.device.system?.dns;
        this.add("/ip dns", "set", { "allow-remote-requests": RouterOsRender.yesNo(dns?.serve), servers: dns?.servers.join(",") ?? "" });
    }

    /**
     * Address lists come from firewall address sets, prefix sets typed in the config, and what BGP originates.
     *
     * A prefix set fetched from a registry is filled by `refresh`, so only its name is marked, and the plan leaves its entries alone.
     */
    private addressLists(): void {
        const { device } = this;
        const entries: { list: string; address: string }[] = [];

        for (const [list, members] of Object.entries(device.firewall?.address_sets ?? {})) {
            for (const address of members) entries.push({ list, address });
        }

        for (const [list, set] of Object.entries(device.prefix_sets ?? {})) {
            if ("prefixes" in set) for (const address of set.prefixes) entries.push({ list, address });
            else this.addLine("/ip firewall address-list", `# generated ${list}`);
        }

        for (const prefix of device.routing?.bgp?.networks ?? []) {
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

    private firewall(): void {
        for (const family of ["ipv4", "ipv6"] as const) {
            this.untracked(family);
            this.filter(family);
            this.nat(family);
        }

        this.helpers();
        this.switchAcls();
    }

    /** Untracked prefixes skip connection tracking in the raw table, both ways, before a connection is ever made. */
    private untracked(family: Family): void {
        const menu = family === "ipv4" ? "/ip firewall raw" : "/ipv6 firewall raw";

        for (const prefix of this.device.firewall?.untracked ?? []) {
            if (Address.family(prefix) !== family) continue;

            for (const [direction, property] of [
                ["to", "dst-address"],
                ["from", "src-address"],
            ] as const) {
                this.add(menu, "add", {
                    action: "notrack",
                    chain: "prerouting",
                    comment: `Untracked ${direction} ${prefix}`,
                    [property]: prefix,
                });
            }
        }
    }

    /**
     * The families a rule applies to. An address in the rule decides it; otherwise it applies to both.
     *
     * A rule naming an address set applies only to the families the set has members in.
     */
    private families(match: FilterMatch<string, string> | undefined): Family[] {
        const sets = this.device.firewall?.address_sets ?? {};
        const address = match?.src ?? match?.dst;

        let candidates: Family[] = ["ipv4", "ipv6"];
        if (match?.family) candidates = [match.family];
        else if (address) candidates = [Address.family(address)];

        const setHas = (set: string | undefined, family: Family) =>
            !set || (sets[set] ?? []).some((member) => Address.family(member) === family);
        return candidates.filter((family) => setHas(match?.src_set, family) && setHas(match?.dst_set, family));
    }

    /** The match properties of a rule, as the platform names them. */
    private matchProperties(match: FilterMatch<string, string> | undefined, family: Family) {
        const protocol = match?.protocol === "icmp" && family === "ipv6" ? "icmpv6" : match?.protocol;
        const setFlags = match?.tcp_flags?.set ?? [];
        const unsetFlags = (match?.tcp_flags?.unset ?? []).map((flag) => `!${flag}`);
        const flags = match?.tcp_flags ? [...setFlags, ...unsetFlags].join(",") : undefined;
        return {
            "connection-state": match?.state?.join(","),
            "dst-address": match?.dst,
            "dst-address-list": match?.dst_set,
            "dst-port": RouterOsRender.portList(match?.dst_port),
            "in-interface": match?.in_interface && this.name(match.in_interface),
            "out-interface": match?.out_interface && this.name(match.out_interface),
            protocol,
            "src-address": match?.src,
            "src-address-list": match?.src_set,
            "src-port": RouterOsRender.portList(match?.src_port),
            "tcp-flags": flags,
        };
    }

    private filter(family: Family): void {
        const menu = family === "ipv4" ? "/ip firewall filter" : "/ipv6 firewall filter";

        for (const chain of RouterOsRender.CHAINS) {
            const settings = this.device.firewall?.filter?.[chain];
            if (!settings) continue;

            for (const rule of settings.rules ?? []) {
                if (!this.families(rule.match).includes(family)) continue;

                const match = this.matchProperties(rule.match, family);
                // The platform's fast path takes a flow only on IPv4. The accept below still applies on both.
                if (rule.offload && family === "ipv4") {
                    this.add(menu, "add", { action: "fasttrack-connection", chain, comment: rule.description, ...match });
                }

                this.add(menu, "add", { action: rule.action, chain, comment: rule.description, ...match });
            }

            if (settings.default === "drop") this.add(menu, "add", { action: "drop", chain, comment: "Default" });
        }
    }

    private nat(family: Family): void {
        const menu = family === "ipv4" ? "/ip firewall nat" : "/ipv6 firewall nat";
        const chains: [string, readonly NatRule<string, string>[] | undefined][] = [
            ["srcnat", this.device.firewall?.nat?.source],
            ["dstnat", this.device.firewall?.nat?.destination],
        ];

        for (const [chain, rules] of chains) {
            for (const rule of rules ?? []) {
                if (!this.families(rule.match).includes(family)) continue;
                // A translation to an address belongs to that address's family.
                if (rule.action !== "masquerade" && Address.family(rule.to) !== family) continue;

                const action =
                    rule.action === "masquerade"
                        ? {
                              action: "masquerade",
                          }
                        : { action: rule.action === "snat" ? "src-nat" : "dst-nat", "to-addresses": rule.to, "to-ports": rule.to_port };
                this.add(menu, "add", { ...action, chain, comment: rule.description, ...this.matchProperties(rule.match, family) });
            }
        }
    }

    private helpers(): void {
        const enabled = this.device.firewall?.helpers ?? [];

        for (const helper of RouterOsRender.HELPERS) {
            this.add("/ip firewall service-port", `set ${helper}`, { disabled: RouterOsRender.yesNo(!enabled.includes(helper)) });
        }
    }

    /**
     * ACLs run in the switch chip on the port traffic arrives on. The chip matches addresses with a dotted mask on IPv4, drops by forwarding to no port, and limits by rate. A rule takes one port or range, so a list becomes one rule for each.
     */
    private switchAcls(): void {
        const each = (ports: Ports | undefined) => (ports === undefined ? [undefined] : RouterOsRender.eachPort(ports));

        for (const [port, settings] of Object.entries(this.ports)) {
            if (!settings.acl) continue;

            for (const rule of this.device.acls?.[settings.acl] ?? []) {
                const match = rule.match ?? {};
                const ipv6 =
                    match.family === "ipv6" || [match.src, match.dst].some((address) => address && Address.family(address) === "ipv6");
                const address = (prefix: string | undefined) => (prefix && !ipv6 ? RouterOsRender.dottedMask(prefix) : prefix);

                for (const srcPort of each(match.src_port)) {
                    for (const dstPort of each(match.dst_port)) {
                        this.add("/interface ethernet switch rule", "add", {
                            comment: rule.description,
                            [ipv6 ? "dst-address6" : "dst-address"]: address(match.dst),
                            "dst-port": dstPort,
                            "mac-protocol": ipv6 ? "ipv6" : "ip",
                            "new-dst-ports": rule.action === "drop" ? "" : undefined,
                            ports: this.name(port),
                            protocol: match.protocol,
                            rate: rule.rate && RouterOsRender.bitrate(rule.rate),
                            [ipv6 ? "src-address6" : "src-address"]: address(match.src),
                            "src-port": srcPort,
                            switch: "switch1",
                            "vlan-id": match.vlan && this.vlanId(match.vlan),
                        });
                    }
                }
            }
        }
    }

    private routing(): void {
        this.staticRoutes();
        this.rpki();
        if (this.device.routing?.bgp) {
            this.bgpInstance();
            this.policies();
            this.bgpConnections();
        }

        this.ospf();
        this.bfd();
    }

    private staticRoutes(): void {
        for (const route of this.device.routing?.static ?? []) {
            const menu = Address.family(Address.host(route.prefix)) === "ipv4" ? "/ip route" : "/ipv6 route";
            const verb = route.blackhole ? "add blackhole" : "add";
            const gateway = route.via ?? (route.interface ? this.name(route.interface) : undefined);
            this.add(menu, verb, {
                comment: route.description,
                distance: route.distance,
                "dst-address": route.prefix,
                gateway,
                "routing-table": route.vrf,
            });
        }
    }

    private rpki(): void {
        for (const server of this.device.routing?.rpki ?? []) {
            this.add("/routing rpki", "add", {
                address: server.address,
                comment: server.description,
                group: RouterOsRender.RPKI_GROUP,
                port: server.port,
            });
        }
    }

    /** The default instance exists on every device; it is stated in the form the export prints it. */
    private bgpInstance(): void {
        const bgp = this.device.routing!.bgp!;
        this.add("/routing bgp instance", "add", { as: bgp.asn, name: "default", "router-id": this.device.routing?.router_id });
    }

    /** A neighbor's settings with its group's beneath them. */
    private settingsOf(neighbor: AnyNeighbor): NeighborSettings<string> {
        const group = neighbor.group ? this.device.routing?.bgp?.groups?.[neighbor.group] : undefined;
        return { ...group, ...neighbor };
    }

    /** The families a neighbor exchanges: the ones it states, or its address's. */
    private familiesOf(neighbor: AnyNeighbor): readonly Family[] {
        return this.settingsOf(neighbor).families ?? [Address.family(neighbor.address)];
    }

    /** Does a rule belong on a family's chain? A rule naming a prefix, a family, or a prefix set of one family belongs only there. */
    private appliesTo(rule: AnyRule, family: Family): boolean {
        const match = rule.match;
        if (match?.family && match.family !== family) return false;

        if (match?.prefix && Address.family(Address.host(match.prefix)) !== family) return false;

        if (match?.prefix_set) {
            const set = this.device.prefix_sets?.[match.prefix_set];
            if (!set) return false;

            const firstPrefix = "source" in set ? undefined : set.prefixes[0];
            const setFamily = "source" in set ? set.source.family : firstPrefix && Address.family(Address.host(firstPrefix));
            if (setFamily !== family) return false;
        }

        return true;
    }

    /**
     * Policies become filter chains, one per family a session uses, plus every chain those call.
     *
     * A chain a session uses directly ends in a reject when its last rule does not decide, so a route nothing accepted is rejected on any platform default. A chain only called returns to its caller instead.
     */
    private policies(): void {
        const bgp = this.device.routing!.bgp!;
        const policies = this.device.policies ?? {};

        const wanted = new Map<string, Set<Family>>();
        const want = (policy: string, family: Family) => {
            const families = wanted.get(policy) ?? new Set();
            if (families.has(family)) return;

            families.add(family);
            wanted.set(policy, families);
            for (const rule of policies[policy] ?? []) if (rule.call && this.appliesTo(rule, family)) want(rule.call, family);
        };

        let rejectAllNeeded = false;

        for (const neighbor of Object.values(bgp.neighbors ?? {})) {
            const settings = this.settingsOf(neighbor);

            for (const family of this.familiesOf(neighbor)) {
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

                const chain = RouterOsRender.chainName(policy, family);
                const rules = (policies[policy] ?? []).filter((rule) => this.appliesTo(rule, family));

                for (const rule of rules) {
                    const text = RouterOsRender.ruleText(rule, family);
                    if (text) this.add("/routing filter rule", "add", { chain, comment: rule.description, rule: text });
                }

                const last = rules.at(-1);
                const decides = last !== undefined && !last.match && !last.call && last.action !== undefined;
                if (!called.has(policy) && !decides) this.add("/routing filter rule", "add", { chain, rule: "reject" });
            }
        }

        if (rejectAllNeeded) {
            for (const family of ["ipv4", "ipv6"] as const)
                this.add("/routing filter rule", "add", {
                    chain: RouterOsRender.chainName(RouterOsRender.REJECT_ALL, family),
                    rule: "reject",
                });
        }
    }

    /** One connection per neighbor. The platform carries one family per connection. */
    private bgpConnections(): void {
        const bgp = this.device.routing!.bgp!;

        for (const [name, neighbor] of Object.entries(bgp.neighbors ?? {})) {
            const settings = this.settingsOf(neighbor);
            const [family] = this.familiesOf(neighbor) as [Family];
            const addressFamily = Address.family(neighbor.address);
            const internal = settings.remote_as === bgp.asn;
            const originates = bgp.networks?.some((prefix) => Address.family(Address.host(prefix)) === family);
            const role = settings.role ? RouterOsRender.ROLES[settings.role] : internal ? "ibgp" : "ebgp";

            this.add("/routing bgp connection", "add", {
                // Only stated when the routes differ in family from the address they are carried over.
                afi: addressFamily === family ? undefined : family === "ipv6" ? "ipv6" : "ip",
                as: bgp.asn,
                connect: settings.passive ? "no" : undefined,
                "hold-time": settings.hold_time ? RouterOsRender.duration(settings.hold_time) : undefined,
                "input.filter": RouterOsRender.chainName(settings.import ?? RouterOsRender.REJECT_ALL, family),
                // The one instance bgpInstance adds. 7.23 refuses a new connection without it.
                instance: "default",
                [`input.limit-process-routes-${family}`]: settings.max_prefixes,
                "keepalive-time": settings.keepalive ? RouterOsRender.duration(settings.keepalive) : undefined,
                listen: settings.passive ? "yes" : undefined,
                "local.address": settings.local_address,
                "local.role": role,
                multihop: settings.multihop ? "yes" : undefined,
                name,
                "output.filter-chain": RouterOsRender.chainName(settings.export ?? RouterOsRender.REJECT_ALL, family),
                "output.network": originates ? RouterOsRender.NETWORKS[family] : undefined,
                "remote.address": `${neighbor.address}/${addressFamily === "ipv4" ? 32 : 128}`,
                "remote.as": settings.remote_as,
                "tcp-md5-key": settings.password && Secrets.marker(settings.password),
                "use-bfd": settings.bfd ? "yes" : undefined,
            });
        }
    }

    /** One instance per OSPF version, an area per area and instance, and a template per interface. */
    private ospf(): void {
        const ospf = this.device.routing?.ospf;
        if (!ospf) return;

        for (const family of ospf.families ?? ["ipv4"]) {
            const version = family === "ipv4" ? 2 : 3;
            const instance = `ospf-v${version}`;
            this.add("/routing ospf instance", "add", {
                name: instance,
                redistribute: ospf.redistribute?.join(","),
                "router-id": this.device.routing?.router_id,
                version,
            });

            for (const [areaId, area] of Object.entries(ospf.areas)) {
                const areaName = `${instance}-${areaId}`;
                this.add("/routing ospf area", "add", { "area-id": areaId, instance, name: areaName });

                for (const [iface, settings] of Object.entries(area.interfaces)) {
                    // `passive` is a flag, written without a value.
                    const verb = settings?.passive ? "add passive" : "add";
                    this.add("/routing ospf interface-template", verb, {
                        area: areaName,
                        cost: settings?.cost,
                        interfaces: this.name(iface),
                        type: settings?.network === "point-to-point" ? "ptp" : undefined,
                        "use-bfd": settings?.bfd ? "yes" : undefined,
                    });
                }
            }
        }
    }

    /** BFD runs where a session or an OSPF interface asks for it. One configuration covers every interface. */
    private bfd(): void {
        const routing = this.device.routing;
        const bgpWants = Object.values(routing?.bgp?.neighbors ?? {}).some((neighbor) => this.settingsOf(neighbor).bfd);
        const ospfWants = Object.values(routing?.ospf?.areas ?? {}).some((area) =>
            Object.values(area.interfaces).some((iface) => iface?.bfd)
        );
        if (bgpWants || ospfWants) this.add("/routing bfd configuration", "add", { interfaces: "all" });
    }

    private management(): void {
        this.services();
        this.layerTwo();
        this.snmp();
        this.users();
        this.certificates();
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

            const allow = service.allow ?? management.allow ?? [];
            this.add("/ip service", `set ${platform}`, {
                address: allow.join(","),
                certificate: service.certificate,
                disabled: "no",
                port: service.port,
            });
        }

        // A newer service with no neutral name. Off, as everything not stated is.
        this.add("/ip service", "set reverse-proxy", { disabled: "yes" });
        this.add("/ip ssh", "set", { "strong-crypto": RouterOsRender.yesNo(!management.ssh?.weak_crypto) });
    }

    /** What works at layer 2: the platform's client over MAC, MAC ping, the bandwidth test server and neighbor discovery. */
    private layerTwo(): void {
        const nativeList = this.device.management?.native?.interfaces ? "native" : "none";
        this.add("/tool mac-server", "set", { "allowed-interface-list": nativeList });
        this.add("/tool mac-server mac-winbox", "set", { "allowed-interface-list": nativeList });
        this.add("/tool mac-server ping", "set", { enabled: "no" });
        this.add("/tool bandwidth-server", "set", { enabled: "no" });

        let discovery = "none";
        if (this.lldpMembers()) discovery = "lldp";
        else if (this.device.lldp) discovery = "all";
        this.add("/ip neighbor discovery-settings", "set", { "discover-interface-list": discovery, protocol: "lldp" });
    }

    /**
     * The platform keeps one community it will not delete. With version 2c it becomes the read community; without, it is disabled. Version 3 users are communities of their own.
     */
    private snmp(): void {
        const management = this.device.management ?? {};
        const snmp = management.snmp;

        if (!snmp) {
            this.add("/snmp", "set", { enabled: "no" });
            this.add("/snmp community", "set [ find default=yes ]", { addresses: "::/0", name: "public" });
            return;
        }

        const allow = (snmp.allow ?? management.allow ?? []).join(",");
        this.add("/snmp", "set", { contact: snmp.contact ?? "", enabled: "yes", location: snmp.location ?? "" });

        if (snmp.community)
            this.add("/snmp community", "set [ find default=yes ]", { addresses: allow, name: Secrets.marker(snmp.community) });
        else this.add("/snmp community", "set [ find default=yes ]", { addresses: "::/0", disabled: "yes", name: "public" });

        for (const [name, user] of Object.entries(snmp.users ?? {})) {
            this.add("/snmp community", "add", {
                addresses: allow,
                "authentication-password": Secrets.marker(user.auth_password),
                "authentication-protocol": RouterOsRender.SNMP_AUTH[user.auth],
                "encryption-password": Secrets.marker(user.privacy_password),
                "encryption-protocol": RouterOsRender.SNMP_PRIVACY[user.privacy],
                name,
                security: "private",
            });
        }
    }

    private users(): void {
        for (const [name, user] of Object.entries(this.device.users ?? {})) {
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
        for (const [name, certificate] of Object.entries(this.device.certificates ?? {})) {
            this.add("/certificate", "add", {
                fingerprint: RouterOsRender.fingerprint(certificate.certificate),
                name,
                "private-key": RouterOsRender.yesNo(Boolean(certificate.private_key)),
            });
        }
    }

    private system(): void {
        const system = this.device.system ?? {};

        this.add("/ip settings", "set", {
            "send-redirects": RouterOsRender.yesNo(system.ip?.icmp_redirects),
            "tcp-syncookies": RouterOsRender.yesNo(system.ip?.syn_cookies),
        });
        this.add("/system identity", "set", { name: this.device.name });

        // Autodetect wins after a restart and has moved a router to another zone, so it is always off.
        this.add("/system clock", "set", { "time-zone-autodetect": "no", "time-zone-name": system.timezone ?? "UTC" });
        this.add("/system note", "set", { note: system.banner ?? "", "show-at-login": "yes" });

        this.add("/system ntp client", "set", { enabled: RouterOsRender.yesNo(Boolean(system.ntp?.servers.length)) });
        this.add("/system ntp server", "set", { enabled: RouterOsRender.yesNo(system.ntp?.serve) });
        for (const server of system.ntp?.servers ?? []) this.add("/system ntp client servers", "add", { address: server });

        this.logging();

        this.add("/system package update", "set", { channel: system.release_channel ?? "stable" });
        // Bootloader setup only from a deliberate key on the console, so line noise on a serial cable cannot enter it.
        this.add("/system routerboard settings", "set", { "enter-setup-on": "delete-key" });

        this.flowExport();
    }

    /** Local logging uses the platform's built-in disk action, number 1. Each remote collector gets an action of its own. */
    private logging(): void {
        const logging = this.device.system?.logging;
        const local = logging?.local;

        this.add("/system logging action", "set 1", {
            "disk-file-count": local?.files ?? 2,
            "disk-lines-per-file": local?.lines_per_file ?? 1000,
        });
        for (const topic of local ? RouterOsRender.topicsFrom(local.level) : []) {
            this.add("/system logging", "add", { action: "disk", topics: topic });
        }

        (logging?.remote ?? []).forEach((collector, index) => {
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
        const flow = this.device.flow_export;
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
