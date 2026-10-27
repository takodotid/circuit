import { Address } from "../core/address";
import type {
    Exchange as ExchangeLan,
    Family,
    FilterRule,
    Gre,
    InterfaceAddress,
    StandardCommunity,
    LargeCommunity,
    IP,
    Neighbor,
    NeighborSettings,
    PolicyRule,
    Port,
    Prefix,
    Secret,
    Vlan,
    VlanInterface,
} from "../schema";
import type { NeighborCommunities } from "./bgp";

/** A route policy an upstream's sessions use: its name on the device, and its rules, in order. */
export type UpstreamPolicy = {
    /** The policy's name, as the device carries it. */
    name: string;
    /** Its rules, in order. Nothing is added to them unless `mapImports` or `mapExports` adds it. */
    rules: readonly PolicyRule<string, string>[];
};

/** A VLAN by its name and its ID. */
export type NamedVlan = { name: string; id: number };

/** One network we exchange routes with: a transit we buy, an exchange's route servers, or a peer. Every name it puts on a device is written here. */
export type Upstream = {
    /** Its name as people write it, for descriptions: `Transit A`. The key when absent. */
    name?: string;
    asn: number;
    /** What it is to us: `provider` for a transit, `rs` for an exchange's route servers, `peer` for a direct session. */
    role: "provider" | "rs" | "peer";
    /** Where it lands on our side: a VLAN, the router's interface on it, and the switch port it arrives on. A peer over a tunnel, or over an exchange's VLAN, has none. */
    handoff?: {
        /** The VLAN it arrives on. */
        vlan: NamedVlan;
        /** It sends its VLAN tagged: its switch port gets this native VLAN, which nothing else is in. Untagged when absent. */
        native?: NamedVlan;
        /** The router's VLAN interface on it. */
        interface: string;
        /** Our addresses on it. `{ address, peer }` for a point-to-point address whose far end is outside its own prefix. */
        addresses: readonly (InterfaceAddress | { address: InterfaceAddress; peer: IP })[];
        /**
         * The switch port it arrives on. LLDP and spanning tree are off there unless `lldp` or `stp` says otherwise: an upstream's port faces someone else's network, which should neither learn ours nor join our spanning tree.
         */
        port?: {
            device: string;
            port: string;
            storm_control?: Port<string, string, string, string>["storm_control"];
            /** LLDP on the port. Off when absent. */
            lldp?: boolean;
            /** Spanning tree on the port. Off when absent. */
            stp?: boolean;
        };
        /** An exchange's LAN, for `circuit peeringdb`. */
        exchange?: ExchangeLan;
    };
    /** A GRE tunnel to it, and the router's interface for it. */
    tunnel?: { interface: string; local: IP; remote: IP; addresses: readonly InterfaceAddress[]; mtu?: number };
    /** Our BGP sessions with it, by name: its address, and ours when it is not the interface's. */
    sessions: Readonly<Record<string, { address: IP; local_address?: IP }>>;
    /** A BGP group its sessions share, by this name: the group holds the AS, role, policies, table and multihop settings, and each session names it. Each session holds them itself when absent. */
    group?: string;
    /** The sessions are more than one hop away, from this address of ours. */
    multihop?: { local_address: IP; families?: readonly Family[]; password?: Secret };
    /** The routing table its sessions install the routes they learn in: `main`, or one of the router's `routing.tables`, for a transit that carries only one block's traffic out. The main table when absent; write `main` to say so. On RouterOS the sessions also announce from that table, so what they announce needs a route there too. */
    table?: string;
    /** The most prefixes a session may send, by its family: about twice what it sends. Over it, the session closes until it is cleared. */
    limits?: { ipv4?: number; ipv6?: number };
    /** What we take, as its policy. Nothing when absent. */
    import?: UpstreamPolicy;
    /** What we send it, as its policy. */
    export: UpstreamPolicy;
    /** Its VLAN is listed by `privateDrops()`, for an ACL that drops RFC 1918 sources arriving from it. Nothing else is done with it. */
    drop_private?: true;
    /** The communities it offers, as its NOC gives them: its blackhole community, and how to keep a route from one AS. `communityScheme().actions(upstream)` passes blackholes on with it, and `Upstreams.doNotAnnounceTo` uses the other. */
    communities?: NeighborCommunities;
};

/** Upstreams by key. */
export type UpstreamCatalog = Readonly<Record<string, Upstream>>;

/** What every upstream's policies share, written once: plain functions over each policy's rules. */
export type UpstreamOptions = {
    /** Each import's rules as the device gets them, from the rules the upstream writes. The rules as written when absent. */
    mapImports?: (rules: readonly PolicyRule<string, string>[], key: string, upstream: Upstream) => readonly PolicyRule<string, string>[];
    /** Each export's rules as the device gets them, from the rules the upstream writes. The rules as written when absent. */
    mapExports?: (rules: readonly PolicyRule<string, string>[], key: string, upstream: Upstream) => readonly PolicyRule<string, string>[];
};

type Values<T> = T[keyof T];
/** Each VLAN name the catalog writes. */
type VlanName<C> = Values<{ [K in keyof C]: C[K] extends { handoff: { vlan: { name: infer N extends string } } } ? N : never }>;
/** Each native VLAN name. */
type NativeName<C> = Values<{ [K in keyof C]: C[K] extends { handoff: { native: { name: infer N extends string } } } ? N : never }>;
/** Each router interface on a handoff. */
type HandoffInterface<C> = Values<{ [K in keyof C]: C[K] extends { handoff: { interface: infer N extends string } } ? N : never }>;
/** Each router interface for a tunnel. */
type TunnelInterface<C> = Values<{ [K in keyof C]: C[K] extends { tunnel: { interface: infer N extends string } } ? N : never }>;
/** Each policy name. */
type PolicyName<C> = Values<{
    [K in keyof C]:
        | (C[K] extends { import: { name: infer N extends string } } ? N : never)
        | (C[K] extends { export: { name: infer N extends string } } ? N : never);
}>;
/** Each BGP group name. */
type GroupName<C> = Values<{ [K in keyof C]: C[K] extends { group: infer N extends string } ? N : never }>;
/** Each routing table name, other than main. */
type TableName<C> = Exclude<Values<{ [K in keyof C]: C[K] extends { table: infer N extends string } ? N : never }>, "main">;

/** A network's upstreams written once, and each device's part built from them. */
export class Upstreams {
    /**
     * A catalog of upstreams, by key, written once and checked: a key the shape doesn't have is refused by its name. It gives the catalog back as written, so its keys and entries can be read, and is what `define` takes.
     */
    static catalog<const C extends UpstreamCatalog>(catalog: C & UpstreamCatalog): C {
        return catalog;
    }

    /**
     * Export rules asking an upstream not to pass our routes to these ASes, with its own `communities.do_not_announce_to`: one rule, `description`, adding one community per AS. Nothing for no AS. An upstream without `do_not_announce_to` is an error, since it can't be asked.
     */
    static doNotAnnounceTo(upstream: Upstream, asns: readonly number[], description: string): PolicyRule<never, never>[] {
        if (!asns.length) return [];

        const community = upstream.communities?.do_not_announce_to;
        if (!community)
            throw new Error(
                `Upstreams: ${upstream.name ?? `AS${upstream.asn}`} has no communities.do_not_announce_to, so it can't be asked to keep our routes from AS${asns.join(", AS")}`
            );

        const communities = asns.map(community);
        const large = communities.filter((value) => value.split(":").length === 3) as LargeCommunity[];
        const standard = communities.filter((value) => value.split(":").length === 2) as StandardCommunity[];

        return [
            {
                description,
                set: {
                    ...(standard.length ? { add_communities: standard } : {}),
                    ...(large.length ? { add_large_communities: large } : {}),
                },
            },
        ];
    }

    /**
     * Each upstream written once: its AS, where it lands, its sessions, limits and policies, and every name it puts on a device. Everything a device needs is built from it:
     *
     * - On the router: `vlans()`, `interfaces()`, `uplinks()`, `groups()`, `neighbors()`, `policies()`, `tunnelRules()`, `addresses()`.
     * - On a switch: `vlans(device)`, `ports(device)`, `vlansOn(device)`.
     * - For checks and ACLs: `untrusted()`, `natives()`, `privateDrops()`.
     *
     * An import or export is the rules the upstream writes, in order, passed through `mapImports` or `mapExports` when given: what every upstream shares, such as a call to a sanity policy or the community actions, goes there. Nothing else is added. Lists follow the catalog's order, where order counts on a device. A key the shape doesn't have is refused by the type, by its name.
     */
    static define<const C extends UpstreamCatalog>(catalog: C & UpstreamCatalog, options: UpstreamOptions = {}) {
        type V = VlanName<C>;
        type T = NativeName<C>;

        const all = Object.entries(catalog) as [string, Upstream][];
        const nameOf = (key: string, upstream: Upstream) => upstream.name ?? key;

        // Two upstreams under one name would replace each other on the device.
        const unique = (what: string, names: [string, string | undefined][]) => {
            const taken = new Map<string, string>();
            for (const [key, name] of names) {
                if (name === undefined) continue;
                const other = taken.get(name);
                if (other) throw new Error(`Upstreams: ${other} and ${key} both have the ${what} ${name}`);
                taken.set(name, key);
            }
        };
        unique("VLAN", [
            ...all.map(([key, upstream]): [string, string | undefined] => [key, upstream.handoff?.vlan.name]),
            ...all.map(([key, upstream]): [string, string | undefined] => [key, upstream.handoff?.native?.name]),
        ]);
        unique(
            "interface",
            all.map(([key, upstream]) => [key, upstream.handoff?.interface ?? upstream.tunnel?.interface])
        );
        unique("policy", [
            ...all.map(([key, upstream]): [string, string | undefined] => [key, upstream.import?.name]),
            ...all.map(([key, upstream]): [string, string | undefined] => [key, upstream.export.name]),
        ]);
        unique(
            "BGP group",
            all.map(([key, upstream]) => [key, upstream.group])
        );

        /** Each landed upstream's VLAN and native, or with a device, those of the upstreams arriving on its ports. */
        const vlans = (device?: string) => {
            const result: Record<string, Vlan> = {};

            for (const [key, upstream] of all) {
                const handoff = upstream.handoff;
                if (!handoff || (device !== undefined && handoff.port?.device !== device)) continue;

                result[handoff.vlan.name] = { id: handoff.vlan.id, description: nameOf(key, upstream) };
                if (handoff.native) {
                    result[handoff.native.name] = {
                        id: handoff.native.id,
                        description: `Native toward ${nameOf(key, upstream)}, nothing else in it`,
                    };
                }
            }

            return result as { [K in V | T]: Vlan };
        };

        const vlansOn = (device: string) =>
            all.flatMap(([, upstream]) => (upstream.handoff?.port?.device === device ? [upstream.handoff.vlan.name as V] : []));

        const ports = (device: string) => {
            const result: Record<string, Port<V | T, never, never, never>> = {};

            for (const [key, upstream] of all) {
                const handoff = upstream.handoff;
                if (!handoff?.port || handoff.port.device !== device) continue;

                result[handoff.port.port] = {
                    description: nameOf(key, upstream),
                    ...(handoff.native
                        ? { trunk_vlans: [handoff.vlan.name as V], native_vlan: handoff.native.name as T }
                        : { access_vlan: handoff.vlan.name as V }),
                    lldp: handoff.port.lldp ?? false,
                    stp: handoff.port.stp ?? false,
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
                    const { interface: name, local, remote, addresses, mtu } = upstream.tunnel;
                    result[name] = { type: "gre", description, local, remote, addresses, ...(mtu ? { mtu } : {}) };
                } else if (upstream.handoff) {
                    const { interface: name, vlan, addresses, exchange } = upstream.handoff;
                    result[name] = { type: "vlan", vlan: vlan.name as V, description, addresses, ...(exchange ? { exchange } : {}) };
                }
            }

            return result as { [K in HandoffInterface<C>]: VlanInterface<V, never> } & { [K in TunnelInterface<C>]: Gre<never> };
        };

        /** The router's interface toward each handoff, for NAT and lists like it. */
        const uplinks = () => all.flatMap(([, upstream]) => (upstream.handoff ? [upstream.handoff.interface as HandoffInterface<C>] : []));

        /** What a session, or the group it is in, takes from its upstream. */
        const settings = (key: string, upstream: Upstream): NeighborSettings<PolicyName<C>, TableName<C>> => {
            const multihop = upstream.multihop;
            return {
                remote_as: upstream.asn,
                description: nameOf(key, upstream),
                role: upstream.role,
                ...(upstream.import ? { import: upstream.import.name as PolicyName<C> } : {}),
                export: upstream.export.name as PolicyName<C>,
                ...(upstream.table ? { table: upstream.table as TableName<C> | "main" } : {}),
                ...(multihop
                    ? {
                          local_address: multihop.local_address,
                          multihop: true,
                          ...(multihop.families ? { families: multihop.families } : {}),
                          ...(multihop.password ? { password: multihop.password } : {}),
                      }
                    : {}),
            };
        };

        const groups = () =>
            Object.fromEntries(
                all.flatMap(([key, upstream]) => (upstream.group ? [[upstream.group, settings(key, upstream)]] : []))
            ) as Record<GroupName<C>, NeighborSettings<PolicyName<C>, TableName<C>>>;

        const neighbors = () =>
            Object.fromEntries(
                all.flatMap(([key, upstream]) =>
                    Object.entries(upstream.sessions).map(([name, session]) => {
                        const limit = upstream.limits?.[Address.family(session.address)];
                        return [
                            name,
                            {
                                ...(upstream.group ? { group: upstream.group } : settings(key, upstream)),
                                ...session,
                                ...(limit ? { max_prefixes: limit } : {}),
                            },
                        ];
                    })
                )
            ) as Record<string, Neighbor<PolicyName<C>, GroupName<C>, TableName<C>>>;

        /**
         * Each upstream's import and export, by name. The policies and prefix sets their rules name are checked by `validate`, not by the editor, so the rules are typed to fit any device.
         */
        const policies = () => {
            const result: Record<string, readonly PolicyRule<string, string>[]> = {};

            for (const [key, upstream] of all) {
                if (upstream.import) {
                    const rules = upstream.import.rules;
                    result[upstream.import.name] = options.mapImports ? options.mapImports(rules, key, upstream) : rules;
                }

                const rules = upstream.export.rules;
                result[upstream.export.name] = options.mapExports ? options.mapExports(rules, key, upstream) : rules;
            }

            return result as Record<PolicyName<C>, PolicyRule<never, never>[]>;
        };

        /** The VLANs straight off an upstream, natives included: `untrusted` for `Checks.trustBoundary`. */
        const untrusted = () => [
            ...all.flatMap(([, upstream]) => (upstream.handoff ? [upstream.handoff.vlan.name as V] : [])),
            ...natives(),
        ];

        const natives = () => all.flatMap(([, upstream]) => (upstream.handoff?.native ? [upstream.handoff.native.name as T] : []));

        const privateDrops = () =>
            all.flatMap(([, upstream]) => (upstream.handoff && upstream.drop_private ? [upstream.handoff.vlan.name as V] : []));

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
