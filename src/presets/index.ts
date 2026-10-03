// Building blocks most networks write the same way: address lists, edge filters, a BGP import sanity policy, checks, and helpers for checks of your own. Each returns plain config to place where it belongs, so nothing here applies itself.

import { contains } from "../core/addr";
import type { Check, Finding } from "../core/define";
import type { AclRule, Device, FilterRule, PolicyRule, Prefix, TcpFlag } from "../schema";

/** IPv4 sources that never arrive from the internet: loopback, link-local and "this network", after RFC 6890. */
export const MARTIANS = ["127.0.0.0/8", "169.254.0.0/16", "0.0.0.0/8"] as const satisfies readonly Prefix[];

/** IPv4 private space, RFC 1918. */
export const PRIVATE_RANGES = ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"] as const satisfies readonly Prefix[];

/** Hardware ACL rules dropping traffic arriving on a VLAN from sources that cannot be there: your own space, martians, private ranges. One rule per source. */
export const antiSpoofing = <V extends string>(vlan: V, sources: readonly Prefix[]): AclRule<V>[] =>
    sources.map((src) => ({
        description: `${vlan}: drop source ${src}`,
        match: { vlan, src },
        action: "drop",
    }));

/** TCP flag combinations no legitimate packet carries: name, flags set, flags unset. */
const BAD_TCP_FLAGS = [
    ["FIN+SYN", ["fin", "syn"], []],
    ["SYN+RST", ["syn", "rst"], []],
    ["FIN+RST", ["fin", "rst"], []],
    ["FIN without ACK", ["fin"], ["ack"]],
    ["FIN+URG", ["fin", "urg"], []],
    ["Xmas scan", ["fin", "syn", "psh", "urg"], []],
] as const satisfies readonly (readonly [string, readonly TcpFlag[], readonly TcpFlag[]])[];

/** Firewall rules dropping packets with a TCP flag combination no legitimate packet carries, for a forward chain. */
export const badTcpFlags = (): FilterRule<never, never>[] =>
    BAD_TCP_FLAGS.map(([name, set, unset]) => ({
        description: `Bad flags ${name}`,
        match: { protocol: "tcp", tcp_flags: { set, unset } },
        action: "drop",
    }));

/** The prefix lengths a BGP import accepts. */
export type SanityLengths = {
    /** Shortest and longest IPv4 prefix accepted. /8 to /24 when absent. */
    ipv4?: { min: number; max: number };
    /** Shortest and longest IPv6 prefix accepted. /16 to /48 when absent. */
    ipv6?: { min: number; max: number };
};

/** Route policy rules rejecting what no neighbor should send: prefixes too short or too long for the global table, and RPKI invalid. Place it first in an import, or as a policy other imports call. */
export function bgpSanity(lengths: SanityLengths = {}): PolicyRule<never, never>[] {
    const ipv4 = lengths.ipv4 ?? { min: 8, max: 24 };
    const ipv6 = lengths.ipv6 ?? { min: 16, max: 48 };

    return [
        {
            description: `IPv4 shorter than /${ipv4.min}`,
            match: { family: "ipv4", prefix_length: { max: ipv4.min - 1 } },
            action: "reject",
        },
        { description: `IPv4 longer than /${ipv4.max}`, match: { family: "ipv4", prefix_length: { min: ipv4.max + 1 } }, action: "reject" },
        {
            description: `IPv6 shorter than /${ipv6.min}`,
            match: { family: "ipv6", prefix_length: { max: ipv6.min - 1 } },
            action: "reject",
        },
        { description: `IPv6 longer than /${ipv6.max}`, match: { family: "ipv6", prefix_length: { min: ipv6.max + 1 } }, action: "reject" },
        { description: "RPKI invalid", match: { rpki: "invalid" }, action: "reject" },
    ];
}

/** Each BGP neighbor's own policies, or its group's. */
export function neighborPolicies(device: Device) {
    const bgp = device.routing?.bgp;

    return Object.entries(bgp?.neighbors ?? {}).map(([name, neighbor]) => {
        const group = neighbor.group ? bgp?.groups?.[neighbor.group] : undefined;
        return { name, address: neighbor.address, import: neighbor.import ?? group?.import, export: neighbor.export ?? group?.export };
    });
}

/** The prefixes an export policy accepts by name. */
export function offered(device: Device, policy: string | undefined): string[] {
    const rules = policy ? (device.policies?.[policy] ?? []) : [];
    return rules.filter((rule) => rule.action === "accept" && rule.match?.prefix).map((rule) => rule.match!.prefix!);
}

/** Every BGP export ends in a reject that matches everything, so nothing leaves by accident. */
export const exportsEndInReject: Check = (devices) => {
    const findings: Finding[] = [];

    for (const device of devices) {
        for (const neighbor of neighborPolicies(device)) {
            const last = neighbor.export ? device.policies?.[neighbor.export]?.at(-1) : undefined;

            if (neighbor.export && (last?.action !== "reject" || last.match)) {
                findings.push({
                    level: "error",
                    device: device.name,
                    message: `${neighbor.name}: export ${neighbor.export} does not end in an unconditional reject`,
                });
            }
        }
    }

    return findings;
};

/** The VLANs a port carries, untagged or tagged. */
export const vlansOf = (port: { access_vlan?: string; trunk_vlans?: readonly string[] }): string[] =>
    [port.access_vlan, ...(port.trunk_vlans ?? [])].filter((vlan): vlan is string => vlan !== undefined);

/** Where traffic from outside, before anything filters it, may go. */
export type TrustBoundary = {
    /** VLANs carrying traffic straight from outside: transits, exchanges, an ISP handoff. */
    untrusted: readonly string[];
    /** VLANs that must not meet them on a port: customers, servers, management. */
    trusted: readonly string[];
    /** The devices that filter: the only ones that may give an untrusted VLAN an address, and the only ones a port carrying both may face. */
    routers: readonly string[];
};

/** A check: untrusted traffic reaches trusted VLANs only through a router. A port carrying both faces a router or is on one, and only a router gives an untrusted VLAN an address. */
export const trustBoundary =
    (boundary: TrustBoundary): Check =>
    (devices) => {
        const untrusted = new Set(boundary.untrusted);
        const trusted = new Set(boundary.trusted);
        const routers = new Set(boundary.routers);
        const findings: Finding[] = [];

        for (const device of devices) {
            const isRouter = routers.has(device.name);
            const ports = Object.entries(device.ports ?? {}).flatMap(([name, port]) => (port ? [{ name, port }] : []));

            // What carries VLANs: a port on its own, or a LAG, which faces whatever its members link to.
            const carriers = [
                ...ports
                    .filter(({ port }) => !port.lag)
                    .map(({ name, port }) => ({
                        what: `port ${name}`,
                        carried: vlansOf(port),
                        faces: port.link ? [port.link.device] : [],
                    })),
                ...Object.entries(device.interfaces ?? {}).flatMap(([name, iface]) =>
                    iface.type === "lag"
                        ? [
                              {
                                  what: `LAG ${name}`,
                                  carried: vlansOf(iface),
                                  faces: ports.filter(({ port }) => port.lag === name && port.link).map(({ port }) => port.link!.device),
                              },
                          ]
                        : []
                ),
            ];

            for (const { what, carried, faces } of carriers) {
                const mixes = carried.some((vlan) => untrusted.has(vlan)) && carried.some((vlan) => trusted.has(vlan));
                const facesRouter = isRouter || faces.some((name) => routers.has(name));

                if (mixes && !facesRouter) {
                    findings.push({
                        level: "error",
                        device: device.name,
                        message: `${what} carries an untrusted VLAN beside a trusted one and does not face a router`,
                    });
                }
            }

            if (isRouter) continue;

            for (const [name, iface] of Object.entries(device.interfaces ?? {})) {
                if (iface.type === "vlan" && untrusted.has(iface.vlan)) {
                    findings.push({
                        level: "error",
                        device: device.name,
                        message: `interface ${name} puts an address on untrusted VLAN ${iface.vlan}; only a router may`,
                    });
                }
            }
        }

        return findings;
    };

/** A GRE or VXLAN tunnel's local address is outside what the neighbors over it are offered, or their replies route back into the tunnel. */
export const tunnelsOutsideOffered: Check = (devices) => {
    const findings: Finding[] = [];

    for (const device of devices) {
        for (const [name, iface] of Object.entries(device.interfaces ?? {})) {
            if (iface.type !== "gre" && iface.type !== "vxlan") continue;

            const subnets = (iface.addresses ?? []).map((entry) => (typeof entry === "string" ? entry : entry.address));

            for (const neighbor of neighborPolicies(device)) {
                if (!subnets.some((subnet) => contains(subnet, neighbor.address))) continue;

                for (const prefix of offered(device, neighbor.export)) {
                    if (contains(prefix, iface.local)) {
                        findings.push({
                            level: "error",
                            device: device.name,
                            message: `${name} is sourced from ${iface.local}, inside ${prefix}, which ${neighbor.name} is offered`,
                        });
                    }
                }
            }
        }
    }

    return findings;
};
