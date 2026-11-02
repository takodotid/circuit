# Checks and errors

`checks` in `circuit()` turns on Circuit's own checks by name, and names yours.

| Check                             | Checks                                                                                                                                                                                                                            |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `untrusted_vlans`                 | Where a VLAN written `untrusted: true` may go. `filtering_devices` are the only ones that give it an address; `mixed_links` are switch pairs that may carry both kinds. `untrusted: true` is allowed only while this check is on. |
| `exports_end_in_reject`           | Every BGP export ends in a reject of everything, but toward a customer.                                                                                                                                                           |
| `imports_end_in_accept_or_reject` | Every BGP import ends in a rule that decides for every route.                                                                                                                                                                     |
| `native_vlans_are_dead_ends`      | A native VLAN is native on one trunk of a device at most, and no member anywhere on it.                                                                                                                                           |
| `tunnels_outside_offered`         | A GRE or VXLAN tunnel's local address is outside what the neighbors over it are offered.                                                                                                                                          |
| `same_vlan_ids`                   | One VLAN name has one ID on every device of the network.                                                                                                                                                                          |

Any other name takes a function of your own, which reads the network and returns what it found:

```ts
// lib/checks.ts
// Our own checks, beside Circuit's. circuit.ts names them in `checks`.

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

A check reads the network as its devices will run it: its `asn`, its `prefixes`, and each device with its parts merged, each neighbor with what it takes from its group, each `call` replaced by the called rules, `{ communities }` rules written out, and sets replaced by what they hold. It reads a copy, so it changes nothing. A finding is a `message`, and the `device` and `path` it is about when it knows them: Circuit then prints the file and line that write that path. For IP math, use the global `address`: `address.contains(outer, inner)`, `.overlaps(a, b)`, `.family(x)`, `.host(x)`, `.first(x)`, `.last(x)`.

`lib/` is the one place a project imports from Circuit, and only types: `import type { Check } from "circuit"`.

## What Circuit tells you

The editor checks most things as you type: keys, values, names, ports, sites. `circuit validate` checks the rest, and says each problem with its file and line:

```
sites/site-a/switch-01.ts:32: switch-01: switching.stp.mod: no such field. Did you mean mode?
tenants/tenant-a.ts:21: switch-01: interfaces.ethernet.10g-5.descripton: no such field. Did you mean description?
```

It stops on any key Circuit doesn't take, a name a device doesn't declare, a port the model doesn't have, a link that doesn't link back, a value two parts write with two values, an ordered list written in two places, rules placed nowhere, a device file with no device or with two, a hostname twice, and `untrusted: true` without its check. It warns, and goes on, when a linked port's description doesn't name the far end.

The editor misses some of these, and Circuit doesn't:

- A misspelt key in a map keyed by name inside a part, such as a port in a tenant's file, is caught by `circuit validate` only.
- A map written with `merge` in a device file, such as `address_sets: merge([a, b])`, hides its names from the rest of the device in the editor, which then shows false errors where they are used. Circuit reads it right. Write the map out, or bring it with `include`.
- Two single rules merged into a value of their own, `const two = merge([rule_a, rule_b])`, are read as two maps: the editor says `then is written twice`. Write `part("filter", [rule_a, rule_b])`.
- `bgpNeighbors()` is the whole set. Inside `merge` with other addresses it adds nothing.
