---
title: Routing tables
description: A router sends each packet by the longest route that holds its address. Look addresses up in a real table, add routes, and write them in Circuit.
---

# Routing tables

A routing table is a router's list of routes. Each route is a prefix, a block of addresses, and where to send traffic for it: to the next router on the way, or out of one of the router's own interfaces. For every packet, the router finds all the routes whose prefix holds the destination address, and uses the one with the longest prefix.

You met the routing table in [Routers and the gateway](/academy/beginner/routers). This lesson opens it up: where the routes come from, how a router picks one when several match, and how you write routes in Circuit.

## What a route says

Here are two routes from the table of a small office router:

| Prefix         | Sends to                                | Where the route comes from                           |
| -------------- | --------------------------------------- | ---------------------------------------------------- |
| `10.0.10.0/24` | out of the `office` VLAN, to the device | The router has the address 10.0.10.1/24 on that VLAN |
| `0.0.0.0/0`    | the router at 203.0.113.1               | Someone wrote it by hand                             |

The address a route sends to is its <Term means="The next router on the way to a destination. It must be on one of this router's own networks, so the router can hand the packet straight to it.">next hop</Term>. The next hop does not know the whole way either: it has its own table and makes its own choice. That is what passing a packet on hop by hop means.

Routes come from three places:

1. **Connected routes** come from the router's own addresses. When a VLAN interface has the address 10.0.10.1/24, the router knows the whole of 10.0.10.0/24 is right there on that VLAN, and adds a route for it. You never write these.
2. **Static routes** are written by hand: "for 10.20.0.0/16, send to 10.0.10.254".
3. **Learned routes** come from other routers, through a <Term means="A way for routers to tell each other which addresses they can reach, so nobody has to write every route by hand.">routing protocol</Term>. OSPF and BGP, later in this level, are two of them.

<Quiz
  question="You remove the address 10.0.20.1/24 from the router's guests VLAN interface. What happens to the route for 10.0.20.0/24?"
  :choices="['It stays, because routes are kept until someone deletes them', 'It disappears, because it came from that address', 'It turns into a static route']"
  :answer="1"
  :why="['That is true of a static route, which you write and remove by hand. This one is connected: it exists only because of the address.', '', 'A router never writes static routes on its own. Only you do.']"
  explain="A connected route exists because the router has an address on that network. Take the address away and the router no longer reaches that network directly, so the route goes with it."
/>

## The default route

The prefix `0.0.0.0/0` has a length of 0. It compares no bits at all, so it holds every IPv4 address there is. A route for it is the **default route**: the one used when nothing more specific matches. In a small network it points at the internet provider.

Your laptop's default gateway is the same idea, on a smaller scale: a routing table with a connected route for its own network and a default route through the router.

## The longest match wins

For each packet, a router does this:

1. It reads the packet's destination address.
2. It finds every route whose prefix holds the address. A prefix of length 24 holds an address when the first 24 bits of the address are the same as the first 24 bits of the prefix. The rest are not compared.
3. Of those routes, it picks the one with the longest prefix.
4. It sends the packet where that route says. If no route holds the address, it drops the packet.

A longer prefix is a smaller block, so it says more exactly where the address is. `10.0.10.0/24` is 256 addresses on one VLAN; `0.0.0.0/0` is every address. When both hold 10.0.10.25, the route that knows more wins.

<TryIt title="Look up addresses in a routing table">

Pick an address and see which routes hold it and which one wins. Compare the bits with a route that does not match to see where they part. Then add a route, such as `10.0.0.0/8` to the blackhole, and look up `10.0.11.7` again.

<RouteLookup />

</TryIt>

The widget lists the longest prefix first, but the order of a routing table decides nothing. The length does. That is the opposite of the firewall rules from [Firewalls](/academy/elementary/firewall), which are read from the top and stop at the first match.

<Quiz
  question="A router has four routes: 10.0.0.0/8 to router A, 10.1.0.0/16 to router B, 10.1.2.0/24 to router C, and 0.0.0.0/0 to router D. Where does a packet for 10.1.3.4 go?"
  :choices="['Router A', 'Router B', 'Router C', 'Router D']"
  :answer="1"
  :why="['10.0.0.0/8 does hold 10.1.3.4, but 10.1.0.0/16 holds it too, and /16 is longer.', '', '10.1.2.0/24 holds 10.1.2.0 to 10.1.2.255. The third number of 10.1.3.4 is 3, so it is not in that block.', 'The default route holds every address, but it is the shortest of all, so it only wins when nothing else matches.']"
  explain="Three routes hold 10.1.3.4: the /8, the /16 and the default. The /24 does not, since 10.1.3.4 is outside 10.1.2.0 to 10.1.2.255. The longest of the three is the /16, so the packet goes to router B."
/>

### The same prefix twice

When two routes have exactly the same prefix, length cannot choose between them. The router then compares their <Term means="A preference number between routes to the same prefix. Lower wins. Each vendor has its own defaults.">distance</Term>, and the lower one wins. A connected route always beats a static one. A backup internet line is often written as a second default route with a higher distance, so it is only used when the first route is gone, for example because its link went down.

## Blackhole routes

A blackhole route sends traffic nowhere: the router drops whatever matches it. That sounds useless, but it stops a loop that is easy to build by accident.

Say your internet provider gives you the block `198.51.100.0/24`, and so far you use only `198.51.100.0/26` for your office. The provider's routers send the whole /24 to you. A packet arrives for 198.51.100.200, an address you have not used. Your router has a connected route for the /26, which does not hold it, and the default route, which does. So it sends the packet back to the provider, which sends it to you again.

<TryIt title="Send a packet to an address nobody uses">

Send a packet to the unused address and watch the TTL fall on each trip. Then turn on the blackhole route for your whole block and send it again. Try the office server too, with the blackhole on.

<RouteLoop />

</TryIt>

The packet only stops when its <Term means="Time to live: a counter in every packet that each router lowers by one. At zero the packet is dropped, so it cannot circle forever.">TTL</Term> runs out, and every trip uses your link to the provider, which you pay for. With the blackhole route, your router drops it on the first arrival. The office server still gets its packets, because `198.51.100.0/26` is longer than `198.51.100.0/24`: the blackhole only catches addresses that no more specific route holds. That is the longest match working for you.

A blackhole route has one more use, which you meet in the [BGP](/academy/intermediate/bgp) lesson: it keeps your whole block in the routing table even when nothing inside it is up, so the router keeps announcing it to the internet.

<Quiz
  question="Your router has a blackhole route for 198.51.100.0/24 and a connected route for 198.51.100.64/26 on the servers VLAN. A packet for 198.51.100.70 arrives. What happens?"
  :choices="['It is dropped, because the blackhole route holds it', 'It goes to the servers VLAN', 'It goes back to the provider by the default route']"
  :answer="1"
  :why="['The blackhole route does hold it, but so does the /26, and the /26 is longer.', '', 'The default route only wins when nothing longer holds the address. Two longer routes do.']"
  explain="198.51.100.64/26 holds 198.51.100.64 to 198.51.100.127, so it holds .70. It is longer than the blackhole's /24, so the packet goes to the servers VLAN."
/>

## Routes in Circuit

In Circuit, connected routes come from the `addresses` you give ports and interfaces, so you never write them. Static routes are a list under `routing.static`:

```ts
ports: {
    "25g-1": { description: "Internet provider", addresses: ["203.0.113.2/30"] },
},
interfaces: {
    office: { type: "vlan", vlan: "office", addresses: ["10.0.10.1/24"] },
    guests: { type: "vlan", vlan: "guests", addresses: ["10.0.20.1/24"] },
},

routing: {
    static: [
        { prefix: "0.0.0.0/0", via: "203.0.113.1", description: "Internet provider" },
        { prefix: "0.0.0.0/0", via: "10.0.10.253", distance: 10, description: "Backup line" },
        { prefix: "10.20.0.0/16", via: "10.0.10.254", description: "Lab, behind the lab router" },
        { prefix: "10.0.0.0/8", blackhole: true, description: "Private space we do not use" },
    ],
},
```

| Field         | What it says                                                         |
| ------------- | -------------------------------------------------------------------- |
| `prefix`      | The block the route is for.                                          |
| `via`         | The next hop's address.                                              |
| `interface`   | The interface to send out of, for a link without a next hop address. |
| `blackhole`   | Drop whatever matches.                                               |
| `distance`    | The preference against other routes to the same prefix. Lower wins.  |
| `description` | Why the route exists, for whoever reads the file next.               |

As with everything in Circuit, the list is the whole truth: a static route on the device that is not in the file is removed when you apply it.

::: warning Not every platform takes every field
RouterOS takes every field above. The other platforms each refuse some:

- On `raisecom-ros`, a static route must be IPv4 with a `via`, in the default table, and without `description` or `distance`, so a blackhole route cannot be written there.
- On `vrp`, an IPv6 static route takes no `description`.
- On `junos`, no static route takes a `description`, and a blackhole route cannot have the same prefix as another route in its table.
- On `fortios`, a blackhole route cannot be in a VRF, and a `via` must be on one of the router's own networks unless the route also has an `interface`.

`circuit validate` reports anything a platform refuses as an error. See [Platforms](/platforms/).
:::

## In short

- A route is a prefix and where to send traffic for it: a next hop, an interface, or nowhere.
- Connected routes come from the router's own addresses, static routes are written by hand, and the rest are learned from other routers.
- The router uses the longest prefix that holds the destination. `0.0.0.0/0` holds every address, so it catches what nothing else does.
- A blackhole route for your whole block stops traffic to unused addresses from looping between you and your provider.
- In Circuit, static routes are `routing.static`, each with a `prefix` and a `via` or `blackhole: true`.
