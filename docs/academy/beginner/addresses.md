---
title: Addresses
description: Every device has a hardware address and an IP address. Take a laptop from place to place, and follow a letter through two routers, to see what each is for.
---

# Addresses

Every device on a network has two addresses. Its **hardware address** is set in the device when it is made, stays the same wherever it goes, and is used to reach it inside the local network. Its **IP address** is given to it by the network it joins, changes when it moves to another network, and is used to reach it from anywhere.

A packet carries both kinds, and the two do different jobs on the way.

## Two addresses on every device

A device joins a network through its <Term means="The part of a device that joins it to a network: the socket a cable plugs into, or the radio that talks to Wi-Fi. A laptop often has one of each.">network card</Term>. When the card is made, its maker writes a hardware address into it, such as `3c:22:fb:0a:91:7e`: six pairs of characters, using the digits 0 to 9 and the letters a to f. The first half says who made the card, and the second half is a number the maker gives each card, so that no two cards are meant to have the same address. Settings screens usually call it the **MAC address**, short for media access control address.

The IP address looks different: four numbers with dots between them, such as `192.168.1.23`. IP is short for <Term means="The set of rules every device on the internet follows to send packets to each other. Rules like these that devices agree on are called a protocol.">Internet Protocol</Term>. The device is not born with it: the network it joins gives it one, usually without anyone noticing. How the network does that is a lesson in the next level. How to read the four numbers is what the lessons on [counting like a computer](/academy/beginner/binary) and [reading an IP address](/academy/beginner/ip-addresses) are for.

<TryIt title="Take a laptop for a walk">

The laptop starts at home. Take it to the café, then to the office, then off the network altogether, and back home. Watch which address changes, and which never does.

<TwoAddresses />

</TryIt>

The table tells the story. The hardware address was the same in every row, because it lives in the network card, and the card went wherever the laptop went. The IP address was different in every place, because each network gave the laptop an address of its own. Off the network, nobody gave it one, so it had none.

::: tip Your own addresses
Your phone or laptop shows both addresses in its network or Wi-Fi settings. Many phones, and some laptops, now show each Wi-Fi network a made-up hardware address instead of the one in the card, so they are harder to follow from place to place. It is still used the same way: only inside the local network.
:::

<Quiz
  question="You take your phone from home to a friend’s house and join their Wi-Fi. Which address changes?"
  :choices="['The IP address', 'The hardware address', 'Both', 'Neither']"
  :answer="0"
  :why="['', 'The hardware address belongs to the network card in your phone, which came with you.', 'Only one of them depends on the network you join.', 'Your phone joined a different network, and each network gives out addresses of its own.']"
  explain="The friend's network gives your phone a new IP address. The hardware address stays, because it belongs to the phone's network card."
/>

## A name on a door, and a postal address

Think of an apartment building. A postal address gets a letter to the right building from anywhere in the world. Inside the building, the name on a door finds the right apartment. When you move house, your postal address changes, but your name goes with you.

| In the building                 | On a network                                                   |
| ------------------------------- | -------------------------------------------------------------- |
| Postal address of the apartment | IP address: reaches the device from anywhere                   |
| Name on the door                | Hardware address: finds the device on its local network        |
| Moving house                    | Joining another network: new IP address, same hardware address |

The analogy stops being true in two places. Two people can share a name, but hardware addresses are made to be different on every card. And a letter in the post keeps one envelope the whole way, while a packet gets a new outer envelope at every stop, as you will see next.

## Why a device needs both

A device can reach another device directly only if both are on the same <Term means="The devices joined together in one place, such as everything on your home Wi-Fi and cables. Packets between them do not pass through a router.">local network</Term>. There, the hardware address is enough: it says exactly which device a packet is for.

The hardware address says nothing about where a device is, so it is no help in finding a device on another network. That is the IP address's job. It says which network a device is on, and which device it is in that network, so every router on the way can tell where to pass the packet next. A router, you may remember from the [first lesson](/academy/beginner/what-is-a-network), is the device that joins one network to another.

So a packet carries both, like an envelope inside an envelope:

- **The inner envelope** has the IP addresses: from the device that sent it, to the device it is for, anywhere.
- **The outer envelope** has the hardware addresses: from the device sending it now, to the next stop on the local network.

Each step of the way, from one device across one link to the next, is called a <Term means="One step of a packet’s journey: across one link, from one device to the next. A packet that passes two routers on its way makes three hops.">hop</Term>.

<TryIt title="Follow a letter through two routers">

A laptop in an office sends a letter to a server in another part of the building, through two routers. Send it one hop at a time, and read the envelopes at every stop.

<EnvelopeHops />

</TryIt>

Look at the table at the end. The outer envelope was new on every cable, and the inner envelope never changed. That is what happens at every router:

1. The packet arrives in an outer envelope addressed to this router's hardware address.
2. The router throws the outer envelope away and reads the IP address on the inner envelope: where is this going?
3. It picks the next stop on the way there, which is another router or the device itself.
4. It puts the inner envelope into a new outer envelope, from its own hardware address to the next stop's.

How a router picks the next stop is the subject of the lesson on [routers](/academy/beginner/routers).

::: warning One exception you will meet later
The router at home usually changes the "from" IP address of every packet that leaves for the internet, for a reason the Elementary level explains. Inside a network, and between most routers, the IP addresses stay as they are.
:::

<Quiz
  question="A packet passes three routers on its way from a laptop to a server. Which addresses on it are the same at the end as at the start?"
  :choices="['The IP addresses', 'The hardware addresses', 'Both', 'Neither']"
  :answer="0"
  :why="['', 'Every router writes a new outer envelope, with its own hardware address and the next stop’s, so the hardware addresses change at every hop.', 'Only the inner envelope stays the same. The outer one is new at every router.', 'The inner envelope is never changed by these routers. It still says which laptop sent it and which server it is for.']"
  explain="The IP addresses on the inner envelope say where the packet started and where it is going, so they stay the same all the way. The hardware addresses change at every hop."
/>

## In short

- Every device has a hardware address (MAC address), set in its network card, which stays the same wherever it goes.
- It also gets an IP address from the network it joins, which changes when it joins another network.
- The hardware address reaches a device on the same local network; the IP address reaches it from anywhere.
- A packet carries the IP addresses inside and the hardware addresses outside. The outer ones change at every hop, and the inner ones stay.
