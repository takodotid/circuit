// What a tenant is, and what each device carries for it. A tenant's file writes everything its devices carry: its VLANs, the router's addresses for it, its ports. These functions only gather them for one device.

import type { AclRule, Interface, InterfaceAddress, Port, Prefix, Vlan } from "@takodotid/circuit";
import { Address } from "@takodotid/circuit";

/** A VLAN with its name. */
export type NamedVlan = Vlan & { name: string };

export type Tenant = {
    /** Lowercase, and never reused. */
    name: string;
    /** The tenant's VLAN to the internet. The router has it, with the tenant's gateways, and so does every switch, to carry it up to the router. */
    internet: {
        vlan: NamedVlan;
        /** The router's addresses on it, each the gateway the tenant's servers use inside one of its blocks, such as `198.51.100.9/29`. */
        gateways: readonly InterfaceAddress[];
    };
    /** A VLAN between the tenant's own servers. It is only on a switch where one of the tenant's ports uses it, and never on the router. */
    private?: { vlan: NamedVlan };
    /** Rules for traffic toward the tenant's IPv4 blocks from the transit and the exchange, such as a cap on UDP. Everything reaches the tenant when absent. */
    acl?: readonly (Omit<AclRule<never>, "match"> & { match?: Omit<NonNullable<AclRule<never>["match"]>, "vlan" | "dst"> })[];
    /** The tenant's ports, by switch, then by port, written as any port is. */
    ports: Readonly<Record<string, Readonly<Record<string, Port<string, string, string, string>>>>>;
};

/** A VLAN as `vlans` takes it, keyed by its name. */
const entry = ({ name, ...vlan }: NamedVlan): [string, Vlan] => [name, vlan];

/** The tenant's blocks: the network of each gateway. */
export const blocksOf = (t: Tenant): Prefix[] => t.internet.gateways.map((gateway) => Address.prefixOf(gateway));

/** Every tenant's internet VLAN, for the router. */
export const routerVlans = (tenants: readonly Tenant[]): Record<string, Vlan> =>
    Object.fromEntries(tenants.map((t) => entry(t.internet.vlan)));

/** The VLANs one switch carries: every tenant's internet VLAN, and the private VLAN of each tenant with a port on it that uses it. */
export const switchVlans = (tenants: readonly Tenant[], device: string): Record<string, Vlan> =>
    Object.fromEntries(
        tenants.flatMap((t) => {
            const ports = Object.values(t.ports[device] ?? {});
            const usesPrivate =
                t.private &&
                ports.some((port) => port.access_vlan === t.private!.vlan.name || port.trunk_vlans?.includes(t.private!.vlan.name));
            return [entry(t.internet.vlan), ...(usesPrivate ? [entry(t.private!.vlan)] : [])];
        })
    );

/** The names of every tenant's internet VLAN, for a trunk toward the router. */
export const internetVlanNames = (tenants: readonly Tenant[]) => tenants.map((t) => t.internet.vlan.name);

/** The tenants' ports on one switch. */
export const portsOn = (tenants: readonly Tenant[], device: string): Record<string, Port<string, string, string, string>> =>
    Object.assign({}, ...tenants.map((t) => t.ports[device] ?? {}));

/** The router's interface on each tenant's internet VLAN, holding the tenant's gateways. */
export const gateways = (tenants: readonly Tenant[]): Record<string, Interface<string, never>> =>
    Object.fromEntries(
        tenants.map((t) => [
            t.internet.vlan.name,
            { type: "vlan", vlan: t.internet.vlan.name, description: `Tenant ${t.name}`, addresses: t.internet.gateways },
        ])
    );

/** Each tenant's `acl` rules on one VLAN from outside, one per rule and IPv4 block, each limited to traffic toward that block. */
export const edgeRules = <V extends string>(tenants: readonly Tenant[], vlan: V): AclRule<V>[] =>
    tenants.flatMap((t) =>
        (t.acl ?? []).flatMap((rule) =>
            blocksOf(t)
                .filter((prefix) => Address.family(prefix) === "ipv4")
                .map((prefix) => ({
                    ...rule,
                    ...(rule.description ? { description: `${vlan}: ${rule.description}` } : {}),
                    match: { ...rule.match, vlan, dst: prefix },
                }))
        )
    );
