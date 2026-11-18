---
title: Untrusted VLANs end at a filter
description: A VLAN that carries traffic from outside, such as a transit, an exchange, or an ISP handoff, reaches your own VLANs only through a device that filters it, and Circuit checks it.
---

# Untrusted VLANs end at a filter

A VLAN that carries traffic from outside, such as a transit, an exchange, or an ISP handoff, reaches your own VLANs only through a device that filters it.

## Why

Nothing has filtered the traffic on a transit or exchange VLAN yet. If a switch carries it on the same port as your own VLANs, one wrong VLAN on a port puts the internet inside your network, behind your firewall. An address on the outside VLAN opens the same hole from the other side. A switch with an address on an exchange's peering LAN answers every network on the exchange.

## In Circuit

`untrusted_vlans` in `circuit.ts` turns on the check, with the devices that filter. The [edge router example](/guide/examples#an-edge-router) has one:

<<< @/../examples/edge-router/circuit.ts#untrusted-vlans

Then each outside VLAN gets `untrusted: true`, on every device that declares it:

<<< @/../examples/edge-router/sites/pop-1/edge-01.ts#outside-vlans

`circuit validate` then stops when a device that doesn't filter gives an untrusted VLAN an address. It also stops when a port or LAG carries an untrusted VLAN beside a trusted one, and neither its own device nor the device its `link` reaches filters.

Circuit trusts every VLAN without `untrusted: true`, so the check also covers a VLAN you add later. A link between two switches that must carry both, such as a site's switch extended to another building, goes in `mixed_links`.

[Project: an edge router](/academy/intermediate/project-edge-router) builds the example, and [Checks](/guide/checks#built-in-checks) lists every built-in check.
