---
title: Addresses
description: Every device has a hardware address and an IP address. Take a laptop from place to place, and follow a letter through two routers, to see what each is for.
---

# Addresses

Every device on a network has two addresses. Its hardware address stays the same wherever the device goes. Its IP address changes when the device joins another network. A packet carries both, and each one does a different job on the way.

## Two addresses on every device

A device joins a network through its <Term means="The part of a device that joins it to a network: the socket for a cable, or the radio for Wi-Fi. A laptop often has one of each.">network card</Term>. When the card is made, its maker writes a <Term means="The address fixed in a network card, used to reach a device on the same local network.">hardware address</Term> into it, such as `3c:22:fb:0a:91:7e`. It is six pairs of characters, made of the digits 0 to 9 and the letters a to f. The first half says who made the card. The second half is a number the maker gives each card, so no two cards should have the same address. Settings screens usually call it the **MAC address**, short for media access control address.

An <Term means="The address a network gives a device, used to reach it from anywhere.">IP address</Term> looks different: four numbers with dots between them, such as `192.168.1.23`. IP is short for <Term means="The rules every device on the internet follows to send packets to the others. A set of rules like this is called a protocol.">Internet Protocol</Term>. A device is not born with an IP address. The network it joins gives it one, usually without anyone noticing. [Counting like a computer](/academy/beginner/binary) and [Reading an IP address](/academy/beginner/ip-addresses) show how to read the four numbers.

<TryIt title="Take a laptop for a walk">

<TwoAddresses />

</TryIt>

::: tip Your own addresses
Your phone or laptop shows both addresses in its Wi-Fi settings. Many phones and some laptops give each Wi-Fi network a made-up hardware address instead of the card's own. This makes them harder to track from place to place. The made-up address works the same way.
:::

<Quiz
  question="You take your phone from home to a friend’s house and join their Wi-Fi. Which address changes?"
  :choices="['The IP address', 'The hardware address', 'Both', 'Neither']"
  :answer="0"
  :why="['', 'The hardware address belongs to the network card in your phone, which came with you.', 'Only one of them depends on the network you join.', 'Your phone joined a different network, and each network gives out addresses of its own.']"
  explain="Your friend's network gives your phone a new IP address. The hardware address stays, because it belongs to the phone's network card."
/>

## A name on a door, and a postal address

Think of an apartment building. A postal address gets a letter to the right building from anywhere in the world. Inside the building, the name on a door finds the right apartment. When you move, your postal address changes, but your name goes with you.

| In the building                 | On a network                                                   |
| ------------------------------- | -------------------------------------------------------------- |
| Postal address of the apartment | IP address: reaches the device from anywhere                   |
| Name on the door                | Hardware address: finds the device on its local network        |
| Moving to a new home            | Joining another network: new IP address, same hardware address |

The comparison fails in two places. Two people can share a name, but each card's hardware address is meant to be different from every other. And a letter keeps one envelope the whole way, but a packet gets a new outer envelope at every stop.

## Why a device needs both

A device can send a packet straight to another device only if both are on the same local network. A local network is the devices joined in one place, such as everything on your home Wi-Fi and cables. There, the hardware address is enough. It says exactly which device a packet is for.

But the hardware address says nothing about where a device is. So it cannot help find a device on another network. The IP address does that job. It says which network a device is on, and which device it is on that network. So every router on the way can tell where to pass the packet next. A router, as you saw in the [first lesson](/academy/beginner/what-is-a-network), joins one network to another.

So a packet carries both, like an envelope inside an envelope:

- **The inner envelope** has the IP addresses: from the device that sent the packet, to the device it is for.
- **The outer envelope** has the hardware addresses: from the device sending it now, to the next stop on the local network.

Each step of the way, across one link from one device to the next, is called a <Term means="One step of a packet’s journey: across one link, from one device to the next. A packet that passes two routers on its way makes three hops.">hop</Term>.

<TryIt title="Follow a letter through two routers">

A laptop sends a letter to a server in another part of the office.

<EnvelopeHops />

</TryIt>

Every router does the same four things:

1. The packet arrives in an outer envelope addressed to the router's hardware address.
2. The router throws the outer envelope away. It reads the IP address on the inner envelope to see where the packet is going.
3. It picks the next stop on the way there: another router, or the device itself.
4. It puts the inner envelope into a new outer envelope, from its own hardware address to the next stop's.

[Routers and the gateway](/academy/beginner/routers) shows how a router picks the next stop.

::: warning One exception
Your home router usually changes the "from" IP address of each packet that leaves for the internet. The [lesson on NAT](/academy/elementary/nat) explains why. Other routers leave the IP addresses as they are.
:::

<Quiz
  question="A packet passes three routers on its way from a laptop to a server. Which addresses on it are the same at the end as at the start?"
  :choices="['The IP addresses', 'The hardware addresses', 'Both', 'Neither']"
  :answer="0"
  :why="['', 'Every router writes a new outer envelope, with its own hardware address and the next stop’s, so the hardware addresses change at every hop.', 'Only the inner envelope stays the same. The outer one is new at every router.', 'These routers never change the inner envelope. It still says which laptop sent it and which server it is for.']"
  explain="The IP addresses on the inner envelope say where the packet started and where it is going, so they stay the same all the way. The hardware addresses change at every hop."
/>

## In short

- Every device has a hardware address, or MAC address, set in its network card. It stays the same wherever the device goes.
- A device also gets an IP address from the network it joins. The IP address changes when the device joins another network.
- The hardware address reaches a device on the same local network. The IP address reaches it from anywhere.
- A packet carries the IP addresses inside and the hardware addresses outside. The outer ones change at every hop, and the inner ones stay.
