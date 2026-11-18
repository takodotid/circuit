---
title: Networks of networks
description: The internet is tens of thousands of autonomous systems. Join one to a small internet by transit and peering, and see who reaches whom and who pays.
---

# Networks of networks

The internet is tens of thousands of separate networks, each run by one organization with its own rules. They are internet providers, content networks, universities, and companies. Each of them is an <Term means="A network run by one organization. It has its own routing policy and its own AS number.">autonomous system</Term>, or AS. Each AS has its own number and its own blocks of addresses.

ASes connect in two ways. With **transit**, a customer pays a provider to reach the whole internet. With **peering**, two networks swap traffic between their own customers, usually without paying each other. Many networks meet at **internet exchanges**, where one shared network lets a network peer with hundreds of others.

## AS numbers and address blocks

Every AS has an AS number, an ASN. Other networks tell yours apart by it. In the next lesson, you see it written into every route you announce.

Five regional internet registries hand out AS numbers and address blocks, each for a part of the world:

| Registry | Region                                                |
| -------- | ----------------------------------------------------- |
| AFRINIC  | Africa                                                |
| APNIC    | Asia and the Pacific                                  |
| ARIN     | Canada, the United States, and parts of the Caribbean |
| LACNIC   | Latin America and parts of the Caribbean              |
| RIPE NCC | Europe, the Middle East, and parts of Central Asia    |

In some countries, a national registry sits between you and the regional one. A network usually gets its own AS number when it has a routing policy of its own. That mostly means it connects to more than one other network.

Addresses come in two kinds:

- **From your provider.** The addresses your internet provider lends you are part of its block. If you change provider, you give them back and change every address in your network.
- **Your own.** A block that a registry gives to you is often called provider-independent space. It goes with you to any provider, and you announce it yourself. The edge router at the end of this level does that.

Some AS numbers are set aside, as the private IPv4 ranges are:

| Numbers                        | Set aside for                                             |
| ------------------------------ | --------------------------------------------------------- |
| 64496 to 64511, 65536 to 65551 | Documentation, such as this course.                       |
| 64512 to 65534                 | Private use inside a network, never seen on the internet. |
| 4200000000 to 4294967294       | Private use too. The largest AS number is 4294967295.     |

<Quiz
  question="You set up a lab with routers that swap routes between themselves, never on the internet. Which AS number is set aside for that private use?"
  :choices="['64496', '64512', '65535']"
  :answer="1"
  :why="['64496 is set aside for documentation, the way 192.0.2.0/24 is. Write it in examples, not in a running network.', '', '65535 is reserved and never used for a network at all.']"
  explain="64512 to 65534 are private AS numbers, like the private IPv4 ranges: anyone may use them inside a network, and they never appear on the internet."
/>

## Transit and peering

**Transit** is what a home or office buys from its internet provider, at a larger scale. The customer pays, and the provider carries the customer's traffic to and from the rest of the internet. It tells every other network how to reach the customer, and tells the customer how to reach everyone. Transit is usually paid for by the amount of traffic, or as a fixed price for the port.

**Peering** is an agreement between two networks to send each other the traffic for their own addresses and their customers' addresses, and nothing else. Neither one is paid to carry the other's traffic to the rest of the internet. Both save money on traffic that would otherwise cross a transit provider, and the path is often shorter.

That difference decides how routes travel. By convention, and because of who pays:

1. A network passes the routes of its **customers** on to everyone: its providers, its peers, and its other customers. Carrying traffic for customers is what it is paid for.
2. A network passes the routes it learns from its **providers** and **peers** only on to its own customers. Carrying traffic between two networks that don't pay it would cost it money and earn it nothing.

A handful of very large networks buy transit from nobody. They peer with each other, and between them they reach everyone.

<TryIt title="Join a small internet">

Buy transit from Hurricane Electric, and see what you can reach. Then remove that link, and only peer with Cogent.

<AsInternet />

</TryIt>

With only a peering link to Cogent, you reach Cogent and its customer, Netflix. You don't reach Hurricane Electric or its customer, because Cogent learned their routes from a peer. By rule 2, Cogent passes those routes only to its customers, and you are a peer. To reach everything, you need at least one transit provider, or peers that cover everyone, which only the largest networks have.

<Quiz
  question="You peer with another network and buy no transit. Which networks can you reach through it?"
  :choices="['The whole internet', 'That network and its customers', 'Only that network itself']"
  :answer="1"
  :why="['A peer does not pass on routes it learned from its own providers or peers. Only a transit provider gives you the whole internet.', '', 'Peering includes each side’s customers. That is part of what makes it worth having.']"
  explain="A peer passes on its own routes and its customers’ routes, and nothing else. Everything it learned from its providers and peers stays with its customers."
/>

## Internet exchanges

Peering needs a cable between two networks. A separate cable to every network you peer with doesn't scale. So networks meet at an <Term means="A place where many networks connect to one shared network, so each can peer with any other over a single port.">internet exchange</Term>, an IX. The exchange runs one shared network, the peering LAN, often in a data center where many networks already have routers. Each member plugs one port into it and gets an address on it. Then it can reach every other member over that one port.

Two members still need a <Term means="A connection two routers keep open to exchange routes, such as a BGP session.">session</Term> between their routers to tell each other their routes. Setting one up with every member, one by one, adds up fast. So most exchanges run a <Term means="A server at an internet exchange that takes the routes of every member and passes them on to every other member. Each member then needs one session instead of hundreds.">route server</Term>. Each member keeps one session with it, and it passes every member's routes on to every other member.

<TryIt title="Count the sessions at an exchange">

Add networks, then turn the route server on.

<IxSessions />

</TryIt>

Without a route server, the sessions grow far faster than the members. At an exchange of 300 networks, a session between every pair would be 44,850 sessions. With a route server, it is 300. Many exchanges run two route servers, so that one can be down for maintenance, and members keep a session with each.

<Quiz
  question="Two members of an exchange learned each other's routes from its route server. Which way does traffic between them go?"
  :choices="['Through the route server', 'Straight from one member router to the other, over the peering LAN', 'Through each member’s transit provider']"
  :answer="1"
  :why="['The route server only passes routes on. It never carries the traffic itself.', '', 'They learned each other’s routes at the exchange, so the traffic stays on the exchange and costs neither of them transit.']"
  explain="A route server tells each member how to reach the others, with the other member’s own router as the next hop. The traffic then goes directly between the two routers across the exchange’s network."
/>

### PeeringDB

To peer with a network, you need to know where it is. PeeringDB is a free public database where networks list the exchanges and data centers they are at. They also list their AS number, their address on each peering LAN, and how to ask them to peer. Before you join an exchange, look up who is already there.

## Networks of networks in Circuit

Your AS number belongs to the whole network, so it goes in `circuit.ts`. Every BGP session of every device uses it, unless a device writes another:

```ts
export const as64500 = circuit({
    asn: 64500,
    sites: {
        "pop-1": { description: "Where the router meets the transit and the exchange" },
    },
});
```

The interface on an exchange's peering LAN can say which exchange it is, with `exchange`. Circuit writes nothing to the device for it. [`circuit sync peeringdb`](/integrations/peeringdb) publishes it to your record at PeeringDB:

```ts
interfaces: {
    vlan_interface: {
        exchange: {
            vlan: "exchange",
            addresses: ["192.0.2.10/24", "2001:db8:ffff::10/64"],
            exchange: { name: "DE-CIX Frankfurt", speed: 10_000 },
        },
    },
},
```

`speed` is your port's speed in Mbit/s.

## In short

- The internet is tens of thousands of autonomous systems. Each has its own AS number, and address blocks from a regional registry.
- With transit, a customer pays a provider to reach the whole internet. With peering, two networks swap their own and their customers' traffic, usually for free.
- A network passes its customers' routes to everyone, and its providers' and peers' routes only to its customers.
- At an internet exchange, many networks share one network. A route server lets each keep one session instead of hundreds, while traffic still goes directly between members.
- In Circuit, the AS number is `asn` in `circuit.ts`, and an exchange interface has an `exchange` field for PeeringDB.
