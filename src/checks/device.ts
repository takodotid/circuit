// What reading the project already stops on is not checked again here: unknown keys, names a device refers to, ports the model doesn't have, and links that don't link back.

import { X509Certificate } from "node:crypto";
import { utils } from "ssh2";
import { Address } from "../core/address";
import { Utils } from "../core/utils";
import type { Device, Finding, Interface, Ipsec, NeighborSettings, Routed, StaticRoute, Switched } from "../model";
import { Catalog } from "../core/catalog";
import { Derive } from "../core/derive";
import { Platforms } from "../platforms";
import { IpsecChecks } from "./ipsec";
import { IsisChecks } from "./isis";
import { L3vpnChecks } from "./l3vpn";
import { RateLimitChecks } from "./rate-limit";
import { MplsChecks } from "./mpls";
import { NatChecks } from "./nat";
import { PppoeClientChecks } from "./pppoe-client";
import { PseudowireChecks } from "./pseudowire";
import { ServicesChecks } from "./services";
import { VlanTagChecks } from "./vlan-tag";

type Report = (message: string) => void;

type Checker = (where: string, value: string) => void;

export class DeviceChecks {
    /** IEEE 802.1Q reserves 0 and 4095. */
    private static readonly MAX_VLAN_ID = 4094;
    /** A VRRP virtual router ID is 1 to 255 (RFC 5798). */
    private static readonly MAX_VRRP_ID = 255;
    private static readonly MAX_EOIP_TUNNEL_ID = 65535;
    /** The MSS every IPv4 host takes (RFC 879). */
    private static readonly MIN_MSS = 536;
    /** The largest IP packet, less 40 bytes of headers. */
    private static readonly MAX_MSS = 65495;
    /** The backbone area, which every other area attaches to (RFC 2328). */
    private static readonly OSPF_BACKBONE = "0.0.0.0";
    /** The largest metric of a summary LSA; 16777215 is LSInfinity (RFC 2328). */
    private static readonly MAX_OSPF_DEFAULT_COST = 16_777_214;
    /** A hello or dead interval, in seconds, that every platform takes. */
    private static readonly MAX_OSPF_INTERVAL = 65_535;
    /** The hello interval every platform uses when the config states none, in seconds. */
    private static readonly OSPF_HELLO_INTERVAL = 10;
    /** The usual dead interval, in hello intervals (RFC 2328, Appendix C.3). */
    private static readonly OSPF_DEAD_HELLOS = 4;
    /** An OSPF authentication key ID is one octet (RFC 2328). */
    private static readonly MAX_OSPF_KEY_ID = 255;
    /** Six pairs of hex digits with colons between them. */
    private static readonly MAC = /^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/i;
    /** The highest 4-byte AS number (RFC 6793). */
    private static readonly MAX_ASN = 4294967295;
    /** The route match fields that hold AS numbers. */
    private static readonly AS_FIELDS = ["as_path_contains", "first_as", "origin_as"] as const;
    /** The fewest and most seconds between two router advertisements (RFC 4861, MaxRtrAdvInterval). */
    private static readonly RA_INTERVAL = { min: 4, max: 1800 } as const;
    /** The most seconds a router advertisement keeps the router as a gateway (RFC 4861, AdvDefaultLifetime). */
    private static readonly MAX_RA_LIFETIME = 9000;
    /** The most seconds a prefix lifetime holds, all ones, which is forever (RFC 4861). */
    private static readonly MAX_PREFIX_LIFETIME = 4_294_967_295;
    /** The length of a prefix hosts make their own addresses in: a 64-bit interface ID (RFC 4291, RFC 4862). */
    private static readonly SLAAC_LENGTH = 64;
    private static readonly FAMILY_NAMES = [
        ["ipv4", "IPv4"],
        ["ipv6", "IPv6"],
    ] as const;

    /** Every rule on one device, and what its model's hardware holds. */
    static run(device: Device): Finding[] {
        const findings: Finding[] = [];
        const report: Report = (message) => findings.push({ level: "error", device: device.name, message });

        DeviceChecks.check(device, report);
        findings.push(
            ...DeviceChecks.limits(device),
            ...DeviceChecks.ospfWarnings(device),
            ...DeviceChecks.raWarnings(device),
            ...ServicesChecks.warnings(device)
        );

        return findings;
    }

    /** An address entry's own address: the string, or `address` of `{ address, peer_address }`. */
    static addressOf(entry: NonNullable<Routed["addresses"]>[number]): string {
        return typeof entry === "string" ? entry : entry.address;
    }

    private static check(device: Device, report: Report): void {
        try {
            Catalog.ports(device.platform, device.model);
        } catch (error) {
            report((error as Error).message);
        }

        const cidr: Checker = (where, value) => {
            if (!Address.isCidr(value)) report(`${where}: '${value}' is not an address with a length`);
        };
        const ip: Checker = (where, value) => {
            if (!Address.isValid(value)) report(`${where}: '${value}' is not an address`);
        };

        if (!device.connection.host && !device.connection.console)
            report("connection has neither a host nor a console to reach the device through");

        DeviceChecks.vlans(device, report);
        if (device.switching?.arp_inspection && !device.switching.dhcp_snooping)
            report("switching.arp_inspection checks what DHCP snooping saw: write dhcp_snooping: true beside it");
        DeviceChecks.addresses(device, report, cidr, ip);
        DeviceChecks.ports(device, report);
        DeviceChecks.interfaces(device, report, ip);
        RateLimitChecks.check(device, report);
        VlanTagChecks.check(device, report);
        DeviceChecks.routing(device, report, cidr, ip);
        IsisChecks.check(device, report);
        MplsChecks.check(device, report);
        L3vpnChecks.check(device, report);
        PseudowireChecks.check(device, report);
        NatChecks.check(device, report);
        DeviceChecks.policies(device, report, cidr);
        DeviceChecks.firewall(device, report, cidr);
        ServicesChecks.check(device, report, cidr, ip);
        PppoeClientChecks.check(device, report);
        DeviceChecks.certificates(device, report);
        DeviceChecks.vdoms(device, report, cidr, ip);
        DeviceChecks.users(device, report);
        DeviceChecks.aaa(device, report, ip);
    }

    /** One kind of server, at least one, each listed once, and each sending from an address of its own family. */
    private static aaa(device: Device, report: Report, ip: Checker): void {
        const aaa = device.system?.aaa;
        if (!aaa) return;

        if (aaa.tacacs && aaa.radius) report("system.aaa has both tacacs and radius: write one of them");
        const kind = aaa.tacacs ? "tacacs" : "radius";
        const servers = aaa.tacacs ?? aaa.radius ?? [];
        if (!servers.length) report("system.aaa has no server: write tacacs or radius, with at least one server");

        ServicesChecks.servers(`system.aaa.${kind}`, servers, report, ip);
    }

    /** Each SSH key is one public key line whose key reads back, never a private key. */
    private static users(device: Device, report: Report): void {
        for (const [name, user] of Object.entries(device.system?.users ?? {})) {
            (user?.ssh_keys ?? []).forEach((line, index) => {
                const where = `system.users.${name}.ssh_keys[${index}]`;
                if (line.includes("PRIVATE KEY"))
                    return report(`${where} is a private key: write the public key, the line in the .pub file`);

                const key = utils.parseKey(line);
                if (key instanceof Error || key.isPrivateKey())
                    report(
                        `${where} is not a public key line: copy the whole line of the .pub file, such as "ssh-ed25519 AAAAC3Nza... alice@laptop"`
                    );
            });
        }
    }

    /** A management VDOM: FortiOS only, not `root`, with no LAG member listed apart from its LAG, and routes that leave through its own interfaces. */
    private static vdoms(device: Device, report: Report, cidr: Checker, ip: Checker): void {
        const management = device.system?.vdoms?.management;
        if (!management) return;

        if (device.platform !== "fortios") report("system.vdoms is a FortiOS setting");
        if (management.name === "root")
            report("system.vdoms.management.name is root, the VDOM everything else is in; give it a name of its own");

        for (const name of management.interfaces) {
            const lag = device.interfaces?.ethernet?.[name]?.in_lag;
            if (lag) report(`system.vdoms.management.interfaces has ${name}, which is in LAG ${lag}; list the LAG`);
        }

        for (const route of management.static_routes ?? []) {
            const where = `system.vdoms.management.static_routes ${route.prefix}`;
            cidr(where, route.prefix);
            DeviceChecks.nextHop(where, route, report, ip);
            if (route.interface && !management.interfaces.includes(route.interface))
                report(`${where} leaves through ${route.interface}, which is not in the VDOM`);
        }
    }

    /** What the model's hardware holds, from the catalog. A LAG with too many members is an error; too many switch rules is a warning, since the limit is only roughly known. */
    private static limits(device: Device): Finding[] {
        const limits = Catalog.limits(device.platform, device.model);
        const findings: Finding[] = [];
        const report = (level: Finding["level"], message: string) => findings.push({ level, device: device.name, message });

        if (limits.lag_members !== undefined) {
            for (const name of Object.keys(device.interfaces?.lag ?? {})) {
                const members = Derive.ports(device).filter(([, port]) => port.in_lag === name).length;
                if (members > limits.lag_members) {
                    report("error", `interfaces.lag.${name} has ${members} members; ${device.model} holds at most ${limits.lag_members}`);
                }
            }
        }

        if (limits.switch_rules === undefined && limits.switch_port_ranges === undefined) return findings;

        const rules = Platforms.find(device.platform)?.switchRules?.(device);
        if (!rules) return findings;

        const after = "A rule it cannot hold is invalid, and so is every rule after it";

        if (limits.switch_rules !== undefined && rules.count > limits.switch_rules) {
            report(
                "warning",
                `switching.acls make ${rules.count} switch rules; a ${device.model} held about ${limits.switch_rules}. ${after}`
            );
        }

        if (limits.switch_port_ranges !== undefined && rules.ranges > limits.switch_port_ranges) {
            report(
                "warning",
                `switching.acls use ${rules.ranges} distinct port ranges; a ${device.model} held ${limits.switch_port_ranges}. ${after}`
            );
        }

        return findings;
    }

    private static vlans(device: Device, report: Report): void {
        const ids = new Map<number, string>();

        for (const [name, vlan] of Object.entries(device.switching?.vlans ?? {})) {
            if (!vlan) continue;

            if (!Number.isInteger(vlan.id) || vlan.id < 1 || vlan.id > DeviceChecks.MAX_VLAN_ID)
                report(`switching.vlans.${name} id ${vlan.id} is outside 1-${DeviceChecks.MAX_VLAN_ID}`);
            if (ids.has(vlan.id)) report(`switching.vlans ${ids.get(vlan.id)} and ${name} share id ${vlan.id}`);
            ids.set(vlan.id, name);
        }

        DeviceChecks.privateVlans(device, report);

        const qinq = new Set(Derive.switchedHolders(device).flatMap(({ settings }) => (settings.qinq_vlan ? [settings.qinq_vlan] : [])));
        for (const [iface, settings] of Object.entries(device.interfaces?.vlan_interface ?? {}))
            if (settings && qinq.has(settings.vlan))
                report(
                    `interfaces.vlan_interface.${iface} is on ${settings.vlan}, which carries customers' frames as a QinQ VLAN: route on another VLAN`
                );
    }

    /** A secondary VLAN (RFC 5517) hangs off a primary VLAN that is no secondary itself, one isolated VLAN at most each, and holds access ports only. */
    private static privateVlans(device: Device, report: Report): void {
        const vlans = device.switching?.vlans ?? {};
        const isolated = new Map<string, string>();

        for (const [name, vlan] of Object.entries(vlans)) {
            const secondary = vlan?.private_vlan;
            if (!secondary) continue;

            const where = `switching.vlans.${name}.private_vlan`;
            const primary = vlans[secondary.primary];
            if (!primary) report(`${where}.primary ${secondary.primary} is not in switching.vlans`);
            else if (primary.private_vlan)
                report(`${where}.primary ${secondary.primary} is a secondary VLAN itself: name its primary VLAN`);

            if (secondary.type === "isolated" && isolated.has(secondary.primary))
                report(
                    `${where}: ${isolated.get(secondary.primary)} is already the isolated VLAN of ${secondary.primary}, which has one at most`
                );
            if (secondary.type === "isolated") isolated.set(secondary.primary, name);

            for (const { where: holder, settings } of Derive.switchedHolders(device)) {
                if (settings.trunk_vlans?.includes(name) || settings.native_vlan === name)
                    report(
                        `${holder} carries ${name}, a secondary VLAN, on a trunk: a trunk carries its primary VLAN ${secondary.primary}`
                    );
            }
            for (const [iface, settings] of Object.entries(device.interfaces?.vlan_interface ?? {}))
                if (settings?.vlan === name)
                    report(`interfaces.vlan_interface.${iface} is on ${name}, a secondary VLAN: put it on ${secondary.primary}`);
        }
    }

    /** Every address is valid, and no address sits on two interfaces of one routing table. Two VRFs may hold the same address. */
    private static addresses(device: Device, report: Report, cidr: Checker, ip: Checker): void {
        const holderOf = new Map<string, string>();

        for (const { where, settings } of Derive.holders(device)) {
            for (const [family, name] of DeviceChecks.FAMILY_NAMES) {
                if (settings.urpf?.[family] && !Derive.hasFamily(settings, family))
                    report(`${where} has urpf.${family} but no ${name} address: write it on the interface that holds the address`);
            }

            for (const entry of settings.addresses ?? []) {
                const address = DeviceChecks.addressOf(entry);
                cidr(where, address);
                if (typeof entry !== "string") ip(where, entry.peer_address);

                const bare = address.split("/")[0]!;
                const key = `${settings.vrf ?? ""} ${bare}`;
                if (holderOf.has(key)) report(`${bare} is on both ${holderOf.get(key)} and ${where}`);
                holderOf.set(key, where);
            }

            for (const group of settings.vrrp ?? []) {
                ip(`${where} VRRP ${group.id}`, group.address);
                if (group.id < 1 || group.id > DeviceChecks.MAX_VRRP_ID)
                    report(`${where} VRRP id ${group.id} is outside 1-${DeviceChecks.MAX_VRRP_ID}`);
            }

            DeviceChecks.routerAdvertisement(`${where}.ipv6_ra`, settings, report, ip);
        }
    }

    /** Each value is within RFC 4861's range, and each prefix and DNS server is IPv6. */
    private static routerAdvertisement(where: string, settings: Routed, report: Report, ip: Checker): void {
        const ra = Derive.routerAdvertisement(settings);
        if (!ra) return;

        const { interval, lifetime } = ra;
        const whole = (value: number, min: number, max: number) => Number.isInteger(value) && value >= min && value <= max;
        const { min, max } = DeviceChecks.RA_INTERVAL;
        if (interval !== undefined && !whole(interval, min, max))
            report(`${where}.interval ${interval} is not a whole number from ${min} to ${max}`);
        if (lifetime !== undefined && !whole(lifetime, 0, DeviceChecks.MAX_RA_LIFETIME))
            report(`${where}.lifetime ${lifetime} is not a whole number from 0 to ${DeviceChecks.MAX_RA_LIFETIME}`);
        if (interval !== undefined && lifetime && lifetime < interval)
            report(`${where}.lifetime ${lifetime} is below interval ${interval}: hosts would drop the router between two advertisements`);

        (ra.prefixes ?? []).forEach((advertised, index) => {
            const at = `${where}.prefixes[${index}]`;
            if (!Address.isCidr(advertised.prefix) || Address.family(advertised.prefix) !== "ipv6") {
                report(`${at}.prefix '${advertised.prefix}' is not an IPv6 prefix, such as 2001:db8:100:1::/64`);
                return;
            }
            if (Address.prefixOf(advertised.prefix) !== Address.canonical(advertised.prefix))
                report(`${at}.prefix ${advertised.prefix} has bits past its length: write ${Address.prefixOf(advertised.prefix)}`);

            const { valid_lifetime: valid, preferred_lifetime: preferred } = advertised;
            for (const [key, value] of [
                ["valid_lifetime", valid],
                ["preferred_lifetime", preferred],
            ] as const) {
                if (value !== undefined && !whole(value, 0, DeviceChecks.MAX_PREFIX_LIFETIME))
                    report(`${at}.${key} ${value} is not a whole number from 0 to ${DeviceChecks.MAX_PREFIX_LIFETIME}`);
            }
            if (valid !== undefined && preferred !== undefined && preferred > valid)
                report(`${at}.preferred_lifetime ${preferred} is above valid_lifetime ${valid}, so hosts ignore the prefix`);
        });

        for (const server of ra.dns_servers ?? []) {
            ip(`${where}.dns_servers`, server);
            if (Address.isValid(server) && Address.family(server) !== "ipv6") report(`${where}.dns_servers ${server} is not IPv6`);
        }
    }

    private static ports(device: Device, report: Report): void {
        for (const [name, port] of Derive.ports(device)) {
            const where = `interfaces.ethernet.${name}`;
            const switched = Boolean(port.access_vlan || port.trunk_vlans || port.qinq_vlan);

            if (port.access_vlan && port.trunk_vlans) report(`${where} is both access and trunk`);
            if (port.native_vlan && !port.trunk_vlans) report(`${where} has a native VLAN but is not a trunk`);
            if (switched && port.addresses?.length) report(`${where} is switched and routed at once`);

            if (port.in_lag && (switched || port.addresses)) {
                report(`${where}.in_lag is ${port.in_lag}, and the port states its own switching or addresses; the LAG holds them`);
            }

            DeviceChecks.frames(where, port, report);
            DeviceChecks.guards(where, port, device, report);
        }
    }

    /** BPDU guard is for a port that faces hosts, both guards need spanning tree, and a trusted port needs what it is trusted by. A LAG holds them for its members. */
    private static guards(where: string, settings: Switched & { in_lag?: string }, device: Device, report: Report): void {
        const stp = typeof settings.stp === "object" ? settings.stp : undefined;
        const guarded = stp?.bpdu_guard || stp?.guard;
        const switching = device.switching;

        if (stp?.bpdu_guard && !stp.edge) report(`${where}.stp.bpdu_guard is for a port that faces hosts: write edge: true beside it`);
        if (guarded && !switching?.stp) report(`${where}.stp guards a port while spanning tree is off on the device: write switching.stp`);
        if (settings.dhcp_trusted && !switching?.dhcp_snooping)
            report(`${where}.dhcp_trusted needs switching.dhcp_snooping: write dhcp_snooping: true there`);
        if (settings.ra_trusted && !switching?.ra_guard) report(`${where}.ra_trusted needs switching.ra_guard: write ra_guard: true there`);

        const fields = [...(guarded ? ["stp"] : []), ...(["dhcp_trusted", "ra_trusted"] as const).filter((field) => settings[field])];
        for (const field of fields) {
            if (settings.in_lag) report(`${where}.${field} is on a member of ${settings.in_lag}: write it on the LAG`);
            else if (!settings.access_vlan && !settings.trunk_vlans && !settings.qinq_vlan)
                report(`${where}.${field} is on a port that switches no VLAN`);
        }
    }

    /** A MAC limit is a whole number above 0, and an ethertype filter lets at least one kind in, each once. */
    private static frames(where: string, settings: Switched, report: Report): void {
        const limit = settings.mac_limit;
        if (limit !== undefined && !(Number.isInteger(limit) && limit >= 1))
            report(`${where}.mac_limit ${limit} is not a whole number above 0`);

        const kinds = settings.ethertypes;
        if (kinds && !kinds.length) report(`${where}.ethertypes is empty, so it would drop every frame`);
        if (kinds && new Set(kinds).size !== kinds.length) report(`${where}.ethertypes lists a kind twice`);

        if (settings.bound_to) DeviceChecks.bound(where, settings, report);
    }

    /** A bound port is an access port, with each host's MAC address and each address it sends from written once. */
    private static bound(where: string, settings: Switched, report: Report): void {
        const hosts = settings.bound_to ?? [];
        if (!hosts.length) report(`${where}.bound_to is empty, so it would drop every frame`);
        if (!settings.access_vlan) report(`${where}.bound_to is on a port that is not an access port: bind the hosts of one VLAN`);

        const macs = new Set<string>();
        const addresses = new Set<string>();

        hosts.forEach((host, index) => {
            const at = `${where}.bound_to[${index}]`;
            const mac = host.mac.toLowerCase();

            if (!DeviceChecks.MAC.test(mac)) report(`${at}.mac '${host.mac}' is not a MAC address, such as 02:00:00:00:00:01`);
            else if (parseInt(mac.slice(0, 2), 16) & 1) report(`${at}.mac ${host.mac} is a multicast address, which no host sends from`);
            if (macs.has(mac)) report(`${at}.mac ${host.mac} is listed twice`);
            macs.add(mac);

            for (const address of host.addresses) {
                const prefix = address.includes("/");
                if (prefix ? !Address.isCidr(address) : !Address.isValid(address)) {
                    report(`${at}.addresses: '${address}' is neither an address nor a prefix`);
                    continue;
                }

                const canonical = Address.canonical(address);
                if (prefix && Address.prefixOf(address) !== canonical)
                    report(`${at}.addresses ${address} has bits past its length: write ${Address.prefixOf(address)}`);
                if (Address.contains("fe80::/10", address.split("/")[0]!))
                    report(`${at}.addresses ${address} is link-local, which a bound host may always send from`);
                if (addresses.has(canonical)) report(`${at}.addresses ${address} is listed twice on the port`);
                addresses.add(canonical);
            }
        });
    }

    private static interfaces(device: Device, report: Report, ip: Checker): void {
        const bridges = Object.entries(device.interfaces?.bridge ?? {});

        for (const { name, kind, settings } of Derive.interfaces(device)) {
            const where = `interfaces.${kind}.${name}`;
            if (Catalog.isPort(device.platform, device.model, name)) report(`${where} has the name of a port`);

            if (kind === "gre" || kind === "vxlan" || kind === "ipsec" || kind === "eoip") {
                const tunnel = settings as Extract<Interface, { remote_address: string }>;
                ip(where, tunnel.local_address);
                ip(where, tunnel.remote_address);
            }

            if (kind === "ipsec") IpsecChecks.check(where, settings as Ipsec, device.system?.certificates ?? {}, report);

            if (kind === "eoip") {
                const id = (settings as Extract<Interface, { tunnel_id: number }>).tunnel_id;
                if (!(Number.isInteger(id) && id >= 0 && id <= DeviceChecks.MAX_EOIP_TUNNEL_ID))
                    report(`${where}.tunnel_id ${id} is not a whole number from 0 to ${DeviceChecks.MAX_EOIP_TUNNEL_ID}`);

                const same = Object.entries(device.interfaces?.eoip ?? {}).find(
                    ([other, tunnel]) => other !== name && tunnel?.tunnel_id === id
                );
                if (same && same[0] > name) report(`${where}.tunnel_id ${id} is also interfaces.eoip.${same[0]}'s`);
            }

            if (settings.shaping && !(settings.shaping.mbps > 0)) report(`${where}.shaping.mbps ${settings.shaping.mbps} is not above 0`);

            if (kind === "vlan_interface") {
                const subnets = (settings.addresses ?? []).map((entry) => DeviceChecks.addressOf(entry));

                for (const address of (settings as Extract<Interface, { vlan: string }>).proxy_arp ?? []) {
                    ip(`${where}.proxy_arp`, address);
                    if (!subnets.some((subnet) => Address.isCidr(subnet) && Address.contains(subnet, address)))
                        report(`${where}.proxy_arp ${address} is in none of its subnets, so no host there asks for it`);
                }
            }

            if (kind === "lag") {
                const lag = settings as Extract<Interface, { mode?: string }> & {
                    link_check?: { arp_targets: readonly string[]; interval_ms: number };
                };
                DeviceChecks.frames(where, settings as Switched, report);
                DeviceChecks.guards(where, settings as Switched, device, report);

                const ports = Derive.ports(device).filter(([, port]) => port.in_lag === name);
                const tunnels = Object.entries(device.interfaces?.eoip ?? {}).filter(([, tunnel]) => tunnel?.in_lag === name);
                if (!ports.length && !tunnels.length) report(`${where} has no members`);
                if (tunnels.length && lag.mode !== "round_robin") report(`${where} has EoIP members, which only a round_robin LAG takes`);

                const check = lag.link_check;
                if (check) {
                    if (!check.arp_targets.length) report(`${where}.link_check.arp_targets is empty`);
                    for (const target of check.arp_targets) ip(`${where}.link_check.arp_targets`, target);
                    if (!(Number.isInteger(check.interval_ms) && check.interval_ms > 0))
                        report(`${where}.link_check.interval_ms ${check.interval_ms} is not a whole number above 0`);
                }
            }

            if (kind === "bridge") {
                const members = (settings as Extract<Interface, { member_interfaces: unknown }>).member_interfaces;
                if (members.length < 2) report(`${where} joins fewer than two interfaces`);

                for (const member of members) {
                    if (device.interfaces?.vlan_interface?.[member]?.addresses?.length)
                        report(`${where}: member ${member} has an address of its own`);

                    const other = bridges.find(([otherName, bridge]) => otherName !== name && bridge?.member_interfaces.includes(member));
                    if (other) report(`${where}: member ${member} is also in interfaces.bridge.${other[0]}`);
                }
            }

            if (kind === "wireguard") {
                for (const peer of (settings as Extract<Interface, { listen_port: number }>).peers ?? []) {
                    const wrong = peer.allowed_addresses.filter((address) => !Address.isCidr(address));
                    for (const address of wrong) report(`${where} peer ${peer.name}: '${address}' is not an address with a length`);
                }
            }
        }
    }

    /** A static route goes somewhere: to a next hop, out of an interface, or nowhere as a blackhole, which then has neither. */
    private static nextHop(where: string, route: StaticRoute, report: Report, ip: Checker): void {
        // `fe80::1%ether1`, as some devices write a link-local next hop.
        const [address, scope] = route.next_hop?.split("%") ?? [];
        if (scope !== undefined)
            report(
                `${where} next_hop ${route.next_hop} has an interface after %. Write next_hop: "${address}", and the interface in interface`
            );
        else if (route.next_hop) ip(where, route.next_hop);
        if (!route.next_hop && !route.interface && !route.blackhole) report(`${where} has no next hop`);

        const forwards = [route.next_hop && "next_hop", route.interface && "interface"].filter(Boolean).join(" and ");
        if (route.blackhole && forwards)
            report(`${where} has blackhole with ${forwards}. Remove ${forwards} to drop the traffic, or remove blackhole to forward it`);
    }

    private static routing(device: Device, report: Report, cidr: Checker, ip: Checker): void {
        const routing = device.routing;

        for (const route of routing?.static_routes ?? []) {
            const where = `routing.static_routes ${route.prefix}`;
            cidr("routing.static_routes", route.prefix);
            DeviceChecks.nextHop(where, route, report, ip);
            if (route.bfd && !route.next_hop) report(`${where} has bfd without next_hop, the address BFD watches`);
            if (route.vrf && Utils.otherTable(route.routing_table))
                report(`${where} has both vrf and routing_table; a route is in one of them`);
        }

        DeviceChecks.tables(device, report, cidr);

        const pairs = new Map<string, number>();
        (routing?.vrf_imports ?? []).forEach(({ from, to }, index) => {
            const where = `routing.vrf_imports[${index}]`;
            if (from === to) report(`${where} takes routes from ${from} into ${from}; give another table in to`);

            const pair = `${from} ${to}`;
            const first = pairs.get(pair);
            if (first === undefined) pairs.set(pair, index);
            else
                report(
                    `${where} takes routes from ${from} into ${to}, as routing.vrf_imports[${first}] does; write one import, and put the rules of both policies in its policy`
                );
        });

        const bgp = routing?.bgp;

        for (const prefix of bgp?.originated_prefixes ?? []) cidr("routing.bgp.originated_prefixes", prefix);

        if (bgp?.cluster_id !== undefined && (!Address.isValid(bgp.cluster_id) || Address.family(bgp.cluster_id) !== "ipv4"))
            report(`routing.bgp.cluster_id: '${bgp.cluster_id}' is not an IPv4 address, such as 192.0.2.1`);

        DeviceChecks.aggregates(device, report, cidr);
        DeviceChecks.confederation(device, report);

        const ttlWithMultihop = (where: string) =>
            report(
                `${where} has ttl_security with multihop, but a packet from more than one hop away never arrives with TTL 255. Remove ttl_security, or remove multihop if the neighbor is directly connected`
            );

        // The editor refuses both, but two parts merged can still write them.
        const bothLimits = (where: string, settings: NeighborSettings | undefined) => {
            const limit = Derive.prefixLimit(settings ?? {});
            if (limit?.warn_only && limit.restart_after !== undefined)
                report(
                    `${where}.max_prefixes has warn_only and restart_after. Keep warn_only to leave the session up, or restart_after to close it and open it again`
                );
        };

        const external = (remoteAs: number | undefined) => remoteAs !== undefined && remoteAs !== bgp?.asn;
        const reflectedToExternal = (where: string, remoteAs: number | undefined) =>
            report(
                `${where} has route_reflector_client, but AS${remoteAs} is not ours, AS${bgp?.asn}: a route reflector has iBGP clients only (RFC 4456). Remove route_reflector_client`
            );

        const twoTables = (where: string) => report(`${where} has both vrf and routing_table; a session is in one of them`);

        for (const [name, group] of Object.entries(bgp?.neighbor_groups ?? {})) {
            const where = `routing.bgp.neighbor_groups.${name}`;
            if (group?.vrf && Utils.otherTable(group.routing_table)) twoTables(where);
            if (group?.ttl_security && group.multihop) ttlWithMultihop(where);
            if (group?.route_reflector_client && external(group.remote_as)) reflectedToExternal(where, group.remote_as);
            bothLimits(where, group);
        }

        for (const [name, neighbor] of Object.entries(bgp?.neighbors ?? {})) {
            const where = `routing.bgp.neighbors.${name}`;
            ip(where, neighbor.address);

            const group = neighbor.neighbor_group ? bgp?.neighbor_groups?.[neighbor.neighbor_group] : undefined;
            if (!(neighbor.remote_as ?? group?.remote_as)) report(`${where} has no remote_as`);

            const local = neighbor.local_address ?? group?.local_address;
            if (local && Address.family(local) !== Address.family(neighbor.address))
                report(`${where} local_address and address differ in family`);

            // A group that has both is reported once, at the group.
            const ownTable = neighbor.vrf !== undefined || neighbor.routing_table !== undefined;
            if ((neighbor.vrf ?? group?.vrf) && Utils.otherTable(neighbor.routing_table ?? group?.routing_table) && ownTable)
                twoTables(where);

            // A group that has both is reported once, at the group.
            const ownChoice = neighbor.ttl_security !== undefined || neighbor.multihop !== undefined;
            if ((neighbor.ttl_security ?? group?.ttl_security) && (neighbor.multihop ?? group?.multihop) && ownChoice)
                ttlWithMultihop(where);
            bothLimits(where, neighbor);

            const remoteAs = neighbor.remote_as ?? group?.remote_as;
            const client = neighbor.route_reflector_client ?? group?.route_reflector_client;
            const ownReflection = neighbor.route_reflector_client !== undefined || neighbor.remote_as !== undefined;
            if (client && external(remoteAs) && ownReflection) reflectedToExternal(where, remoteAs);

            // In a confederation, a neighbor in another member AS is a special case on Junos, so only an AS outside it is checked.
            const vrf = neighbor.vrf ?? group?.vrf;
            const outside = external(remoteAs) && !bgp?.confederation?.member_as.includes(remoteAs!);
            if (outside && !(neighbor.multihop ?? group?.multihop) && Derive.sharesNetwork(device, neighbor.address, vrf) === false)
                report(
                    `${where}: ${neighbor.address} is on no network of this device${vrf ? ` in VRF ${vrf}` : ""}, so an eBGP session to it never comes up. ${(neighbor.ttl_security ?? group?.ttl_security) ? "Fix the address: ttl_security takes a directly connected neighbor only" : `Write multihop: true if AS${remoteAs} is more than one hop away, or fix the address`}`
                );

            const role = neighbor.role ?? group?.role;
            if (remoteAs !== undefined && !external(remoteAs) && role)
                report(`${where} has role, but AS${remoteAs} is ours, and a role is for eBGP neighbors (RFC 9234). Remove role`);
            if (remoteAs !== undefined && bgp?.confederation?.member_as.includes(remoteAs) && role)
                report(
                    `${where} has role, but AS${remoteAs} is in our confederation, and RFC 9234 does not recommend roles inside one. Remove role`
                );
            if (remoteAs !== undefined && remoteAs === bgp?.confederation?.identifier)
                report(
                    `${where} has remote_as ${remoteAs}, the confederation's identifier, which only neighbors outside it see. Write the neighbor's member AS: ${bgp.asn} if it is in ours, or one of member_as`
                );
        }

        DeviceChecks.ospf(device, report);
    }

    /** What platforms do differently when the config leaves it out: a border router's default route into a stub area or an NSSA, and a dead interval beside a hello interval. */
    /** A prefix hosts may make their own addresses in, which is not a /64: they make none there. */
    private static raWarnings(device: Device): Finding[] {
        return Derive.holders(device).flatMap(({ where, settings }) =>
            Derive.advertisedPrefixes(settings)
                .filter((advertised) => !advertised.disable_autoconfiguration && Address.isCidr(advertised.prefix))
                .filter((advertised) => Address.split(advertised.prefix).len !== DeviceChecks.SLAAC_LENGTH)
                .map((advertised): Finding => ({
                    level: "warning",
                    device: device.name,
                    message: `${where}.ipv6_ra announces ${advertised.prefix}, where hosts make no address of their own: they do only in a /64. Write disable_autoconfiguration: true for it, or announce a /64`,
                }))
        );
    }

    private static ospfWarnings(device: Device): Finding[] {
        const areas = device.routing?.ospf?.areas ?? {};
        const backbone = Object.values(areas[DeviceChecks.OSPF_BACKBONE]?.interfaces ?? {}).some(Boolean);
        const warn = (message: string): Finding => ({ level: "warning", device: device.name, message });
        const found: Finding[] = [];

        for (const [areaId, area] of Object.entries(areas)) {
            const where = `routing.ospf.areas.${areaId}`;
            if (backbone && area.type && area.stub_default_cost === undefined && areaId !== DeviceChecks.OSPF_BACKBONE)
                found.push(
                    warn(
                        `${where} is ${area.type === "stub" ? "a stub area" : "an NSSA"} without stub_default_cost, and this device is its border router. RouterOS and Junos then announce no default route into it, and other platforms one at a cost of their own. Write stub_default_cost, such as 10`
                    )
                );

            for (const [name, settings] of Object.entries(area.interfaces)) {
                const hello = settings?.hello_interval;
                if (hello !== undefined && settings?.dead_interval === undefined)
                    found.push(
                        warn(
                            `${where}.interfaces.${name} has hello_interval without dead_interval. Platforms differ in the dead interval they then use, and neighbors whose dead intervals differ never come up. Write dead_interval, such as ${hello * DeviceChecks.OSPF_DEAD_HELLOS}`
                        )
                    );
            }
        }

        return found;
    }

    /** OSPF's areas and the settings of their interfaces, as RFC 2328 and RFC 3101 allow them. */
    private static ospf(device: Device, report: Report): void {
        const ospf = device.routing?.ospf;
        const within = (value: number, min: number, max: number) => Number.isInteger(value) && value >= min && value <= max;

        for (const [areaId, area] of Object.entries(ospf?.areas ?? {})) {
            const where = `routing.ospf.areas.${areaId}`;
            if (!/^\d+\.\d+\.\d+\.\d+$/.test(areaId)) report(`routing.ospf.areas '${areaId}' is not written as a dotted area ID`);

            if (area.type && areaId === DeviceChecks.OSPF_BACKBONE)
                report(`${where} has type ${area.type}, but the backbone is a normal area (RFC 2328). Remove type`);
            for (const key of ["no_summaries", "stub_default_cost"] as const) {
                if (area[key] !== undefined && !area.type)
                    report(`${where} has ${key} without type: only a stub area or an NSSA takes it. Write type, or remove ${key}`);
            }
            if (area.stub_default_cost !== undefined && !within(area.stub_default_cost, 1, DeviceChecks.MAX_OSPF_DEFAULT_COST))
                report(
                    `${where}.stub_default_cost is ${area.stub_default_cost}: write a whole number from 1 to ${DeviceChecks.MAX_OSPF_DEFAULT_COST}`
                );

            for (const [name, settings] of Object.entries(area.interfaces)) {
                if (!settings) continue;
                const at = `${where}.interfaces.${name}`;

                const vrf = Derive.settings(device, name)?.vrf;
                if (vrf && !ospf?.vrf)
                    report(`${at}: ${name} routes in VRF ${vrf}, and OSPF in the main table. Write vrf: "${vrf}" in routing.ospf`);
                if (ospf?.vrf && vrf !== ospf.vrf)
                    report(
                        `${at}: ${name} routes in ${vrf ? `VRF ${vrf}` : "the main table"}, and OSPF in VRF ${ospf.vrf}. Write vrf: "${ospf.vrf}" on ${name}, or remove it from the area`
                    );

                for (const key of ["hello_interval", "dead_interval"] as const) {
                    const seconds = settings[key];
                    if (seconds !== undefined && !within(seconds, 1, DeviceChecks.MAX_OSPF_INTERVAL))
                        report(`${at}.${key} is ${seconds}: write a whole number of seconds from 1 to ${DeviceChecks.MAX_OSPF_INTERVAL}`);
                }

                const hello = settings.hello_interval ?? DeviceChecks.OSPF_HELLO_INTERVAL;
                const dead = settings.dead_interval;
                if (dead !== undefined && dead <= hello)
                    report(
                        `${at}.dead_interval ${dead} is not more than hello_interval ${hello}, so a neighbor would go down between two hellos. Write ${hello * DeviceChecks.OSPF_DEAD_HELLOS}, four times hello_interval`
                    );

                const authentication = settings.authentication;
                if (authentication && !within(authentication.key_id, 0, DeviceChecks.MAX_OSPF_KEY_ID))
                    report(
                        `${at}.authentication.key_id is ${authentication.key_id}: write a whole number from 0 to ${DeviceChecks.MAX_OSPF_KEY_ID}`
                    );
                if (authentication && ospf?.address_families?.includes("ipv6"))
                    report(
                        `${at}.authentication with OSPFv3: Circuit signs OSPFv2 only, and each platform signs OSPFv3 its own way. Remove authentication, or ipv6 from routing.ospf.address_families`
                    );
            }
        }
    }

    /** An aggregate needs a route inside it that BGP holds, and an export policy that accepts it. Without either, BGP announces nothing for it. */
    private static aggregates(device: Device, report: Report, cidr: Checker): void {
        const bgp = device.routing?.bgp;
        const sessions = Object.values(bgp?.neighbors ?? {}).map((neighbor) => {
            const group = neighbor.neighbor_group ? bgp?.neighbor_groups?.[neighbor.neighbor_group] : undefined;
            const settings = { ...group, ...neighbor };
            return { ...settings, families: Derive.unicastFamilies(settings, neighbor.address) };
        });

        for (const { prefix } of bgp?.aggregates ?? []) {
            if (!Address.isCidr(prefix)) {
                cidr("routing.bgp.aggregates", prefix);
                continue;
            }

            const where = `routing.bgp.aggregates ${prefix}`;
            const { len, family } = Address.split(prefix);
            const carrying = sessions.filter((session) => session.families.includes(family));

            const inside = (bgp?.originated_prefixes ?? []).some(
                (originated) => Address.isCidr(originated) && Address.split(originated).len > len && Address.contains(prefix, originated)
            );
            if (!inside && !carrying.some((session) => session.import_policy))
                report(
                    `${where} has no route inside it to stand for: no prefix of originated_prefixes is inside it, and no neighbor that carries ${family} has an import_policy. Add the prefixes inside it to originated_prefixes`
                );

            const announced = carrying.some(
                (session) =>
                    session.export_policy && (Derive.exportOf(device, session.export_policy, prefix, "aggregate") ?? "reject") !== "reject"
            );
            if (!announced)
                report(
                    `${where}: no neighbor's export_policy accepts it, so BGP announces it to no one. Add { if: { prefix: "${prefix}" }, then: "accept" } to the export_policy of each neighbor that should get it, before any rule that rejects it`
                );
        }
    }

    /** A member AS number is seen only inside the confederation, and the identifier only outside it (RFC 5065), so neither is the other. */
    private static confederation(device: Device, report: Report): void {
        const bgp = device.routing?.bgp;
        const confederation = bgp?.confederation;
        if (!confederation) return;

        const where = "routing.bgp.confederation";
        if (confederation.identifier === bgp.asn)
            report(
                `routing.bgp.asn is AS${bgp.asn}, the confederation's identifier. Write this router's member AS in routing.bgp.asn, such as 65001`
            );

        for (const asn of confederation.member_as) {
            if (asn === bgp.asn)
                report(`${where}.member_as has AS${asn}, this router's own member AS (routing.bgp.asn). List only the other member ASes`);
            if (asn === confederation.identifier) report(`${where}.member_as has AS${asn}, the identifier. List only the member ASes`);
        }
    }

    /** Routing tables have names of their own and something installing routes in them, and policy routing rules can each be reached. */
    private static tables(device: Device, report: Report, cidr: Checker): void {
        const routing = device.routing;
        const bgp = routing?.bgp;

        const installed = new Set<string>();
        for (const route of routing?.static_routes ?? []) {
            const table = Utils.otherTable(route.routing_table);
            if (table) installed.add(table);
        }
        for (const neighbor of Object.values(bgp?.neighbors ?? {})) {
            const group = neighbor.neighbor_group ? bgp?.neighbor_groups?.[neighbor.neighbor_group] : undefined;
            const table = Utils.otherTable(neighbor.routing_table ?? group?.routing_table);
            if (table) installed.add(table);
        }
        // A DHCP client installs the default route its server gives.
        for (const port of Object.values(device.interfaces?.ethernet ?? {})) {
            for (const route of port?.dhcp_client?.default_routes ?? []) {
                const table = Utils.otherTable(route.routing_table);
                if (table) installed.add(table);
            }
        }

        for (const name of Object.keys(routing?.tables ?? {})) {
            if (name === "main") report("routing.tables has main, the main table every device has; give the table another name");
            if (name in (routing?.vrfs ?? {})) report(`routing.tables ${name} has the name of a VRF; give the table another name`);
            if (name !== "main" && !installed.has(name))
                report(
                    `routing.tables ${name}: nothing installs routes in it; give a static route or a BGP neighbor routing_table: "${name}", or remove the table`
                );
        }

        const rules = routing?.policy_routing ?? [];
        rules.forEach((rule, index) => {
            const where = `routing.policy_routing[${index}]${rule.description ? ` (${rule.description})` : ""}`;
            const match = rule.match ?? {};

            if (match.src) cidr(where, match.src);
            if (match.dst) cidr(where, match.dst);

            if (match.src && match.dst && Address.isCidr(match.src) && Address.isCidr(match.dst)) {
                if (Address.family(Address.host(match.src)) !== Address.family(Address.host(match.dst)))
                    report(`${where}: src and dst differ in family, so no packet matches both`);
            }

            if (rule.routing_table === "main" && rule.fallback)
                report(`${where} looks up main and has fallback; fallback is for another table, so remove it`);

            const matchesAll = !match.src && !match.dst && !match.in_interface;
            if (matchesAll && index < rules.length - 1)
                report(`${where} matches every packet, so the rules after it never run; give it a match, or move it last`);
        });
    }

    private static policies(device: Device, report: Report, cidr: Checker): void {
        const policies = device.routing?.policies ?? {};

        for (const [name, rules] of Object.entries(policies)) {
            (rules ?? []).forEach((rule, index) => {
                const match = "if" in rule ? rule.if : undefined;
                if (match?.prefix) cidr(`routing.policies.${name}[${index}]`, match.prefix);

                for (const field of DeviceChecks.AS_FIELDS) {
                    const numbers = match?.[field];
                    if (numbers === undefined) continue;

                    for (const { min, max } of Derive.asRanges(numbers)) {
                        const where = `routing.policies.${name}[${index}].if.${field}`;
                        const wrong = [min, max].find((asn) => !Number.isInteger(asn) || asn < 0 || asn > DeviceChecks.MAX_ASN);
                        if (wrong !== undefined) report(`${where}: ${wrong} is no AS number; write 0 to ${DeviceChecks.MAX_ASN}`);
                        else if (min > max) report(`${where}: the range ends before it starts; write { min: ${max}, max: ${min} }`);
                    }
                }
            });
        }

        // A policy that calls itself, directly or not, never finishes.
        const visit = (policy: string, path: string[]): void => {
            if (path.includes(policy)) return report(`routing.policies: ${[...path, policy].join(" -> ")} calls itself`);

            for (const rule of policies[policy] ?? []) if ("call" in rule && rule.call) visit(rule.call, [...path, policy]);
        };
        for (const policy of Object.keys(policies)) visit(policy, []);
    }

    private static firewall(device: Device, report: Report, cidr: Checker): void {
        const firewall = device.firewall;

        for (const [name, members] of Object.entries(firewall?.address_sets ?? {})) {
            for (const member of members ?? []) {
                if (!Address.isValid(member)) cidr(`firewall.address_sets.${name}`, member);
            }
        }

        const chains = [
            ...Object.entries(firewall?.filter ?? {}).map(([chain, settings]) => ({
                where: `firewall.filter.${chain}.rules`,
                rules: settings?.rules ?? [],
            })),
            { where: "firewall.nat.source", rules: firewall?.nat?.source ?? [] },
            { where: "firewall.nat.destination", rules: firewall?.nat?.destination ?? [] },
            { where: "firewall.tcp_mss", rules: firewall?.tcp_mss ?? [] },
        ];

        (firewall?.tcp_mss ?? []).forEach((rule, index) => {
            const mss = rule.mss;
            if (mss !== "path_mtu" && !(Number.isInteger(mss) && mss >= DeviceChecks.MIN_MSS && mss <= DeviceChecks.MAX_MSS))
                report(
                    `firewall.tcp_mss[${index}].mss ${mss} is not "path_mtu" or a whole number from ${DeviceChecks.MIN_MSS} to ${DeviceChecks.MAX_MSS}`
                );
        });

        for (const { where, rules } of chains) {
            for (const rule of rules) {
                // The model holds one prefix a side; a list is taken as the language writes it.
                for (const address of [rule.if?.src, rule.if?.dst].flat()) {
                    if (address) cidr(where, address);
                }

                // Reading the project leaves out each src and dst of different families, unless that was every one of the rule's.
                const { src, dst } = rule.if ?? {};
                if (typeof src === "string" && typeof dst === "string" && Address.family(src) !== Address.family(dst))
                    report(
                        `${where}${rule.description ? ` (${rule.description})` : ""}: src and dst differ in family, so no packet matches both`
                    );
            }
        }

        // The same for the switch's ACL rules.
        for (const [name, rules] of Object.entries(device.switching?.acls ?? {})) {
            for (const rule of rules ?? []) {
                const { src, dst } = rule.if ?? {};
                if (typeof src === "string" && typeof dst === "string" && Address.family(src) !== Address.family(dst))
                    report(
                        `switching.acls.${name}${rule.description ? ` (${rule.description})` : ""}: src and dst differ in family, so no packet matches both`
                    );
            }
        }
    }

    private static certificates(device: Device, report: Report): void {
        const certificates = device.system?.certificates ?? {};

        for (const [name, certificate] of Object.entries(certificates)) {
            if (!certificate) continue;

            let pem: string;
            try {
                pem = Utils.projectFile(certificate.certificate_file);
            } catch {
                report(`system.certificates.${name}: certificate_file ${certificate.certificate_file} cannot be read`);
                continue;
            }

            try {
                new X509Certificate(pem);
            } catch {
                report(`system.certificates.${name} is not a PEM certificate`);
            }
        }

        for (const service of ["https", "api_tls"] as const) {
            const name = device.management?.[service]?.certificate;
            if (name && certificates[name] && !certificates[name].private_key) {
                report(`management.${service}.certificate ${name} has no private key to serve with`);
            }
        }

        (device.monitoring?.syslog ?? []).forEach((collector, index) => {
            const name = collector.transport_security?.ca_certificate;
            if (name && certificates[name]?.private_key)
                report(
                    `monitoring.syslog[${index}].transport_security.ca_certificate ${name} has a private key: name the CA's certificate alone, which the device only trusts`
                );
        });
    }
}
