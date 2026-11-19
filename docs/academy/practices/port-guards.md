---
title: Guard shared access ports
description: Where hosts of different owners share a VLAN, no host may act as a switch, a DHCP server, or a router for the others.
---

# Guard shared access ports

Where hosts of different owners share a VLAN, no host may act as a switch, a DHCP server, or a router for the others.

## Why

One host on a shared VLAN can harm every other host there, by mistake or on purpose:

- **A switch plugged into a host's port** joins the spanning tree. It can loop the VLAN, or become the root and pull traffic through itself.
- **A DHCP server** can answer before yours, and give the other hosts a gateway it chose.
- **An ARP reply** can claim another host's address, or the gateway's, so their traffic goes to the host that sent it.
- **A router advertisement** makes every IPv6 host on the VLAN use its sender as a gateway (RFC 6104).

## In Circuit

`dhcp_snooping` and `ra_guard` drop DHCP offers and router advertisements on every port of the switch except the ones marked trusted: the uplink toward your router. `arp_inspection` drops ARP from a host for an address your DHCP server didn't give it. `bpdu_guard` shuts a host's port when a BPDU arrives on it. `guard: "root"` lets a customer's own switch join the spanning tree, but never become its root. A private VLAN (RFC 5517) goes further: a host on an isolated port reaches the uplink, never another host. The switch for small tenants in the [colocation example](/guide/examples#colocation-with-tenants):

<<< @/../examples/colocation/sites/dc-1/tor-02.ts#port-guards

[Platforms](/reference/platforms#switching) lists where each works.

## Further reading

- [RFC 6104](https://www.rfc-editor.org/rfc/rfc6104): rogue IPv6 router advertisements.
- [RFC 6105](https://www.rfc-editor.org/rfc/rfc6105): how a switch drops router advertisements from hosts.
- [RFC 5517](https://www.rfc-editor.org/rfc/rfc5517): private VLANs.
