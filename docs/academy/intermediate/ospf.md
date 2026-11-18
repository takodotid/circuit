---
title: "Routers that talk: OSPF"
description: With OSPF, routers share a map of their links and each computes the cheapest path. Cut links and change costs, and watch the path move.
---

# Routers that talk: OSPF

With a <Term means="A way for routers to tell each other which addresses they can reach, so nobody has to write every route by hand.">routing protocol</Term>, routers tell each other what they can reach. So they find their own way, and a new one when a link fails. OSPF is a routing protocol that many networks run inside themselves.

## Why static routes are not enough

Picture three offices, each with a router, joined in a triangle. With static routes, each router needs a route for each other office's networks. It also needs a second route, with a higher distance, for the long way round. Add a fourth office, and every router needs more routes. Add a VLAN, and every other router needs a route for it.

That is a lot of writing, and it is easy to forget one. Worse, a router usually stops using a static route only when the route's own link goes down. If the trouble is one hop further on, the router keeps sending into it.

## How OSPF works

OSPF is a <Term means="A kind of routing protocol in which every router learns every link in the network, then works out its own paths from that map.">link-state</Term> protocol. Every router learns the same map of links and what each link costs. Each one computes the cheapest path to every network, and computes again whenever the map changes.

<TryIt title="Watch routers build a map and recover">

<OspfFlood />

</TryIt>

Every router ends up with the same map, but not with the same routing table. R1 and R4 read the same map from different places, so each has its own paths.

<Quiz
  question="OSPF has finished flooding in a network. What do all the routers now have in common?"
  :choices="['The same routing table', 'The same map of links and their costs', 'Only the links of their own neighbors']"
  :answer="1"
  :why="['Each router computes paths from where it stands, so their tables differ. R1 sends to R4 through R2, while R2 sends to R4 straight down its own link.', '', 'That is how it starts. Flooding passes every description on until every router knows every link.']"
  explain="Flooding gives every router the same link-state database. Each then computes its own routing table from it, with itself at the start."
/>

## Cost and the cheapest path

Each interface that OSPF runs on has a **cost**: a number for how much you would rather not send through it. The cost of a path is the sum of the costs of its links, and OSPF uses the path with the lowest total. That is not always the path with the fewest links, because two cheap links can beat one expensive link.

If you don't set a cost, the router works one out from the link's speed, so a faster link costs less. Each vendor does that its own way, and on fast links it may give every link the same cost. So set the costs yourself where the choice matters.

<TryIt title="Find the cheapest path, then break it">

Cut a link on the cheapest path, and watch the path move. Then change costs until two paths cost the same.

<OspfMap />

</TryIt>

If you cut the link from R2 to R4, the path from R1 to R6 moves to R1, R3, R5, R6, at a cost of 40. R2 still has a link to R5, but that way costs 50. When two paths cost the same, OSPF can use both and share the traffic between them. That is called <Term means="Equal-cost multipath: when several paths cost the same, the router shares traffic across all of them.">ECMP</Term>.

Each end of a link sets its own cost, for traffic that leaves through it. In the widget, both ends have the same cost. On real routers, set the same cost at both ends, unless you want traffic to take a different way back.

<Quiz
  question="From one router, path 1 crosses two links with a cost of 50 each, and path 2 crosses four links with a cost of 10 each. Which path does OSPF use?"
  :choices="['Path 1, because it crosses fewer links', 'Path 2, because its total cost is lower', 'Both, sharing the traffic']"
  :answer="1"
  :why="['OSPF does not count links. It adds up their costs, and path 1 costs 100.', '', 'OSPF only shares traffic over paths that cost exactly the same. These cost 100 and 40.']"
  explain="Path 1 costs 50 + 50 = 100, and path 2 costs 4 x 10 = 40. The lowest total wins, however many links it crosses."
/>

## Areas

Every router in an area has the same map, and every change makes all of them compute again. In a large network, that map gets big. So OSPF lets you split the network into **areas**. The routers in an area have the full map of their own area only. A router in two areas passes on a summary of what each area can reach.

Area 0 is the <Term means="The OSPF area that every other area must connect to, numbered 0. Traffic between two other areas crosses it.">backbone</Term>. Every other area connects to it, and traffic between two areas crosses it. Area numbers are written like IPv4 addresses, so area 0 is `0.0.0.0`. A network of a few dozen routers usually needs only area 0.

An area at the edge, such as a branch office with one way out, needs few routes. As a **stub area**, it takes no routes that were redistributed into OSPF, and its border router announces a default route into it instead. An **NSSA** (not-so-stubby area) is a stub area that may still redistribute routes of its own, such as a customer's static routes. With no summaries, the area doesn't take the other areas' routes either, only the default route.

## OSPF in Circuit

OSPF is `routing.ospf`. Each area, under its ID, lists the interfaces that OSPF runs on:

```ts
interfaces: {
    loopback: {
        loopback: { addresses: ["10.255.255.1/32"] },
    },
    vlan_interface: {
        office: { vlan: "office", addresses: ["10.0.1.1/24"] },
    },
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

| Field                       | What it does                                                                                                                       |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `router_id`                 | How the router is known to its neighbors. A loopback's address is a good choice: a loopback is on no cable, so it never goes down. |
| `cost`                      | The cost of sending out of this interface.                                                                                         |
| `network: "point-to-point"` | For a cable with one router at each end. It skips the election OSPF holds on a shared network, so neighbors come up sooner.        |
| `passive: true`             | Announce the interface's network, but never form a neighbor on it. Use it on every VLAN of users, because no router is there.      |
| `bfd: true`                 | Notice a dead link in under a second, instead of after many seconds without hellos.                                                |
| `redistribute`              | In `routing.ospf`: also announce routes from elsewhere, such as `["static"]`.                                                      |
| `address_families`          | In `routing.ospf`: `["ipv4", "ipv6"]` runs OSPF for IPv6 too.                                                                      |

This border router puts the branch in a totally stubby NSSA, and signs every OSPF packet on its uplink:

```ts
interfaces: {
    vlan_interface: {
        branch: { vlan: "branch", addresses: ["10.0.2.1/24"] },
    },
},

routing: {
    ospf: {
        areas: {
            "0.0.0.0": {
                interfaces: {
                    "25g-1": {
                        network: "point-to-point",
                        hello_interval: 10,
                        dead_interval: 40,
                        authentication: { algorithm: "hmac-sha-256", key_id: 1, key: secret("OSPF_CORE_KEY") },
                    },
                },
            },
            "0.0.0.10": {
                type: "nssa",
                no_summaries: true,
                stub_default_cost: 10,
                interfaces: { branch: { passive: true } },
            },
        },
    },
},
```

| Field                             | What it does                                                                                                                                   |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `type`                            | `stub` or `nssa`. Every router in the area writes the same.                                                                                    |
| `no_summaries`                    | Keep the other areas' routes out too. Write it on the border router.                                                                           |
| `stub_default_cost`               | The cost of the default route the border router announces into the area. Without it, RouterOS and Junos announce none.                         |
| `hello_interval`, `dead_interval` | Seconds between hellos, and without a hello before the neighbor is down. Both ends of a link write the same.                                   |
| `authentication`                  | Sign each packet with a key both ends share, so no other device can join. MD5 keys are 16 characters at most. OSPF for IPv6 takes no key here. |

<Quiz
  question="Your router runs OSPF on its cable to another router. You add a guests VLAN, where only phones and laptops are. How should it appear in the OSPF area?"
  :choices="['With passive: true', 'Not at all', 'With network: point-to-point']"
  :answer="0"
  :why="['', 'Then OSPF never announces the guests network, and the other routers have no route to it, unless you redistribute connected routes.', 'That is for a cable with one router at each end. A VLAN of phones and laptops has no router to talk to.']"
  explain="A passive interface puts its network on the map, so every router can reach the guests. But it never forms a neighbor there, so a device on the guests VLAN cannot join your OSPF."
/>

OSPF runs directly on IP. It uses neither TCP nor UDP. If the router's [input firewall](/academy/elementary/firewall) drops by default, let OSPF in:

```ts
// In firewall.filter.input.rules
{ description: "OSPF", if: { protocol: "ospf" }, then: "accept" },
```

To see which routers become neighbors before you apply anything, open the OSPF layer of the graph in `circuit studio`.

::: warning Not every platform runs every part
VRP and Raisecom ROS run OSPF for IPv4 only, and Raisecom ROS runs it only on VLAN interfaces. Junos and FortiOS don't run it in a VRF. `circuit validate` reports anything a platform can't do. See [Platforms](/reference/platforms).
:::
