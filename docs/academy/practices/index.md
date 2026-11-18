---
title: Best practices
description: The practices Circuit expects from a network, each with the failure it prevents and the check, preset, or field that states it.
discussion: false
---

# Best practices

## Routing

- [Exports end in a reject](/academy/practices/exports-end-in-reject): a BGP export accepts what you mean to announce, then rejects every other route.
- [Imports filter, then decide](/academy/practices/import-filters): a BGP import rejects what no neighbor should send, then ends in an accept or a reject.
- [A prefix limit on every session](/academy/practices/max-prefixes): a session closes when its neighbor sends far more routes than it should.
- [Tunnels start outside what they carry](/academy/practices/tunnel-sources): a tunnel's own address is outside every route you announce through it.

## At the edge

- [Drop forged sources](/academy/practices/anti-spoofing): a packet is dropped when its source address can't be right for the port it arrived on.
- [Drop reflected floods](/academy/practices/reflected-floods): where traffic enters, drop UDP from the ports of amplifying services nobody in your network uses.

## Management

- [Management on its own network](/academy/practices/management): only your management network may reach a device's login services.

## Switching

- [Untrusted VLANs end at a filter](/academy/practices/untrusted-vlans): traffic from outside reaches your own VLANs only through a device that filters it.
- [One VLAN name, one ID](/academy/practices/vlan-ids): a VLAN has the same ID on every device.
- [A native VLAN is a dead end](/academy/practices/native-vlans): untagged frames from a trunk go no further than that device.
- [Links written at both ends](/academy/practices/links): each cable is written on both of its ports, and each port's description gives the far end.
