---
title: Networks of networks
description: The internet is tens of thousands of autonomous systems. Join one to a small internet by transit and peering, and see who reaches whom and who pays.
---

# Networks of networks

The internet is tens of thousands of separate networks, each run by one organisation with its own rules: internet providers, content networks, universities, companies. Each of them is an <Term means="A network run by one organisation, with its own routing policy and its own AS number. AS for short.">autonomous system</Term>, an AS, with a number of its own and blocks of addresses of its own.

ASes connect in two ways. With **transit**, a customer pays a provider to reach the whole internet. With **peering**, two networks swap traffic between their own customers, usually without paying each other. Many of them meet at **internet exchanges**, where one shared network lets a network peer with hundreds of others.

## AS numbers and address blocks

Every AS has an <Term means="Autonomous system number: the number that names an AS on the internet, such as 64500.">AS number</Term>, an ASN. It is how other networks tell yours apart, and in the next lesson you see it written into every route you announce.

AS numbers and address blocks are handed out by five regional internet registries, each for a part of the world: AFRINIC for Africa, APNIC for Asia and the Pacific, ARIN for North America, LACNIC for Latin America and the Caribbean, and the RIPE NCC for Europe, the Middle East and part of Central Asia. In some countries a national registry sits between you and the regional one. A network usually gets its own AS number when it has a routing policy of its own, which mostly means it connects to more than one other network.

Addresses come in two kinds:

- **From your provider.** The addresses your internet provider lends you are part of its block. If you change provider, you give them back and change every address in your network.
- **Your own.** A block a registry gives to you, often called provider-independent space. It goes with you to any provider, and you announce it yourself, which is what the edge router at the end of this level does.

Some AS numbers are set aside, the way private IPv4 ranges are:

| Numbers                        | Set aside for                                             |
| ------------------------------ | --------------------------------------------------------- |
| 64496 to 64511, 65536 to 65551 | Documentation, such as this course.                       |
| 64512 to 65534                 | Private use inside a network, never seen on the internet. |
| 4200000000 to 4294967294       | Private use too. AS numbers go up to 4294967295 today.    |

<Quiz
  question="You set up a lab with routers that swap routes between themselves, never on the internet. Which AS number is set aside for that private use?"
  :choices="['64496', '64512', '65535']"
  :answer="1"
  :why="['64496 is set aside for documentation, the way 192.0.2.0/24 is. Write it in examples, not in a running network.', '', '65535 is reserved and never used for a network at all.']"
  explain="64512 to 65534 are private AS numbers, like the private IPv4 ranges: anyone may use them inside a network, and they never appear on the internet."
/>

## Transit and peering

**Transit** is what your home or office buys from its internet provider, at a larger scale. The customer pays, and the provider carries the customer's traffic to and from the rest of the internet: it tells every other network how to reach the customer, and tells the customer how to reach everyone. It is usually paid for by the amount of traffic, or as a fixed price for the port.

**Peering** is an agreement between two networks to send each other the traffic for their own addresses and their customers' addresses, and nothing else. Neither is paid for carrying the other's traffic to the rest of the internet. Since neither pays, both save money on traffic that would otherwise cross a transit provider, and the path is often shorter.

That difference decides how routes travel. By convention, and because of who pays:

1. A network passes the routes of its **customers** on to everyone: its providers, its peers and its other customers. Carrying traffic for customers is what it is paid for.
2. A network passes the routes it learns from its **providers** and **peers** only on to its own customers. Carrying traffic between two networks that do not pay it would cost it money and earn it nothing.

A handful of very large networks buy transit from nobody. They peer with each other, and between them they reach everyone.

<TryIt title="Join a small internet">

Your network, AS64500, has no links yet. Add a link that buys transit from Transit A and see what you can reach. Then remove it and only peer with the regional provider. Look from other networks too, and open "Who pays whom".

<AsInternet />

</TryIt>

With only a peering link to the regional provider, you reach the provider and its customer, the school, but not Transit A. The regional provider learned Transit A's routes from its own provider, so by rule 2 it passes them only to customers, and you are a peer. To reach everything, you need at least one transit provider, or peers that cover everyone, which only the largest networks have.

<Quiz
  question="You peer with a regional provider and buy no transit. Which networks can you reach through it?"
  :choices="['The whole internet', 'The regional provider and its customers', 'Only the regional provider itself']"
  :answer="1"
  :why="['A peer does not pass on routes it learned from its own providers or peers. Only a transit provider gives you the whole internet.', '', 'Peering includes each side’s customers. That is part of what makes it worth having.']"
  explain="A peer passes on its own routes and its customers’ routes, and nothing else. Everything the regional provider learned from its providers and peers stays with its customers."
/>

## Internet exchanges

Peering needs a cable between two networks. Running a separate cable to every network you want to peer with does not scale, so networks meet at an <Term means="A place where many networks connect to one shared network, so each can peer with any other over a single port. IX for short.">internet exchange</Term>, an IX. The exchange runs one shared network, the peering LAN, often in a data centre where many networks already have routers. Each member plugs one port into it and gets an address on it, and can then reach every other member over that one port.

Two members still need a <Term means="A connection two routers keep open to swap routes. The next lesson shows what goes over it.">session</Term> between their routers to tell each other their routes. Setting one up with every member, one by one, adds up fast. So most exchanges run a <Term means="A server at an exchange that takes the routes of every member and passes them on to every other member, so each member needs one session instead of hundreds.">route server</Term>: each member keeps one session with it, and it passes every member's routes on to every other.

<TryIt title="Count the sessions at an exchange">

Add networks to the exchange and watch the sessions grow. Then turn the route server on.

<IxSessions />

</TryIt>

Without a route server, the sessions grow far faster than the members: at an exchange of 300 networks, a session between every pair would be 44,850 sessions. With one, it is 300. Many exchanges run two route servers, so that one can be down for maintenance, and members keep a session with each.

<Quiz
  question="Two members of an exchange learned each other's routes from its route server. Which way does traffic between them go?"
  :choices="['Through the route server', 'Straight from one member router to the other, over the peering LAN', 'Through each member’s transit provider']"
  :answer="1"
  :why="['The route server only passes routes on. It never carries the traffic itself.', '', 'They learned each other’s routes at the exchange, so the traffic stays on the exchange and costs neither of them transit.']"
  explain="A route server tells each member how to reach the others, with the other member’s own router as the next hop. The traffic then goes directly between the two routers across the exchange’s network."
/>

### PeeringDB

To peer with someone, you need to know where they are. <Term means="A free public database where networks list the exchanges and buildings they are at, their AS number, and how to ask them to peer.">PeeringDB</Term> is where networks list the exchanges and data centres they are at, their AS number, their address on each peering LAN, and how to ask them to peer. Before you join an exchange, look up who is already there.

## Networks of networks in Circuit

Your AS number belongs to the whole network, so it goes in `circuit.config.ts`. The next lesson writes it into the router as well, to run BGP:

```ts
export default defineNetwork({ devices: [edge], asn: 64500 });
```

The interface on an exchange's peering LAN can say which exchange it is, with `exchange`. Devices ignore it. It is what `npx circuit peeringdb` publishes, so your PeeringDB record always matches your files:

```ts
interfaces: {
    ix: {
        type: "vlan",
        vlan: "ix",
        addresses: ["192.0.2.10/24", "2001:db8:ffff::10/64"],
        exchange: { name: "Example IX", speed: 10_000 },
    },
},
```

`speed` is your port's speed in Mbit/s. [Publishing the network](/guide/publishing) shows the whole PeeringDB setup.

## In short

- The internet is tens of thousands of autonomous systems, each with its own AS number and address blocks from a regional registry.
- With transit, a customer pays a provider to reach the whole internet. With peering, two networks swap their own and their customers' traffic, usually for free.
- A network passes its customers' routes to everyone, and its providers' and peers' routes only to its customers.
- At an internet exchange, many networks share one network; a route server lets each keep one session instead of hundreds, while traffic still goes directly between members.
- In Circuit, the AS number is `asn` in `circuit.config.ts`, and an exchange interface carries `exchange` for PeeringDB.
