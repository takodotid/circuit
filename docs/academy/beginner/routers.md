---
title: Routers and the gateway
description: A device sends to its own network directly, and everything else to its gateway. Send packets across routers and watch each one look up the next hop.
---

# Routers and the gateway

A router joins one network to another. Your laptop sends packets for its own network straight to the device they are for, and every other packet to one router, its default gateway. Each router then looks up the destination in its routing table and passes the packet one step closer, until it arrives.

No router knows the whole way. Each one knows only the next step, and that is enough.

## Near or far: the first decision

Every time a device sends a packet, it first compares the destination's network part with its own, the way you did in [Reading an IP address](/academy/beginner/ip-addresses). There are only two answers:

- **The same network**: the device sends the packet straight to the receiver. It wraps it in a frame for the receiver's hardware address, and the switch delivers it, as in [Switches](/academy/beginner/switches). If it does not know that hardware address yet, it finds it with a broadcast: "which of you has this IP address?"
- **A different network**: the device sends the packet to its default gateway.

## The default gateway

The <Term means="The address of the router on your own network. A device sends every packet for another network to it.">default gateway</Term> is the address of the router on your own network: the one way out. A device is given it together with its own address when it joins the network. At home, the gateway is the home router, often at an address such as `192.168.1.1`.

Think of a building with a mailroom. A note for a colleague on your floor you hand over yourself, but every letter for anywhere else goes to the mailroom. The picture stops being true at the mailroom: it does not carry your letter all the way. It passes it to the next sorting office, which passes it on again, and that is what routers do too.

A router sits on more than one network, so it has an address on each of them. In the drawing below, the main router is `192.168.1.1` on the office network, `10.0.0.1` on the cable to the library, and `198.51.100.2` on the cable to the internet provider. The laptop only needs to know the first one: that is its gateway.

<TryIt title="Send a packet across routers">

Send a packet to the printer, then to the library desktop. Watch what the laptop decides, which row of each routing table lights up, and the TTL number on the packet.

<RouterPath />

</TryIt>

The packet to the printer never went near a router: the printer is on the laptop's own network. The packet to the library desktop took these steps:

1. The laptop compared `172.16.8.25` with its own network, `192.168.1.0/24`. The network parts differ, so it sent the packet to its gateway.
2. To do that, it put the packet in a frame addressed to the main router's hardware address. The IP address inside still said `172.16.8.25`.
3. The main router took the packet out of the frame, read the destination, and found the row for `172.16.8.0/24` in its table: send to `10.0.0.2`, the library router.
4. It put the packet in a new frame, for the library router's hardware address, and sent it down the cable.
5. The library router found `172.16.8.0/24` on one of its own sides, and sent the packet straight to the desktop in a last frame.

The IP addresses on the packet stayed the same the whole way. The frame around it was new at every step, just as the outer envelope changed in [Addresses](/academy/beginner/addresses).

<Quiz
  question="Your laptop is 192.168.1.20/24, and its gateway is 192.168.1.1. Which packet does it send to the gateway?"
  :choices="['A packet for 192.168.1.30', 'A packet for 192.168.1.200', 'A packet for 192.168.2.30']"
  :answer="2"
  :why="['192.168.1.30 is on the same /24 network as the laptop, so the laptop sends it straight there.', 'With a /24, the network part is the first three numbers: 192.168.1, the same as the laptop. It goes straight there.', '']"
  explain="The network part of 192.168.2.30 is 192.168.2, and the laptop is on 192.168.1. A different network means: send it to the gateway."
/>

## The routing table

A router's <Term means="The list a router keeps of networks it can reach, and where to send a packet for each of them.">routing table</Term> is a list of networks, and for each one, where to send a packet for it. There are two kinds of answer:

| Send to                       | Means                                                                                                 |
| ----------------------------- | ----------------------------------------------------------------------------------------------------- |
| Directly                      | The network is on one of the router's own sides. The router delivers the packet to the device itself. |
| The address of another router | The network is further away. The router passes the packet to that router, the next step on the way.   |

Most tables end with a row for **anything else**: where to send a packet whose network is on no other row. For the main router, that is the internet provider. It is the router's own default gateway, and it works the same way as the laptop's.

When a packet arrives, the router looks for the row whose network holds the destination address. If no row does, it uses the row for anything else. If it has no such row either, it drops the packet. Try sending to the website in the widget: no row names its network, so it takes the row for anything else, out to the provider.

Each step from one router to the next is called a <Term means="One step on a packet's way: from a device to a router, or from one router to the next.">hop</Term>. A packet from your home to a website far away may take ten or twenty hops, and every router on the way does the same small thing: read the destination, find a row, pass it on.

<Quiz
  question="The main router receives a packet for 172.16.8.25. What does it do?"
  :choices="['Sends a copy out of every side, like a switch flooding', 'Finds the row for 172.16.8.0/24 and passes the packet to 10.0.0.2', 'Sends it back to the laptop, because the laptop should know the way', 'Sends it to the internet provider, because the provider knows everything']"
  :answer="1"
  :why="['A router never floods. It sends each packet one way, the one its table gives.', '', 'The laptop has done its part by sending to its gateway. Finding the way from here is the router’s job.', 'The provider is only for addresses on no other row. This one has a row of its own.']"
  explain="The router looks up the destination in its routing table. The row for 172.16.8.0/24 says to pass it to the library router at 10.0.0.2."
/>

## The TTL: a counter against going round in circles

Routing tables are written by people, and people make mistakes. If one router sends a packet to a second, and the second sends it back to the first, the packet goes round and round. Without something to stop it, it would circle forever and keep the cable busy.

So every packet carries a number called the <Term means="Time to live: a number on every packet that each router lowers by one. A router that lowers it to 0 drops the packet.">TTL</Term>, short for time to live. The sender sets it, often to 64 or 128, depending on the device. Every router that passes the packet on lowers it by one, and a router that lowers it to 0 drops the packet instead of passing it on.

In this second drawing, the main router still has a row for a reading room in the library that was closed last year. The library router no longer knows that network, so it sends anything for it back to the main router, which sends it to the library again.

<TryIt title="Make a loop, and watch the TTL run out">

Send a packet to the old reading room, and watch the TTL on the packet. Then send one to the library desktop: its rows are still right.

<RouterPath loop />

</TryIt>

The TTL did not fix the mistake. The packet was still lost, and the forgotten row is still in the table until someone removes it. What the TTL does is limit the damage: a lost packet disappears after a few dozen hops, instead of going round forever.

::: tip How traceroute works
A router that drops a packet because its TTL reached 0 usually sends a short note back to the sender, saying who it is. The `traceroute` tool (`tracert` on Windows) uses this to list the routers on the way to an address: it sends packets with a TTL of 1, then 2, then 3, and each router in turn drops one and says who it is.
:::

<Quiz
  question="A packet leaves your laptop with a TTL of 64 and passes through 5 routers before it arrives. What is its TTL when it arrives?"
  :choices="['64', '59', '5', '0']"
  :answer="1"
  :why="['Every router on the way lowers the TTL by one, so it cannot still be 64.', '', 'The TTL counts down from where the sender set it. It does not count the hops up from zero.', 'A packet whose TTL reaches 0 is dropped. This one arrived.']"
  explain="Each of the 5 routers lowers it by one: 64 minus 5 is 59."
/>

## In short

- A device sends packets for its own network straight to the receiver, and everything else to its default gateway, the router on its network.
- A router has an address on each network it joins.
- A router looks up each packet's destination in its routing table and passes it one hop closer: directly, to another router, or by the row for anything else.
- The IP addresses on a packet stay the same the whole way; the frame around it is new at every hop.
- Every router lowers the packet's TTL by one, so a packet caught in a loop is dropped instead of circling forever.
