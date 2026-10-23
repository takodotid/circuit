// The exchange: its peering LAN, what its fabric does for each member, and what both switches share.
//
// Addresses are from the documentation ranges, in place of the exchange's own.

import type { Prefix, Vlan } from "@takodotid/circuit";
import { Exchange, type RouteServer } from "@takodotid/circuit/helpers";
import { MEMBERS } from "./members";

/** The route servers. Each member gets a session from both. */
export const ROUTE_SERVERS = [
    { name: "rs1", asn: 64500, router_id: "203.0.113.1", ipv4: "203.0.113.1", ipv6: "2001:db8:ffff::1" },
    { name: "rs2", asn: 64500, router_id: "203.0.113.2", ipv4: "203.0.113.2", ipv6: "2001:db8:ffff::2" },
] as const satisfies readonly RouteServer[];

export const exchange = Exchange.build(
    {
        vlan: "peering",
        lan: { ipv4: "203.0.113.0/24", ipv6: "2001:db8:ffff::/64" },
        // No member may take a route server's address.
        reserved: ROUTE_SERVERS.flatMap((server) => [server.ipv4, server.ipv6]),
    },
    MEMBERS
);

/** Where the switches are managed from. */
export const MANAGEMENT = "10.0.0.0/24" satisfies Prefix;

export const vlans = {
    mgmt: { id: 10, description: "Management, never on a member port" },
    peering: { id: 100, description: "Peering LAN" },
} as const satisfies Record<string, Vlan>;
