# A single site

One router and one switch: a homelab, an office, an internal network. Everything fits in a few files.

```
my-network/
  router.ts
  switch.ts
  site.ts              values both devices share
  circuit.config.ts
  .env.local           secrets, never committed
  state/               written by the CLI
```

## Shared values

```ts
// site.ts
import type { Vlan } from "@takodotid/circuit";

export const TIMEZONE = "Europe/Amsterdam";
export const MANAGEMENT = "192.168.10.0/24";

export const vlans = {
    mgmt: { id: 10, description: "Management" },
    home: { id: 20, description: "Home" },
    guests: { id: 30, description: "Guests" },
} as const satisfies Record<string, Vlan>;
```

`satisfies` checks a shared value against the schema where it is written, not only where a device uses it.

## The switch

```ts
// switch.ts
import { defineDevice, secret } from "@takodotid/circuit";
import { MANAGEMENT, TIMEZONE, vlans } from "./site";

export default defineDevice({
    name: "switch",
    platform: "vrp",
    model: "CE6855-48S6Q-HI",
    connection: { host: "192.168.10.2", user: "admin-user" },
    users: { "admin-user": { role: "admin", password: secret("SWITCH_PASSWORD") } },
    system: { timezone: TIMEZONE },
    management: { allow: [MANAGEMENT], ssh: {} },
    vlans,
    ports: {
        "10g-1": { description: "Router", trunk_vlans: ["mgmt", "home", "guests"], link: { device: "router", port: "25g-1" } },
        "10g-2": { description: "Desk", access_vlan: "home" },
        "10g-3": { description: "Guest access point", access_vlan: "guests" },
    },
    interfaces: { mgmt: { type: "vlan", vlan: "mgmt", addresses: ["192.168.10.2/24"] } },
    routing: { static: [{ prefix: "0.0.0.0/0", via: "192.168.10.1" }] },
});
```

The router is the same shape: its VLAN interfaces carry the gateways, `dhcp` hands out addresses, and `firewall` keeps guests off the home network.

## Day to day

```bash
bun net validate
bun net apply switch            # read the plan
bun net apply switch --confirm
```

When a second site comes, see [Colocation with tenants](/patterns/colocation) for a layout with a folder per site.
