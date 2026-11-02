---
title: "Project: an internet exchange"
description: Run an exchange's switches with Circuit's internet exchange example. Protect every member port, admit a new member and read the plan, and see where route servers fit.
---

# Project: an internet exchange

In [Networks of networks](/academy/intermediate/autonomous-systems) you joined an exchange as a member: one port, one address on the peering LAN, a session with the route servers. In this project you are the exchange. You run the switches every member plugs into, decide what a member's port may and may not do, and admit new members without disturbing the ones already there.

An exchange has two parts, and Circuit runs one of them:

1. **The <Term means="The switches of an exchange, which carry its peering LAN to every member's port.">fabric</Term>**: the switches that carry the peering LAN to every member port. Circuit configures it.
2. **The route servers**: servers running BGP software that pass every member's routes on to every other member. They run their own software, set up outside Circuit.

## What the fabric must protect

Members share one LAN and do not have to trust each other. A mistake at one member, such as a loop in its own network or a switch plugged in where a router should be, must not reach the others. So exchanges publish what a member may send, and their rules are much alike. Two published examples, from LU-CIX and OHIO IX, ask that:

- every frame from a port comes from one <Term means="The hardware address of a network card, used to deliver frames inside one LAN.">MAC address</Term>, the member's router, and another one can shut the port;
- frames carry only IPv4, ARP and IPv6, told apart by their <Term means="The field in an Ethernet frame that says what it carries: 0x0800 for IPv4, 0x0806 for ARP, 0x86dd for IPv6.">ethertype</Term>;
- nothing that belongs between two neighbours leaks onto the LAN: no spanning tree, no discovery protocols such as LLDP, no DHCP;
- no broadcast or multicast, except what IPv4 and IPv6 need to find each other's hardware addresses.

MANRS, the routing security effort from [Hijacks and leaks](/academy/professional/routing-security), asks the same of an exchange in its own words: publish a policy on the traffic not allowed on the fabric, and filter it.

The example writes six of these protections onto every member port, from one value in its `site.ts`: the peering VLAN alone, no spanning tree, no LLDP, one MAC address, only IPv4, ARP and IPv6, and <Term means="A switch feature that drops broadcast, multicast and unknown unicast above a set share of the port's speed, so a storm cannot flood everyone else.">storm control</Term> at 1% of the port's speed.

<TryIt title="Make a member misbehave">

All four protections start on. Make member C misbehave and see what stops it, then turn that protection off and try again.

<PortRules />

</TryIt>

Each protection keeps one member's trouble on that member's port. Without storm control, a loop in one member's network turns into a [broadcast storm](/academy/intermediate/redundancy) on the peering LAN, and reaches every router on the exchange.

::: tip Where these run
One MAC address per port, `mac_limit`, and the ethertype filter, `ethertypes`, run on the platforms that proved them on a device: see [Platforms](/platforms/). `circuit validate` refuses them on any other.
:::

<Quiz
  question="A member plugs in a new switch with a loop behind it. Which protection keeps the rest of the exchange from drowning in its broadcasts?"
  :choices="['No LLDP', 'Storm control', 'The peering VLAN alone']"
  :answer="1"
  :why="['LLDP only tells neighbours who a device is. It does nothing about a flood.', '', 'The storm is on the peering VLAN, the one VLAN every member shares. Keeping other VLANs off the port does not slow it.']"
  explain="Storm control drops broadcast, multicast and unknown unicast above 1% of the port's speed, so the loop floods only the member's own network."
/>

## Start from the example

[Install Circuit](/guide/install), then copy the [internet exchange example](/guide/examples#an-internet-exchange) into the project:

```text
my-exchange/
  circuit.ts              the exchange's AS, its peering LAN, and the checks
  sites/ix-1/site.ts      what both switches share, and what a member's port is
  sites/ix-1/ix-sw-01.ts
  sites/ix-1/ix-sw-02.ts
  members/member-a.ts     one file per member
  members/index.ts        every member, merged
  lib/checks.ts           a check of your own
```

## site.ts

<<< @/../examples/internet-exchange/sites/ix-1/site.ts

`member_port` is what every member's port is, written once. A member's file takes it whole and adds its own description.

## A member

<<< @/../examples/internet-exchange/members/member-a.ts

<<< @/../examples/internet-exchange/members/index.ts

A member is one file with its port, a part keyed by the switch it is on. `members/index.ts` merges every member; each switch takes them with `include: [members.parts]`.

## The switches

<<< @/../examples/internet-exchange/sites/ix-1/ix-sw-01.ts

The switches have no address on the peering LAN: they only carry it. Each writes what is its own: the route servers' ports, the trunk to the other switch, and the way in for management.

<<< @/../examples/internet-exchange/lib/checks.ts

## Admit a member

A new member, member-c, sent its application: AS64512, and a port on `ix-sw-02`. Write its file, and see what Circuit says.

<TryIt title="Write the new member's file">

<MemberJoin />

</TryIt>

A member's addresses on the peering LAN are for the route servers, so they are not in the switches' files. Keep them in the route servers' config, and check them there.

<Quiz
  question="The new member is given 40g-1 on ix-sw-02, member-b's port. What does circuit validate say, and why?"
  :choices="['Nothing: 40g-1 is a real port of the switch', 'It stops: two files write port 40g-1 with two descriptions, and it names both', 'It warns, and the newer file wins']"
  :answer="1"
  :why="['The port exists, but two members write it. Circuit reads every member together.', '', 'Circuit never lets one file quietly win over another. Two values for one field stop it.']"
  explain="Circuit merges every member's part for ix-sw-02, finds 40g-1 written twice with two values, and stops, naming both files. Nothing reaches the switch until one of them changes."
/>

## The route servers

Route servers are the other half of the exchange: you run BGP software, such as BIRD or OpenBGPD, on two servers, set up from the same member list. Circuit does not write their config. The standards for them say:

- **A route server carries no traffic.** It passes every member's routes on with the next hop unchanged, so traffic goes straight from one member's router to another's across the fabric.
- **It should not add its own AS** to the routes it passes on, so members see each other's paths as if they peered directly.
- **Run more than one**, each set up the same way, so one can be down for maintenance. That is why the example has two route server ports, and members keep a session with each.
- **Filter what each member sends**: a limit on how many prefixes each may announce, and filters on which. MANRS asks an exchange to filter at its route servers using the routing registries and RPKI, as in [Hijacks and leaks](/academy/professional/routing-security).

Members are free to peer with each other directly as well, over the same fabric, with sessions of their own.

## When a member leaves

A member leaves by being removed from `members/index.ts`. Its file can stay where it is; it is just no longer in the list. When member-a leaves:

```
ix-sw-01: 16 command(s) in 2 step(s)
  interface 40GE1/0/1
    - traffic-filter acl 4000 inbound
    - mac-address limit maximum 1
    - lldp disable
    - storm control enable log
    - storm control enable trap
    - storm control action suppress
    - storm control unknown-unicast min-rate percent 1 max-rate percent 1
    - storm control multicast min-rate percent 1 max-rate percent 1
    - storm control broadcast min-rate percent 1 max-rate percent 1
    - stp disable
    - port default vlan 100
    - description member-a, AS64510
    + shutdown
  ACLs no longer used
    - acl number 4000
```

The port is shut, so whatever is still plugged into it reaches nothing. Its address on the peering LAN is free for the next member once the route servers have dropped member-a's sessions.

## Further reading

- [RFC 7947, Internet Exchange BGP Route Server](https://www.rfc-editor.org/rfc/rfc7947.html): what a route server does to the routes it passes on.
- [RFC 7948, Internet Exchange BGP Route Server Operations](https://www.rfc-editor.org/rfc/rfc7948.html): running several, and filtering what members send.
- [MANRS for IXPs](https://manrs.org/ixps/): the actions an exchange takes for routing security.
- [LU-CIX network technical specifications](https://www.lu-cix.lu/network-technical-specifications/) and [OHIO IX allowed traffic](https://ohioix.net/ohioix-allowed-traffic/): two exchanges' rules for member ports.

## In short

- An exchange is a fabric of switches carrying one peering LAN, and route servers that pass routes between members; Circuit runs the fabric.
- Every member port carries the peering VLAN alone, takes no part in spanning tree or LLDP, allows one MAC address and three ethertypes, and keeps flooded traffic to 1%: one `member_port` value writes all six.
- A member is one file; Circuit stops a port that two members write.
- Route servers carry no traffic, keep the next hop, come in pairs, and filter what each member announces.
