---
description: Every rule in Circuit is the same shape, if then then, for policies, filters, NAT and ACLs.
---

# Rules

Every rule has the same shape: **if** this, **then** that. No `if` means "every route" or "every packet". A short `description` is optional.

| Rule                                                                       | Kind                                                                    |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `{ if: { prefix_set: "ours" }, then: "reject" }`                           | Route policy. `then` is `accept` or `reject`, and the route stops here. |
| `{ if: { ... }, set: { local_pref: 200 }, then: "accept" }`                | Route policy that changes the route. No `then`? It moves on, changed.   |
| `{ call: "common-import" }`                                                | Runs another policy.                                                    |
| `{ communities: "import" }`                                                | Your community scheme's rules. See [Communities](/guide/communities).   |
| `{ if: { protocol: "icmp" }, then: "accept" }`                             | Firewall filter: `accept`, `drop`, `reject`, or `fast_path`.            |
| `{ if: { src: "...", out_interface_set: "uplinks" }, then: "masquerade" }` | NAT: `masquerade`, `snat` or `dnat`, with `to_address` / `to_port`.     |
| `{ if: { vlan: "...", src: "..." }, then: "drop" }`                        | Switch ACL: `accept` or `drop`, plus `rate`.                            |
| `{ match: { src: "..." }, routing_table: "..." }`                          | Policy routing.                                                         |

## Order matters here

The first rule runs first in:

- each firewall chain's `rules`;
- `firewall.nat.source` and `.destination`;
- each route policy and `routing.policy_routing`;
- each switch ACL.

No line numbers: the array order is the order. Each list is written in one place. Rules from another file come in with `merge`, so you can read the whole order in one spot. Every other list is just a set.

## Shortcuts

- **Lists in a match.** `src: ["a", "b"]` matches either. Circuit writes one rule per value. Works for `src`, `dst`, `in_interface`, `out_interface` (filter, NAT) and `vlan`, `src`, `dst` (ACL).
- **Interface sets.** `firewall.interface_sets.uplinks: ["25g-1", "25g-2"]`, then `in_interface_set: "uplinks"`. Parts can add to a set.
- **`bgpNeighbors()`.** An address set with every BGP neighbor of the device. Add a neighbor, and the set follows.
- **`management.allow`.** A list of prefixes, or the name of an address set, so you write sources once.
- **`presets`.** Ready-made rules and values from public standards, like `presets.bgp_sanity` (RFC 7454 plus RPKI invalid) and `presets.rfc1918`. Plain data: use them with `merge`, or pick bits out.
