// Rules every network has to satisfy, whatever its design. Types catch most of this at compile time; these run again at load, because config is data and may not come from TypeScript.

import { X509Certificate } from "node:crypto";
import { adapters } from "../adapters/devices";
import { portsOf } from "../adapters/devices/catalog";
import type { Device } from "../schema";
import { contains, familyOf, isAddress, isCidr } from "./addr";
import type { Finding, Network } from "./define";

type Report = (message: string) => void;

export function validate(network: Network): Finding[] {
    const findings: Finding[] = [];

    const seen = new Set<string>();

    for (const device of network.devices) {
        if (seen.has(device.name)) findings.push({ level: "error", device: device.name, message: "declared twice" });
        seen.add(device.name);
    }

    for (const device of network.devices) {
        const report: Report = (message) => findings.push({ level: "error", device: device.name, message });
        checkDevice(device, report);

        const adapter = adapters[device.platform];
        if (!adapter) report(`no adapter for platform ${device.platform}`);
        else for (const field of adapter.unsupported(device)) report(`${device.platform} cannot express ${field}`);
    }

    findings.push(...checkLinks(network.devices));
    for (const check of network.checks ?? []) findings.push(...check(network.devices));
    return findings;
}

/** Names a device declares, and helpers to report a reference to one it does not. */
class Names {
    readonly ports: string[];

    constructor(
        readonly device: Device,
        private readonly report: Report
    ) {
        let ports: string[] = [];

        try {
            ports = portsOf(device.platform, device.model);
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

function checkDevice(device: Device, report: Report): void {
    const names = new Names(device, report);
    const cidr: Checker = (where, value) => {
        if (!isCidr(value)) report(`${where}: '${value}' is not an address with a length`);
    };
    const ip: Checker = (where, value) => {
        if (!isAddress(value)) report(`${where}: '${value}' is not an address`);
    };

    if (!device.users?.[device.connection.user]) report(`connection user '${device.connection.user}' is not one of its users`);

    checkVlans(device, report);
    checkAddresses(device, report, cidr, ip);
    checkPorts(device, names, report);
    checkInterfaces(device, names, report, ip);
    checkRouting(device, names, report, cidr, ip);
    checkPolicies(device, names, report, cidr);
    checkFirewall(device, names, cidr);
    checkServices(device, names, report, cidr);
    checkCertificates(device, names, report);
}

function checkVlans(device: Device, report: Report): void {
    const ids = new Map<number, string>();

    for (const [name, vlan] of Object.entries(device.vlans ?? {})) {
        if (!Number.isInteger(vlan.id) || vlan.id < 1 || vlan.id > 4094) report(`VLAN ${name} id ${vlan.id} is outside 1-4094`);
        if (ids.has(vlan.id)) report(`VLANs ${ids.get(vlan.id)} and ${name} share id ${vlan.id}`);
        ids.set(vlan.id, name);
    }
}

/** Every address is valid, and no address sits on two interfaces. */
function checkAddresses(device: Device, report: Report, cidr: Checker, ip: Checker): void {
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
            if (holderOf.has(bare)) report(`${bare} is on both ${holderOf.get(bare)} and ${where}`);
            holderOf.set(bare, where);
        }

        for (const group of settings?.vrrp ?? []) {
            ip(`${where} VRRP ${group.id}`, group.address);
            if (group.id < 1 || group.id > 255) report(`${where} VRRP id ${group.id} is outside 1-255`);
        }
    }
}

function checkPorts(device: Device, names: Names, report: Report): void {
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

function checkInterfaces(device: Device, names: Names, report: Report, ip: Checker): void {
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

        if (iface.type === "wireguard") {
            for (const peer of iface.peers ?? []) {
                for (const address of peer.allowed_addresses) {
                    if (!isCidr(address)) report(`interface ${name} peer ${peer.name}: '${address}' is not an address with a length`);
                }
            }
        }
    }
}

function checkRouting(device: Device, names: Names, report: Report, cidr: Checker, ip: Checker): void {
    const routing = device.routing;
    const policies = device.policies ?? {};

    for (const route of routing?.static ?? []) {
        cidr("static route", route.prefix);
        if (!route.via && !route.interface && !route.blackhole) report(`static route ${route.prefix} has no next hop`);
        if (route.via) ip(`static route ${route.prefix}`, route.via);
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
        if (local && familyOf(local) !== familyOf(neighbor.address)) report(`neighbor ${name} local_address and address differ in family`);
    }

    for (const [areaId, area] of Object.entries(routing?.ospf?.areas ?? {})) {
        if (!/^\d+\.\d+\.\d+\.\d+$/.test(areaId)) report(`OSPF area '${areaId}' is not written as a dotted area ID`);
        for (const iface of Object.keys(area.interfaces)) names.expectInterface(`OSPF area ${areaId} interface`, iface);
    }
}

function checkPolicies(device: Device, names: Names, report: Report, cidr: Checker): void {
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

function checkFirewall(device: Device, names: Names, cidr: Checker): void {
    const firewall = device.firewall;
    const sets = firewall?.address_sets ?? {};

    for (const [name, members] of Object.entries(sets)) {
        for (const member of members) {
            if (!isAddress(member)) cidr(`address set ${name}`, member);
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

function checkServices(device: Device, names: Names, report: Report, cidr: Checker): void {
    for (const [name, server] of Object.entries(device.dhcp ?? {})) {
        names.expectInterface(`DHCP ${name} interface`, server.interface);
        cidr(`DHCP ${name}`, server.network);
        if (!isCidr(server.network)) continue;

        const reserved = (server.reservations ?? []).map((reservation) => reservation.address);
        const addresses = [server.gateway, ...server.pool, ...reserved];

        for (const address of addresses) {
            if (!contains(server.network, address)) report(`DHCP ${name}: ${address} is outside ${server.network}`);
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
    if (management?.snmp && !management.snmp.community && !management.snmp.users) report("SNMP is on with neither a community nor a user");
}

function checkCertificates(device: Device, names: Names, report: Report): void {
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

/** The VLAN ids a port carries, by how it carries them, so two ends can be compared across devices. */
function carried(device: Device, port: NonNullable<NonNullable<Device["ports"]>[string]>) {
    const id = (vlan: string | undefined) => (vlan ? device.vlans?.[vlan]?.id : undefined);
    return {
        access: id(port.access_vlan),
        native: id(port.native_vlan),
        trunk: (port.trunk_vlans ?? []).map(id).sort((a, b) => (a ?? 0) - (b ?? 0)),
    };
}

/** A link names a device and port that exist, the far end links back, and both ends carry the same VLANs the same way. */
function checkLinks(devices: readonly Device[]): Finding[] {
    const findings: Finding[] = [];
    const byName = new Map(devices.map((device) => [device.name, device]));

    for (const device of devices) {
        for (const [portName, port] of Object.entries(device.ports ?? {})) {
            const link = port?.link;
            if (!port || !link) continue;

            const report = (message: string) =>
                findings.push({
                    level: "error",
                    device: device.name,
                    message: `port ${portName} link: ${message}`,
                });

            const far = byName.get(link.device);
            if (!far) {
                report(`device ${link.device} is not in the network`);
                continue;
            }

            const farPort = far.ports?.[link.port];
            if (!farPort) {
                report(`${link.device} does not declare port ${link.port}`);
                continue;
            }

            const linksBack = farPort.link?.device === device.name && farPort.link.port === portName;
            if (!linksBack) report(`${link.device} ${link.port} does not link back to it`);

            const here = JSON.stringify(carried(device, port));
            const there = JSON.stringify(carried(far, farPort));
            if (here !== there) report(`carries ${here}, and ${link.device} ${link.port} carries ${there}`);
        }
    }

    return findings;
}
