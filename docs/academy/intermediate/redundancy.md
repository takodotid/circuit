---
title: Staying up
description: Join cables into a LAG, watch a broadcast storm grow in a loop of switches, and see how spanning tree blocks one port to stop it.
---

# Staying up

Anything your network has only one of, such as a cable, a switch, or a router, takes part of the network down when it fails. It is a <Term means="A part whose failure alone is enough to cut devices off. A second part that can do the same job removes the risk.">single point of failure</Term>. The cure is a second one.

## Two cables, one link: the LAG

A <Term means="Link aggregation group: several links between the same two devices that act as one link. It gives more capacity, and a spare if one link fails. Some platforms call it a bond or a port channel.">LAG</Term> joins several ports into one link. Both switches treat the bundle as a single port. The VLANs are set on it, and spanning tree sees one link, not several.

Traffic is shared per conversation, not per packet. Each switch picks a cable for each conversation from its addresses and ports. It keeps that conversation on that cable, so its packets never overtake each other. When a cable fails, its conversations move to the cables that still work.

Both ends must agree which cables are in the bundle, and <Term means="Link Aggregation Control Protocol: the two ends of a LAG send each other messages to agree which links belong to it. A link that does not answer as expected is kept out.">LACP</Term> checks it. A cable plugged into the wrong port, or into a switch that is not set up for the LAG, stays out of the bundle instead of causing trouble. A static LAG bundles its cables without asking.

<TryIt title="Join two switches with several cables">

Try separate links first, then one LAG. Cut cables in both.

<LagLinks />

</TryIt>

With separate links, spanning tree blocks all but one cable. With a LAG, every working cable carries some of the conversations.

In Circuit, a LAG is an entry in `interfaces.lag`, and each member port says which LAG it is in with `in_lag`. Every other setting, such as the VLANs, goes on the LAG. `mode` is LACP when absent. Write `mode: "static"` only for a device that can't speak LACP.

```ts
interfaces: {
    ethernet: {
        "10g-1": { description: "sw-02 10GE1/0/1", in_lag: "uplink", link: { device: "sw-02", port: "10g-1" } },
        "10g-2": { description: "sw-02 10GE1/0/2", in_lag: "uplink", link: { device: "sw-02", port: "10g-2" } },
    },
    lag: {
        uplink: { trunk_vlans: ["office", "servers"] },
    },
},
```

sw-02 has the same, pointing back at sw-01, so `circuit validate` can check that both ends of each cable agree.

<Quiz
  question="Two switches are joined by a LAG of four 10 Gbit/s cables. How fast can one large download between them go?"
  :choices="['40 Gbit/s', '10 Gbit/s', '20 Gbit/s, half of the cables']"
  :answer="1"
  :why="['The LAG carries 40 Gbit/s in all, but only by spreading many conversations over the cables.', '', 'Each conversation stays on one cable, however many cables the LAG has.']"
  explain="One conversation stays on one cable, so its packets arrive in order. Four cables let four conversations run at full speed at once, but no single one goes faster than 10 Gbit/s."
/>

## Loops and broadcast storms

A LAG protects you from a broken cable, but not from a broken switch. For that, you join switches in a ring, so every switch has two ways to the others.

The ring is also a loop, and Ethernet can't live with one. In [Switches](/academy/beginner/switches), a switch sent a broadcast out of every port except the one it came in on. In [Routers and the gateway](/academy/beginner/routers), a packet carried a TTL that runs out. A frame has no such counter, so in a loop, a broadcast goes round forever. With more than one loop, every switch makes extra copies as it floods. That is a <Term means="A broadcast that loops between switches and multiplies, until the links are full and the network stops working.">broadcast storm</Term>.

<TryIt title="Send a broadcast around a ring">

<LoopStorm />

</TryIt>

In a storm, every device on the network has to read each copy.

## Spanning tree blocks one port

<Term means="Spanning Tree Protocol: switches send each other small messages, called BPDUs, to find the loops between them, and block one port in each loop. STP for short.">Spanning tree</Term> keeps the cables of a loop, but blocks one port so frames can't go round. It works like this:

1. The switches elect a **root bridge**: the one with the lowest bridge priority, and among equals, the lowest MAC address.
2. Every other switch picks its **root port**: the port with the cheapest path to the root. Faster links cost less.
3. On every cable, the end closer to the root becomes the **designated port**. That end sends frames onto the cable.
4. Every other port **blocks**. It still listens to spanning tree, but it sends and receives no frames.

When a cable fails, the switches work the tree out again, and a blocked port may open. The port at sw-03 did that when you cut the cable between sw-01 and sw-02. How long it takes depends on the version. The original STP waits tens of seconds before a port forwards. RSTP, the rapid version, is much faster, and `mode: "rstp"` runs it.

If you leave the election to chance, the root may be whichever switch has the lowest MAC address. That may be a small switch in a cupboard, and traffic between the others then crosses it. So give the switch you want as root a lower priority, in steps of 4096:

```ts
switching: { stp: { mode: "rstp", priority: 4096 } },
```

A switch without `stp` in its file runs no spanning tree at all.

<Quiz
  question="Three switches all have bridge priority 32768. Which one becomes the root bridge?"
  :choices="['The one with the most ports', 'The one with the lowest MAC address', 'The one switched on first']"
  :answer="1"
  :why="['The number of ports plays no part in the election.', '', 'The election only compares bridge IDs: priority, then MAC address. The order they start in does not matter.']"
  explain="The bridge ID is the priority followed by the MAC address. With equal priorities, the lowest MAC address wins. That is why you set the priority of the switch you want as root."
/>

## Edge ports, for single devices

A port with one laptop, server, or printer behind it can never close a loop. Mark it as an edge port with `stp: { edge: true }`. Then it forwards as soon as the device is plugged in, instead of waiting until spanning tree is sure that no switch is behind it:

```ts
"10g-3": { description: "Server", access_vlan: "servers", stp: { edge: true } },
```

Never mark a port that faces another switch as an edge port, because that is exactly where a loop can form. A port that must take no part in spanning tree at all gets `stp: false`, such as a member's port at an internet exchange. It then sends no spanning tree messages, and ignores the ones it gets.

::: tip Routers are single points too
A LAG and spanning tree protect cables and switches. If the router that is a VLAN's gateway fails, two routers can share one gateway address with VRRP, `vrrp` on each router's interface.
:::

<Quiz
  question="Which port should get stp: { edge: true }?"
  :choices="['The port a server is plugged into', 'The port to another switch in the ring', 'Every port, so they all start faster']"
  :answer="0"
  :why="['', 'A switch behind the port can close a loop. Spanning tree must be allowed to block it.', 'An edge port facing a switch skips the very check that stops a loop.']"
  explain="A server is a single device, so it can never close a loop. Its port can forward at once. Ports to other switches must go through spanning tree."
/>
