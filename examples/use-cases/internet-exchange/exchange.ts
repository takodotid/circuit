// The exchange: its peering LAN, what its fabric does for each member, and what both switches share.
//
// Addresses are from the documentation ranges, in place of the exchange's own.

import type { Prefix, Vlan } from "@takodotid/circuit";
import { internetExchange } from "@takodotid/circuit/presets";
import { MEMBERS } from "./members";

export const exchange = internetExchange(
    {
        vlan: "peering",
        lan: { ipv4: "203.0.113.0/24", ipv6: "2001:db8:ffff::/64" },
        // The route servers' addresses.
        reserved: ["203.0.113.1", "203.0.113.2", "2001:db8:ffff::1", "2001:db8:ffff::2"],
    },
    MEMBERS
);

/** Where the switches are managed from. */
export const MANAGEMENT = "10.0.0.0/24" satisfies Prefix;

export const vlans = {
    mgmt: { id: 10, description: "Management, never on a member port" },
    peering: { id: 100, description: "Peering LAN" },
} as const satisfies Record<string, Vlan>;
