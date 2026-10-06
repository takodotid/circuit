// A virtual exchange: members reach it over a GRE tunnel from anywhere, instead of a port on a shared switch. Each member's tunnel ends on the hub router, and the route servers sit behind it.
//
// Addresses are from the documentation ranges, in place of real ones.

import type { Interface, IP, Prefix } from "@takodotid/circuit";

/** The exchange's own space: the route servers' LAN, then one /31 per member tunnel. */
export const SPACE = "10.254.0.0/16" satisfies Prefix;

/** The hub's address on the internet, where every member's tunnel ends. */
export const HUB = "198.51.100.2" satisfies IP;

export type VirtualMember = {
    /** Lowercase, and never reused. */
    name: string;
    asn: number;
    /** The member's own address on the internet, where its end of the tunnel is. */
    endpoint: IP;
    /** A number no other member has. Its tunnel is 10.254.1.(2n)/31: the hub takes the even address, the member the odd one, and the route servers peer with that. */
    number: number;
};

/** One GRE tunnel per member, on the hub. */
export function tunnels(members: readonly VirtualMember[]) {
    const interfaces: Record<string, Interface<never, never>> = {};

    for (const m of members) {
        interfaces[`vix-${m.name}`] = {
            type: "gre",
            description: `${m.name}, AS${m.asn}`,
            local: HUB,
            remote: m.endpoint,
            addresses: [`10.254.1.${2 * m.number}/31`],
        };
    }

    return interfaces;
}
