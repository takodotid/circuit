import { Address } from "../core/address";
import type {
    Exchange as ExchangeLan,
    Family,
    FilterRule,
    Gre,
    InterfaceAddress,
    IP,
    LargeCommunity,
    Neighbor,
    NeighborSettings,
    PolicyRule,
    Port,
    Prefix,
    Secret,
    StandardCommunity,
    Vlan,
    VlanInterface,
} from "../schema";
import { Bgp, type Announced } from "./bgp";

/** One network we exchange routes with: a transit we buy, an exchange's route servers, or a peer. */
export type Upstream = {
    /** Its name as people write it, for descriptions: `Transit A`. The key when absent. */
    name?: string;
    asn: number;
    /** What it is to us: `provider` for a transit, `rs` for an exchange's route servers, `peer` for a direct session. */
    role: "provider" | "rs" | "peer";
    /** Where it lands on our side: a VLAN, our addresses on it, and the switch port it arrives on. A peer over a tunnel, or over an exchange's VLAN, has none. */
    handoff?: {
        /** The VLAN's ID. */
        vlan: number;
        /** It sends its VLAN tagged: its port gets a native VLAN of its own with this ID, which nothing else is in. Untagged when absent. */
        native?: number;
        /** Its number in names with `{number}`, such as `core-ipt01-transita`. Written here, so removing another upstream renumbers nothing. */
        number?: number;
        /** Our addresses on it. `{ address, peer }` for a point-to-point address whose far end is outside its own prefix. */
        addresses: readonly (InterfaceAddress | { address: InterfaceAddress; peer: IP })[];
        /** The switch port it arrives on. */
        port?: { device: string; port: string; storm_control?: Port<string, string, string, string>["storm_control"] };
        /** An exchange's LAN, for `circuit peeringdb`. */
        exchange?: ExchangeLan;
    };
    /** A GRE tunnel to it. `number` is its number in names with `{number}`. */
    tunnel?: { local: IP; remote: IP; addresses: readonly InterfaceAddress[]; mtu?: number; number?: number };
    /** Our BGP sessions with it, by name: its address, and ours when it is not the interface's. */
    sessions: Readonly<Record<string, { address: IP; local_address?: IP }>>;
    /** The sessions are more than one hop away, from this address of ours. They share a group. */
    multihop?: { local_address: IP; families?: readonly Family[]; password?: Secret };
    /** The most prefixes a session may send, by its family: about twice what it sends. Over it, the session closes until it is cleared. */
    limits?: { ipv4?: number; ipv6?: number };
    /** What we take. Nothing when absent. */
    import?: {
        /** Its default route, at this preference. */
        default?: { local_pref?: number; description?: string };
        /** Its routes, through `Bgp.learn`: the `before` rules, sanity, this preference, the tag. Only the default when absent. */
        learn?: { local_pref?: number; before?: readonly PolicyRule<never, never>[] };
    };
    /** Rules of yours in its export, between the community actions and what we announce, such as a prepend. */
    export?: readonly PolicyRule<never, never>[];
    /** What we announce to it. Everything else is rejected. */
    announce: readonly Announced[];
    /** Drop RFC 1918 sources arriving from it. `privateDrops()` lists the VLANs. */
    drop_private?: true;
};

/** Upstreams by key. The key names everything built from it. */
export type UpstreamCatalog = Readonly<Record<string, Upstream>>;

/** A name made from an upstream: `{key}` is its key, `{KEY}` the key in capitals, `{number}` its `handoff.number` or `tunnel.number`. */
type Pattern = string;
/** A pattern for every upstream, or one per role. A role left out takes the default. */
type ByRole = Pattern | { readonly provider?: Pattern; readonly rs?: Pattern; readonly peer?: Pattern };

/** How the names built from each upstream are made. Each one left out takes its default. */
export type UpstreamNames = {
    /** The VLAN a handoff is on. `{key}` when absent. */
    vlan?: ByRole;
    /** The native VLAN of a handoff sent tagged. `{key}-native` when absent. */
    native?: Pattern;
    /** The router's interface: per role, and `tunnel` for one reached over a tunnel. `{key}` when absent. */
    interface?: Pattern | { readonly provider?: Pattern; readonly rs?: Pattern; readonly peer?: Pattern; readonly tunnel?: Pattern };
    /** The import policy. `{KEY}-IN` when absent. */
    import?: Pattern;
    /** The export policy. `{KEY}-OUT` when absent. */
    export?: Pattern;
    /** The BGP group of an exchange's route servers or of multihop sessions. `{key}` when absent. */
    group?: Pattern;
    /** The description of a handoff's switch port. Its `name` when absent. No device names it, so it may be any function. */
    port?: (key: string, upstream: Upstream) => string;
};

/** How each upstream's policies are written: shared by every upstream of a catalog. */
export type UpstreamPolicies<P extends string> = {
    /** A policy holding `Bgp.sanity()` that each import calls. The sanity rules are written in each import when absent. */
    sanity?: P;
    /** Where a route came from, by upstream: a community or a rule, such as `communityScheme(...).tag(...)`. Nothing is tagged when absent. */
    tag?: (key: string, upstream: Upstream) => StandardCommunity | LargeCommunity | PolicyRule<never, never>;
    /** Rules first in each export, such as `communityScheme(...).actions(upstream.asn)`. */
    actions?: (key: string, upstream: Upstream) => readonly PolicyRule<never, never>[];
    /** The source address for routes of its family, one per family. */
    sources?: readonly IP[];
};

/** The names a device can refer to, and their patterns when the project gives none. */
const DEFAULTS = {
    vlan: "{key}",
    native: "{key}-native",
    interface: "{key}",
    import: "{KEY}-IN",
    export: "{KEY}-OUT",
    group: "{key}",
} as const;

type Defaults = typeof DEFAULTS;
type Field = keyof Defaults;

type Key<C> = keyof C & string;
/** The upstreams that land on a VLAN of ours. */
type Landed<C> = { [K in Key<C>]: C[K] extends { handoff: object } ? K : never }[Key<C>];
/** The upstreams that send their VLAN tagged. */
type Tagged<C> = { [K in Key<C>]: C[K] extends { handoff: { native: number } } ? K : never }[Key<C>];
/** The upstreams reached over a tunnel. */
type Tunneled<C> = { [K in Key<C>]: C[K] extends { tunnel: object } ? K : never }[Key<C>];
/** The upstreams whose sessions share a group: an exchange's route servers, or multihop sessions. */
type Grouped<C> = { [K in Key<C>]: C[K] extends { role: "rs" } | { multihop: object } ? K : never }[Key<C>];
/** The upstreams we take routes from. */
type Importing<C> = { [K in Key<C>]: C[K] extends { import: object } ? K : never }[Key<C>];

/** The project's pattern for a name, or the default. */
type PatternOf<N, F extends Field> = N extends { [X in F]: infer P } ? P : Defaults[F];
/** The pattern an upstream takes: the only one, its tunnel's, its role's, or the default. */
type Chosen<P, U, F extends Field> = P extends string
    ? P
    : U extends { tunnel: object }
      ? P extends { tunnel: infer T extends string }
          ? T
          : Defaults[F]
      : U extends { role: infer R extends string }
        ? P extends { [X in R]: infer T extends string }
            ? T
            : Defaults[F]
        : Defaults[F];
/** Every `From` in `S` replaced. */
type Replace<S extends string, From extends string, To extends string> = S extends `${infer A}${From}${infer B}`
    ? `${A}${To}${Replace<B, From, To>}`
    : S;
/** An upstream's `handoff.number` or `tunnel.number`. */
type NumberOf<U> = U extends { handoff: { number: infer N extends number } }
    ? N
    : U extends { tunnel: { number: infer N extends number } }
      ? N
      : number;
/** The name built for upstream `K`: its pattern with the key, the key in capitals and its number filled in. */
type Named<C, N, F extends Field, K extends Key<C>> = Replace<
    Replace<Replace<Chosen<PatternOf<N, F>, C[K], F>, "{key}", K>, "{KEY}", Uppercase<K>>,
    "{number}",
    `${NumberOf<C[K]>}`
>;
/** Each of these upstreams' names. */
type Names<C, N, F extends Field, Ks extends Key<C>> = { [K in Ks]: Named<C, N, F, K> }[Ks];

/** The catalog as written, with any key the shape does not have refused, at every level. */
type Exact<S, T> = T extends readonly unknown[] | string | number | boolean | Secret | ((...args: never[]) => unknown)
    ? T
    : { [K in keyof T]: K extends keyof S ? Exact<NonNullable<S[K]>, T[K]> : never };

/** The names as written, with a name or a role Upstreams does not make refused. */
type ExactNames<N> = {
    [F in keyof N]: F extends keyof UpstreamNames
        ? N[F] extends string | ((...args: never[]) => unknown)
            ? N[F]
            : { [R in keyof N[F]]: R extends "provider" | "rs" | "peer" | "tunnel" ? N[F][R] : never }
        : never;
};

/** A network's upstreams written once, and each device's part built from them. */
export class Upstreams {
    /**
     * Each upstream written once: its AS, where it lands, its sessions, limits and policy. Everything a device needs is built from it, under names made from each key, so a device that names one is checked. By default:
     *
     * - VLAN `<key>`, and `<key>-native` for one that sends its VLAN tagged. The router's interface is `<key>` too, a VLAN interface or a GRE tunnel.
     * - Policies `<KEY>-IN` and `<KEY>-OUT`; a BGP group `<key>` for an exchange's route servers or multihop sessions.
     *
     * `names` gives patterns of your own, such as `{ interface: { provider: "core-ipt0{number}-{key}" } }`; see `UpstreamNames`.
     *
     * On the router: `vlans()`, `interfaces()`, `uplinks()`, `groups()`, `neighbors()`, `policies({ ... })`, `tunnelRules()`, `addresses()`. On a switch: `vlans(device)`, `ports(device)`, `vlansOn(device)`. For checks and ACLs: `untrusted()`, `natives()`, `privateDrops()`. Lists follow the catalog's order, where order counts on a device.
     */
    static define<const C extends UpstreamCatalog, const N extends UpstreamNames = {}>(
        catalog: C & { [K in keyof C]: Exact<Upstream, C[K]> },
        options: { names?: N & ExactNames<N> } = {}
    ) {
        type V = Names<C, N, "vlan", Landed<C>>;
        type T = Names<C, N, "native", Tagged<C>>;
        type I = Names<C, N, "interface", Landed<C>>;
        type G = Names<C, N, "interface", Tunneled<C>>;
        type PolicyName = Names<C, N, "import", Importing<C>> | Names<C, N, "export", Key<C>>;
        type Group = Names<C, N, "group", Grouped<C>>;

        const names: UpstreamNames = options.names ?? {};
        const all = Object.entries(catalog) as [Key<C>, Upstream][];
        const nameOf = (key: string, upstream: Upstream) => upstream.name ?? key;
        const grouped = (upstream: Upstream) => upstream.role === "rs" || Boolean(upstream.multihop);

        /** The name built for one upstream: its pattern with the key, the key in capitals and its number filled in. */
        const named = (field: Field, key: string, upstream: Upstream): string => {
            const given = names[field];
            const pattern =
                given === undefined || typeof given === "string"
                    ? (given ?? DEFAULTS[field])
                    : ((upstream.tunnel && "tunnel" in given ? given.tunnel : given[upstream.role]) ?? DEFAULTS[field]);

            return pattern
                .replaceAll("{key}", key)
                .replaceAll("{KEY}", key.toUpperCase())
                .replaceAll("{number}", () => {
                    const number = upstream.handoff?.number ?? upstream.tunnel?.number;
                    if (number === undefined) throw new Error(`Upstreams: ${key} needs a number for ${field} name ${pattern}`);
                    return String(number);
                });
        };

        // Two upstreams under one name would replace each other on the device.
        for (const field of Object.keys(DEFAULTS) as Field[]) {
            const taken = new Map<string, string>();

            for (const [key, upstream] of all) {
                if (field === "native" && upstream.handoff?.native === undefined) continue;
                if (field === "import" && !upstream.import) continue;
                if (field === "group" && !grouped(upstream)) continue;
                if ((field === "vlan" && !upstream.handoff) || (field === "interface" && !upstream.handoff && !upstream.tunnel)) continue;

                const name = named(field, key, upstream);
                const other = taken.get(name);
                if (other) throw new Error(`Upstreams: ${other} and ${key} both have the ${field} name ${name}`);
                taken.set(name, key);
            }
        }

        const vlan = (key: string, upstream: Upstream) => named("vlan", key, upstream) as V;
        const native = (key: string, upstream: Upstream) => named("native", key, upstream) as T;
        const policy = (direction: "import" | "export", key: string, upstream: Upstream) => named(direction, key, upstream) as PolicyName;

        /** Each landed upstream's VLAN; with a device, the VLANs and natives of those arriving on its ports. */
        const vlans = <const D extends string | undefined = undefined>(device?: D) => {
            const result: Record<string, Vlan> = {};

            for (const [key, upstream] of all) {
                const handoff = upstream.handoff;
                if (!handoff || (device !== undefined && handoff.port?.device !== device)) continue;

                result[vlan(key, upstream)] = { id: handoff.vlan, description: nameOf(key, upstream) };
                if (device !== undefined && handoff.native !== undefined) {
                    result[native(key, upstream)] = {
                        id: handoff.native,
                        description: `Native toward ${nameOf(key, upstream)}, nothing else in it`,
                    };
                }
            }

            return result as D extends string ? { [K in V]: Vlan } & { [K in T]: Vlan } : { [K in V]: Vlan };
        };

        const vlansOn = (device: string) =>
            all.filter(([, upstream]) => upstream.handoff?.port?.device === device).map(([key, upstream]) => vlan(key, upstream));

        const ports = (device: string) => {
            const result: Record<string, Port<V | T, never, never, never>> = {};

            for (const [key, upstream] of all) {
                const handoff = upstream.handoff;
                if (!handoff?.port || handoff.port.device !== device) continue;

                result[handoff.port.port] = {
                    description: names.port ? names.port(key, upstream) : nameOf(key, upstream),
                    ...(handoff.native !== undefined
                        ? { trunk_vlans: [vlan(key, upstream)], native_vlan: native(key, upstream) }
                        : { access_vlan: vlan(key, upstream) }),
                    lldp: false,
                    stp: false,
                    ...(handoff.port.storm_control ? { storm_control: handoff.port.storm_control } : {}),
                };
            }

            return result;
        };

        const interfaces = () => {
            const result: Record<string, VlanInterface<V, never> | Gre<never>> = {};

            for (const [key, upstream] of all) {
                const description = nameOf(key, upstream);
                const name = named("interface", key, upstream);

                if (upstream.tunnel) {
                    const { local, remote, addresses, mtu } = upstream.tunnel;
                    result[name] = { type: "gre", description, local, remote, addresses, ...(mtu ? { mtu } : {}) };
                } else if (upstream.handoff) {
                    const { addresses, exchange } = upstream.handoff;
                    result[name] = { type: "vlan", vlan: vlan(key, upstream), description, addresses, ...(exchange ? { exchange } : {}) };
                }
            }

            return result as { [K in I]: VlanInterface<V, never> } & { [K in G]: Gre<never> };
        };

        /** The router's interfaces toward the internet: every landed upstream's, for NAT and lists like it. */
        const uplinks = () =>
            all.filter(([, upstream]) => upstream.handoff).map(([key, upstream]) => named("interface", key, upstream) as I);

        /** What a session or its group takes from its upstream. */
        const settings = (key: string, upstream: Upstream): NeighborSettings<PolicyName> => ({
            remote_as: upstream.asn,
            description: nameOf(key, upstream),
            role: upstream.role,
            ...(upstream.import ? { import: policy("import", key, upstream) } : {}),
            export: policy("export", key, upstream),
        });

        const groups = () =>
            Object.fromEntries(
                all
                    .filter(([, upstream]) => grouped(upstream))
                    .map(([key, upstream]) => {
                        const multihop = upstream.multihop;
                        return [
                            named("group", key, upstream),
                            {
                                ...settings(key, upstream),
                                ...(multihop
                                    ? {
                                          local_address: multihop.local_address,
                                          multihop: true,
                                          ...(multihop.families ? { families: multihop.families } : {}),
                                          ...(multihop.password ? { password: multihop.password } : {}),
                                      }
                                    : {}),
                            },
                        ];
                    })
            ) as Record<Group, NeighborSettings<PolicyName>>;

        const neighbors = () =>
            Object.fromEntries(
                all.flatMap(([key, upstream]) =>
                    Object.entries(upstream.sessions).map(([name, session]) => {
                        const limit = upstream.limits?.[Address.family(session.address)];
                        return [
                            name,
                            {
                                ...session,
                                ...(grouped(upstream) ? { group: named("group", key, upstream) } : settings(key, upstream)),
                                ...(limit ? { max_prefixes: limit } : {}),
                            },
                        ];
                    })
                )
            ) as Record<string, Neighbor<PolicyName, Group>>;

        const policies = <const P extends string = never>(options: UpstreamPolicies<P> = {}) => {
            const result: Record<string, PolicyRule<P, never>[]> = {};

            for (const [key, upstream] of all) {
                result[policy("export", key, upstream)] = [
                    ...(options.actions?.(key, upstream) ?? []),
                    ...(upstream.export ?? []),
                    ...Bgp.announce(upstream.announce),
                ];

                const taken = upstream.import;
                if (!taken) continue;

                const tag = options.tag?.(key, upstream);
                result[policy("import", key, upstream)] = [
                    ...(taken.default
                        ? Bgp.defaultOnly({ ...taken.default, ...(options.sources ? { sources: options.sources } : {}) })
                        : []),
                    ...(taken.learn
                        ? Bgp.learn<P>({
                              ...(taken.learn.before ? { before: taken.learn.before } : {}),
                              ...(options.sanity ? { sanity: options.sanity } : {}),
                              ...(options.sources ? { sources: options.sources } : {}),
                              ...(taken.learn.local_pref !== undefined ? { local_pref: taken.learn.local_pref } : {}),
                              ...(tag !== undefined ? { tag } : {}),
                          })
                        : [{ description: "Nothing else", action: "reject" as const }]),
                ];
            }

            return result as Record<PolicyName, PolicyRule<P, never>[]>;
        };

        /** The VLANs straight off an upstream, natives included: `untrusted` for `Checks.trustBoundary`. */
        const untrusted = () => [
            ...all.filter(([, upstream]) => upstream.handoff).map(([key, upstream]) => vlan(key, upstream)),
            ...natives(),
        ];

        const natives = () =>
            all.filter(([, upstream]) => upstream.handoff?.native !== undefined).map(([key, upstream]) => native(key, upstream));

        const privateDrops = () =>
            all.filter(([, upstream]) => upstream.handoff && upstream.drop_private).map(([key, upstream]) => vlan(key, upstream));

        const tunnelRules = (): FilterRule<never, never>[] =>
            all.flatMap(([key, upstream]) =>
                upstream.tunnel
                    ? [
                          {
                              description: `GRE from ${nameOf(key, upstream)}`,
                              match: {
                                  protocol: "gre" as const,
                                  src: `${upstream.tunnel.remote}/${Address.bits(Address.family(upstream.tunnel.remote))}` as Prefix,
                              },
                              action: "accept" as const,
                          },
                      ]
                    : []
            );

        const addresses = () => all.flatMap(([, upstream]) => Object.values(upstream.sessions).map((session) => session.address));

        return {
            vlans,
            vlansOn,
            ports,
            interfaces,
            uplinks,
            groups,
            neighbors,
            policies,
            untrusted,
            natives,
            privateDrops,
            tunnelRules,
            addresses,
        };
    }
}
