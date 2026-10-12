// What a customer is, and what each device carries for it. A customer's entry in customers.ts says what is the customer's own; its VLANs, addresses, sessions and policies follow from its name, number and site.

import type { Interface, IP, Neighbor, Port, PolicyRule, Prefix, PrefixSet, RoutePolicy, StaticRoute, Vlan } from "@takodotid/circuit";
import { familyOf } from "@takodotid/circuit";
import { communities, SITE, type Site } from "./network";

export type Customer = {
    /** Lowercase, and never reused. Names its VLAN, its gateway interface, its BGP sessions and its policies. */
    name: string;
    /** A number no other customer has. Its VLAN is 1000 + number, its private VLAN 2000 + number, and its IPv6 /64 is 2001:db8:100:<number in hex>::/64. */
    number: number;
    /** Where its servers are. */
    site: Site;
    /** The block of ours its servers take addresses from. The first address is its gateway; at site A the next two are the edge routers' own, and the fourth is the customer's router. */
    ipv4: Prefix;
    /** It also has an IPv6 /64, laid out the same way. */
    ipv6?: true;
    /** More blocks of ours, routed to the customer's router. */
    routed?: readonly Prefix[];
    /** It runs BGP from its router, and announces its own space. */
    bgp?: { asn: number; prefixes: readonly Prefix[] };
    /** Drop reflected UDP floods toward its IPv4 block at the edge. */
    shield?: true;
    /** Its ports, by switch, then by port. A `private` port also carries the customer's private VLAN, which stays on that switch. */
    ports: Readonly<Record<string, Readonly<Record<string, { description: string; private?: true }>>>>;
};

/** Declare a customer. */
export const customer = (spec: Customer): Customer => spec;

/** The address `n` after the start of an IPv4 prefix. */
export function nth(prefix: Prefix, n: number): IP {
    const start = prefix
        .split("/")[0]!
        .split(".")
        .reduce((value, octet) => value * 256 + Number(octet), 0);

    return [24, 16, 8, 0].map((shift) => Math.floor((start + n) / 2 ** shift) % 256).join(".");
}

const lengthOf = (prefix: Prefix) => prefix.split("/")[1]!;

/** The customer's IPv6 /64. */
export const ipv6Of = (c: Customer): Prefix => `2001:db8:100:${c.number.toString(16)}::/64`;

/** The address `n` in the customer's IPv6 /64. */
const ipv6Host = (c: Customer, n: number): IP => `2001:db8:100:${c.number.toString(16)}::${n}`;

/** The customer's router, which its BGP sessions and routed blocks go to. */
export const routerOf = (c: Customer) => ({ ipv4: nth(c.ipv4, 4), ipv6: ipv6Host(c, 4) });

const privateVlan = (c: Customer) => `${c.name}-private`;

const hasPrivate = (c: Customer, device: string) => Object.values(c.ports[device] ?? {}).some((port) => port.private);

/** Each customer's VLAN, which every switch at its site carries up to the routers. */
export const customerVlans = (customers: readonly Customer[]): Record<string, Vlan> =>
    Object.fromEntries(customers.map((c) => [c.name, { id: 1000 + c.number, description: `Customer ${c.name}` }]));

/** The names of every customer's VLAN, for a trunk. */
export const customerVlanNames = (customers: readonly Customer[]) => customers.map((c) => c.name);

/** The private VLANs one switch has: those of customers with a private port on it. */
export const privateVlans = (customers: readonly Customer[], device: string): Record<string, Vlan> =>
    Object.fromEntries(
        customers
            .filter((c) => hasPrivate(c, device))
            .map((c) => [privateVlan(c), { id: 2000 + c.number, description: `Customer ${c.name}, private` }])
    );

/** The customers' ports on one switch, each with the settings every host port on that switch has. */
export function customerPorts(customers: readonly Customer[], device: string, host: Port<string, never, never, never> = {}) {
    const ports: Record<string, Port<string, never, never, never>> = {};

    for (const c of customers) {
        for (const [name, port] of Object.entries(c.ports[device] ?? {})) {
            ports[name] = {
                ...host,
                description: port.description,
                ...(port.private ? { trunk_vlans: [c.name, privateVlan(c)] } : { access_vlan: c.name }),
            };
        }
    }

    return ports;
}

/**
 * A router's interface on each customer's VLAN. `own` is the router's place in the customer's block: 2 or 3 for the pair at site A, which share the first address by VRRP, and 1 for the router alone at site B.
 */
export function gateways(customers: readonly Customer[], own: number, vrrp?: { priority: number }) {
    const interfaces: Record<string, Interface<string, never>> = {};

    for (const c of customers) {
        interfaces[c.name] = {
            type: "vlan",
            vlan: c.name,
            description: `Customer ${c.name}`,
            addresses: [`${nth(c.ipv4, own)}/${lengthOf(c.ipv4)}`, ...(c.ipv6 ? [`${ipv6Host(c, own)}/64`] : [])],
            ...(c.ipv6 ? { ipv6_ra: true } : {}),
            ...(vrrp ? { vrrp: [{ id: 100 + c.number, address: nth(c.ipv4, 1), priority: vrrp.priority, preempt: true }] } : {}),
        };
    }

    return interfaces;
}

/** Routes to the blocks customers have routed to their router. */
export const routedBlocks = (customers: readonly Customer[]): StaticRoute<never, never>[] =>
    customers.flatMap((c) => (c.routed ?? []).map((prefix) => ({ prefix, via: routerOf(c).ipv4, description: `Routed to ${c.name}` })));

const policyOf = (c: Customer) => `CUSTOMER-${c.name.toUpperCase()}-IN`;

/** The families a BGP customer announces. */
const familiesOf = (c: Customer) => new Set((c.bgp?.prefixes ?? []).map(familyOf));

/** The prefix sets of every BGP customer, by family, for the imports that accept them and the exports that pass them on. */
export function customerPrefixSets(customers: readonly Customer[]) {
    const sets: Record<string, PrefixSet> = {};

    for (const c of customers) {
        for (const family of familiesOf(c)) {
            const prefixes = c.bgp!.prefixes.filter((prefix) => familyOf(prefix) === family);
            sets[`${c.name}-${family === "ipv4" ? "v4" : "v6"}`] = { prefixes };
        }
    }

    return sets;
}

/** Rules for an export: every BGP customer's own space passes. */
export const customerSpace = (customers: readonly Customer[]): PolicyRule<never, string>[] =>
    Object.keys(customerPrefixSets(customers)).map((set) => ({
        description: `Customer space ${set}`,
        match: { prefix_set: set },
        action: "accept",
    }));

/** A session to each BGP customer's router, one per family it announces. */
export function customerSessions(customers: readonly Customer[]) {
    const neighbors: Record<string, Neighbor<string, never>> = {};

    for (const c of customers) {
        if (!c.bgp) continue;

        for (const family of familiesOf(c)) {
            neighbors[`${c.name}-${family === "ipv4" ? "v4" : "v6"}`] = {
                address: family === "ipv4" ? routerOf(c).ipv4 : routerOf(c).ipv6,
                remote_as: c.bgp.asn,
                role: "customer",
                description: `Customer ${c.name}`,
                import: policyOf(c),
                export: "CUSTOMER-OUT",
                // A customer sends a handful of prefixes. More is a mistake on its side, and the session closes.
                max_prefixes: 10 * c.bgp.prefixes.length,
            };
        }
    }

    return neighbors;
}

/** Each BGP customer's import: its blackhole requests inside its own space, then its own space, preferred over the same routes from anyone else. */
export function customerPolicies(customers: readonly Customer[]) {
    const policies: Record<string, RoutePolicy<string, string>> = {};

    for (const c of customers) {
        if (!c.bgp) continue;

        const sets = Object.keys(customerPrefixSets([c]));

        policies[policyOf(c)] = [
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
    }

    return policies;
}
