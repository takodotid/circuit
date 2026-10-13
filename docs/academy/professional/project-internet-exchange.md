---
title: "Project: an internet exchange"
description: Run an exchange's switches with Circuit's internet exchange example. Protect every member port, admit a new member and read the plan, and see where route servers fit.
---

# Project: an internet exchange

In [Networks of networks](/academy/intermediate/autonomous-systems) you joined an exchange as a member: one port, one address on the peering LAN, a session with the route servers. In this project you are the exchange. You run the switches every member plugs into, decide what a member's port may and may not do, and admit new members without disturbing the ones already there.

An exchange has two parts, and Circuit runs one of them:

1. **The <Term means="The switches of an exchange, which carry its peering LAN to every member's port.">fabric</Term>**: the switches that carry the peering LAN to every member port. Circuit configures it.
2. **The route servers**: servers running BGP software that pass every member's routes on to every other member. Circuit does not configure these yet.

## What the fabric must protect

Members share one LAN and do not have to trust each other. A mistake at one member, such as a loop in its own network or a switch plugged in where a router should be, must not reach the others. So exchanges publish what a member may send, and their rules are much alike. Two published examples, from LU-CIX and OHIO IX, ask that:

- every frame from a port comes from one <Term means="The hardware address of a network card, used to deliver frames inside one LAN.">MAC address</Term>, the member's router, and another one can shut the port;
- frames carry only IPv4, ARP and IPv6, told apart by their <Term means="The field in an Ethernet frame that says what it carries: 0x0800 for IPv4, 0x0806 for ARP, 0x86dd for IPv6.">ethertype</Term>;
- nothing that belongs between two neighbours leaks onto the LAN: no spanning tree, no discovery protocols such as LLDP, no DHCP;
- no broadcast or multicast, except what IPv4 and IPv6 need to find each other's hardware addresses.

MANRS, the routing security effort from [Hijacks and leaks](/academy/professional/routing-security), asks the same of an exchange in its own words: publish a policy on the traffic not allowed on the fabric, and filter it.

Circuit's `internetExchange` preset writes four of these protections onto every member port: the peering VLAN alone, no spanning tree, no LLDP, and <Term means="A switch feature that drops broadcast, multicast and unknown unicast above a set share of the port's speed, so a storm cannot flood everyone else.">storm control</Term> at 1% of the port's speed.

<TryIt title="Make a member misbehave">

All four protections start on. Make member C misbehave and see what stops it, then turn that protection off and try again.

<PortRules />

</TryIt>

Each protection keeps one member's trouble on that member's port. Without storm control, a loop in one member's network turns into a [broadcast storm](/academy/intermediate/redundancy) on the peering LAN, and reaches every router on the exchange.

::: warning Not in Circuit yet
The other two rules, one MAC address per port and only three ethertypes, are not in Circuit yet; they are on its list in [issue #16](https://github.com/takodotid/circuit/issues/16). Anything set by hand on a switch is removed by the next apply, because the file is the whole truth. So an exchange that needs them today cannot manage its fabric with Circuit yet. A small or test exchange can.
:::

<Quiz
  question="A member plugs in a new switch with a loop behind it. Which protection keeps the rest of the exchange from drowning in its broadcasts?"
  :choices="['No LLDP', 'Storm control', 'The peering VLAN alone']"
  :answer="1"
  :why="['LLDP only tells neighbours who a device is. It does nothing about a flood.', '', 'The storm is on the peering VLAN, the one VLAN every member shares. Keeping other VLANs off the port does not slow it.']"
  explain="Storm control drops broadcast, multicast and unknown unicast above 1% of the port's speed, so the loop floods only the member's own network."
/>

## Start from the example

The exchange is one of Circuit's use cases, not a pattern of `circuit new`. Copy the files of `examples/use-cases/internet-exchange/` from Circuit's repository into a project of your own:

```text
circuit.config.ts    the two switches and the exchange's check
exchange.ts          the peering LAN, the preset, the VLANs both switches share
ix-sw-01.ts          the first switch, with the route servers
ix-sw-02.ts          the second switch
members/
  cloudflare.ts      one file per member
  akamai.ts
  acme.ts
  index.ts           the list of members
```

::: info The names in this project
The example names two real networks, Cloudflare and Akamai, with their real AS numbers, and a made-up one, acme. Every address is from the ranges kept for documentation or private use.
:::

## exchange.ts

<<< @/../examples/use-cases/internet-exchange/exchange.ts

`internetExchange` takes the peering VLAN's name, the peering LAN, the addresses no member may take, here the two route servers', and the list of members. It returns two things:

- **`exchange.ports(device)`**: every member's port on that switch, set up with the four protections. Each switch puts it in its `ports`.
- **`exchange.check`**: no two members share a name, an AS, an address or a port; every address is inside the peering LAN and not reserved; and every member port carries the peering VLAN alone.

The management VLAN, 10, and the peering VLAN, 100, are declared once and used by both switches.

## A member

<<< @/../examples/use-cases/internet-exchange/members/cloudflare.ts

<<< @/../examples/use-cases/internet-exchange/members/index.ts

A member's file holds what the exchange needs to know about it: its name, its AS, its port on the switch it plugs into, and its addresses on the peering LAN. The route servers need the same facts, which is why they live in one list.

## The switches

<<< @/../examples/use-cases/internet-exchange/ix-sw-01.ts

`ix-sw-01` has Cloudflare's port from the member list, then the exchange's own: the two route servers on the peering VLAN, the trunk to `ix-sw-02`, and the way in for management. The switches have no address on the peering LAN; they only carry it. Their own address is on VLAN 10, which never reaches a member port.

<<< @/../examples/use-cases/internet-exchange/ix-sw-02.ts

`ix-sw-02` has Akamai and acme, and reaches the rest of the exchange over one trunk, port `40g-5` at both ends, carrying the peering LAN and management. `link` at both ends lets `validate` check that they carry the same VLANs.

<<< @/../examples/use-cases/internet-exchange/circuit.config.ts

## Admit a member

A new network applies to join: it calls itself `example`, its AS is 64501, and it has ordered a 10 Gbit/s port on `ix-sw-02`. You give it an address on the peering LAN and a port, write its file, and add it to `members/index.ts`.

<TryIt title="Write the new member's file">

Pick its AS, its address and its port, then run validate and diff. Every output is what Circuit printed for that combination, run on the example, against a snapshot saved from the example's own build rather than read from a device.

<MemberJoin />

</TryIt>

With every choice sound, the plan is one port, and each line is one of the protections:

| Line                              | What it does                                                                     |
| --------------------------------- | -------------------------------------------------------------------------------- |
| `- shutdown`                      | The port was shut while nobody had it; now it comes up                           |
| `+ description example, AS64501`  | The member's name and AS, written by the preset, so anyone tracing a cable knows |
| `+ port default vlan 100`         | An access port in the peering VLAN, and nothing else                             |
| `+ stp disable`                   | No spanning tree on this port                                                    |
| `+ storm control ...` (six lines) | Broadcast, multicast and unknown unicast held to 1%, the rest dropped and logged |
| `+ lldp disable`                  | The port tells the member nothing about the switch                               |

`exchange.check` stops every mistake in this widget but one: an address already taken, reserved, or outside the peering LAN, an AS that another member has, and a port that another member already has, which it reports as `ix-sw-02: port 10g-1 is given to both acme and example`. The one left, a port that the switch's own file already uses, such as the trunk, stops Circuit even earlier, while it reads the files, because `merge` refuses a port declared twice. Either way, nothing reaches a switch until the member's file is right.

<Quiz
  question="The new member is given 203.0.113.1. What does circuit validate say, and why?"
  :choices="['Nothing: the address is inside the peering LAN', 'That the address is already reserved, because route server rs1 has it', 'That the address is outside the peering LAN']"
  :answer="1"
  :why="['Being inside the LAN is not enough. exchange.ts lists the route servers’ addresses as reserved.', '', '203.0.113.1 is inside 203.0.113.0/24. The problem is who already has it.']"
  explain="exchange.ts reserves 203.0.113.1 and 203.0.113.2 for the route servers, and exchange.check refuses a member address that is reserved."
/>

## The route servers

Route servers are the other half of the exchange, and Circuit does not write their config yet: you run BGP software such as BIRD on two servers, and build its config from the same member list. The standards for them say:

- **A route server carries no traffic.** It passes every member's routes on with the next hop unchanged, so traffic goes straight from one member's router to another's across the fabric.
- **It should not add its own AS** to the routes it passes on, so members see each other's paths as if they peered directly.
- **Run more than one**, each set up the same way, so one can be down for maintenance. That is why the example reserves two addresses, `.1` and `.2`, and members keep a session with each.
- **Filter what each member sends**: a limit on how many prefixes each may announce, and filters on which. MANRS asks an exchange to filter at its route servers using the routing registries and RPKI, as in [Hijacks and leaks](/academy/professional/routing-security).

Members are free to peer with each other directly as well, over the same fabric, with sessions of their own.

## When a member leaves

A member leaves by being removed from `members/index.ts`. When acme leaves, its file can stay where it is; it is just no longer in the list:

```
ix-sw-01: matches
ix-sw-02: 13 command(s) in 1 step(s)
  interface 10GE1/0/1
    - lldp disable
    - storm control enable log
    - storm control enable trap
    - storm control action suppress
    - storm control unknown-unicast min-rate percent 1 max-rate percent 1
    - storm control multicast min-rate percent 1 max-rate percent 1
    - storm control broadcast min-rate percent 1 max-rate percent 1
    - stp disable
    - port default vlan 100
    - description acme, AS65550
    + shutdown
```

The port is shut, so whatever is still plugged into it reaches nothing. Its address, `203.0.113.12`, is free for the next member once the route servers have dropped acme's sessions.

## Further reading

- [RFC 7947, Internet Exchange BGP Route Server](https://www.rfc-editor.org/rfc/rfc7947.html): what a route server does to the routes it passes on.
- [RFC 7948, Internet Exchange BGP Route Server Operations](https://www.rfc-editor.org/rfc/rfc7948.html): running several, and filtering what members send.
- [MANRS for IXPs](https://manrs.org/ixps/): the actions an exchange takes for routing security.
- [LU-CIX network technical specifications](https://www.lu-cix.lu/network-technical-specifications/) and [OHIO IX allowed traffic](https://ohioix.net/ohioix-allowed-traffic/): two exchanges' rules for member ports.
- [Running an internet exchange](/use-cases/internet-exchange), Circuit's own page for this example, with a virtual exchange over tunnels.

## In short

- An exchange is a fabric of switches carrying one peering LAN, and route servers that pass routes between members; Circuit runs the fabric.
- Every member port carries the peering VLAN alone, takes no part in spanning tree or LLDP, and holds flooded traffic to 1%; `internetExchange` writes all four.
- One MAC address per port and an ethertype filter are not in Circuit yet, so an exchange that needs them cannot use it for its fabric today.
- A member is one file; `exchange.check` catches shared ASes, ports that are taken, and addresses that are taken, reserved or outside the LAN.
- Route servers carry no traffic, keep the next hop, come in pairs, and filter what each member announces.
