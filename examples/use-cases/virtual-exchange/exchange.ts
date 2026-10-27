// A virtual exchange: members reach it over a GRE tunnel from anywhere, instead of a port on a shared switch. Each member's tunnel ends on the hub router, and the route servers sit behind it.
//
// Addresses are from the documentation ranges, in place of real ones.

import type { Interface, InterfaceAddress, IP, Prefix } from "@takodotid/circuit";

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
    /** Its GRE tunnel on the hub: the interface's name, and the hub's address in the tunnel's /31. The member takes the other address, and the route servers peer with that. */
    tunnel: { interface: string; address: InterfaceAddress };
};

/** One GRE tunnel per member, on the hub, as each member writes it. */
export const tunnels = (members: readonly VirtualMember[]): Record<string, Interface<never, never>> =>
    Object.fromEntries(
        members.map((m) => [
            m.tunnel.interface,
            { type: "gre", description: `${m.name}, AS${m.asn}`, local: HUB, remote: m.endpoint, addresses: [m.tunnel.address] },
        ])
    );
