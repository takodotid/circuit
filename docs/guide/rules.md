---
description: Every rule in Circuit has the same shape, if this then that, for route policies, firewall filters, NAT, and ACLs.
---

# Rules

Every rule has the same shape: **if** this, **then** that. A rule with no `if` applies to everything. Most rules can also have a `description`.

| Rule                                                                       | Kind           | What it does                                                                                                                                                              |
| -------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `{ if: { protocol: "icmp" }, then: "accept" }`                             | Firewall       | `then` is `accept`, `drop`, or `reject`. With `fast_path: true`, the rest of the flow skips the rules.                                                                    |
| `{ if: { src: "...", out_interface_set: "uplinks" }, then: "masquerade" }` | NAT            | `then` is `masquerade`, `snat`, or `dnat`. `snat` and `dnat` need a `to_address`, and can have a `to_port`. A source `snat` can take a [pool](#shared-addresses) instead. |
| `{ if: { vlan: "...", src: "..." }, then: "drop" }`                        | Switch ACL     | `then` is `accept` or `drop`. A `rate` drops accepted traffic over that rate.                                                                                             |
| `{ if: { prefix_set: "ours" }, then: "reject" }`                           | Route policy   | `then` is `accept` or `reject`, and the policy ends for that route.                                                                                                       |
| `{ if: { ... }, set: { local_pref: 200 } }`                                | Route policy   | If a rule has no `then`, Circuit changes the route and goes to the next rule.                                                                                             |
| `{ call: "common-import" }`                                                | Route policy   | Runs another policy. If that policy accepts or rejects the route, it stops there.                                                                                         |
| `{ communities: "import" }`                                                | Route policy   | Your [community scheme](/guide/communities)'s rules.                                                                                                                      |
| `{ match: { src: "..." }, routing_table: "..." }`                          | Policy routing | Matching traffic uses that routing table.                                                                                                                                 |

## Rule order

In these lists, the first rule runs first:

- each firewall chain's `rules`
- `firewall.nat.source` and `firewall.nat.destination`
- each route policy, and `routing.policy_routing`
- each switch ACL

Rules have no line numbers: the order of the list is the order on the device. You write each list in one place, and [`merge`](/guide/parts) brings in rules from other files.

In other lists the order doesn't matter, except in DNS and NTP `servers`, which go in order of preference.

## Shortcuts

| Shortcut           | What it does                                                                                                                                                                                          |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A list in a match  | `src: ["a", "b"]` matches either one. Circuit writes one rule per value. Filter and NAT rules take lists in `src`, `dst`, `in_interface`, and `out_interface`; ACL rules in `vlan`, `src`, and `dst`. |
| Interface sets     | `firewall.interface_sets.uplinks: ["25g-1", "25g-2"]`, then `in_interface_set: "uplinks"` in a rule. A part can add interfaces to a set.                                                              |
| `bgpNeighbors()`   | An address set with every BGP neighbor of the device. It changes when you add a neighbor.                                                                                                             |
| `management.allow` | A list of prefixes, or the name of an address set.                                                                                                                                                    |
| `presets`          | Ready-made rules and values from public standards, such as `presets.bgp_sanity` (RFC 7454, plus RPKI invalid) and `presets.rfc1918`. Use one whole, or pick items.                                    |

## Shared addresses

A source `snat` with `to_pool` and `port_set_size` shares a pool of public addresses among subscribers, as carrier-grade NAT does. Each subscriber always leaves as the same pool address, with the same block of ports, so the address and port in an abuse report name one subscriber (RFC 7422). `circuit validate` checks that the blocks fit, and says what to change when they don't. On RouterOS, each subscriber takes two firewall rules, so it warns about a pool of more subscribers than a /20, the largest tested.

<<< @/../examples/edge-router/sites/pop-1/edge-01.ts#cgnat
