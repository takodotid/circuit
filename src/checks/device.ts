// Rules one device has to satisfy, whatever its design. What reading the project already stops on (unknown keys, every name a device refers to, ports the model
// doesn't have, links that don't link back) is not checked again here.

import { X509Certificate } from "node:crypto";
import { Address } from "../core/address";
import { Utils } from "../core/utils";
import type { Device, Interface, InterfaceKind, Routed, Switched } from "../model";
import { Catalog } from "../platforms/catalog";
import { Derive } from "../platforms/derive";
import type { Finding } from "../platforms/finding";
import { Platforms } from "../platforms";

type Report = (message: string) => void;

type Checker = (where: string, value: string) => void;

/** A port or an interface that can hold an address, with its path, such as `interfaces.ethernet.10g-1`. */
export type Holder = { where: string; name: string; kind: "ethernet" | InterfaceKind; settings: Routed };

export class DeviceChecks {
    /** Every rule on one device, and what its model's hardware holds. */
    static run(device: Device): Finding[] {
        const findings: Finding[] = [];
        const report: Report = (message) => findings.push({ level: "error", device: device.name, message });

        DeviceChecks.check(device, report);
        findings.push(...DeviceChecks.limits(device));

        return findings;
    }

    /** Ports, then interfaces group by group, that can hold an address. */
    static holders(device: Device): Holder[] {
        return [
            ...Derive.ports(device).map(([name, settings]): Holder => ({
                where: `interfaces.ethernet.${name}`,
                name,
                kind: "ethernet",
                settings,
            })),
            ...Derive.interfaces(device).map(({ name, kind, settings }): Holder => ({
                where: `interfaces.${kind}.${name}`,
                name,
                kind,
                settings,
            })),
        ];
    }

    /** An address entry's own address: the string, or `address` of `{ address, peer_address }`. */
    static addressOf(entry: NonNullable<Routed["addresses"]>[number]): string {
        return typeof entry === "string" ? entry : entry.address;
    }

    private static check(device: Device, report: Report): void {
        let ports: string[] = [];

        try {
            ports = Catalog.ports(device.platform, device.model);
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
        DeviceChecks.addresses(device, report, cidr, ip);
        DeviceChecks.ports(device, report);
        DeviceChecks.interfaces(device, ports, report, ip);
        DeviceChecks.routing(device, report, cidr, ip);
        DeviceChecks.policies(device, report, cidr);
        DeviceChecks.firewall(device, report, cidr);
        DeviceChecks.services(device, report, cidr);
        DeviceChecks.certificates(device, report);
        DeviceChecks.vdoms(device, report, cidr, ip);
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
            if (route.next_hop) ip(where, route.next_hop);
            if (!route.next_hop && !route.interface && !route.blackhole) report(`${where} has no next hop`);
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

            if (!Number.isInteger(vlan.id) || vlan.id < 1 || vlan.id > 4094)
                report(`switching.vlans.${name} id ${vlan.id} is outside 1-4094`);
            if (ids.has(vlan.id)) report(`switching.vlans ${ids.get(vlan.id)} and ${name} share id ${vlan.id}`);
            ids.set(vlan.id, name);
        }
    }

    /** Every address is valid, and no address sits on two interfaces of one routing table. Two VRFs may hold the same address. */
    private static addresses(device: Device, report: Report, cidr: Checker, ip: Checker): void {
        const holderOf = new Map<string, string>();

        for (const { where, settings } of DeviceChecks.holders(device)) {
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
                if (group.id < 1 || group.id > 255) report(`${where} VRRP id ${group.id} is outside 1-255`);
            }
        }
    }

    private static ports(device: Device, report: Report): void {
        for (const [name, port] of Derive.ports(device)) {
            const where = `interfaces.ethernet.${name}`;
            const switched = Boolean(port.access_vlan || port.trunk_vlans);

            if (port.access_vlan && port.trunk_vlans) report(`${where} is both access and trunk`);
            if (port.native_vlan && !port.trunk_vlans) report(`${where} has a native VLAN but is not a trunk`);
            if (switched && port.addresses?.length) report(`${where} is switched and routed at once`);

            if (port.in_lag && (switched || port.addresses)) {
                report(`${where}.in_lag is ${port.in_lag}, and the port states its own switching or addresses; the LAG holds them`);
            }

            DeviceChecks.frames(where, port, report);
        }
    }

    /** A MAC limit is a whole number above 0, and an ethertype filter lets at least one kind in, each once. */
    private static frames(where: string, settings: Switched, report: Report): void {
        const limit = settings.mac_limit;
        if (limit !== undefined && !(Number.isInteger(limit) && limit >= 1))
            report(`${where}.mac_limit ${limit} is not a whole number above 0`);

        const kinds = settings.ethertypes;
        if (kinds && !kinds.length) report(`${where}.ethertypes is empty, so it would drop every frame`);
        if (kinds && new Set(kinds).size !== kinds.length) report(`${where}.ethertypes names a kind twice`);
    }

    private static interfaces(device: Device, ports: readonly string[], report: Report, ip: Checker): void {
        const bridges = Object.entries(device.interfaces?.bridge ?? {});

        for (const { name, kind, settings } of Derive.interfaces(device)) {
            const where = `interfaces.${kind}.${name}`;
            if (ports.includes(name)) report(`${where} has the name of a port`);

            if (kind === "gre" || kind === "vxlan" || kind === "eoip") {
                const tunnel = settings as Extract<Interface, { remote_address: string }>;
                ip(where, tunnel.local_address);
                ip(where, tunnel.remote_address);
            }

            if (kind === "eoip") {
                const id = (settings as Extract<Interface, { tunnel_id: number }>).tunnel_id;
                if (!(Number.isInteger(id) && id >= 0 && id <= 65535))
                    report(`${where}.tunnel_id ${id} is not a whole number from 0 to 65535`);

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
                    for (const address of peer.allowed_addresses) {
                        if (!Address.isCidr(address)) report(`${where} peer ${peer.name}: '${address}' is not an address with a length`);
                    }
                }
            }
        }
    }

    private static routing(device: Device, report: Report, cidr: Checker, ip: Checker): void {
        const routing = device.routing;

        for (const route of routing?.static_routes ?? []) {
            const where = `routing.static_routes ${route.prefix}`;
            cidr("routing.static_routes", route.prefix);
            if (!route.next_hop && !route.interface && !route.blackhole) report(`${where} has no next hop`);
            if (route.next_hop) ip(where, route.next_hop);
            if (route.bfd && !route.next_hop) report(`${where} has bfd without next_hop, the address BFD watches`);
            if (route.vrf && Utils.otherTable(route.routing_table))
                report(`${where} has both vrf and routing_table; a route is in one of them`);
        }

        DeviceChecks.tables(device, report, cidr);

        const bgp = routing?.bgp;

        for (const prefix of bgp?.originated_prefixes ?? []) cidr("routing.bgp.originated_prefixes", prefix);

        for (const [name, neighbor] of Object.entries(bgp?.neighbors ?? {})) {
            const where = `routing.bgp.neighbors.${name}`;
            ip(where, neighbor.address);

            const group = neighbor.neighbor_group ? bgp?.neighbor_groups?.[neighbor.neighbor_group] : undefined;
            if (!(neighbor.remote_as ?? group?.remote_as)) report(`${where} has no remote_as`);

            const local = neighbor.local_address ?? group?.local_address;
            if (local && Address.family(local) !== Address.family(neighbor.address))
                report(`${where} local_address and address differ in family`);
        }

        for (const areaId of Object.keys(routing?.ospf?.areas ?? {})) {
            if (!/^\d+\.\d+\.\d+\.\d+$/.test(areaId)) report(`routing.ospf.areas '${areaId}' is not written as a dotted area ID`);
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
                const prefix = "if" in rule ? rule.if?.prefix : undefined;
                if (prefix) cidr(`routing.policies.${name}[${index}]`, prefix);
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
            // 536 is the MSS every IPv4 host takes (RFC 879); 65495 is the largest IP packet less 40 bytes of headers.
            if (rule.mss !== "path_mtu" && !(Number.isInteger(rule.mss) && rule.mss >= 536 && rule.mss <= 65495))
                report(`firewall.tcp_mss[${index}].mss ${rule.mss} is not "path_mtu" or a whole number from 536 to 65495`);
        });

        for (const { where, rules } of chains) {
            for (const rule of rules) {
                // The model holds one prefix a side; a list is taken as the language writes it.
                for (const address of [rule.if?.src, rule.if?.dst].flat()) {
                    if (address) cidr(where, address);
                }
            }
        }
    }

    private static services(device: Device, report: Report, cidr: Checker): void {
        for (const [name, server] of Object.entries(device.services?.dhcp_server ?? {})) {
            const where = `services.dhcp_server.${name}`;
            cidr(where, server.network);
            if (!Address.isCidr(server.network)) continue;

            const reserved = (server.reservations ?? []).map((reservation) => reservation.address);
            const addresses = [server.gateway, ...server.pool, ...reserved];

            for (const address of addresses) {
                if (!Address.contains(server.network, address)) report(`${where}: ${address} is outside ${server.network}`);
            }
        }

        // `management.allow` may be an address set's addresses, and a set holds an address alone too.
        const allow = device.management?.allow;
        if (Array.isArray(allow)) for (const prefix of allow) if (!Address.isValid(prefix)) cidr("management.allow", prefix);

        const snmp = device.monitoring?.snmp;
        if (snmp && !snmp.community && !snmp.users) report("monitoring.snmp is on with neither a community nor a user");
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
    }
}
