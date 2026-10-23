// The neutral model as Junos `set` statements, in the form `show configuration | display set` prints, so the two compare statement by statement.

import { Address } from "../../core/address";
import { Secrets } from "../../core/secrets";
import type { AclRule, Device, Family, Interface, Port, Ports, Rate, Severity, Vrrp } from "../../schema";
import { Catalog } from "../catalog";
import { Derive } from "../derive";
import { JunosBgp } from "./bgp";

type AnyPort = Port<string, string, string, string>;
type AnyInterface = Interface<string, string>;
type LagInterface = Extract<AnyInterface, { type: "lag" }>;
type Switched = AnyPort | LagInterface;
type AnyAclRule = AclRule<string>;

/** Collects `set` statements, and comments the plan reads. */
export class JunosStatements {
    private readonly lines: string[] = [];
    private readonly notes: string[] = [];

    set(...words: (string | number)[]): void {
        this.lines.push(`set ${words.join(" ")}`);
    }

    note(comment: string): void {
        this.notes.push(comment);
    }

    /** The statements as the device prints them: each once, and none that another one extends, because the platform prints only the longest. */
    text(): string {
        const unique = [...new Set(this.lines)];
        const extended = new Set<string>();

        for (const line of unique) {
            const words = line.split(" ");
            for (let length = 2; length < words.length; length++) extended.add(words.slice(0, length).join(" "));
        }

        return [...unique.filter((line) => !extended.has(line)), ...this.notes].join("\n") + "\n";
    }
}

/** What the platform calls a port, a LAG, a VLAN interface or a loopback. */
export class JunosNames {
    readonly lags: Map<string, number>;
    readonly loopbacks = new Map<string, number>();
    readonly tunnels = new Map<string, number>();

    constructor(private readonly device: Device) {
        this.lags = Derive.lagIds(device);

        // The default table's loopback is unit 0; one in a VRF takes the next unit.
        const loopbacks = Object.entries(device.interfaces ?? {}).filter(([, iface]) => iface.type === "loopback");
        let unit = 0;

        for (const [name, iface] of loopbacks) if (!iface.vrf) this.loopbacks.set(name, 0);

        for (const [name, iface] of loopbacks) if (iface.vrf) this.loopbacks.set(name, ++unit);

        // GRE tunnels are units of the one tunnel interface, in order.
        const tunnels = Object.entries(device.interfaces ?? {}).filter(([, iface]) => iface.type === "gre");
        tunnels.forEach(([name], index) => this.tunnels.set(name, index));
    }

    /** A physical port. A 10G cage holding a 1G optic is `ge-`, not `xe-`. */
    port(port: string): string {
        const name = Catalog.spell(this.device.platform, this.device.model, port);
        const settings = this.device.ports?.[port as keyof typeof this.device.ports];
        return settings?.speed === "1g" ? name.replace(/^xe-/, "ge-") : name;
    }

    /** The physical interface a port or a LAG is: `xe-0/0/1`, `ae1`. */
    physical(name: string): string {
        if (this.device.interfaces?.[name]?.type === "lag") return `ae${this.lags.get(name)}`;

        return this.port(name);
    }

    /** The logical interface that holds addresses: `xe-0/0/1.0`, `ae1.0`, `irb.10`, `lo0.0`. */
    unit(name: string): string {
        const iface = this.device.interfaces?.[name];
        if (iface?.type === "vlan") return `irb.${this.device.vlans![iface.vlan]!.id}`;

        if (iface?.type === "loopback") return `lo0.${this.loopbacks.get(name)}`;

        if (iface?.type === "gre") return `gr-0/0/0.${this.tunnels.get(name)}`;

        return `${this.physical(name)}.0`;
    }

    /** The physical ports behind a port or a LAG. */
    members(name: string): string[] {
        if (this.device.interfaces?.[name]?.type !== "lag") return [this.port(name)];

        const ports = Object.entries(this.device.ports ?? {}).filter(([, settings]) => settings?.lag === name);
        return ports.map(([port]) => this.port(port));
    }
}

/** The whole configuration of one device, built section by section into one set of statements. */
export class JunosRender {
    /** The class each role logs in with. */
    private static readonly USER_CLASS = { admin: "super-user", operator: "operator", "read-only": "read-only" } as const;

    /** The statement each kind of public key is written under, by the key's own prefix. */
    static readonly KEY_STATEMENT: Record<string, string> = {
        "ssh-ed25519": "ssh-ed25519",
        "ssh-rsa": "ssh-rsa",
        "ecdsa-sha2-nistp256": "ssh-ecdsa",
        "ecdsa-sha2-nistp384": "ssh-ecdsa",
        "ecdsa-sha2-nistp521": "ssh-ecdsa",
    };

    private static readonly SNMP_AUTH = { sha1: "authentication-sha", sha256: "authentication-sha256" } as const;
    private static readonly SNMP_PRIVACY = { aes128: "privacy-aes128", des: "privacy-des" } as const;

    /** The SNMPv3 group every user joins, with read access to everything. */
    private static readonly SNMP_GROUP = "circuit";

    /** A severity as the platform names it. It has no debug; `any` takes everything. */
    private static readonly LEVEL: Record<Severity, string> = {
        emergency: "emergency",
        alert: "alert",
        critical: "critical",
        error: "error",
        warning: "warning",
        notice: "notice",
        info: "info",
        debug: "any",
    };

    /** The filters that decide who reaches the device's own services, one per family. A filter name is unique across families. */
    private static readonly SERVICES_FILTER = { inet: "circuit-services", inet6: "circuit-services-v6" } as const;

    /** The policy OSPF announces other routes with. */
    private static readonly OSPF_EXPORT = "circuit-ospf-redistribute";

    /** Strong ciphers, MACs and key exchanges, offered unless `weak_crypto`. */
    private static readonly SSH_CIPHERS = ["aes256-gcm@openssh.com", "aes128-gcm@openssh.com", "aes256-ctr", "aes192-ctr", "aes128-ctr"];
    private static readonly SSH_MACS = ["hmac-sha2-512", "hmac-sha2-256"];
    private static readonly SSH_KEY_EXCHANGES = [
        "curve25519-sha256",
        "ecdh-sha2-nistp521",
        "ecdh-sha2-nistp384",
        "ecdh-sha2-nistp256",
        "group-exchange-sha2",
    ];

    /** The transport and port each management service listens on. */
    private static readonly SERVICE_PORTS = {
        ssh: ["tcp", 22],
        telnet: ["tcp", 23],
        ftp: ["tcp", 21],
        snmp: ["udp", 161],
        http: ["tcp", 80],
        api: ["tcp", 3000],
        native: ["tcp", 830],
    } as const;

    /** Detection under a second: three missed packets 300 ms apart. */
    static readonly BFD_INTERVAL = 300;

    /** Kinds of flooded traffic, with the statement that leaves each out of a storm-control profile. */
    private static readonly STORM_KINDS = [
        ["broadcast", "no-broadcast"],
        ["multicast", "no-multicast"],
        ["unknown_unicast", "no-unknown-unicast"],
    ] as const;

    private readonly out = new JunosStatements();
    private readonly names: JunosNames;

    private constructor(private readonly device: Device) {
        this.names = new JunosNames(device);
    }

    /** The whole configuration the device should run, as `set` statements. */
    static of(device: Device): string {
        const render = new JunosRender(device);

        render.system();
        render.users();
        render.services();
        render.snmp();
        render.vlans();
        render.ports();
        render.lags();
        render.routedInterfaces();
        render.stormProfiles();
        render.servicesFilter();
        render.vrfs();
        render.staticRoutes();
        render.spanningTree();
        render.lldp();
        render.ospf();
        render.dhcpRelay();
        render.dhcpServers();
        render.routerAdvertisements();
        render.acls();
        JunosBgp.render(render.out, device);
        render.sflow();

        return render.out.text();
    }

    /** Quote a value unless it is a plain word. Quoting more than the platform would is harmless: the comparison ignores quotes. */
    static quote(value: string): string {
        if (/^[\w.:/@-]+$/.test(value)) return value;

        const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
        return `"${escaped}"`;
    }

    /** The address a VRRP group sits on: the one whose network holds the virtual address. */
    static vrrpAddress(addresses: readonly string[], group: Vrrp): string | undefined {
        return addresses.find((address) => Address.family(address) === "ipv4" && Address.contains(address, group.address));
    }

    /**
     * The storm-control profile a port or LAG names. A profile holds one threshold for every kind it limits, so a port's kinds must share one in percent; `unsupported()` refuses any other.
     */
    static stormProfile(settings: Switched): { name: string; percent: number; left: string[] } | undefined {
        const storm = settings.storm_control;
        if (!storm) return undefined;

        const limited = JunosRender.STORM_KINDS.filter(([kind]) => storm[kind]);
        const first = limited[0] && storm[limited[0][0]];
        if (!first || !("percent" in first)) return undefined;

        const kinds = limited.map(([kind]) => kind.replace("_", "-"));
        const left = JunosRender.STORM_KINDS.filter(([kind]) => !storm[kind]).map(([, statement]) => statement);
        return { name: `${kinds.join("-")}-${first.percent}-percent`, percent: first.percent, left };
    }

    /** The size a port's frames may reach for an IP MTU: the Ethernet header, and a VLAN tag when the port switches. */
    private static frameSize(mtu: number, switched: boolean): number {
        return mtu + (switched ? 18 : 14);
    }

    /** `2g`, a rate as a policer takes it. */
    private static bandwidth(rate: Rate): string {
        return rate.toLowerCase();
    }

    /** Bytes a policer lets through at once: 10 ms at its rate, and never less than one full frame. */
    private static burstOf(rate: Rate): number {
        const scale = { k: 1e3, m: 1e6, g: 1e9 }[rate.slice(-1).toLowerCase() as "k" | "m" | "g"];
        return Math.max(1500, Math.round((Number(rate.slice(0, -1)) * scale) / 800));
    }

    /** Each port or range as the platform writes it: `53`, `1000-2000`. */
    private static eachPort(ports: Ports): string[] {
        return [ports].flat().map((port) => (typeof port === "number" ? String(port) : `${port.min}-${port.max}`));
    }

    /** The family a hardware ACL rule is limited to, by its family or its addresses. */
    private static aclFamily(rule: AnyAclRule): Family | undefined {
        const match = rule.match;
        if (match?.family) return match.family;

        const address = match?.src ?? match?.dst;
        return address ? Address.family(Address.host(address)) : undefined;
    }

    /** The protocol as an IPv6 header names it. */
    private static nextHeader(protocol: string): string {
        return protocol === "icmp" ? "icmp6" : protocol;
    }

    /** A rule's term name: its place, then its description so a reader sees it on the device. */
    private static ruleName(label: string, description: string | undefined): string {
        return JunosRender.quote(description ? `${label} ${description}` : label);
    }

    private system(): void {
        this.out.set("system host-name", JunosRender.quote(this.device.name));

        const system = this.device.system ?? {};
        if (system.timezone) this.out.set("system time-zone", system.timezone);
        if (system.banner) this.out.set("system login message", JunosRender.quote(system.banner));

        for (const server of system.dns?.servers ?? []) this.out.set("system name-server", server);

        for (const server of system.ntp?.servers ?? []) this.out.set("system ntp server", server);

        // Redirects are sent unless turned off, for each family.
        if (!system.ip?.icmp_redirects) {
            this.out.set("system no-redirects");
            this.out.set("system no-redirects-ipv6");
        }

        const local = system.logging?.local;
        if (local) {
            this.out.set("system syslog file messages any", JunosRender.LEVEL[local.level]);
            if (local.files !== undefined) this.out.set("system syslog file messages archive files", local.files);
        }

        for (const remote of system.logging?.remote ?? []) {
            this.out.set("system syslog host", remote.address, "any", JunosRender.LEVEL[remote.level]);
            if (remote.port !== undefined && remote.port !== 514) this.out.set("system syslog host", remote.address, "port", remote.port);
        }
    }

    /** Every user but root logs in with a class. Root is the platform's own account and takes only its password and keys. */
    private users(): void {
        for (const [name, user] of Object.entries(this.device.users ?? {})) {
            const login = name === "root" ? "system root-authentication" : `system login user ${name} authentication`;

            if (name !== "root") {
                this.out.set(`system login user ${name} class`, JunosRender.USER_CLASS[user.role]);
                if (user.description) this.out.set(`system login user ${name} full-name`, JunosRender.quote(user.description));
            }

            this.out.set(login, "plain-text-password-value", Secrets.marker(user.password));

            for (const key of user.ssh_keys ?? [])
                this.out.set(login, JunosRender.KEY_STATEMENT[key.split(" ")[0]!]!, JunosRender.quote(key));
        }
    }

    private services(): void {
        const management = this.device.management ?? {};

        const ssh = management.ssh;
        if (ssh) {
            this.out.set("system services ssh");
            if (ssh.port !== undefined && ssh.port !== 22) this.out.set("system services ssh port", ssh.port);

            if (!ssh.weak_crypto) {
                for (const cipher of JunosRender.SSH_CIPHERS) this.out.set("system services ssh ciphers", cipher);
                for (const mac of JunosRender.SSH_MACS) this.out.set("system services ssh macs", mac);
                for (const exchange of JunosRender.SSH_KEY_EXCHANGES) this.out.set("system services ssh key-exchange", exchange);
            }
        }

        if (management.telnet) this.out.set("system services telnet");
        if (management.ftp) this.out.set("system services ftp");

        // The web interface, the REST API and NETCONF, each on its own port when given.
        const others = [
            ["http", "system services web-management http"],
            ["api", "system services rest http"],
            ["native", "system services netconf ssh"],
        ] as const;

        for (const [service, statement] of others) {
            const settings = management[service];
            if (!settings) continue;

            this.out.set(statement);
            if (settings.port !== undefined && settings.port !== JunosRender.SERVICE_PORTS[service][1])
                this.out.set(statement, "port", settings.port);
        }
    }

    /** SNMP version 2c with one read community, version 3 with users in one read-only group, or both. */
    private snmp(): void {
        const snmp = this.device.management?.snmp;
        if (!snmp) return;

        if (snmp.contact) this.out.set("snmp contact", JunosRender.quote(snmp.contact));
        if (snmp.location) this.out.set("snmp location", JunosRender.quote(snmp.location));
        if (snmp.community) this.out.set("snmp community", Secrets.marker(snmp.community), "authorization read-only");

        if (!snmp.users) return;

        for (const [name, user] of Object.entries(snmp.users)) {
            const usm = `snmp v3 usm local-engine user ${name}`;
            this.out.set(usm, JunosRender.SNMP_AUTH[user.auth], "authentication-password", Secrets.marker(user.auth_password));
            this.out.set(usm, JunosRender.SNMP_PRIVACY[user.privacy], "privacy-password", Secrets.marker(user.privacy_password));
            this.out.set("snmp v3 vacm security-to-group security-model usm security-name", name, "group", JunosRender.SNMP_GROUP);
        }

        this.out.set("snmp view all oid .1 include");
        this.out.set(
            `snmp v3 vacm access group ${JunosRender.SNMP_GROUP} default-context-prefix security-model usm security-level privacy read-view all`
        );
    }

    private vlans(): void {
        for (const [name, vlan] of Object.entries(this.device.vlans ?? {})) {
            this.out.set(`vlans ${name} vlan-id`, vlan.id);
            if (vlan.description) this.out.set(`vlans ${name} description`, JunosRender.quote(vlan.description));
        }

        for (const [name, iface] of Object.entries(this.device.interfaces ?? {})) {
            if (iface.type === "vlan") this.out.set(`vlans ${iface.vlan} l3-interface`, this.names.unit(name));
        }
    }

    /** Layer 2 membership of a port or LAG. The native VLAN is a member too, or its untagged frames are dropped. */
    private switching(physical: string, settings: Switched): void {
        const family = `interfaces ${physical} unit 0 family ethernet-switching`;

        if (settings.access_vlan) {
            this.out.set(family, "interface-mode access");
            this.out.set(family, "vlan members", settings.access_vlan);
        }

        if (settings.trunk_vlans) {
            this.out.set(family, "interface-mode trunk");

            const members = new Set([...settings.trunk_vlans, ...(settings.native_vlan ? [settings.native_vlan] : [])]);
            for (const vlan of members) this.out.set(family, "vlan members", vlan);

            if (settings.native_vlan) this.out.set(`interfaces ${physical} native-vlan-id`, this.device.vlans![settings.native_vlan]!.id);
        }

        const storm = JunosRender.stormProfile(settings);
        if (storm) this.out.set(family, "storm-control", storm.name);
    }

    /** Addresses and VRRP groups of a logical interface such as `irb.10`. */
    private addressing(unit: string, settings: AnyPort | AnyInterface): void {
        const [physical, number] = unit.split(".");
        const prefix = `interfaces ${physical} unit ${number}`;
        const addresses = (settings.addresses ?? []).map((entry) => (typeof entry === "string" ? entry : entry.address));

        for (const address of addresses)
            this.out.set(`${prefix} family ${Address.family(address) === "ipv4" ? "inet" : "inet6"} address`, address);

        for (const group of settings.vrrp ?? []) {
            const address = JunosRender.vrrpAddress(addresses, group);
            if (!address) continue;

            // The platform preempts unless told not to.
            const statement = `${prefix} family inet address ${address} vrrp-group ${group.id}`;
            this.out.set(statement, "virtual-address", group.address);
            if (group.priority !== undefined) this.out.set(statement, "priority", group.priority);
            if (!group.preempt) this.out.set(statement, "no-preempt");
            if (group.interval !== undefined && group.interval !== 1) this.out.set(statement, "advertise-interval", group.interval);
        }
    }

    /** Every port the model has. One the config does not declare is turned off, and so is a 10G cage's name for the optic it does not hold. */
    private ports(): void {
        for (const port of Catalog.ports(this.device.platform, this.device.model)) {
            const settings = this.device.ports?.[port as keyof typeof this.device.ports];
            const name = this.names.port(port);

            // A 10G cage is `xe-` with a 10G optic and `ge-` with a 1G one. The name not in use stays off, so a swapped optic does not bring up a port nobody configured.
            if (name.startsWith("xe-")) this.out.set(`interfaces ${name.replace("xe-", "ge-")} disable`);
            if (name.startsWith("ge-")) this.out.set(`interfaces ${name.replace("ge-", "xe-")} disable`);

            if (!settings) {
                this.out.set(`interfaces ${name} disable`);
                continue;
            }

            if (settings.description) this.out.set(`interfaces ${name} description`, JunosRender.quote(settings.description));

            if (settings.lag) {
                this.out.set(`interfaces ${name} ether-options 802.3ad`, `ae${this.names.lags.get(settings.lag)}`);
                continue;
            }

            const switched = !!(settings.access_vlan || settings.trunk_vlans);
            if (settings.mtu !== undefined) this.out.set(`interfaces ${name} mtu`, JunosRender.frameSize(settings.mtu, switched));

            this.switching(name, settings);
            this.addressing(`${name}.0`, settings);
        }
    }

    private lags(): void {
        let highest = -1;

        for (const [name, lag] of Object.entries(this.device.interfaces ?? {})) {
            if (lag.type !== "lag") continue;

            const physical = this.names.physical(name);
            highest = Math.max(highest, this.names.lags.get(name)!);

            if (lag.description) this.out.set(`interfaces ${physical} description`, JunosRender.quote(lag.description));
            if (lag.mode !== "static") this.out.set(`interfaces ${physical} aggregated-ether-options lacp active`);
            if (lag.mtu !== undefined)
                this.out.set(`interfaces ${physical} mtu`, JunosRender.frameSize(lag.mtu, !!(lag.access_vlan || lag.trunk_vlans)));

            this.switching(physical, lag);
            this.addressing(`${physical}.0`, lag);
        }

        // The platform makes this many LAG interfaces, numbered from 0.
        if (highest >= 0) this.out.set("chassis aggregated-devices ethernet device-count", highest + 1);
    }

    /** VLAN interfaces, loopbacks and GRE tunnels: a description, a tunnel's ends, addresses and VRRP, and an MTU per family. */
    private routedInterfaces(): void {
        for (const [name, iface] of Object.entries(this.device.interfaces ?? {})) {
            if (iface.type !== "vlan" && iface.type !== "loopback" && iface.type !== "gre") continue;

            const unit = this.names.unit(name);
            const [physical, number] = unit.split(".");
            const prefix = `interfaces ${physical} unit ${number}`;

            if (iface.description) this.out.set(`${prefix} description`, JunosRender.quote(iface.description));

            if (iface.type === "gre") {
                this.out.set(`${prefix} tunnel source`, iface.local);
                this.out.set(`${prefix} tunnel destination`, iface.remote);
            }

            this.addressing(unit, iface);

            if (iface.mtu === undefined) continue;

            const addresses = (iface.addresses ?? []).map((entry) => (typeof entry === "string" ? entry : entry.address));
            const families = new Set(addresses.map((address) => (Address.family(address) === "ipv4" ? "inet" : "inet6")));
            for (const family of families) this.out.set(`${prefix} family ${family} mtu`, iface.mtu);
        }
    }

    /** One profile per threshold the ports and LAGs name. */
    private stormProfiles(): void {
        const switched: Switched[] = [
            ...Object.values(this.device.ports ?? {}).filter((settings): settings is AnyPort => !!settings && !settings.lag),
            ...Object.values(this.device.interfaces ?? {}).filter((iface): iface is LagInterface => iface.type === "lag"),
        ];

        for (const settings of switched) {
            const storm = JunosRender.stormProfile(settings);
            if (!storm) continue;

            const profile = `forwarding-options storm-control-profiles ${storm.name} all`;
            this.out.set(profile, "bandwidth-percentage", storm.percent);
            for (const statement of storm.left) this.out.set(profile, statement);
        }
    }

    /**
     * Who reaches the device's own services: each guarded service from its sources only, time answered only to the servers the device keeps time from, and everything else as it was.
     *
     * The filter sits on every loopback unit and on each management port with an address, so it applies whichever routing table or port a packet arrives on.
     */
    private servicesFilter(): void {
        const management = this.device.management ?? {};
        const guarded: { service: keyof typeof JunosRender.SERVICE_PORTS; sources: readonly string[] }[] = [];

        for (const service of Object.keys(JunosRender.SERVICE_PORTS) as (keyof typeof JunosRender.SERVICE_PORTS)[]) {
            const settings = management[service];
            const sources = settings?.allow ?? management.allow;
            if (settings && sources?.length) guarded.push({ service, sources });
        }

        const ntp = this.device.system?.ntp;
        const keepsTimeQuietly = !!ntp?.servers.length && !ntp.serve;
        if (!guarded.length && !keepsTimeQuietly) return;

        const families = [
            ["inet", "ipv4", "protocol"],
            ["inet6", "ipv6", "next-header"],
        ] as const;

        for (const [family, addressFamily, protocolWord] of families) {
            const filter = `firewall family ${family} filter ${JunosRender.SERVICES_FILTER[family]}`;
            const ofFamily = (prefix: string) => Address.family(Address.host(prefix)) === addressFamily;

            for (const { service, sources } of guarded) {
                const [protocol, standardPort] = JunosRender.SERVICE_PORTS[service];
                const port = management[service]?.port ?? standardPort;
                const term = `${filter} term ${service}`;
                const allowed = sources.filter(ofFamily);

                // A term without a source would accept every source, so a family no source is in gets only the discard.
                if (allowed.length) {
                    for (const source of allowed) this.out.set(term, "from source-address", source);
                    this.out.set(term, "from", protocolWord, protocol);
                    this.out.set(term, "from destination-port", port);
                    this.out.set(term, "then accept");
                }

                const others = `${filter} term ${service}-others`;
                this.out.set(others, "from", protocolWord, protocol);
                this.out.set(others, "from destination-port", port);
                this.out.set(others, "then discard");
            }

            if (keepsTimeQuietly) {
                const servers = ntp!.servers.filter(ofFamily);

                if (servers.length) {
                    const length = addressFamily === "ipv4" ? 32 : 128;
                    for (const server of servers) this.out.set(`${filter} term ntp from source-address`, `${server}/${length}`);
                    this.out.set(`${filter} term ntp from`, protocolWord, "udp");
                    this.out.set(`${filter} term ntp from destination-port 123`);
                    this.out.set(`${filter} term ntp then accept`);
                }

                this.out.set(`${filter} term ntp-others from`, protocolWord, "udp");
                this.out.set(`${filter} term ntp-others from destination-port 123`);
                this.out.set(`${filter} term ntp-others then discard`);
            }

            this.out.set(`${filter} term everything-else then accept`);
        }

        const anchors = new Set(["lo0.0", ...[...this.names.loopbacks.values()].map((unit) => `lo0.${unit}`)]);

        for (const [port, settings] of Object.entries(this.device.ports ?? {})) {
            const name = this.names.port(port);
            if (settings?.addresses?.length && name.startsWith("em")) anchors.add(`${name}.0`);
        }

        for (const anchor of anchors) {
            const [physical, unit] = anchor.split(".");
            this.out.set(`interfaces ${physical} unit ${unit} family inet filter input ${JunosRender.SERVICES_FILTER.inet}`);
            this.out.set(`interfaces ${physical} unit ${unit} family inet6 filter input ${JunosRender.SERVICES_FILTER.inet6}`);
        }
    }

    /** A VRF is a virtual router: its own table, holding its interfaces. */
    private vrfs(): void {
        for (const [name, vrf] of Object.entries(this.device.vrfs ?? {})) {
            this.out.set(`routing-instances ${name} instance-type virtual-router`);
            if (vrf.description) this.out.set(`routing-instances ${name} description`, JunosRender.quote(vrf.description));
        }

        const routed = [...Object.entries(this.device.ports ?? {}), ...Object.entries(this.device.interfaces ?? {})];

        for (const [name, settings] of routed) {
            if (settings?.vrf) this.out.set(`routing-instances ${settings.vrf} interface`, this.names.unit(name));
        }
    }

    /** A route with a distance names its next hop as qualified, so two routes to one prefix can each have their own. */
    private staticRoutes(): void {
        if (this.device.routing?.router_id) this.out.set("routing-options router-id", this.device.routing.router_id);

        for (const route of this.device.routing?.static ?? []) {
            const ipv6 = Address.family(Address.split(route.prefix).addr) === "ipv6";
            const table = ipv6 ? ` rib ${route.vrf ? `${route.vrf}.` : ""}inet6.0` : "";
            const options = route.vrf ? `routing-instances ${route.vrf} routing-options${table}` : `routing-options${table}`;
            const statement = `${options} static route ${route.prefix}`;

            if (route.blackhole) {
                this.out.set(statement, "discard");
                if (route.distance !== undefined) this.out.set(statement, "preference", route.distance);
                continue;
            }

            const nextHop = route.via ?? this.names.unit(route.interface!);
            if (route.distance === undefined) this.out.set(statement, "next-hop", nextHop);
            else this.out.set(statement, "qualified-next-hop", nextHop, "preference", route.distance);
        }
    }

    /** Spanning tree on every switched port and LAG, each with its own settings. RSTP when no mode is given. */
    private spanningTree(): void {
        const stp = this.device.stp;
        if (!stp) return;

        // The platform has no plain STP; RSTP is held to it.
        const protocol = `protocols ${stp.mode === "mstp" ? "mstp" : "rstp"}`;
        if (stp.mode === "stp") this.out.set(protocol, "force-version stp");
        if (stp.priority !== undefined) this.out.set(protocol, "bridge-priority", stp.priority === 0 ? "0" : `${stp.priority / 1024}k`);

        const switched: [string, Switched][] = [];

        for (const [port, settings] of Object.entries(this.device.ports ?? {})) {
            if (settings && !settings.lag && (settings.access_vlan || settings.trunk_vlans))
                switched.push([this.names.port(port), settings]);
        }

        for (const [name, lag] of Object.entries(this.device.interfaces ?? {})) {
            if (lag.type === "lag" && (lag.access_vlan || lag.trunk_vlans)) switched.push([this.names.physical(name), lag]);
        }

        for (const [name, settings] of switched) {
            const statement = `${protocol} interface ${name}`;
            this.out.set(statement);

            if (settings.stp === false) this.out.set(statement, "disable");
            else if (typeof settings.stp === "object") {
                if (settings.stp.edge) this.out.set(statement, "edge");
                if (settings.stp.cost !== undefined) this.out.set(statement, "cost", settings.stp.cost);
                if (settings.stp.priority !== undefined) this.out.set(statement, "priority", settings.stp.priority);
            }
        }
    }

    /** LLDP on every port or on those listed, a port's own setting over the device's. LLDP runs on a LAG's member ports. */
    private lldp(): void {
        const lldp = this.device.lldp;

        if (lldp === true) this.out.set("protocols lldp interface all");
        else if (lldp)
            for (const name of lldp.interfaces) for (const port of this.names.members(name)) this.out.set("protocols lldp interface", port);

        for (const [port, settings] of Object.entries(this.device.ports ?? {})) {
            if (settings?.lldp === false) this.out.set("protocols lldp interface", this.names.port(port), "disable");
            else if (settings?.lldp === true) this.out.set("protocols lldp interface", this.names.port(port));
        }
    }

    /** OSPF for IPv4 and OSPFv3 for IPv6, with the same areas and interfaces. */
    private ospf(): void {
        const ospf = this.device.routing?.ospf;
        if (!ospf) return;

        const protocols = (ospf.families ?? ["ipv4"]).map((family) => (family === "ipv4" ? "ospf" : "ospf3"));

        for (const protocol of protocols) {
            for (const [areaId, area] of Object.entries(ospf.areas)) {
                for (const [iface, settings] of Object.entries(area.interfaces)) {
                    const statement = `protocols ${protocol} area ${areaId} interface ${this.names.unit(iface)}`;
                    this.out.set(statement);

                    if (settings?.cost !== undefined) this.out.set(statement, "metric", settings.cost);
                    if (settings?.passive) this.out.set(statement, "passive");
                    if (settings?.network === "point-to-point") this.out.set(statement, "interface-type p2p");
                    if (settings?.bfd) this.out.set(statement, "bfd-liveness-detection minimum-interval", JunosRender.BFD_INTERVAL);
                }
            }

            if (ospf.redistribute?.length) this.out.set(`protocols ${protocol} export`, JunosRender.OSPF_EXPORT);
        }

        for (const source of ospf.redistribute ?? []) {
            const term = `policy-options policy-statement ${JunosRender.OSPF_EXPORT} term ${source}`;
            this.out.set(term, "from protocol", source === "connected" ? "direct" : "static");
            this.out.set(term, "then accept");
        }
    }

    /** Each relay is a group of servers and the interface it listens on, in the table that interface routes in. */
    private dhcpRelay(): void {
        for (const [name, relay] of Object.entries(this.device.dhcp_relay ?? {})) {
            const vrf =
                this.device.interfaces?.[relay.interface]?.vrf ??
                this.device.ports?.[relay.interface as keyof typeof this.device.ports]?.vrf;
            const relays = vrf ? `routing-instances ${vrf} forwarding-options dhcp-relay` : "forwarding-options dhcp-relay";

            for (const server of relay.servers) this.out.set(`${relays} server-group ${name}`, server);
            this.out.set(`${relays} group ${name} active-server-group`, name);
            this.out.set(`${relays} group ${name} interface`, this.names.unit(relay.interface));
        }
    }

    /** sFlow from the management address, to each collector, on every declared port or those listed. A LAG is observed on its member ports. */
    private sflow(): void {
        const flow = this.device.flow_export;
        if (flow?.protocol !== "sflow") return;

        if (this.device.connection.host) this.out.set("protocols sflow agent-id", this.device.connection.host);
        if (flow.sampling !== undefined) this.out.set("protocols sflow sample-rate ingress", flow.sampling);

        for (const collector of flow.collectors) {
            this.out.set("protocols sflow collector", collector.address);
            if (collector.port !== undefined && collector.port !== 6343) {
                this.out.set("protocols sflow collector", collector.address, "udp-port", collector.port);
            }
        }

        const declared = Object.entries(this.device.ports ?? {}).filter(([, settings]) => settings && !settings.lag);
        const observed = flow.interfaces ?? declared.map(([port]) => port);

        for (const name of observed) {
            for (const port of this.names.members(name))
                if (!port.startsWith("em")) this.out.set("protocols sflow interfaces", `${port}.0`);
        }
    }

    /**
     * Hardware ACLs. A switched port takes a filter of the switching family, which matches IPv4 and IPv6 under `ip-version`; a routed port takes one filter per family. Each ends by accepting what no rule matched.
     */
    private acls(): void {
        const switched = new Set<string>();
        const routed = new Set<string>();

        for (const [port, settings] of Object.entries(this.device.ports ?? {})) {
            if (!settings?.acl) continue;

            const physical = this.names.port(port);

            if (settings.access_vlan || settings.trunk_vlans) {
                switched.add(settings.acl);
                this.out.set(`interfaces ${physical} unit 0 family ethernet-switching filter input`, settings.acl);
            } else {
                routed.add(settings.acl);
                this.out.set(`interfaces ${physical} unit 0 family inet filter input`, `${settings.acl}-v4`);
                this.out.set(`interfaces ${physical} unit 0 family inet6 filter input`, `${settings.acl}-v6`);
            }
        }

        for (const acl of switched) this.switchingFilter(acl);

        for (const acl of routed) {
            this.routedFilter(acl, "ipv4");
            this.routedFilter(acl, "ipv6");
        }
    }

    /** A rule's decision, through a policer when it has a rate. */
    private aclThen(term: string, policer: string, rule: AnyAclRule): void {
        if (rule.action === "drop") {
            this.out.set(term, "then discard");
            return;
        }

        if (rule.rate) {
            this.out.set(`firewall policer ${policer} if-exceeding bandwidth-limit`, JunosRender.bandwidth(rule.rate));
            this.out.set(`firewall policer ${policer} if-exceeding burst-size-limit`, JunosRender.burstOf(rule.rate));
            this.out.set(`firewall policer ${policer} then discard`);
            this.out.set(term, "then policer", policer);
        }

        this.out.set(term, "then accept");
    }

    private switchingFilter(acl: string): void {
        const filter = `firewall family ethernet-switching filter ${acl}`;

        (this.device.acls?.[acl] ?? []).forEach((rule, index) => {
            const match = rule.match ?? {};
            const addressed = match.src || match.dst || match.protocol || match.src_port !== undefined || match.dst_port !== undefined;
            const family = JunosRender.aclFamily(rule);
            const families = addressed || family ? (family ? [family] : (["ipv4", "ipv6"] as const)) : [undefined];

            for (const each of families) {
                const label = families.length > 1 ? `${index + 1}-${each === "ipv4" ? "v4" : "v6"}` : `${index + 1}`;
                const term = `${filter} term ${JunosRender.ruleName(label, rule.description)}`;

                if (each) {
                    const version = `from ip-version ${each}`;
                    const v4 = each === "ipv4";

                    if (match.src) this.out.set(term, version, v4 ? "ip-source-address" : "ip6-source-address", match.src);
                    if (match.dst) this.out.set(term, version, v4 ? "ip-destination-address" : "ip6-destination-address", match.dst);
                    if (match.protocol)
                        this.out.set(
                            term,
                            version,
                            v4 ? "ip-protocol" : "next-header",
                            v4 ? match.protocol : JunosRender.nextHeader(match.protocol)
                        );
                    for (const port of match.src_port !== undefined ? JunosRender.eachPort(match.src_port) : [])
                        this.out.set(term, version, "source-port", port);
                    for (const port of match.dst_port !== undefined ? JunosRender.eachPort(match.dst_port) : [])
                        this.out.set(term, version, "destination-port", port);
                    if (!addressed) this.out.set(term, version);
                }

                this.aclThen(term, `${acl}-${label}`, rule);
            }
        });

        this.out.set(filter, "term circuit-default then accept");
    }

    private routedFilter(acl: string, family: Family): void {
        const name = `${acl}-${family === "ipv4" ? "v4" : "v6"}`;
        const filter = `firewall family ${family === "ipv4" ? "inet" : "inet6"} filter ${name}`;

        (this.device.acls?.[acl] ?? []).forEach((rule, index) => {
            const ruleFamily = JunosRender.aclFamily(rule);
            if (ruleFamily && ruleFamily !== family) return;

            const match = rule.match ?? {};
            const label = `${index + 1}`;
            const term = `${filter} term ${JunosRender.ruleName(label, rule.description)}`;
            const protocolWord = family === "ipv4" ? "protocol" : "next-header";

            if (match.src) this.out.set(term, "from source-address", match.src);
            if (match.dst) this.out.set(term, "from destination-address", match.dst);
            if (match.protocol)
                this.out.set(term, "from", protocolWord, family === "ipv4" ? match.protocol : JunosRender.nextHeader(match.protocol));
            for (const port of match.src_port !== undefined ? JunosRender.eachPort(match.src_port) : [])
                this.out.set(term, "from source-port", port);
            for (const port of match.dst_port !== undefined ? JunosRender.eachPort(match.dst_port) : [])
                this.out.set(term, "from destination-port", port);

            this.aclThen(term, `${name}-${label}`, rule);
        });

        this.out.set(filter, "term circuit-default then accept");
    }

    /** A DHCP server is an address pool with its network, range, options and reservations, served on its interface. */
    private dhcpServers(): void {
        for (const [name, server] of Object.entries(this.device.dhcp ?? {})) {
            this.out.set(`system services dhcp-local-server group ${name} interface`, this.names.unit(server.interface));

            const pool = `access address-assignment pool ${name} family inet`;
            const [low, high] = server.pool;
            this.out.set(pool, "network", server.network);
            this.out.set(pool, `range ${name} low`, low);
            this.out.set(pool, `range ${name} high`, high);
            this.out.set(pool, "dhcp-attributes router", server.gateway);

            for (const resolver of server.dns ?? []) this.out.set(pool, "dhcp-attributes name-server", resolver);
            if (server.lease_time !== undefined) this.out.set(pool, "dhcp-attributes maximum-lease-time", server.lease_time);

            // A reservation is named by its address.
            for (const reservation of server.reservations ?? []) {
                const host = `${pool} host ${reservation.address.replace(/\./g, "-")}`;
                this.out.set(host, "hardware-address", reservation.mac.toLowerCase());
                this.out.set(host, "ip-address", reservation.address);
            }
        }
    }

    /** Router advertisements announce each IPv6 network of the interface. */
    private routerAdvertisements(): void {
        const routed = [...Object.entries(this.device.ports ?? {}), ...Object.entries(this.device.interfaces ?? {})];

        for (const [name, settings] of routed) {
            if (!settings?.ipv6_ra) continue;

            const addresses = (settings.addresses ?? []).map((entry) => (typeof entry === "string" ? entry : entry.address));

            for (const address of addresses.filter((address) => Address.family(address) === "ipv6")) {
                this.out.set(`protocols router-advertisement interface ${this.names.unit(name)} prefix`, Address.prefixOf(address));
            }
        }
    }
}
