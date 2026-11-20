---
description: What Circuit holds after it reads a project, and what the platforms read. For people who work on Circuit itself.
---

# The model

This page is for people who work on Circuit's code. To write a project, start with [Your first project](/guide/project).

The model is what Circuit holds after it reads a project: each network and its devices, as the devices run them. The platforms read only the model. Its types are in `src/model.ts`. They are the types of `src/config/`, with each name as plain text.

## The network

```
asn            the network's AS
prefixes       the network's own prefixes, in named groups, for devices, checks, and integrations
communities    the catalog: each community the scheme defines, with what it means. nnn stands for any number.
sites          by name: a description, and a number for communities. Nothing more.
devices        by hostname: one device each (below)
checks         Circuit's checks, turned on by name with their settings, and the project's own
integrations   peeringdb, librenms, netbox, prometheus
```

## A device

Each group has one job. A new feature goes in the group whose job it fits.

```
device
├─ name, site, role      its hostname, where it is, and its role in NetBox
├─ platform, model       its OS and hardware. The model decides the port names.
├─ connection            how Circuit itself logs in
├─ system                the box itself: banner, time, DNS it uses, users, logins through servers, certificates, logs kept on it, software, hardware
├─ management            how people and tools log in: ssh, https, api, native_protocol, console
├─ monitoring            what the box reports to collectors: snmp, syslog, flow export, optics
├─ interfaces            every port and interface, by kind:
│                          ethernet, lag, vlan_interface, bridge, loopback, gre, vxlan, ipsec, wireguard, eoip, pseudowire
├─ switching             layer 2 shared by ports: vlans, stp, dhcp_snooping, arp_inspection, ra_guard, lldp, acls
├─ services              what the box serves to hosts: dhcp server, dhcpv6 server, dhcp relay, pppoe server, dns server, ntp server
├─ routing               where packets go: tables, vrfs, policy_routing, static_routes, bgp, ospf, isis, mpls, bfd, rpki, policies, prefix sets
├─ firewall              which packets pass and how they are rewritten: address sets, filter, nat, tcp_mss, untracked, conntrack_helpers
└─ qos                   how traffic is told apart by its class: marking
```

Each field's doc comment in `src/config/` says what it means.

## What gets resolved

The model keeps each rule in the shape it is written in, and each [ordered list](/guide/rules#rule-order) as a plain array. Before a platform reads a device, Circuit turns the config's shortcuts into plain values:

- The [shortcuts in rules](/guide/rules#shortcuts) become rules and addresses. Circuit expands the interface or VLAN first (`in` before `out`), then `src`, then `dst`. It leaves out a `src` and a `dst` of different families.
- A `{ communities }` rule becomes route rules, split by [neighbor AS](/guide/communities#one-policy-many-neighbors). Each neighbor's `communities` is then taken out.
- An address with its length becomes the address alone, in a field that holds one host, such as `next_hop` or `local_address`. So a site can write each address once.
- A prefix set written as a map becomes a list.
- BGP without an `asn` gets the network's `asn`.

Nothing else is filled in: no default, no main table, no description. If the model leaves something out, the platform removes it from the device or resets it.

A platform may drop what it can't hold, and says so. For example, a VLAN on Raisecom and FortiOS is only a number, so they drop its description. A field that a platform can't express at all is an error before anything is sent. `untrusted: true` on a VLAN is only for its check, so no platform writes it.

## Checks

The built-in checks read the model. A project's own checks read each device in the config's shape. See [Your own checks](/guide/checks#your-own-checks).

## From Circuit 0.x

[`circuit migrate`](/reference/cli#circuit-itself) moves each field of a 0.x project into v1's groups, and renames fields. The renames people meet most:

| Circuit 0.x                                                   | v1                                                                                      |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `ports`                                                       | `interfaces.ethernet`                                                                   |
| a rule's `match`, `action`                                    | `if`, `then`                                                                            |
| filter `offload`, `src_set`, `dst_set`, `state`; NAT `to`     | `fast_path`, `src_address_set`, `dst_address_set`, `connection_state`; `to_address`     |
| `routing.static`, its `via`, `table`                          | `routing.static_routes`, `next_hop`, `routing_table`                                    |
| `routing.rules`                                               | `routing.policy_routing`                                                                |
| a neighbor's `import`, `export`, `families`, `table`, `group` | `import_policy`, `export_policy`, `address_families`, `routing_table`, `neighbor_group` |
| a port's `lag`, `acl`                                         | `in_lag`, `ingress_acl`                                                                 |
