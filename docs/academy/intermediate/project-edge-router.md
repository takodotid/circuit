---
title: "Project: an edge router"
description: Build Circuit's edge router example step by step, from your AS number to the firewall, make its decisions yourself, then validate and diff it.
---

# Project: an edge router

In this project you build the router that joins your network to the internet. It announces your own address space under your own AS number to a transit and at an internet exchange, filters the routes it takes in and the routes it sends out, and protects itself and your network from traffic that has no business arriving.

It is Circuit's [edge router example](/guide/examples#an-edge-router), and every lesson of this level has a part in it. You start the project, read each part of the router's file and what it does, make its key decisions yourself, then check it and see the plan.

## Start the project

[Install Circuit](/guide/install) and give the installer your AS number. Then copy the example's files into the project: `circuit.ts` with your AS, your prefixes and your communities, `sites/pop-1/edge-01.ts` with the router, and `lib/checks.ts` with a check of your own.

::: info The names in this lesson
The example calls the transit `hurricane-electric`, AS64501, and the exchange `de-cix`, whose route servers are AS64502. Replace the addresses, AS numbers and port names with the ones your providers give you.
:::

## Your AS, your prefixes and your communities

<<< @/../examples/edge-router/circuit.ts

- `asn` is your AS. Every BGP session of every device runs it, unless a device writes another.
- `prefixes.ours` is your address space, one IPv4 and one IPv6 block, each with a name. The router uses them by name: `as64500.prefixes.ours.v4`.
- `communities` is your BGP community scheme ([Route policies](/academy/intermediate/route-policy)): each route the router learns is tagged with the group it came from, `transit` or `exchange`, and the AS it came from.
- `checks` turns on two of Circuit's checks for BGP, one for the VLANs that come from outside, and one of your own, from `lib/checks.ts`.

## The router

<<< @/../examples/edge-router/sites/pop-1/edge-01.ts

Read it part by part.

### The transit and the exchange

`25g-1` and `25g-2` are access ports in the VLANs `transit` and `exchange`, and the router's address on each is on a VLAN interface. Both VLANs are written `untrusted: true`: traffic from outside arrives there, and the check `untrusted_vlans` makes sure only `edge-01` gives them an address. Each port runs the ACL `edge` in the switch chip.

### Your prefixes and the BGP sessions

There are three sessions, as in [BGP](/academy/intermediate/bgp): one with the transit, and one per address family with the exchange's route server, which passes on the routes of every member that peers with it. `role` tells each side what the other is, and `max_prefixes` is the fuse from [Route policies](/academy/intermediate/route-policy). `communities: { groups: [...] }` says which group of the scheme each neighbor is in.

A blackhole route for each of your blocks keeps it in the routing table at all times, and `originated_prefixes` announces it.

<Quiz
  question="Why does the router have a blackhole route for 198.51.100.0/24, its own block?"
  :choices="['To drop all traffic to the block', 'So the block is always in the routing table, and BGP always announces it', 'Because BGP needs a blackhole to start a session']"
  :answer="1"
  :why="['Traffic to the parts of the block in use follows their longer prefixes. Only unused addresses fall through to the blackhole.', '', 'Sessions start without it. The route is about what BGP may announce.']"
  explain="BGP announces only prefixes in the routing table. The blackhole route keeps the block there at all times, while longer routes inside it carry traffic to what is in use."
/>

### The policies

- Each import first calls `sanity`, which is `presets.bgp_sanity`: it refuses routes that should never be on the internet, such as prefixes that are too long, and RPKI invalid ones.
- It then refuses your own space coming back, tags the route with `{ communities: "import" }`, and sets a local preference: 100 for the transit, 200 for the exchange, so a route learned at the exchange wins ([Choosing a path](/academy/intermediate/best-path)).
- The export accepts your own space and rejects everything else, so you never pass one provider's routes to another.

### Protecting the router

The input chain drops by default. It accepts replies, ping, the management network, and BGP only from `bgp-neighbors`, which `bgpNeighbors()` fills with every neighbor's address. `presets.bad_tcp_flags` drops packets with flags no real connection sends.

The ACL `edge` drops a packet from outside whose source is your own block or a private range. No such sender can be out there, so the packet is forged, and the switch chip drops it before it costs the router's CPU anything.

<Quiz
  question="A packet arrives from the transit with the source address 198.51.100.7. What happens to it?"
  :choices="['It is routed to 198.51.100.7', 'The edge ACL drops it, because that address is inside your own block', 'The input chain accepts it as a reply']"
  :answer="1"
  :why="['Its destination decides where it goes, not its source. And it never gets that far.', '', 'The ACL acts in the switch chip, before the firewall ever sees the packet.']"
  explain="198.51.100.7 is inside 198.51.100.0/24, your own block. A packet from outside cannot really come from there, so it is forged, and the edge ACL drops it on arrival."
/>

## Your own check

<<< @/../examples/edge-router/lib/checks.ts

Circuit cannot know that every session of yours must filter what it takes in, so the example says it in a check of its own. `circuit.ts` turns it on as `imports_filtered`.

## Make the decisions yourself

<TryIt title="Decide what the router does">

<EdgeDecisions />

</TryIt>

## Validate, diff and apply

1. Set the router's password: `circuit secret set EDGE_01_PASSWORD`.
2. Run `circuit validate`. On the example it prints `✔ 1 device(s), no errors.`
3. Run `circuit diff edge-01`. It logs in to the router, reads what it runs now, and shows the plan. It changes nothing.
4. Run `circuit apply edge-01`. It shows the plan again and asks. Read every line, and say yes only when it is what you want.
5. Commit the files.

Once the router runs the example, a later change shows as a short plan. Here the limit for the exchange's IPv4 route server goes from 100,000 to 150,000:

```
edge-01: 1 command(s) in 1 step(s)
  /routing bgp connection
    ~ {"remote.address":"192.0.2.1/32"} input.limit-process-routes-ipv4=150000
```

`~` marks a change to something the router already has. A change inside a policy looks bigger, because policy rules run in order. When the exchange's local preference goes from 200 to 150, the plan removes every filter rule on the router and adds them all again in the order of your file, so each rule is listed twice, once with `-` and once with `+`.

Before your routes travel far, your transit and the exchange's route servers must know they are yours. They filter what you send them by the records of an internet routing registry, and many check RPKI too, so publish a route object and a ROA for each block first ([Routing security](/academy/professional/routing-security)).

<Quiz
  question="Yesterday circuit diff edge-01 planned nothing. Today someone changed the router by hand. What does circuit apply edge-01 show?"
  :choices="['Nothing to change, as yesterday', 'A plan that undoes the change made by hand', 'An error, because the router changed']"
  :answer="1"
  :why="['diff and apply read the router every time, so they see today’s change.', '', 'A change by hand is not an error. It is something the file does not hold, so the plan removes it.']"
  explain="apply reads the router first, so its plan starts from what the router runs now. The change made by hand is not in the file, so the plan undoes it, and you see that before you say yes."
/>

## Where to go from here

The example is one router with one transit. The rest of this level shows how it grows: a second transit, with [prepending](/academy/intermediate/best-path) to steer traffic coming in; a LAG to each provider, so one cable can fail, from [Staying up](/academy/intermediate/redundancy); a second edge router that shares routes with this one over iBGP, with OSPF from [Routers that talk](/academy/intermediate/ospf) finding the way between them.

## In short

- Your AS, your prefixes and your community scheme are in `circuit.ts`; the router is one file in `sites/`.
- Blackhole routes keep your blocks in the routing table, and `originated_prefixes` announces them.
- Every import runs `sanity`, refuses your own space, tags the route and sets a local preference, with the exchange at 200. The export accepts your blocks and rejects the rest.
- The input firewall allows BGP only from the neighbors, and the edge ACL drops forged sources in the switch chip.
- `validate` runs Circuit's checks and yours, `diff` shows the plan against the router, and `apply` sends it once you say yes.
