---
title: "Project: an edge router"
description: Build Circuit's edge router example step by step, from your AS number to the firewall, make its decisions yourself, then validate and diff it.
---

# Project: an edge router

In this project, you build Circuit's [edge router example](/guide/examples#an-edge-router). It joins your network to the internet, and announces your own address space to a transit and at an internet exchange.

## Start the project

[Install Circuit](/guide/install), and start a project with `circuit new`, which asks for your AS number. Then copy the example's three files into the project:

- `circuit.ts`, with your AS, your prefixes, and your communities
- `sites/pop-1/edge-01.ts`, with the router
- `lib/checks.ts`, with a check of your own

::: info The names in this example
The transit is Hurricane Electric, AS6939. The exchange is DE-CIX Frankfurt, whose route servers are AS6695. Replace the addresses, AS numbers, and port names with the ones your providers give you.
:::

## Your AS, your prefixes, and your communities

<<< @/../examples/edge-router/circuit.ts

- `asn` is your AS. Every BGP session of every device uses it, unless a device writes another.
- `prefixes.ours` is your address space: one IPv4 block and one IPv6 block, each with a name. The router uses them by name, such as `as64500.prefixes.ours.v4`.
- `communities` is your BGP community scheme, as in [Route policies](/academy/intermediate/route-policy#communities-tags-on-routes). The router tags each route it learns with the group it came from, `transit` or `exchange`, and with the AS it came from.
- `checks` turns on two of Circuit's checks for BGP, and one for the VLANs that come from outside. It also adds one of your own, from `lib/checks.ts`.

## The router

<<< @/../examples/edge-router/sites/pop-1/edge-01.ts

### The transit and the exchange

`25g-1` and `25g-2` are access ports in the VLANs `transit` and `exchange`, and the router's address on each is on a VLAN interface. Both VLANs are `untrusted: true`, because traffic from outside arrives there. The check `untrusted_vlans` makes sure that only `edge-01` gives them an address. Each port runs the ACL `edge` in the switch chip.

### Your prefixes and the BGP sessions

There are three sessions, as in [BGP](/academy/intermediate/bgp): one with the transit, and one per address family with the exchange's route server. `role` tells each side what the other is, and `max_prefixes` is the fuse from [Route policies](/academy/intermediate/route-policy). `communities: { groups: [...] }` says which group of the scheme each neighbor is in.

A blackhole route for each of your blocks keeps the block in the routing table at all times, and `originated_prefixes` announces it.

<Quiz
  question="Why does the router have a blackhole route for 198.51.100.0/24, its own block?"
  :choices="['To drop all traffic to the block', 'So the block is always in the routing table, and BGP always announces it', 'Because BGP needs a blackhole to start a session']"
  :answer="1"
  :why="['Traffic to the parts of the block in use follows their longer prefixes. Only unused addresses fall through to the blackhole.', '', 'Sessions start without it. The route is about what BGP may announce.']"
  explain="BGP announces only prefixes in the routing table. The blackhole route keeps the block there at all times, while longer routes inside it carry traffic to what is in use."
/>

### The policies

- Each import first calls `sanity`, which is `presets.bgp_sanity`. It refuses routes that should never be on the internet, such as prefixes that are too long, and RPKI invalid ones.
- Then the import refuses the special-purpose blocks in `presets.bogons`, such as the private ranges, and your own space coming back. It tags the route with `{ communities: "import" }`. It sets a local preference of 100 for the transit and 200 for the exchange, so a route learned at the exchange wins, as in [Choosing the best route](/academy/intermediate/best-path).
- The export accepts your own space and rejects everything else, so you never pass one provider's routes to another.

### Protecting the router

The input chain drops by default. It accepts replies, ping, the management network, and BGP from `bgp-neighbors` only. `bgpNeighbors()` fills that address set with every neighbor's address. In the forward chain, `presets.bad_tcp_flags` drops packets with flags that no real connection sends.

The ACL `edge` drops a packet from outside whose source is your own block or a private range. No such sender can be out there, so the packet is forged. The switch chip drops it before it costs the router's CPU anything.

<Quiz
  question="A packet arrives from the transit with the source address 198.51.100.7. What happens to it?"
  :choices="['It is routed to 198.51.100.7', 'The edge ACL drops it, because that address is inside your own block', 'The input chain accepts it as a reply']"
  :answer="1"
  :why="['Its destination decides where it goes, not its source. And it never gets that far.', '', 'The ACL acts in the switch chip, before the firewall ever sees the packet.']"
  explain="198.51.100.7 is inside 198.51.100.0/24, your own block. A packet from outside cannot really come from there, so it is forged, and the edge ACL drops it on arrival."
/>

## Your own check

<<< @/../examples/edge-router/lib/checks.ts

Circuit can't know that each of your sessions should have an import policy. So the example adds a check of its own, and `circuit.ts` turns it on as `imports_filtered`.

## Make the decisions yourself

<TryIt title="Decide what the router does">

<EdgeDecisions />

</TryIt>

## Validate, diff, and apply

1. Set the router's password: `circuit secrets set EDGE_01_PASSWORD`.
2. Run `circuit validate`. On the example, it prints `✔ 1 device(s), no errors.`
3. Run `circuit diff edge-01`. It logs in to the router, reads what the router runs now, and shows the plan. It changes nothing.
4. Run `circuit apply edge-01`. It shows the plan again and asks. Read every line, and say yes only when the plan is what you want.
5. Commit the files.

Once the router runs the example, a later change shows as a short plan. Here, the limit for the exchange's IPv4 route server goes from 100,000 to 150,000:

```
edge-01: 1 command(s) in 1 step(s)
  /routing bgp connection
    ~ {"remote.address":"192.0.2.1/32"} input.limit-process-routes-ipv4=150000
```

`~` marks a change to something the router already has. A change inside a policy looks bigger, because Circuit replaces the policies whole, as [Making the plan](/guide/apply#making-the-plan) explains. When the exchange's local preference goes from 200 to 150, the plan lists every filter rule on the router twice: once with `-`, and once with `+`.

Before your routes travel far, your transit and the exchange's route servers must know that the routes are yours. They filter what you send them by the records of an internet routing registry, and many check RPKI too. So first publish a route object and a ROA for each block. [Hijacks and leaks](/academy/professional/routing-security) shows how.

<Quiz
  question="Yesterday circuit diff edge-01 planned nothing. Today someone changed the router by hand. What does circuit apply edge-01 show?"
  :choices="['Nothing to change, as yesterday', 'A plan that undoes the change made by hand', 'An error, because the router changed']"
  :answer="1"
  :why="['diff and apply read the router every time, so they see today’s change.', '', 'A change by hand is not an error. It is something the file does not hold, so the plan removes it.']"
  explain="apply reads the router first, so its plan starts from what the router runs now. The change made by hand is not in the file, so the plan undoes it, and you see that before you say yes."
/>

## Where to go from here

The example is one router with one transit. To grow it, add:

- A second transit, with prepending from [Choosing the best route](/academy/intermediate/best-path) to steer the traffic coming in.
- A LAG to each provider, from [Staying up](/academy/intermediate/redundancy), so that one cable can fail.
- A second edge router that shares routes with this one over iBGP, with OSPF from [Routers that talk: OSPF](/academy/intermediate/ospf) to find the way between them.
