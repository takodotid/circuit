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
        /** Our addresses on it. `{ address, peer }` for a point-to-point address whose far end is outside its own prefix. */
        addresses: readonly (InterfaceAddress | { address: InterfaceAddress; peer: IP })[];
        /** The switch port it arrives on. */
        port?: { device: string; port: string; storm_control?: Port<string, string, string, string>["storm_control"] };
        /** An exchange's LAN, for `circuit peeringdb`. */
        exchange?: ExchangeLan;
    };
    /** A GRE tunnel to it. */
    tunnel?: { local: IP; remote: IP; addresses: readonly InterfaceAddress[]; mtu?: number };
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

/** A native VLAN's name. */
type Native<K extends string> = `${K}-native`;
/** Each upstream's policies: `TRANSIT_A-IN` and `TRANSIT_A-OUT`. */
type PolicyName<C> = `${Uppercase<Importing<C>>}-IN` | `${Uppercase<Key<C>>}-OUT`;

/** The catalog as written, with any key the shape does not have refused, at every level. */
type Exact<S, T> = T extends readonly unknown[] | string | number | boolean | Secret
    ? T
    : { [K in keyof T]: K extends keyof S ? Exact<NonNullable<S[K]>, T[K]> : never };

/** A network's upstreams written once, and each device's part built from them. */
export class Upstreams {
    /**
     * Each upstream written once: its AS, where it lands, its sessions, limits and policy. Everything a device needs is built from it, under names made from each key, so a device that names one is checked:
     *
     * - VLAN `<key>`, and `<key>-native` for one that sends its VLAN tagged. The router's interface is `<key>` too, a VLAN interface or a GRE tunnel.
     * - Policies `<KEY>-IN` and `<KEY>-OUT`; a BGP group `<key>` for an exchange's route servers or multihop sessions.
     *
     * On the router: `vlans()`, `interfaces()`, `groups()`, `neighbors()`, `policies({ ... })`, `tunnelRules()`, `addresses()`. On a switch: `vlans(device)`, `ports(device)`, `vlansOn(device)`. For checks and ACLs: `untrusted()`, `natives()`, `privateDrops()`. Lists follow the catalog's order, where order counts on a device.
     */
    static define<const C extends UpstreamCatalog>(catalog: C & { [K in keyof C]: Exact<Upstream, C[K]> }) {
        type V = Landed<C>;
        type T = Tagged<C>;

        const all = Object.entries(catalog) as [Key<C>, Upstream][];
        const nameOf = (key: string, upstream: Upstream) => upstream.name ?? key;
        const policy = (key: string) => key.toUpperCase();
        const grouped = (upstream: Upstream) => upstream.role === "rs" || Boolean(upstream.multihop);

        /** Each landed upstream's VLAN; with a device, the VLANs and natives of those arriving on its ports. */
        const vlans = <const D extends string | undefined = undefined>(device?: D) => {
            const result: Record<string, Vlan> = {};

            for (const [key, upstream] of all) {
                const handoff = upstream.handoff;
                if (!handoff || (device !== undefined && handoff.port?.device !== device)) continue;

                result[key] = { id: handoff.vlan, description: nameOf(key, upstream) };
                if (device !== undefined && handoff.native !== undefined) {
                    result[`${key}-native`] = {
                        id: handoff.native,
                        description: `Native toward ${nameOf(key, upstream)}, nothing else in it`,
                    };
                }
            }

            return result as D extends string ? { [K in V]: Vlan } & { [K in T as Native<K>]: Vlan } : { [K in V]: Vlan };
        };

        const vlansOn = (device: string) =>
            all.filter(([, upstream]) => upstream.handoff?.port?.device === device).map(([key]) => key as V);

        const ports = (device: string) => {
            const result: Record<string, Port<V | Native<T>, never, never, never>> = {};

            for (const [key, upstream] of all) {
                const handoff = upstream.handoff;
                if (!handoff?.port || handoff.port.device !== device) continue;

                result[handoff.port.port] = {
                    description: nameOf(key, upstream),
                    ...(handoff.native !== undefined
                        ? { trunk_vlans: [key as V], native_vlan: `${key}-native` as Native<T> }
                        : { access_vlan: key as V }),
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

                if (upstream.tunnel) {
                    const { local, remote, addresses, mtu } = upstream.tunnel;
                    result[key] = { type: "gre", description, local, remote, addresses, ...(mtu ? { mtu } : {}) };
                } else if (upstream.handoff) {
                    const { addresses, exchange } = upstream.handoff;
                    result[key] = { type: "vlan", vlan: key as V, description, addresses, ...(exchange ? { exchange } : {}) };
                }
            }

            return result as { [K in V]: VlanInterface<V, never> } & { [K in Tunneled<C>]: Gre<never> };
        };

        /** What a session or its group takes from its upstream. */
        const settings = (key: string, upstream: Upstream): NeighborSettings<PolicyName<C>> => ({
            remote_as: upstream.asn,
            description: nameOf(key, upstream),
            role: upstream.role,
            ...(upstream.import ? { import: `${policy(key)}-IN` as PolicyName<C> } : {}),
            export: `${policy(key)}-OUT` as PolicyName<C>,
        });

        const groups = () =>
            Object.fromEntries(
                all
                    .filter(([, upstream]) => grouped(upstream))
                    .map(([key, upstream]) => {
                        const multihop = upstream.multihop;
                        return [
                            key,
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
            ) as Record<Grouped<C>, NeighborSettings<PolicyName<C>>>;

        const neighbors = () =>
            Object.fromEntries(
                all.flatMap(([key, upstream]) =>
                    Object.entries(upstream.sessions).map(([name, session]) => {
                        const limit = upstream.limits?.[Address.family(session.address)];
                        return [
                            name,
                            {
                                ...session,
                                ...(grouped(upstream) ? { group: key } : settings(key, upstream)),
                                ...(limit ? { max_prefixes: limit } : {}),
                            },
                        ];
                    })
                )
            ) as Record<string, Neighbor<PolicyName<C>, Grouped<C>>>;

        const policies = <const P extends string = never>(options: UpstreamPolicies<P> = {}) => {
            const result: Record<string, PolicyRule<P, never>[]> = {};

            for (const [key, upstream] of all) {
                result[`${policy(key)}-OUT`] = [
                    ...(options.actions?.(key, upstream) ?? []),
                    ...(upstream.export ?? []),
                    ...Bgp.announce(upstream.announce),
                ];

                const taken = upstream.import;
                if (!taken) continue;

                const tag = options.tag?.(key, upstream);
                result[`${policy(key)}-IN`] = [
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

            return result as Record<PolicyName<C>, PolicyRule<P, never>[]>;
        };

        /** The VLANs straight off an upstream, natives included: `untrusted` for `Checks.trustBoundary`. */
        const untrusted = () => [...all.filter(([, upstream]) => upstream.handoff).map(([key]) => key as V), ...natives()];

        const natives = () =>
            all.filter(([, upstream]) => upstream.handoff?.native !== undefined).map(([key]) => `${key}-native` as Native<T>);

        const privateDrops = () => all.filter(([, upstream]) => upstream.handoff && upstream.drop_private).map(([key]) => key as V);

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
