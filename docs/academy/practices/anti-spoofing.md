---
title: Drop forged sources
description: Where traffic enters your network, drop each packet whose source address can't be right for the port it arrived on, as BCP 38 and BCP 84 ask.
---

# Drop forged sources

Where traffic enters your network, drop each packet whose source address can't be right for the port it arrived on.

## Why

Nothing on the way checks a packet's source address, so a sender can write any address there. Forged sources let one attacker make thousands of servers flood a victim, as [Drop reflected floods](/academy/practices/reflected-floods) shows. They also get past any rule that trusts an address.

Some sources are always forged:

- **From the internet**: your own space and the private ranges. Packets from your own space start inside your network, and private ranges aren't routed on the internet.
- **From a customer**: anything outside the customer's own space. BCP 38 asks every provider to drop these, so no forged flood can start from its network.

## In Circuit

A switch-chip ACL drops them before they reach the router's CPU. The [edge router example](/guide/examples#an-edge-router) runs this one on both of its outside ports, with `ingress_acl: "edge"`:

```ts
// In the switch chip, before a packet reaches the router's CPU: nothing from outside may claim our addresses or private ones.
acls: {
    edge: [
        { description: "Our own space", if: { vlan: ["transit", "exchange"], src: as64500.prefixes.ours.v4 }, then: "drop" },
        { description: "Private ranges", if: { vlan: ["transit", "exchange"], src: presets.rfc1918 }, then: "drop" },
    ],
},
```

`presets.rfc1918` holds the private ranges, and `presets.bogons` holds every special-purpose block. For a customer, an ACL on its port accepts its own space and drops the rest, as [Attacks on the network](/academy/professional/ddos-and-spoofing#anti-spoofing-in-circuit) shows. On Junos, `bound_to` also ties an access port to its hosts' MAC and IP addresses.

## Further reading

- [RFC 2827 (BCP 38)](https://www.rfc-editor.org/rfc/rfc2827): filtering what customers send.
- [RFC 3704 (BCP 84)](https://www.rfc-editor.org/rfc/rfc3704): the same for networks with several upstreams, and uRPF.
- [MANRS implementation guide for network operators](https://manrs.org/netops/guide/), on anti-spoofing.
