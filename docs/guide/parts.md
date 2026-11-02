---
description: Write what a tenant or a provider adds to your devices in its own file, and pull it in with include and merge.
---

# Parts and merge

A **part** is what one file adds to a device that lives in another file. Think: a tenant's VLAN and ports, a provider's BGP sessions, a syslog server every device uses.

Circuit only knows devices. "Tenant" and "provider" are your own ideas, so you organise them however you like.

```ts
// tenants/tenant-a.ts
// Tenant A: its VLAN on the router and the switch, its gateway on the router, its server's port, and its rules on the router.

const vlans = literal({
    "tenant-a": { id: 200, description: "Tenant A" },
});

export const tenant_a = {
    parts: {
        "edge-01": part("device", {
            switching: { vlans },
            interfaces: {
                ethernet: { "25g-2": { trunk_vlans: ["tenant-a"] } },
                vlan_interface: { "tenant-a-gw": { vlan: "tenant-a", description: "Tenant A gateway", addresses: ["203.0.113.65/26"] } },
            },
        }),
        "switch-01": part("device", {
            switching: { vlans },
            interfaces: {
                ethernet: {
                    "10g-1": { trunk_vlans: ["tenant-a"] },
                    "10g-5": { description: "tenant-a server-1", access_vlan: "tenant-a" },
                },
            },
        }),
    },
    rules: {
        edge_forward: part("filter", [
            { description: "tenant-a: no private ranges", if: { src: "203.0.113.64/26", dst: presets.rfc1918 }, then: "drop" },
            { description: "tenant-a: to the internet", if: { src: "203.0.113.64/26", out_interface_set: "uplinks" }, then: "accept" },
        ]),
    },
};
```

```ts
// tenants/index.ts
// Every tenant, merged whole. A new tenant joins the list.

import { tenant_a } from "./tenant-a";

export const tenants = merge([tenant_a]);
```

## How it fits together

| Piece                                                   | Does                                                                                  |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `part("device", {...})`                                 | A slice of a device, keyed by hostname. Checked like a device.                        |
| `part("filter", [...])`                                 | Rules for someone else's ordered list. Also `nat`, `acl`, `policy`, `policy-routing`. |
| `merge([tenant_a, tenant_b])`                           | Joins tenants: parts by hostname, rule lists in order.                                |
| `include: [tenants.parts]`                              | The device takes the part under its own name. The part's names become the device's.   |
| `rules: merge([own, tenants.rules.edge_forward, last])` | Places those rules where they belong in the device's own list.                        |

Circuit stops you if:

- two tenants give one name two values (like one VLAN name with two IDs). It shows both files;
- rules made with `part` aren't placed by any device. Nothing gets forgotten.

## What merge makes

You never write `...`. `merge` decides by the field it lands in:

- **A list field:** one flat list. Ordered lists keep their order; other lists drop duplicates.
- **A map field** (parts, VLANs, interfaces): merged key by key. The same key with two values is an error. An ordered list from two places is an error too.
- **No field** (like `export const tenants = merge([...])`): maps if every item is a map, else a list.

## Keep it searchable

Write a tenant's names, addresses, VLAN IDs and secrets by hand in its own file, so a text search finds them. Lots of tenants with the same shape? A function in `lib/` can build their parts, but then whoever edits it needs some TypeScript.
