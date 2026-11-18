---
title: Layers
description: Networking is split into layers, each with one job. Wrap a message in a header per layer, then follow it through a switch and a router.
---

# Layers

Sending a message across a network is split into layers, and each layer has one job. On the way out, each layer wraps the message in a small label of its own. On the way in, each layer reads its label and hands what is inside to the next layer up.

## Five layers, five jobs

| Layer         | Its job                                                          | What it uses                                        | Where you met it                                          |
| ------------- | ---------------------------------------------------------------- | --------------------------------------------------- | --------------------------------------------------------- |
| 1 Physical    | Carry bits as signals                                            | Cables, light, radio waves                          | [What is a network?](/academy/beginner/what-is-a-network) |
| 2 Link        | Reach the next device on the same local network                  | Frames, hardware addresses, switches, Ethernet, ARP | [Switches](/academy/beginner/switches)                    |
| 3 Network     | Reach a device on any network, one hop at a time                 | Packets, IP addresses, routers, ICMP                | [Routers and the gateway](/academy/beginner/routers)      |
| 4 Transport   | Reach the right program, and with TCP, check every piece arrived | Ports, TCP, and UDP                                 | [Ports and protocols](/academy/beginner/ports)            |
| 5 Application | Say what the program wants                                       | Web pages, DNS questions                            | [DNS](/academy/beginner/dns)                              |

Each layer uses only the layer under it, and does not care how that layer works. A web browser does not know if the page came over a cable or over Wi-Fi. A switch does not know if a frame holds a web page or a DNS question. So you can change one layer without touching the others, and you can look for a problem one layer at a time.

## Wrapping on the way down

Each layer adds a <Term means="A few bytes at the front of a message that say where it goes and how to handle it. Each layer adds its own.">header</Term> in front of whatever the layer over it hands down. The finished bundle, one header inside another, is like a letter in an envelope inside another envelope. This wrapping is called <Term means="Wrapping a message in one header per layer on the way down, so each layer can read its own header on the way up.">encapsulation</Term>.

<TryIt title="Wrap a DNS question for the cable">

<LayerWrap />

</TryIt>

The headers are not free. On this small question they add 46 bytes: 8 for UDP, 20 for IP, and 18 for the frame. That is why a network always carries a little less than its cable's speed.

<Quiz
  question="A frame leaves the laptop. Which header does the next device on the cable read first?"
  :choices="['The UDP header, with the ports', 'The IP header, with the IP addresses', 'The frame header, with the hardware addresses']"
  :answer="2"
  :why="['The ports are deep inside. Only the device at the end of the trip opens the transport header.', 'The IP header is inside the frame. The next device has to open the frame before it can see it.', '']"
  explain="The frame header is the outermost one, so it is the first thing any device on the cable sees. It says which device on this local network the frame is for."
/>

## Who opens which layer

The devices in the middle of the trip open only as many layers as their job needs:

- A **switch** works at layer 2. It reads the hardware address in the frame header, sends the frame out of the right port, and changes nothing.
- A **router** works at layer 3. It takes off the frame header, reads the IP address, lowers the TTL, and wraps the packet in a new frame for the next hop.
- The **device at the end** opens every layer, up to the program the message is for.

<TryIt title="Follow the question through a switch and a router">

<LayerJourney />

</TryIt>

The IP addresses stay the same from the laptop to the server, and only the frame changes at each hop. This is the envelope inside an envelope from [Addresses](/academy/beginner/addresses).

<Quiz
  question="A packet crosses three routers on its way to a server. What is still the same when it arrives?"
  :choices="['The hardware addresses in the frame header', 'The IP address it is going to', 'The TTL']"
  :answer="1"
  :why="['Every router throws the frame header away and writes a new one for the next hop.', '', 'Every router lowers the TTL by one, so it is three lower when it arrives.']"
  explain="The IP header travels the whole way. Routers read the address it is going to, but never change it. Only the frame around it is new at every hop."
/>

## Layer 2, layer 3, and the OSI model

People often say "layer 2" or "layer 3". The numbers come from an older model called <Term means="Open Systems Interconnection: a model from the 1980s that splits networking into seven layers. People still use its layer numbers.">OSI</Term>, which has seven layers instead of five. Its bottom four are the same as in this lesson. Its top three are all part of the application layer here:

| This lesson | OSI                                      | What people say |
| ----------- | ---------------------------------------- | --------------- |
| Application | 5 Session, 6 Presentation, 7 Application | "layer 7"       |
| Transport   | 4 Transport                              | "layer 4"       |
| Network     | 3 Network                                | "layer 3"       |
| Link        | 2 Data link                              | "layer 2"       |
| Physical    | 1 Physical                               | "layer 1"       |

So a "layer 2 problem" is about frames, hardware addresses, and switches. A "layer 3 problem" is about IP addresses and routes. A "layer 3 switch" is a switch that can also route, as many bigger switches can.

<Quiz
  question="A router can be told to block some traffic. If such a rule works at layer 4, what does it look at?"
  :choices="['Hardware addresses', 'Ports, and whether it is TCP or UDP', 'The words on the web page']"
  :answer="1"
  :why="['Hardware addresses are layer 2, in the frame header.', '', 'The page itself is layer 7. A layer 4 rule never opens it.']"
  explain="Layer 4 is transport: ports and the protocol, TCP or UDP. A rule such as allow UDP port 53 works at layer 4."
/>

## Layers in a Circuit file

The fields of a Circuit device file follow the layers too:

| Layer         | In a Circuit device file                                                  | Lesson                                                        |
| ------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------- |
| 1 Physical    | `interfaces.ethernet`, a port's `speed`, and `link`: where the cable goes | [Trunks](/academy/elementary/trunks)                          |
| 2 Link        | `switching.vlans`, and a port's `access_vlan` or `trunk_vlans`            | [VLANs](/academy/elementary/vlans)                            |
| 3 Network     | `addresses` on a port or interface, and `routing`                         | [DHCP](/academy/elementary/dhcp)                              |
| 4 Transport   | `protocol` and `dst_port` in a firewall rule                              | [Firewalls](/academy/elementary/firewall)                     |
| 7 Application | `system.dns`, and `management.ssh`: programs the device itself runs       | [Writing a network down](/academy/elementary/writing-it-down) |

Here is part of a router's file, with the layer of each line in its comment.

```ts
system: { dns: { servers: ["203.0.113.53"] } }, // 7: the DNS server this router asks
interfaces: {
    ethernet: {
        "1g-1": { description: "Internet provider", addresses: ["203.0.113.2/30"] }, // 1: a port, and 3: its IP address
    },
},
routing: { static_routes: [{ prefix: "0.0.0.0/0", next_hop: "203.0.113.1" }] }, // 3: everything else goes to the provider
```

[Circuit Studio](/studio/#the-graph) draws your network one layer at a time too: the cables, the VLANs on each cable, and which devices share an address range.
