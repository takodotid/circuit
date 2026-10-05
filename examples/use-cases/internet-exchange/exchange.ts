// The exchange: its peering LAN, and what its fabric does for each member.

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
