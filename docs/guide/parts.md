---
description: Write what a tenant or a provider adds to your devices in its own file, and bring it in with include and merge.
---

# Parts and merge

A **part** is what one file adds to a device written in another file, such as a tenant's VLAN and ports, or a provider's BGP sessions.

Circuit only knows devices. "Tenant" and "provider" are your own ideas, to arrange as you like.

## A tenant in its own file

This tenant from the [colocation example](/guide/examples#colocation-with-tenants) adds VLANs and ports to the router and the switch, and an ACL rule to the router:

<<< @/../examples/colocation/tenants/netflix.ts

One file joins every tenant:

<<< @/../examples/colocation/tenants/index.ts

Each device takes its parts with `include`, and places the tenants' rules in its own list with `merge`:

```ts
// sites/dc-1/edge-01.ts, the start and the ACL
export default as64500.device({
    name: "edge-01",
    include: [tenants.parts],
    // ...
    switching: {
        acls: {
            edge: merge([
                { description: "Our own space", if: { vlan: ["transit", "exchange"], src: as64500.prefixes.ours.v4 }, then: "drop" },
                { description: "Private ranges", if: { vlan: ["transit", "exchange"], src: presets.rfc1918 }, then: "drop" },
                tenants.rules.edge_acl,
            ]),
        },
    },
});
```

## How it fits together

| Piece                                       | What it does                                                                                                              |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `part("device", {...})`                     | Part of a device, under its hostname. Checked like a device.                                                              |
| `part("acl", [...])`                        | Rules for an ordered list that a device file writes. The other kinds are `filter`, `nat`, `policy`, and `policy-routing`. |
| `merge([netflix, other_tenant])`            | Joins tenants: parts by hostname, and rule lists in order.                                                                |
| `include: [tenants.parts]`                  | The device takes the part under its hostname. The names in the part become the device's own.                              |
| `merge([own_rule, tenants.rules.edge_acl])` | Places those rules in the device's own list.                                                                              |

Circuit stops you if:

- two tenants give one name two values, such as one VLAN name with two IDs. It shows both files.
- no device places the rules that a `part` made.

## What merge makes

You never write `...`. What `merge` makes depends on the field it goes in:

- **A list field:** one flat list. Ordered lists keep their order, and other lists keep each item once.
- **A map field,** such as parts, VLANs, or interfaces: merged key by key. The same key with two values is an error, and so is an ordered list from two places.
- **No field,** such as `export const tenants = merge([...])`: a map if every item is a map, or else a list.

## Keep it searchable

Write each tenant's names, addresses, VLAN IDs, and secrets by hand in its own file, so a text search finds them. A function in `lib/` can build many tenants of the same shape, but then whoever changes it needs some TypeScript.
