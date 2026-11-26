import { Address } from "../../core/address";
import { Cabling } from "../../core/cabling";
import { Secrets } from "../../core/secrets";
import type {
    AclRule,
    Device,
    Ethertype,
    Family,
    Interface,
    Lag,
    Limit,
    Port,
    Ports,
    RadiusServer,
    Routed,
    Severity,
    Vrrp,
} from "../../model";
import { Catalog } from "../../core/catalog";
import { Derive } from "../../core/derive";
import { Utils } from "../../core/utils";
import { JunosBgp } from "./bgp";
import { JunosEvpn } from "./evpn";
import { JunosIsis } from "./isis";
import { JunosMarking } from "./marking";
import { JunosMpls } from "./mpls";
import { JunosNames } from "./names";
import { JunosMonitoring } from "./monitoring";
import { JunosOspf } from "./ospf";
import { JunosPolicyRouting } from "./policy-routing";
import { JunosQos } from "./qos";
import { JunosStatements } from "./statements";
import { JunosSwitching } from "./switching";

type Switched = Port | Lag;

/** The configuration as `set` statements, in the form `show configuration | display set` prints, so the plan compares them one by one. */
export class JunosRender {
    private static readonly USER_CLASS = { admin: "super-user", operator: "operator", "read-only": "read-only" } as const;

    private static readonly ACCOUNTING_EVENT = { login: "login", command: "interactive-commands" } as const;

    /** The statement for each kind of public key, by the key's own prefix. */
    static readonly KEY_STATEMENT: Record<string, string> = {
        "ssh-ed25519": "ssh-ed25519",
        "ssh-rsa": "ssh-rsa",
        "ecdsa-sha2-nistp256": "ssh-ecdsa",
        "ecdsa-sha2-nistp384": "ssh-ecdsa",
        "ecdsa-sha2-nistp521": "ssh-ecdsa",
    };

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

    /** A DHCPv6 server's address pool is named after the server, with this after it. */
    private static readonly ADDRESS_POOL_SUFFIX = "-v6";

    /** A DHCPv6 server's pool of delegated prefixes is named after the server, with this after it. */
    private static readonly DELEGATED_POOL_SUFFIX = "-pd";

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

    private static readonly BGP_PORT = 179;

    /** The TTL a packet from a directly connected neighbor arrives with (RFC 5082). */
    private static readonly GTSM_TTL = 255;

    /** Kinds of frame as `ether-type` names them, in the order the render writes them. */
    private static readonly ETHERTYPES: readonly Ethertype[] = ["ipv4", "ipv6", "arp"];

    /** Kinds of flooded traffic, with the statement that leaves each out of a storm-control profile. */
    private static readonly STORM_KINDS = [
        ["broadcast", "no-broadcast"],
        ["multicast", "no-multicast"],
        ["unknown_unicast", "no-unknown-unicast"],
    ] as const;

    private readonly out = new JunosStatements();
    private readonly names: JunosNames;
    private readonly layer2: JunosSwitching;

    private constructor(private readonly device: Device) {
        this.names = new JunosNames(device);
        this.layer2 = new JunosSwitching(this.out, device, this.names);
    }

    static of(device: Device): string {
        const render = new JunosRender(device);

        render.system();
        render.users();
        render.aaa();
        render.services();
        JunosMonitoring.snmp(render.out, device);
        render.layer2.vlans();
        render.ports();
        render.lags();
        render.routedInterfaces();
        render.stormProfiles();
        render.servicesFilter();
        render.vrfs();
        JunosPolicyRouting.render(render.out, device, render.names);
        render.staticRoutes();
        render.layer2.spanningTree();
        render.layer2.dhcpSnooping();
        render.layer2.raGuard();
        render.lldp();
        JunosOspf.render(render.out, device, render.names);
        JunosIsis.render(render.out, device, render.names);
        JunosMpls.render(render.out, device, render.names);
        JunosEvpn.render(render.out, device);
        render.dhcpRelay();
        render.dhcpServers();
        render.dhcpv6Servers();
        render.routerAdvertisements();
        render.acls();
        render.ethertypeFilters();
        render.boundFilters();
        render.rateLimits();
        JunosQos.render(render.out, device, render.names);
        JunosMarking.render(render.out, device, render.names);
        JunosBgp.render(render.out, device);
        JunosMonitoring.sflow(render.out, device, render.names);
        JunosMonitoring.probes(render.out, device);

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

    /** A policer that drops what passes above a rate. `unsupported()` refuses a rate without a burst, which the platform needs. */
    private policer(name: string, limit: Limit): void {
        const { rate, burst } = Derive.limit(limit);
        this.out.set(`firewall policer ${name} if-exceeding bandwidth-limit`, JunosStatements.amount(Derive.bitsPerSecond(rate)));
        if (burst !== undefined) this.out.set(`firewall policer ${name} if-exceeding burst-size-limit`, JunosStatements.amount(burst));
        this.out.set(`firewall policer ${name} then discard`);
    }

    /** A port's or a LAG's rate limit, named after it: `circuit-rate-limit-xe-0-0-1`. A filter and its policer have one name. */
    private static rateLimitName(physical: string): string {
        return `circuit-rate-limit-${physical.replaceAll("/", "-")}`;
    }

    /** What arrives on a switched port or LAG passes a policer, in a filter of the switching family. What leaves a port is shaped. `unsupported()` refuses the rest. */
    private rateLimits(): void {
        for (const { name, kind, rateLimit } of Derive.rateLimited(this.device)) {
            if (kind === "vlan_interface") continue;
            const physical = this.names.physical(name);

            if (rateLimit.input) {
                const limiter = JunosRender.rateLimitName(physical);
                const term = `firewall family ethernet-switching filter ${limiter} term limit`;
                this.policer(limiter, rateLimit.input);
                this.out.set(term, "then policer", limiter);
                this.out.set(term, "then accept");
                this.out.set(`interfaces ${physical} unit 0 family ethernet-switching filter input`, limiter);
            }
        }
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

        for (const server of system.ntp?.servers ?? []) {
            this.out.set("system ntp server", server);
            if (system.ntp?.vrf) this.out.set("system ntp server", server, "routing-instance", system.ntp.vrf);
        }

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
            if (remote.vrf) this.out.set("system syslog host", remote.address, "routing-instance", remote.vrf);
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

    /** The device's own users log in first, then the servers. A user a server accepts takes the class of the template user `remote`. */
    private aaa(): void {
        const aaa = this.device.system?.aaa;
        const servers: readonly RadiusServer[] | undefined = aaa?.tacacs ?? aaa?.radius;
        if (!aaa || !servers) return;

        const method = aaa.tacacs ? "tacplus" : "radius";
        this.out.set("system authentication-order password");
        this.out.set("system authentication-order", method);

        for (const server of servers) {
            const statement = `system ${method}-server ${server.address}`;
            if (server.auth_port !== undefined) this.out.set(statement, "port", server.auth_port);
            if (server.acct_port !== undefined) this.out.set(statement, "accounting-port", server.acct_port);
            this.out.set(statement, "secret", Secrets.marker(server.secret_key));
            if (server.source_address) this.out.set(statement, "source-address", server.source_address);
            if (server.vrf) this.out.set(statement, "routing-instance", server.vrf);
        }

        this.out.set("system login user remote class", JunosRender.USER_CLASS[aaa.remote_role]);

        const events = aaa.accounting_events ?? [];
        if (!events.length) return;

        for (const event of events) this.out.set("system accounting events", JunosRender.ACCOUNTING_EVENT[event]);
        this.out.set("system accounting destination", method);
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
            // Only the REST API takes a routing instance (TRAPS.md).
            if (service === "api" && management.api?.vrf) this.out.set("system services rest routing-instance", management.api.vrf);
        }
    }

    /** A service's settings, by the name of its term in the services filter: SNMP is `monitoring.snmp`, NETCONF `management.native_protocol`. */
    private serviceSettings(service: keyof typeof JunosRender.SERVICE_PORTS): { allow?: readonly string[]; port?: number } | undefined {
        if (service === "snmp") return this.device.monitoring?.snmp;
        if (service === "native") return this.device.management?.native_protocol;

        return this.device.management?.[service];
    }

    /** The native VLAN is a member too, or its untagged frames are dropped. QinQ VLANs take units of their own, and the trunk's other VLANs share unit 0. */
    private switching(physical: string, settings: Switched): void {
        const family = `interfaces ${physical} unit 0 family ethernet-switching`;
        const trunkVlans = this.layer2.qinq(physical, settings);

        if (settings.access_vlan) {
            this.out.set(family, "interface-mode access");
            this.out.set(family, "vlan members", settings.access_vlan);
        }

        // A trunk of QinQ VLANs only has no unit 0.
        const onlyQinq = settings.trunk_vlans?.length && !trunkVlans.length && !settings.native_vlan;
        if (settings.trunk_vlans && !onlyQinq) {
            this.out.set(family, "interface-mode trunk");

            const members = new Set([...trunkVlans, ...(settings.native_vlan ? [settings.native_vlan] : [])]);
            for (const vlan of members) this.out.set(family, "vlan members", vlan);
            // The translated VLAN stays a member, and the switch tags it the other way on the way out.
            for (const { from, to } of settings.vlan_translation ?? [])
                this.out.set(family, "vlan-rewrite translate", from, this.device.switching!.vlans![to]!.id);

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
                const sources = Derive.boundSources(host);

                this.out.set(`${term}-ipv4 from source-mac-address`, mac);
                for (const address of sources.ipv4) this.out.set(`${term}-ipv4 from ip-source-address`, address);
                this.out.set(`${term}-ipv4 then accept`);

                this.out.set(`${term}-ipv6 from source-mac-address`, mac);
                for (const address of sources.ipv6) this.out.set(`${term}-ipv6 from ip-version ipv6 ip6-source-address`, address);
                this.out.set(`${term}-ipv6 then accept`);

                this.out.set(`${term}-arp from source-mac-address`, mac);
                this.out.set(`${term}-arp from ether-type arp`);
                this.out.set(`${term}-arp then accept`);
            });

            this.out.set(`${filter} term others then discard`);
        }
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
        const gtsm = JunosBgp.gtsmNeighbors(this.device);
        if (!guarded.length && !keepsTimeQuietly && !gtsm.length) return;

        const families = [
            ["inet", "ipv4", "protocol"],
            ["inet6", "ipv6", "next-header"],
        ] as const;

        for (const [family, addressFamily, protocolWord] of families) {
            const filter = `firewall family ${family} filter ${JunosRender.SERVICES_FILTER[family]}`;
            const ofFamily = (prefix: string) => Address.family(Address.host(prefix)) === addressFamily;

            // GTSM (RFC 5082): BGP from a neighbor with it is dropped unless it arrives with TTL 255, or hop limit 255.
            const peers = gtsm.filter(ofFamily);
            if (peers.length) {
                const term = `${filter} term gtsm`;
                for (const peer of peers) this.out.set(term, "from source-address", Address.withLength(peer));
                this.out.set(term, "from", protocolWord, "tcp");
                this.out.set(term, "from port", JunosRender.BGP_PORT);
                this.out.set(term, "from", family === "inet" ? "ttl-except" : "hop-limit-except", JunosRender.GTSM_TTL);
                this.out.set(term, "then discard");
            }

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

    /** A route with a distance names its next hop as qualified, so two routes to one prefix can each have their own. A next hop with its interface is qualified too, as only a qualified one takes an interface. */
    private staticRoutes(): void {
        if (this.device.routing?.router_id) this.out.set("routing-options router-id", this.device.routing.router_id);

        for (const route of this.device.routing?.static_routes ?? []) {
            const table = route.vrf ?? Utils.otherTable(route.routing_table);
            const statement = `${JunosBgp.options(Address.family(Address.split(route.prefix).addr), table)} static route ${route.prefix}`;

            if (route.blackhole) {
                this.out.set(statement, "discard");
                if (route.distance !== undefined) this.out.set(statement, "preference", route.distance);
                continue;
            }

            const nextHop = route.next_hop ? Address.host(route.next_hop) : this.names.unit(route.interface!);
            const qualified = route.distance !== undefined || (route.next_hop && route.interface);
            if (!qualified) this.out.set(statement, "next-hop", nextHop);
            if (route.distance !== undefined) this.out.set(statement, "qualified-next-hop", nextHop, "preference", route.distance);
            if (route.next_hop && route.interface)
                this.out.set(statement, "qualified-next-hop", nextHop, "interface", this.names.unit(route.interface));

            if (route.bfd) this.out.bfd(statement, this.device.routing?.bfd);
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

    /** Each relay is a group of servers and the interface it listens on, in the table that interface routes in. */
    private dhcpRelay(): void {
        for (const [name, relay] of Object.entries(this.device.services?.dhcp_relay ?? {})) {
            const vrf = Derive.settings(this.device, relay.interface)?.vrf;
            const relays = vrf ? `routing-instances ${vrf} forwarding-options dhcp-relay` : "forwarding-options dhcp-relay";

            for (const server of relay.servers) this.out.set(`${relays} server-group ${name}`, server);
            this.out.set(`${relays} group ${name} active-server-group`, name);
            this.out.set(`${relays} group ${name} interface`, this.names.unit(relay.interface));
            // Juniper's reference wants circuit-id or remote-id written: the circuit ID alone is the port and its VLAN.
            if (relay.relay_agent_information) this.out.set(`${relays} group ${name} relay-option-82`, "circuit-id");
        }
    }

    /** Every declared port is sampled unless `interfaces` lists some, and a LAG on its member ports. The agent is the management address. */

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
            this.policer(policer, rule.rate);
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

    /** Each server is an address pool. The servers of one interface share a group, named after the first: a second group on it fails `commit check`. The switch picks the pool whose network holds a relay's address, or else the interface's. */
    private dhcpServers(): void {
        const grouped = new Set<string>();

        for (const [name, server] of Object.entries(this.device.services?.dhcp_server ?? {})) {
            const instance = JunosBgp.instance(Derive.settings(this.device, server.interface)?.vrf);
            const unit = this.names.unit(server.interface);
            if (!grouped.has(unit)) this.out.set(`${instance}system services dhcp-local-server group ${name} interface`, unit);
            grouped.add(unit);

            const pool = `${instance}access address-assignment pool ${name} family inet`;
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

    /**
     * Each server is a group on its interface. Its addresses and delegated prefixes are address pools of their own, `<server>-v6` and `<server>-pd`: a pool holds one family, and an IPv4 server may have the server's name. The device finds the address pool by the interface's network, and is told the delegated one. A host that asks only for DNS servers gets them from the first pool.
     */
    private dhcpv6Servers(): void {
        for (const [name, server] of Object.entries(this.device.services?.dhcpv6_server ?? {})) {
            const instance = JunosBgp.instance(Derive.settings(this.device, server.interface)?.vrf);
            const group = `${instance}system services dhcp-local-server dhcpv6 group ${name}`;
            this.out.set(group, "interface", this.names.unit(server.interface));

            const pools: string[] = [];
            const attributes = (at: string) => {
                for (const resolver of server.dns ?? []) this.out.set(at, "dhcp-attributes dns-server", resolver);
                if (server.lease_time !== undefined) this.out.set(at, "dhcp-attributes maximum-lease-time", server.lease_time);
            };

            const network = Derive.dhcpv6Network(this.device, server);
            if (server.pool && network) {
                const pool = `${name}${JunosRender.ADDRESS_POOL_SUFFIX}`;
                const at = `${instance}access address-assignment pool ${pool} family inet6`;
                const [low, high] = server.pool;
                this.out.set(at, "prefix", network);
                this.out.set(at, `range ${name} low`, `${low}/${Address.bits("ipv6")}`);
                this.out.set(at, `range ${name} high`, `${high}/${Address.bits("ipv6")}`);
                attributes(at);
                pools.push(pool);
            }

            const delegation = server.prefix_delegation;
            if (delegation) {
                const pool = `${name}${JunosRender.DELEGATED_POOL_SUFFIX}`;
                const at = `${instance}access address-assignment pool ${pool} family inet6`;
                this.out.set(at, "prefix", delegation.pool);
                this.out.set(at, `range ${pool} prefix-length`, delegation.prefix_length);
                attributes(at);
                this.out.set(group, "overrides delegated-pool", pool);
                pools.push(pool);
            }

            if (server.dns?.length && pools[0]) this.out.set(group, "overrides process-inform pool", pools[0]);
        }
    }

    /** Router advertisements announce their prefixes, each IPv6 network of the interface unless the config lists them. The least interval is the platform's own, a third of the most, as RFC 4861 has it. */
    private routerAdvertisements(): void {
        for (const [name, settings] of this.routed()) {
            const ra = Derive.routerAdvertisement(settings);
            if (!ra) continue;

            const at = `protocols router-advertisement interface ${this.names.unit(name)}`;
            if (ra.interval !== undefined) this.out.set(at, "max-advertisement-interval", ra.interval);
            if (ra.lifetime !== undefined) this.out.set(at, "default-lifetime", ra.lifetime);
            if (ra.managed) this.out.set(at, "managed-configuration");
            if (ra.other_config) this.out.set(at, "other-stateful-configuration");

            for (const advertised of Derive.advertisedPrefixes(settings)) {
                const prefix = `${at} prefix ${Address.prefixOf(advertised.prefix)}`;
                const options = [
                    advertised.disable_autoconfiguration && "no-autonomous",
                    advertised.valid_lifetime !== undefined && `valid-lifetime ${advertised.valid_lifetime}`,
                    advertised.preferred_lifetime !== undefined && `preferred-lifetime ${advertised.preferred_lifetime}`,
                ].filter((option) => typeof option === "string");

                // The device prints a prefix alone only when it has no option.
                if (!options.length) this.out.set(prefix);
                for (const option of options) this.out.set(prefix, option);
            }

            for (const server of ra.dns_servers ?? []) this.out.set(at, "dns-server-address", server);
            for (const domain of ra.dns_search_list ?? []) this.out.set(at, "dns-search-list", domain);
        }
    }

    private routed(): [string, Port | Interface][] {
        return [
            ...Derive.ports(this.device),
            ...Derive.interfaces(this.device).map(({ name, settings }): [string, Interface] => [name, settings]),
        ];
    }
}
