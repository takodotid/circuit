// Rules every network has to satisfy, whatever its design. Types catch most of this at compile time; these run again at load, because config is data and may not come from TypeScript.

import { X509Certificate } from "node:crypto";
import { Platforms } from "../platforms";
import { Catalog } from "../platforms/catalog";
import type { Device } from "../schema";
import { Address } from "./address";
import { CrossChecks } from "./cross-checks";
import type { Finding, Network } from "./define";

type Report = (message: string) => void;

/** Names a device declares, and helpers to report a reference to one it does not. */
class Names {
    readonly ports: string[];

    constructor(
        readonly device: Device,
        private readonly report: Report
    ) {
        let ports: string[] = [];

        try {
            ports = Catalog.ports(device.platform, device.model);
        } catch (error) {
            report((error as Error).message);
        }

        this.ports = ports;
    }

    isInterface(name: string): boolean {
        return name in (this.device.interfaces ?? {}) || this.ports.includes(name);
    }

    /** Report `name` when it is set and not declared. */
    expect(what: string, name: string | undefined, declared: boolean): void {
        if (name !== undefined && !declared) this.report(`${what} '${name}' is not declared`);
    }

    expectInterface(what: string, name: string | undefined): void {
        this.expect(what, name, name !== undefined && this.isInterface(name));
    }
}

type Checker = (where: string, value: string) => void;

export class Validator {
    static run(network: Network): Finding[] {
        const findings: Finding[] = [];

        const seen = new Set<string>();

        for (const device of network.devices) {
            if (seen.has(device.name)) findings.push({ level: "error", device: device.name, message: "declared twice" });
            seen.add(device.name);
        }

        for (const device of network.devices) {
            const report: Report = (message) => findings.push({ level: "error", device: device.name, message });
            Validator.checkDevice(device, report);
            findings.push(...Validator.checkLimits(device));

            const adapter = Platforms.find(device.platform);
            if (!adapter) report(`no adapter for platform ${device.platform}`);
            else for (const field of adapter.unsupported(device)) report(`${device.platform} cannot express ${field}`);
        }

        findings.push(...CrossChecks.run(network.devices));
        for (const check of network.checks ?? []) findings.push(...check(network.devices));
        return findings;
    }

    private static checkDevice(device: Device, report: Report): void {
        const names = new Names(device, report);
        const cidr: Checker = (where, value) => {
            if (!Address.isCidr(value)) report(`${where}: '${value}' is not an address with a length`);
        };
        const ip: Checker = (where, value) => {
            if (!Address.isValid(value)) report(`${where}: '${value}' is not an address`);
        };

        if (!device.users?.[device.connection.user]) report(`connection user '${device.connection.user}' is not one of its users`);
        if (!device.connection.host && !device.connection.console)
            report("connection has neither a host nor a console to reach the device through");

        Validator.checkVlans(device, report);
        Validator.checkAddresses(device, report, cidr, ip);
        Validator.checkPorts(device, names, report);
        Validator.checkInterfaces(device, names, report, ip);
        Validator.checkRouting(device, names, report, cidr, ip);
        Validator.checkPolicies(device, names, report, cidr);
        Validator.checkFirewall(device, names, cidr);
        Validator.checkServices(device, names, report, cidr);
        Validator.checkCertificates(device, names, report);
    }

    /** What the model's hardware holds, from the catalog. A LAG with too many members is an error; too many switch rules is a warning, since the limit is only roughly known. */
    private static checkLimits(device: Device): Finding[] {
        const limits = Catalog.limits(device.platform, device.model);
        const findings: Finding[] = [];
        const report = (level: Finding["level"], message: string) => findings.push({ level, device: device.name, message });

        if (limits.lag_members !== undefined) {
            for (const [name, iface] of Object.entries(device.interfaces ?? {})) {
                if (iface.type !== "lag") continue;

                const members = Object.values(device.ports ?? {}).filter((port) => port?.lag === name).length;
                if (members > limits.lag_members) {
                    report("error", `LAG ${name} has ${members} members; ${device.model} holds at most ${limits.lag_members}`);
                }
            }
        }

        if (limits.switch_rules === undefined && limits.switch_port_ranges === undefined) return findings;

        const rules = Platforms.find(device.platform)?.switchRules?.(device);
        if (!rules) return findings;

        const after = "A rule it cannot hold is invalid, and so is every rule after it";

        if (limits.switch_rules !== undefined && rules.count > limits.switch_rules) {
            report("warning", `ACLs make ${rules.count} switch rules; a ${device.model} held about ${limits.switch_rules}. ${after}`);
        }

        if (limits.switch_port_ranges !== undefined && rules.ranges > limits.switch_port_ranges) {
            report(
                "warning",
                `ACLs use ${rules.ranges} distinct port ranges; a ${device.model} held ${limits.switch_port_ranges}. ${after}`
            );
        }

        return findings;
    }

    private static checkVlans(device: Device, report: Report): void {
        const ids = new Map<number, string>();

        for (const [name, vlan] of Object.entries(device.vlans ?? {})) {
            if (!Number.isInteger(vlan.id) || vlan.id < 1 || vlan.id > 4094) report(`VLAN ${name} id ${vlan.id} is outside 1-4094`);
            if (ids.has(vlan.id)) report(`VLANs ${ids.get(vlan.id)} and ${name} share id ${vlan.id}`);
            ids.set(vlan.id, name);
        }
    }

    /** Every address is valid, and no address sits on two interfaces of one routing table. Two VRFs may hold the same address. */
    private static checkAddresses(device: Device, report: Report, cidr: Checker, ip: Checker): void {
        const holderOf = new Map<string, string>();
        const holders = [
            ...Object.entries(device.ports ?? {}).map(([name, settings]) => ({ where: `port ${name}`, settings })),
            ...Object.entries(device.interfaces ?? {}).map(([name, settings]) => ({ where: `interface ${name}`, settings })),
        ];

        for (const { where, settings } of holders) {
            for (const entry of settings?.addresses ?? []) {
                const address = typeof entry === "string" ? entry : entry.address;
                cidr(where, address);
                if (typeof entry !== "string") ip(where, entry.peer);

                const bare = address.split("/")[0]!;
                const key = `${settings?.vrf ?? ""} ${bare}`;
                if (holderOf.has(key)) report(`${bare} is on both ${holderOf.get(key)} and ${where}`);
                holderOf.set(key, where);
            }

            for (const group of settings?.vrrp ?? []) {
                ip(`${where} VRRP ${group.id}`, group.address);
                if (group.id < 1 || group.id > 255) report(`${where} VRRP id ${group.id} is outside 1-255`);
            }
        }
    }

    private static checkPorts(device: Device, names: Names, report: Report): void {
        const vlans = device.vlans ?? {};

        for (const [name, port] of Object.entries(device.ports ?? {})) {
            if (!port) continue;

            const switched = Boolean(port.access_vlan || port.trunk_vlans);

            if (!names.ports.includes(name)) report(`port ${name} does not exist on ${device.model}`);
            if (port.access_vlan && port.trunk_vlans) report(`port ${name} is both access and trunk`);
            if (port.native_vlan && !port.trunk_vlans) report(`port ${name} has a native VLAN but is not a trunk`);
            if (switched && port.addresses?.length) report(`port ${name} is switched and routed at once`);

            if (port.lag && (switched || port.addresses)) {
                report(`port ${name} is in a LAG and states its own switching or addresses; the LAG holds them`);
            }

            for (const vlan of [port.access_vlan, port.native_vlan, ...(port.trunk_vlans ?? [])]) {
                names.expect(`port ${name} VLAN`, vlan, vlan === undefined || vlan in vlans);
            }

            names.expect(`port ${name} ACL`, port.acl, port.acl !== undefined && port.acl in (device.acls ?? {}));
            names.expect(`port ${name} LAG`, port.lag, port.lag !== undefined && device.interfaces?.[port.lag]?.type === "lag");
            names.expect(`port ${name} VRF`, port.vrf, port.vrf !== undefined && port.vrf in (device.vrfs ?? {}));
        }
    }

    private static checkInterfaces(device: Device, names: Names, report: Report, ip: Checker): void {
        const vlans = device.vlans ?? {};

        for (const [name, iface] of Object.entries(device.interfaces ?? {})) {
            if (names.ports.includes(name)) report(`interface ${name} has the name of a port`);
            names.expect(`interface ${name} VRF`, iface.vrf, iface.vrf !== undefined && iface.vrf in (device.vrfs ?? {}));

            if (iface.type === "vlan") names.expect(`interface ${name} VLAN`, iface.vlan, iface.vlan in vlans);
            if (iface.type === "gre" || iface.type === "vxlan") {
                ip(`interface ${name}`, iface.local);
                ip(`interface ${name}`, iface.remote);
            }

            if (iface.type === "lag") {
                const members = Object.values(device.ports ?? {}).filter((port) => port?.lag === name);
                if (!members.length) report(`LAG ${name} has no member ports`);
            }

            if (iface.type === "bridge") {
                if (iface.members.length < 2) report(`bridge ${name} joins fewer than two interfaces`);

                for (const member of iface.members) {
                    const joined = device.interfaces?.[member];
                    if (joined?.type !== "vlan") report(`bridge ${name}: member ${member} is not a VLAN interface`);
                    else if (joined.addresses?.length) report(`bridge ${name}: member ${member} has an address of its own`);

                    const others = Object.entries(device.interfaces ?? {}).filter(
                        ([other, settings]) => other !== name && settings.type === "bridge" && settings.members.includes(member)
                    );
                    if (others.length) report(`bridge ${name}: member ${member} is also in bridge ${others[0]![0]}`);
                }
            }

            if (iface.type === "wireguard") {
                for (const peer of iface.peers ?? []) {
                    for (const address of peer.allowed_addresses) {
                        if (!Address.isCidr(address))
                            report(`interface ${name} peer ${peer.name}: '${address}' is not an address with a length`);
                    }
                }
            }
        }
    }

    private static checkRouting(device: Device, names: Names, report: Report, cidr: Checker, ip: Checker): void {
        const routing = device.routing;
        const policies = device.policies ?? {};

        for (const route of routing?.static ?? []) {
            cidr("static route", route.prefix);
            if (!route.via && !route.interface && !route.blackhole) report(`static route ${route.prefix} has no next hop`);
            if (route.via) ip(`static route ${route.prefix}`, route.via);
            if (route.bfd && !route.via) report(`static route ${route.prefix} has bfd without via, the address BFD watches`);
            names.expectInterface(`static route ${route.prefix} interface`, route.interface);
            names.expect(`static route ${route.prefix} VRF`, route.vrf, route.vrf !== undefined && route.vrf in (device.vrfs ?? {}));
        }

        const bgp = routing?.bgp;
        const isPolicy = (policy: string | undefined) => policy !== undefined && policy in policies;

        for (const prefix of bgp?.networks ?? []) cidr("BGP network", prefix);

        for (const [name, group] of Object.entries(bgp?.groups ?? {})) {
            for (const policy of [group.import, group.export]) {
                names.expect(`BGP group ${name} policy`, policy, isPolicy(policy));
            }
        }

        for (const [name, neighbor] of Object.entries(bgp?.neighbors ?? {})) {
            ip(`neighbor ${name}`, neighbor.address);

            const group = neighbor.group ? bgp?.groups?.[neighbor.group] : undefined;
            names.expect(`neighbor ${name} group`, neighbor.group, group !== undefined);

            if (!(neighbor.remote_as ?? group?.remote_as)) report(`neighbor ${name} has no remote_as`);

            for (const policy of [neighbor.import, neighbor.export]) {
                names.expect(`neighbor ${name} policy`, policy, isPolicy(policy));
            }

            const local = neighbor.local_address ?? group?.local_address;
            if (local && Address.family(local) !== Address.family(neighbor.address))
                report(`neighbor ${name} local_address and address differ in family`);
        }

        for (const [areaId, area] of Object.entries(routing?.ospf?.areas ?? {})) {
            if (!/^\d+\.\d+\.\d+\.\d+$/.test(areaId)) report(`OSPF area '${areaId}' is not written as a dotted area ID`);
            for (const iface of Object.keys(area.interfaces)) names.expectInterface(`OSPF area ${areaId} interface`, iface);
        }
    }

    private static checkPolicies(device: Device, names: Names, report: Report, cidr: Checker): void {
        const policies = device.policies ?? {};
        const sets = device.prefix_sets ?? {};

        for (const [name, rules] of Object.entries(policies)) {
            for (const rule of rules) {
                names.expect(`policy ${name} call`, rule.call, rule.call !== undefined && rule.call in policies);
                const set = rule.match?.prefix_set;
                names.expect(`policy ${name} prefix set`, set, set !== undefined && set in sets);
                if (rule.match?.prefix) cidr(`policy ${name}`, rule.match.prefix);
            }
        }

        // A policy that calls itself, directly or not, never finishes.
        const visit = (policy: string, path: string[]): void => {
            if (path.includes(policy)) return report(`policy ${[...path, policy].join(" -> ")} calls itself`);

            for (const rule of policies[policy] ?? []) if (rule.call) visit(rule.call, [...path, policy]);
        };
        for (const policy of Object.keys(policies)) visit(policy, []);
    }

    private static checkFirewall(device: Device, names: Names, cidr: Checker): void {
        const firewall = device.firewall;
        const sets = firewall?.address_sets ?? {};

        for (const [name, members] of Object.entries(sets)) {
            for (const member of members) {
                if (!Address.isValid(member)) cidr(`address set ${name}`, member);
            }
        }

        const filterChains = [firewall?.filter?.input, firewall?.filter?.forward, firewall?.filter?.output];
        const filterRules = filterChains.flatMap((chain) => chain?.rules ?? []);
        const natRules = [...(firewall?.nat?.source ?? []), ...(firewall?.nat?.destination ?? [])];

        for (const rule of [...filterRules, ...natRules]) {
            const match = rule.match;
            if (!match) continue;

            for (const set of [match.src_set, match.dst_set]) {
                names.expect("address set", set, set !== undefined && set in sets);
            }

            for (const iface of [match.in_interface, match.out_interface]) names.expectInterface("interface", iface);

            for (const address of [match.src, match.dst]) {
                if (address) cidr("firewall rule", address);
            }
        }
    }

    private static checkServices(device: Device, names: Names, report: Report, cidr: Checker): void {
        for (const [name, server] of Object.entries(device.dhcp ?? {})) {
            names.expectInterface(`DHCP ${name} interface`, server.interface);
            cidr(`DHCP ${name}`, server.network);
            if (!Address.isCidr(server.network)) continue;

            const reserved = (server.reservations ?? []).map((reservation) => reservation.address);
            const addresses = [server.gateway, ...server.pool, ...reserved];

            for (const address of addresses) {
                if (!Address.contains(server.network, address)) report(`DHCP ${name}: ${address} is outside ${server.network}`);
            }
        }

        for (const [name, relay] of Object.entries(device.dhcp_relay ?? {})) {
            names.expectInterface(`DHCP relay ${name} interface`, relay.interface);
        }

        for (const iface of device.flow_export?.interfaces ?? []) names.expectInterface("flow export interface", iface);

        const lldp = device.lldp;
        if (lldp && lldp !== true) for (const iface of lldp.interfaces) names.expectInterface("LLDP interface", iface);

        const management = device.management;
        for (const iface of management?.native?.interfaces ?? []) names.expectInterface("native management interface", iface);
        for (const prefix of management?.allow ?? []) cidr("management allow", prefix);
        if (management?.snmp && !management.snmp.community && !management.snmp.users)
            report("SNMP is on with neither a community nor a user");
    }

    private static checkCertificates(device: Device, names: Names, report: Report): void {
        const certificates = device.certificates ?? {};

        for (const [name, certificate] of Object.entries(certificates)) {
            try {
                new X509Certificate(certificate.certificate);
            } catch {
                report(`certificate ${name} is not a PEM certificate`);
            }
        }

        for (const service of ["https", "api_tls"] as const) {
            const name = device.management?.[service]?.certificate;
            names.expect(`${service} certificate`, name, name !== undefined && name in certificates);

            if (name && certificates[name] && !certificates[name].private_key) {
                report(`${service} certificate ${name} has no private key to serve with`);
            }
        }
    }
}
