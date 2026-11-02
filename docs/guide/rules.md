# Rules

Every kind of rule is plain data, the condition first: `if`, then `then`. Without `if`, a rule applies to every route or packet. Each takes an optional, short `description`.

| Written                                                                    | Does                                                                                             |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `{ if: { prefix_set: "ours" }, then: "reject" }`                           | A route policy rule. `then` is `accept` or `reject`, and ends the policy for that route.         |
| `{ if: { ... }, set: { local_pref: 200 }, then: "accept" }`                | Changes the route, then accepts it. Without `then`, the route goes on to the next rule, changed. |
| `{ call: "common-import" }`                                                | Runs another policy. It holds nothing else.                                                      |
| `{ communities: "import" }`, `{ communities: "export" }`                   | The rules the network's community scheme means there (see [Communities](/guide/communities)).    |
| `{ if: { protocol: "icmp" }, then: "accept" }`                             | A filter rule: `accept`, `drop` or `reject`; also `fast_path`.                                   |
| `{ if: { src: "...", out_interface_set: "uplinks" }, then: "masquerade" }` | A NAT rule: `masquerade`, `snat` or `dnat`; also `to_address`, `to_port`.                        |
| `{ if: { vlan: "...", src: "..." }, then: "drop" }`                        | An ACL rule: `accept` or `drop`; also `rate`.                                                    |
| `{ match: { src: "..." }, routing_table: "..." }`                          | A policy routing rule. It keeps `match`, and always writes its table.                            |

Order decides in five places, and the first rule runs first: a filter chain's `rules`, `firewall.nat.source` and `.destination`, each of `routing.policies`, `routing.policy_routing`, and each of `switching.acls`. Each is an array with no numbers, written whole in one place: the device's file or one part. Rules from another file are placed in it with `merge` (below), so the order reads in one place. Every other list is a set, and its order means nothing.

A few things in a rule save writing:

- **A list in a match.** In a filter or NAT rule, `src`, `dst`, `in_interface` and `out_interface` take a list; in an ACL rule, `vlan`, `src` and `dst`. A list matches any of its items: Circuit writes one rule per value, each with the rule's description, before a platform reads the device.
- **An interface set.** `firewall.interface_sets.uplinks` lists some of the device's ports and interfaces. A filter or NAT rule matches it with `in_interface_set` or `out_interface_set`. Each part may add its own interfaces to a set.
- **`bgpNeighbors()`**, as an address set, holds every BGP neighbor address of the device. A new neighbor needs no second line. Rules name the set, never its items.
- **`management.allow`** takes a list of prefixes, or the name of one of the device's address sets, so sources written for the firewall are written once.
- **`presets`** are rules and values from public standards, such as `presets.bgp_sanity` (RFC 7454 and RPKI invalid) and `presets.rfc1918`. They are plain data: place them with `merge`, or pick what you need.
