import { Address } from "../../core/address";
import type { AclRule, Device, FilterRule, Gre, Lag, RadiusServer, VlanInterface, Vxlan } from "../../model";
import { Catalog } from "../../core/catalog";
import { Derive } from "../../core/derive";
import { Secrets } from "../../core/secrets";
import { FortiOsFirewall } from "./firewall";
import { FortiOsNames } from "./names";
import { FortiOsMonitoring } from "./monitoring";
import { FortiOsRender } from "./render";
import { FortiOsRouting } from "./routing";
import { FortiOsVdoms } from "./vdoms";

/** The fields of a match that may hold a list or an interface set before Circuit writes them out. */
type ListedMatch = {
    src?: unknown;
    dst?: unknown;
    in_interface?: unknown;
    out_interface?: unknown;
    in_interface_set?: string;
    out_interface_set?: string;
};

export class FortiOsUnsupported {
    /** The longest name the platform takes for an interface, and for an address or service. */
    private static readonly NAME_LENGTH = { interface: 15, object: 79 } as const;

    /** Names the platform keeps for interfaces of its own. */
    private static readonly RESERVED_INTERFACES = new Set(["any", "modem", "ssl.root"]);

    static of(device: Device): string[] {
        const found: string[] = [];

        found.push(...FortiOsUnsupported.systemGaps(device));
        found.push(...FortiOsUnsupported.managementGaps(device));
        found.push(...FortiOsUnsupported.interfaceGaps(device));
        found.push(...FortiOsRender.sourceCheck(device).gaps);
        found.push(...FortiOsUnsupported.staticGaps(device));
        found.push(...FortiOsRouting.gaps(device));
        found.push(...FortiOsUnsupported.firewallGaps(device));
        found.push(...FortiOsUnsupported.serviceGaps(device));

        for (const field of ["stp", "dhcp_snooping", "arp_inspection", "ra_guard"] as const)
            if (device.switching?.[field]) found.push(`switching.${field}, ports are routed`);
        found.push(...FortiOsUnsupported.transparentGaps(device));
        found.push(...FortiOsVdoms.gaps(device));

        for (const [name, iface] of Object.entries(device.interfaces?.vlan_interface ?? {})) {
            if (iface?.mac) found.push(`interfaces.vlan_interface.${name}.mac, which only RouterOS sets for now`);
        }
        const vrfs = device.routing?.vrfs ?? {};
        if (Object.keys(vrfs).length > FortiOsRender.VRFS) found.push(`routing.vrfs, at most ${FortiOsRender.VRFS}`);

        for (const [name, vrf] of Object.entries(vrfs)) {
            if (vrf?.description) found.push(`routing.vrfs.${name}.description, the platform numbers a VRF and keeps no description`);
        }

        // Tested on a FG-3700D on FortiOS 6.2.2, in NAT mode, with the management VDOM and BFD on a route in a VRF. FortiOsRouting.gaps refuses BFD on a multihop BGP session.
        found.push(...Derive.untested(device, ["bfd-timers", "static-route-bfd", "multihop-bfd", "management-vdom"]));
        found.push(...Derive.unbuilt(device, ["proxy-arp", "urpf"]));

        return found;
    }

    /**
     * Transparent mode leaves out every address but one IPv4 management address outside the bridges, routing beyond static routes for it, NAT, and DHCP. Without a management address the device answers no service.
     */
    private static transparentGaps(device: Device): string[] {
        if (!FortiOsNames.isTransparent(device)) return [];

        const found: string[] = [];
        const where = "in transparent mode, which a bridge needs";
        const management = FortiOsNames.transparentManagement(device);

        if (device.connection.host && device.connection.host !== (management && Address.host(management.address)))
            found.push(`connection.host, ${where}: only the management address, one IPv4 address outside the bridges`);

        const holders = [
            ...Derive.ports(device).map(([name, port]) => [`interfaces.ethernet.${name}`, name, port.addresses] as const),
            ...FortiOsNames.interfacesOf(device).map(
                ({ name, kind, settings }) => [`interfaces.${kind}.${name}`, name, settings.addresses] as const
            ),
        ];

        for (const [path, name, addresses] of holders) {
            const extra = (addresses ?? []).filter(
                (entry) => !(typeof entry === "string" && management && name === management.name && entry === management.address)
            );
            if (extra.length) found.push(`${path}.addresses, ${where}: one IPv4 address in all, outside the bridges, for management`);
        }

        const routing = device.routing;
        if (routing?.bgp || routing?.ospf) found.push(`routing, ${where}: static routes only`);
        if (routing?.bfd) found.push(`routing.bfd, ${where}: BFD is tested in NAT mode only`);

        for (const [index, route] of (routing?.static_routes ?? []).entries()) {
            const at = `routing.static_routes[${index}]`;
            if (!management) found.push(`${at}, ${where}: a route needs the management address`);
            if (!route.next_hop || Address.family(route.next_hop) !== "ipv4" || route.interface || route.blackhole || route.vrf)
                found.push(`${at}, ${where}: only an IPv4 next hop, for the management address`);
            if (route.bfd) found.push(`${at}.bfd, ${where}: BFD is tested in NAT mode only`);
        }

        if (device.firewall?.nat) found.push(`firewall.nat, ${where}`);
        for (const group of ["dhcp_server", "dhcpv6_server"] as const)
            if (Object.keys(device.services?.[group] ?? {}).length) found.push(`services.${group}, ${where}`);

        if (!management) {
            const services = device.management ?? {};
            for (const service of ["ssh", "telnet", "http", "https", "api", "api_tls"] as const) {
                if (services[service]) found.push(`management.${service}, ${where}: the device has no management address to answer on`);
            }
            if (device.monitoring?.snmp) found.push(`monitoring.snmp, ${where}: the device has no management address to answer on`);
            if (services.native_protocol)
                found.push(`management.native_protocol, ${where}: the device has no management address to answer on`);
        }

        return found;
    }

    private static systemGaps(device: Device): string[] {
        const found: string[] = [];
        const system = device.system ?? {};

        if (system.timezone && !FortiOsRender.zoneOf(system.timezone))
            found.push(`system.timezone ${system.timezone}, the platform has no zone for it`);
        if (system.release_channel) found.push("system.release_channel, the platform's firmware has no release channel to follow");
        if (device.monitoring?.transceivers !== undefined)
            found.push("monitoring.transceivers, the platform reads optics without being told");
        if (system.ip_stack?.syn_cookies)
            found.push("system.ip_stack.syn_cookies, the platform has a SYN proxy per DoS policy, not SYN cookies");

        const local = system.logging?.local;
        if (local?.files !== undefined || local?.lines_per_file !== undefined) {
            found.push("system.logging.local.files and lines_per_file, logs kept in memory do not rotate into files");
        }

        if ((device.monitoring?.syslog?.length ?? 0) > FortiOsMonitoring.COLLECTORS)
            found.push(`monitoring.syslog, at most ${FortiOsMonitoring.COLLECTORS} collectors`);

        const servers = system.dns?.servers ?? [];
        for (const family of ["ipv4", "ipv6"] as const) {
            if (servers.filter((server) => Address.family(server) === family).length > FortiOsRender.RESOLVERS.device) {
                found.push(`system.dns.servers, at most ${FortiOsRender.RESOLVERS.device} of each family`);
            }
        }

        return found;
    }

    private static managementGaps(device: Device): string[] {
        const found: string[] = [];
        const management = device.management ?? {};

        if (management.api || management.api_tls) found.push("management.api and api_tls, the API is served by management.https");
        if (management.ftp) found.push("management.ftp, the platform has no FTP service");
        if (management.console) found.push("management.console, the console logs in with the device's users");
        if (management.privilege_password) found.push("management.privilege_password, the platform has no privileged mode");
        if (management.native_protocol?.interfaces?.length)
            found.push("management.native_protocol.interfaces, FortiManager access runs over IP only");
        if (management.native_protocol?.port) found.push("management.native_protocol.port, FortiManager access listens on 541");
        if (management.ssh?.auth_retries)
            found.push("management.ssh.auth_retries, the platform counts failed logins per source, not per connection");

        for (const [name, user] of Object.entries(device.monitoring?.snmp?.users ?? {})) {
            if (user.auth === "sha256")
                found.push(`monitoring.snmp.users.${name}.auth sha256, the platform authenticates with SHA1 or MD5`);
        }

        // A community and a user each send their traps to one port.
        const ports = new Map<string, number | undefined>();
        (device.monitoring?.snmp?.traps ?? []).forEach((target, index) => {
            const sender = target.user ?? (target.community && Secrets.referenceOf(target.community));
            if (!sender) return;

            if (ports.has(sender) && ports.get(sender) !== target.port)
                found.push(
                    `monitoring.snmp.traps[${index}].port, unlike another receiver of its community or user: each has one trap port`
                );
            ports.set(sender, target.port);
        });

        for (const [name, user] of Object.entries(device.system?.users ?? {})) {
            if ((user?.ssh_keys?.length ?? 0) > FortiOsRender.SSH_KEYS)
                found.push(`system.users.${name}.ssh_keys, at most ${FortiOsRender.SSH_KEYS}`);
        }

        found.push(...FortiOsUnsupported.aaaGaps(device));
        return found;
    }

    /** The servers share one entry: at most three, with one source address and one login port. FortiOS 6.2 sends no accounting for administrators. */
    private static aaaGaps(device: Device): string[] {
        const found: string[] = [];
        const aaa = device.system?.aaa;
        if (!aaa) return found;

        const remote = FortiOsRender.AAA.remote;
        if (device.system?.users?.[remote])
            found.push(`system.users.${remote}, with system.aaa the platform keeps the name for the users a server accepts`);

        const noAccounting = "FortiOS 6.2 sends no accounting for administrators";
        if (aaa.accounting_events) found.push(`system.aaa.accounting_events, ${noAccounting}`);

        const kind = aaa.tacacs ? "tacacs" : "radius";
        const servers: readonly RadiusServer[] = aaa.tacacs ?? aaa.radius ?? [];
        if (servers.length > FortiOsRender.AAA_SERVERS)
            found.push(
                `system.aaa.${kind}, more than ${FortiOsRender.AAA_SERVERS} servers: the platform asks at most ${FortiOsRender.AAA_SERVERS}`
            );

        const differ = (field: "source_address" | "auth_port") => new Set(servers.map((server) => server[field])).size > 1;
        if (differ("source_address"))
            found.push(`system.aaa.${kind} source_address, the platform sends to every server from one address: write the same on each`);
        if (differ("auth_port"))
            found.push(`system.aaa.${kind} auth_port, the platform sends to every server on one port: write the same on each`);

        servers.forEach((server, index) => {
            if (server.acct_port !== undefined) found.push(`system.aaa.${kind}[${index}].acct_port, ${noAccounting}`);
        });

        return found;
    }

    private static portNames(device: Device): Set<string> {
        return new Set(Catalog.ports(device.platform, device.model).map((port) => Catalog.spell(device.platform, device.model, port)));
    }

    private static interfaceGaps(device: Device): string[] {
        const found: string[] = [];
        const vlanInterfaces = new Set(
            Object.values(device.interfaces?.vlan_interface ?? {}).flatMap((iface) => (iface ? [iface.vlan] : []))
        );

        // A VLAN's description is dropped, as `switching.vlans` says: the platform knows a VLAN by its number, and a VLAN interface holds a description of its own.

        for (const [name, port] of Derive.ports(device)) {
            const where = `interfaces.ethernet.${name}`;
            const speedClass = name.split("-")[0]!;
            if (port.speed && !FortiOsRender.SPEEDS[speedClass]?.[port.speed])
                found.push(`${where}.speed ${port.speed}, not in a ${speedClass} cage`);

            for (const field of ["access_vlan", "native_vlan", "stp", "storm_control", "dhcp_trusted", "ra_trusted"] as const) {
                if (port[field] !== undefined) found.push(`${where}.${field}, ports are routed`);
            }

            if (port.hardware_offload !== undefined)
                found.push(`${where}.hardware_offload, offload is decided per policy, which can match many interfaces`);

            if (port.in_lag) {
                for (const field of ["addresses", "mtu", "vrrp", "vrf", "lldp", "trunk_vlans", "ipv6_ra", "ingress_acl"] as const) {
                    if (port[field] !== undefined) found.push(`${where}.${field}, a LAG member takes its settings from the LAG`);
                }
            }

            const acl = port.ingress_acl ? device.switching?.acls?.[port.ingress_acl] : undefined;
            if (acl) found.push(...FortiOsUnsupported.aclGaps(`switching.acls.${port.ingress_acl}`, acl));

            found.push(...FortiOsUnsupported.trunkGaps(where, name, port.trunk_vlans, vlanInterfaces, device));
            found.push(...FortiOsUnsupported.routedGaps(where, port, false));
        }

        const ports = FortiOsUnsupported.portNames(device);

        for (const { name, kind, settings: iface } of FortiOsNames.interfacesOf(device)) {
            const where = `interfaces.${kind}.${name}`;

            if (kind === "wireguard") {
                found.push(`${where}, a wireguard: the platform has no WireGuard`);
                continue;
            }

            if (name.length > FortiOsUnsupported.NAME_LENGTH.interface)
                found.push(`${where}, a name longer than ${FortiOsUnsupported.NAME_LENGTH.interface} characters`);
            if (ports.has(name) || FortiOsUnsupported.RESERVED_INTERFACES.has(name))
                found.push(`${where}, a name the platform gives a port of its own`);
            if (iface.hardware_offload !== undefined)
                found.push(`${where}.hardware_offload, offload is decided per policy, which can match many interfaces`);

            if (kind === "lag") {
                const lag = iface as Lag;
                if (lag.id !== undefined) found.push(`${where}.id, the platform names a LAG by its key`);
                for (const field of ["access_vlan", "native_vlan", "stp", "storm_control", "dhcp_trusted", "ra_trusted"] as const) {
                    if (lag[field] !== undefined) found.push(`${where}.${field}, LAGs are routed`);
                }

                found.push(...FortiOsUnsupported.trunkGaps(where, name, lag.trunk_vlans, vlanInterfaces, device));
            }

            if (kind === "vlan_interface") {
                const vlan = (iface as VlanInterface).vlan;
                if (!FortiOsRender.vlanParent(device, vlan))
                    found.push(`${where}, VLAN ${vlan} must be carried tagged by exactly one port or LAG`);
            }

            if (kind === "loopback") {
                if (iface.mtu !== undefined) found.push(`${where}.mtu, a loopback has no MTU of its own`);
                if (iface.vrrp?.length) found.push(`${where}.vrrp, a loopback runs no VRRP`);
            }

            if (kind === "gre" || kind === "vxlan") {
                const tunnel = iface as Gre | Vxlan;
                if (!FortiOsNames.holderOf(device, tunnel.local_address))
                    found.push(`${where}.local_address, no interface holds ${tunnel.local_address}`);
                if (Address.family(tunnel.local_address) !== Address.family(tunnel.remote_address))
                    found.push(`${where}, endpoints of two families`);
                if (tunnel.vrrp?.length) found.push(`${where}.vrrp, on a tunnel`);
                if (tunnel.ipv6_ra) found.push(`${where}.ipv6_ra, on a tunnel`);
            }

            if (kind === "gre") {
                for (const entry of iface.addresses ?? []) {
                    if (typeof entry !== "string" && Address.family(Address.host(entry.address)) === "ipv6")
                        found.push(`${where}.addresses, a peer on an IPv6 address`);
                }

                const ipv4 = (iface.addresses ?? []).filter(
                    (entry) => Address.family(Address.host(typeof entry === "string" ? entry : entry.address)) === "ipv4"
                );
                if (ipv4.some((entry) => typeof entry === "string"))
                    found.push(`${where}.addresses, an IPv4 address on a tunnel takes its peer`);
                if (ipv4.length > 1) found.push(`${where}.addresses, one IPv4 address`);
            }

            found.push(...FortiOsUnsupported.routedGaps(where, iface, kind === "gre"));
        }

        // LLDP runs on ports and aggregates; a VLAN interface has no LLDP settings.
        const lldp = device.switching?.lldp;
        if (lldp && typeof lldp === "object") {
            for (const name of lldp.interfaces) {
                const kind = FortiOsNames.interfacesOf(device).find((entry) => entry.name === name)?.kind;
                if (kind && kind !== "lag") found.push(`switching.lldp.interfaces ${name}, a ${kind}`);
            }
        }

        return found;
    }

    /** A port or LAG carries tagged only VLANs that have an interface here, and is the only one carrying each. */
    private static trunkGaps(
        where: string,
        name: string,
        vlans: readonly string[] | undefined,
        withInterface: Set<string>,
        device: Device
    ): string[] {
        const found: string[] = [];

        for (const vlan of vlans ?? []) {
            if (!withInterface.has(vlan)) {
                found.push(`${where}.trunk_vlans ${vlan}, a VLAN with no interface here: the platform routes and does not switch`);
            } else if (FortiOsRender.vlanParent(device, vlan) !== name) {
                found.push(`${where}.trunk_vlans ${vlan}, which another port or LAG also carries`);
            }
        }

        return found;
    }

    /** Layer 3 settings the platform cannot express on a port or an interface. Only a tunnel takes an address with a peer. */
    private static routedGaps(
        where: string,
        settings: {
            addresses?: readonly (string | { address: string; peer_address: string })[];
            vrrp?: readonly { id: number; address: string }[];
        },
        tunnel: boolean
    ): string[] {
        const found: string[] = [];

        if (!tunnel && settings.addresses?.some((entry) => typeof entry !== "string"))
            found.push(`${where}.addresses with a peer, which only a tunnel takes`);

        for (const group of settings.vrrp ?? []) {
            if (Address.family(group.address) === "ipv6") found.push(`${where}.vrrp ${group.id}, IPv6: the platform runs VRRP for IPv4`);
        }

        return found;
    }

    /** An ACL as the platform's, which only drop: every drop comes before any accept, and no rule limits a rate or matches a VLAN. */
    private static aclGaps(where: string, rules: readonly AclRule[]): string[] {
        const found: string[] = [];

        if (FortiOsFirewall.acceptsBeforeDrop(rules)) found.push(`${where}, an accept before a drop: the platform's ACLs only drop`);

        rules.forEach((rule, index) => {
            if (rule.rate) found.push(`${where}[${index}].rate`);
            if (rule.if?.vlan) found.push(`${where}[${index}].if.vlan, a port's ACL sees no VLAN`);
            found.push(...FortiOsUnsupported.listGaps(`${where}[${index}]`, rule.if));
        });

        return found;
    }

    /** Lists in a rule's match where the platform takes one value, and interface sets: Circuit writes them out as one rule per value before the platform reads them. */
    private static listGaps(where: string, match: ListedMatch | undefined): string[] {
        const found: string[] = [];

        for (const field of ["src", "dst", "in_interface", "out_interface"] as const) {
            const value = match?.[field];
            if (Array.isArray(value) && value.length > 1) found.push(`${where}.if.${field}, a list: the platform takes one value here`);
        }
        for (const field of ["in_interface_set", "out_interface_set"] as const) {
            if (match?.[field] !== undefined) found.push(`${where}.if.${field}, which Circuit writes out as its interfaces`);
        }

        return found;
    }

    private static staticGaps(device: Device): string[] {
        const found: string[] = [];
        const seen = new Set<string>();

        for (const route of device.routing?.static_routes ?? []) {
            const where = `routing.static_routes ${route.prefix}`;

            if (route.vrf && route.blackhole)
                found.push(`${where}, a blackhole in a VRF: a route takes the VRF of the interface it leaves through`);
            if (route.vrf && route.interface && FortiOsNames.settingsOf(device, route.interface)?.vrf !== route.vrf) {
                found.push(`${where}.interface, which is not in VRF ${route.vrf}`);
            }

            if (route.next_hop && !route.interface && !route.blackhole && !FortiOsNames.interfaceFor(device, route.next_hop, route.vrf)) {
                found.push(`${where} next_hop ${route.next_hop}, no interface's own network in its table holds the next hop`);
            }

            // The device refuses a second route identical to one it has: `Duplicated entry`.
            const key = [
                Address.split(route.prefix).addr,
                Address.split(route.prefix).len,
                route.next_hop,
                route.interface,
                route.blackhole,
                route.distance,
                route.vrf,
            ].join(" ");
            if (seen.has(key)) found.push(`${where}, the same route twice`);
            seen.add(key);
        }

        return found;
    }

    private static firewallGaps(device: Device): string[] {
        const found: string[] = [];
        const fw = device.firewall;
        if (!fw) return found;

        if (fw.filter?.output) found.push("firewall.filter.output, the platform filters no traffic it sends itself");
        if (fw.untracked) found.push("firewall.untracked, every session is tracked");
        if (fw.interface_sets) found.push("firewall.interface_sets, which Circuit writes out as each rule's interfaces");

        for (const helper of fw.conntrack_helpers ?? []) {
            if (!FortiOsRender.HELPERS[helper]) found.push(`firewall.conntrack_helpers ${helper}, the platform has no helper for it`);
        }

        for (const chain of ["forward", "input"] as const) {
            (fw.filter?.[chain]?.rules ?? []).forEach((rule, index) =>
                found.push(...FortiOsUnsupported.ruleGaps(`firewall.filter.${chain}.rules[${index}]`, rule, chain, device))
            );
        }

        (fw.nat?.source ?? []).forEach((rule, index) => {
            const where = `firewall.nat.source[${index}]`;
            const match = rule.if;
            found.push(...FortiOsUnsupported.listGaps(where, match));

            if (FortiOsFirewall.familiesOf(device, match).includes("ipv6") && (match?.family === "ipv6" || match?.src || match?.dst)) {
                found.push(`${where}, IPv6: central NAT translates IPv4`);
            }

            if (rule.then === "dnat") found.push(`${where}.then dnat, in source NAT`);
            if (rule.then === "snat" && Address.family(rule.to_address) === "ipv6")
                found.push(`${where}.to_address, IPv6: central NAT translates IPv4`);
            if (match?.dst_port !== undefined) found.push(`${where}.if.dst_port, central NAT matches the source port only`);
            if (Array.isArray(match?.src_port)) found.push(`${where}.if.src_port, one port or range`);
            if (rule.then === "snat" && rule.to_port !== undefined && match?.src_port === undefined)
                found.push(`${where}.to_port, without if.src_port`);
            if ((match?.src && match.src_address_set) || (match?.dst && match.dst_address_set))
                found.push(`${where}.if, a prefix and a set on one side`);
            if (match?.connection_state || match?.tcp_flags) found.push(`${where}.if.connection_state and tcp_flags`);
        });

        (fw.nat?.destination ?? []).forEach((rule, index) => {
            const where = `firewall.nat.destination[${index}]`;
            const match = rule.if;
            found.push(...FortiOsUnsupported.listGaps(where, match));

            if (rule.then !== "dnat") {
                found.push(`${where}.then ${rule.then}, in destination NAT`);
                return;
            }

            const dst = FortiOsNames.single(match?.dst);
            if (!dst || Address.split(dst.includes("/") ? dst : `${dst}/32`).len !== 32) {
                found.push(`${where}.if.dst, one IPv4 address the virtual IP answers on`);
            }

            const src = FortiOsNames.single(match?.src);
            const sources = src ? [src] : match?.src_address_set ? (fw.address_sets?.[match.src_address_set] ?? []) : [];
            if (Address.family(rule.to_address) === "ipv6" || sources.some((source) => Address.family(Address.host(source)) === "ipv6"))
                found.push(`${where}, IPv6`);
            if (match?.dst_port !== undefined && Array.isArray(match.dst_port)) found.push(`${where}.if.dst_port, one port or range`);
            if (match?.dst_port !== undefined && match.protocol !== "tcp" && match.protocol !== "udp") {
                found.push(`${where}.if.protocol, tcp or udp with a port`);
            }

            if (match?.dst_port === undefined && (match?.protocol || rule.to_port)) {
                found.push(`${where}.if.dst_port, a protocol or port is forwarded by its port`);
            }

            if (match?.src && match.src_address_set) found.push(`${where}.if, a prefix and a set on one side`);

            for (const field of ["dst_address_set", "src_port", "out_interface", "connection_state", "tcp_flags", "family"] as const) {
                if (match?.[field] !== undefined) found.push(`${where}.if.${field}`);
            }
        });

        for (const name of Object.keys(fw.address_sets ?? {})) {
            if (name.length > FortiOsUnsupported.NAME_LENGTH.object)
                found.push(`firewall.address_sets.${name}, a name longer than ${FortiOsUnsupported.NAME_LENGTH.object} characters`);
            if (name.startsWith("circuit-"))
                found.push(`firewall.address_sets.${name}, a name Circuit keeps for the sources of management`);
        }

        return found;
    }

    private static ruleGaps(where: string, rule: FilterRule, chain: "forward" | "input", device: Device): string[] {
        const found: string[] = [];
        const match = rule.if;
        const state = match?.connection_state ?? [];

        // The platform is stateful: replies pass on their own, and a rule matches a session's first packet.
        if (state.some((one) => one === "invalid" || one === "untracked")) found.push(`${where}.if.connection_state ${state.join(", ")}`);
        else if (state.length && rule.then !== "accept") found.push(`${where}.if.connection_state, on a rule that does not accept`);

        if (match?.tcp_flags) found.push(`${where}.if.tcp_flags, the platform matches no TCP flags`);
        if ((match?.src && match.src_address_set) || (match?.dst && match.dst_address_set))
            found.push(`${where}.if, a prefix and a set on one side`);
        found.push(...FortiOsUnsupported.listGaps(where, match));
        if (FortiOsFirewall.isImplied(rule)) return found;

        const families = FortiOsFirewall.familiesOf(device, match);
        if (!families.length) found.push(`${where}, its addresses share no family`);

        const src = FortiOsNames.single(match?.src);
        const dst = FortiOsNames.single(match?.dst);
        if (src && dst && Address.family(Address.host(src)) !== Address.family(Address.host(dst))) {
            found.push(`${where}, a source and destination of two families`);
        }

        for (const family of families) {
            if (FortiOsFirewall.serviceOf(match, family).name.length > FortiOsUnsupported.NAME_LENGTH.object)
                found.push(`${where}.if ports, too many for one service`);
        }

        if (chain === "input") {
            if (match?.out_interface) found.push(`${where}.if.out_interface, on traffic to the device`);
            if (rule.then === "reject") found.push(`${where}.then reject, the platform drops traffic to itself silently`);
            if (rule.fast_path) found.push(`${where}.fast_path, on traffic to the device`);
        }

        return found;
    }

    private static serviceGaps(device: Device): string[] {
        const found: string[] = [];

        for (const [name, server] of Object.entries(device.services?.dhcp_server ?? {})) {
            if ((server.dns?.length ?? 0) > FortiOsRender.RESOLVERS.dhcp)
                found.push(`services.dhcp_server.${name}.dns, at most ${FortiOsRender.RESOLVERS.dhcp}`);
        }

        for (const [name, server] of Object.entries(device.services?.dhcpv6_server ?? {})) {
            const where = `services.dhcpv6_server.${name}`;
            const { min, max } = FortiOsRender.DHCPV6_LEASE_TIME;
            if (!server.pool)
                found.push(
                    `${where} without pool: FortiOS 6.2 has no setting that keeps a DHCPv6 server from giving addresses. Write pool, or announce the DNS servers in ipv6_ra.dns_servers`
                );
            if ((server.dns?.length ?? 0) > FortiOsRender.RESOLVERS.dhcp)
                found.push(`${where}.dns, at most ${FortiOsRender.RESOLVERS.dhcp}`);
            if (server.lease_time !== undefined && (server.lease_time < min || server.lease_time > max))
                found.push(`${where}.lease_time ${server.lease_time}, FortiOS takes ${min} to ${max} seconds`);
        }

        const flow = device.monitoring?.flow_export;
        if (flow?.protocol === "ipfix") found.push("monitoring.flow_export.protocol ipfix, the platform exports sFlow and NetFlow 9");
        if (flow && flow.collectors.length > 1) found.push("monitoring.flow_export.collectors, one collector");
        for (const name of flow?.interfaces ?? []) {
            if (FortiOsNames.isTunnel(device, name))
                found.push(`monitoring.flow_export.interfaces ${name}, a tunnel: the platform samples the interface it leaves through`);
        }
        if (flow?.protocol === "netflow-v9" && flow.sampling !== undefined)
            found.push("monitoring.flow_export.sampling, NetFlow here exports every flow");

        const { active, inactive } = FortiOsMonitoring.FLOW_TIMEOUTS;
        const minutes = flow?.active_timeout;
        if (minutes !== undefined && (minutes % active.min !== 0 || minutes < active.min || minutes > active.max))
            found.push(
                `monitoring.flow_export.active_timeout, from ${active.min} to ${active.max} seconds in whole minutes: the platform sets it in minutes`
            );
        const idle = flow?.idle_timeout;
        if (idle !== undefined && (idle < inactive.min || idle > inactive.max))
            found.push(`monitoring.flow_export.idle_timeout, from ${inactive.min} to ${inactive.max} seconds on the platform`);
        if (flow?.protocol === "sflow" && (flow.sampling === undefined || flow.sampling < 10 || flow.sampling > 99999)) {
            found.push("monitoring.flow_export.sampling, required and from 10 to 99999: the platform samples");
        }

        return found;
    }
}
