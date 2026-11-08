# The model

The model is what Circuit holds once it has read a project: each network and its devices, as the devices will run them. The platforms read only the model. Its types are in `src/model.ts`: the config's own types (`src/config/`), with plain names.

Circuit is primitive: it knows devices and what one device runs. It has no idea of a tenant, an upstream or a customer. A project builds those itself, as parts it gives its devices ([How to write a project](/guide/parts)).

## The network

```
asn            the network's AS
prefixes       the network's own prefixes, in named groups, for devices, checks and integrations
communities    the catalogue: each community the scheme defines, with what it means
sites          by name: a description, and a number for communities. Nothing more.
devices        by hostname: one device each (below)
checks         Circuit's checks, turned on by name with their settings, and the project's own
integrations   peeringdb, librenms, netbox
```

## A device

Each group has one rule. A new feature goes in the group whose rule it fits.

```
device
├─ name, site, role      its hostname, where it is, and its role in NetBox
├─ platform, model       its OS and hardware. The model decides the port names.
├─ connection            how Circuit itself logs in
├─ system                the box itself: banner, time, DNS it uses, users, certificates, logs kept on it, software, hardware
├─ management            how people and tools log in: ssh, https, api, native_protocol, console
├─ monitoring            what the box reports to collectors: snmp, syslog, flow export, optics
├─ interfaces            every port and interface, by kind:
│                          ethernet, lag, vlan_interface, bridge, loopback, gre, vxlan, wireguard, eoip
├─ switching             layer 2 shared by ports: vlans, stp, lldp, acls
├─ services              what the box serves to hosts: dhcp server, dhcp relay, dns server, ntp server
├─ routing               where packets go: tables, vrfs, policy_routing, static_routes, bgp, ospf, bfd, rpki, policies, prefix sets
└─ firewall              which packets pass and how they are rewritten: address sets, filter, nat, tcp_mss, untracked, conntrack_helpers
```

Every field and its meaning is in `src/config/`, as a doc comment: the editor shows it on hover.

### Against Winbox

Winbox was the reference, not the target. Circuit runs on five platforms, so a group is named for what it does, not for one vendor's menu.

| Winbox                                                            | Circuit v1                                                                                          |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Interfaces (Ethernet, VLAN, Bonding, GRE, VXLAN, WireGuard, EoIP) | `interfaces.ethernet`, `.vlan_interface`, `.lag`, `.gre`, `.vxlan`, `.wireguard`, `.eoip`           |
| Interfaces > Interface List                                       | `firewall.interface_sets` in the config (a FortiOS zone too); resolved into interfaces in the model |
| Bridge (Ports, VLANs, Settings), Switch (Rules)                   | `switching.vlans`, `.stp`, `.acls`; a port's own VLANs on the port                                  |
| IP > Addresses                                                    | on the interface: `addresses`. Junos, VRP and FortiOS put them there too.                           |
| IP > Routes, Routing > Tables, Rules, BGP, OSPF, BFD, RPKI        | `routing.static_routes`, `.tables`, `.policy_routing`, `.bgp`, `.ospf`, `.bfd`, `.rpki`             |
| Routing > Filters                                                 | `routing.policies`, `routing.prefix_sets`                                                           |
| IP > Firewall (Filter, NAT, Raw, Address Lists, Service Ports)    | `firewall.filter`, `.nat`, `.untracked`, `.address_sets`, `.conntrack_helpers`                      |
| IP > Firewall > Mangle (change MSS)                               | `firewall.tcp_mss`                                                                                  |
| Queues (an interface's queue, CAKE)                               | `shaping` on the interface                                                                          |
| IP > DHCP Server, DHCP Relay, DNS (allow remote), NTP Server      | `services`                                                                                          |
| IP > Services, System > Users, Certificates                       | `management`; `system.users`, `system.certificates`                                                 |
| IP > SNMP, System > Logging (remote), IP > Traffic Flow           | `monitoring.snmp`, `.syslog`, `.flow_export`                                                        |
| System > Clock, NTP Client, Identity, Logging (disk), Packages    | `system.timezone`, `.ntp`, `.banner`, `.logging`, `.release_channel`                                |
| IP > Neighbors (discovery)                                        | `switching.lldp`                                                                                    |
| (none: FortiOS VDOMs, VRP alarms, optic readings)                 | `system.vdoms`, `system.alarms`, `monitoring.transceivers`                                          |

## Ordered rules

Where order decides, the first rule runs first:

- `firewall.filter.<input|forward|output>.rules`
- `firewall.nat.source`, `firewall.nat.destination`
- `routing.policies.<name>`
- `routing.policy_routing`
- `switching.acls.<name>`

Each is a plain array, with no numbers, in the model as in the config. Every other list is a set: its order means nothing (`static_routes`, `addresses`, `trunk_vlans`, BGP neighbors), except `servers`, in order of preference.

Every rule keeps the shape it is written in, the condition first:

- A filter, NAT or ACL rule is `{ if, then }`, with its own fields: `fast_path` on a filter rule, `to_address` and `to_port` on a NAT rule, `rate` on an ACL rule.
- A route policy rule is `{ if, set, then }`, or `{ call }` alone.
- A policy routing rule keeps `match`, and always has its `routing_table`: choosing the table is what the rule is for.

## What Circuit resolves

The config may write a few things in a shorter way. Circuit turns each into plain values before a platform reads the device, so a platform sees only the model:

1. **A list in a match** becomes one rule per value. In a filter or NAT rule, `src`, `dst`, `in_interface` and `out_interface` take a list; in an ACL rule, `vlan`, `src` and `dst`. Circuit writes one rule per combination, each with the rule's description: the interface or VLAN outermost (`in` before `out`), then `src`, then `dst`. A `src` and a `dst` of different families match no packet, so that combination is left out; a rule with nothing else is an error.
2. **An interface set** becomes its interfaces. A filter or NAT rule's `in_interface_set` or `out_interface_set` becomes `in_interface` or `out_interface`, one rule per interface, and `firewall.interface_sets` is not in the model. A rule whose set has no interface is left out.
3. **`bgpNeighbors()`** becomes the address set of every BGP neighbor address of the device.
4. **`management.allow` naming an address set** becomes that set's addresses.
5. **An address written with its length, where the field names one host**, becomes the address alone: a static route's `next_hop`, a GRE, VXLAN or BGP `local_address`, a WireGuard `endpoint`, a NAT rule's `to_address`, a route policy's `preferred_source`, an NTP server. So a site writes each address once, with its length, for its interfaces too.
6. **A prefix set written as a map of named prefixes** becomes the list of its prefixes. A set may hold both families; where the platform keeps one list per family, the renderer writes one of each.
7. **A `{ communities }` route policy rule** becomes the route rules the network's scheme means there, for the neighbors that use the policy. A policy several ASes use keeps what they share, and each AS with rules of its own gets `<policy>-as<asn>`, which holds them and then calls the shared one. Each neighbor's `communities` is then taken off: only Circuit reads it.
8. **BGP without `asn`** gets the network's `asn`. The model needs an AS there, and this is the network's own, not a guess.

Nothing else is filled in. A default is not written, by the project or by Circuit: no main table, no distance 1, no description. What a device leaves out stays out, and the platform then removes it from the device or sets it back to its default.

A renderer may still leave out what its platform can't hold, and says so: a VLAN's description on Raisecom and FortiOS, where a VLAN is only its number, is dropped there, so a device takes a VLAN whole wherever it runs. A field a platform can't express at all is an error before anything is sent.

`untrusted: true` on a VLAN stays in the model for the check `untrusted_vlans`, and no platform renders it.

## Communities

`communities` in the model is the catalogue: every community the scheme defines, `nnn` for any number, with what it means. The scheme itself, and how a neighbor and a policy use it, is in [How to write a project](/guide/communities).

## Checks

Circuit's own checks read the model. A check of the project's own reads the network as its devices will run it, still in the config's shape: its `asn` and `prefixes`, and each device with each neighbor holding what it takes from its group, each `call` replaced by the called policy's rules, `{ communities }` rules written out, `management.allow` as its addresses, and each rule's interface set as its interfaces. It gets a copy: the project doesn't change. [How to write a project](/guide/checks) lists the checks and how to write one.

## From Circuit 0.x

A 0.x device holds the same values in other places and under other names. `scripts/from-v0.ts` moves a 0.x device into the model.

| Circuit 0.x                                                       | v1                                                                          |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `site: (device) => string` in `defineNetwork`                     | `site` on the device; `sites` in `circuit()` holds each site's description  |
| `netbox.device(device).role`                                      | `role` on the device                                                        |
| `asn`, `communities`, `peeringdb`, `librenms`, `netbox`           | `circuit({ asn, communities, integrations })`                               |
| `checks: Check[]`                                                 | `checks`, by name, in `circuit()`                                           |
| `ports`                                                           | `interfaces.ethernet`                                                       |
| `interfaces.<name>` with `type: T`                                | `interfaces.<T>.<name>`, without `type`; `vlan` is `vlan_interface`         |
| `vlans`, `stp`, `lldp`, `acls`                                    | `switching.*`                                                               |
| `dhcp`, `dhcp_relay`                                              | `services.dhcp_server`, `services.dhcp_relay`                               |
| `system.dns.serve`, `system.ntp.serve`                            | `services.dns_server`, `services.ntp_server`                                |
| `system.logging.remote`                                           | `monitoring.syslog`                                                         |
| `management.snmp`, `flow_export`, `system.transceiver_monitoring` | `monitoring.snmp`, `.flow_export`, `.transceivers`                          |
| `users`, `certificates`, `hardware_offload`, `vdoms`              | `system.*`                                                                  |
| `certificates.<name>.certificate`, the PEM                        | `system.certificates.<name>.certificate_file`, a path from the project root |
| `vrfs`, `policies`, `prefix_sets`                                 | `routing.*`                                                                 |

Then the renames, so each field name says what it is:

| Circuit 0.x                                                        | v1                                                                                      |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| a rule's `match`, `action` (filter, NAT, ACL, route policy)        | `if`, `then`                                                                            |
| filter `offload`; NAT `to`                                         | `fast_path`; `to_address`                                                               |
| filter match `src_set`, `dst_set`, `state`                         | `src_address_set`, `dst_address_set`, `connection_state`                                |
| route match `through_as`, `community`                              | `as_path_contains`, `standard_community`                                                |
| route set `communities`, `add_communities`, `remove_communities`   | `standard_communities`, `add_standard_communities`, `remove_standard_communities`       |
| `routing.static`, its `via`, `table`                               | `routing.static_routes`, `next_hop`, `routing_table`                                    |
| `routing.rules`, its `table`                                       | `routing.policy_routing`, `routing_table`                                               |
| BGP `groups`, `networks`                                           | `neighbor_groups`, `originated_prefixes`                                                |
| a neighbor's `import`, `export`, `families`, `table`, `group`      | `import_policy`, `export_policy`, `address_families`, `routing_table`, `neighbor_group` |
| OSPF `families`                                                    | `address_families`                                                                      |
| a port's or interface's `lag`, `acl`, `local`, `remote`, `members` | `in_lag`, `ingress_acl`, `local_address`, `remote_address`, `member_interfaces`         |
| an address's `peer`                                                | `peer_address`                                                                          |
| `system.ip`; `management.native`                                   | `system.ip_stack`; `management.native_protocol`                                         |
| a filter chain's `default`; `firewall.helpers`                     | `default_action`; `conntrack_helpers`                                                   |
| a VDOM's `static`                                                  | `static_routes`                                                                         |
| `connection.console.passwordOnly`                                  | `password_only`                                                                         |

A 0.x call rule's description has no place in v1: a call rule holds nothing but `call`.
