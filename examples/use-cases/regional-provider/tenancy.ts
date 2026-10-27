// What a customer is, and what each device carries for it. A customer's entry in customers.ts writes everything its devices carry; these functions only gather it for one device.

import type {
    Interface,
    IP,
    Neighbor,
    Port,
    PolicyRule,
    Prefix,
    PrefixSet,
    RoutePolicy,
    StaticRoute,
    Vlan,
    VlanInterface,
} from "@takodotid/circuit";
import { communities, SITE, type Site } from "./network";

/** A VLAN with its name. */
export type NamedVlan = Vlan & { name: string };

export type Customer = {
    /** Lowercase, and never reused. */
    name: string;
    /** Where its servers are. */
    site: Site;
    /** Its VLAN. Every switch at its site carries it up to the edge routers. */
    vlan: NamedVlan;
    /** A VLAN between its own servers. It is only on a switch where one of its ports uses it, and never on a router. */
    private?: NamedVlan;
    /** Its blocks of ours, of either family. */
    blocks: readonly Prefix[];
    /** Each edge router's interface on its VLAN, by router: the router's addresses, router advertisements, and at site A the gateway the two routers share by VRRP. */
    gateways: Readonly<Record<string, Pick<VlanInterface<string, never>, "addresses" | "ipv6_ra" | "vrrp">>>;
    /** More blocks of ours, routed to the customer's router at `via`. */
    routed?: { via: IP; prefixes: readonly Prefix[] };
    /** It runs BGP from its router, and announces its own space. */
    bgp?: {
        asn: number;
        /** Its import policy's name. */
        import: string;
        /** Its own space, by prefix set name, one set per family. */
        prefix_sets: Readonly<Record<string, readonly Prefix[]>>;
        /** A session to its router, by name, to the address in that family. */
        sessions: Readonly<Record<string, IP>>;
        /** The most prefixes a session may send before it closes. */
        max_prefixes: number;
    };
    /** Drop reflected UDP floods toward its IPv4 blocks at the edge. */
    shield?: true;
    /** Its ports, by switch, then by port, with the VLANs by name. */
    ports: Readonly<Record<string, Readonly<Record<string, Port<string, never, never, never>>>>>;
};

/** A VLAN as `vlans` takes it, keyed by its name. */
const entry = ({ name, ...vlan }: NamedVlan): [string, Vlan] => [name, vlan];

/** Each customer's VLAN, which every switch at its site carries up to the routers. */
export const customerVlans = (customers: readonly Customer[]): Record<string, Vlan> =>
    Object.fromEntries(customers.map((c) => entry(c.vlan)));

/** The names of every customer's VLAN, for a trunk. */
export const customerVlanNames = (customers: readonly Customer[]) => customers.map((c) => c.vlan.name);

/** The private VLANs one switch has: those of customers with a port on it that uses one. */
export const privateVlans = (customers: readonly Customer[], device: string): Record<string, Vlan> =>
    Object.fromEntries(
        customers.flatMap((c) => {
            const uses = Object.values(c.ports[device] ?? {}).some((port) => c.private && port.trunk_vlans?.includes(c.private.name));
            return uses ? [entry(c.private!)] : [];
        })
    );

/** The customers' ports on one switch, each with the settings every host port on that switch has. */
export const customerPorts = (customers: readonly Customer[], device: string, host: Port<string, never, never, never> = {}) =>
    Object.fromEntries(
        customers.flatMap((c) => Object.entries(c.ports[device] ?? {}).map(([name, port]) => [name, { ...host, ...port }]))
    ) as Record<string, Port<string, never, never, never>>;

/** One edge router's interface on each customer's VLAN, as each customer writes it for that router. */
export const gateways = (customers: readonly Customer[], router: string): Record<string, Interface<string, never>> =>
    Object.fromEntries(
        customers.map((c) => [c.vlan.name, { type: "vlan", vlan: c.vlan.name, description: c.vlan.description, ...c.gateways[router] }])
    );

/** Routes to the blocks customers have routed to their router. */
export const routedBlocks = (customers: readonly Customer[]): StaticRoute<never, never>[] =>
    customers.flatMap((c) =>
        (c.routed?.prefixes ?? []).map((prefix) => ({ prefix, via: c.routed!.via, description: `Routed to ${c.name}` }))
    );

/** The prefix sets of every BGP customer, for the imports that accept them and the exports that pass them on. */
export const customerPrefixSets = (customers: readonly Customer[]): Record<string, PrefixSet> =>
    Object.fromEntries(customers.flatMap((c) => Object.entries(c.bgp?.prefix_sets ?? {}).map(([name, prefixes]) => [name, { prefixes }])));

/** Rules for an export: every BGP customer's own space passes. */
export const customerSpace = (customers: readonly Customer[]): PolicyRule<never, string>[] =>
    Object.keys(customerPrefixSets(customers)).map((set) => ({
        description: `Customer space ${set}`,
        match: { prefix_set: set },
        action: "accept",
    }));

/** Each BGP customer's sessions, as it writes them. */
export const customerSessions = (customers: readonly Customer[]): Record<string, Neighbor<string, never>> =>
    Object.fromEntries(
        customers.flatMap((c) =>
            Object.entries(c.bgp?.sessions ?? {}).map(([name, address]) => [
                name,
                {
                    address,
                    remote_as: c.bgp!.asn,
                    role: "customer" as const,
                    description: `Customer ${c.name}`,
                    import: c.bgp!.import,
                    export: "CUSTOMER-OUT",
                    max_prefixes: c.bgp!.max_prefixes,
                },
            ])
        )
    );

/** Each BGP customer's import: its blackhole requests inside its own space, then its own space, preferred over the same routes from anyone else. */
export const customerPolicies = (customers: readonly Customer[]): Record<string, RoutePolicy<string, string>> =>
    Object.fromEntries(
        customers.flatMap((c) => {
            if (!c.bgp) return [];

            const sets = Object.keys(c.bgp.prefix_sets);
            const rules: RoutePolicy<string, string> = [
                ...communities.blackhole(sets),
                { call: "SANITY" },
                communities.tag("customer", c.bgp.asn, { site: SITE[c.site], trusted: true }),
                ...sets.map((set) => ({
                    description: `Their space, ${set}`,
                    match: { prefix_set: set },
                    set: { local_pref: 300 },
                    action: "accept" as const,
                })),
                { description: "Nothing else", action: "reject" },
            ];

            return [[c.bgp.import, rules]];
        })
    );
