# Parts and merge

A part is what one file adds to a device written in another: a tenant's VLAN and ports, an upstream's sessions, a monitoring host every device sends to. Tenants and upstreams are the project's own idea, not Circuit's: Circuit only knows devices.

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

1. `part("device", {...})` is a part of a device, in a device's shape, and the editor checks it as one. Parts are keyed by hostname: `"edge-01": part("device", ...)`.
2. `part("filter", [...])` is rules for an ordered list another file writes. The kinds are `filter`, `nat`, `acl`, `policy` and `policy-routing`, and each rule is checked as its kind.
3. `merge([tenant_a, tenant_b])` makes the tenants one: parts by hostname, and each rule list with tenant A's rules first. Two tenants that give one name two values, such as one VLAN name with two IDs, stop Circuit, naming the path, both values and both files.
4. A device takes the parts with `include: [tenants.parts]`. Each source is keyed by hostname, and the device takes the part under its own `name`, merged after its own object, in the list's order. The names a part declares, such as `tenant-a`, are then the device's names too.
5. The router places the rules where they go in its own list: `rules: merge([own_rule, tenants.rules.edge_forward, last_rule])`. Rules made with `part` that no device places stop Circuit, so none is forgotten.

`merge` takes a list of items, each one value or a list, and you never write `...`. What it makes depends on the field it lands in:

- **A list field** gives one flat list. Each item is checked as one of that field's items, with the device's names. An ordered list keeps every item in order; any other list keeps the same item once.
- **A map field** (a part, VLANs, interfaces, a source keyed by hostname) is merged key by key. A list inside joins. A value written twice with two values is an error naming both files. An ordered list from two places is an error too: it is written whole in one place.
- **No field**, such as `export const tenants = merge([...])`: maps merged when every item is a map, else one list.

Write a tenant's names (VLANs, interfaces, sets), addresses, VLAN IDs and secrets by hand in its own file, so a text search finds each one. When many tenants share one shape, a function in `lib/` may build their parts from their data. Whoever changes that function then needs to read TypeScript.
