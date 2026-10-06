// Building blocks most networks write the same way: address lists, edge filters, a BGP import sanity policy, checks, and helpers for checks of your own. Each returns plain config to place where it belongs, so nothing here applies itself.

import { contains } from "../core/addr";
import type { Check, Community, Finding } from "../core/define";
import type { AclRule, Device, FilterRule, IP, PolicyRule, Port, Prefix, TcpFlag } from "../schema";

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

/** Each BGP neighbor's own policies and role, or its group's. */
export function neighborPolicies(device: Device) {
    const bgp = device.routing?.bgp;

    return Object.entries(bgp?.neighbors ?? {}).map(([name, neighbor]) => {
        const group = neighbor.group ? bgp?.groups?.[neighbor.group] : undefined;

        return {
            name,
            address: neighbor.address,
            role: neighbor.role ?? group?.role,
            import: neighbor.import ?? group?.import,
            export: neighbor.export ?? group?.export,
        };
    });
}

/** The prefixes an export policy accepts by name. */
export function offered(device: Device, policy: string | undefined): string[] {
    const rules = policy ? (device.policies?.[policy] ?? []) : [];
    return rules.filter((rule) => rule.action === "accept" && rule.match?.prefix).map((rule) => rule.match!.prefix!);
}

/**
 * Every BGP export ends in a reject that matches everything, so nothing leaves by accident. An export to a neighbor whose `role` is `customer` is left out: sending a customer everything you know is what it pays for, and cannot leak a route to the rest of the internet.
 */
export const exportsEndInReject: Check = (devices) => {
    const findings: Finding[] = [];

    for (const device of devices) {
        for (const neighbor of neighborPolicies(device)) {
            if (neighbor.role === "customer") continue;

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

/** Where traffic from outside, before anything filters it, may go. Every VLAN not listed as untrusted is trusted, so a VLAN added later is protected without being listed. */
export type TrustBoundary = {
    /** VLANs carrying traffic straight from outside: transits, exchanges, an ISP handoff. */
    untrusted: readonly string[];
    /** The devices that filter: the only ones that may give an untrusted VLAN an address, and the only ones a port carrying both kinds may face. */
    routers: readonly string[];
};

/** A check: traffic from outside reaches your own VLANs only through a router. A port or LAG carrying an untrusted VLAN beside any other is on a router or faces one, and only a router gives an untrusted VLAN an address. */
export const trustBoundary =
    (boundary: TrustBoundary): Check =>
    (devices) => {
        const untrusted = new Set(boundary.untrusted);
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
                const mixes = carried.some((vlan) => untrusted.has(vlan)) && carried.some((vlan) => !untrusted.has(vlan));
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

/**
 * A BGP community scheme of large communities, `asn:function:parameter`, in the style of RFC 8195. Each field names the function number your network uses for it; leave out what your network does not offer.
 */
export type CommunityScheme<Class extends string = string> = {
    /** Your AS. It is the first part of every community. */
    asn: number;
    /** Set on import: the kind of neighbor a route came from, `asn:function:class`. */
    learned_from?: { function: number; classes: Readonly<Record<Class, number>> };
    /** Set on import: the site a route was learned at, `asn:function:site`. `sites` names the sites, for the catalogue. */
    learned_at?: { function: number; sites?: Readonly<Record<number, string>> };
    /** Set on import: the AS a route was learned from, `asn:function:asn`. */
    learned_from_as?: number;
    /** A neighbor asks: do not announce the route to an AS, `asn:function:asn`, or to anyone, `asn:function:0`. */
    do_not_announce?: Request<Class> & { function: number };
    /** A neighbor asks: prepend toward an AS once, twice or three times, `asn:function:asn`. */
    prepend?: Request<Class> & { once?: number; twice?: number; three_times?: number };
    /** A neighbor asks: drop traffic to the route in your network, before it reaches them, `asn:function:0`. */
    blackhole?: Request<Class> & { function: number };
};

/** Something a neighbor can ask you for, and who may. */
type Request<Class extends string> = {
    /** The classes allowed to ask for it, from `learned_from.classes`. From anyone else, the request is removed when the route comes in. */
    trusted: readonly NoInfer<Class>[];
};

const PREPENDS = [
    ["once", 1],
    ["twice", 2],
    ["three_times", 3],
] as const;

const article = (word: string) => (/^[aeiou]/i.test(word) ? `an ${word}` : `a ${word}`);

/**
 * Policy rules and a catalogue from one community scheme, so the communities your routers set, the ones they act on, and the ones you publish never disagree.
 *
 * - `tag(neighborClass, neighborAs, { site })`: a rule for an import policy. It removes your communities a neighbor set, then adds where the route was learned. A neighbor keeps the requests its class is trusted with. `site` is needed when the scheme has `learned_at`.
 * - `actions(neighborAs, { blackhole })`: rules for an export policy toward one neighbor. They act on a customer's action communities, then remove all of yours. Place them before the rules that accept. A blackholed route goes no further, unless `blackhole` names the neighbor's own blackhole community: then it is passed on with it, so the neighbor drops the traffic too.
 * - `blackhole(neighborClass, prefixSet)`: a rule for the import policy of a neighbor trusted with blackholes, before anything that rejects long prefixes. It takes a route the neighbor asked to blackhole, but only inside `prefixSet`, its own space, and drops traffic to it here.
 * - `catalogue`: every community, for `communities` in `defineNetwork`.
 */
export function communityScheme<const Class extends string>(scheme: CommunityScheme<Class>) {
    const { asn } = scheme;
    const community = (fn: number, parameter: number | string) => `${asn}:${fn}:${parameter}`;
    const ours = { standard: [`${asn}:*`], large: [`${asn}:*:*`] };

    const information = [scheme.learned_from?.function, scheme.learned_at?.function, scheme.learned_from_as].filter(
        (fn): fn is number => fn !== undefined
    );

    // Each request's function numbers, and who may make it.
    const requests = [
        { functions: [scheme.do_not_announce?.function], trusted: scheme.do_not_announce?.trusted },
        { functions: PREPENDS.map(([name]) => scheme.prepend?.[name]), trusted: scheme.prepend?.trusted },
        { functions: [scheme.blackhole?.function], trusted: scheme.blackhole?.trusted },
    ].map(({ functions, trusted }) => ({ functions: functions.filter((fn): fn is number => fn !== undefined), trusted: trusted ?? [] }));

    const tag = (neighborClass: Class, neighborAs: number, options: { site?: number } = {}): PolicyRule<never, never> => {
        const { site } = options;
        const untrusted = requests.filter((request) => !request.trusted.includes(neighborClass)).flatMap((request) => request.functions);
        const trustedForAny = requests.some((request) => request.functions.length && request.trusted.includes(neighborClass));
        if (scheme.learned_at && site === undefined)
            throw new Error(`communityScheme: tag for AS${neighborAs} needs a site, for learned_at`);

        return {
            description: `Learned from AS${neighborAs}`,
            set: {
                remove_communities: ours.standard,
                // A neighbor trusted with nothing loses every community of ours it set. One trusted with some requests keeps those, and loses the rest.
                remove_large_communities: trustedForAny ? [...information, ...untrusted].map((fn) => community(fn, "*")) : ours.large,
                add_large_communities: [
                    ...(scheme.learned_from ? [community(scheme.learned_from.function, scheme.learned_from.classes[neighborClass])] : []),
                    ...(scheme.learned_at ? [community(scheme.learned_at.function, site!)] : []),
                    ...(scheme.learned_from_as !== undefined ? [community(scheme.learned_from_as, neighborAs)] : []),
                ],
            },
        };
    };

    const blackhole = <S extends string>(neighborClass: Class, prefixSet: S): PolicyRule<never, S> => {
        if (scheme.blackhole === undefined) throw new Error("communityScheme: blackhole needs a function number in the scheme");
        if (!scheme.blackhole.trusted.includes(neighborClass))
            throw new Error(`communityScheme: ${neighborClass} is not trusted to ask for a blackhole`);

        return {
            description: "Blackhole, asked by the neighbor",
            match: { large_community: community(scheme.blackhole.function, 0), prefix_set: prefixSet },
            set: { blackhole: true },
            action: "accept",
        };
    };

    const actions = (neighborAs: number, options: { blackhole?: string } = {}): PolicyRule<never, never>[] => [
        ...(scheme.blackhole !== undefined && !options.blackhole
            ? [
                  {
                      description: "Blackholed here, never announced",
                      match: { large_community: community(scheme.blackhole.function, 0) },
                      action: "reject" as const,
                  },
              ]
            : []),
        ...(scheme.do_not_announce !== undefined
            ? [
                  {
                      description: "Asked not to be announced anywhere",
                      match: { large_community: community(scheme.do_not_announce.function, 0) },
                      action: "reject" as const,
                  },
                  {
                      description: `Asked not to be announced to AS${neighborAs}`,
                      match: { large_community: community(scheme.do_not_announce.function, neighborAs) },
                      action: "reject" as const,
                  },
              ]
            : []),
        ...(scheme.blackhole !== undefined && options.blackhole
            ? [
                  {
                      description: `Blackhole passed on to AS${neighborAs}`,
                      match: { large_community: community(scheme.blackhole.function, 0) },
                      set: {
                          remove_communities: ours.standard,
                          remove_large_communities: ours.large,
                          add_communities: [options.blackhole],
                      },
                      action: "accept" as const,
                  },
              ]
            : []),
        ...PREPENDS.flatMap(([name, times]) => {
            const fn = scheme.prepend?.[name];
            if (fn === undefined) return [];

            return [
                {
                    description: `Asked to prepend ${name.replace("_", " ")} to AS${neighborAs}`,
                    match: { large_community: community(fn, neighborAs) },
                    set: { prepend: times },
                },
            ];
        }),
        {
            description: "Our communities stay inside our network",
            set: { remove_communities: ours.standard, remove_large_communities: ours.large },
        },
    ];

    const catalogue: Community[] = [
        ...Object.entries<number>(scheme.learned_from?.classes ?? {}).map(([name, value]) => ({
            community: community(scheme.learned_from!.function, value),
            description: `Learned from ${article(name)}`,
        })),
        ...(scheme.learned_at
            ? [
                  ...Object.entries(scheme.learned_at.sites ?? {}).map(([site, name]) => ({
                      community: community(scheme.learned_at!.function, site),
                      description: `Learned in ${name}`,
                  })),
                  { community: community(scheme.learned_at.function, "nnn"), description: "Learned at site $0" },
              ]
            : []),
        ...(scheme.learned_from_as !== undefined
            ? [{ community: community(scheme.learned_from_as, "nnn"), description: "Learned from AS$0" }]
            : []),
        ...(scheme.do_not_announce !== undefined
            ? [
                  { community: community(scheme.do_not_announce.function, 0), description: "Do not announce to anyone" },
                  { community: community(scheme.do_not_announce.function, "nnn"), description: "Do not announce to AS$0" },
              ]
            : []),
        ...PREPENDS.flatMap(([name]) => {
            const fn = scheme.prepend?.[name];
            return fn === undefined ? [] : [{ community: community(fn, "nnn"), description: `Prepend ${name.replace("_", " ")} to AS$0` }];
        }),
        ...(scheme.blackhole !== undefined
            ? [{ community: community(scheme.blackhole.function, 0), description: `Blackhole: dropped in AS${asn}, not announced further` }]
            : []),
    ];

    return { community, tag, actions, blackhole, catalogue };
}

/** A member of an internet exchange: a network with a port on the fabric and an address on the peering LAN. */
export type ExchangeMember = {
    /** Lowercase, and never reused. */
    name: string;
    asn: number;
    /** The member's port on each fabric switch, by switch name. */
    ports: Readonly<Record<string, string>>;
    /** Its addresses on the peering LAN. The route servers peer with these. */
    ipv4?: IP;
    ipv6?: IP;
};

/** An internet exchange's peering LAN, as its fabric carries it. */
export type InternetExchange<V extends string> = {
    /** The peering VLAN, by the name the fabric switches give it. */
    vlan: V;
    /** The peering LAN's subnets. */
    lan: { ipv4?: Prefix; ipv6?: Prefix };
    /** Addresses on the peering LAN no member may take, such as the route servers'. */
    reserved?: readonly IP[];
    /** How much broadcast, multicast and unknown unicast a member port lets through, in percent of its speed. 1 when absent. */
    storm_percent?: number;
};

/**
 * Member ports and a check for an internet exchange's fabric.
 *
 * - `ports(device)`: every member's port on one switch. A member port is in the peering VLAN and nothing else, takes no part in spanning tree or LLDP, and lets only a trickle of broadcast, multicast and unknown unicast through.
 * - `check`: members never share a name, an AS or an address; every address is inside the peering LAN and not reserved; every member port carries the peering VLAN alone.
 */
export function internetExchange<const V extends string>(exchange: InternetExchange<V>, members: readonly ExchangeMember[]) {
    const percent = exchange.storm_percent ?? 1;

    const ports = (device: string) => {
        const result: Record<string, Port<V, string, string, string>> = {};

        for (const member of members) {
            const port = member.ports[device];
            if (!port) continue;

            result[port] = {
                description: `${member.name}, AS${member.asn}`,
                access_vlan: exchange.vlan,
                stp: false,
                lldp: false,
                storm_control: { broadcast: { percent }, multicast: { percent }, unknown_unicast: { percent } },
            };
        }

        return result;
    };

    const check: Check = (devices) => {
        const findings: Finding[] = [];
        const error = (message: string, device?: string) => findings.push({ level: "error", ...(device ? { device } : {}), message });
        const taken = new Map<string, string>((exchange.reserved ?? []).map((address) => [address, "reserved"]));

        members.forEach((member, index) => {
            for (const other of members.slice(index + 1)) {
                if (other.name === member.name) error(`member ${member.name} is declared twice`);
                if (other.asn === member.asn) error(`members ${member.name} and ${other.name} share AS${member.asn}`);
            }

            for (const [address, lan] of [
                [member.ipv4, exchange.lan.ipv4],
                [member.ipv6, exchange.lan.ipv6],
            ] as const) {
                if (!address) continue;
                if (!lan || !contains(lan, address)) error(`${address} of ${member.name} is outside the peering LAN`);

                const holder = taken.get(address);
                if (holder) error(`${address} of ${member.name} is already ${holder === "reserved" ? "reserved" : `${holder}'s`}`);
                taken.set(address, member.name);
            }

            for (const [deviceName, portName] of Object.entries(member.ports)) {
                const device = devices.find((candidate) => candidate.name === deviceName);
                const port = device?.ports?.[portName as keyof typeof device.ports];
                const carried = port ? vlansOf(port) : [];

                if (carried.length !== 1 || carried[0] !== exchange.vlan) {
                    error(`port ${portName} of ${member.name} does not carry the peering VLAN alone`, deviceName);
                }
            }
        });

        return findings;
    };

    return { ports, check };
}
