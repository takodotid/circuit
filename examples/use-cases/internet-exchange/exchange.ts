// What a member of the exchange is, and the port it gets on the fabric. A member's file says what is its own: its AS, its ports, and its addresses on the peering LAN.

import type { IP, Port, Prefix } from "@takodotid/circuit";

/** The peering LAN: one subnet per family, shared by every member and the route servers. */
export const PEERING_LAN = { v4: "203.0.113.0/24", v6: "2001:db8:ffff::/64" } as const satisfies Record<string, Prefix>;

export type Member = {
    /** Lowercase, and never reused. */
    name: string;
    asn: number;
    /** The member's port on each fabric switch. */
    ports: Readonly<Record<string, string>>;
    /** Its addresses on the peering LAN, one per family. The route servers peer with these. */
    ipv4: IP;
    ipv6: IP;
};

/** Declare a member. */
export const member = (spec: Member): Member => spec;

/**
 * The members' ports on one fabric switch. A member port is in the peering VLAN and nothing else, and carries none of what a shared LAN must not: spanning tree, LLDP, and more than a trickle of broadcast, multicast or unknown unicast.
 */
export function memberPorts(members: readonly Member[], device: string) {
    const ports: Record<string, Port<"peering", string, string, string>> = {};

    for (const m of members) {
        const port = m.ports[device];
        if (!port) continue;

        ports[port] = {
            description: `${m.name}, AS${m.asn}`,
            access_vlan: "peering",
            stp: false,
            lldp: false,
            storm_control: { broadcast: { percent: 1 }, multicast: { percent: 1 }, unknown_unicast: { percent: 1 } },
        };
    }

    return ports;
}
