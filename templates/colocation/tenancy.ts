// What a tenant is, and what each device carries for it. A tenant's file says what is the tenant's own; its VLANs and names follow from its name and number.

import type { AclRule, Interface, IP, Port, Prefix, Vlan } from "@takodotid/circuit";
import { familyOf } from "@takodotid/circuit";

/** A tenant's networks. `internet` carries its servers' public addresses and reaches the router. `private` connects its own servers to each other and stays on the switches. */
type TenantNetwork = "internet" | "private";

export type Tenant<N extends string = string> = {
    /** Lowercase, and never reused. Names everything the tenant has. */
    name: N;
    /** A number no other tenant has. Its internet VLAN is 1000 + number, its private VLAN 2000 + number. */
    number: number;
    /** Public blocks routed to the tenant. `gateway` is the router's address inside the block, which the tenant's servers use as their gateway. */
    blocks: readonly { prefix: Prefix; gateway: IP }[];
    /** Rules for traffic toward the tenant's IPv4 blocks from the transit and the exchange, such as a cap on UDP. Everything reaches the tenant when absent. */
    acl?: readonly (Omit<AclRule<never>, "match"> & { match?: Omit<NonNullable<AclRule<never>["match"]>, "vlan" | "dst"> })[];
    /** The tenant's ports, by switch, then by port. A port in `private` gives the tenant a private network on that switch. */
    ports: Readonly<
        Record<string, Readonly<Record<string, { description: string; access?: TenantNetwork; trunk?: readonly TenantNetwork[] }>>>
    >;
};

/** Declare a tenant. */
export const tenant = <const N extends string>(spec: Tenant<N>): Tenant<N> => spec;

const internetVlan = <N extends string>(t: Tenant<N>) => `${t.name}-internet` as const;
const privateVlan = <N extends string>(t: Tenant<N>) => `${t.name}-private` as const;

/** Every tenant's internet VLAN. The router has them all, and so does each switch, to carry them up to the router. */
export const internetVlans = <N extends string>(tenants: readonly Tenant<N>[]) =>
    Object.fromEntries(tenants.map((t) => [internetVlan(t), { id: 1000 + t.number, description: `Tenant ${t.name} internet` }])) as Record<
        `${N}-internet`,
        Vlan
    >;

/** The names of every tenant's internet VLAN, for a trunk toward the router. */
export const internetVlanNames = <N extends string>(tenants: readonly Tenant<N>[]) => tenants.map(internetVlan);

/** The private VLANs one switch has: those of tenants with a port on it in their private network. */
export const privateVlans = <N extends string>(tenants: readonly Tenant<N>[], device: string) =>
    Object.fromEntries(
        tenants
            .filter((t) =>
                Object.values(t.ports[device] ?? {}).some((port) => port.access === "private" || port.trunk?.includes("private"))
            )
            .map((t) => [privateVlan(t), { id: 2000 + t.number, description: `Tenant ${t.name} private` }])
    ) as Record<`${N}-private`, Vlan>;

/** The tenants' ports on one switch. */
export function portsOn<N extends string>(tenants: readonly Tenant<N>[], device: string) {
    const ports: Record<string, Port<`${N}-internet` | `${N}-private`, string, string, string>> = {};

    for (const t of tenants) {
        const vlanOf = (network: TenantNetwork) => (network === "internet" ? internetVlan(t) : privateVlan(t));

        for (const [name, { access, trunk, description }] of Object.entries(t.ports[device] ?? {})) {
            ports[name] = {
                description,
                ...(access ? { access_vlan: vlanOf(access) } : {}),
                ...(trunk ? { trunk_vlans: trunk.map(vlanOf) } : {}),
            };
        }
    }

    return ports;
}

/** The router's interface on each tenant's internet VLAN, holding the tenant's gateways. */
export function gateways<N extends string>(tenants: readonly Tenant<N>[]) {
    const interfaces = {} as Record<`${N}-internet`, Interface<`${N}-internet`, never>>;

    for (const t of tenants) {
        interfaces[internetVlan(t)] = {
            type: "vlan",
            vlan: internetVlan(t),
            description: `Tenant ${t.name}`,
            addresses: t.blocks.map(({ prefix, gateway }) => `${gateway}/${prefix.split("/")[1]}`),
        };
    }

    return interfaces;
}

/** Each tenant's `acl` rules on one VLAN from outside, one per rule and IPv4 block, each limited to traffic toward that block. */
export const edgeRules = <V extends string>(tenants: readonly Tenant[], vlan: V): AclRule<V>[] =>
    tenants.flatMap((t) =>
        (t.acl ?? []).flatMap((rule) =>
            t.blocks
                .filter(({ prefix }) => familyOf(prefix) === "ipv4")
                .map(({ prefix }) => ({
                    ...rule,
                    ...(rule.description ? { description: `${vlan}: ${rule.description}` } : {}),
                    match: { ...rule.match, vlan, dst: prefix },
                }))
        )
    );
