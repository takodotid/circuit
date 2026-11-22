---
description: Circuit's built-in checks, how to write your own, and what circuit validate tells you.
---

# Checks and errors

`checks` in `circuit.ts` turns on Circuit's built-in checks and adds your own. `circuit validate` runs them all.

## Built-in checks

| Check                             | Makes sure that                                                                              |
| --------------------------------- | -------------------------------------------------------------------------------------------- |
| `untrusted_vlans`                 | A VLAN marked `untrusted: true` only gets an address on your `filtering_devices`.            |
| `exports_end_in_reject`           | Every BGP export ends with a rule that rejects everything else. Customers are left out.      |
| `imports_end_in_accept_or_reject` | Every BGP import ends with a rule that decides for every route.                              |
| `native_vlans_are_dead_ends`      | A native VLAN is native on at most one trunk per device, and no other port there carries it. |
| `tunnels_outside_offered`         | A tunnel's own address isn't inside what you announce over it.                               |
| `same_vlan_ids`                   | One VLAN name has the same ID on every device.                                               |

## Your own checks

Any other name in `checks` takes a function that gets the network and returns what it found. This one is from the [edge router example](/guide/examples#an-edge-router), where `circuit.ts` turns it on with `checks: { imports_filtered: importsFiltered }`:

<<< @/../examples/edge-router/lib/checks.ts

- Your check sees each device as the device runs it, with its parts merged in. Each `call`, `{ communities }` rule, interface set, and `management.allow` is replaced by what it stands for. An interface set that PPPoE sessions join stays a set, since a session's interface exists only while it is up. Each neighbor holds what it takes from its group.
- It gets a copy, so it can't change anything.
- Return `device` and `path` with the message, and Circuit shows the file and line.
- For IP math, use the global `address`: `.contains(outer, inner)`, `.overlaps(a, b)`, `.family(x)`, `.host(x)`, `.first(x)`, and `.last(x)`.

Only files in `lib/` import from Circuit, and only types.

## What validate tells you

Your editor catches most mistakes as you type. `circuit validate` catches the rest, with the file and line:

```
sites/site-a/switch-01.ts:32: switch-01: switching.stp.mod: no such field. Did you mean mode?
tenants/terramix.ts:21: switch-01: interfaces.ethernet.10g-5.descripton: no such field. Did you mean description?
```

It **stops** on:

- an unknown key, or a name the device doesn't have
- a port the device's model doesn't have
- a link that doesn't link back
- one value written twice with two different values
- an ordered list written in two places, or rules that no device places
- a device file with no device, or with two
- the same hostname twice
- a site with no device, or a part for a hostname that isn't a device
- `untrusted: true` while its check is off

It **warns** and goes on when a linked port's description doesn't give the device and port at the other end.

## Where the editor falls short

- Only `circuit validate` catches a typo in a key inside a part's map, such as a port in a tenant file.
- `address_sets: merge([a, b])` in a device file hides those names from the editor, so it shows false errors. Write the map out, or bring it in with `include`.
- For `const two = merge([rule_a, rule_b])`, the editor says `then is written twice`. Write `part("filter", [rule_a, rule_b])` instead.
- `bgpNeighbors()` is a whole set. Merged with other addresses, it adds nothing.
