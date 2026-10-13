---
title: Layers
description: Networking is split into layers, each with one job. Wrap a message in a header per layer, then follow it through a switch and a router.
---

# Layers

Sending a message across a network is split into layers, and each layer has one job. On the way out, each layer wraps the message in a small label of its own. On the way in, each layer reads its label and hands what is inside to the layer above.

A switch only reads the bottom two layers, and a router the bottom three. Only the two devices at the ends of the trip open all of them. You met every layer in Beginner; this lesson puts them in order.

## Five layers, five jobs

Here is a simple model with five layers, from the bottom up:

| Layer         | Its job                                                          | What it uses                                        | Where you met it                                          |
| ------------- | ---------------------------------------------------------------- | --------------------------------------------------- | --------------------------------------------------------- |
| 1 Physical    | Carry bits as signals                                            | Cables, light, radio waves                          | [What is a network?](/academy/beginner/what-is-a-network) |
| 2 Link        | Reach the next device on the same local network                  | Frames, hardware addresses, switches, Ethernet, ARP | [Switches](/academy/beginner/switches)                    |
| 3 Network     | Reach a device on any network, one hop at a time                 | Packets, IP addresses, routers, ICMP                | [Routers](/academy/beginner/routers)                      |
| 4 Transport   | Reach the right program, and with TCP, check every piece arrived | Ports, TCP and UDP                                  | [Ports](/academy/beginner/ports)                          |
| 5 Application | Say what the program wants                                       | Web pages, DNS questions                            | [DNS](/academy/beginner/dns)                              |

Each layer relies only on the one below it and does not care how that one works. A web browser does not know if the page came over a cable or over Wi-Fi, and a switch does not know if the frame holds a web page or a DNS question. That is what makes layers useful: you can change one without touching the others, and you can look for a problem one layer at a time.

## Wrapping on the way down

Each layer adds a <Term means="A few bytes at the front of a message that say where it goes and how to handle it. Each layer adds its own.">header</Term> in front of whatever the layer above hands it. The finished bundle, one header inside another, is like a letter in an envelope inside another envelope. This wrapping is called <Term means="Wrapping a message in one header per layer on the way down, so that each layer can read its own header on the way up.">encapsulation</Term>.

Try it with a DNS question from a laptop to the DNS server of an office. The headers are offered out of order, so you have to decide which comes next.

<TryIt title="Wrap a DNS question for the cable">

<LayerWrap />

</TryIt>

The header closest to the question is the transport header, because it says which program the question is for. The outermost is the frame header, because the very next device on the cable has to read it first. The link layer also adds a small check at the end of the frame, so the receiver can tell if any bit was damaged on the way.

The headers are not free. On this small question they add over 40 bytes, which is why a network is always a little slower than its cable's speed.

<Quiz
  question="A frame leaves the laptop. Which header does the next device on the cable read first?"
  :choices="['The UDP header, with the ports', 'The IP header, with the IP addresses', 'The frame header, with the hardware addresses']"
  :answer="2"
  :why="['The ports are deep inside. Only the device at the end of the trip opens the transport header.', 'The IP header is inside the frame. The next device has to open the frame before it can see it.', '']"
  explain="The frame header is the outermost one, so it is the first thing any device on the cable sees. It says which device on this local network the frame is for."
/>

## Who opens which layer

On the way in, it all happens in reverse: each layer reads its header, takes it off, and hands the rest up. But the devices in the middle of the trip do not unwrap everything. They only open as many layers as their job needs:

- A **switch** works at layer 2. It reads the hardware address in the frame header, sends the frame out of the right port, and changes nothing.
- A **router** works at layer 3. It takes off the frame header, reads the IP address, lowers the TTL, and wraps the packet in a new frame for the next hop.
- The **device at the end** opens every layer, up to the program the message is for.

Step through one trip and watch the table: it shows what each device does with each layer.

<TryIt title="Follow the question through a switch and a router">

<LayerJourney />

</TryIt>

Look at what the router changed and what it left alone. The frame header was thrown away and a new one written, with new hardware addresses. The IP addresses stayed the same from the laptop to the server, and only the TTL went down. This is the envelope inside an envelope from [Addresses](/academy/beginner/addresses): the outer label changes at every hop, the inner one does not.

<Quiz
  question="A packet crosses three routers on its way to a server. What is still the same when it arrives?"
  :choices="['The hardware addresses in the frame header', 'The IP address it is going to', 'The TTL']"
  :answer="1"
  :why="['Every router throws the frame header away and writes a new one for the next hop.', '', 'Every router lowers the TTL by one, so it is three lower when it arrives.']"
  explain="The IP header travels the whole way. Routers read the address it is going to, but never change it. Only the frame around it is new at every hop."
/>

## Layer 2, layer 3, and the OSI model

You will often hear people say "layer 2" or "layer 3". The numbers come from an older model called <Term means="Open Systems Interconnection: a model from the 1980s that splits networking into seven layers. Its numbers are still used everywhere.">OSI</Term>, which has seven layers instead of five. Its bottom four are the same as ours, and its top three are all part of our application layer:

| This course | OSI                                      | What people say |
| ----------- | ---------------------------------------- | --------------- |
| Application | 5 Session, 6 Presentation, 7 Application | "layer 7"       |
| Transport   | 4 Transport                              | "layer 4"       |
| Network     | 3 Network                                | "layer 3"       |
| Link        | 2 Data link                              | "layer 2"       |
| Physical    | 1 Physical                               | "layer 1"       |

So a "layer 2 problem" is about frames, hardware addresses and switches, and a "layer 3 problem" is about IP addresses and routes. A "layer 3 switch" is a switch that can also route, which many bigger switches can.

<Quiz
  question="A router can be told to block some traffic. If such a rule works at layer 4, what does it look at?"
  :choices="['Hardware addresses', 'Ports, and whether it is TCP or UDP', 'The words on the web page']"
  :answer="1"
  :why="['Hardware addresses are layer 2, in the frame header.', '', 'The page itself is layer 7. A layer 4 rule never opens it.']"
  explain="Layer 4 is transport: ports and the protocol, TCP or UDP. A rule such as allow UDP port 53 works at layer 4. The Firewalls lesson writes rules like this."
/>

## Layers in a Circuit file

From the next lesson on, you write your network down in Circuit files, and the fields in them follow the layers too:

| Layer         | In a Circuit device file                                                       | Lesson                                                        |
| ------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| 1 Physical    | `ports`, a port's `speed`, and `link`: which device and port the cable goes to | [Trunks](/academy/elementary/trunks)                          |
| 2 Link        | `vlans`, and a port's `access_vlan` or `trunk_vlans`                           | [VLANs](/academy/elementary/vlans)                            |
| 3 Network     | `addresses` on a port or interface, and `routing`                              | [DHCP](/academy/elementary/dhcp)                              |
| 4 Transport   | `protocol` and `dst_port` in a firewall rule                                   | [Firewalls](/academy/elementary/firewall)                     |
| 7 Application | `system.dns`, and `management.ssh`: programs the device itself runs            | [Writing a network down](/academy/elementary/writing-it-down) |

Here is part of a router's file, with the layer of each line in its comment. The next lesson reads a whole one.

```ts
system: { dns: { servers: ["203.0.113.53"] } }, // 7: the DNS server this router asks
ports: {
    "1g-1": { description: "Internet provider", addresses: ["203.0.113.2/30"] }, // 1: a port, and 3: its IP address
},
routing: { static: [{ prefix: "0.0.0.0/0", via: "203.0.113.1" }] }, // 3: everything else goes to the provider
```

[Circuit Studio](/studio/graph) draws your network from these files the same way, one layer at a time: which cable goes where, which VLANs each cable carries, and which devices share an address range.

## In short

- Networking is split into layers: physical, link, network, transport and application. Each does one job and relies only on the one below.
- On the way out, each layer wraps the message in its header; on the way in, each layer reads and removes its own. This is encapsulation.
- A switch reads up to layer 2, a router up to layer 3, and only the devices at the ends open every layer.
- A router writes a new frame header at every hop, but the IP addresses inside stay the same.
- "Layer 2" and "layer 3" come from the seven-layer OSI model, whose bottom four match the five layers here.
