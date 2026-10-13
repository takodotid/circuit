---
title: "Routers that talk: OSPF"
description: With OSPF, routers share a map of their links and each computes the cheapest path. Cut links and change costs, and watch the path move.
---

# Routers that talk: OSPF

A static route never changes on its own. When a link breaks, the router only has another way if someone wrote one in advance. A <Term means="A way for routers to tell each other which addresses they can reach, so nobody has to write every route by hand.">routing protocol</Term> lets routers tell each other what they can reach, so they find their own way, and a new one when a link fails.

OSPF is a routing protocol many networks run inside themselves. Every router learns the whole map of links and what each one costs, computes the cheapest path to every network, and computes again whenever the map changes.

## Why static routes are not enough

Picture three offices, each with a router, joined in a triangle. With static routes, each router needs a route for each other office's networks, and a second route with a higher distance for the long way round. Add a fourth office and every router needs more routes. Add a new VLAN and every other router needs a route for it.

That is a lot of writing, and it is easy to forget one. Worse, a static route usually stops being used only when its own link goes down. If the trouble is one hop further on, the router keeps sending into it. A routing protocol replaces all of this with routers that ask each other.

## How OSPF works

OSPF is a <Term means="A kind of routing protocol in which every router learns every link in the network, then computes its own paths from that map.">link-state</Term> protocol. That means every router holds the same map, and each works out its own routes from it:

1. **Neighbors.** Each router sends hello messages out of every interface OSPF runs on. Two routers that hear each other become neighbors.
2. **Descriptions.** Each router describes its own links and their costs in a <Term means="A message in which one OSPF router describes its own links and their costs. LSA for short.">link-state advertisement</Term>.
3. **Flooding.** Each router passes every description it receives on to its other neighbors, until every router holds every description: the same map, called the link-state database.
4. **Shortest paths.** Each router runs the shortest path first calculation over the map, with itself at the start, and puts the results in its routing table.
5. **Changes.** When a link comes or goes, the routers at its ends send new descriptions, these are flooded the same way, and every router computes again.

<TryIt title="Watch routers build a map and recover">

Step through four routers finding each other, sharing their links and computing their paths. Watch the grid on the right: it is what each router knows. Then a link fails.

<OspfFlood />

</TryIt>

The grid shows the part people often miss: every router ends up with the same map, but not the same routing table. R1 and R4 read the same map from different places, so each has its own paths.

<Quiz
  question="OSPF has finished flooding in a network. What do all the routers now have in common?"
  :choices="['The same routing table', 'The same map of links and their costs', 'Only the links of their own neighbors']"
  :answer="1"
  :why="['Each router computes paths from where it stands, so their tables differ. R1 sends to R4 through R2, while R2 sends to R4 straight down its own link.', '', 'That is how it starts. Flooding passes every description on until every router knows every link.']"
  explain="Flooding gives every router the same link-state database. Each then computes its own routing table from it, with itself at the start."
/>

## Cost and the cheapest path

Each interface OSPF runs on has a **cost**, a number for how much you would rather not send through it. The cost of a path is the sum of the costs of the links it crosses, and OSPF uses the path with the lowest total. That is not always the path with the fewest links: two cheap links can beat one expensive one.

If you do not set a cost, the router works one out from the link's speed, so a faster link costs less. How it does that differs by vendor, and on fast links it may give every link the same cost, so set costs yourself where the choice matters.

<TryIt title="Find the cheapest path, then break it">

Pick two routers and see the cheapest path between them. Cut a link on that path and watch the path move. Change costs until two paths cost the same. Below the map is the routing table OSPF builds on the router you send from, and the part of its file that sets its costs.

<OspfMap />

</TryIt>

When you cut the link from R2 to R4, the path from R1 to R6 moved to R1, R3, R5, R6 at a cost of 40, even though R2 still has a link to R5. That way costs 50. When two paths cost the same, OSPF can use both and share the traffic between them, which is called <Term means="Equal-cost multipath: when several paths cost the same, the router sends traffic over all of them, so it is shared.">ECMP</Term>.

Each end of a link sets its own cost, for traffic leaving through it. In the widget both ends have the same cost; on real routers, set the same cost at both ends unless you want traffic to take a different way back.

<Quiz
  question="From router A, path 1 crosses two links with a cost of 50 each, and path 2 crosses four links with a cost of 10 each. Which path does OSPF use?"
  :choices="['Path 1, because it crosses fewer links', 'Path 2, because its total cost is lower', 'Both, sharing the traffic']"
  :answer="1"
  :why="['OSPF does not count links. It adds up their costs, and path 1 costs 100.', '', 'OSPF only shares traffic over paths that cost exactly the same. These cost 100 and 40.']"
  explain="Path 1 costs 50 + 50 = 100, and path 2 costs 4 x 10 = 40. The lowest total wins, however many links it crosses."
/>

## Areas

Every router in the same area holds the same map, and every change makes all of them compute again. In a large network that map gets big. OSPF lets you split the network into **areas**: the routers in an area hold the full map of their own area only, and a router that sits in two areas passes on a summary of what each can reach.

Area 0 is the <Term means="Area 0, the area every other OSPF area must connect to. Traffic between two other areas crosses it.">backbone</Term>. Every other area connects to it, and traffic between two areas crosses it. Area numbers are written like IPv4 addresses, so area 0 is `0.0.0.0`. A network of a few dozen routers is usually happy in area 0 alone.

## OSPF in Circuit

OSPF is `routing.ospf`. Each area, keyed by its ID, lists the interfaces it runs on:

```ts
interfaces: {
    loopback: { type: "loopback", addresses: ["10.255.255.1/32"] },
    office: { type: "vlan", vlan: "office", addresses: ["10.0.1.1/24"] },
},

routing: {
    router_id: "10.255.255.1",
    ospf: {
        areas: {
            "0.0.0.0": {
                interfaces: {
                    "25g-1": { cost: 10, network: "point-to-point", bfd: true },
                    "25g-2": { cost: 10, network: "point-to-point", bfd: true },
                    loopback: { passive: true },
                    office: { passive: true },
                },
            },
        },
    },
},
```

| Field                       | What it does                                                                                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `router_id`                 | Names the router to its neighbors. The address of a loopback, an interface that belongs to no cable, is a good choice, since it never goes down. |
| `cost`                      | The cost of sending out of this interface.                                                                                                       |
| `network: "point-to-point"` | For a cable with one router at each end. It skips the election OSPF otherwise holds on a shared network, so neighbors come up sooner.            |
| `passive: true`             | Announce the interface's network, but never form a neighbor on it. Use it on every VLAN where users are, since no router lives there.            |
| `bfd: true`                 | Notice a dead link in under a second, instead of after many seconds without hellos.                                                              |
| `redistribute`              | Also announce routes from elsewhere, such as `["static"]`.                                                                                       |
| `families`                  | `["ipv4", "ipv6"]` runs OSPF for IPv6 too.                                                                                                       |

<Quiz
  question="Your router runs OSPF on its cable to another router. You add a guests VLAN, where only phones and laptops are. How should it appear in the OSPF area?"
  :choices="['With passive: true', 'Not at all', 'With network: point-to-point']"
  :answer="0"
  :why="['', 'Then OSPF never announces the guests network, and the other routers have no route to it, unless you redistribute connected routes.', 'That is for a cable with one router at each end. A VLAN of phones and laptops has no router to talk to.']"
  explain="A passive interface puts its network on the map, so every router can reach the guests, but never forms a neighbor there, so a device on the guests VLAN cannot join your OSPF."
/>

OSPF talks directly over IP, not over TCP or UDP. If the router's input firewall drops by default, as in [Firewalls](/academy/elementary/firewall), let it in:

```ts
{ description: "OSPF", match: { protocol: "ospf" }, action: "accept" },
```

To check who will become neighbors before you apply anything, open the OSPF layer of `npx circuit studio`, or run `npx circuit graph --layer=ospf`.

::: warning Not every platform runs every part
On `vrp`, OSPF runs for IPv4 only. On `raisecom-ros`, it runs for IPv4 only, on VLAN interfaces only, and without `bfd`. `circuit validate` reports anything a platform cannot do. See [Platforms](/platforms/).
:::

## In short

- A routing protocol lets routers tell each other what they reach, so they find a new way when a link fails.
- In OSPF, routers find neighbors with hellos, flood descriptions of their links, and all end up with the same map.
- Each router computes the cheapest path to every network from that map; the cost of a path is the sum of its links' costs.
- A failed link is flooded as a change, and every router computes again. BFD makes the failure noticed in under a second.
- Area 0 is the backbone. In Circuit, OSPF is `routing.ospf`, with an area's interfaces, their `cost`, and `passive` for user VLANs.
