import { Address } from "../../core/address";
import { Cabling } from "../../core/cabling";
import { Secrets } from "../../core/secrets";
import type { AclRule, Device, Ethertype, Family, Interface, Lag, Port, Ports, Rate, Routed, Severity, Vrrp } from "../../model";
import { Catalog } from "../../core/catalog";
import { Derive } from "../../core/derive";
import { JunosBgp } from "./bgp";
import { JunosNames } from "./names";
import { JunosStatements } from "./statements";

type Switched = Port | Lag;

/** The configuration as `set` statements, in the form `show configuration | display set` prints, so the plan compares them one by one. */
export class JunosRender {
    private static readonly USER_CLASS = { admin: "super-user", operator: "operator", "read-only": "read-only" } as const;

    /** The statement for each kind of public key, by the key's own prefix. */
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

    /** The platform has no debug level, so debug is `any`, which takes everything. */
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

    /** Who reaches the device's own services, one filter per family. A filter's name is unique across families. */
    private static readonly SERVICES_FILTER = { inet: "circuit-services", inet6: "circuit-services-v6" } as const;

    private static readonly OSPF_EXPORT = "circuit-ospf-redistribute";

    /** Strong ciphers, MACs, and key exchanges, offered unless `weak_crypto`. */
    private static readonly SSH_CIPHERS = ["aes256-gcm@openssh.com", "aes128-gcm@openssh.com", "aes256-ctr", "aes192-ctr", "aes128-ctr"];
    private static readonly SSH_MACS = ["hmac-sha2-512", "hmac-sha2-256"];
    private static readonly SSH_KEY_EXCHANGES = [
        "curve25519-sha256",
        "ecdh-sha2-nistp521",
        "ecdh-sha2-nistp384",
        "ecdh-sha2-nistp256",
        "group-exchange-sha2",
    ];

    /** The transport and port each management service listens on, by the name of its term in the services filter. */
    private static readonly SERVICE_PORTS = {
        ssh: ["tcp", 22],
        telnet: ["tcp", 23],
        ftp: ["tcp", 21],
        snmp: ["udp", 161],
        http: ["tcp", 80],
        api: ["tcp", 3000],
        native: ["tcp", 830],
    } as const;

    /** Kinds of frame as `ether-type` names them, in the order the render writes them. */
    private static readonly ETHERTYPES: readonly Ethertype[] = ["ipv4", "ipv6", "arp"];

    /** Kinds of flooded traffic, with the statement that leaves each out of a storm-control profile. */
    private static readonly STORM_KINDS = [
        ["broadcast", "no-broadcast"],
        ["multicast", "no-multicast"],
        ["unknown_unicast", "no-unknown-unicast"],
    ] as const;

    /** `0.0.0.0`, which a host asking DHCP for an address sends from. */
    private static readonly IPV4_ALWAYS = ["0.0.0.0/32"];

    /** Link-local addresses, and `::` while a host checks an address is free: IPv6 needs both, so every bound host sends from them. */
    private static readonly IPV6_ALWAYS = ["fe80::/10", "::/128"];

    private readonly out = new JunosStatements();
    private readonly names: JunosNames;

    private constructor(private readonly device: Device) {
        this.names = new JunosNames(device);
    }

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
        render.ethertypeFilters();
        render.boundFilters();
        JunosBgp.render(render.out, device);
        render.sflow();

        return render.out.text();
    }

    /** The address a VRRP group sits on: the one whose network holds the virtual address. */
    static vrrpAddress(addresses: readonly string[], group: Vrrp): string | undefined {
        return addresses.find((address) => Address.family(address) === "ipv4" && Address.contains(address, group.address));
    }

    /** A profile holds one threshold for every kind it limits, so a port's kinds must share one in percent. `unsupported()` refuses any other. */
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
    private static aclFamily(rule: AclRule): Family | undefined {
        const match = rule.if;
        if (match?.family) return match.family;

        const address = JunosRender.each(match?.src ?? match?.dst)[0];
        return address ? Address.family(Address.host(address)) : undefined;
    }

    /** One value or a list of them, as a list. `unsupported()` refuses a list in an ACL rule's match, so a rule rendered for a device has one. */
    private static each<T extends string>(value: T | readonly T[] | undefined): T[] {
        return value === undefined ? [] : ([value].flat() as T[]);
    }

    /** The protocol as an IPv6 header names it. */
    private static nextHeader(protocol: string): string {
        return protocol === "icmp" ? "icmp6" : protocol;
    }

    /** A rule's term name: its place, then its description so a reader sees it on the device. */
    private static ruleName(label: string, description: string | undefined): string {
        return JunosStatements.quote(description ? `${label} ${description}` : label);
    }

    private system(): void {
        this.out.set("system host-name", JunosStatements.quote(this.device.name));

        const system = this.device.system ?? {};
        if (system.timezone) this.out.set("system time-zone", system.timezone);
        if (system.banner) this.out.set("system login message", JunosStatements.quote(system.banner));

        for (const server of system.dns?.servers ?? []) this.out.set("system name-server", server);

        for (const server of system.ntp?.servers ?? []) this.out.set("system ntp server", server);

        // Redirects are sent unless turned off, for each family.
        if (!system.ip_stack?.icmp_redirects) {
            this.out.set("system no-redirects");
            this.out.set("system no-redirects-ipv6");
        }

        const local = system.logging?.local;
        if (local) {
            this.out.set("system syslog file messages any", JunosRender.LEVEL[local.level]);
            if (local.files !== undefined) this.out.set("system syslog file messages archive files", local.files);
        }

        for (const remote of this.device.monitoring?.syslog ?? []) {
            this.out.set("system syslog host", remote.address, "any", JunosRender.LEVEL[remote.level]);
            if (remote.port !== undefined && remote.port !== 514) this.out.set("system syslog host", remote.address, "port", remote.port);
        }
    }

    /** Every user but root logs in with a class. Root is the platform's own account and takes only its password and keys. */
    private users(): void {
        for (const [name, user] of Object.entries(this.device.system?.users ?? {})) {
            if (!user) continue;

            const login = name === "root" ? "system root-authentication" : `system login user ${name} authentication`;

            if (name !== "root") {
                this.out.set(`system login user ${name} class`, JunosRender.USER_CLASS[user.role]);
                if (user.description) this.out.set(`system login user ${name} full-name`, JunosStatements.quote(user.description));
            }

            this.out.set(login, "plain-text-password-value", Secrets.marker(user.password));

            for (const key of user.ssh_keys ?? [])
                this.out.set(login, JunosRender.KEY_STATEMENT[key.split(" ")[0]!]!, JunosStatements.quote(key));
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

        const others = [
            ["http", "system services web-management http"],
            ["api", "system services rest http"],
            ["native", "system services netconf ssh"],
        ] as const;

        for (const [service, statement] of others) {
            const settings = this.serviceSettings(service);
            if (!settings) continue;

            this.out.set(statement);
            if (settings.port !== undefined && settings.port !== JunosRender.SERVICE_PORTS[service][1])
                this.out.set(statement, "port", settings.port);
        }
    }

    /** A service's settings, by the name of its term in the services filter: SNMP is `monitoring.snmp`, NETCONF `management.native_protocol`. */
    private serviceSettings(service: keyof typeof JunosRender.SERVICE_PORTS): { allow?: readonly string[]; port?: number } | undefined {
        if (service === "snmp") return this.device.monitoring?.snmp;
        if (service === "native") return this.device.management?.native_protocol;

        return this.device.management?.[service];
    }

    /** SNMP version 2c with one read community, version 3 with users in one read-only group, or both. */
    private snmp(): void {
        const snmp = this.device.monitoring?.snmp;
        if (!snmp) return;

        if (snmp.contact) this.out.set("snmp contact", JunosStatements.quote(snmp.contact));
        if (snmp.location) this.out.set("snmp location", JunosStatements.quote(snmp.location));
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
        for (const [name, vlan] of Object.entries(this.device.switching?.vlans ?? {})) {
            if (!vlan) continue;

            this.out.set(`vlans ${name} vlan-id`, vlan.id);
            if (vlan.description) this.out.set(`vlans ${name} description`, JunosStatements.quote(vlan.description));
        }

        for (const [name, iface] of Object.entries(this.device.interfaces?.vlan_interface ?? {})) {
            if (iface) this.out.set(`vlans ${iface.vlan} l3-interface`, this.names.unit(name));
        }
    }

    /** The native VLAN is a member too, or its untagged frames are dropped. */
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

            if (settings.native_vlan)
                this.out.set(`interfaces ${physical} native-vlan-id`, this.device.switching!.vlans![settings.native_vlan]!.id);
        }

        const storm = JunosRender.stormProfile(settings);
        if (storm) this.out.set(family, "storm-control", storm.name);

        // The device keeps the limit on the logical interface, `xe-0/0/1.0`, as two statements.
        if (settings.mac_limit !== undefined) {
            const limit = `switch-options interface ${physical}.0 interface-mac-limit`;
            this.out.set(limit, settings.mac_limit);
            this.out.set(limit, "packet-action drop");
        }

        if (settings.ethertypes) this.out.set(family, "filter input", JunosRender.ethertypeFilter(settings.ethertypes));
        if (settings.bound_to) this.out.set(family, "filter input", JunosRender.boundFilter(physical));
    }

    /** A bound port's filter, named after the port: `circuit-bound-xe-0-0-1`. */
    private static boundFilter(physical: string): string {
        return `circuit-bound-${physical.replaceAll("/", "-")}`;
    }

    /** Each host on a bound port gets a term per kind of packet from its MAC address: IPv4, IPv6, and ARP. IP comes from the host's own addresses or those every host needs. The rest is discarded. The device prints a MAC address with its length, `/48`. */
    private boundFilters(): void {
        const holders: [string, Switched][] = [
            ...Derive.ports(this.device).flatMap(([port, settings]): [string, Switched][] =>
                settings.in_lag ? [] : [[this.names.port(port), settings]]
            ),
            ...this.lagSettings().map(([name, lag]): [string, Switched] => [this.names.physical(name), lag]),
        ];

        for (const [physical, settings] of holders) {
            if (!settings.bound_to) continue;

            const filter = `firewall family ethernet-switching filter ${JunosRender.boundFilter(physical)}`;

            settings.bound_to.forEach((host, index) => {
                const term = `${filter} term host-${index + 1}`;
                const mac = `${host.mac.toLowerCase()}/48`;
                const of = (family: Family) =>
                    host.addresses.filter((address) => Address.family(address.split("/")[0]!) === family).map(JunosRender.withLength);

                this.out.set(`${term}-ipv4 from source-mac-address`, mac);
                for (const address of [...of("ipv4"), ...JunosRender.IPV4_ALWAYS])
                    this.out.set(`${term}-ipv4 from ip-source-address`, address);
                this.out.set(`${term}-ipv4 then accept`);

                this.out.set(`${term}-ipv6 from source-mac-address`, mac);
                for (const address of [...of("ipv6"), ...JunosRender.IPV6_ALWAYS])
                    this.out.set(`${term}-ipv6 from ip-version ipv6 ip6-source-address`, address);
                this.out.set(`${term}-ipv6 then accept`);

                this.out.set(`${term}-arp from source-mac-address`, mac);
                this.out.set(`${term}-arp from ether-type arp`);
                this.out.set(`${term}-arp then accept`);
            });

            this.out.set(`${filter} term others then discard`);
        }
    }

    /** An address or prefix as a filter matches it: with its length, `/32` or `/128` for one address, IPv6 as RFC 5952 writes it. */
    private static withLength(address: string): string {
        const canonical = Address.canonical(address);
        return canonical.includes("/") ? canonical : `${canonical}/${Address.bits(Address.family(canonical))}`;
    }

    /** The filter that lets only these kinds of frame in, named after them: `circuit-ethertypes-ipv4-ipv6-arp`. */
    private static ethertypeFilter(kinds: readonly Ethertype[]): string {
        return `circuit-ethertypes-${JunosRender.ETHERTYPES.filter((kind) => kinds.includes(kind)).join("-")}`;
    }

    /** One filter for each set of kinds a port or LAG lets in: those kinds, then nothing else. */
    private ethertypeFilters(): void {
        const holders: Switched[] = [
            ...Derive.ports(this.device).map(([, settings]) => settings),
            ...this.lagSettings().map(([, lag]) => lag),
        ];

        for (const settings of holders) {
            if (!settings.ethertypes) continue;

            const filter = `firewall family ethernet-switching filter ${JunosRender.ethertypeFilter(settings.ethertypes)}`;
            for (const kind of JunosRender.ETHERTYPES.filter((kind) => settings.ethertypes!.includes(kind)))
                this.out.set(filter, "term allowed from ether-type", kind);
            this.out.set(filter, "term allowed then accept");
            this.out.set(filter, "term others then discard");
        }
    }

    /** Addresses and VRRP groups of a logical interface such as `irb.10`. */
    private addressing(unit: string, settings: Routed): void {
        const [physical, number] = unit.split(".");
        const prefix = `interfaces ${physical} unit ${number}`;
        const addresses = (settings.addresses ?? []).map((entry) => (typeof entry === "string" ? entry : entry.address));

        for (const address of addresses)
            this.out.set(`${prefix} family ${Address.family(address) === "ipv4" ? "inet" : "inet6"} address`, address);

        // Strict is the mode when none is written. `unsupported()` refuses loose.
        for (const family of ["ipv4", "ipv6"] as const)
            if (settings.urpf?.[family] === "strict") this.out.set(`${prefix} family ${family === "ipv4" ? "inet" : "inet6"} rpf-check`);

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

    /** A port the config does not declare is turned off. */
    private ports(): void {
        for (const port of Catalog.ports(this.device.platform, this.device.model)) {
            const settings = this.device.interfaces?.ethernet?.[port];
            const name = this.names.port(port);

            // A 10G cage is `xe-` with a 10G optic and `ge-` with a 1G one. The name not in use stays off, so a swapped optic does not bring up a port nobody configured.
            if (name.startsWith("xe-")) this.out.set(`interfaces ${name.replace("xe-", "ge-")} disable`);
            if (name.startsWith("ge-")) this.out.set(`interfaces ${name.replace("ge-", "xe-")} disable`);

            if (!settings) {
                this.out.set(`interfaces ${name} disable`);
                continue;
            }

            if (settings.description) this.out.set(`interfaces ${name} description`, JunosStatements.quote(settings.description));

            if (settings.in_lag) {
                this.out.set(`interfaces ${name} ether-options 802.3ad`, `ae${this.names.lags.get(settings.in_lag)}`);
                continue;
            }

            const switched = !!(settings.access_vlan || settings.trunk_vlans);
            if (settings.mtu !== undefined) this.out.set(`interfaces ${name} mtu`, JunosRender.frameSize(settings.mtu, switched));

            this.switching(name, settings);
            this.addressing(`${name}.0`, settings);
        }
    }

    private lagSettings(): [string, Lag][] {
        return Object.entries(this.device.interfaces?.lag ?? {}).flatMap(([name, lag]) => (lag ? [[name, lag] as [string, Lag]] : []));
    }

    private lags(): void {
        let highest = -1;

        for (const [name, lag] of this.lagSettings()) {
            const physical = this.names.physical(name);
            highest = Math.max(highest, this.names.lags.get(name)!);

            if (lag.description) this.out.set(`interfaces ${physical} description`, JunosStatements.quote(lag.description));
            if (lag.mode !== "static") this.out.set(`interfaces ${physical} aggregated-ether-options lacp active`);
            if (lag.mtu !== undefined)
                this.out.set(`interfaces ${physical} mtu`, JunosRender.frameSize(lag.mtu, !!(lag.access_vlan || lag.trunk_vlans)));

            this.switching(physical, lag);
            this.addressing(`${physical}.0`, lag);
        }

        // The platform makes this many LAG interfaces, numbered from 0.
        if (highest >= 0) this.out.set("chassis aggregated-devices ethernet device-count", highest + 1);
    }

    private routedInterfaces(): void {
        for (const { name, kind, settings: iface } of Derive.interfaces(this.device)) {
            if (kind !== "vlan_interface" && kind !== "loopback" && kind !== "gre") continue;

            const unit = this.names.unit(name);
            const [physical, number] = unit.split(".");
            const prefix = `interfaces ${physical} unit ${number}`;

            if (iface.description) this.out.set(`${prefix} description`, JunosStatements.quote(iface.description));

            const tunnel = kind === "gre" ? this.device.interfaces?.gre?.[name] : undefined;
            if (tunnel) {
                this.out.set(`${prefix} tunnel source`, Address.host(tunnel.local_address));
                this.out.set(`${prefix} tunnel destination`, tunnel.remote_address);
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
            ...Derive.ports(this.device)
                .filter(([, settings]) => !settings.in_lag)
                .map(([, settings]) => settings),
            ...this.lagSettings().map(([, lag]) => lag),
        ];

        for (const settings of switched) {
            const storm = JunosRender.stormProfile(settings);
            if (!storm) continue;

            const profile = `forwarding-options storm-control-profiles ${storm.name} all`;
            this.out.set(profile, "bandwidth-percentage", storm.percent);
            for (const statement of storm.left) this.out.set(profile, statement);
        }
    }

    /** A guarded service is reached from its sources only, and time is answered only to the device's NTP servers. The filter sits on every loopback unit and each addressed management port, so it applies whichever table or port a packet arrives on. */
    private servicesFilter(): void {
        const management = this.device.management ?? {};
        const guarded: { service: keyof typeof JunosRender.SERVICE_PORTS; sources: readonly string[] }[] = [];

        // The project has turned an address set's name in `management.allow` into its addresses.
        const allowed = typeof management.allow === "string" ? undefined : management.allow;

        for (const service of Object.keys(JunosRender.SERVICE_PORTS) as (keyof typeof JunosRender.SERVICE_PORTS)[]) {
            const settings = this.serviceSettings(service);
            const sources = settings?.allow ?? allowed;
            if (settings && sources?.length) guarded.push({ service, sources });
        }

        const ntp = this.device.system?.ntp;
        const keepsTimeQuietly = !!ntp?.servers.length && !this.device.services?.ntp_server;
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
                const port = this.serviceSettings(service)?.port ?? standardPort;
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

        for (const [port, settings] of Derive.ports(this.device)) {
            const name = this.names.port(port);
            if (settings.addresses?.length && name.startsWith("em")) anchors.add(`${name}.0`);
        }

        for (const anchor of anchors) {
            const [physical, unit] = anchor.split(".");
            this.out.set(`interfaces ${physical} unit ${unit} family inet filter input ${JunosRender.SERVICES_FILTER.inet}`);
            this.out.set(`interfaces ${physical} unit ${unit} family inet6 filter input ${JunosRender.SERVICES_FILTER.inet6}`);
        }
    }

    /** A VRF is a virtual router: its own table, holding its interfaces. */
    private vrfs(): void {
        for (const [name, vrf] of Object.entries(this.device.routing?.vrfs ?? {})) {
            if (!vrf) continue;

            this.out.set(`routing-instances ${name} instance-type virtual-router`);
            if (vrf.description) this.out.set(`routing-instances ${name} description`, JunosStatements.quote(vrf.description));
        }

        for (const [name, settings] of this.routed()) {
            if (settings.vrf) this.out.set(`routing-instances ${settings.vrf} interface`, this.names.unit(name));
        }
    }

    /** A route with a distance names its next hop as qualified, so two routes to one prefix can each have their own. */
    private staticRoutes(): void {
        if (this.device.routing?.router_id) this.out.set("routing-options router-id", this.device.routing.router_id);

        for (const route of this.device.routing?.static_routes ?? []) {
            const ipv6 = Address.family(Address.split(route.prefix).addr) === "ipv6";
            const table = ipv6 ? ` rib ${route.vrf ? `${route.vrf}.` : ""}inet6.0` : "";
            const options = route.vrf ? `routing-instances ${route.vrf} routing-options${table}` : `routing-options${table}`;
            const statement = `${options} static route ${route.prefix}`;

            if (route.blackhole) {
                this.out.set(statement, "discard");
                if (route.distance !== undefined) this.out.set(statement, "preference", route.distance);
                continue;
            }

            const nextHop = route.next_hop ? Address.host(route.next_hop) : this.names.unit(route.interface!);
            if (route.distance === undefined) this.out.set(statement, "next-hop", nextHop);
            else this.out.set(statement, "qualified-next-hop", nextHop, "preference", route.distance);

            if (route.bfd) this.out.bfd(statement, this.device.routing?.bfd);
        }
    }

    /** On every switched port and LAG. RSTP when no mode is given. */
    private spanningTree(): void {
        const stp = this.device.switching?.stp;
        if (!stp) return;

        // The platform has no plain STP, so RSTP is held to it.
        const protocol = `protocols ${stp.mode === "mstp" ? "mstp" : "rstp"}`;
        if (stp.mode === "stp") this.out.set(protocol, "force-version stp");
        if (stp.priority !== undefined) this.out.set(protocol, "bridge-priority", stp.priority === 0 ? "0" : `${stp.priority / 1024}k`);

        const switched: [string, Switched][] = [];

        for (const [port, settings] of Derive.ports(this.device)) {
            if (!settings.in_lag && (settings.access_vlan || settings.trunk_vlans)) switched.push([this.names.port(port), settings]);
        }

        for (const [name, lag] of this.lagSettings()) {
            if (lag.access_vlan || lag.trunk_vlans) switched.push([this.names.physical(name), lag]);
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

    /** A port's own setting wins over the device's, and a LAG runs LLDP on its member ports. The device sends a port's SNMP index as its port ID unless told to send its name: `et-0/0/52` rather than `520`. */
    private lldp(): void {
        const lldp = this.device.switching?.lldp;

        if (Cabling.runsAnywhere(this.device)) this.out.set("protocols lldp port-id-subtype interface-name");

        if (lldp === true) this.out.set("protocols lldp interface all");
        else if (lldp)
            for (const name of lldp.interfaces) for (const port of this.names.members(name)) this.out.set("protocols lldp interface", port);

        for (const [port, settings] of Derive.ports(this.device)) {
            if (settings.lldp === false) this.out.set("protocols lldp interface", this.names.port(port), "disable");
            else if (settings.lldp === true) this.out.set("protocols lldp interface", this.names.port(port));
        }
    }

    /** OSPF for IPv4 and OSPFv3 for IPv6, with the same areas and interfaces. */
    private ospf(): void {
        const ospf = this.device.routing?.ospf;
        if (!ospf) return;

        const protocols = (ospf.address_families ?? ["ipv4"]).map((family) => (family === "ipv4" ? "ospf" : "ospf3"));

        for (const protocol of protocols) {
            for (const [areaId, area] of Object.entries(ospf.areas)) {
                for (const [iface, settings] of Object.entries(area.interfaces)) {
                    if (!settings) continue;

                    const statement = `protocols ${protocol} area ${areaId} interface ${this.names.unit(iface)}`;
                    this.out.set(statement);

                    if (settings.cost !== undefined) this.out.set(statement, "metric", settings.cost);
                    if (settings.passive) this.out.set(statement, "passive");
                    if (settings.network === "point-to-point") this.out.set(statement, "interface-type p2p");
                    if (settings.bfd) this.out.bfd(statement, this.device.routing?.bfd);
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
        for (const [name, relay] of Object.entries(this.device.services?.dhcp_relay ?? {})) {
            const vrf = Derive.settings(this.device, relay.interface)?.vrf;
            const relays = vrf ? `routing-instances ${vrf} forwarding-options dhcp-relay` : "forwarding-options dhcp-relay";

            for (const server of relay.servers) this.out.set(`${relays} server-group ${name}`, server);
            this.out.set(`${relays} group ${name} active-server-group`, name);
            this.out.set(`${relays} group ${name} interface`, this.names.unit(relay.interface));
        }
    }

    /** Every declared port is sampled unless `interfaces` lists some, and a LAG on its member ports. The agent is the management address. */
    private sflow(): void {
        const flow = this.device.monitoring?.flow_export;
        if (flow?.protocol !== "sflow") return;

        if (this.device.connection.host) this.out.set("protocols sflow agent-id", this.device.connection.host);
        if (flow.sampling !== undefined) this.out.set("protocols sflow sample-rate ingress", flow.sampling);

        for (const collector of flow.collectors) {
            this.out.set("protocols sflow collector", collector.address);
            if (collector.port !== undefined && collector.port !== 6343) {
                this.out.set("protocols sflow collector", collector.address, "udp-port", collector.port);
            }
        }

        const declared = Derive.ports(this.device).filter(([, settings]) => !settings.in_lag);
        const observed = flow.interfaces ?? declared.map(([port]) => port);

        for (const name of observed) {
            for (const port of this.names.members(name))
                if (!port.startsWith("em")) this.out.set("protocols sflow interfaces", `${port}.0`);
        }
    }

    /** A switched port takes a filter of the switching family, which matches IPv4 and IPv6 under `ip-version`. A routed port takes one filter per family. Each filter accepts what no rule matched. */
    private acls(): void {
        const switched = new Set<string>();
        const routed = new Set<string>();

        for (const [port, settings] of Derive.ports(this.device)) {
            const acl = settings.ingress_acl;
            if (!acl) continue;

            const physical = this.names.port(port);

            if (settings.access_vlan || settings.trunk_vlans) {
                switched.add(acl);
                this.out.set(`interfaces ${physical} unit 0 family ethernet-switching filter input`, acl);
            } else {
                routed.add(acl);
                this.out.set(`interfaces ${physical} unit 0 family inet filter input`, `${acl}-v4`);
                this.out.set(`interfaces ${physical} unit 0 family inet6 filter input`, `${acl}-v6`);
            }
        }

        for (const acl of switched) this.switchingFilter(acl);

        for (const acl of routed) {
            this.routedFilter(acl, "ipv4");
            this.routedFilter(acl, "ipv6");
        }
    }

    /** A rule's decision, through a policer when it has a rate. */
    private aclThen(term: string, policer: string, rule: AclRule): void {
        if (rule.then === "drop") {
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

        (this.device.switching?.acls?.[acl] ?? []).forEach((rule, index) => {
            const match = rule.if ?? {};
            const addressed = match.src || match.dst || match.protocol || match.src_port !== undefined || match.dst_port !== undefined;
            const family = JunosRender.aclFamily(rule);
            const families = addressed || family ? (family ? [family] : (["ipv4", "ipv6"] as const)) : [undefined];

            for (const each of families) {
                const label = families.length > 1 ? `${index + 1}-${each === "ipv4" ? "v4" : "v6"}` : `${index + 1}`;
                const term = `${filter} term ${JunosRender.ruleName(label, rule.description)}`;

                if (each) {
                    const version = `from ip-version ${each}`;
                    const v4 = each === "ipv4";

                    for (const src of JunosRender.each(match.src))
                        this.out.set(term, version, v4 ? "ip-source-address" : "ip6-source-address", src);
                    for (const dst of JunosRender.each(match.dst))
                        this.out.set(term, version, v4 ? "ip-destination-address" : "ip6-destination-address", dst);
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

        (this.device.switching?.acls?.[acl] ?? []).forEach((rule, index) => {
            const ruleFamily = JunosRender.aclFamily(rule);
            if (ruleFamily && ruleFamily !== family) return;

            const match = rule.if ?? {};
            const label = `${index + 1}`;
            const term = `${filter} term ${JunosRender.ruleName(label, rule.description)}`;
            const protocolWord = family === "ipv4" ? "protocol" : "next-header";

            for (const src of JunosRender.each(match.src)) this.out.set(term, "from source-address", src);
            for (const dst of JunosRender.each(match.dst)) this.out.set(term, "from destination-address", dst);
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

    /** Each server is an address pool, served on its interface. */
    private dhcpServers(): void {
        for (const [name, server] of Object.entries(this.device.services?.dhcp_server ?? {})) {
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
        for (const [name, settings] of this.routed()) {
            if (!settings.ipv6_ra) continue;

            const addresses = (settings.addresses ?? []).map((entry) => (typeof entry === "string" ? entry : entry.address));

            for (const address of addresses.filter((address) => Address.family(address) === "ipv6")) {
                this.out.set(`protocols router-advertisement interface ${this.names.unit(name)} prefix`, Address.prefixOf(address));
            }
        }
    }

    private routed(): [string, Port | Interface][] {
        return [
            ...Derive.ports(this.device),
            ...Derive.interfaces(this.device).map(({ name, settings }): [string, Interface] => [name, settings]),
        ];
    }
}
