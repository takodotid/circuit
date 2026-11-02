---
description: Circuit's built-in checks, writing your own, and what circuit validate tells you.
---

# Checks and errors

`checks` in `circuit.ts` turns on Circuit's checks, and adds your own.

## Built-in checks

| Check                             | Makes sure                                                                        |
| --------------------------------- | --------------------------------------------------------------------------------- |
| `untrusted_vlans`                 | A VLAN marked `untrusted: true` only gets an address on your `filtering_devices`. |
| `exports_end_in_reject`           | Every BGP export ends with "reject everything else" (customers excepted).         |
| `imports_end_in_accept_or_reject` | Every BGP import ends with a rule that decides for every route.                   |
| `native_vlans_are_dead_ends`      | A native VLAN is native on one trunk per device, and has no other members.        |
| `tunnels_outside_offered`         | A tunnel's own address isn't inside what you announce over it.                    |
| `same_vlan_ids`                   | One VLAN name has the same ID on every device.                                    |

`untrusted: true` on a VLAN only works while `untrusted_vlans` is on.

## Your own checks

Any other name takes a function. It gets the network and returns what it found:

```ts
// lib/checks.ts
import type { Check } from "circuit";

/** Every BGP neighbor says who it is. */
export const neighborsDescribed: Check = (network) =>
    network.devices.flatMap((device) =>
        Object.entries(device.routing?.bgp?.neighbors ?? {})
            .filter(([, neighbor]) => !neighbor.description)
            .map(([name]) => ({
                device: device.name,
                path: `routing.bgp.neighbors.${name}`,
                message: "says nothing about who it is: write a description.",
            }))
    );
```

```ts
// circuit.ts
checks: { neighbors_described: neighborsDescribed },
```

- Your check sees the network as the devices will run it: parts merged, `call`s and community rules written out, sets filled in. It's a copy, so it can't change anything.
- Return `device` and `path` with the message, and Circuit points at the exact file and line.
- Need IP math? Use `address`: `address.contains(outer, inner)`, `.overlaps(a, b)`, `.family(x)`, `.host(x)`, `.first(x)`, `.last(x)`.

`lib/` is the only place that imports from Circuit, and only types: `import type { Check } from "circuit"`.

## What validate tells you

Your editor catches most mistakes as you type. `circuit validate` catches the rest, with the file and line:

```
sites/site-a/switch-01.ts:32: switch-01: switching.stp.mod: no such field. Did you mean mode?
tenants/tenant-a.ts:21: switch-01: interfaces.ethernet.10g-5.descripton: no such field. Did you mean description?
```

It **stops** on:

- an unknown key, or a name the device doesn't have;
- a port the model doesn't have;
- a link that doesn't link back;
- one value written twice with two different values;
- an ordered list written in two places, or rules placed nowhere;
- a device file with no device, or two;
- the same hostname twice;
- `untrusted: true` with its check off.

It **warns** (and goes on) when a linked port's description doesn't name the far end.

## Where the editor falls short

- A typo in a key inside a part's map (like a port in a tenant file) is only caught by `circuit validate`.
- `address_sets: merge([a, b])` in a device file hides those names from the editor, so you see false errors. Circuit reads it fine. Write the map out, or bring it in with `include`.
- `const two = merge([rule_a, rule_b])` confuses the editor (`then is written twice`). Write `part("filter", [rule_a, rule_b])`.
- `bgpNeighbors()` is a whole set. Merged with other addresses, it adds nothing.
