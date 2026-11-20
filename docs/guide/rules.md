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
| `{ if: { dscp: "af11" }, then: { dscp: "cs1" } }`                          | Marking        | `then` is the DSCP, the PCP, or both, that a packet the device routes leaves with. See [Marking](#marking).                                                               |

## Rule order

In these lists, the first rule runs first:

- each firewall chain's `rules`
- `firewall.nat.source` and `firewall.nat.destination`
- each route policy, and `routing.policy_routing`
- each switch ACL
- `qos.marking`

Rules have no line numbers: the order of the list is the order on the device. You write each list in one place, and [`merge`](/guide/parts) brings in rules from other files.

In other lists the order doesn't matter, except in DNS and NTP `servers`, which go in order of preference.

## Shortcuts

| Shortcut           | What it does                                                                                                                                                                                                                             |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A list in a match  | `src: ["a", "b"]` matches either one. Circuit writes one rule per value. Filter and NAT rules take lists in `src`, `dst`, `in_interface`, and `out_interface`; ACL rules in `vlan`, `src`, and `dst`; marking rules in these and `dscp`. |
| Interface sets     | `firewall.interface_sets.uplinks: ["25g-1", "25g-2"]`, then `in_interface_set: "uplinks"` in a rule. A part can add interfaces to a set.                                                                                                 |
| `bgpNeighbors()`   | An address set with every BGP neighbor of the device. It changes when you add a neighbor.                                                                                                                                                |
| `management.allow` | A list of prefixes, or the name of an address set.                                                                                                                                                                                       |
| `presets`          | Ready-made rules and values from public standards, such as `presets.bgp_sanity` (RFC 7454, plus RPKI invalid) and `presets.rfc1918`. Use one whole, or pick items.                                                                       |

## Shared addresses

A source `snat` with `to_pool` shares a pool of public addresses among subscribers, as carrier-grade NAT does. Each subscriber leaves as one pool address, with blocks of `port_set_size` TCP and UDP ports. `port_allocation` says how it gets them, and `circuit validate` checks that the blocks fit, and says what to change when they don't.

`deterministic`: each subscriber always leaves as the same pool address, with the same block of ports, worked out from its address (RFC 7422). The address and port in an abuse report name one subscriber, from the config alone. On RouterOS, each subscriber takes two firewall rules, so `validate` warns about a pool of more subscribers than a /20, the largest tested.

<<< @/../examples/edge-router/sites/pop-1/edge-01.ts#cgnat

To find the subscriber behind an address and port, run `circuit nat lookup 198.51.100.7 40000`. It reads the project and asks no device, so it is right for a past report only if the config was the same on that day. Check out the commit of that day first, found with `git log --until=<date>`. The config is the record: a deterministic pool needs no log of each translation, which is what RFC 7422 is for, so Circuit writes none.

`dynamic`: the device gives a subscriber a block when it needs one, up to `port_sets_per_subscriber` blocks, and takes it back once the block's last connection ends. Ports are used better, but only the device knows who had a block. It logs each block it gives and takes back, with the subscriber, the pool address, and the ports, so send the log to a collector in `monitoring.syslog`. FortiOS writes it at notice, and `validate` warns when no collector takes notice.

<<< @/../examples/backbone/sites/south/core-02.ts#cgnat-dynamic

RouterOS builds deterministic pools, and FortiOS dynamic ones: see [Platforms](/reference/platforms). NAT64 is not built yet ([#227](https://github.com/takodotid/circuit/issues/227)).

## Marking

`qos.marking` marks the packets a device routes with a DSCP (RFC 2474), so the routers after it can tell their classes apart, such as voice from backups. A rule matches as a firewall rule does, without the connection's state or TCP flags, and also by the DSCP a packet arrives with. The first rule that matches marks the packet. A packet that no rule matches keeps its DSCP.

<<< @/../examples/edge-router/sites/pop-1/edge-01.ts#marking

A DSCP is written by its name in the IANA DSCP registry, such as `ef` (RFC 3246), `af41` (RFC 2597), `cs6` (RFC 2474), or `le` (RFC 8622). RFC 4594 says which DSCP each kind of traffic takes. `pcp` writes a priority, 0 to 7, in the VLAN tag the packet leaves with (IEEE 802.1Q), for the switches on the way. A packet that leaves without a tag carries none.

Marking leaves the device's queues as they are. Queues that serve each class in its turn are not built yet ([#215](https://github.com/takodotid/circuit/issues/215)).
