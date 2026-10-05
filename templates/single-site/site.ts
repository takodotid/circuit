// Values both devices share. Change them to your own.

import type { Prefix, Vlan } from "@takodotid/circuit";

/** The management network. Only addresses in it can log in to the devices. */
export const MANAGEMENT = "192.168.10.0/24" satisfies Prefix;

/** The router's address on the management network, the switch's gateway. */
export const ROUTER = "192.168.10.1";

export const TIMEZONE = "Asia/Jakarta";

/** Every VLAN on the site. Each device lists the ones it carries. */
export const vlans = {
    mgmt: { id: 10, description: "Management" },
    home: { id: 20, description: "Home" },
    guests: { id: 30, description: "Guests" },
} as const satisfies Record<string, Vlan>;
